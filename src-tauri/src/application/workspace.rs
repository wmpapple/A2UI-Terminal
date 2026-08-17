use crate::error::AppError;
use crate::repository::workspace::WorkspaceRepository;
use crate::storage::Storage;
use crate::workspace::{
    self, RecoveryDraftSummary, SaveOutcome, WorkspaceDocument, WorkspaceFileEntry,
    WorkspaceSummary,
};
use std::path::Path;

pub fn register(storage: &Storage, path: &Path) -> Result<WorkspaceSummary, AppError> {
    workspace::register_workspace(storage, path)
}

pub fn list_recent(storage: &Storage) -> Result<Vec<WorkspaceSummary>, AppError> {
    workspace::list_recent(storage)
}

pub fn restore(storage: &Storage, workspace_id: &str) -> Result<WorkspaceSummary, AppError> {
    workspace::restore_workspace(storage, workspace_id)
}

pub fn list_files(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<WorkspaceFileEntry>, AppError> {
    workspace::list_files(storage, workspace_id)
}

pub fn read_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceDocument, AppError> {
    workspace::read_file(storage, workspace_id, relative_path)
}

pub fn list_recovery_drafts(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<RecoveryDraftSummary>, AppError> {
    workspace::list_recovery_drafts(storage, workspace_id)
}

pub fn save_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    workspace::save_file_with_history(storage, workspace_id, relative_path, content, base_hash)
}

pub fn save_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<(), AppError> {
    workspace::save_draft(storage, workspace_id, relative_path, content, base_hash)
}

pub fn discard_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), AppError> {
    workspace::discard_draft(storage, workspace_id, relative_path)
}

pub fn remove(storage: &Storage, workspace_id: &str) -> Result<bool, AppError> {
    WorkspaceRepository::new(storage).remove(workspace_id)
}

pub fn resolve_context_workspace(
    storage: &Storage,
    workspace_id: Option<&str>,
) -> Result<WorkspaceSummary, AppError> {
    if let Some(workspace_id) = workspace_id {
        workspace::restore_workspace(storage, workspace_id)
    } else {
        workspace::register_standalone_workspace(storage)
    }
}

pub fn attach_file(
    storage: &Storage,
    workspace_id: &str,
    path: &Path,
) -> Result<WorkspaceDocument, AppError> {
    workspace::attach_selected_file(storage, workspace_id, path)
}

pub fn attach_files(
    storage: &Storage,
    workspace_id: &str,
    paths: &[std::path::PathBuf],
) -> Result<Vec<WorkspaceDocument>, AppError> {
    workspace::attach_selected_files(storage, workspace_id, paths)
}

pub fn save_authorized_file(
    storage: &Storage,
    source_id: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    let selected = WorkspaceRepository::new(storage)
        .authorized_file(source_id)?
        .ok_or_else(|| AppError::InvalidInput("Selected file authorization expired".into()))?;
    workspace::save_file_with_history(
        storage,
        &selected.workspace_id,
        &selected.virtual_path,
        content,
        base_hash,
    )
}
