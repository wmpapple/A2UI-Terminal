use super::document::{DocumentSnapshot, DocumentTarget, SelectionSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CriticOptions {
    pub sentence_limit: usize,
    pub paragraph_limit: usize,
}
impl Default for CriticOptions {
    fn default() -> Self {
        Self {
            sentence_limit: 120,
            paragraph_limit: 400,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub kind: String,
    pub severity: String,
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub quote: String,
    pub message: String,
    pub evidence: Option<String>,
    pub ignored: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticReport {
    pub id: String,
    pub engine: String,
    pub engine_version: String,
    pub binding: DocumentSnapshot,
    pub signature: String,
    pub profile_hash: String,
    pub options: CriticOptions,
    pub findings: Vec<Finding>,
    pub truncated: bool,
    pub created_at: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectCriticInput {
    pub target: DocumentTarget,
    pub options: CriticOptions,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticView {
    pub local: CriticReport,
    pub llm: Option<CriticReport>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticSelection {
    pub selection: SelectionSnapshot,
    pub instruction: String,
}
