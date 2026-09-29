use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddingConfig {
    pub provider_id: String,
    pub model: String,
    pub revision: String,
    pub dimensions: usize,
    pub location: String,
}
