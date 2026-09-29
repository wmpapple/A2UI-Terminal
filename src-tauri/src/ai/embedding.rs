use crate::{ai::ProviderConfig, error::AppError};
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

pub type EmbeddingFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<Vec<f32>>, AppError>> + Send + 'a>>;

pub trait EmbeddingProvider: Send + Sync {
    fn embed<'a>(
        &'a self,
        config: &'a ProviderConfig,
        input: &'a [String],
        dimensions: usize,
        cancelled: Arc<AtomicBool>,
    ) -> EmbeddingFuture<'a>;
}

pub struct HttpEmbeddingProvider {
    pub key_source: fn(&ProviderConfig) -> Result<zeroize::Zeroizing<String>, AppError>,
}
impl Default for HttpEmbeddingProvider {
    fn default() -> Self {
        Self {
            key_source: crate::application::provider::request_key,
        }
    }
}

impl EmbeddingProvider for HttpEmbeddingProvider {
    fn embed<'a>(
        &'a self,
        config: &'a ProviderConfig,
        input: &'a [String],
        dimensions: usize,
        cancelled: Arc<AtomicBool>,
    ) -> EmbeddingFuture<'a> {
        Box::pin(async move {
            if cancelled.load(Ordering::Acquire) {
                return Err(AppError::RequestCancelled);
            }
            config.validate()?;
            if input.is_empty() || input.len() > 8 || !(1..=4096).contains(&dimensions) {
                return Err(AppError::InvalidInput("向量请求参数无效".into()));
            }
            let mut endpoint = config.endpoint.trim().trim_end_matches('/').to_owned();
            for suffix in ["/embeddings", "/chat/completions", "/models"] {
                if endpoint.ends_with(suffix) {
                    endpoint.truncate(endpoint.len() - suffix.len());
                }
            }
            let url = Url::parse(&format!("{endpoint}/embeddings"))
                .map_err(|_| AppError::InvalidInput("向量服务地址无效".into()))?;
            let local =
                crate::application::provider::normalized_loopback_endpoint(&endpoint).is_some();
            let mut builder = Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .redirect(Policy::none());
            if local {
                builder = builder.no_proxy();
            } else if let Some(proxy) = &config.proxy_url {
                builder = builder.proxy(
                    reqwest::Proxy::all(proxy)
                        .map_err(|_| AppError::InvalidInput("代理配置无效".into()))?,
                );
            }
            let client = builder
                .build()
                .map_err(|_| AppError::InvalidInput("无法连接向量服务".into()))?;
            let key = (self.key_source)(config)?;
            let mut request = client.post(url).json(
                &serde_json::json!({"model":config.model,"input":input,"encoding_format":"float"}),
            );
            if !key.is_empty() {
                request = request.bearer_auth(key.as_str());
            }
            let work = async {
                let response = request
                    .send()
                    .await
                    .map_err(|_| AppError::InvalidInput("向量服务连接失败".into()))?;
                if !response.status().is_success() {
                    return Err(AppError::InvalidInput(format!(
                        "向量服务返回 HTTP {}",
                        response.status().as_u16()
                    )));
                }
                let mut bytes = Vec::new();
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|_| AppError::InvalidInput("向量响应中断".into()))?;
                    if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                        return Err(AppError::InvalidInput("向量响应超过大小限制".into()));
                    }
                    bytes.extend_from_slice(&chunk);
                }
                #[derive(Deserialize)]
                struct Item {
                    index: usize,
                    embedding: Vec<f32>,
                }
                #[derive(Deserialize)]
                struct Response {
                    data: Vec<Item>,
                }
                let mut response: Response = serde_json::from_slice(&bytes)
                    .map_err(|_| AppError::InvalidInput("向量响应格式无效".into()))?;
                response.data.sort_by_key(|item| item.index);
                if response.data.len() != input.len()
                    || response.data.iter().enumerate().any(|(i, v)| i != v.index)
                {
                    return Err(AppError::InvalidInput("向量响应数量或序号不匹配".into()));
                }
                response
                    .data
                    .into_iter()
                    .map(|item| normalize(item.embedding, dimensions))
                    .collect()
            };
            tokio::select! {
                _ = async { loop { if cancelled.load(Ordering::Acquire) { break; } tokio::time::sleep(Duration::from_millis(25)).await; } } => Err(AppError::RequestCancelled),
                result = tokio::time::timeout(Duration::from_secs(30),work) => result.map_err(|_|AppError::InvalidInput("向量服务响应超时".into()))?,
            }
        })
    }
}

pub fn normalize(mut vector: Vec<f32>, dimensions: usize) -> Result<Vec<f32>, AppError> {
    if vector.len() != dimensions || vector.iter().any(|v| !v.is_finite()) {
        return Err(AppError::InvalidInput("向量维度不符或含无效数值".into()));
    }
    let norm = vector
        .iter()
        .map(|v| f64::from(*v).powi(2))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm < 1e-12 {
        return Err(AppError::InvalidInput("向量服务返回零向量".into()));
    }
    for value in &mut vector {
        *value = (f64::from(*value) / norm) as f32;
    }
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn invalid_vectors_cannot_enter_the_cache() {
        for vector in [
            vec![0.0, 0.0],
            vec![f32::NAN, 1.0],
            vec![f32::INFINITY, 1.0],
            vec![1.0],
        ] {
            assert!(normalize(vector, 2).is_err());
        }
        assert_eq!(normalize(vec![3.0, 4.0], 2).unwrap(), vec![0.6, 0.8]);
    }

    #[tokio::test]
    async fn transport_validates_order_count_dimensions_and_refuses_redirects() {
        for (status, body, valid) in [
            (
                200,
                r#"{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}"#,
                true,
            ),
            (
                200,
                r#"{"data":[{"index":0,"embedding":[1,0]},{"index":0,"embedding":[0,1]}]}"#,
                false,
            ),
            (200, r#"{"data":[{"index":0,"embedding":[1,0,0]}]}"#, false),
            (
                200,
                r#"{"data":[{"index":0,"embedding":[0,0]},{"index":1,"embedding":[1,0]}]}"#,
                false,
            ),
            (200, "not json", false),
            (302, "{}", false),
            (429, "{}", false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let thread = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let n = stream.read(&mut buffer).unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(bytes).unwrap();
                assert!(!request.to_lowercase().contains("authorization:"));
                assert!(request.starts_with("POST /v1/embeddings"));
                let response=format!("HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nContent-Type: application/json\r\nLocation: http://127.0.0.1:9/must-not-follow\r\nConnection: close\r\n\r\n{body}",body.len());
                stream.write_all(response.as_bytes()).unwrap();
            });
            let config = ProviderConfig {
                id: "fixture".into(),
                kind: crate::ai::ProviderKind::Custom,
                endpoint,
                model: "vectors".into(),
                temperature: 0.0,
                proxy_url: Some("http://127.0.0.1:9".into()),
            };
            let adapter = HttpEmbeddingProvider {
                key_source: |_| Ok(zeroize::Zeroizing::new(String::new())),
            };
            let response = adapter
                .embed(
                    &config,
                    &["first".into(), "second".into()],
                    2,
                    Arc::new(AtomicBool::new(false)),
                )
                .await;
            assert_eq!(response.is_ok(), valid);
            if let Ok(v) = response {
                assert_eq!(v[0], vec![1.0, 0.0]);
            }
            thread.join().unwrap();
        }
    }
}
