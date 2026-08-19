use crate::document_source::DocumentSource;
use crate::error::AppError;
use crate::workspace::{WorkspaceDocument, WorkspaceSummary};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportBatchStatus {
    AwaitingConfirmation,
    Blocked,
    Confirmed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportCapability {
    EditableText,
    ReadOnlyText,
    StructuredData,
    VisualContext,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportItemStatus {
    Ready,
    Planned,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub capability: ImportCapability,
    pub status: ImportItemStatus,
    pub readable: bool,
    pub editable: bool,
    pub reason_code: Option<String>,
    pub reason: Option<String>,
    pub alternative: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatch {
    pub id: String,
    pub status: ImportBatchStatus,
    pub items: Vec<ImportItem>,
    pub total_size_bytes: u64,
    pub max_files: usize,
    pub max_batch_bytes: u64,
    pub can_confirm: bool,
    pub failure_code: Option<String>,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmImportInput {
    pub batch_id: String,
    pub accepted_item_ids: Vec<String>,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfirmation {
    pub batch: ImportBatch,
    pub workspace: Option<WorkspaceSummary>,
    pub documents: Vec<WorkspaceDocument>,
    pub sources: Vec<DocumentSource>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportDropBounds {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetImportDropTargetInput {
    pub target_id: String,
    pub enabled: bool,
    pub workspace_id: Option<String>,
    pub bounds: Option<ImportDropBounds>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportDropTarget {
    pub target_id: String,
    pub workspace_id: Option<String>,
    pub bounds: ImportDropBounds,
}

impl SetImportDropTargetInput {
    pub fn into_target(self) -> Result<(String, Option<ImportDropTarget>), AppError> {
        if Uuid::parse_str(&self.target_id).is_err() {
            return Err(AppError::InvalidInput("拖放目标标识无效".into()));
        }
        if let Some(workspace_id) = &self.workspace_id {
            if Uuid::parse_str(workspace_id).is_err() {
                return Err(AppError::InvalidInput("工作区标识无效".into()));
            }
        }
        if !self.enabled {
            return Ok((self.target_id, None));
        }
        let bounds = self
            .bounds
            .ok_or_else(|| AppError::InvalidInput("启用拖放目标时必须提供边界".into()))?;
        let values = [bounds.left, bounds.top, bounds.right, bounds.bottom];
        if values
            .iter()
            .any(|value| !value.is_finite() || value.abs() > 100_000.0)
            || bounds.right <= bounds.left
            || bounds.bottom <= bounds.top
        {
            return Err(AppError::InvalidInput("拖放目标边界无效".into()));
        }
        Ok((
            self.target_id.clone(),
            Some(ImportDropTarget {
                target_id: self.target_id,
                workspace_id: self.workspace_id,
                bounds,
            }),
        ))
    }
}

impl ImportDropTarget {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.bounds.left
            && x <= self.bounds.right
            && y >= self.bounds.top
            && y <= self.bounds.bottom
    }

    pub fn area(&self) -> f64 {
        (self.bounds.right - self.bounds.left) * (self.bounds.bottom - self.bounds.top)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDropOutcome {
    pub target_id: String,
    pub batch: Option<ImportBatch>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl ImportDropOutcome {
    pub fn success(target_id: String, batch: ImportBatch) -> Self {
        Self {
            target_id,
            batch: Some(batch),
            error_code: None,
            error_message: None,
        }
    }

    pub fn failure(target_id: String, error: &AppError) -> Self {
        Self {
            target_id,
            batch: None,
            error_code: Some(error.code().into()),
            error_message: Some(error.public_message()),
        }
    }
}
