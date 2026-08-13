use crate::error::AppError;
use crate::storage::Storage;
use crate::workspace::{self, DocumentVersion, DocumentVersionSummary, SaveOutcome};

pub fn list(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<Vec<DocumentVersionSummary>, AppError> {
    workspace::list_document_versions(storage, workspace_id, relative_path)
}

pub fn read(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    version_id: &str,
) -> Result<DocumentVersion, AppError> {
    workspace::read_document_version(storage, workspace_id, relative_path, version_id)
}

pub fn restore(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    version_id: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    workspace::restore_document_version(storage, workspace_id, relative_path, version_id, base_hash)
}
