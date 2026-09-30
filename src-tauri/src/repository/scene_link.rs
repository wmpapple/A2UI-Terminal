use crate::{application::scene_link::ToolBinding, error::AppError, storage::Storage};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Serialize;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    pub binding: ToolBinding,
    pub target_title: String,
    pub bound_hash: String,
    pub bound_revision_id: Option<String>,
    pub version: String,
    pub reviewed_hash: Option<String>,
    pub reviewed_revision_id: Option<String>,
    pub reviewed_at: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDescription {
    pub saved_at: String,
    pub source: String,
}

// Only called after resolving the binding through the existing authorization path.
// Read metadata for the exact recorded revision, never substitute the latest save.
pub fn revision_description(
    storage: &Storage,
    revision: Option<&str>,
    hash: Option<&str>,
) -> Result<Option<RevisionDescription>, AppError> {
    let (Some(revision), Some(hash)) = (revision, hash) else {
        return Ok(None);
    };
    storage.with_read(|db| {
        Ok(db
            .query_row(
                "SELECT created_at,source FROM document_versions WHERE id=?1 AND content_hash=?2",
                params![revision, hash],
                |r| {
                    Ok(RevisionDescription {
                        saved_at: r.get(0)?,
                        source: r.get(1)?,
                    })
                },
            )
            .optional()?)
    })
}
pub fn read(storage: &Storage, tool: &str) -> Result<Option<LinkRecord>, AppError> {
    storage.with_read(|db| {
  let row = db.query_row("SELECT binding_json,target_title,version,reviewed_hash,reviewed_revision_id,reviewed_at,bound_hash,bound_revision_id FROM scene_tool_bindings WHERE tool_result_id=?1",[tool], |r| Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).optional()?;
  row.map(|(binding,title,version,hash,revision,at,bound_hash,bound_revision_id)| Ok(LinkRecord{binding:serde_json::from_str(&binding).map_err(|_|AppError::StateUnavailable)?,target_title:title,bound_hash,bound_revision_id,version,reviewed_hash:hash,reviewed_revision_id:revision,reviewed_at:at})).transpose()
 })
}
pub fn insert(
    db: &Transaction<'_>,
    tool: &str,
    binding: &ToolBinding,
    target: Option<(&str, &str, Option<&str>)>,
) -> Result<(), AppError> {
    if matches!(binding, ToolBinding::None) {
        return Ok(());
    }
    let (title, hash, revision) = target.ok_or(AppError::StateUnavailable)?;
    db.execute("INSERT INTO scene_tool_bindings(tool_result_id,binding_json,target_title,version,bound_hash,bound_revision_id) VALUES(?1,?2,?3,?4,?5,?6)",params![tool,binding.key()?,title,uuid::Uuid::new_v4().to_string(),hash,revision])?;
    Ok(())
}
pub fn policy(storage: &Storage, tool: &str) -> Result<String, AppError> {
    storage.with_read(|db| {
        Ok(db
            .query_row(
                "SELECT binding_policy FROM scene_tool_instances WHERE tool_result_id=?1",
                [tool],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_else(|| "optional".into()))
    })
}
pub fn template_policy(storage: &Storage, template: &str) -> Result<(String, String), AppError> {
    storage.with_read(|db| Ok(db.query_row("SELECT source_template_id,binding_policy FROM scene_template_policies WHERE template_id=?1",[template],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.unwrap_or_else(||("personal".into(),"optional".into()))))
}
pub fn set(
    storage: &Storage,
    tool: &str,
    expected: Option<&str>,
    binding: &ToolBinding,
    target: Option<(&str, &str, Option<&str>)>,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let current: Option<String> = db
            .query_row(
                "SELECT version FROM scene_tool_bindings WHERE tool_result_id=?1",
                [tool],
                |r| r.get(0),
            )
            .optional()?;
        if current.as_deref() != expected {
            return Err(AppError::FileConflict);
        }
        db.execute(
            "DELETE FROM scene_tool_bindings WHERE tool_result_id=?1",
            [tool],
        )?;
        insert(db, tool, binding, target)
    })
}
pub fn confirm(
    storage: &Storage,
    tool: &str,
    version: &str,
    hash: &str,
    revision: Option<&str>,
    state_json: &str,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
  let changed=db.execute("UPDATE scene_tool_bindings SET reviewed_hash=?3,reviewed_revision_id=?4,reviewed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),version=?5 WHERE tool_result_id=?1 AND version=?2 AND EXISTS(SELECT 1 FROM results t JOIN a2ui_surfaces s ON s.id=t.a2ui_surface_row_id WHERE t.id=?1 AND s.state_json=?6)",params![tool,version,hash,revision,uuid::Uuid::new_v4().to_string(),state_json])?;
  if changed!=1 {return Err(AppError::FileConflict);} Ok(())
 })
}
pub fn tools(storage: &Storage, binding: &ToolBinding) -> Result<Vec<String>, AppError> {
    storage.with_read(|db| {
  let mut statement=db.prepare("SELECT l.tool_result_id FROM scene_tool_bindings l JOIN results r ON r.id=l.tool_result_id WHERE l.binding_json=?1 AND r.status<>'archived' ORDER BY r.updated_at DESC,r.id")?;
  let ids=statement.query_map([binding.key()?],|r|r.get(0))?.collect::<Result<Vec<_>,_>>()?;
  Ok(ids)
 })
}
