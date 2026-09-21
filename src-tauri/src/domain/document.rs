use crate::parser::OffsetUnit;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DocumentTarget {
    WorkspaceFile {
        workspace_id: String,
        source_id: String,
    },
    Result {
        result_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub target: DocumentTarget,
    pub revision_id: Option<String>,
    pub content_hash: String,
    pub format: String,
    pub text: String,
    pub editable: bool,
    pub has_unsaved_draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSnapshot {
    pub target: DocumentTarget,
    pub revision_id: Option<String>,
    pub content_hash: String,
    pub start: usize,
    pub end: usize,
    pub offset_unit: OffsetUnit,
    pub selected_text_hash: String,
}
