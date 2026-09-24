use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WritingProfileScope {
    Global,
    Workspace,
}

impl WritingProfileScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Workspace => "workspace",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminologyRule {
    pub term: String,
    pub preferred: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritingProfile {
    pub id: String,
    pub scope: WritingProfileScope,
    pub workspace_id: Option<String>,
    pub enabled: bool,
    pub version: u32,
    pub rules: String,
    pub terminology: Vec<TerminologyRule>,
    pub forbidden_words: Vec<String>,
    pub example_knowledge_ids: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveWritingProfileInput {
    pub scope: WritingProfileScope,
    pub workspace_id: Option<String>,
    pub enabled: bool,
    pub rules: String,
    pub terminology: Vec<TerminologyRule>,
    pub forbidden_words: Vec<String>,
    pub example_knowledge_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteWritingProfileInput {
    pub scope: WritingProfileScope,
    pub workspace_id: Option<String>,
}
