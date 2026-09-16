use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

use crate::domain::review::{CreateFileProposal, ReplaceEmptyFileProposal};
use crate::patch::DocumentPatch;

pub const SCHEMA_VERSION: &str = "1.0";
pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_NODES: usize = 200;
const MAX_TREE_DEPTH: usize = 12;
const MAX_JSON_DEPTH: usize = 6;
const MAX_STRING_BYTES: usize = 4096;
const MAX_COLLECTION_ITEMS: usize = 100;

pub const ALLOWED_COMPONENTS: &[&str] = &[
    "Row",
    "Column",
    "Stack",
    "Text",
    "Card",
    "Badge",
    "Progress",
    "TextField",
    "Select",
    "Checkbox",
    "Button",
    "Tabs",
    "Form",
    "Checklist",
    "Owner",
    "Date",
    "Status",
    "Table",
    "IssueCard",
    "ResultSummary",
];

#[derive(Debug, Clone, Copy)]
pub struct ComponentPropsSchema {
    pub component: &'static str,
    pub allowed_props: &'static [&'static str],
}

pub const COMPONENT_PROP_SCHEMAS: &[ComponentPropsSchema] = &[
    ComponentPropsSchema {
        component: "Row",
        allowed_props: &["gap", "align", "justify", "wrap"],
    },
    ComponentPropsSchema {
        component: "Column",
        allowed_props: &["gap", "align", "justify"],
    },
    ComponentPropsSchema {
        component: "Stack",
        allowed_props: &["gap", "align"],
    },
    ComponentPropsSchema {
        component: "Text",
        allowed_props: &["text", "variant", "tone", "weight"],
    },
    ComponentPropsSchema {
        component: "Card",
        allowed_props: &["title", "bordered", "padding"],
    },
    ComponentPropsSchema {
        component: "Badge",
        allowed_props: &["text", "tone"],
    },
    ComponentPropsSchema {
        component: "Progress",
        allowed_props: &["value", "label", "status"],
    },
    ComponentPropsSchema {
        component: "TextField",
        allowed_props: &[
            "name",
            "label",
            "placeholder",
            "value",
            "required",
            "disabled",
            "maxLength",
        ],
    },
    ComponentPropsSchema {
        component: "Select",
        allowed_props: &[
            "name",
            "label",
            "placeholder",
            "value",
            "options",
            "required",
            "disabled",
            "allowCustom",
        ],
    },
    ComponentPropsSchema {
        component: "Checkbox",
        allowed_props: &["name", "label", "checked", "disabled"],
    },
    ComponentPropsSchema {
        component: "Button",
        allowed_props: &["label", "variant", "disabled"],
    },
    ComponentPropsSchema {
        component: "Tabs",
        allowed_props: &["activeKey", "items"],
    },
    ComponentPropsSchema {
        component: "Form",
        allowed_props: &["name"],
    },
    ComponentPropsSchema {
        component: "Checklist",
        allowed_props: &["name", "label", "items", "value", "disabled"],
    },
    ComponentPropsSchema {
        component: "Owner",
        allowed_props: &["displayName", "label", "detail", "initials"],
    },
    ComponentPropsSchema {
        component: "Date",
        allowed_props: &[
            "name", "label", "value", "min", "max", "required", "disabled",
        ],
    },
    ComponentPropsSchema {
        component: "Status",
        allowed_props: &["text", "label", "tone"],
    },
    ComponentPropsSchema {
        component: "Table",
        allowed_props: &["caption", "columns", "rows"],
    },
    ComponentPropsSchema {
        component: "IssueCard",
        allowed_props: &[
            "issueKey", "title", "summary", "status", "priority", "owner", "dueDate",
        ],
    },
    ComponentPropsSchema {
        component: "ResultSummary",
        allowed_props: &["title", "fields"],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct A2uiSurfaceState {
    #[serde(default = "legacy_protocol_version")]
    pub protocol_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    pub surface_id: String,
    pub revision: u64,
    pub root: A2uiNode,
    #[serde(default)]
    pub data: Map<String, Value>,
}

fn legacy_protocol_version() -> String {
    SCHEMA_VERSION.into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceMessage {
    pub version: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub surface_id: String,
    pub revision: u64,
    pub root: A2uiNode,
    #[serde(default)]
    pub data: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMessage {
    pub version: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub surface_id: String,
    pub revision: u64,
    pub operations: Vec<UpdateOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum UpdateOperation {
    ReplaceProps {
        node_id: String,
        props: Map<String, Value>,
    },
    ReplaceChildren {
        node_id: String,
        children: Vec<A2uiNode>,
    },
    SetData {
        key: String,
        value: Value,
    },
    RemoveData {
        key: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct A2uiNode {
    pub id: String,
    pub component: String,
    #[serde(default)]
    pub props: Map<String, Value>,
    #[serde(default)]
    pub children: Vec<A2uiNode>,
    #[serde(default)]
    pub actions: BTreeMap<String, A2uiAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "A2uiActionInput")]
pub struct A2uiAction {
    #[serde(rename = "type")]
    pub action_type: String,
    pub target: Option<String>,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum A2uiActionInput {
    Shorthand(String),
    Object(A2uiActionObject),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct A2uiActionObject {
    #[serde(rename = "type")]
    action_type: String,
    target: Option<String>,
    value: Option<Value>,
}

impl From<A2uiActionInput> for A2uiAction {
    fn from(input: A2uiActionInput) -> Self {
        match input {
            A2uiActionInput::Shorthand(action_type) => Self {
                action_type,
                target: None,
                value: None,
            },
            A2uiActionInput::Object(action) => Self {
                action_type: action.action_type,
                target: action.target,
                value: action.value,
            },
        }
    }
}

pub fn is_component_allowed(component: &str) -> bool {
    ALLOWED_COMPONENTS.contains(&component)
}

pub fn validate_surface(surface: &A2uiSurfaceState) -> Result<Vec<String>, Vec<String>> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    if !valid_id(&surface.surface_id) {
        errors.push("surfaceId 必须是 1-80 位安全标识".into());
    }
    if surface.revision == 0 {
        errors.push("revision 必须从 1 开始".into());
    }
    if surface.data.len() > 64 {
        errors.push("data 顶层字段不能超过 64 个".into());
    }
    for (key, value) in &surface.data {
        if !valid_key(key) {
            errors.push(format!("data 字段名无效：{key}"));
        }
        validate_json_value(value, 0, &format!("data.{key}"), &mut errors);
    }
    let mut node_count = 0usize;
    let mut node_ids = BTreeSet::new();
    validate_node(
        &surface.root,
        1,
        &mut node_count,
        &mut node_ids,
        &mut errors,
        &mut warnings,
    );
    if node_count > MAX_NODES {
        errors.push(format!("组件节点不能超过 {MAX_NODES} 个"));
    }
    validate_result_summary_bindings(&surface.root, &surface.data, &mut errors);
    if errors.is_empty() {
        Ok(warnings)
    } else {
        Err(errors)
    }
}

pub(super) fn normalize_surface(
    surface: &mut A2uiSurfaceState,
) -> Result<Vec<String>, Vec<String>> {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    normalize_node(&mut surface.root, &mut warnings, &mut errors);
    if errors.is_empty() {
        Ok(warnings)
    } else {
        Err(errors)
    }
}

pub fn apply_update(
    current: &A2uiSurfaceState,
    update: UpdateMessage,
) -> Result<(A2uiSurfaceState, Vec<String>), Vec<String>> {
    let mut errors = Vec::new();
    if update.version != SCHEMA_VERSION || update.message_type != "a2ui_update" {
        errors.push("增量消息必须使用 version=1.0、type=a2ui_update".into());
    }
    if update.surface_id != current.surface_id {
        errors.push("增量消息 surfaceId 与现有 Surface 不匹配".into());
    }
    if update.revision != current.revision + 1 {
        errors.push(format!("增量 revision 必须为 {}", current.revision + 1));
    }
    if update.operations.is_empty() || update.operations.len() > 50 {
        errors.push("增量操作数量必须为 1 到 50".into());
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut next = current.clone();
    next.revision = update.revision;
    for operation in update.operations {
        match operation {
            UpdateOperation::ReplaceProps { node_id, props } => {
                if let Some(node) = find_node_mut(&mut next.root, &node_id) {
                    node.props = props;
                } else {
                    errors.push(format!("找不到增量目标节点：{node_id}"));
                }
            }
            UpdateOperation::ReplaceChildren { node_id, children } => {
                if let Some(node) = find_node_mut(&mut next.root, &node_id) {
                    node.children = children;
                } else {
                    errors.push(format!("找不到增量目标节点：{node_id}"));
                }
            }
            UpdateOperation::SetData { key, value } => {
                if valid_key(&key) {
                    next.data.insert(key, value);
                } else {
                    errors.push(format!("增量 data 字段名无效：{key}"));
                }
            }
            UpdateOperation::RemoveData { key } => {
                next.data.remove(&key);
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let mut warnings = normalize_surface(&mut next)?;
    warnings.extend(validate_surface(&next)?);
    Ok((next, warnings))
}

pub fn find_node<'a>(node: &'a A2uiNode, node_id: &str) -> Option<&'a A2uiNode> {
    if node.id == node_id {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_node(child, node_id))
}

pub fn validate_runtime_value(value: &Value) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    validate_json_value(value, 0, "payload", &mut errors);
    if serde_json::to_vec(value)
        .map(|bytes| bytes.len() > 32 * 1024)
        .unwrap_or(true)
    {
        errors.push("Action payload 不能超过 32 KiB".into());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

pub fn validate_runtime_input_value(node: &A2uiNode, value: &Value) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    validate_input_value(node, value, &mut errors);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn find_node_mut<'a>(node: &'a mut A2uiNode, node_id: &str) -> Option<&'a mut A2uiNode> {
    if node.id == node_id {
        return Some(node);
    }
    node.children
        .iter_mut()
        .find_map(|child| find_node_mut(child, node_id))
}

fn normalize_node(node: &mut A2uiNode, warnings: &mut Vec<String>, errors: &mut Vec<String>) {
    let actions = std::mem::take(&mut node.actions);
    for (event, action) in actions {
        let canonical_event = match event.as_str() {
            "on_click" | "onClick" => "click",
            "on_change" | "onChange" => "change",
            "on_submit" | "onSubmit" => "submit",
            "on_tab_change" | "onTabChange" => "tab_change",
            _ => event.as_str(),
        }
        .to_string();
        if canonical_event != event {
            warnings.push(format!(
                "组件 {} 的事件 {event} 已规范化为 {canonical_event}",
                node.id
            ));
        }
        match node.actions.entry(canonical_event) {
            std::collections::btree_map::Entry::Occupied(entry) => {
                errors.push(format!(
                    "组件 {} 同时声明了重复事件：{}",
                    node.id,
                    entry.key()
                ));
            }
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(action);
            }
        }
    }

    if node.component == "Select" {
        if let Some(Value::Array(options)) = node.props.get_mut("options") {
            let mut normalized_count = 0usize;
            for option in options {
                if let Value::String(label) = option {
                    let label = label.clone();
                    let mut canonical = Map::new();
                    canonical.insert("label".into(), Value::String(label.clone()));
                    canonical.insert("value".into(), Value::String(label));
                    *option = Value::Object(canonical);
                    normalized_count += 1;
                }
            }
            if normalized_count > 0 {
                warnings.push(format!(
                    "组件 {} 的 {normalized_count} 个字符串选项已规范化为 label/value 对象",
                    node.id
                ));
            }
        }
    }

    if matches!(
        node.component.as_str(),
        "TextField" | "Select" | "Checkbox" | "Checklist" | "Date"
    ) {
        if let Some(name) = node.props.get("name").and_then(Value::as_str) {
            if !node.actions.contains_key("change") {
                node.actions.insert(
                    "change".into(),
                    A2uiAction {
                        action_type: "set_state".into(),
                        target: Some(name.to_string()),
                        value: None,
                    },
                );
                warnings.push(format!(
                    "组件 {} 缺少输入绑定，已补充安全 set_state Action",
                    node.id
                ));
            }
        }
    }

    for child in &mut node.children {
        normalize_node(child, warnings, errors);
    }
}

fn validate_node(
    node: &A2uiNode,
    depth: usize,
    node_count: &mut usize,
    node_ids: &mut BTreeSet<String>,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    *node_count += 1;
    if depth > MAX_TREE_DEPTH {
        errors.push(format!("组件树深度不能超过 {MAX_TREE_DEPTH}"));
        return;
    }
    if !valid_id(&node.id) {
        errors.push(format!("组件 id 无效：{}", node.id));
    } else if !node_ids.insert(node.id.clone()) {
        errors.push(format!("组件 id 重复：{}", node.id));
    }
    if !is_component_allowed(&node.component) {
        errors.push(format!("未注册组件：{}", node.component));
    }
    validate_props(node, errors, warnings);
    if node.children.len() > 50 {
        errors.push(format!("组件 {} 的子节点不能超过 50 个", node.id));
    }
    validate_actions(node, errors);
    for child in &node.children {
        validate_node(child, depth + 1, node_count, node_ids, errors, warnings);
    }
}

fn validate_props(node: &A2uiNode, errors: &mut Vec<String>, warnings: &mut Vec<String>) {
    if node.props.len() > 32 {
        errors.push(format!("组件 {} 的 Props 不能超过 32 项", node.id));
        return;
    }
    let allowed = COMPONENT_PROP_SCHEMAS
        .iter()
        .find(|schema| schema.component == node.component)
        .map(|schema| schema.allowed_props)
        .unwrap_or_default();
    for (key, value) in &node.props {
        if !allowed.contains(&key.as_str()) {
            errors.push(format!("组件 {} 不支持 Prop：{key}", node.id));
        }
        if is_executable_key(key) {
            errors.push(format!("组件 {} 包含禁止的可执行 Prop：{key}", node.id));
        }
        validate_json_value(value, 0, &format!("{}.props.{key}", node.id), errors);
    }
    match node.component.as_str() {
        "Text" => require_string(node, "text", 1, MAX_STRING_BYTES, errors),
        "Badge" => require_string(node, "text", 1, 120, errors),
        "Progress" => {
            let value = node.props.get("value").and_then(Value::as_f64);
            if !matches!(value, Some(number) if (0.0..=100.0).contains(&number)) {
                errors.push(format!("组件 {} 的 value 必须在 0 到 100", node.id));
            }
        }
        "TextField" => {
            require_string(node, "name", 1, 80, errors);
            if let Some(max) = node.props.get("maxLength").and_then(Value::as_u64) {
                if !(1..=1000).contains(&max) {
                    errors.push(format!("组件 {} 的 maxLength 必须为 1 到 1000", node.id));
                }
            }
        }
        "Select" => {
            require_string(node, "name", 1, 80, errors);
            validate_select_options(node, errors);
        }
        "Checkbox" => require_string(node, "name", 1, 80, errors),
        "Button" => require_string(node, "label", 1, 120, errors),
        "Tabs" => validate_tab_items(node, errors),
        "Checklist" => validate_checklist(node, errors),
        "Owner" => validate_owner(node, errors),
        "Date" => validate_date(node, errors),
        "Status" => {
            require_string(node, "text", 1, 120, errors);
            optional_string(node, "label", 1, 80, errors);
        }
        "Table" => validate_table(node, errors),
        "IssueCard" => validate_issue_card(node, errors),
        "ResultSummary" => validate_result_summary(node, errors),
        _ => {}
    }
    validate_enum(node, "gap", &["xs", "sm", "md", "lg"], errors);
    validate_enum(
        node,
        "align",
        &["start", "center", "end", "stretch"],
        errors,
    );
    validate_enum(
        node,
        "justify",
        &["start", "center", "end", "between"],
        errors,
    );
    validate_enum(
        node,
        "variant",
        &["body", "title", "caption", "primary", "default", "danger"],
        errors,
    );
    validate_enum(
        node,
        "tone",
        &["default", "muted", "success", "warning", "danger", "info"],
        errors,
    );
    if node.component == "Progress" {
        validate_enum(
            node,
            "status",
            &["normal", "success", "exception", "active"],
            errors,
        );
    }
    for bool_key in [
        "wrap",
        "bordered",
        "required",
        "disabled",
        "checked",
        "allowCustom",
    ] {
        if let Some(value) = node.props.get(bool_key) {
            if !value.is_boolean() {
                errors.push(format!("组件 {} 的 {bool_key} 必须是布尔值", node.id));
            }
        }
    }
    if node.component == "Stack" && node.children.len() > 8 {
        warnings.push(format!("Stack {} 子节点较多，可能影响可读性", node.id));
    }
    if matches!(
        node.component.as_str(),
        "Checklist" | "Owner" | "Date" | "Status" | "Table" | "ResultSummary"
    ) && !node.children.is_empty()
    {
        errors.push(format!("组件 {} 不允许 children", node.id));
    }
}

fn validate_result_summary(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "title", 1, 120, errors);
    let Some(fields) = node.props.get("fields").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 fields 必须是数组", node.id));
        return;
    };
    if fields.is_empty() || fields.len() > 20 {
        errors.push(format!(
            "组件 {} 的 ResultSummary fields 数量必须为 1 到 20",
            node.id
        ));
    }
    let mut unique = BTreeSet::new();
    for field in fields {
        let Some(field) = field.as_str() else {
            errors.push(format!("组件 {} 的 fields 必须是字符串数组", node.id));
            continue;
        };
        if !valid_key(field) || !unique.insert(field) {
            errors.push(format!(
                "组件 {} 的 ResultSummary field 无效或重复：{}",
                node.id, field
            ));
        }
    }
}

fn validate_result_summary_bindings(
    root: &A2uiNode,
    data: &Map<String, Value>,
    errors: &mut Vec<String>,
) {
    let mut input_names = BTreeSet::new();
    let mut summaries = Vec::new();
    collect_result_bindings(root, &mut input_names, &mut summaries);
    if summaries.len() > 1 {
        errors.push("每个 Surface 最多只能包含一个 ResultSummary".into());
    }
    for (summary_id, fields) in summaries {
        for field in fields {
            if !input_names.contains(field.as_str()) {
                errors.push(format!(
                    "组件 {summary_id} 的结果字段未绑定真实输入：{field}"
                ));
            } else if let (Some(input), Some(value)) =
                (find_input_node(root, &field), data.get(&field))
            {
                validate_input_value(input, value, errors);
            }
        }
    }
}

fn find_input_node<'a>(node: &'a A2uiNode, name: &str) -> Option<&'a A2uiNode> {
    if node.props.get("name").and_then(Value::as_str) == Some(name) {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_input_node(child, name))
}

fn validate_input_value(node: &A2uiNode, value: &Value, errors: &mut Vec<String>) {
    match node.component.as_str() {
        "TextField" => {
            let max = node
                .props
                .get("maxLength")
                .and_then(Value::as_u64)
                .unwrap_or(1000) as usize;
            if value.as_str().is_none_or(|text| text.chars().count() > max) {
                errors.push(format!("组件 {} 的输入值必须是限长文本", node.id));
            }
        }
        "Select" => {
            let Some(selected) = value.as_str() else {
                errors.push(format!("组件 {} 的选择值必须是文本", node.id));
                return;
            };
            if selected.chars().count() > 1000 {
                errors.push(format!("组件 {} 的选择值过长", node.id));
            }
            if node.props.get("allowCustom").and_then(Value::as_bool) == Some(false) {
                let allowed = node
                    .props
                    .get("options")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .any(|option| option.get("value").and_then(Value::as_str) == Some(selected));
                if !allowed {
                    errors.push(format!("组件 {} 的选择值不在固定选项中", node.id));
                }
            }
        }
        "Checkbox" => {
            if !value.is_boolean() {
                errors.push(format!("组件 {} 的勾选值必须是布尔值", node.id));
            }
        }
        "Checklist" => {
            let allowed = node
                .props
                .get("items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("key").and_then(Value::as_str))
                .collect::<BTreeSet<_>>();
            let Some(selected) = value.as_array() else {
                errors.push(format!("组件 {} 的清单值必须是字符串数组", node.id));
                return;
            };
            let mut unique = BTreeSet::new();
            if selected.iter().any(|item| {
                item.as_str()
                    .is_none_or(|key| !allowed.contains(key) || !unique.insert(key))
            }) {
                errors.push(format!("组件 {} 的清单值包含未知或重复项目", node.id));
            }
        }
        "Date" => {
            if value
                .as_str()
                .is_none_or(|date| !date.is_empty() && !valid_iso_date(date))
            {
                errors.push(format!("组件 {} 的日期值必须是 YYYY-MM-DD", node.id));
            }
        }
        _ => errors.push(format!("组件 {} 不是可写输入组件", node.id)),
    }
}

fn collect_result_bindings(
    node: &A2uiNode,
    input_names: &mut BTreeSet<String>,
    summaries: &mut Vec<(String, Vec<String>)>,
) {
    if matches!(
        node.component.as_str(),
        "TextField" | "Select" | "Checkbox" | "Checklist" | "Date"
    ) {
        if let Some(name) = node.props.get("name").and_then(Value::as_str) {
            input_names.insert(name.to_string());
        }
    }
    if node.component == "ResultSummary" {
        let fields = node
            .props
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        summaries.push((node.id.clone(), fields));
    }
    for child in &node.children {
        collect_result_bindings(child, input_names, summaries);
    }
}

fn validate_actions(node: &A2uiNode, errors: &mut Vec<String>) {
    for (event, action) in &node.actions {
        if !["click", "change", "submit", "tab_change"].contains(&event.as_str()) {
            errors.push(format!("组件 {} 的事件不受支持：{event}", node.id));
        }
        match action.action_type.as_str() {
            "set_state" => {
                if action
                    .target
                    .as_deref()
                    .is_none_or(|target| !valid_key(target))
                {
                    errors.push(format!("组件 {} 的 set_state 缺少安全 target", node.id));
                }
                if let Some(value) = &action.value {
                    validate_json_value(value, 0, "action.value", errors);
                }
            }
            "submit_form" => {
                if event != "submit" && event != "click" {
                    errors.push(format!(
                        "组件 {} 的 submit_form 只能绑定 submit/click",
                        node.id
                    ));
                }
            }
            "request_patch" => {
                if event != "click" && event != "submit" {
                    errors.push(format!("组件 {} 的 request_patch 事件无效", node.id));
                }
                if action.target.is_some() {
                    errors.push(format!(
                        "组件 {} 的 request_patch 不允许携带 target；目标只能来自受限审阅候选",
                        node.id
                    ));
                }
                match action.value.as_ref() {
                    Some(value) => validate_review_candidate(node, value, errors),
                    None => errors.push(format!(
                        "组件 {} 的 request_patch 必须携带可审阅候选 value",
                        node.id
                    )),
                }
            }
            other => errors.push(format!("组件 {} 包含未授权 Action：{other}", node.id)),
        }
    }
}

fn validate_review_candidate(node: &A2uiNode, value: &Value, errors: &mut Vec<String>) {
    validate_json_value(value, 0, "action.value", errors);
    let Some(candidate_type) = value.get("type").and_then(Value::as_str) else {
        errors.push(format!(
            "组件 {} 的 request_patch value 缺少候选类型",
            node.id
        ));
        return;
    };
    let schema_error = match candidate_type {
        "document_patch" => serde_json::from_value::<DocumentPatch>(value.clone()).err(),
        "create_file" => serde_json::from_value::<CreateFileProposal>(value.clone()).err(),
        "replace_empty_file" => {
            serde_json::from_value::<ReplaceEmptyFileProposal>(value.clone()).err()
        }
        _ => {
            errors.push(format!(
                "组件 {} 的 request_patch 候选类型不受支持：{}",
                node.id, candidate_type
            ));
            return;
        }
    };
    if let Some(error) = schema_error {
        errors.push(format!(
            "组件 {} 的 request_patch 候选 Schema 无效：{}",
            node.id, error
        ));
    }
}

fn validate_json_value(value: &Value, depth: usize, path: &str, errors: &mut Vec<String>) {
    if depth > MAX_JSON_DEPTH {
        errors.push(format!("{path} 的 JSON 深度超过 {MAX_JSON_DEPTH}"));
        return;
    }
    match value {
        Value::String(text) if text.len() > MAX_STRING_BYTES => {
            errors.push(format!("{path} 的字符串超过 {MAX_STRING_BYTES} 字节"));
        }
        Value::Array(items) => {
            if items.len() > MAX_COLLECTION_ITEMS {
                errors.push(format!("{path} 的数组不能超过 {MAX_COLLECTION_ITEMS} 项"));
            }
            for item in items {
                validate_json_value(item, depth + 1, path, errors);
            }
        }
        Value::Object(map) => {
            if map.len() > MAX_COLLECTION_ITEMS {
                errors.push(format!("{path} 的对象不能超过 {MAX_COLLECTION_ITEMS} 项"));
            }
            for (key, item) in map {
                if is_executable_key(key) {
                    errors.push(format!("{path} 包含禁止字段：{key}"));
                }
                validate_json_value(item, depth + 1, path, errors);
            }
        }
        _ => {}
    }
}

fn validate_select_options(node: &A2uiNode, errors: &mut Vec<String>) {
    let Some(options) = node.props.get("options").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 options 必须是数组", node.id));
        return;
    };
    if options.is_empty() || options.len() > 50 {
        errors.push(format!("组件 {} 的 options 数量必须为 1 到 50", node.id));
    }
    for option in options {
        let Some(map) = option.as_object() else {
            errors.push(format!("组件 {} 的 option 必须是对象", node.id));
            continue;
        };
        if map.len() != 2
            || map.get("label").and_then(Value::as_str).is_none()
            || map.get("value").and_then(Value::as_str).is_none()
        {
            errors.push(format!(
                "组件 {} 的 option 只能包含字符串 label/value",
                node.id
            ));
        }
    }
}

fn validate_tab_items(node: &A2uiNode, errors: &mut Vec<String>) {
    let Some(items) = node.props.get("items").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 items 必须是数组", node.id));
        return;
    };
    if items.is_empty() || items.len() > 20 || items.len() != node.children.len() {
        errors.push(format!(
            "组件 {} 的 Tabs items 必须为 1 到 20 项且与 children 数量一致",
            node.id
        ));
    }
    for item in items {
        let Some(map) = item.as_object() else {
            errors.push(format!("组件 {} 的 Tab item 必须是对象", node.id));
            continue;
        };
        if map.len() != 2
            || map.get("key").and_then(Value::as_str).is_none()
            || map.get("label").and_then(Value::as_str).is_none()
        {
            errors.push(format!(
                "组件 {} 的 Tab item 只能包含字符串 key/label",
                node.id
            ));
        }
    }
}

fn validate_checklist(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "name", 1, 80, errors);
    require_string(node, "label", 1, 120, errors);
    let Some(items) = node.props.get("items").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 items 必须是数组", node.id));
        return;
    };
    if items.is_empty() || items.len() > 50 {
        errors.push(format!(
            "组件 {} 的 Checklist items 数量必须为 1 到 50",
            node.id
        ));
    }
    let mut keys = BTreeSet::new();
    for item in items {
        let Some(map) = item.as_object() else {
            errors.push(format!("组件 {} 的 Checklist item 必须是对象", node.id));
            continue;
        };
        if map
            .keys()
            .any(|key| !["key", "label", "disabled"].contains(&key.as_str()))
            || map.get("key").and_then(Value::as_str).is_none()
            || map.get("label").and_then(Value::as_str).is_none()
            || map.get("disabled").is_some_and(|value| !value.is_boolean())
        {
            errors.push(format!(
                "组件 {} 的 Checklist item 只能包含字符串 key/label 和可选布尔 disabled",
                node.id
            ));
            continue;
        }
        let key = map.get("key").and_then(Value::as_str).unwrap_or_default();
        let label = map.get("label").and_then(Value::as_str).unwrap_or_default();
        if !valid_id(key) || label.is_empty() || label.len() > 240 || !keys.insert(key) {
            errors.push(format!(
                "组件 {} 的 Checklist item key/label 无效或重复",
                node.id
            ));
        }
    }
    if let Some(value) = node.props.get("value") {
        let Some(selected) = value.as_array() else {
            errors.push(format!("组件 {} 的 value 必须是字符串数组", node.id));
            return;
        };
        let mut selected_keys = BTreeSet::new();
        for selected_key in selected {
            let Some(selected_key) = selected_key.as_str() else {
                errors.push(format!("组件 {} 的 value 必须是字符串数组", node.id));
                continue;
            };
            if !keys.contains(selected_key) || !selected_keys.insert(selected_key) {
                errors.push(format!(
                    "组件 {} 的 value 包含未知或重复 Checklist key",
                    node.id
                ));
            }
        }
    }
}

fn validate_owner(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "displayName", 1, 120, errors);
    optional_string(node, "label", 1, 80, errors);
    optional_string(node, "detail", 1, 240, errors);
    optional_string(node, "initials", 1, 8, errors);
}

fn validate_date(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "name", 1, 80, errors);
    require_string(node, "label", 1, 120, errors);
    for key in ["value", "min", "max"] {
        if let Some(value) = node.props.get(key) {
            if value.as_str().is_none_or(|date| !valid_iso_date(date)) {
                errors.push(format!("组件 {} 的 {key} 必须是 YYYY-MM-DD 日期", node.id));
            }
        }
    }
    if let (Some(min), Some(max)) = (
        node.props.get("min").and_then(Value::as_str),
        node.props.get("max").and_then(Value::as_str),
    ) {
        if min > max {
            errors.push(format!("组件 {} 的 min 不能晚于 max", node.id));
        }
    }
}

fn validate_table(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "caption", 1, 160, errors);
    let Some(columns) = node.props.get("columns").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 columns 必须是数组", node.id));
        return;
    };
    if columns.is_empty() || columns.len() > 12 {
        errors.push(format!("组件 {} 的 columns 数量必须为 1 到 12", node.id));
    }
    let mut column_keys = BTreeSet::new();
    for column in columns {
        let Some(map) = column.as_object() else {
            errors.push(format!("组件 {} 的 column 必须是对象", node.id));
            continue;
        };
        if map
            .keys()
            .any(|key| !["key", "label", "align"].contains(&key.as_str()))
            || map.get("key").and_then(Value::as_str).is_none()
            || map.get("label").and_then(Value::as_str).is_none()
            || map.get("align").is_some_and(|value| {
                value
                    .as_str()
                    .is_none_or(|align| !["start", "center", "end"].contains(&align))
            })
        {
            errors.push(format!(
                "组件 {} 的 column 只能包含字符串 key/label 和可选 align",
                node.id
            ));
            continue;
        }
        let key = map.get("key").and_then(Value::as_str).unwrap_or_default();
        let label = map.get("label").and_then(Value::as_str).unwrap_or_default();
        if !valid_id(key) || label.is_empty() || label.len() > 120 || !column_keys.insert(key) {
            errors.push(format!("组件 {} 的 column key/label 无效或重复", node.id));
        }
    }

    let Some(rows) = node.props.get("rows").and_then(Value::as_array) else {
        errors.push(format!("组件 {} 的 rows 必须是数组", node.id));
        return;
    };
    if rows.len() > 50 {
        errors.push(format!("组件 {} 的 rows 不能超过 50 行", node.id));
    }
    for row in rows {
        let Some(map) = row.as_object() else {
            errors.push(format!("组件 {} 的 row 必须是对象", node.id));
            continue;
        };
        for (key, value) in map {
            if !column_keys.contains(key.as_str()) {
                errors.push(format!("组件 {} 的 row 包含未知列：{key}", node.id));
            }
            if !matches!(
                value,
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
            ) {
                errors.push(format!("组件 {} 的表格单元格只能是基础值", node.id));
            }
        }
    }
}

fn validate_issue_card(node: &A2uiNode, errors: &mut Vec<String>) {
    require_string(node, "issueKey", 1, 40, errors);
    require_string(node, "title", 1, 240, errors);
    optional_string(node, "summary", 1, 1000, errors);
    optional_string(node, "owner", 1, 120, errors);
    require_string(node, "status", 1, 40, errors);
    validate_enum(
        node,
        "status",
        &["open", "in_progress", "blocked", "done", "closed"],
        errors,
    );
    validate_enum(
        node,
        "priority",
        &["low", "normal", "high", "urgent"],
        errors,
    );
    if let Some(value) = node.props.get("dueDate") {
        if value.as_str().is_none_or(|date| !valid_iso_date(date)) {
            errors.push(format!(
                "组件 {} 的 dueDate 必须是 YYYY-MM-DD 日期",
                node.id
            ));
        }
    }
}

fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let year = digits_to_u32(&bytes[0..4]);
    let month = digits_to_u32(&bytes[5..7]);
    let day = digits_to_u32(&bytes[8..10]);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
}

fn digits_to_u32(value: &[u8]) -> u32 {
    value
        .iter()
        .fold(0, |number, digit| number * 10 + u32::from(digit - b'0'))
}

fn optional_string(node: &A2uiNode, key: &str, min: usize, max: usize, errors: &mut Vec<String>) {
    if node.props.contains_key(key) {
        require_string(node, key, min, max, errors);
    }
}

fn require_string(node: &A2uiNode, key: &str, min: usize, max: usize, errors: &mut Vec<String>) {
    let value = node.props.get(key).and_then(Value::as_str);
    if !matches!(value, Some(text) if text.len() >= min && text.len() <= max) {
        errors.push(format!(
            "组件 {} 的 {key} 必须是 {min}-{max} 字节字符串",
            node.id
        ));
    }
}

fn validate_enum(node: &A2uiNode, key: &str, allowed: &[&str], errors: &mut Vec<String>) {
    if let Some(value) = node.props.get(key) {
        if value
            .as_str()
            .is_none_or(|candidate| !allowed.contains(&candidate))
        {
            errors.push(format!("组件 {} 的 {key} 枚举值无效", node.id));
        }
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

pub(super) fn valid_key(value: &str) -> bool {
    valid_id(value) && !value.starts_with('.')
}

fn is_executable_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.starts_with("on")
        || matches!(
            normalized.as_str(),
            "html"
                | "innerhtml"
                | "dangerouslysetinnerhtml"
                | "srcdoc"
                | "script"
                | "iframe"
                | "command"
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_surface() -> A2uiSurfaceState {
        serde_json::from_value(json!({
            "surfaceId": "demo",
            "revision": 1,
            "root": {
                "id": "root",
                "component": "Column",
                "props": {"gap": "md"},
                "children": [{
                    "id": "title",
                    "component": "Text",
                    "props": {"text": "Safe UI", "variant": "title"}
                }]
            },
            "data": {}
        }))
        .unwrap()
    }

    #[test]
    fn accepts_registered_components_and_safe_props() {
        assert!(validate_surface(&valid_surface()).is_ok());
        assert_eq!(ALLOWED_COMPONENTS.len(), 20);
        assert_eq!(COMPONENT_PROP_SCHEMAS.len(), ALLOWED_COMPONENTS.len());
        let schema_components = COMPONENT_PROP_SCHEMAS
            .iter()
            .map(|schema| schema.component)
            .collect::<BTreeSet<_>>();
        assert_eq!(schema_components.len(), ALLOWED_COMPONENTS.len());
        assert!(ALLOWED_COMPONENTS
            .iter()
            .all(|component| schema_components.contains(component)));
    }

    #[test]
    fn accepts_s32_catalog_components_with_independent_props_schemas() {
        let mut surface = valid_surface();
        surface.root.children = serde_json::from_value(json!([
            {
                "id": "checklist",
                "component": "Checklist",
                "props": {
                    "name": "doneItems",
                    "label": "上线清单",
                    "items": [
                        {"key": "review", "label": "完成评审"},
                        {"key": "release", "label": "准备发布", "disabled": false}
                    ],
                    "value": ["review"]
                }
            },
            {
                "id": "owner",
                "component": "Owner",
                "props": {"displayName": "Ada", "label": "负责人", "detail": "产品", "initials": "AD"}
            },
            {
                "id": "date",
                "component": "Date",
                "props": {"name": "dueDate", "label": "截止日期", "value": "2026-09-30", "min": "2026-09-01", "max": "2026-12-31"}
            },
            {
                "id": "status",
                "component": "Status",
                "props": {"text": "进行中", "label": "状态", "tone": "info"}
            },
            {
                "id": "table",
                "component": "Table",
                "props": {
                    "caption": "任务概览",
                    "columns": [
                        {"key": "task", "label": "任务"},
                        {"key": "progress", "label": "进度", "align": "end"}
                    ],
                    "rows": [{"task": "设计", "progress": 80}]
                }
            },
            {
                "id": "issue",
                "component": "IssueCard",
                "props": {
                    "issueKey": "A2UI-32",
                    "title": "扩展大众组件",
                    "summary": "固定 Catalog 渲染",
                    "status": "in_progress",
                    "priority": "high",
                    "owner": "Ada",
                    "dueDate": "2026-09-30"
                }
            }
        ]))
        .unwrap();

        assert!(validate_surface(&surface).is_ok());
    }

    #[test]
    fn rejects_invalid_s32_props_without_falling_back_to_generic_json() {
        let mut surface = valid_surface();
        surface.root.children = serde_json::from_value(json!([
            {
                "id": "checklist",
                "component": "Checklist",
                "props": {"name": "items", "label": "清单", "items": [{"key": "same", "label": "一"}, {"key": "same", "label": "二"}]}
            },
            {
                "id": "date",
                "component": "Date",
                "props": {"name": "date", "label": "日期", "value": "2026-02-30"}
            },
            {
                "id": "table",
                "component": "Table",
                "props": {"caption": "表格", "columns": [{"key": "name", "label": "名称"}], "rows": [{"unknown": {"html": "bad"}}]}
            },
            {
                "id": "issue",
                "component": "IssueCard",
                "props": {"issueKey": "X-1", "title": "Issue", "status": "running", "priority": "critical", "dueDate": "tomorrow"}
            }
        ]))
        .unwrap();

        let errors = validate_surface(&surface).unwrap_err().join(" ");
        assert!(errors.contains("Checklist item key/label 无效或重复"));
        assert!(errors.contains("YYYY-MM-DD 日期"));
        assert!(errors.contains("未知列"));
        assert!(errors.contains("表格单元格只能是基础值"));
        assert!(errors.contains("status 枚举值无效"));
        assert!(errors.contains("priority 枚举值无效"));
    }

    #[test]
    fn normalizes_safe_action_shorthand_before_validation() {
        let mut surface = valid_surface();
        surface.root.children.push(
            serde_json::from_value(json!({
                "id": "submit",
                "component": "Button",
                "props": {"label": "Submit"},
                "actions": {"click": "submit_form"}
            }))
            .unwrap(),
        );
        assert!(validate_surface(&surface).is_ok());
        assert_eq!(
            surface.root.children[1].actions["click"].action_type,
            "submit_form"
        );
    }

    #[test]
    fn shorthand_does_not_bypass_action_policy_validation() {
        let mut surface = valid_surface();
        surface.root.children.push(
            serde_json::from_value(json!({
                "id": "unsafe",
                "component": "Button",
                "props": {"label": "Run"},
                "actions": {"click": "system_command"}
            }))
            .unwrap(),
        );
        let errors = validate_surface(&surface).unwrap_err().join(" ");
        assert!(errors.contains("未授权 Action"));
    }

    #[test]
    fn rejects_unknown_components_and_executable_props() {
        let mut surface = valid_surface();
        surface.root.component = "Script".into();
        surface
            .root
            .props
            .insert("dangerouslySetInnerHTML".into(), json!("<script/>"));
        let errors = validate_surface(&surface).unwrap_err().join(" ");
        assert!(errors.contains("未注册组件"));
        assert!(errors.contains("禁止"));
    }

    #[test]
    fn incremental_update_changes_only_the_targeted_state() {
        let current = valid_surface();
        let update: UpdateMessage = serde_json::from_value(json!({
            "version": "1.0",
            "type": "a2ui_update",
            "surfaceId": "demo",
            "revision": 2,
            "operations": [{"op": "set_data", "key": "name", "value": "Ada"}]
        }))
        .unwrap();
        let (next, _) = apply_update(&current, update).unwrap();
        assert_eq!(next.root.id, current.root.id);
        assert_eq!(next.data.get("name"), Some(&json!("Ada")));
    }

    #[test]
    fn normalizes_common_model_select_and_event_shorthand() {
        let mut surface: A2uiSurfaceState = serde_json::from_value(json!({
            "surfaceId": "form",
            "revision": 1,
            "root": {
                "id": "root",
                "component": "Column",
                "children": [
                    {
                        "id": "role",
                        "component": "Select",
                        "props": {"name": "role", "options": ["管理员", "访客"]}
                    },
                    {
                        "id": "submit",
                        "component": "Button",
                        "props": {"label": "提交"},
                        "actions": {"on_click": {"type": "submit_form"}}
                    }
                ]
            }
        }))
        .unwrap();
        let warnings = normalize_surface(&mut surface).unwrap();
        assert_eq!(
            surface.root.children[0].props["options"][0]["value"],
            "管理员"
        );
        assert!(surface.root.children[1].actions.contains_key("click"));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("字符串选项")));
        assert!(validate_surface(&surface).is_ok());
    }

    #[test]
    fn rejects_event_alias_collision_instead_of_overwriting() {
        let mut surface = valid_surface();
        surface.root.actions = serde_json::from_value(json!({
            "click": {"type": "submit_form"},
            "on_click": {"type": "request_patch"}
        }))
        .unwrap();
        assert!(normalize_surface(&mut surface)
            .unwrap_err()
            .join(" ")
            .contains("重复事件"));
    }

    #[test]
    fn rejects_excessive_component_depth() {
        let mut child = A2uiNode {
            id: "leaf".into(),
            component: "Text".into(),
            props: serde_json::from_value(json!({"text": "leaf"})).unwrap(),
            children: Vec::new(),
            actions: BTreeMap::new(),
        };
        for index in 0..13 {
            child = A2uiNode {
                id: format!("level-{index}"),
                component: "Column".into(),
                props: Map::new(),
                children: vec![child],
                actions: BTreeMap::new(),
            };
        }
        let mut surface = valid_surface();
        surface.root = child;
        assert!(validate_surface(&surface)
            .unwrap_err()
            .join(" ")
            .contains("深度"));
    }

    #[test]
    fn result_summary_requires_real_input_bindings() {
        let mut surface = valid_surface();
        surface.root.children.push(A2uiNode {
            id: "result".into(),
            component: "ResultSummary".into(),
            props: serde_json::from_value(json!({
                "title":"当前结果",
                "fields":["missingField"]
            }))
            .unwrap(),
            children: Vec::new(),
            actions: BTreeMap::new(),
        });
        assert!(validate_surface(&surface)
            .unwrap_err()
            .join(" ")
            .contains("未绑定真实输入"));

        surface.root.children.insert(
            0,
            A2uiNode {
                id: "field".into(),
                component: "TextField".into(),
                props: serde_json::from_value(json!({
                    "name":"missingField","label":"真实字段"
                }))
                .unwrap(),
                children: Vec::new(),
                actions: serde_json::from_value(json!({
                    "change":{"type":"set_state","target":"missingField"}
                }))
                .unwrap(),
            },
        );
        assert!(validate_surface(&surface).is_ok());
    }
}
