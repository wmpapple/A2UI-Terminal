use crate::domain::result::{
    ResultDetail, ResultStatus, ResultStorageKind, ResultSummary, ResultType,
};
use crate::error::AppError;
use crate::storage::{ResultRow, Storage};

pub struct ResultRepository<'a> {
    storage: &'a Storage,
}

impl<'a> ResultRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn list(
        &self,
        workspace_id: Option<&str>,
        include_archived: bool,
    ) -> Result<Vec<ResultSummary>, AppError> {
        self.storage
            .results(workspace_id, include_archived)?
            .into_iter()
            .map(summary_from_row)
            .collect()
    }

    pub fn get(&self, result_id: &str) -> Result<Option<ResultDetail>, AppError> {
        self.storage
            .result(result_id)?
            .map(detail_from_row)
            .transpose()
    }

    pub fn ensure_file(
        &self,
        result_id: &str,
        workspace_id: &str,
        relative_path: &str,
        title: &str,
        storage_kind: ResultStorageKind,
        current_revision_id: Option<&str>,
    ) -> Result<ResultDetail, AppError> {
        let row = self.storage.ensure_file_result(
            result_id,
            workspace_id,
            relative_path,
            title,
            storage_kind.as_str(),
            &format!("result://file/{result_id}"),
            current_revision_id,
        )?;
        detail_from_row(row)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ensure_surface(
        &self,
        result_id: &str,
        surface_row_id: &str,
        workspace_id: &str,
        surface_id: &str,
        session_id: &str,
        title: &str,
        managed_state_json: &str,
    ) -> Result<ResultDetail, AppError> {
        detail_from_row(self.storage.ensure_surface_result(
            result_id,
            surface_row_id,
            workspace_id,
            surface_id,
            session_id,
            title,
            managed_state_json,
        )?)
    }
}

impl ResultStorageKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceFile => "workspace_file",
            Self::StandaloneFile => "standalone_file",
            Self::ManagedLocal => "managed_local",
        }
    }
}

fn summary_from_row(row: ResultRow) -> Result<ResultSummary, AppError> {
    Ok(ResultSummary {
        id: row.id,
        workspace_id: row.workspace_id,
        result_type: parse_result_type(&row.result_type)?,
        title: row.title,
        status: parse_result_status(&row.status)?,
        storage_kind: parse_storage_kind(&row.storage_kind)?,
        current_revision_id: row.current_revision_id,
        a2ui_surface_id: row.a2ui_surface_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
    })
}

pub(crate) fn detail_from_row(row: ResultRow) -> Result<ResultDetail, AppError> {
    let storage_ref = row.storage_ref.clone();
    let active_session_id = row.active_session_id.clone();
    let managed_state = row
        .managed_state_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| AppError::StateUnavailable)?;
    Ok(ResultDetail {
        summary: summary_from_row(row)?,
        storage_ref,
        active_session_id,
        managed_state,
    })
}

fn parse_result_type(value: &str) -> Result<ResultType, AppError> {
    match value {
        "document" => Ok(ResultType::Document),
        "spreadsheet" => Ok(ResultType::Spreadsheet),
        "checklist" => Ok(ResultType::Checklist),
        "form" => Ok(ResultType::Form),
        "tool" => Ok(ResultType::Tool),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_result_status(value: &str) -> Result<ResultStatus, AppError> {
    match value {
        "draft" => Ok(ResultStatus::Draft),
        "generating" => Ok(ResultStatus::Generating),
        "review_pending" => Ok(ResultStatus::ReviewPending),
        "ready" => Ok(ResultStatus::Ready),
        "exporting" => Ok(ResultStatus::Exporting),
        "failed" => Ok(ResultStatus::Failed),
        "archived" => Ok(ResultStatus::Archived),
        _ => Err(AppError::StateUnavailable),
    }
}

fn parse_storage_kind(value: &str) -> Result<ResultStorageKind, AppError> {
    match value {
        "workspace_file" => Ok(ResultStorageKind::WorkspaceFile),
        "standalone_file" => Ok(ResultStorageKind::StandaloneFile),
        "managed_local" => Ok(ResultStorageKind::ManagedLocal),
        _ => Err(AppError::StateUnavailable),
    }
}
