use crate::{error::AppError, storage::Storage};
use rusqlite::OptionalExtension;

/// Resolves an opaque, currently authorized source to an internal workspace key.
/// The key must never be serialized as a new target capability.
pub(crate) fn workspace_target(
    storage: &Storage,
    workspace_id: &str,
    source_id: &str,
) -> Result<String, AppError> {
    storage.with_read(|connection| {
        connection.query_row(
            "SELECT f.virtual_path FROM workspace_files f JOIN workspaces w ON w.id = f.workspace_id WHERE f.workspace_id = ?1 AND f.source_id = ?2",
            [workspace_id, source_id],
            |row| row.get(0),
        ).optional()?.ok_or_else(|| AppError::InvalidInput("Document source is not authorized in this workspace".into()))
    })
}
