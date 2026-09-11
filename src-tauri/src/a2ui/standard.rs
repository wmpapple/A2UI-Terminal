use super::capabilities::{
    is_supported_version, A2UI_MIME_TYPE, CATALOG_ID, OFFICIAL_PROTOCOL_VERSION,
};
use super::protocol::{valid_key, A2uiAction, A2uiNode, A2uiSurfaceState};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

const MAX_BATCH_MESSAGES: usize = 50;

#[derive(Debug, Clone)]
pub struct StandardBatch {
    pub version: String,
    pub catalog_id: String,
    pub state: A2uiSurfaceState,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DataPart {
    data: Vec<Value>,
    kind: String,
    metadata: DataPartMetadata,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DataPartMetadata {
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSurfaceEnvelope {
    version: String,
    #[serde(rename = "createSurface")]
    create_surface: CreateSurface,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSurface {
    surface_id: String,
    catalog_id: String,
    #[serde(default)]
    theme: Option<Value>,
    #[serde(default)]
    send_data_model: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateComponentsEnvelope {
    version: String,
    #[serde(rename = "updateComponents")]
    update_components: UpdateComponents,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateComponents {
    surface_id: String,
    components: Vec<FlatComponent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FlatComponent {
    id: String,
    component: String,
    #[serde(default)]
    props: Map<String, Value>,
    #[serde(default)]
    children: Vec<String>,
    #[serde(default)]
    actions: BTreeMap<String, A2uiAction>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateDataModelEnvelope {
    version: String,
    #[serde(rename = "updateDataModel")]
    update_data_model: UpdateDataModel,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateDataModel {
    surface_id: String,
    #[serde(default = "root_pointer")]
    path: String,
    #[serde(default)]
    value: MaybeValue,
}

#[derive(Debug, Default)]
enum MaybeValue {
    #[default]
    Missing,
    Present(Value),
}

impl<'de> Deserialize<'de> for MaybeValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Value::deserialize(deserializer).map(Self::Present)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteSurfaceEnvelope {
    version: String,
    #[serde(rename = "deleteSurface")]
    delete_surface: DeleteSurface,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteSurface {
    surface_id: String,
}

fn root_pointer() -> String {
    "/".into()
}

pub fn observed_surface_id(value: &Value) -> Option<String> {
    data_messages(value)
        .ok()?
        .iter()
        .find_map(message_surface_id)
}

pub fn apply_data_part(
    value: Value,
    current: Option<A2uiSurfaceState>,
) -> Result<StandardBatch, Vec<String>> {
    let messages = data_messages(&value)?;
    if messages.is_empty() || messages.len() > MAX_BATCH_MESSAGES {
        return Err(vec![format!(
            "A2UI DataPart.data 必须包含 1 到 {MAX_BATCH_MESSAGES} 条消息"
        )]);
    }

    let mut version: Option<String> = None;
    let mut surface_id: Option<String> = None;
    let mut catalog_id = current.as_ref().and_then(|state| state.catalog_id.clone());
    let mut components = current.as_ref().map(flatten_state).unwrap_or_default();
    let mut data = current
        .as_ref()
        .map(|state| state.data.clone())
        .unwrap_or_default();
    let mut saw_create = false;
    let mut saw_mutation = false;

    for message in messages {
        let message_version = message
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| vec!["官方 A2UI 消息缺少字符串 version".into()])?;
        if !is_supported_version(message_version) {
            return Err(vec![format!(
                "A2UI 协议版本不兼容：收到 {message_version}，支持 v0.9.1 与 v0.9"
            )]);
        }
        if version
            .as_deref()
            .is_some_and(|selected| selected != message_version)
        {
            return Err(vec!["同一 A2UI DataPart 不能混用协议版本".into()]);
        }
        version.get_or_insert_with(|| message_version.to_string());

        let message_keys = [
            "createSurface",
            "updateComponents",
            "updateDataModel",
            "deleteSurface",
        ]
        .into_iter()
        .filter(|key| message.get(*key).is_some())
        .collect::<Vec<_>>();
        if message_keys.len() != 1 {
            return Err(vec!["官方 A2UI 消息必须且只能包含一种服务端消息类型".into()]);
        }

        match message_keys[0] {
            "createSurface" => {
                let envelope: CreateSurfaceEnvelope = serde_json::from_value(message.clone())
                    .map_err(|error| vec![format!("A2UI createSurface Schema 无效：{error}")])?;
                ensure_version(&envelope.version, message_version)?;
                bind_surface_id(&mut surface_id, &envelope.create_surface.surface_id)?;
                if saw_create || current.is_some() {
                    return Err(vec![
                        "createSurface 不能覆盖已存在的 Surface；请先由用户在界面删除".into(),
                    ]);
                }
                if envelope.create_surface.catalog_id != CATALOG_ID {
                    return Err(vec![format!(
                        "A2UI Catalog 不受支持：收到 {}，当前仅支持 {CATALOG_ID}",
                        envelope.create_surface.catalog_id
                    )]);
                }
                if envelope.create_surface.send_data_model {
                    return Err(vec![
                        "当前 Catalog capability 不支持 sendDataModel，已拒绝渲染".into(),
                    ]);
                }
                if envelope.create_surface.theme.is_some() {
                    return Err(vec![
                        "当前 Catalog capability 未声明 theme，已拒绝渲染".into()
                    ]);
                }
                saw_create = true;
                saw_mutation = true;
                catalog_id = Some(envelope.create_surface.catalog_id);
                components.clear();
                data.clear();
            }
            "updateComponents" => {
                let envelope: UpdateComponentsEnvelope = serde_json::from_value(message.clone())
                    .map_err(|error| vec![format!("A2UI updateComponents Schema 无效：{error}")])?;
                ensure_version(&envelope.version, message_version)?;
                bind_surface_id(&mut surface_id, &envelope.update_components.surface_id)?;
                if envelope.update_components.components.is_empty() {
                    return Err(vec!["updateComponents.components 不能为空".into()]);
                }
                let mut batch_ids = BTreeSet::new();
                for component in envelope.update_components.components {
                    if !batch_ids.insert(component.id.clone()) {
                        return Err(vec![format!(
                            "同一 updateComponents 中组件 id 重复：{}",
                            component.id
                        )]);
                    }
                    components.insert(component.id.clone(), component);
                }
                saw_mutation = true;
            }
            "updateDataModel" => {
                let envelope: UpdateDataModelEnvelope = serde_json::from_value(message.clone())
                    .map_err(|error| vec![format!("A2UI updateDataModel Schema 无效：{error}")])?;
                ensure_version(&envelope.version, message_version)?;
                bind_surface_id(&mut surface_id, &envelope.update_data_model.surface_id)?;
                apply_data_update(&mut data, envelope.update_data_model)?;
                saw_mutation = true;
            }
            "deleteSurface" => {
                let envelope: DeleteSurfaceEnvelope = serde_json::from_value(message.clone())
                    .map_err(|error| vec![format!("A2UI deleteSurface Schema 无效：{error}")])?;
                ensure_version(&envelope.version, message_version)?;
                bind_surface_id(&mut surface_id, &envelope.delete_surface.surface_id)?;
                return Err(vec![
                    "模型发出的 deleteSurface 不具备删除权限；请使用界面的永久删除并确认".into(),
                ]);
            }
            _ => unreachable!(),
        }
    }

    if !saw_mutation {
        return Err(vec!["A2UI DataPart 没有可应用的消息".into()]);
    }
    if !saw_create && current.is_none() {
        return Err(vec![
            "增量消息引用的 Surface 不存在，必须先在同一 DataPart 中 createSurface".into(),
        ]);
    }
    if current
        .as_ref()
        .is_some_and(|state| !is_supported_version(&state.protocol_version))
    {
        return Err(vec!["官方 A2UI 增量消息不能更新旧版私有 1.0 Surface".into()]);
    }
    let surface_id = surface_id.ok_or_else(|| vec!["A2UI 消息缺少 surfaceId".into()])?;
    let catalog_id =
        catalog_id.ok_or_else(|| vec!["A2UI Surface 缺少 Catalog capability".into()])?;
    if catalog_id != CATALOG_ID {
        return Err(vec![format!(
            "A2UI Catalog 不受支持：收到 {catalog_id}，当前仅支持 {CATALOG_ID}"
        )]);
    }
    let root = build_tree(&components)?;
    let revision = current.map_or(1, |state| state.revision.saturating_add(1));
    let version = version.unwrap_or_else(|| OFFICIAL_PROTOCOL_VERSION.into());
    Ok(StandardBatch {
        version: version.clone(),
        catalog_id: catalog_id.clone(),
        state: A2uiSurfaceState {
            protocol_version: version,
            catalog_id: Some(catalog_id),
            surface_id,
            revision,
            root,
            data,
        },
    })
}

fn data_messages(value: &Value) -> Result<Vec<Value>, Vec<String>> {
    let part: DataPart = serde_json::from_value(value.clone())
        .map_err(|error| vec![format!("A2UI DataPart Schema 无效：{error}")])?;
    if part.kind != "data" || part.metadata.mime_type != A2UI_MIME_TYPE {
        return Err(vec![format!(
            "A2UI DataPart 必须使用 kind=data、metadata.mimeType={A2UI_MIME_TYPE}"
        )]);
    }
    Ok(part.data)
}

fn message_surface_id(message: &Value) -> Option<String> {
    [
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
    ]
    .into_iter()
    .find_map(|key| {
        message
            .get(key)
            .and_then(|body| body.get("surfaceId"))
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn ensure_version(actual: &str, expected: &str) -> Result<(), Vec<String>> {
    if actual == expected {
        Ok(())
    } else {
        Err(vec!["A2UI 消息 version 解析不一致".into()])
    }
}

fn bind_surface_id(selected: &mut Option<String>, value: &str) -> Result<(), Vec<String>> {
    if selected.as_deref().is_some_and(|current| current != value) {
        return Err(vec!["同一 A2UI DataPart 只能原子处理一个 surfaceId".into()]);
    }
    selected.get_or_insert_with(|| value.to_string());
    Ok(())
}

fn flatten_state(state: &A2uiSurfaceState) -> BTreeMap<String, FlatComponent> {
    fn visit(node: &A2uiNode, output: &mut BTreeMap<String, FlatComponent>) {
        output.insert(
            node.id.clone(),
            FlatComponent {
                id: node.id.clone(),
                component: node.component.clone(),
                props: node.props.clone(),
                children: node.children.iter().map(|child| child.id.clone()).collect(),
                actions: node.actions.clone(),
            },
        );
        for child in &node.children {
            visit(child, output);
        }
    }
    let mut output = BTreeMap::new();
    visit(&state.root, &mut output);
    output
}

fn build_tree(components: &BTreeMap<String, FlatComponent>) -> Result<A2uiNode, Vec<String>> {
    if !components.contains_key("root") {
        return Err(vec![
            "A2UI updateComponents 必须在提交前定义 id=root 的根组件".into(),
        ]);
    }
    fn visit(
        id: &str,
        components: &BTreeMap<String, FlatComponent>,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
    ) -> Result<A2uiNode, String> {
        if !visiting.insert(id.to_string()) {
            return Err(format!("A2UI 组件引用形成循环：{id}"));
        }
        let component = components
            .get(id)
            .ok_or_else(|| format!("A2UI 组件引用不存在：{id}"))?;
        let children = component
            .children
            .iter()
            .map(|child| visit(child, components, visiting, visited))
            .collect::<Result<Vec<_>, _>>()?;
        visiting.remove(id);
        visited.insert(id.to_string());
        Ok(A2uiNode {
            id: component.id.clone(),
            component: component.component.clone(),
            props: component.props.clone(),
            children,
            actions: component.actions.clone(),
        })
    }
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    let root =
        visit("root", components, &mut visiting, &mut visited).map_err(|error| vec![error])?;
    if visited.len() != components.len() {
        let unreachable = components
            .keys()
            .filter(|id| !visited.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        return Err(vec![format!(
            "A2UI 包含未从 root 引用的组件：{}",
            unreachable.join("、")
        )]);
    }
    Ok(root)
}

fn apply_data_update(
    data: &mut Map<String, Value>,
    update: UpdateDataModel,
) -> Result<(), Vec<String>> {
    match update.path.as_str() {
        "" | "/" => {
            match update.value {
                MaybeValue::Present(Value::Object(next)) => *data = next,
                MaybeValue::Missing => data.clear(),
                MaybeValue::Present(_) => {
                    return Err(vec!["根 updateDataModel.value 必须是 JSON 对象".into()]);
                }
            }
            Ok(())
        }
        path if path.starts_with('/') && !path[1..].contains('/') => {
            let key = path[1..].replace("~1", "/").replace("~0", "~");
            if !valid_key(&key) {
                return Err(vec![format!("updateDataModel path 字段无效：{path}")]);
            }
            match update.value {
                MaybeValue::Present(value) => {
                    data.insert(key, value);
                }
                MaybeValue::Missing => {
                    data.remove(&key);
                }
            }
            Ok(())
        }
        _ => Err(vec![
            "当前 Catalog capability 仅支持根路径或单个顶层字段的数据更新".into(),
        ]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn data_part(messages: Vec<Value>) -> Value {
        json!({
            "data": messages,
            "kind": "data",
            "metadata": {"mimeType": A2UI_MIME_TYPE}
        })
    }

    #[test]
    fn builds_a_safe_tree_from_an_official_message_batch() {
        let value = data_part(vec![
            json!({
                "version": "v0.9.1",
                "createSurface": {"surfaceId": "profile", "catalogId": CATALOG_ID}
            }),
            json!({
                "version": "v0.9.1",
                "updateComponents": {"surfaceId": "profile", "components": [
                    {"id": "root", "component": "Column", "props": {"gap": "md"}, "children": ["title"]},
                    {"id": "title", "component": "Text", "props": {"text": "Profile"}}
                ]}
            }),
            json!({
                "version": "v0.9.1",
                "updateDataModel": {"surfaceId": "profile", "path": "/name", "value": "Ada"}
            }),
        ]);
        let batch = apply_data_part(value, None).unwrap();
        assert_eq!(batch.state.protocol_version, "v0.9.1");
        assert_eq!(batch.state.root.children[0].props["text"], "Profile");
        assert_eq!(batch.state.data["name"], "Ada");
    }

    #[test]
    fn rejects_mixed_versions_catalogs_actions_and_unreachable_components() {
        let wrong_catalog = data_part(vec![json!({
            "version": "v0.9.1",
            "createSurface": {"surfaceId": "bad", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}
        })]);
        assert!(apply_data_part(wrong_catalog, None)
            .unwrap_err()
            .join(" ")
            .contains("Catalog"));

        let unknown_action = data_part(vec![
            json!({"version": "v0.9.1", "createSurface": {"surfaceId": "bad", "catalogId": CATALOG_ID}}),
            json!({"version": "v0.9.1", "updateComponents": {"surfaceId": "bad", "components": [
                {"id": "root", "component": "Button", "props": {"label": "Run"}, "actions": {"click": {"type": "run_shell"}}}
            ]}}),
        ]);
        let batch = apply_data_part(unknown_action, None).unwrap();
        assert_eq!(batch.state.root.actions["click"].action_type, "run_shell");

        let unreachable = data_part(vec![
            json!({"version": "v0.9.1", "createSurface": {"surfaceId": "bad", "catalogId": CATALOG_ID}}),
            json!({"version": "v0.9.1", "updateComponents": {"surfaceId": "bad", "components": [
                {"id": "root", "component": "Text", "props": {"text": "ok"}},
                {"id": "hidden", "component": "Text", "props": {"text": "hidden"}}
            ]}}),
        ]);
        assert!(apply_data_part(unreachable, None)
            .unwrap_err()
            .join(" ")
            .contains("未从 root 引用"));
    }

    #[test]
    fn distinguishes_data_model_deletion_from_an_explicit_null() {
        let initial = data_part(vec![
            json!({"version": "v0.9.1", "createSurface": {"surfaceId": "data", "catalogId": CATALOG_ID}}),
            json!({"version": "v0.9.1", "updateComponents": {"surfaceId": "data", "components": [
                {"id": "root", "component": "Text", "props": {"text": "data"}}
            ]}}),
            json!({"version": "v0.9.1", "updateDataModel": {"surfaceId": "data", "path": "/remove", "value": "old"}}),
            json!({"version": "v0.9.1", "updateDataModel": {"surfaceId": "data", "path": "/nullable", "value": "old"}}),
        ]);
        let state = apply_data_part(initial, None).unwrap().state;
        let update = data_part(vec![
            json!({"version": "v0.9.1", "updateDataModel": {"surfaceId": "data", "path": "/remove"}}),
            json!({"version": "v0.9.1", "updateDataModel": {"surfaceId": "data", "path": "/nullable", "value": null}}),
        ]);
        let state = apply_data_part(update, Some(state)).unwrap().state;
        assert!(!state.data.contains_key("remove"));
        assert_eq!(state.data["nullable"], Value::Null);
    }
}
