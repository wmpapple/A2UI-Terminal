//! Product scene definitions. No provider, filesystem or arbitrary action execution.
use crate::{
    a2ui::{self, A2uiNode, A2uiSurfaceState, A2uiSurfaceView},
    domain::result::{validate_title, ResultDetail},
    error::AppError,
    repository::scene_tool as repo,
    storage::{A2uiSurfaceRow, Storage},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub item_label: String,
    pub default_items: Vec<String>,
    pub max_items: usize,
    pub binding_policy: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSceneTool {
    pub template_id: String,
    pub title: String,
    pub items: Vec<String>,
    pub locale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveSceneTool {
    pub result_id: String,
    pub base_hash: String,
    pub data: Map<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneToolView {
    pub result: ResultDetail,
    pub surface: A2uiSurfaceView,
    pub state_hash: String,
    pub template_id: String,
    pub publication: Option<repo::Publication>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishSceneTool {
    pub result_id: String,
    pub base_hash: String,
    pub expected_revision: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameSceneTool {
    pub result_id: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResetSceneTool {
    pub result_id: String,
    pub base_hash: String,
}

pub fn list(storage: &Storage) -> Result<Vec<crate::domain::result::ResultSummary>, AppError> {
    repo::list_ids(storage)?
        .into_iter()
        .map(|id| Ok(crate::application::result::get(storage, &id)?.summary))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneToolListItem {
    #[serde(flatten)]
    pub summary: crate::domain::result::ResultSummary,
    pub binding_title: Option<String>,
    pub template_id: String,
    pub publication: Option<repo::Publication>,
}

pub fn list_items(storage: &Storage) -> Result<Vec<SceneToolListItem>, AppError> {
    list(storage)?
        .into_iter()
        .map(|summary| {
            // Saved identity only; listing tools must never read target files or grant access.
            let binding_title = crate::repository::scene_link::read(storage, &summary.id)?
                .map(|link| link.target_title);
            Ok(SceneToolListItem {
                template_id: repo::template_id(storage, &summary.id)?,
                publication: repo::publication(storage, &summary.id)?,
                summary,
                binding_title,
            })
        })
        .collect()
}

pub fn publish(storage: &Storage, input: PublishSceneTool) -> Result<SceneToolView, AppError> {
    let (result, row) = resolve(storage, &input.result_id)?;
    if super::result::content_hash(row.state_json.as_bytes()) != input.base_hash {
        return Err(AppError::FileConflict);
    }
    let snapshot = crate::application::result::surface_tool_snapshot(&row.state_json)?
        .ok_or(AppError::StateUnavailable)?;
    repo::publish(
        storage,
        &result,
        &row,
        &snapshot,
        input.expected_revision.as_deref(),
    )?;
    read(storage, &input.result_id)
}

pub fn rename(storage: &Storage, input: RenameSceneTool) -> Result<SceneToolView, AppError> {
    let title = validate_title(&input.title)?;
    repo::rename(storage, &input.result_id, title)?;
    read(storage, &input.result_id)
}

pub fn reset(storage: &Storage, input: ResetSceneTool) -> Result<SceneToolView, AppError> {
    let (result, row) = resolve(storage, &input.result_id)?;
    if super::result::content_hash(row.state_json.as_bytes()) != input.base_hash {
        return Err(AppError::FileConflict);
    }
    let mut state: A2uiSurfaceState =
        serde_json::from_str(&row.state_json).map_err(|_| AppError::StateUnavailable)?;
    state.data.clear();
    let json = serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?;
    let snapshot =
        super::result::surface_tool_snapshot(&json)?.ok_or(AppError::StateUnavailable)?;
    repo::save(storage, &result, &row, &json, &snapshot)?;
    read(storage, &input.result_id)
}

fn language(locale: &str) -> Result<bool, AppError> {
    match locale {
        "zh-CN" => Ok(true),
        "en-US" => Ok(false),
        _ => Err(AppError::InvalidInput("不支持的界面语言".into())),
    }
}

pub fn templates(locale: &str) -> Result<Vec<SceneTemplate>, AppError> {
    let zh = language(locale)?;
    let rows = if zh {
        vec![
            (
                "publish",
                "发布检查表",
                "逐项检查标题、来源与发布准备，记录发布负责人。",
                "检查项",
                vec!["标题与摘要", "数据来源", "敏感内容", "格式与链接"],
                20,
            ),
            (
                "interview",
                "采访提纲",
                "整理受访人、核心问题和追问，保存采访记录。",
                "核心问题",
                vec!["背景与经历", "关键事实", "后续计划"],
                5,
            ),
            (
                "review",
                "文档审核表",
                "人工记录事实、术语、引用和格式问题及处理状态。",
                "审核维度",
                vec!["事实", "术语", "引用", "格式"],
                5,
            ),
            (
                "tasks",
                "任务清单",
                "为每项任务填写负责人、截止日期并标记完成。",
                "任务",
                vec!["准备资料", "完成初稿", "复核交付"],
                5,
            ),
            (
                "collect",
                "信息收集表",
                "自定义收集项目，在本机填写并导出完整记录。",
                "收集项目",
                vec!["联系人", "背景信息", "具体需求", "补充资料"],
                15,
            ),
        ]
    } else {
        vec![
            (
                "publish",
                "Publish checklist",
                "Check content and sources before publication.",
                "Checks",
                vec![
                    "Title and summary",
                    "Data sources",
                    "Sensitive content",
                    "Format and links",
                ],
                20,
            ),
            (
                "interview",
                "Interview planner",
                "Plan questions and follow-ups, then record answers.",
                "Questions",
                vec!["Background", "Key facts", "Next steps"],
                5,
            ),
            (
                "review",
                "Document review board",
                "Record manual checks, owners and resolution status.",
                "Review areas",
                vec!["Facts", "Terminology", "Citations", "Formatting"],
                5,
            ),
            (
                "tasks",
                "Task checklist",
                "Track each task with an owner, due date and completion.",
                "Tasks",
                vec!["Collect sources", "Write draft", "Review delivery"],
                5,
            ),
            (
                "collect",
                "Information collector",
                "Define fields and collect information locally.",
                "Fields",
                vec![
                    "Contact",
                    "Background",
                    "Requirements",
                    "Additional sources",
                ],
                15,
            ),
        ]
    };
    Ok(rows
        .into_iter()
        .map(|(id, name, description, label, items, max)| SceneTemplate {
            id: id.into(),
            name: name.into(),
            description: description.into(),
            item_label: label.into(),
            default_items: items.into_iter().map(str::to_string).collect(),
            max_items: max,
            binding_policy: "optional".into(),
        })
        .collect())
}

fn field(name: &str, label: &str, component: &str, extra: Value) -> Value {
    let mut props = json!({"name":name,"label":label});
    props
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    json!({"id":name,"component":component,"props":props,
        "actions":{"change":{"type":"set_state","target":name}}})
}

pub fn create(storage: &Storage, input: CreateSceneTool) -> Result<SceneToolView, AppError> {
    create_with_link(storage, input, &super::scene_link::ToolBinding::None, None)
}
pub fn create_linked(
    state: &crate::state::AppState,
    input: CreateSceneTool,
    binding: &super::scene_link::ToolBinding,
) -> Result<SceneToolView, AppError> {
    create_bound(&state.storage, &state.managed_results_dir, input, binding)
}
pub fn create_bound(
    storage: &Storage,
    root: &std::path::Path,
    input: CreateSceneTool,
    binding: &super::scene_link::ToolBinding,
) -> Result<SceneToolView, AppError> {
    let target = if matches!(binding, super::scene_link::ToolBinding::None) {
        None
    } else {
        Some(super::scene_link::resolve(storage, root, binding)?)
    };
    create_with_link(storage, input, binding, target.as_ref())
}
fn create_with_link(
    storage: &Storage,
    input: CreateSceneTool,
    binding: &super::scene_link::ToolBinding,
    target: Option<&super::scene_link::TargetSnapshot>,
) -> Result<SceneToolView, AppError> {
    let zh = language(&input.locale)?;
    let l = |cn, en| if zh { cn } else { en };
    let template = templates(&input.locale)?
        .into_iter()
        .find(|t| t.id == input.template_id)
        .ok_or_else(|| AppError::InvalidInput("场景模板不存在".into()))?;
    super::scene_link::validate_policy(&template.binding_policy, binding)?;
    let title = validate_title(&input.title)?;
    if input.items.is_empty()
        || input.items.len() > template.max_items
        || input.items.iter().any(|s| {
            s.trim().is_empty() || s.trim().chars().count() > 24 || s.contains(['\n', '\r'])
        })
    {
        return Err(AppError::InvalidInput(format!(
            "请输入 1–{} 项，每项最多 24 字",
            template.max_items
        )));
    }
    let mut children =
        vec![json!({"id":"title","component":"Text","props":{"text":title,"variant":"title"}})];
    let mut fields = Vec::<String>::new();
    let mut inputs = Vec::new();
    let text = |name: &str, label: &str| field(name, label, "TextField", json!({"maxLength":1000}));
    inputs.push(text("subject", l("主题 / 对象", "Subject")));
    match template.id.as_str() {
        "publish" => {
            inputs.push(text("owner", l("发布负责人", "Publication owner")));
            inputs.push(field("checks", l("发布检查", "Publication checks"), "Checklist", json!({"items":input.items.iter().enumerate().map(|(i,s)| json!({"key":format!("item{i}"),"label":s.trim()})).collect::<Vec<_>>(),"value":[]})));
            inputs.push(text("notes", l("问题与备注", "Issues and notes")));
        }
        "interview" => {
            inputs.push(text("guest", l("受访人", "Interviewee")));
            for (i, item) in input.items.iter().enumerate() {
                for (suffix, cn, en) in [
                    ("answer", "记录", "Answer"),
                    ("followup", "追问", "Follow-up"),
                ] {
                    inputs.push(text(
                        &format!("item{i}_{suffix}"),
                        &format!("{} · {}", item.trim(), l(cn, en)),
                    ));
                }
                inputs.push(field(
                    &format!("item{i}_done"),
                    &format!("{} · {}", item.trim(), l("已记录", "Recorded")),
                    "Checkbox",
                    json!({"checked":false}),
                ));
            }
        }
        "review" => {
            for (i, item) in input.items.iter().enumerate() {
                inputs.push(text(
                    &format!("item{i}_note"),
                    &format!("{} · {}", item.trim(), l("审核记录", "Notes")),
                ));
                inputs.push(text(
                    &format!("item{i}_owner"),
                    &format!("{} · {}", item.trim(), l("负责人", "Owner")),
                ));
                inputs.push(field(&format!("item{i}_status"), &format!("{} · {}",item.trim(),l("状态","Status")), "Select", json!({"allowCustom":false,"value":"pending","options":[{"value":"pending","label":l("待检查","Pending")},{"value":"issue","label":l("待处理","Needs work")},{"value":"done","label":l("已核对","Checked")}]})));
            }
        }
        "tasks" => {
            for (i, item) in input.items.iter().enumerate() {
                inputs.push(field(
                    &format!("item{i}_done"),
                    item.trim(),
                    "Checkbox",
                    json!({"checked":false}),
                ));
                inputs.push(text(
                    &format!("item{i}_owner"),
                    &format!("{} · {}", item.trim(), l("负责人", "Owner")),
                ));
                inputs.push(field(
                    &format!("item{i}_date"),
                    &format!("{} · {}", item.trim(), l("截止日期", "Due date")),
                    "Date",
                    json!({}),
                ));
            }
        }
        "collect" => {
            for (i, item) in input.items.iter().enumerate() {
                inputs.push(text(&format!("item{i}"), item.trim()));
            }
        }
        _ => unreachable!(),
    }
    for node in &inputs {
        fields.push(node["props"]["name"].as_str().unwrap().into());
    }
    children.extend(inputs);
    children.push(json!({"id":"summary","component":"ResultSummary","props":{"title":l("填写摘要","Summary"),"fields":fields}}));
    let state: A2uiSurfaceState = serde_json::from_value(json!({
        "surfaceId":format!("scene-{}",Uuid::new_v4().simple()),"revision":1,
        "protocolVersion":"v0.9.1","catalogId":a2ui::CATALOG_ID,
        "root":{"id":"root","component":"Column","children":children},"data":{}
    }))
    .map_err(|_| AppError::StateUnavailable)?;
    a2ui::validate_surface(&state).map_err(|e| AppError::InvalidInput(e.join("；")))?;
    let state_json = serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?;
    let snapshot =
        super::result::surface_tool_snapshot(&state_json)?.ok_or(AppError::StateUnavailable)?;
    storage.ensure_managed_results_workspace(super::result::MANAGED_RESULTS_WORKSPACE_ID)?;
    let id = repo::create(
        storage,
        &state,
        &state_json,
        &snapshot,
        binding,
        target.map(|t| (t.title.as_str(), t.hash.as_str(), t.revision.as_deref())),
        (&template.id, &template.binding_policy),
    )?;
    read(storage, &id)
}

fn resolve(storage: &Storage, id: &str) -> Result<(ResultDetail, A2uiSurfaceRow), AppError> {
    let result = super::result::get(storage, id)?;
    let row = result
        .summary
        .a2ui_surface_id
        .as_ref()
        .map(|surface| storage.a2ui_surface(&result.summary.workspace_id, surface))
        .transpose()?
        .flatten()
        .ok_or_else(|| AppError::InvalidInput("此成果的交互工具已不可用".into()))?;
    Ok((result, row))
}

pub fn read(storage: &Storage, id: &str) -> Result<SceneToolView, AppError> {
    let (result, row) = resolve(storage, id)?;
    // Only portable tools can be edited through this endpoint; never expose raw protocols as forms.
    super::result::surface_tool_snapshot(&row.state_json)?
        .ok_or_else(|| AppError::InvalidInput("此工具不支持继续填写".into()))?;
    let state_hash = super::result::content_hash(row.state_json.as_bytes());
    Ok(SceneToolView {
        publication: repo::publication(storage, id)?,
        template_id: repo::template_id(storage, id)?,
        result,
        state_hash,
        surface: a2ui::surface_from_row(storage, row)?,
    })
}

pub fn open_template(storage: &Storage, template_id: &str) -> Result<SceneToolView, AppError> {
    open_bound_template(
        storage,
        std::path::Path::new(""),
        template_id,
        &super::scene_link::ToolBinding::None,
    )
}
pub fn open_bound_template(
    storage: &Storage,
    root: &std::path::Path,
    template_id: &str,
    binding: &super::scene_link::ToolBinding,
) -> Result<SceneToolView, AppError> {
    let (source_template, policy) =
        crate::repository::scene_link::template_policy(storage, template_id)?;
    super::scene_link::validate_policy(&policy, binding)?;
    let target = if matches!(binding, super::scene_link::ToolBinding::None) {
        None
    } else {
        Some(super::scene_link::resolve(storage, root, binding)?)
    };
    let state = a2ui::scene_template_state(storage, template_id)?;
    let json = serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?;
    let snapshot =
        super::result::surface_tool_snapshot(&json)?.ok_or(AppError::StateUnavailable)?;
    let id = repo::create(
        storage,
        &state,
        &json,
        &snapshot,
        binding,
        target
            .as_ref()
            .map(|t| (t.title.as_str(), t.hash.as_str(), t.revision.as_deref())),
        (&source_template, &policy),
    )?;
    read(storage, &id)
}

fn input_node<'a>(node: &'a A2uiNode, key: &str) -> Option<&'a A2uiNode> {
    if node.props.get("name").and_then(Value::as_str) == Some(key) {
        return Some(node);
    }
    node.children.iter().find_map(|n| input_node(n, key))
}

pub fn save(storage: &Storage, input: SaveSceneTool) -> Result<SceneToolView, AppError> {
    let (result, row) = resolve(storage, &input.result_id)?;
    if super::result::content_hash(row.state_json.as_bytes()) != input.base_hash {
        return Err(AppError::FileConflict);
    }
    let mut state: A2uiSurfaceState =
        serde_json::from_str(&row.state_json).map_err(|_| AppError::StateUnavailable)?;
    a2ui::validate_surface(&state).map_err(|e| AppError::InvalidInput(e.join("；")))?;
    // Partial input patches retain unrelated fields. Only declared local input bindings are writable.
    for (key, value) in &input.data {
        let node = input_node(&state.root, key)
            .ok_or_else(|| AppError::InvalidInput("未声明的填写字段".into()))?;
        let allowed = node
            .actions
            .get("change")
            .is_some_and(|a| a.action_type == "set_state" && a.target.as_deref() == Some(key));
        if !allowed || node.props.get("disabled") == Some(&Value::Bool(true)) {
            return Err(AppError::InvalidInput("此字段不允许填写".into()));
        }
        a2ui::validate_scene_input(node, value)
            .map_err(|e| AppError::InvalidInput(e.join("；")))?;
    }
    state.data.extend(input.data);
    a2ui::validate_surface(&state).map_err(|e| AppError::InvalidInput(e.join("；")))?;
    let json = serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?;
    let snapshot =
        super::result::surface_tool_snapshot(&json)?.ok_or(AppError::StateUnavailable)?;
    repo::save(storage, &result, &row, &json, &snapshot)?;
    read(storage, &input.result_id)
}
