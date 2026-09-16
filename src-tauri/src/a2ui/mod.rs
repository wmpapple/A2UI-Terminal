mod capabilities;
mod policy;
mod protocol;
mod standard;

pub use capabilities::{capabilities as get_capabilities, A2uiCapabilities, CATALOG_ID};
pub use protocol::{is_component_allowed, SurfaceMessage, ALLOWED_COMPONENTS, SCHEMA_VERSION};
pub(crate) use protocol::{validate_surface, A2uiNode, A2uiSurfaceState};

use crate::domain::review::ReviewRequest;
use crate::error::AppError;
use crate::storage::{A2uiInspectionRow, A2uiSurfaceRow, Storage};
use capabilities::{is_supported_version, LEGACY_PROTOCOL_VERSION};
use policy::{evaluate, ActionDecision, ActionRisk};
use protocol::{
    apply_update, find_node, normalize_surface, validate_runtime_input_value,
    validate_runtime_value, UpdateMessage, MAX_MESSAGE_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negotiation: Option<A2uiNegotiationEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiNegotiationEvidence {
    pub received_version: Option<String>,
    pub selected_version: Option<String>,
    pub catalog_id: Option<String>,
    pub compatible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiEventView {
    pub id: String,
    pub component_id: String,
    pub event_name: String,
    pub action_type: String,
    pub risk: String,
    pub decision: String,
    pub payload: Value,
    pub duration_ms: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiSurfaceView {
    pub surface_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub message_id: String,
    pub revision: u64,
    pub protocol_version: String,
    pub catalog_id: Option<String>,
    pub root: A2uiNode,
    pub data: serde_json::Map<String, Value>,
    pub raw_message: String,
    pub validation: A2uiValidation,
    pub events: Vec<A2uiEventView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiInspectionView {
    pub id: String,
    pub message_id: String,
    pub surface_id: Option<String>,
    pub raw_message: String,
    pub validation: A2uiValidation,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2uiProcessResult {
    pub surface: Option<A2uiSurfaceView>,
    pub inspection: A2uiInspectionView,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessA2uiRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub message_id: String,
    pub raw_message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteActionRequest {
    pub workspace_id: String,
    pub surface_id: String,
    pub component_id: String,
    pub event_name: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionExecutionResult {
    pub risk: ActionRisk,
    pub decision: ActionDecision,
    pub message: String,
    pub review: Option<ReviewRequest>,
    pub surface: A2uiSurfaceView,
}

pub fn looks_like_a2ui_candidate(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("a2ui_surface")
        || lower.contains("a2ui_update")
        || lower.contains("application/a2ui+json")
        || lower.contains("createsurface")
        || lower.contains("updatecomponents")
        || lower.contains("updatedatamodel")
        || lower.contains("deletesurface")
}

pub fn process_message(
    storage: &Storage,
    request: &ProcessA2uiRequest,
) -> Result<Option<A2uiProcessResult>, AppError> {
    process_message_with_required_action(storage, request, None)
}

pub(crate) fn process_message_with_required_action(
    storage: &Storage,
    request: &ProcessA2uiRequest,
    required_action: Option<&str>,
) -> Result<Option<A2uiProcessResult>, AppError> {
    process_message_with_requirements(storage, request, required_action, None)
}

pub(crate) fn process_message_with_requirements(
    storage: &Storage,
    request: &ProcessA2uiRequest,
    required_action: Option<&str>,
    required_component: Option<&str>,
) -> Result<Option<A2uiProcessResult>, AppError> {
    if required_action.is_none()
        && required_component.is_none()
        && !looks_like_a2ui_candidate(&request.raw_message)
    {
        return Ok(None);
    }
    let session = storage
        .session(&request.session_id)?
        .ok_or_else(|| AppError::InvalidInput("A2UI 会话不存在".into()))?;
    if session.workspace_id != request.workspace_id {
        return Err(AppError::InvalidInput("A2UI 会话不属于当前工作区".into()));
    }
    let started = Instant::now();
    let inspection_id = Uuid::new_v4().to_string();
    let stored_raw = truncate_utf8(&request.raw_message, MAX_MESSAGE_BYTES);
    let mut surface_id = None;
    let mut negotiation = None;
    let result = if request.raw_message.len() > MAX_MESSAGE_BYTES {
        Err(vec![format!(
            "A2UI 消息不能超过 {} KiB",
            MAX_MESSAGE_BYTES / 1024
        )])
    } else {
        extract_json(&request.raw_message)
            .ok_or_else(|| vec!["A2UI 消息必须是单个 JSON 对象或 JSON 代码块".into()])
            .and_then(|json| {
                serde_json::from_str::<Value>(json)
                    .map_err(|error| vec![format!("A2UI JSON 无效：{error}")])
            })
            .and_then(|value| {
                surface_id = observed_surface_id(&value);
                negotiation = negotiation_evidence(&value);
                match value.get("type").and_then(Value::as_str) {
                    Some("a2ui_surface") => parse_full_surface(value),
                    Some("a2ui_update") => parse_update(storage, &request.workspace_id, value),
                    _ if value.get("data").is_some() => {
                        parse_standard_data_part(storage, &request.workspace_id, value)
                    }
                    _ if is_unwrapped_standard_message(&value) => Err(vec![
                        "官方 A2UI 消息必须放入 kind=data、metadata.mimeType=application/a2ui+json 的 DataPart.data 数组"
                            .into(),
                    ]),
                    _ => Err(vec![
                        "A2UI 消息必须是受支持的官方 DataPart，或旧版 a2ui_surface/a2ui_update"
                            .into(),
                    ]),
                }
            })
            .and_then(|(state, warnings)| {
                if required_action
                    .is_some_and(|required| !contains_action_type(&state.root, required))
                {
                    return Err(vec![
                        "交互界面缺少用户要求的“查看修改”动作，不能作为本次结果".into(),
                    ]);
                }
                if required_component
                    .is_some_and(|required| !contains_component(&state.root, required))
                {
                    return Err(vec![
                        "交互小工具缺少实时结果区域，不能作为本次结果".into(),
                    ]);
                }
                Ok((state, warnings))
            })
    };
    let duration_ms = elapsed_ms(started);
    match result {
        Ok((state, warnings)) => {
            let validation = A2uiValidation {
                valid: true,
                errors: Vec::new(),
                warnings,
                duration_ms,
                error_code: None,
                negotiation,
            };
            let state_json =
                serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?;
            let validation_json =
                serde_json::to_string(&validation).map_err(|_| AppError::StateUnavailable)?;
            storage.save_a2ui_surface(
                &Uuid::new_v4().to_string(),
                &state.surface_id,
                &request.workspace_id,
                &request.session_id,
                &request.message_id,
                &state.protocol_version,
                state.revision,
                &state_json,
                stored_raw,
                &validation_json,
                &inspection_id,
                duration_ms,
            )?;
            let surface = load_surface(storage, &request.workspace_id, &state.surface_id)?
                .ok_or(AppError::StateUnavailable)?;
            Ok(Some(A2uiProcessResult {
                inspection: A2uiInspectionView {
                    id: inspection_id,
                    message_id: request.message_id.clone(),
                    surface_id: Some(state.surface_id),
                    raw_message: stored_raw.to_string(),
                    validation,
                    created_at: None,
                },
                surface: Some(surface),
            }))
        }
        Err(errors) => {
            let validation = A2uiValidation {
                valid: false,
                errors,
                warnings: Vec::new(),
                duration_ms,
                error_code: Some(negotiation_error_code(negotiation.as_ref()).into()),
                negotiation,
            };
            let validation_json =
                serde_json::to_string(&validation).map_err(|_| AppError::StateUnavailable)?;
            storage.save_invalid_a2ui_message(
                &inspection_id,
                &request.workspace_id,
                &request.session_id,
                &request.message_id,
                surface_id.as_deref(),
                stored_raw,
                &validation_json,
                duration_ms,
            )?;
            Ok(Some(A2uiProcessResult {
                surface: None,
                inspection: A2uiInspectionView {
                    id: inspection_id,
                    message_id: request.message_id.clone(),
                    surface_id,
                    raw_message: stored_raw.to_string(),
                    validation,
                    created_at: None,
                },
            }))
        }
    }
}

fn contains_component(node: &A2uiNode, component: &str) -> bool {
    node.component == component
        || node
            .children
            .iter()
            .any(|child| contains_component(child, component))
}

fn contains_action_type(node: &A2uiNode, action_type: &str) -> bool {
    node.actions
        .values()
        .any(|action| action.action_type == action_type)
        || node
            .children
            .iter()
            .any(|child| contains_action_type(child, action_type))
}

pub fn list_surfaces(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<A2uiSurfaceView>, AppError> {
    storage
        .a2ui_surfaces(workspace_id)?
        .into_iter()
        .map(|row| surface_from_row(storage, row))
        .collect()
}

pub fn list_inspections(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<A2uiInspectionView>, AppError> {
    storage
        .a2ui_inspections(workspace_id)?
        .into_iter()
        .map(inspection_from_row)
        .collect()
}

pub fn delete_surface(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<bool, AppError> {
    if workspace_id.trim().is_empty() || workspace_id.chars().count() > 128 {
        return Err(AppError::InvalidInput("工作区标识无效".into()));
    }
    if surface_id.trim().is_empty() || surface_id.chars().count() > 128 {
        return Err(AppError::InvalidInput("Surface 标识无效".into()));
    }
    storage.delete_a2ui_surface(workspace_id, surface_id)
}

pub fn delete_inspection(
    storage: &Storage,
    workspace_id: &str,
    inspection_id: &str,
) -> Result<bool, AppError> {
    if workspace_id.trim().is_empty() || workspace_id.chars().count() > 128 {
        return Err(AppError::InvalidInput("工作区标识无效".into()));
    }
    if inspection_id.trim().is_empty() || inspection_id.chars().count() > 128 {
        return Err(AppError::InvalidInput("检查记录标识无效".into()));
    }
    storage.delete_a2ui_inspection(workspace_id, inspection_id)
}

pub fn execute_action(
    storage: &Storage,
    request: ExecuteActionRequest,
) -> Result<ActionExecutionResult, AppError> {
    execute_action_with_review(storage, request, |_| {
        Err(AppError::InvalidInput(
            "文件修改必须通过应用层创建审阅".into(),
        ))
    })
}

pub fn execute_action_with_review<F>(
    storage: &Storage,
    request: ExecuteActionRequest,
    create_review: F,
) -> Result<ActionExecutionResult, AppError>
where
    F: FnOnce(&Value) -> Result<ReviewRequest, AppError>,
{
    let started = Instant::now();
    validate_runtime_value(&request.payload)
        .map_err(|errors| AppError::InvalidInput(errors.join("；")))?;
    let row = storage
        .a2ui_surface(&request.workspace_id, &request.surface_id)?
        .ok_or_else(|| AppError::InvalidInput("Surface 不存在或不属于当前工作区".into()))?;
    let mut state: A2uiSurfaceState = serde_json::from_str(&row.state_json)
        .map_err(|_| AppError::InvalidInput("Surface 持久化状态无效".into()))?;
    normalize_surface(&mut state)
        .and_then(|mut warnings| {
            warnings.extend(validate_surface(&state)?);
            Ok(warnings)
        })
        .map_err(|errors| {
            AppError::InvalidInput(format!(
                "Surface 持久化状态无法安全规范化：{}",
                errors.join("；")
            ))
        })?;
    let action = find_node(&state.root, &request.component_id)
        .and_then(|node| node.actions.get(&request.event_name))
        .cloned();
    let (risk, mut decision, mut message, action_type) = match &action {
        Some(action) => {
            let outcome = evaluate(action);
            (
                outcome.risk,
                outcome.decision,
                outcome.message.to_string(),
                action.action_type.clone(),
            )
        }
        None => (
            ActionRisk::High,
            ActionDecision::Denied,
            "组件未声明该事件，已默认拒绝".into(),
            "undeclared".into(),
        ),
    };

    let mut changed = false;
    let mut review = None;
    let mut review_error = None;
    if decision == ActionDecision::Allowed {
        if let Some(action) = &action {
            if action.action_type == "set_state" {
                let node = find_node(&state.root, &request.component_id)
                    .ok_or_else(|| AppError::InvalidInput("输入组件不存在".into()))?;
                let target = action
                    .target
                    .as_ref()
                    .ok_or_else(|| AppError::InvalidInput("set_state target 缺失".into()))?;
                let value = if request.payload.is_null() {
                    action.value.clone().unwrap_or(Value::Null)
                } else {
                    request.payload.clone()
                };
                validate_runtime_input_value(node, &value)
                    .map_err(|errors| AppError::InvalidInput(errors.join("；")))?;
                state.data.insert(target.clone(), value);
                changed = true;
            }
        }
    }

    if decision == ActionDecision::ReviewRequired {
        let candidate = action.as_ref().and_then(|action| action.value.as_ref());
        match candidate {
            Some(candidate) => match create_review(candidate) {
                Ok(created) => {
                    message = "修改方案已进入审阅；确认前不会更改文件".into();
                    review = Some(created);
                }
                Err(error) => {
                    decision = ActionDecision::Denied;
                    message = "修改方案无法安全进入审阅，已拒绝执行".into();
                    review_error = Some(error);
                }
            },
            None => {
                decision = ActionDecision::Denied;
                message = "修改方案缺少可审阅内容，已拒绝执行".into();
                review_error = Some(AppError::InvalidInput(message.clone()));
            }
        }
    }

    let state_json = if changed {
        Some(serde_json::to_string(&state).map_err(|_| AppError::StateUnavailable)?)
    } else {
        None
    };
    let audit_payload = if let Some(review) = &review {
        serde_json::json!({"reviewId": review.id, "source": "a2ui_action"})
    } else if let Some(error) = &review_error {
        serde_json::json!({"errorCode": error.code()})
    } else {
        request.payload.clone()
    };
    let payload_json =
        serde_json::to_string(&audit_payload).map_err(|_| AppError::StateUnavailable)?;
    storage.record_a2ui_action(
        &row.id,
        state_json.as_deref(),
        &Uuid::new_v4().to_string(),
        &request.component_id,
        &request.event_name,
        &action_type,
        risk.as_str(),
        decision.as_str(),
        &payload_json,
        elapsed_ms(started),
    )?;
    if let Some(error) = review_error {
        return Err(error);
    }
    Ok(ActionExecutionResult {
        risk,
        decision,
        message,
        review,
        surface: load_surface(storage, &request.workspace_id, &request.surface_id)?
            .ok_or(AppError::StateUnavailable)?,
    })
}

fn parse_full_surface(value: Value) -> Result<(A2uiSurfaceState, Vec<String>), Vec<String>> {
    let message: SurfaceMessage = serde_json::from_value(value)
        .map_err(|error| vec![format!("A2UI Surface Schema 无效：{error}")])?;
    if message.version != SCHEMA_VERSION || message.message_type != "a2ui_surface" {
        return Err(vec![
            "Surface 必须使用 version=1.0、type=a2ui_surface".into()
        ]);
    }
    let mut state = A2uiSurfaceState {
        protocol_version: LEGACY_PROTOCOL_VERSION.into(),
        catalog_id: None,
        surface_id: message.surface_id,
        revision: message.revision,
        root: message.root,
        data: message.data,
    };
    let mut warnings = normalize_surface(&mut state)?;
    warnings.extend(validate_surface(&state)?);
    Ok((state, warnings))
}

fn parse_standard_data_part(
    storage: &Storage,
    workspace_id: &str,
    value: Value,
) -> Result<(A2uiSurfaceState, Vec<String>), Vec<String>> {
    let candidate_surface_id = standard::observed_surface_id(&value)
        .ok_or_else(|| vec!["官方 A2UI DataPart 缺少 surfaceId".into()])?;
    let current = storage
        .a2ui_surface(workspace_id, &candidate_surface_id)
        .map_err(|error| vec![error.to_string()])?
        .map(|row| {
            serde_json::from_str::<A2uiSurfaceState>(&row.state_json)
                .map_err(|_| vec!["现有 Surface 状态损坏".into()])
        })
        .transpose()?;
    let batch = standard::apply_data_part(value, current)?;
    let mut state = batch.state;
    let mut warnings = normalize_surface(&mut state)?;
    warnings.extend(validate_surface(&state)?);
    warnings.push(format!(
        "已协商 A2UI {}，Catalog {}",
        batch.version, batch.catalog_id
    ));
    Ok((state, warnings))
}

fn parse_update(
    storage: &Storage,
    workspace_id: &str,
    value: Value,
) -> Result<(A2uiSurfaceState, Vec<String>), Vec<String>> {
    let update: UpdateMessage = serde_json::from_value(value)
        .map_err(|error| vec![format!("A2UI Update Schema 无效：{error}")])?;
    let row = storage
        .a2ui_surface(workspace_id, &update.surface_id)
        .map_err(|error| vec![error.to_string()])?
        .ok_or_else(|| vec!["增量更新引用的 Surface 不存在".into()])?;
    let current: A2uiSurfaceState =
        serde_json::from_str(&row.state_json).map_err(|_| vec!["现有 Surface 状态损坏".into()])?;
    apply_update(&current, update)
}

fn is_unwrapped_standard_message(value: &Value) -> bool {
    [
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
    ]
    .into_iter()
    .any(|key| value.get(key).is_some())
}

fn observed_surface_id(value: &Value) -> Option<String> {
    value
        .get("surfaceId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| standard::observed_surface_id(value))
        .or_else(|| {
            [
                "createSurface",
                "updateComponents",
                "updateDataModel",
                "deleteSurface",
            ]
            .into_iter()
            .find_map(|key| {
                value
                    .get(key)
                    .and_then(|body| body.get("surfaceId"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        })
}

fn negotiation_evidence(value: &Value) -> Option<A2uiNegotiationEvidence> {
    if value.get("type").is_some() {
        let received_version = value
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string);
        let compatible = received_version.as_deref() == Some(LEGACY_PROTOCOL_VERSION);
        return Some(A2uiNegotiationEvidence {
            received_version,
            selected_version: compatible.then(|| LEGACY_PROTOCOL_VERSION.into()),
            catalog_id: None,
            compatible,
        });
    }

    let first = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|messages| messages.first())
        .unwrap_or(value);
    if !is_unwrapped_standard_message(first) {
        return None;
    }
    let received_version = first
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string);
    let catalog_id = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find_map(|message| {
                message
                    .get("createSurface")
                    .and_then(|body| body.get("catalogId"))
                    .and_then(Value::as_str)
            })
        })
        .or_else(|| {
            value
                .get("createSurface")
                .and_then(|body| body.get("catalogId"))
                .and_then(Value::as_str)
        })
        .map(str::to_string);
    let version_compatible = received_version
        .as_deref()
        .is_some_and(is_supported_version);
    let catalog_compatible = catalog_id.as_deref().is_none_or(|id| id == CATALOG_ID);
    Some(A2uiNegotiationEvidence {
        received_version: received_version.clone(),
        selected_version: version_compatible.then_some(received_version).flatten(),
        catalog_id,
        compatible: version_compatible && catalog_compatible,
    })
}

fn negotiation_error_code(evidence: Option<&A2uiNegotiationEvidence>) -> &'static str {
    match evidence {
        Some(value) if value.selected_version.is_none() => "A2UI_PROTOCOL_INCOMPATIBLE",
        Some(value)
            if value
                .catalog_id
                .as_deref()
                .is_some_and(|catalog| catalog != CATALOG_ID) =>
        {
            "A2UI_CATALOG_UNSUPPORTED"
        }
        _ => "A2UI_VALIDATION_FAILED",
    }
}

fn load_surface(
    storage: &Storage,
    workspace_id: &str,
    surface_id: &str,
) -> Result<Option<A2uiSurfaceView>, AppError> {
    storage
        .a2ui_surface(workspace_id, surface_id)?
        .map(|row| surface_from_row(storage, row))
        .transpose()
}

fn surface_from_row(storage: &Storage, row: A2uiSurfaceRow) -> Result<A2uiSurfaceView, AppError> {
    let mut state: A2uiSurfaceState = serde_json::from_str(&row.state_json)
        .map_err(|_| AppError::InvalidInput("Surface 持久化状态无效".into()))?;
    let normalization_warnings = normalize_surface(&mut state).map_err(|errors| {
        AppError::InvalidInput(format!(
            "Surface 持久化状态无法安全规范化：{}",
            errors.join("；")
        ))
    })?;
    validate_surface(&state).map_err(|errors| {
        AppError::InvalidInput(format!("Surface 持久化状态校验失败：{}", errors.join("；")))
    })?;
    let mut validation: A2uiValidation = serde_json::from_str(&row.validation_json)
        .map_err(|_| AppError::InvalidInput("Surface 校验记录无效".into()))?;
    for warning in normalization_warnings {
        if !validation.warnings.contains(&warning) {
            validation.warnings.push(warning);
        }
    }
    let events = storage
        .a2ui_events(&row.id)?
        .into_iter()
        .map(|event| {
            Ok(A2uiEventView {
                id: event.id,
                component_id: event.component_id,
                event_name: event.event_name,
                action_type: event.action_type,
                risk: event.risk,
                decision: event.decision,
                payload: serde_json::from_str(&event.payload_json)
                    .map_err(|_| AppError::StateUnavailable)?,
                duration_ms: event.duration_ms,
                created_at: event.created_at,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(A2uiSurfaceView {
        surface_id: state.surface_id,
        workspace_id: row.workspace_id,
        session_id: row.session_id,
        message_id: row.message_id,
        revision: state.revision,
        protocol_version: state.protocol_version.clone(),
        catalog_id: state.catalog_id.clone(),
        root: state.root,
        data: state.data,
        raw_message: row.raw_message,
        validation,
        events,
    })
}

fn inspection_from_row(row: A2uiInspectionRow) -> Result<A2uiInspectionView, AppError> {
    Ok(A2uiInspectionView {
        id: row.id,
        message_id: row.message_id,
        surface_id: row.surface_id,
        raw_message: row.raw_message,
        validation: serde_json::from_str(&row.validation_json)
            .map_err(|_| AppError::StateUnavailable)?,
        created_at: Some(row.created_at),
    })
}

fn extract_json(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    for marker in ["```json", "```JSON", "```"] {
        if let Some(start) = trimmed.find(marker) {
            let rest = &trimmed[start + marker.len()..];
            if let Some(end) = rest.find("```") {
                let candidate = rest[..end].trim();
                if candidate.starts_with('{') && candidate.ends_with('}') {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn truncate_utf8(raw: &str, max_bytes: usize) -> &str {
    if raw.len() <= max_bytes {
        return raw;
    }
    let mut boundary = max_bytes;
    while !raw.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &raw[..boundary]
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;
    use serde_json::json;

    fn setup() -> (Storage, String, String) {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI", "C:\\a2ui-runtime")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Runtime")
            .unwrap();
        (storage, workspace_id, session_id)
    }

    fn full_message(surface_id: &str) -> String {
        json!({
            "version": "1.0",
            "type": "a2ui_surface",
            "surfaceId": surface_id,
            "revision": 1,
            "root": {
                "id": "root",
                "component": "Column",
                "props": {"gap": "md"},
                "children": [{
                    "id": "field",
                    "component": "TextField",
                    "props": {"name": "name", "label": "Name"},
                    "actions": {"change": {"type": "set_state", "target": "name"}}
                }]
            },
            "data": {"name": ""}
        })
        .to_string()
    }

    #[test]
    fn persists_valid_surface_and_incremental_update_without_touching_other_surface() {
        let (storage, workspace_id, session_id) = setup();
        for surface_id in ["one", "two"] {
            let outcome = process_message(
                &storage,
                &ProcessA2uiRequest {
                    workspace_id: workspace_id.clone(),
                    session_id: session_id.clone(),
                    message_id: Uuid::new_v4().to_string(),
                    raw_message: full_message(surface_id),
                },
            )
            .unwrap()
            .unwrap();
            assert!(outcome.inspection.validation.valid);
        }
        let before_two = storage
            .a2ui_surface(&workspace_id, "two")
            .unwrap()
            .unwrap()
            .state_json;
        let update = json!({
            "version": "1.0",
            "type": "a2ui_update",
            "surfaceId": "one",
            "revision": 2,
            "operations": [{"op": "set_data", "key": "name", "value": "Ada"}]
        })
        .to_string();
        process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id: session_id.clone(),
                message_id: Uuid::new_v4().to_string(),
                raw_message: update,
            },
        )
        .unwrap();
        let surfaces = list_surfaces(&storage, &workspace_id).unwrap();
        assert_eq!(surfaces.len(), 2);
        assert_eq!(
            storage
                .a2ui_surface(&workspace_id, "two")
                .unwrap()
                .unwrap()
                .state_json,
            before_two
        );
    }

    #[test]
    fn accepts_the_observed_qwen_form_shorthand_end_to_end() {
        let (storage, workspace_id, session_id) = setup();
        let raw_message = json!({
            "version": "1.0",
            "type": "a2ui_surface",
            "surfaceId": "user-form-001",
            "revision": 1,
            "root": {
                "id": "root",
                "component": "Card",
                "props": {"title": "用户信息表单"},
                "children": [{
                    "id": "form-column",
                    "component": "Column",
                    "children": [
                        {
                            "id": "name-field",
                            "component": "TextField",
                            "props": {"label": "姓名", "placeholder": "请输入姓名", "name": "name"}
                        },
                        {
                            "id": "role-field",
                            "component": "Select",
                            "props": {"label": "角色", "options": ["管理员", "普通用户", "访客"], "name": "role"}
                        },
                        {
                            "id": "submit-button",
                            "component": "Button",
                            "props": {"label": "提交", "variant": "primary"},
                            "actions": {"on_click": {"type": "submit_form"}}
                        }
                    ]
                }]
            }
        })
        .to_string();
        let outcome = process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message,
            },
        )
        .unwrap()
        .unwrap();
        assert!(outcome.inspection.validation.valid);
        let surface = outcome.surface.unwrap();
        assert_eq!(
            surface.root.children[0].children[1].props["options"][0]["value"],
            "管理员"
        );
        assert!(surface.root.children[0].children[2]
            .actions
            .contains_key("click"));
        assert!(surface.root.children[0].children[0]
            .actions
            .contains_key("change"));
        assert!(surface.root.children[0].children[1]
            .actions
            .contains_key("change"));

        let name_change = execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id: workspace_id.clone(),
                surface_id: "user-form-001".into(),
                component_id: "name-field".into(),
                event_name: "change".into(),
                payload: json!("张三"),
            },
        )
        .unwrap();
        assert_eq!(name_change.surface.data["name"], "张三");

        let role_change = execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id,
                surface_id: "user-form-001".into(),
                component_id: "role-field".into(),
                event_name: "change".into(),
                payload: json!("管理员"),
            },
        )
        .unwrap();
        assert_eq!(role_change.surface.data["role"], "管理员");
    }

    #[test]
    fn repairs_legacy_persisted_inputs_when_loaded_and_used() {
        let (storage, workspace_id, session_id) = setup();
        let state = json!({
            "surfaceId": "legacy-form",
            "revision": 1,
            "root": {
                "id": "root",
                "component": "Column",
                "children": [{
                    "id": "name-field",
                    "component": "TextField",
                    "props": {"name": "name", "label": "姓名"},
                    "actions": {}
                }]
            },
            "data": {}
        });
        let validation = serde_json::to_string(&A2uiValidation {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
            duration_ms: 0,
            error_code: None,
            negotiation: None,
        })
        .unwrap();
        storage
            .save_a2ui_surface(
                &Uuid::new_v4().to_string(),
                "legacy-form",
                &workspace_id,
                &session_id,
                &Uuid::new_v4().to_string(),
                LEGACY_PROTOCOL_VERSION,
                1,
                &state.to_string(),
                &state.to_string(),
                &validation,
                &Uuid::new_v4().to_string(),
                0,
            )
            .unwrap();

        let loaded = list_surfaces(&storage, &workspace_id).unwrap().remove(0);
        assert!(loaded.root.children[0].actions.contains_key("change"));
        let changed = execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id: workspace_id.clone(),
                surface_id: "legacy-form".into(),
                component_id: "name-field".into(),
                event_name: "change".into(),
                payload: json!("张三"),
            },
        )
        .unwrap();
        assert_eq!(changed.surface.data["name"], "张三");
        assert!(storage
            .a2ui_surface(&workspace_id, "legacy-form")
            .unwrap()
            .unwrap()
            .state_json
            .contains("set_state"));
    }

    #[test]
    fn records_allowed_and_denied_events() {
        let (storage, workspace_id, session_id) = setup();
        process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: full_message("form"),
            },
        )
        .unwrap();
        let allowed = execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id: workspace_id.clone(),
                surface_id: "form".into(),
                component_id: "field".into(),
                event_name: "change".into(),
                payload: json!("Ada"),
            },
        )
        .unwrap();
        assert_eq!(allowed.decision, ActionDecision::Allowed);
        assert_eq!(allowed.surface.data.get("name"), Some(&json!("Ada")));
        let denied = execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id,
                surface_id: "form".into(),
                component_id: "field".into(),
                event_name: "run".into(),
                payload: Value::Null,
            },
        )
        .unwrap();
        assert_eq!(denied.decision, ActionDecision::Denied);
        assert_eq!(denied.surface.events.len(), 2);
        assert_eq!(denied.surface.events[0].decision, "denied");
        assert_eq!(denied.surface.events[1].decision, "allowed");
    }

    #[test]
    fn required_action_rejects_a_safe_but_unrelated_surface_before_persistence() {
        let (storage, workspace_id, session_id) = setup();
        let outcome = process_message_with_required_action(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id: session_id.clone(),
                message_id: Uuid::new_v4().to_string(),
                raw_message: full_message("unrelated-form"),
            },
            Some("request_patch"),
        )
        .unwrap()
        .unwrap();

        assert!(outcome.surface.is_none());
        assert!(!outcome.inspection.validation.valid);
        assert!(outcome.inspection.validation.errors[0].contains("查看修改"));
        assert!(storage.a2ui_surfaces(&workspace_id).unwrap().is_empty());

        let non_a2ui = process_message_with_required_action(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: "普通说明文本".into(),
            },
            Some("request_patch"),
        )
        .unwrap()
        .unwrap();
        assert!(non_a2ui.surface.is_none());
        assert!(!non_a2ui.inspection.validation.valid);
    }

    #[test]
    fn invalid_messages_are_kept_for_inspector_but_never_rendered() {
        let (storage, workspace_id, session_id) = setup();
        let raw = full_message("bad").replace("TextField", "iframe");
        let outcome = process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: raw,
            },
        )
        .unwrap()
        .unwrap();
        assert!(!outcome.inspection.validation.valid);
        assert!(outcome.surface.is_none());
        assert!(list_surfaces(&storage, &workspace_id).unwrap().is_empty());
        assert_eq!(list_inspections(&storage, &workspace_id).unwrap().len(), 1);
        assert!(!delete_inspection(&storage, "another-workspace", &outcome.inspection.id).unwrap());
        assert!(delete_inspection(&storage, &workspace_id, &outcome.inspection.id).unwrap());
        assert!(list_inspections(&storage, &workspace_id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn oversized_messages_are_rejected_and_retained_for_inspector() {
        let (storage, workspace_id, session_id) = setup();
        let raw = format!(
            "{{\"type\":\"a2ui_surface\",\"padding\":\"{}\"}}",
            "x".repeat(MAX_MESSAGE_BYTES)
        );
        let outcome = process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id,
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: raw,
            },
        )
        .unwrap()
        .unwrap();
        assert!(!outcome.inspection.validation.valid);
        assert!(outcome.inspection.validation.errors[0].contains("不能超过"));
        assert!(outcome.surface.is_none());
    }
}
