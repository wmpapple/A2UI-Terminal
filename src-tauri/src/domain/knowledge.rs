use crate::parser::ParsedDocument;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSource {
    pub id: String,
    pub title: String,
    pub format: String,
    pub original_name: String,
    pub raw_hash: String,
    pub extracted_hash: String,
    pub parser_version: String,
    pub source_version: i64,
    pub tags: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocument {
    pub source: KnowledgeSource,
    pub parsed: ParsedDocument,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListKnowledgeInput {
    pub query: Option<String>,
    pub after: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePage {
    pub items: Vec<KnowledgeSource>,
    pub next_cursor: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditKnowledgeInput {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
}
