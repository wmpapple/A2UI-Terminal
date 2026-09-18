use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResultDraftSummary {
    pub result_id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryExportJob {
    pub id: String,
    pub result_id: String,
    pub revision_id: String,
    pub format: String,
    pub status: String,
    pub file_name: Option<String>,
    pub error_code: Option<String>,
    pub recovered: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub schema_version: i64,
    pub result_drafts: Vec<RecoveryResultDraftSummary>,
    pub active_review_count: u64,
    pub recovered_task_count: u64,
    pub export_jobs: Vec<RecoveryExportJob>,
}
