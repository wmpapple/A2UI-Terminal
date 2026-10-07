use crate::application::canvas::{Canvas, SaveCanvasInput};
use crate::error::AppError;
use crate::storage::Storage;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

fn decode(raw: &str) -> Result<Value, AppError> {
    serde_json::from_str(raw).map_err(|e| AppError::InvalidInput(format!("画布数据无效: {e}")))
}

fn read_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(
    String,
    Option<String>,
    String,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
    ))
}

fn map(
    row: (
        String,
        Option<String>,
        String,
        String,
        i64,
        String,
        String,
        String,
        String,
        String,
    ),
) -> Result<Canvas, AppError> {
    let (
        id,
        workspace_id,
        title,
        binding,
        version,
        blocks,
        edges,
        viewport,
        created_at,
        updated_at,
    ) = row;
    Ok(Canvas {
        id,
        workspace_id,
        title,
        binding: decode(&binding)?,
        version,
        blocks: serde_json::from_str(&blocks).map_err(|e| AppError::InvalidInput(e.to_string()))?,
        edges: serde_json::from_str(&edges).map_err(|e| AppError::InvalidInput(e.to_string()))?,
        viewport: decode(&viewport)?,
        created_at,
        updated_at,
    })
}

pub fn list(storage: &Storage, workspace_id: &str) -> Result<Vec<Canvas>, AppError> {
    storage.with_read(|db| {
        let mut statement = db.prepare("SELECT id,workspace_id,title,binding_json,version,blocks_json,edges_json,viewport_json,created_at,updated_at FROM canvases WHERE workspace_id=?1 ORDER BY updated_at DESC,id")?;
        let rows = statement.query_map([workspace_id], read_row)?;
        rows.map(|row| map(row?)).collect()
    })
}

pub fn read(storage: &Storage, workspace_id: &str, id: &str) -> Result<Option<Canvas>, AppError> {
    storage.with_read(|db| {
        let row = db.query_row("SELECT id,workspace_id,title,binding_json,version,blocks_json,edges_json,viewport_json,created_at,updated_at FROM canvases WHERE id=?1 AND workspace_id=?2",params![id,workspace_id],read_row).optional()?;
        row.map(map).transpose()
    })
}

pub fn create(
    storage: &Storage,
    id: &str,
    workspace_id: &str,
    title: &str,
    binding: &Value,
) -> Result<(), AppError> {
    let binding_json = binding.to_string();
    storage.with_transaction(|db| {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1)",
            [workspace_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::InvalidInput("工作区不存在".into()));
        }
        db.execute(
            "INSERT INTO canvases(id,workspace_id,title,binding_json) VALUES(?1,?2,?3,?4)",
            params![id, workspace_id, title, binding_json],
        )?;
        Ok(())
    })
}

pub fn save(
    storage: &Storage,
    input: &SaveCanvasInput,
    blocks: &str,
    edges: &str,
    viewport: &str,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        let changed = db.execute("UPDATE canvases SET workspace_id=?2,title=?3,binding_json=?4,blocks_json=?5,edges_json=?6,viewport_json=?7,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND workspace_id=?2 AND version=?8",params![input.id,input.workspace_id,input.title.trim(),input.binding.to_string(),blocks,edges,viewport,input.version])?;
        if changed == 0 { return Err(AppError::FileConflict); }
        Ok(())
    })
}

pub fn delete(storage: &Storage, workspace_id: &str, id: &str) -> Result<bool, AppError> {
    storage.with_transaction(|db| {
        Ok(db.execute(
            "DELETE FROM canvases WHERE id=?1 AND workspace_id=?2",
            params![id, workspace_id],
        )? == 1)
    })
}
