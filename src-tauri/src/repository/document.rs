use crate::{error::AppError, storage::Storage};
use rusqlite::OptionalExtension;

/// Resolves an opaque, currently authorized source to an internal workspace key.
/// The key must never be serialized as a new target capability.
pub(crate) fn workspace_target(
    storage: &Storage,
    workspace_id: &str,
    source_id: &str,
) -> Result<String, AppError> {
    let attached = storage.with_read(|connection| {
        connection.query_row(
            "SELECT f.virtual_path FROM workspace_files f JOIN workspaces w ON w.id = f.workspace_id WHERE f.workspace_id = ?1 AND f.source_id = ?2",
            [workspace_id, source_id],
            |row| row.get(0),
        ).optional().map_err(AppError::from)
    })?;
    if let Some(path) = attached {
        return Ok(path);
    }
    // Directory identities are only valid while the file is inside the current
    // directory grant. No frontend path or independently persisted grant is used.
    crate::workspace::list_files(storage, workspace_id)?
        .into_iter()
        .find(|file| {
            file.source_id.is_none()
                && crate::workspace::directory_source_id(workspace_id, &file.path) == source_id
        })
        .map(|file| file.path)
        .ok_or_else(|| AppError::InvalidInput("资料来源不存在或未获当前工作区授权".into()))
}
