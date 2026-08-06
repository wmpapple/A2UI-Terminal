use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    SiliconFlow,
    DeepSeek,
    OpenAi,
    Custom,
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

impl ProviderConfig {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.endpoint.trim().is_empty() || self.model.trim().is_empty() {
            return Err(AppError::InvalidInput("Endpoint 和 Model 不能为空".into()));
        }
        if !(0.0..=2.0).contains(&self.temperature) {
            return Err(AppError::InvalidInput(
                "Temperature 必须在 0 到 2 之间".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ProviderConfig, ProviderKind};

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
}
