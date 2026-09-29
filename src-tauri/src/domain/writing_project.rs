use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectConfig {
    pub title: String,
    pub goal: String,
    pub audience: String,
    pub facts: String,
    pub terminology: String,
    pub knowledge_ids: Vec<String>,
    pub document_source_ids: Vec<String>,
    pub context_pack_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutlineSection {
    pub id: Option<String>,
    pub title: String,
    pub objective: String,
    pub target_words: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSection {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub target_words: usize,
    pub content: String,
    pub summary: String,
    pub accepted: bool,
    pub run_id: Option<String>,
    pub request_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProject {
    pub id: String,
    pub workspace_id: String,
    pub revision: i64,
    pub config: ProjectConfig,
    pub outline_confirmed: bool,
    pub sections: Vec<WritingSection>,
    pub final_review_id: Option<String>,
    pub result_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingRun {
    pub draft: Option<WritingDraft>,
    pub id: String,
    pub project_id: String,
    pub section_id: Option<String>,
    pub project_revision: i64,
    pub request_id: String,
    pub status: String,
    pub content: String,
    pub error: Option<String>,
    pub snapshot: serde_json::Value,
    pub created_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WritingDraft {
    pub content: String,
    pub summary: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub project: WritingProject,
    pub runs: Vec<WritingRun>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProjectInput {
    pub id: Option<String>,
    pub workspace_id: String,
    pub revision: Option<i64>,
    pub config: ProjectConfig,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveOutlineInput {
    pub project_id: String,
    pub revision: i64,
    pub sections: Vec<OutlineSection>,
    pub confirmed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanWritingInput {
    pub project_id: String,
    pub revision: i64,
    pub section_id: Option<String>,
    pub provider_id: String,
    pub instruction: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptSectionInput {
    pub project_id: String,
    pub revision: i64,
    pub section_id: String,
    pub run_id: String,
    pub content: String,
    pub summary: String,
}
