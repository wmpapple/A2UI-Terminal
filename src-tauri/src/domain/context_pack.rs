use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackItem {
    #[serde(default, skip_serializing_if = "is_false")]
    pub personal_knowledge: bool,
    pub source_id: String,
    pub label: String,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub items: Vec<ContextPackItem>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateContextPackInput {
    pub workspace_id: String,
    pub name: String,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteContextPackOutput {
    pub deleted: bool,
    pub original_files_deleted: bool,
}
