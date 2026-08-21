mod client;
mod context;
mod planner;
mod retrieval;

pub use client::{stream_chat, test_connection, StreamChunk};
pub use context::{
    build_context_prompt, confirm_context_manifest, consume_context_manifest,
    plan_context_manifest, ConfirmContextManifestInput, ConfirmedContextManifest, ContextCandidate,
    ContextChunkRange, ContextIndexMode, ContextManifest, ContextManifestInput,
    ContextManifestSource, ContextManifestStatus, ContextSourceMode, ContextStrategy,
    PendingContextManifest, ProcessingLocation,
};
pub use retrieval::ContextIndex;

use crate::error::AppError;
use crate::security::validate_provider_id;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    SiliconFlow,
    DeepSeek,
    OpenAi,
    Custom,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SiliconFlow => "silicon_flow",
            Self::DeepSeek => "deep_seek",
            Self::OpenAi => "open_ai",
            Self::Custom => "custom",
        }
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "silicon_flow" => Ok(Self::SiliconFlow),
            "deep_seek" => Ok(Self::DeepSeek),
            "open_ai" => Ok(Self::OpenAi),
            "custom" => Ok(Self::Custom),
            _ => Err(AppError::InvalidInput("未知 Provider 类型".into())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub endpoint: String,
    pub model: String,
    pub temperature: f64,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigView {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub configured: bool,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub provider_id: String,
    pub prompt: String,
    pub context_manifest_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSource {
    pub kind: ContextSourceKind,
    pub label: String,
    pub content: String,
    pub base_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceKind {
    Selection,
    CurrentFile,
    ProjectFile,
    AttachedDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessage {
    pub role: String,
    pub content: String,
}

impl ProviderConfig {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_provider_id(&self.id)?;
        if self.model.trim().is_empty() || self.model.len() > 256 {
            return Err(AppError::InvalidInput(
                "Model 不能为空且不能超过 256 个字符".into(),
            ));
        }
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err(AppError::InvalidInput(
                "Temperature 必须在 0 到 2 之间".into(),
            ));
        }
        client::validate_endpoint(&self.endpoint)?;
        if let Some(proxy_url) = self
            .proxy_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            client::validate_proxy(proxy_url)?;
        }
        Ok(())
    }
}

pub fn default_providers() -> Vec<ProviderConfig> {
    vec![
        ProviderConfig {
            id: "siliconflow".into(),
            kind: ProviderKind::SiliconFlow,
            endpoint: "https://api.siliconflow.cn/v1".into(),
            model: "Qwen/Qwen3.5-35B-A3B".into(),
            temperature: 0.2,
            proxy_url: None,
        },
        ProviderConfig {
            id: "deepseek".into(),
            kind: ProviderKind::DeepSeek,
            endpoint: "https://api.deepseek.com".into(),
            model: "deepseek-v4-flash".into(),
            temperature: 0.2,
            proxy_url: None,
        },
        ProviderConfig {
            id: "openai".into(),
            kind: ProviderKind::OpenAi,
            endpoint: "https://api.openai.com/v1".into(),
            model: "gpt-5.6".into(),
            temperature: 0.2,
            proxy_url: None,
        },
        ProviderConfig {
            id: "custom".into(),
            kind: ProviderKind::Custom,
            endpoint: "https://example.com/v1".into(),
            model: "your-model".into(),
            temperature: 0.2,
            proxy_url: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::{default_providers, ProviderConfig, ProviderKind};

    #[test]
    fn rejects_out_of_range_temperature() {
        let config = ProviderConfig {
            id: "openai".into(),
            kind: ProviderKind::OpenAi,
            endpoint: "https://api.openai.com/v1".into(),
            model: "configured-by-user".into(),
            temperature: 2.1,
            proxy_url: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn all_built_in_adapters_have_valid_defaults() {
        let providers = default_providers();
        assert_eq!(providers.len(), 4);
        assert!(providers.iter().all(|config| config.validate().is_ok()));
    }
}
