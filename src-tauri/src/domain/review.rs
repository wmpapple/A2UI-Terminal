use super::result::{ResultDocument, TextResultFormat};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSource {
    Chat,
    Selection,
    Template,
    A2uiAction,
    ImportTransform,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOperationKind {
    DocumentPatch,
    CreateFile,
    ReplaceResult,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    Pending,
    PartiallyAccepted,
    Accepted,
    Rejected,
    Applied,
    Conflicted,
    Failed,
    Undone,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewBlockStatus {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBlock {
    pub id: String,
    pub kind: ReviewOperationKind,
    pub status: ReviewBlockStatus,
    pub target_label: String,
    pub operation: Option<String>,
    pub before: String,
    pub after: String,
    pub reason: String,
    pub risk: ReviewRisk,
    pub suggested_file_name: Option<String>,
    pub decided_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    pub id: String,
    pub workspace_id: String,
    pub result_id: Option<String>,
    pub source: ReviewSource,
    pub operation_kind: ReviewOperationKind,
    pub status: ReviewStatus,
    pub summary: String,
    pub risk: ReviewRisk,
    pub base_revision_id: Option<String>,
    pub base_hash: Option<String>,
    pub blocks: Vec<ReviewBlock>,
    pub application_operation_id: Option<String>,
    pub output_result_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateReviewRequestInput {
    pub workspace_id: String,
    pub source: ReviewSource,
    pub result_id: Option<String>,
    pub raw: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewBlockDecision {
    pub block_id: String,
    pub accepted: bool,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecideReviewBlocksInput {
    pub review_id: String,
    pub workspace_id: String,
    pub decisions: Vec<ReviewBlockDecision>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyReviewInput {
    pub review_id: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewConflictResolution {
    Regenerate,
    SaveCopy,
    KeepCurrent,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveReviewConflictInput {
    pub review_id: String,
    pub workspace_id: String,
    pub resolution: ReviewConflictResolution,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAppliedFile {
    pub path: String,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewApplication {
    pub review_id: String,
    pub status: ReviewStatus,
    pub operation_id: Option<String>,
    pub files: Vec<ReviewAppliedFile>,
    pub result: Option<ResultDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateFileProposal {
    pub version: String,
    #[serde(rename = "type")]
    pub proposal_type: String,
    pub workspace_id: String,
    pub summary: String,
    pub title: String,
    pub file_name: String,
    pub format: TextResultFormat,
    pub content: String,
    pub reason: String,
    pub risk: ReviewRisk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceEmptyFileProposal {
    pub version: String,
    #[serde(rename = "type")]
    pub proposal_type: String,
    pub workspace_id: String,
    pub summary: String,
    pub path: String,
    pub content: String,
    pub reason: String,
    pub risk: ReviewRisk,
}
