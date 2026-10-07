use crate::error::AppError;
use crate::repository::canvas;
use crate::storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub binding: Value,
    pub version: i64,
    pub blocks: Vec<Value>,
    pub edges: Vec<Value>,
    pub viewport: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCanvasInput {
    pub workspace_id: String,
    pub title: String,
    pub binding: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCanvasInput {
    pub workspace_id: String,
    pub id: String,
    pub version: i64,
    pub title: String,
    pub binding: Value,
    pub blocks: Vec<Value>,
    pub edges: Vec<Value>,
    pub viewport: Value,
}

fn validate_title(title: &str) -> Result<(), AppError> {
    if title.trim().is_empty() || title.chars().count() > 120 {
        return Err(AppError::InvalidInput("画布标题须为 1–120 个字符".into()));
    }
    Ok(())
}

fn validate_binding(binding: &Value) -> Result<(), AppError> {
    let kind = binding.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "none" | "file" | "folder" | "result") {
        return Err(AppError::InvalidInput("不支持的画布关联类型".into()));
    }
    if kind != "none" {
        let key = if kind == "result" { "resultId" } else { "path" };
        if binding
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(|value| value.is_empty() || value.len() > 4096)
        {
            return Err(AppError::InvalidInput("画布关联对象无效".into()));
        }
    }
    Ok(())
}

fn valid_number(value: Option<&Value>, min: f64, max: f64) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}

pub fn list(storage: &Storage, workspace_id: &str) -> Result<Vec<Canvas>, AppError> {
    canvas::list(storage, workspace_id)
}

pub fn read(storage: &Storage, workspace_id: &str, id: &str) -> Result<Canvas, AppError> {
    canvas::read(storage, workspace_id, id)?
        .ok_or_else(|| AppError::InvalidInput("画布不存在".into()))
}

pub fn create(storage: &Storage, input: CreateCanvasInput) -> Result<Canvas, AppError> {
    validate_title(&input.title)?;
    validate_binding(&input.binding)?;
    if input.workspace_id.is_empty() {
        return Err(AppError::InvalidInput("未选择工作区".into()));
    }
    let id = Uuid::new_v4().to_string();
    canvas::create(
        storage,
        &id,
        &input.workspace_id,
        input.title.trim(),
        &input.binding,
    )?;
    read(storage, &input.workspace_id, &id)
}

pub fn save(storage: &Storage, input: SaveCanvasInput) -> Result<Canvas, AppError> {
    validate_title(&input.title)?;
    validate_binding(&input.binding)?;
    if input.version < 1 || input.blocks.len() > 1000 || input.edges.len() > 3000 {
        return Err(AppError::InvalidInput("画布内容超出限制".into()));
    }
    if !valid_number(input.viewport.get("x"), -1e7, 1e7)
        || !valid_number(input.viewport.get("y"), -1e7, 1e7)
        || !valid_number(input.viewport.get("zoom"), 0.1, 4.0)
    {
        return Err(AppError::InvalidInput("画布视口无效".into()));
    }
    let mut ids = std::collections::HashSet::new();
    for block in &input.blocks {
        let id = block.get("id").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() || id.len() > 128 || !ids.insert(id) {
            return Err(AppError::InvalidInput("画布节点 ID 无效或重复".into()));
        }
        for (field, max) in [("type", 64), ("title", 120), ("body", 200_000)] {
            let value = block.get(field).and_then(Value::as_str).unwrap_or("");
            if (field == "type" && value.is_empty()) || value.chars().count() > max {
                return Err(AppError::InvalidInput(format!("节点 {field} 无效")));
            }
        }
        for (field, min, max) in [
            ("x", -1e7, 1e7),
            ("y", -1e7, 1e7),
            ("width", 80.0, 5000.0),
            ("height", 40.0, 5000.0),
        ] {
            if !valid_number(block.get(field), min, max) {
                return Err(AppError::InvalidInput(format!("节点 {field} 无效")));
            }
        }
        if !valid_number(block.get("zIndex"), -1e6, 1e6) {
            return Err(AppError::InvalidInput("节点层级无效".into()));
        }
    }
    for block in &input.blocks {
        if let Some(parent) = block.get("parentFrameId").and_then(Value::as_str) {
            if parent == block.get("id").and_then(Value::as_str).unwrap_or("")
                || !input.blocks.iter().any(|candidate| {
                    candidate.get("id").and_then(Value::as_str) == Some(parent)
                        && candidate.get("type").and_then(Value::as_str) == Some("frame")
                })
            {
                return Err(AppError::InvalidInput("节点引用了不存在的分组".into()));
            }
        }
    }
    let mut edge_ids = std::collections::HashSet::new();
    for edge in &input.edges {
        let edge_id = edge.get("id").and_then(Value::as_str).unwrap_or("");
        if edge_id.is_empty() || edge_id.len() > 128 || !edge_ids.insert(edge_id) {
            return Err(AppError::InvalidInput("连线 ID 无效或重复".into()));
        }
        for (field, max) in [("relation", 40), ("label", 200)] {
            if edge
                .get(field)
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .count()
                > max
            {
                return Err(AppError::InvalidInput(format!("连线 {field} 无效")));
            }
        }
        let source = edge
            .get("sourceBlockId")
            .and_then(Value::as_str)
            .unwrap_or("");
        let target = edge
            .get("targetBlockId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if source == target || !ids.contains(source) || !ids.contains(target) {
            return Err(AppError::InvalidInput("连线引用了不存在的节点".into()));
        }
    }
    let blocks_json =
        serde_json::to_string(&input.blocks).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let edges_json =
        serde_json::to_string(&input.edges).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let viewport_json = serde_json::to_string(&input.viewport)
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    if blocks_json.len() + edges_json.len() > 8_000_000 {
        return Err(AppError::InvalidInput("画布内容不能超过 8 MB".into()));
    }
    canvas::save(storage, &input, &blocks_json, &edges_json, &viewport_json)?;
    read(storage, &input.workspace_id, &input.id)
}

pub fn delete(storage: &Storage, workspace_id: &str, id: &str) -> Result<bool, AppError> {
    canvas::delete(storage, workspace_id, id)
}
