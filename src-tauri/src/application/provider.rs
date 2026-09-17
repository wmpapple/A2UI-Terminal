use crate::ai::{self, ProviderConfig, ProviderConfigView};
use crate::error::AppError;
use crate::repository::provider::ProviderRepository;
use crate::security::{validate_provider_id, SecretStore};
use crate::storage::Storage;
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

const LOCAL_PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(350);
const LOCAL_PROBE_TOTAL_TIMEOUT: Duration = Duration::from_millis(1_500);
const MAX_LOCAL_PROBE_BODY_BYTES: usize = 256 * 1024;
const MAX_DISCOVERED_MODELS: usize = 100;
const MAX_MODEL_ID_CHARACTERS: usize = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    provider_id: String,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionResult {
    provider_id: String,
    reachable: bool,
    latency_ms: u128,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingLocationView {
    Local,
    Cloud,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingAvailability {
    Ready,
    SetupRequired,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalProviderKind {
    Ollama,
    LmStudio,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalProbeStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderProbe {
    pub id: String,
    pub kind: LocalProviderKind,
    pub status: LocalProbeStatus,
    pub endpoint: String,
    pub models: Vec<String>,
    pub latency_ms: Option<u128>,
    pub failure_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingOptions {
    pub active_provider_id: String,
    pub processing_location: ProcessingLocationView,
    pub availability: ProcessingAvailability,
    pub local_provider_available: bool,
    pub available_local_providers: usize,
    pub probe_completed: bool,
}

#[derive(Debug, Clone)]
struct LocalProbeCandidate {
    id: String,
    kind: LocalProviderKind,
    endpoint: String,
}

pub fn set_secret(
    storage: &Storage,
    provider_id: &str,
    secret: String,
) -> Result<SecretStatus, AppError> {
    let secret = Zeroizing::new(secret);
    let provider_id = validate_provider_id(provider_id)?;
    let repository = ProviderRepository::new(storage);
    let previous = SecretStore::get_optional(&provider_id)?;
    SecretStore::set(&provider_id, secret.as_str())?;
    if let Err(error) = repository.remember_secret_owner(&provider_id) {
        if let Some(previous) = previous {
            let _ = SecretStore::set(&provider_id, previous.as_str());
        } else {
            let _ = SecretStore::delete(&provider_id);
        }
        return Err(error);
    }
    Ok(SecretStatus {
        provider_id,
        configured: true,
    })
}

pub fn secret_status(provider_id: &str) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    Ok(SecretStatus {
        configured: SecretStore::exists(&provider_id)?,
        provider_id,
    })
}

pub fn delete_secret(storage: &Storage, provider_id: &str) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    SecretStore::delete(&provider_id)?;
    ProviderRepository::new(storage).forget_secret_owner(&provider_id)?;
    Ok(SecretStatus {
        provider_id,
        configured: false,
    })
}

pub fn list_configs(storage: &Storage) -> Result<Vec<ProviderConfigView>, AppError> {
    let repository = ProviderRepository::new(storage);
    let active_id = repository.active_id()?;
    repository
        .list()?
        .into_iter()
        .map(|config| {
            Ok(ProviderConfigView {
                configured: SecretStore::exists(&config.id)?,
                active: config.id == active_id,
                config,
            })
        })
        .collect()
}

pub fn save_config(
    storage: &Storage,
    config: ProviderConfig,
    secret: Option<String>,
) -> Result<ProviderConfigView, AppError> {
    let repository = ProviderRepository::new(storage);
    let secret = secret.map(Zeroizing::new);
    config.validate()?;
    let previous_config = repository
        .find(&config.id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if previous_config.kind != config.kind {
        return Err(AppError::InvalidInput(
            "不能修改已有 Provider 的适配器类型".into(),
        ));
    }
    let secret = secret.filter(|value| !value.trim().is_empty());
    let previous_secret = if secret.is_some() {
        SecretStore::get_optional(&config.id)?
    } else {
        None
    };
    repository.save(&config)?;
    if let Some(secret) = secret {
        if let Err(error) = SecretStore::set(&config.id, secret.as_str()) {
            let _ = repository.save(&previous_config);
            return Err(error);
        }
        if let Err(error) = repository.remember_secret_owner(&config.id) {
            if let Some(previous_secret) = previous_secret {
                let _ = SecretStore::set(&config.id, previous_secret.as_str());
            } else {
                let _ = SecretStore::delete(&config.id);
            }
            let _ = repository.save(&previous_config);
            return Err(error);
        }
    }
    Ok(ProviderConfigView {
        configured: SecretStore::exists(&config.id)?,
        active: repository.active_id()? == config.id,
        config,
    })
}

pub fn set_active(storage: &Storage, provider_id: &str) -> Result<(), AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    ProviderRepository::new(storage).set_active(&provider_id)
}

pub async fn test_connection(
    storage: &Storage,
    provider_id: &str,
) -> Result<ProviderConnectionResult, AppError> {
    let provider_id = validate_provider_id(provider_id)?;
    let config = ProviderRepository::new(storage)
        .find(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput("请先保存 API Key".into()));
    }
    let api_key = SecretStore::get(&provider_id)?;
    let latency_ms = ai::test_connection(&config, &api_key).await?;
    Ok(ProviderConnectionResult {
        provider_id,
        reachable: true,
        latency_ms,
    })
}

pub async fn get_processing_options(storage: &Storage) -> Result<ProcessingOptions, AppError> {
    let configs = list_configs(storage)?;
    let active = configs
        .iter()
        .find(|config| config.active)
        .or_else(|| configs.first())
        .ok_or_else(|| AppError::InvalidInput("没有可用的 Provider 配置".into()))?;
    let active_endpoint = normalized_loopback_endpoint(&active.config.endpoint);
    let probes = probe_local_providers(storage).await?;
    let available_local_providers = probes
        .iter()
        .filter(|probe| probe.status == LocalProbeStatus::Available)
        .count();
    let active_local_available = active_endpoint.as_ref().is_some_and(|endpoint| {
        probes.iter().any(|probe| {
            probe.status == LocalProbeStatus::Available
                && normalized_loopback_endpoint(&probe.endpoint).as_ref() == Some(endpoint)
        })
    });
    let processing_location = if active_endpoint.is_some() {
        ProcessingLocationView::Local
    } else {
        ProcessingLocationView::Cloud
    };
    let availability = match processing_location {
        ProcessingLocationView::Local if active_local_available && active.configured => {
            ProcessingAvailability::Ready
        }
        ProcessingLocationView::Local if active_local_available => {
            ProcessingAvailability::SetupRequired
        }
        ProcessingLocationView::Local => ProcessingAvailability::Unavailable,
        ProcessingLocationView::Cloud if active.configured => ProcessingAvailability::Ready,
        ProcessingLocationView::Cloud => ProcessingAvailability::SetupRequired,
    };
    Ok(ProcessingOptions {
        active_provider_id: active.config.id.clone(),
        processing_location,
        availability,
        local_provider_available: available_local_providers > 0,
        available_local_providers,
        probe_completed: true,
    })
}

pub async fn probe_local_providers(storage: &Storage) -> Result<Vec<LocalProviderProbe>, AppError> {
    let candidates = local_probe_candidates(storage)?;
    let probes = futures_util::future::join_all(candidates.into_iter().map(probe_candidate)).await;
    Ok(probes)
}

fn local_probe_candidates(storage: &Storage) -> Result<Vec<LocalProbeCandidate>, AppError> {
    let mut candidates = vec![
        LocalProbeCandidate {
            id: "ollama".into(),
            kind: LocalProviderKind::Ollama,
            endpoint: "http://127.0.0.1:11434/v1".into(),
        },
        LocalProbeCandidate {
            id: "lm_studio".into(),
            kind: LocalProviderKind::LmStudio,
            endpoint: "http://127.0.0.1:1234/v1".into(),
        },
    ];
    let mut endpoints = candidates
        .iter()
        .map(|candidate| candidate.endpoint.clone())
        .collect::<BTreeSet<_>>();
    for config in ProviderRepository::new(storage).list()? {
        if config.kind != crate::ai::ProviderKind::Custom {
            continue;
        }
        let Some(endpoint) = normalized_loopback_endpoint(&config.endpoint) else {
            continue;
        };
        if endpoints.insert(endpoint.clone()) {
            candidates.push(LocalProbeCandidate {
                id: config.id,
                kind: LocalProviderKind::Custom,
                endpoint,
            });
        }
    }
    Ok(candidates)
}

async fn probe_candidate(candidate: LocalProbeCandidate) -> LocalProviderProbe {
    let started = Instant::now();
    let result = probe_models(&candidate.endpoint).await;
    match result {
        Ok(models) => LocalProviderProbe {
            id: candidate.id,
            kind: candidate.kind,
            status: LocalProbeStatus::Available,
            endpoint: candidate.endpoint,
            models,
            latency_ms: Some(started.elapsed().as_millis()),
            failure_code: None,
        },
        Err(failure_code) => LocalProviderProbe {
            id: candidate.id,
            kind: candidate.kind,
            status: LocalProbeStatus::Unavailable,
            endpoint: candidate.endpoint,
            models: Vec::new(),
            latency_ms: None,
            failure_code: Some(failure_code.into()),
        },
    }
}

async fn probe_models(endpoint: &str) -> Result<Vec<String>, &'static str> {
    let endpoint = normalized_loopback_endpoint(endpoint).ok_or("non_loopback_endpoint")?;
    let models_url = Url::parse(&format!("{endpoint}/models")).map_err(|_| "invalid_endpoint")?;
    let client = Client::builder()
        .connect_timeout(LOCAL_PROBE_CONNECT_TIMEOUT)
        .timeout(LOCAL_PROBE_TOTAL_TIMEOUT)
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| "client_error")?;
    let response = client
        .get(models_url)
        .send()
        .await
        .map_err(|_| "not_running")?;
    if !response.status().is_success() {
        return Err(if matches!(response.status().as_u16(), 401 | 403) {
            "authentication_required"
        } else {
            "http_error"
        });
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_LOCAL_PROBE_BODY_BYTES as u64)
    {
        return Err("response_too_large");
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "invalid_response")?;
        if bytes.len().saturating_add(chunk.len()) > MAX_LOCAL_PROBE_BODY_BYTES {
            return Err("response_too_large");
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_model_ids(&bytes)
}

fn parse_model_ids(bytes: &[u8]) -> Result<Vec<String>, &'static str> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| "invalid_response")?;
    let entries = value
        .get("data")
        .or_else(|| value.get("models"))
        .and_then(serde_json::Value::as_array)
        .ok_or("incompatible_response")?;
    let mut models = BTreeSet::new();
    for entry in entries.iter().take(MAX_DISCOVERED_MODELS) {
        let model = entry
            .get("id")
            .or_else(|| entry.get("name"))
            .or_else(|| entry.get("model"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= MAX_MODEL_ID_CHARACTERS);
        if let Some(model) = model {
            models.insert(model.to_string());
        }
    }
    Ok(models.into_iter().collect())
}

fn normalized_loopback_endpoint(value: &str) -> Option<String> {
    let mut url = Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
        )
    {
        return None;
    }
    if url.host_str() == Some("localhost") {
        url.set_host(Some("127.0.0.1")).ok()?;
    }
    let mut path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/models"] {
        if path.ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
        }
    }
    if path.is_empty() {
        path = "/v1".into();
    }
    url.set_path(path.trim_end_matches('/'));
    Some(url.to_string().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        local_probe_candidates, normalized_loopback_endpoint, probe_candidate, LocalProbeCandidate,
        LocalProbeStatus, LocalProviderKind,
    };
    use crate::ai::{ProviderConfig, ProviderKind};
    use crate::repository::provider::ProviderRepository;
    use crate::storage::Storage;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn accepts_only_explicit_loopback_endpoints() {
        assert_eq!(
            normalized_loopback_endpoint("http://localhost:11434"),
            Some("http://127.0.0.1:11434/v1".into())
        );
        assert_eq!(
            normalized_loopback_endpoint("http://127.0.0.1:1234/v1/models"),
            Some("http://127.0.0.1:1234/v1".into())
        );
        assert_eq!(
            normalized_loopback_endpoint("http://[::1]:1234/v1"),
            Some("http://[::1]:1234/v1".into())
        );
        for rejected in [
            "http://192.168.1.10:11434/v1",
            "http://0.0.0.0:11434/v1",
            "http://localhost.evil.example/v1",
            "http://user:secret@localhost:11434/v1",
            "file:///models",
        ] {
            assert_eq!(normalized_loopback_endpoint(rejected), None, "{rejected}");
        }
    }

    #[test]
    fn candidates_are_fixed_or_explicitly_configured_loopback_only() {
        let storage = Storage::open_in_memory().unwrap();
        ProviderRepository::new(&storage)
            .save(&ProviderConfig {
                id: "custom".into(),
                kind: ProviderKind::Custom,
                endpoint: "http://localhost:7777/v1".into(),
                model: "local-model".into(),
                temperature: 0.2,
                proxy_url: None,
            })
            .unwrap();
        let candidates = local_probe_candidates(&storage).unwrap();
        assert_eq!(candidates.len(), 3);
        assert!(candidates
            .iter()
            .any(|candidate| candidate.endpoint == "http://127.0.0.1:11434/v1"));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.endpoint == "http://127.0.0.1:1234/v1"));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.endpoint == "http://127.0.0.1:7777/v1"));
    }

    #[tokio::test]
    async fn probe_reads_only_bounded_model_metadata() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let count = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            assert!(request.starts_with("GET /v1/models "));
            let body = r#"{"data":[{"id":"qwen-local"},{"id":"another-model"}]}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let probe = probe_candidate(LocalProbeCandidate {
            id: "test".into(),
            kind: LocalProviderKind::Custom,
            endpoint: format!("http://{address}/v1"),
        })
        .await;
        server.await.unwrap();
        assert_eq!(probe.status, LocalProbeStatus::Available);
        assert_eq!(probe.models, vec!["another-model", "qwen-local"]);
        assert!(probe.latency_ms.is_some());
        assert_eq!(probe.failure_code, None);
    }
}
