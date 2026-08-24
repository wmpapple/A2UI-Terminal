use crate::domain::review::{
    ReviewBlock, ReviewBlockStatus, ReviewOperationKind, ReviewRequest, ReviewRisk, ReviewSource,
    ReviewStatus,
};
use crate::error::AppError;
use crate::storage::{ReviewBlockRow, ReviewRequestRow, Storage};

pub struct ReviewRepository<'a> {
    storage: &'a Storage,
}

impl<'a> ReviewRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn get(&self, review_id: &str) -> Result<Option<ReviewRequest>, AppError> {
        self.storage
            .review_request(review_id)?
            .map(|row| self.hydrate(row))
            .transpose()
    }

    pub fn list_active(&self, workspace_id: &str) -> Result<Vec<ReviewRequest>, AppError> {
        self.storage
            .active_review_requests(workspace_id)?
            .into_iter()
            .map(|row| self.hydrate(row))
            .collect()
    }

    fn hydrate(&self, row: ReviewRequestRow) -> Result<ReviewRequest, AppError> {
        let blocks = self
            .storage
            .review_blocks(&row.id)?
            .into_iter()
            .map(block_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ReviewRequest {
            id: row.id,
            workspace_id: row.workspace_id,
            result_id: row.result_id,
            source: parse_source(&row.source)?,
            operation_kind: parse_kind(&row.operation_kind)?,
            status: parse_status(&row.status)?,
            summary: row.summary,
            risk: parse_risk(&row.risk)?,
            base_revision_id: row.base_revision_id,
            base_hash: row.base_hash,
            blocks,
            application_operation_id: row.application_operation_id,
            output_result_id: row.output_result_id,
            error_code: row.error_code,
            created_at: row.created_at,
            decided_at: row.decided_at,
            applied_at: row.applied_at,
        })
    }
}

fn block_from_row(row: ReviewBlockRow) -> Result<ReviewBlock, AppError> {
    Ok(ReviewBlock {
        id: row.id,
        kind: parse_kind(&row.kind)?,
        status: match row.status.as_str() {
            "pending" => ReviewBlockStatus::Pending,
            "accepted" => ReviewBlockStatus::Accepted,
            "rejected" => ReviewBlockStatus::Rejected,
            _ => return Err(AppError::StateUnavailable),
        },
        target_label: row.target_label,
        operation: row.operation,
        before: row.before_content,
        after: row.after_content,
        reason: row.reason,
        risk: parse_risk(&row.risk)?,
        suggested_file_name: row.suggested_file_name,
        decided_file_name: row.decided_file_name,
    })
}

pub fn source_str(value: ReviewSource) -> &'static str {
    match value {
        ReviewSource::Chat => "chat",
        ReviewSource::Selection => "selection",
        ReviewSource::Template => "template",
        ReviewSource::A2uiAction => "a2ui_action",
        ReviewSource::ImportTransform => "import_transform",
    }
}

pub fn kind_str(value: ReviewOperationKind) -> &'static str {
    match value {
        ReviewOperationKind::DocumentPatch => "document_patch",
        ReviewOperationKind::CreateFile => "create_file",
        ReviewOperationKind::ReplaceResult => "replace_result",
    }
}

pub fn risk_str(value: ReviewRisk) -> &'static str {
    match value {
        ReviewRisk::Low => "low",
        ReviewRisk::Medium => "medium",
        ReviewRisk::High => "high",
    }
}

fn parse_source(value: &str) -> Result<ReviewSource, AppError> {
    match value {
        "chat" => Ok(ReviewSource::Chat),
        "selection" => Ok(ReviewSource::Selection),
        "template" => Ok(ReviewSource::Template),
        "a2ui_action" => Ok(ReviewSource::A2uiAction),
        "import_transform" => Ok(ReviewSource::ImportTransform),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_kind(value: &str) -> Result<ReviewOperationKind, AppError> {
    match value {
        "document_patch" => Ok(ReviewOperationKind::DocumentPatch),
        "create_file" => Ok(ReviewOperationKind::CreateFile),
        "replace_result" => Ok(ReviewOperationKind::ReplaceResult),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_status(value: &str) -> Result<ReviewStatus, AppError> {
    match value {
        "pending" => Ok(ReviewStatus::Pending),
        "partially_accepted" => Ok(ReviewStatus::PartiallyAccepted),
        "accepted" => Ok(ReviewStatus::Accepted),
        "rejected" => Ok(ReviewStatus::Rejected),
        "applied" => Ok(ReviewStatus::Applied),
        "conflicted" => Ok(ReviewStatus::Conflicted),
        "failed" => Ok(ReviewStatus::Failed),
        "undone" => Ok(ReviewStatus::Undone),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_risk(value: &str) -> Result<ReviewRisk, AppError> {
    match value {
        "low" => Ok(ReviewRisk::Low),
        "medium" => Ok(ReviewRisk::Medium),
        "high" => Ok(ReviewRisk::High),
        _ => Err(AppError::StateUnavailable),
    }
}
