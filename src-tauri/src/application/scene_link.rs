//! Contextual tool ownership and human checkpoints. No model calls or implicit grants.
use crate::{
    domain::{
        citation::CitationView,
        critic::Finding,
        document::{DocumentSnapshot, DocumentTarget},
        result::{ResultSummary, ResultType},
    },
    error::AppError,
    repository::scene_link as repo,
    state::AppState,
    storage::Storage,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ToolBinding {
    #[default]
    None,
    Document {
        target: DocumentTarget,
    },
    Result {
        target_id: String,
    },
    Task {
        target_id: String,
    },
    Workspace {
        target_id: String,
    },
}
impl ToolBinding {
    pub(crate) fn key(&self) -> Result<String, AppError> {
        serde_json::to_string(self).map_err(|_| AppError::StateUnavailable)
    }
    pub fn document_result(id: &str) -> Self {
        Self::Document {
            target: DocumentTarget::Result {
                result_id: id.into(),
            },
        }
    }
    fn result_id(&self) -> Option<&str> {
        match self {
            Self::Document {
                target: DocumentTarget::Result { result_id },
            } => Some(result_id),
            Self::Result { target_id } => Some(target_id),
            _ => None,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetSceneLink {
    pub tool_result_id: String,
    pub binding: ToolBinding,
    pub expected_version: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmSceneLink {
    pub tool_result_id: String,
    pub version: String,
    pub target_hash: String,
    pub target_revision_id: Option<String>,
    pub tool_state_hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticEvidence {
    pub engine: String,
    pub current: bool,
    pub created_at: String,
    pub findings: Vec<Finding>,
    pub truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolContext {
    // Deliberately separate from binding. These are local display capabilities, not source grants.
    pub scope: String,
    pub preview: String,
    pub model_access: bool,
    pub knowledge_access: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneLinkView {
    pub link: Option<repo::LinkRecord>,
    pub bound_revision: Option<repo::RevisionDescription>,
    pub reviewed_revision: Option<repo::RevisionDescription>,
    pub binding_policy: String,
    pub status: String,
    pub current_hash: Option<String>,
    pub current_revision_id: Option<String>,
    pub tool_state_hash: String,
    pub context: Option<ToolContext>,
    pub citations: Vec<CitationView>,
    pub critics: Vec<CriticEvidence>,
    pub evidence_error: bool,
}
pub(crate) struct TargetSnapshot {
    pub title: String,
    pub hash: String,
    pub revision: Option<String>,
    pub draft: bool,
    pub document: Option<DocumentSnapshot>,
    pub scope: &'static str,
    pub preview: String,
}
fn id(value: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| AppError::InvalidInput("关联对象标识无效".into()))
}
pub(crate) fn resolve(
    storage: &Storage,
    root: &Path,
    binding: &ToolBinding,
) -> Result<TargetSnapshot, AppError> {
    let (title, snapshot) = match binding {
        ToolBinding::None => return Err(AppError::InvalidInput("独立工具没有关联对象".into())),
        ToolBinding::Document { target } => {
            let title = match target {
                DocumentTarget::Result { result_id } => {
                    let r = super::result::get(storage, result_id)?;
                    if r.summary.result_type != ResultType::Document {
                        return Err(AppError::InvalidInput("文档型工具必须关联文档".into()));
                    }
                    r.summary.title
                }
                DocumentTarget::WorkspaceFile {
                    workspace_id,
                    source_id,
                } => {
                    id(workspace_id)?;
                    id(source_id)?;
                    let key = crate::repository::document::workspace_target(
                        storage,
                        workspace_id,
                        source_id,
                    )?;
                    key.rsplit(['/', '\\']).next().unwrap_or(&key).to_string()
                }
            };
            let snapshot = super::document::snapshot(storage, root, target)?;
            if !matches!(snapshot.format.as_str(), "markdown" | "text" | "plaintext") {
                return Err(AppError::InvalidInput(
                    "目前支持 Markdown 或纯文本文档".into(),
                ));
            }
            (title, snapshot)
        }
        ToolBinding::Result { target_id } => {
            let r = super::result::get(storage, target_id)?;
            (
                r.summary.title,
                super::document::snapshot(
                    storage,
                    root,
                    &DocumentTarget::Result {
                        result_id: target_id.clone(),
                    },
                )?,
            )
        }
        ToolBinding::Task { target_id } => {
            id(target_id)?;
            let task = storage
                .task(target_id)?
                .ok_or_else(|| AppError::InvalidInput("关联任务已不可用".into()))?;
            let value = json!({"template":task.template_id,"status":task.status,"answers":serde_json::from_str::<serde_json::Value>(&task.input_answers_json).map_err(|_|AppError::StateUnavailable)?,"resultId":task.result_id,"updatedAt":task.updated_at});
            let text = value.to_string();
            let title = storage
                .task_template_version(&task.template_id, task.template_version)?
                .map(|t| t.name)
                .unwrap_or_else(|| task.template_id.clone());
            let status = match task.status.as_str() {
                "draft" => "草稿",
                "awaiting_input" => "待补充信息",
                "ready" => "就绪",
                "running" => "进行中",
                "review_pending" => "待审阅",
                "completed" => "已完成",
                "failed" => "失败",
                "cancelled" => "已取消",
                _ => "未知",
            };
            let preview = format!(
                "任务：{title}\n状态：{status}\n最近更新：{}",
                task.updated_at
            );
            return Ok(TargetSnapshot {
                title: format!("{} · {}", title, task.created_at),
                hash: super::result::content_hash(text.as_bytes()),
                revision: Some(task.updated_at),
                draft: false,
                document: None,
                scope: "task_metadata",
                preview,
            });
        }
        ToolBinding::Workspace { target_id } => {
            id(target_id)?;
            let w = storage
                .workspace(target_id)?
                .ok_or_else(|| AppError::InvalidInput("关联工作区已不可用".into()))?;
            let hash = super::result::content_hash(
                json!([w.id, w.name, w.kind, w.root_path])
                    .to_string()
                    .as_bytes(),
            );
            return Ok(TargetSnapshot {
                title: w.name.clone(),
                hash,
                revision: None,
                draft: false,
                document: None,
                scope: "workspace_identity",
                preview: w.name,
            });
        }
    };
    let revision = if let DocumentTarget::WorkspaceFile {
        workspace_id,
        source_id,
    } = &snapshot.target
    {
        let key = crate::repository::document::workspace_target(storage, workspace_id, source_id)?;
        storage.with_read(|db|{use rusqlite::OptionalExtension;Ok(db.query_row("SELECT id FROM document_versions WHERE workspace_id=?1 AND relative_path=?2 ORDER BY rowid DESC LIMIT 1",rusqlite::params![workspace_id,key],|r|r.get(0)).optional()?)})?
    } else {
        snapshot.revision_id.clone()
    };
    Ok(TargetSnapshot {
        title,
        hash: snapshot.content_hash.clone(),
        revision,
        draft: snapshot.has_unsaved_draft,
        preview: snapshot.text.chars().take(2000).collect(),
        scope: if matches!(binding, ToolBinding::Document { .. }) {
            "document_and_existing_evidence"
        } else {
            "result_content"
        },
        document: Some(snapshot),
    })
}
pub(crate) fn validate_policy(policy: &str, binding: &ToolBinding) -> Result<(), AppError> {
    if policy == "document" && !matches!(binding, ToolBinding::Document { .. }) {
        return Err(AppError::InvalidInput(
            "此文档型工具必须选择具体文档".into(),
        ));
    }
    Ok(())
}
fn status(link: &repo::LinkRecord, snapshot: &TargetSnapshot) -> &'static str {
    if snapshot.draft {
        "unsaved"
    } else if link.reviewed_at.is_none() {
        "unchecked"
    } else if link.reviewed_hash.as_deref() != Some(&snapshot.hash)
        || link.reviewed_revision_id != snapshot.revision
    {
        "changed"
    } else {
        "current"
    }
}
pub fn read(state: &AppState, tool: &str) -> Result<SceneLinkView, AppError> {
    let tool_view = super::scene_tool::read(&state.storage, tool)?;
    let mut view = SceneLinkView {
        link: repo::read(&state.storage, tool)?,
        bound_revision: None,
        reviewed_revision: None,
        binding_policy: repo::policy(&state.storage, tool)?,
        status: "unbound".into(),
        current_hash: None,
        current_revision_id: None,
        tool_state_hash: tool_view.state_hash,
        context: None,
        citations: vec![],
        critics: vec![],
        evidence_error: false,
    };
    let Some(link) = &mut view.link else {
        return Ok(view);
    };
    view.status = "unavailable".into();
    let Ok(snapshot) = resolve(&state.storage, &state.managed_results_dir, &link.binding) else {
        return Ok(view);
    };
    link.target_title = snapshot.title.clone();
    view.bound_revision = repo::revision_description(
        &state.storage,
        link.bound_revision_id.as_deref(),
        Some(&link.bound_hash),
    )?;
    view.reviewed_revision = repo::revision_description(
        &state.storage,
        link.reviewed_revision_id.as_deref(),
        link.reviewed_hash.as_deref(),
    )?;
    view.status = status(link, &snapshot).into();
    view.current_hash = Some(snapshot.hash.clone());
    view.current_revision_id = snapshot.revision.clone();
    if snapshot.draft {
        return Ok(view);
    }
    view.context = Some(ToolContext {
        scope: snapshot.scope.into(),
        preview: snapshot.preview.clone(),
        model_access: false,
        knowledge_access: false,
    });
    if matches!(link.binding, ToolBinding::Document { .. }) {
        if let Some(doc) = &snapshot.document {
            match super::critic::existing_citations(state, &doc.target) {
                Ok(c) => view.citations = c,
                Err(_) => view.evidence_error = true,
            }
            for engine in ["local", "llm"] {
                match crate::repository::critic::find(&state.storage, &doc.target, engine) {
                    Ok(Some(report)) => {
                        let current = super::critic::report_is_current(state, &report);
                        view.critics.push(CriticEvidence {
                            engine: engine.into(),
                            current,
                            created_at: report.created_at,
                            findings: if current { report.findings } else { vec![] },
                            truncated: report.truncated,
                        });
                    }
                    Ok(None) => (),
                    Err(_) => view.evidence_error = true,
                }
            }
        }
    }
    if !resolve(&state.storage, &state.managed_results_dir, &link.binding).is_ok_and(|fresh| {
        fresh.hash == snapshot.hash && fresh.revision == snapshot.revision && !fresh.draft
    }) {
        view.status = "changed".into();
        view.current_hash = None;
        view.context = None;
        view.citations.clear();
        view.critics.clear();
    }
    Ok(view)
}
pub fn set(state: &AppState, input: SetSceneLink) -> Result<SceneLinkView, AppError> {
    super::scene_tool::read(&state.storage, &input.tool_result_id)?;
    validate_policy(
        &repo::policy(&state.storage, &input.tool_result_id)?,
        &input.binding,
    )?;
    if input.binding.result_id() == Some(&input.tool_result_id) {
        return Err(AppError::InvalidInput("工具不能关联自身".into()));
    }
    let target = if matches!(input.binding, ToolBinding::None) {
        None
    } else {
        Some(resolve(
            &state.storage,
            &state.managed_results_dir,
            &input.binding,
        )?)
    };
    repo::set(
        &state.storage,
        &input.tool_result_id,
        input.expected_version.as_deref(),
        &input.binding,
        target
            .as_ref()
            .map(|t| (t.title.as_str(), t.hash.as_str(), t.revision.as_deref())),
    )?;
    read(state, &input.tool_result_id)
}
pub fn confirm(state: &AppState, input: ConfirmSceneLink) -> Result<SceneLinkView, AppError> {
    let tool = super::scene_tool::read(&state.storage, &input.tool_result_id)?;
    if tool.state_hash != input.tool_state_hash {
        return Err(AppError::FileConflict);
    }
    let link = repo::read(&state.storage, &input.tool_result_id)?.ok_or(AppError::FileConflict)?;
    let snapshot = resolve(&state.storage, &state.managed_results_dir, &link.binding)?;
    if snapshot.draft
        || snapshot.hash != input.target_hash
        || snapshot.revision != input.target_revision_id
    {
        return Err(AppError::FileConflict);
    }
    let row = state
        .storage
        .a2ui_surface(&tool.surface.workspace_id, &tool.surface.surface_id)?
        .ok_or(AppError::FileConflict)?;
    if super::result::content_hash(row.state_json.as_bytes()) != input.tool_state_hash {
        return Err(AppError::FileConflict);
    }
    repo::confirm(
        &state.storage,
        &input.tool_result_id,
        &input.version,
        &input.target_hash,
        input.target_revision_id.as_deref(),
        &row.state_json,
    )?;
    // Read again: external file writes cannot participate in SQLite's transaction.
    read(state, &input.tool_result_id)
}
pub fn list(state: &AppState, binding: &ToolBinding) -> Result<Vec<ResultSummary>, AppError> {
    resolve(&state.storage, &state.managed_results_dir, binding)?;
    repo::tools(&state.storage, binding)?
        .into_iter()
        .map(|id| super::result::get(&state.storage, &id).map(|r| r.summary))
        .collect()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingChoice {
    pub binding: ToolBinding,
    pub title: String,
}
pub fn targets(storage: &Storage) -> Result<Vec<BindingChoice>, AppError> {
    let mut choices = vec![];
    for r in super::result::list(storage, None, false)? {
        if r.result_type == ResultType::Document {
            choices.push(BindingChoice {
                binding: ToolBinding::document_result(&r.id),
                title: r.title.clone(),
            });
        }
        choices.push(BindingChoice {
            binding: ToolBinding::Result { target_id: r.id },
            title: r.title,
        });
    }
    for w in storage.recent_workspaces(100)? {
        if w.id != super::result::MANAGED_RESULTS_WORKSPACE_ID {
            choices.push(BindingChoice {
                binding: ToolBinding::Workspace { target_id: w.id },
                title: w.name,
            });
        }
    }
    let tasks: Vec<(String, String)> = storage.with_read(|db| {
        let mut q =
            db.prepare("SELECT t.id,p.name || ' · ' || t.created_at FROM tasks t JOIN task_templates p ON p.id=t.template_id AND p.version=t.template_version ORDER BY t.updated_at DESC LIMIT 100")?;
        let rows = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    for (id, template) in tasks {
        choices.push(BindingChoice {
            title: template,
            binding: ToolBinding::Task { target_id: id },
        });
    }
    Ok(choices)
}
pub(crate) fn export_note(
    storage: &Storage,
    root: &Path,
    tool: &str,
) -> Result<Option<String>, AppError> {
    let Some(link) = repo::read(storage, tool)? else {
        return Ok(None);
    };
    let current = resolve(storage, root, &link.binding).ok();
    let label = current
        .as_ref()
        .map(|s| status(&link, s))
        .unwrap_or("unavailable");
    let label = match label {
        "current" => "已人工核对当前版本",
        "changed" => "目标已变化，需重新核对",
        "unsaved" => "有未保存修改，需重新核对",
        "unavailable" => "关联对象不可用",
        _ => "尚未人工核对",
    };
    Ok(Some(format!(
        "关联对象：{}\n状态：{label}\n绑定：{}\n核对版本：{}\n核对指纹：{}\n上次核对：{}",
        current
            .as_ref()
            .map(|s| s.title.as_str())
            .unwrap_or(&link.target_title),
        link.binding.key()?,
        link.reviewed_revision_id
            .as_deref()
            .unwrap_or("无版本号，以内容指纹为准"),
        link.reviewed_hash.as_deref().unwrap_or("无"),
        link.reviewed_at.as_deref().unwrap_or("尚未核对")
    )))
}
