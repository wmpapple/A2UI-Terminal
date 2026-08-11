use super::{ProviderConfig, ProviderKind, ProviderMessage};
use crate::error::{AppError, ProviderFailure};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECTION_TEST_TIMEOUT: Duration = Duration::from_secs(20);
const RESPONSE_HEADERS_TIMEOUT: Duration = Duration::from_secs(45);
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const STREAM_TOTAL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);
const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;
const MAX_STREAM_BODY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
struct TransportTimeouts {
    response_headers: Duration,
    stream_idle: Duration,
    stream_total: Duration,
}

impl Default for TransportTimeouts {
    fn default() -> Self {
        Self {
            response_headers: RESPONSE_HEADERS_TIMEOUT,
            stream_idle: STREAM_IDLE_TIMEOUT,
            stream_total: STREAM_TOTAL_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamChunk {
    Delta(String),
    Done,
}

pub async fn test_connection(config: &ProviderConfig, api_key: &str) -> Result<u128, AppError> {
    config.validate()?;
    let client = build_client(config)?;
    let started = Instant::now();
    let response = tokio::time::timeout(
        CONNECTION_TEST_TIMEOUT,
        client
            .get(api_url(&config.endpoint, "models")?)
            .bearer_auth(api_key)
            .send(),
    )
    .await
    .map_err(|_| provider_error("PROVIDER_RESPONSE_TIMEOUT", "等待 Provider 响应超时", true))?
    .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(status_error(
            response.status(),
            retry_after_seconds(response.headers()),
        ));
    }
    Ok(started.elapsed().as_millis())
}

pub async fn stream_chat<F>(
    config: &ProviderConfig,
    api_key: &str,
    messages: &[ProviderMessage],
    cancelled: Arc<AtomicBool>,
    mut on_delta: F,
) -> Result<String, AppError>
where
    F: FnMut(&str) -> Result<(), AppError>,
{
    stream_chat_with_timeouts(
        config,
        api_key,
        messages,
        cancelled,
        &mut on_delta,
        TransportTimeouts::default(),
    )
    .await
}

async fn stream_chat_with_timeouts<F>(
    config: &ProviderConfig,
    api_key: &str,
    messages: &[ProviderMessage],
    cancelled: Arc<AtomicBool>,
    on_delta: &mut F,
    timeouts: TransportTimeouts,
) -> Result<String, AppError>
where
    F: FnMut(&str) -> Result<(), AppError>,
{
    config.validate()?;
    if cancelled.load(Ordering::Acquire) {
        return Err(AppError::RequestCancelled);
    }
    let client = build_client(config)?;
    let request = client
        .post(api_url(&config.endpoint, "chat/completions")?)
        .bearer_auth(api_key)
        .json(&request_body(config, messages));
    let response_future = request.send();
    tokio::pin!(response_future);
    let response_timeout = tokio::time::sleep(timeouts.response_headers);
    tokio::pin!(response_timeout);
    let response = tokio::select! {
        _ = wait_until_cancelled(cancelled.clone()) => return Err(AppError::RequestCancelled),
        _ = &mut response_timeout => {
            return Err(provider_error(
                "PROVIDER_RESPONSE_TIMEOUT",
                "等待 Provider 开始响应超时",
                true,
            ));
        }
        response = &mut response_future => response.map_err(network_error)?,
    };
    if !response.status().is_success() {
        return Err(status_error(
            response.status(),
            retry_after_seconds(response.headers()),
        ));
    }

    let mut body = String::new();
    let mut decoder = SseDecoder::default();
    let mut stream = response.bytes_stream();
    let total_timeout = tokio::time::sleep(timeouts.stream_total);
    tokio::pin!(total_timeout);
    loop {
        let idle_timeout = tokio::time::sleep(timeouts.stream_idle);
        tokio::pin!(idle_timeout);
        tokio::select! {
            _ = wait_until_cancelled(cancelled.clone()) => return Err(AppError::RequestCancelled),
            _ = &mut idle_timeout => return Err(provider_error(
                "PROVIDER_STREAM_IDLE_TIMEOUT",
                "Provider 流长时间没有返回新数据",
                true,
            )),
            _ = &mut total_timeout => return Err(provider_error(
                "PROVIDER_STREAM_TOTAL_TIMEOUT",
                "Provider 流超过最长运行时间",
                true,
            )),
            next = stream.next() => {
                let Some(chunk) = next else { break };
                let chunk = chunk.map_err(network_error)?;
                if body.len().saturating_add(chunk.len()) > MAX_STREAM_BODY_BYTES {
                    return Err(provider_error(
                        "PROVIDER_RESPONSE_TOO_LARGE",
                        "Provider 返回内容超过 16 MiB 安全上限",
                        false,
                    ));
                }
                for item in decoder.push(&chunk)? {
                    match item {
                        StreamChunk::Delta(delta) => {
                            body.push_str(&delta);
                            on_delta(&delta)?;
                        }
                        StreamChunk::Done => return Ok(body),
                    }
                }
            }
        }
    }
    for item in decoder.finish()? {
        match item {
            StreamChunk::Delta(delta) => {
                body.push_str(&delta);
                on_delta(&delta)?;
            }
            StreamChunk::Done => return Ok(body),
        }
    }
    Err(provider_error(
        "PROVIDER_STREAM_INTERRUPTED",
        "Provider 流在完成标记前中断",
        true,
    ))
}

async fn wait_until_cancelled(cancelled: Arc<AtomicBool>) {
    let mut poll = tokio::time::interval(CANCELLATION_POLL_INTERVAL);
    loop {
        poll.tick().await;
        if cancelled.load(Ordering::Acquire) {
            return;
        }
    }
}

pub fn validate_endpoint(endpoint: &str) -> Result<(), AppError> {
    validate_url(endpoint, true).map(|_| ())
}

pub fn validate_proxy(proxy: &str) -> Result<(), AppError> {
    let url = validate_url(proxy, false)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput(
            "代理地址仅支持 HTTP 或 HTTPS".into(),
        ));
    }
    Ok(())
}

fn validate_url(value: &str, require_secure_remote: bool) -> Result<Url, AppError> {
    let url = Url::parse(value.trim())
        .map_err(|_| AppError::InvalidInput("Endpoint 或代理地址不是有效 URL".into()))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::InvalidInput(
            "URL 中不能包含用户名或密码，请使用无凭据代理地址".into(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() || url.host_str().is_none() {
        return Err(AppError::InvalidInput(
            "Endpoint 或代理地址不能包含查询参数、片段或空主机".into(),
        ));
    }
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if require_secure_remote && url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(AppError::InvalidInput(
            "远程 Endpoint 必须使用 HTTPS；仅本机回环地址允许 HTTP".into(),
        ));
    }
    Ok(url)
}

fn api_url(endpoint: &str, resource: &str) -> Result<Url, AppError> {
    let mut value = endpoint.trim().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/models"] {
        if value.ends_with(suffix) {
            value.truncate(value.len() - suffix.len());
        }
    }
    Url::parse(&format!("{value}/{resource}"))
        .map_err(|_| AppError::InvalidInput("无法构造 Provider API 地址".into()))
}

fn build_client(config: &ProviderConfig) -> Result<Client, AppError> {
    let mut builder = Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent("A2UI-Terminal/0.1");
    if let Some(proxy_url) = config
        .proxy_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        validate_proxy(proxy_url)?;
        builder = builder.proxy(
            reqwest::Proxy::all(proxy_url)
                .map_err(|_| AppError::InvalidInput("代理地址无法使用".into()))?,
        );
    }
    builder.build().map_err(network_error)
}

fn request_body(config: &ProviderConfig, messages: &[ProviderMessage]) -> serde_json::Value {
    let mut body = json!({
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "stream": true
    });
    let token_field = if config.kind == ProviderKind::OpenAi {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    body[token_field] = json!(4096);
    body
}

fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        provider_error("PROVIDER_NETWORK_TIMEOUT", "Provider 网络操作超时", true)
    } else if error.is_connect() {
        provider_error(
            "PROVIDER_NETWORK_ERROR",
            "无法连接 Provider，请检查 Endpoint、代理和网络",
            true,
        )
    } else if error.is_decode() || error.is_body() {
        provider_error(
            "PROVIDER_PROTOCOL_ERROR",
            "Provider 返回了无法解析的网络响应",
            true,
        )
    } else {
        provider_error("PROVIDER_NETWORK_ERROR", "Provider 网络请求失败", true)
    }
}

fn status_error(status: StatusCode, retry_after: Option<u64>) -> AppError {
    let (code, message, retryable) = match status.as_u16() {
        400 | 422 => (
            "PROVIDER_INVALID_REQUEST",
            "Provider 拒绝了请求参数，请检查 Model 与兼容性设置",
            false,
        ),
        401 => (
            "PROVIDER_AUTHENTICATION_FAILED",
            "Provider 鉴权失败，请检查 API Key",
            false,
        ),
        403 => (
            "PROVIDER_ACCESS_DENIED",
            "Provider 拒绝访问，请检查 Key 权限、模型权限或账户状态",
            false,
        ),
        404 => (
            "PROVIDER_NOT_FOUND",
            "Provider API 地址或 Model 不存在",
            false,
        ),
        408 | 504 => ("PROVIDER_UPSTREAM_TIMEOUT", "Provider 上游处理超时", true),
        409 => ("PROVIDER_CONFLICT", "Provider 暂时无法处理当前请求", true),
        429 => (
            "PROVIDER_RATE_LIMITED",
            "Provider 请求过于频繁或额度不足",
            true,
        ),
        500..=599 => ("PROVIDER_UNAVAILABLE", "Provider 服务暂时不可用", true),
        _ => (
            "PROVIDER_REQUEST_REJECTED",
            "Provider 返回了未成功状态",
            false,
        ),
    };
    AppError::Provider(
        ProviderFailure::new(
            code,
            format!("{message}（HTTP {}）", status.as_u16()),
            retryable,
        )
        .with_http_status(status.as_u16())
        .with_retry_after(retry_after),
    )
}

fn retry_after_seconds(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn provider_error(code: &'static str, message: &'static str, retryable: bool) -> AppError {
    AppError::Provider(ProviderFailure::new(code, message, retryable))
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    data_lines: Vec<String>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<StreamChunk>, AppError> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_SSE_EVENT_BYTES {
            return Err(provider_error(
                "PROVIDER_PROTOCOL_ERROR",
                "Provider 单个流事件超过 1 MiB 安全上限",
                false,
            ));
        }
        self.buffer.extend_from_slice(bytes);
        let mut output = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.process_line(&line, &mut output)?;
        }
        Ok(output)
    }

    fn finish(&mut self) -> Result<Vec<StreamChunk>, AppError> {
        let mut output = Vec::new();
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.process_line(&line, &mut output)?;
        }
        self.flush_event(&mut output)?;
        Ok(output)
    }

    fn process_line(&mut self, line: &[u8], output: &mut Vec<StreamChunk>) -> Result<(), AppError> {
        if line.is_empty() {
            return self.flush_event(output);
        }
        let line = std::str::from_utf8(line).map_err(|_| {
            provider_error(
                "PROVIDER_PROTOCOL_ERROR",
                "Provider 流包含无效 UTF-8",
                false,
            )
        })?;
        if let Some(data) = line.strip_prefix("data:") {
            self.data_lines.push(data.trim_start().to_string());
        }
        Ok(())
    }

    fn flush_event(&mut self, output: &mut Vec<StreamChunk>) -> Result<(), AppError> {
        if self.data_lines.is_empty() {
            return Ok(());
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        if data.trim() == "[DONE]" {
            output.push(StreamChunk::Done);
            return Ok(());
        }
        let chunk: ChatCompletionChunk = serde_json::from_str(&data).map_err(|_| {
            provider_error(
                "PROVIDER_PROTOCOL_ERROR",
                "Provider 流事件不是有效 JSON",
                false,
            )
        })?;
        if chunk.error.is_some() {
            return Err(provider_error(
                "PROVIDER_STREAM_REJECTED",
                "Provider 在流中返回了错误",
                false,
            ));
        }
        if let Some(choice) = chunk.choices.first() {
            if let Some(content) = choice
                .delta
                .content
                .as_deref()
                .filter(|content| !content.is_empty())
            {
                output.push(StreamChunk::Delta(content.to_string()));
            }
            if choice.finish_reason.is_some() {
                output.push(StreamChunk::Done);
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChatChoice>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ChatChoice {
    #[serde(default)]
    delta: ChatDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct ChatDelta {
    #[serde(default)]
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        api_url, request_body, status_error, stream_chat, stream_chat_with_timeouts, SseDecoder,
        StreamChunk, TransportTimeouts,
    };
    use crate::ai::{default_providers, ProviderMessage};
    use crate::error::AppError;
    use reqwest::StatusCode;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn ignore_delta(_: &str) -> Result<(), AppError> {
        Ok(())
    }

    #[test]
    fn builds_chat_and_models_urls_from_base_or_full_endpoint() {
        assert_eq!(
            api_url("https://api.example.com/v1", "chat/completions")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            api_url("https://api.example.com/v1/chat/completions", "models")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn decodes_fragmented_crlf_sse_without_corrupting_utf8() {
        let mut decoder = SseDecoder::default();
        let payload =
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
        let bytes = payload.as_bytes();
        let split = payload.find('好').unwrap() + 1;
        let mut events = decoder.push(&bytes[..split]).unwrap();
        events.extend(decoder.push(&bytes[split..]).unwrap());
        assert_eq!(
            events,
            vec![StreamChunk::Delta("你好".into()), StreamChunk::Done]
        );
    }

    #[test]
    fn all_provider_kinds_use_the_reviewed_chat_completion_contract() {
        let messages = vec![ProviderMessage {
            role: "user".into(),
            content: "hello".into(),
        }];
        for config in default_providers() {
            let body = request_body(&config, &messages);
            assert_eq!(body["model"], config.model);
            assert_eq!(body["stream"], true);
            assert_eq!(body["messages"][0]["content"], "hello");
            let token_field = if config.kind == crate::ai::ProviderKind::OpenAi {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            assert_eq!(body[token_field], 4096);
            assert!(api_url(&config.endpoint, "chat/completions").is_ok());
        }
    }

    #[test]
    fn maps_provider_statuses_to_stable_actionable_codes() {
        let authentication = status_error(StatusCode::UNAUTHORIZED, None);
        assert_eq!(authentication.code(), "PROVIDER_AUTHENTICATION_FAILED");
        assert!(!authentication.retryable());

        let rate_limited = status_error(StatusCode::TOO_MANY_REQUESTS, Some(9));
        assert_eq!(rate_limited.code(), "PROVIDER_RATE_LIMITED");
        assert!(rate_limited.retryable());
        assert_eq!(rate_limited.http_status(), Some(429));
        assert_eq!(rate_limited.retry_after_seconds(), Some(9));

        let unavailable = status_error(StatusCode::SERVICE_UNAVAILABLE, None);
        assert_eq!(unavailable.code(), "PROVIDER_UNAVAILABLE");
        assert!(unavailable.retryable());
    }

    #[tokio::test]
    async fn cancels_while_waiting_for_provider_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = socket.read(&mut request);
            std::thread::sleep(Duration::from_millis(300));
        });
        let mut config = default_providers().remove(3);
        config.endpoint = format!("http://{address}/v1");
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            trigger.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = stream_chat(
            &config,
            "dummy-credential",
            &[ProviderMessage {
                role: "user".into(),
                content: "hello".into(),
            }],
            cancelled,
            |_| Ok(()),
        )
        .await;
        assert!(matches!(result, Err(AppError::RequestCancelled)));
        assert!(started.elapsed() < Duration::from_millis(500));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn reports_stream_idle_timeout_separately_from_network_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = socket.read(&mut request);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
                )
                .unwrap();
            std::thread::sleep(Duration::from_millis(250));
        });
        let mut config = default_providers().remove(3);
        config.endpoint = format!("http://{address}/v1");
        let mut on_delta = ignore_delta;
        let result = stream_chat_with_timeouts(
            &config,
            "dummy-credential",
            &[ProviderMessage {
                role: "user".into(),
                content: "hello".into(),
            }],
            Arc::new(AtomicBool::new(false)),
            &mut on_delta,
            TransportTimeouts {
                response_headers: Duration::from_secs(1),
                stream_idle: Duration::from_millis(50),
                stream_total: Duration::from_secs(1),
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code(), "PROVIDER_STREAM_IDLE_TIMEOUT");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn cancels_a_stalled_provider_stream_within_five_hundred_ms() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = socket.read(&mut request);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
                )
                .unwrap();
            std::thread::sleep(Duration::from_secs(1));
        });
        let mut config = default_providers().remove(3);
        config.endpoint = format!("http://{address}/v1");
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            trigger.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = stream_chat(
            &config,
            "dummy-credential",
            &[ProviderMessage {
                role: "user".into(),
                content: "hello".into(),
            }],
            cancelled,
            |_| Ok(()),
        )
        .await;
        assert!(matches!(result, Err(AppError::RequestCancelled)));
        assert!(started.elapsed() < Duration::from_millis(500));
        server.join().unwrap();
    }
}
