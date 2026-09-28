use crate::parser::Locator;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationSource {
    pub key: String,
    pub fragment_id: String,
    pub title: String,
    pub locator: Locator,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationView {
    pub key: String,
    pub title: String,
    pub locator: Option<Locator>,
    pub status: String,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationQuery {
    pub owner_kind: String,
    pub owner_id: String,
}
