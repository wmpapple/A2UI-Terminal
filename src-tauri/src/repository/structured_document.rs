use crate::{
    domain::{document::DocumentTarget, structured_document::StructuredDocument},
    error::AppError,
    storage::Storage,
};
use rusqlite::{params, OptionalExtension};

pub fn find(
    storage: &Storage,
    target: &DocumentTarget,
    hash: Option<&str>,
) -> Result<Option<StructuredDocument>, AppError> {
    let key = super::critic::key(target)?;
    storage.with_read(|db| {
        let raw: Option<String> = db.query_row(
            "SELECT ast_json FROM document_structures WHERE target_key=?1 AND (?2 IS NULL OR content_hash=?2) ORDER BY rowid DESC LIMIT 1",
            params![key, hash], |r| r.get(0)).optional()?;
        raw.map(|s| serde_json::from_str(&s).map_err(|_| AppError::StateUnavailable)).transpose()
    })
}

pub fn put(
    storage: &Storage,
    target: &DocumentTarget,
    hash: &str,
    document: &StructuredDocument,
) -> Result<(), AppError> {
    let (workspace, result) = match target {
        DocumentTarget::Result { result_id } => (
            storage
                .result_source(result_id)?
                .ok_or(AppError::FileConflict)?
                .result
                .workspace_id,
            Some(result_id.as_str()),
        ),
        DocumentTarget::WorkspaceFile { workspace_id, .. } => (workspace_id.clone(), None),
    };
    let key = super::critic::key(target)?;
    let json = serde_json::to_string(document).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        db.execute("INSERT INTO document_structures(target_key,content_hash,workspace_id,result_id,ast_json) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(target_key,content_hash) DO NOTHING", params![key,hash,workspace,result,json])?;
        // Bound cached snapshots. Text revisions remain the durable recovery source.
        db.execute("DELETE FROM document_structures WHERE target_key=?1 AND rowid NOT IN (SELECT rowid FROM document_structures WHERE target_key=?1 ORDER BY rowid DESC LIMIT 100)", [&key])?;
        Ok(())
    })
}
