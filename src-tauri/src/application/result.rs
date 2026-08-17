use crate::domain::result::{validate_title, ResultDetail, ResultStorageKind, ResultSummary};
use crate::error::AppError;
use crate::repository::result::ResultRepository;
use crate::storage::{A2uiSurfaceRow, Storage};
use crate::workspace::WorkspaceDocument;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MANAGED_RESULTS_DIRECTORY: &str = "my-results";

pub fn prepare_managed_results_dir(app_data_dir: &Path) -> Result<PathBuf, AppError> {
    let directory = app_data_dir.join(MANAGED_RESULTS_DIRECTORY);
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

pub fn list(
    storage: &Storage,
    workspace_id: Option<&str>,
    include_archived: bool,
) -> Result<Vec<ResultSummary>, AppError> {
    if let Some(workspace_id) = workspace_id {
        if workspace_id.trim().is_empty() || workspace_id.chars().count() > 128 {
            return Err(AppError::InvalidInput("工作区标识无效".into()));
        }
    }
    ResultRepository::new(storage).list(workspace_id, include_archived)
}

pub fn get(storage: &Storage, result_id: &str) -> Result<ResultDetail, AppError> {
    Uuid::parse_str(result_id).map_err(|_| AppError::InvalidInput("成果标识无效".into()))?;
    ResultRepository::new(storage)
        .get(result_id)?
        .ok_or_else(|| AppError::InvalidInput("找不到指定成果".into()))
}

pub fn ensure_file_result(
    storage: &Storage,
    workspace_id: &str,
    document: &WorkspaceDocument,
) -> Result<ResultDetail, AppError> {
    let title = validate_title(&document.name)?;
    let workspace = storage
        .workspace(workspace_id)?
        .ok_or_else(|| AppError::InvalidInput("工作区不存在".into()))?;
    let storage_kind = if workspace.kind == "standalone" {
        ResultStorageKind::StandaloneFile
    } else {
        ResultStorageKind::WorkspaceFile
    };
    let current_revision_id = storage
        .document_versions(workspace_id, &document.path, 1)?
        .first()
        .map(|revision| revision.id.clone());
    ResultRepository::new(storage).ensure_file(
        &Uuid::new_v4().to_string(),
        workspace_id,
        &document.path,
        title,
        storage_kind,
        current_revision_id.as_deref(),
    )
}

pub fn ensure_surface_result(
    storage: &Storage,
    surface: &A2uiSurfaceRow,
) -> Result<ResultDetail, AppError> {
    let proposed_title = format!("交互成果 {}", surface.surface_id);
    let title = validate_title(&proposed_title)?;
    ResultRepository::new(storage).ensure_surface(
        &Uuid::new_v4().to_string(),
        &surface.id,
        &surface.workspace_id,
        &surface.surface_id,
        &surface.session_id,
        title,
        &surface.state_json,
    )
}

pub fn ensure_surface_by_id(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<ResultDetail, AppError> {
    let surface = storage
        .a2ui_surface(workspace_id, surface_id)?
        .ok_or_else(|| AppError::InvalidInput("Surface 不存在或不属于当前工作区".into()))?;
    ensure_surface_result(storage, &surface)
}

#[cfg(test)]
mod tests {
    use super::prepare_managed_results_dir;

    #[test]
    fn managed_results_directory_is_always_below_app_data() {
        let app_data = tempfile::tempdir().unwrap();
        let directory = prepare_managed_results_dir(app_data.path()).unwrap();

        assert!(directory.starts_with(app_data.path()));
        assert_eq!(directory.file_name().unwrap(), "my-results");
        assert!(directory.is_dir());
    }
}
