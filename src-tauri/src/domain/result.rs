use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultType {
    Document,
    Spreadsheet,
    Checklist,
    Form,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Draft,
    Generating,
    ReviewPending,
    Ready,
    Exporting,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStorageKind {
    WorkspaceFile,
    StandaloneFile,
    ManagedLocal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResultSummary {
    pub id: String,
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub result_type: ResultType,
    pub title: String,
    pub status: ResultStatus,
    pub storage_kind: ResultStorageKind,
    pub current_revision_id: Option<String>,
    pub a2ui_surface_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResultDetail {
    #[serde(flatten)]
    pub summary: ResultSummary,
    pub storage_ref: String,
    pub active_session_id: Option<String>,
    pub managed_state: Option<serde_json::Value>,
}

impl ResultStatus {
    pub fn can_transition_to(self, next: Self) -> bool {
        use ResultStatus::{Archived, Draft, Exporting, Failed, Generating, Ready, ReviewPending};
        self == next
            || matches!(
                (self, next),
                (Draft, Generating | Ready | Failed | Archived)
                    | (Generating, ReviewPending | Ready | Failed | Archived)
                    | (ReviewPending, Generating | Ready | Failed | Archived)
                    | (
                        Ready,
                        Generating | ReviewPending | Exporting | Failed | Archived
                    )
                    | (Exporting, Ready | Failed | Archived)
                    | (Failed, Draft | Generating | Ready | Archived)
                    | (Archived, Draft | Ready)
            )
    }
}

pub fn validate_title(title: &str) -> Result<&str, AppError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 160 {
        return Err(AppError::InvalidInput(
            "成果标题不能为空且不能超过 160 个字符".into(),
        ));
    }
    Ok(title)
}

#[cfg(test)]
mod tests {
    use super::{validate_title, ResultStatus};

    #[test]
    fn result_status_machine_allows_recovery_but_rejects_invalid_shortcuts() {
        assert!(ResultStatus::Draft.can_transition_to(ResultStatus::Generating));
        assert!(ResultStatus::Failed.can_transition_to(ResultStatus::Draft));
        assert!(ResultStatus::Archived.can_transition_to(ResultStatus::Ready));
        assert!(!ResultStatus::Draft.can_transition_to(ResultStatus::Exporting));
        assert!(!ResultStatus::Exporting.can_transition_to(ResultStatus::Generating));
    }

    #[test]
    fn result_titles_are_bounded() {
        assert_eq!(validate_title("  会议纪要  ").unwrap(), "会议纪要");
        assert!(validate_title("").is_err());
        assert!(validate_title(&"x".repeat(161)).is_err());
    }
}
