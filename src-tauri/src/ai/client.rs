use super::{ProviderConfig, ProviderKind, ProviderMessage};
use crate::error::AppError;
use futures_util::StreamExt;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamChunk {
    Delta(String),
    Done,
}

pub async fn test_connection(config: &ProviderConfig, api_key: &str) -> Result<u128, AppError> {
    config.validate()?;
    let client = build_client(config)?;
    let started = Instant::now();
    let response = client
        .get(api_url(&config.endpoint, "models")?)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(status_error(response.status()));
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
    config.validate()?;
    let client = build_client(config)?;
    let response = client
        .post(api_url(&config.endpoint, "chat/completions")?)
        .bearer_auth(api_key)
        .json(&request_body(config, messages))
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }

    let mut body = String::new();
    let mut decoder = SseDecoder::default();
    let mut stream = response.bytes_stream();
    let mut cancellation_poll = tokio::time::interval(Duration::from_millis(50));
    loop {
        tokio::select! {
            _ = cancellation_poll.tick() => {
                if cancelled.load(Ordering::Acquire) {
                    return Err(AppError::RequestCancelled);
                }
            }
            next = stream.next() => {
                let Some(chunk) = next else { break };
                let chunk = chunk.map_err(network_error)?;
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
        if let StreamChunk::Delta(delta) = item {
            body.push_str(&delta);
            on_delta(&delta)?;
        }
    }
    Ok(body)
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
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
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
        AppError::Provider("连接 Provider 超时".into())
    } else if error.is_connect() {
        AppError::Provider("无法连接 Provider，请检查 Endpoint、代理和网络".into())
    } else {
        AppError::Provider("Provider 网络响应无效".into())
    }
}

fn status_error(status: reqwest::StatusCode) -> AppError {
    let message = match status.as_u16() {
        401 | 403 => "Provider 拒绝凭据，请检查 API Key",
        404 => "Provider API 地址或 Model 不存在",
        429 => "Provider 请求过于频繁或额度不足",
        500..=599 => "Provider 服务暂时不可用",
        _ => "Provider 返回了未成功状态",
    };
    AppError::Provider(format!("{message}（HTTP {}）", status.as_u16()))
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    data_lines: Vec<String>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<StreamChunk>, AppError> {
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
        let line = std::str::from_utf8(line)
            .map_err(|_| AppError::Provider("Provider 流包含无效 UTF-8".into()))?;
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
        let chunk: ChatCompletionChunk = serde_json::from_str(&data)
            .map_err(|_| AppError::Provider("Provider 流事件不是有效 JSON".into()))?;
        if let Some(content) = chunk
            .choices
            .first()
            .and_then(|choice| choice.delta.content.as_deref())
            .filter(|content| !content.is_empty())
        {
            output.push(StreamChunk::Delta(content.to_string()));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct ChatCompletionChunk {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    delta: ChatDelta,
}

#[derive(Deserialize)]
struct ChatDelta {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{api_url, request_body, stream_chat, SseDecoder, StreamChunk};
    use crate::ai::{default_providers, ProviderMessage};
    use crate::error::AppError;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

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
