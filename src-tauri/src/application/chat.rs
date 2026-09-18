use crate::a2ui::{self, A2uiProcessResult, ProcessA2uiRequest};
use crate::ai::{self, ChatRequest, ConfirmedContextManifest, ProviderMessage};
use crate::domain::review::{
    CreateReviewRequestInput, ReviewOperationKind, ReviewRequest, ReviewSource,
};
use crate::error::AppError;
use crate::patch::{self, PatchReview};
use crate::repository::chat::{ChatRepository, StartChatRequest};
use crate::repository::provider::ProviderRepository;
use crate::security::{validate_provider_id, SecretStore};
use crate::storage::{ChatSessionRecord, Storage};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

const MAX_A2UI_REPAIR_ERROR_CHARS: usize = 1200;

struct A2uiRepairInstruction {
    prompt: String,
    include_previous_output: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct A2uiReviewActionPlan {
    #[serde(rename = "type")]
    kind: String,
    title: String,
    description: String,
    button_label: String,
    candidate: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct A2uiChecklistToolPlan {
    #[serde(rename = "type")]
    kind: String,
    tool_kind: String,
    title: String,
    items: Vec<A2uiChecklistToolItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct A2uiChecklistToolItem {
    key: String,
    label: String,
    #[serde(default)]
    completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct A2uiPlannerToolPlan {
    #[serde(rename = "type")]
    kind: String,
    tool_kind: String,
    title: String,
    task: String,
    owner: String,
    due_date: String,
    status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum A2uiToolKind {
    Checklist,
    Planner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatStreamEvent {
    Delta {
        request_id: String,
        message_id: String,
        delta: String,
    },
    Complete {
        request_id: String,
        message_id: String,
    },
    Stopped {
        request_id: String,
        message_id: String,
    },
    Error {
        request_id: String,
        message_id: String,
        code: String,
        message: String,
        retryable: bool,
        retry_after_seconds: Option<u64>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamResult {
    request_id: String,
    message_id: String,
    content: String,
    status: String,
    error_code: Option<String>,
    error_message: Option<String>,
    retryable: bool,
    retry_after_seconds: Option<u64>,
    patch: Option<PatchReview>,
    review: Option<ReviewRequest>,
    patch_error: Option<String>,
    a2ui: Option<A2uiProcessResult>,
}

pub fn list_sessions(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<ChatSessionRecord>, AppError> {
    ChatRepository::new(storage).sessions(workspace_id)
}

pub fn create_session(
    storage: &Storage,
    workspace_id: &str,
    session_id: &str,
    title: &str,
) -> Result<ChatSessionRecord, AppError> {
    uuid::Uuid::parse_str(session_id)
        .map_err(|_| AppError::InvalidInput("会话标识必须是有效 UUID".into()))?;
    let repository = ChatRepository::new(storage);
    if !repository.workspace_exists(workspace_id)? {
        return Err(AppError::InvalidInput("工作区不存在".into()));
    }
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 80 {
        return Err(AppError::InvalidInput(
            "会话标题不能为空且不能超过 80 个字符".into(),
        ));
    }
    repository.create_session(workspace_id, session_id, title)
}

pub async fn stream<F>(
    storage: &Storage,
    request: ChatRequest,
    manifest: ConfirmedContextManifest,
    cancellation: Arc<AtomicBool>,
    mut emit: F,
) -> Result<ChatStreamResult, AppError>
where
    F: FnMut(ChatStreamEvent) -> Result<(), AppError>,
{
    let provider_id = validate_provider_id(&request.provider_id)?;
    let config = ProviderRepository::new(storage)
        .find(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    let repository = ChatRepository::new(storage);
    let sources_json =
        serde_json::to_string(&manifest.view).map_err(|_| AppError::StateUnavailable)?;
    let start_request = || {
        repository.start_request(StartChatRequest {
            workspace_id: &request.workspace_id,
            session_id: &request.session_id,
            request_id: &request.request_id,
            user_message_id: &request.user_message_id,
            assistant_message_id: &request.assistant_message_id,
            provider_id: &provider_id,
            prompt: request.prompt.trim(),
            context_snapshot_id: &manifest.view.id,
            sources_json: &sources_json,
            character_count: manifest.view.character_count,
            estimated_tokens: manifest.view.estimated_tokens,
            has_sensitive_warning: manifest.view.sensitive_warning,
        })
    };
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput(
            "当前 Provider 尚未配置 API Key".into(),
        ));
    }
    let api_key = SecretStore::get(&provider_id)?;
    start_request()?;

    let mut messages = vec![ProviderMessage {
        role: "system".into(),
        content: semantic_patch_system_prompt(&request.workspace_id),
    }];
    messages.extend(manifest.history);
    messages.push(ProviderMessage {
        role: "user".into(),
        content: ai::build_context_prompt(&request.prompt, &manifest.sources),
    });

    let mut partial = String::new();
    let mut last_persist = Instant::now();
    let stream_result = ai::stream_chat(
        &config,
        &api_key,
        &messages,
        cancellation.clone(),
        |delta| {
            partial.push_str(delta);
            emit(ChatStreamEvent::Delta {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
                delta: delta.to_string(),
            })?;
            if last_persist.elapsed().as_millis() >= 250 {
                repository.update_assistant(
                    &request.assistant_message_id,
                    &partial,
                    "streaming",
                    None,
                )?;
                last_persist = Instant::now();
            }
            Ok(())
        },
    )
    .await;

    match stream_result {
        Ok(first_content) => {
            let mut content = first_content;
            let required_a2ui_action =
                requires_a2ui_review_action(&request.prompt).then_some("request_patch");
            let required_tool = requested_a2ui_tool(&request.prompt);
            let required_a2ui_component = required_tool.map(|_| "ResultSummary");
            let create_input = |raw: String| CreateReviewRequestInput {
                workspace_id: request.workspace_id.clone(),
                source: request.review_source.unwrap_or(ReviewSource::Chat),
                result_id: None,
                raw,
            };
            let mut review_result = (!request.explanation_only && required_a2ui_action.is_none())
                .then(|| super::review::create(storage, create_input(content.clone())));
            if review_result
                .as_ref()
                .is_some_and(|result| should_retry_invalid_review(&content, result))
            {
                let mut retry_messages = messages.clone();
                retry_messages.push(ProviderMessage {
                    role: "user".into(),
                    content: "Your previous review proposal was invalid or truncated. Regenerate it once as compact JSON only. For document_patch use at most 3 changes, exact non-empty anchors up to 500 characters, and content up to 1500 characters. For create_file or replace_empty_file include the full candidate content. Do not include hashes or absolute paths.".into(),
                });
                match ai::stream_chat(
                    &config,
                    &api_key,
                    &retry_messages,
                    cancellation.clone(),
                    |_| Ok(()),
                )
                .await
                {
                    Ok(retried) => {
                        content = retried;
                        review_result = Some(super::review::create(
                            storage,
                            create_input(content.clone()),
                        ));
                    }
                    Err(AppError::RequestCancelled) => {
                        repository.update_assistant(
                            &request.assistant_message_id,
                            &partial,
                            "stopped",
                            None,
                        )?;
                        let _ = emit(ChatStreamEvent::Stopped {
                            request_id: request.request_id.clone(),
                            message_id: request.assistant_message_id.clone(),
                        });
                        return Ok(stopped_result(request, partial));
                    }
                    Err(error) => return Err(error),
                }
            }
            let review_storage_failed = review_result.as_ref().is_some_and(|result| {
                matches!(
                    result,
                    Err(AppError::Database(_)
                        | AppError::DatabaseIntegrity
                        | AppError::StateUnavailable)
                )
            });
            let (validated_review, patch_error) = match review_result {
                Some(Ok(review)) => (Some(review), None),
                Some(Err(error)) if super::review::looks_like_candidate(&content) => {
                    (None, Some(format!("AI 修改方案未通过安全校验：{error}")))
                }
                Some(Err(_)) | None => (None, None),
            };
            let validated_patch = if validated_review
                .as_ref()
                .is_some_and(|review| review.operation_kind == ReviewOperationKind::DocumentPatch)
            {
                patch::parse_review(storage, &request.workspace_id, &content).ok()
            } else {
                None
            };
            let mut a2ui_result =
                if !request.explanation_only && validated_review.is_none() && patch_error.is_none()
                {
                    let a2ui_content = compile_review_action_plan(
                        &content,
                        &request.workspace_id,
                        &request.assistant_message_id,
                    )
                    .or_else(|| compile_tool_plan(&content, &request.assistant_message_id))
                    .unwrap_or_else(|| content.clone());
                    a2ui::process_message_with_requirements(
                        storage,
                        &ProcessA2uiRequest {
                            workspace_id: request.workspace_id.clone(),
                            session_id: request.session_id.clone(),
                            message_id: request.assistant_message_id.clone(),
                            raw_message: a2ui_content,
                        },
                        required_a2ui_action,
                        required_a2ui_component,
                    )?
                } else {
                    None
                };
            if let Some(repair) = a2ui_result.as_ref().and_then(|result| {
                a2ui_repair_instruction(result, &request.workspace_id, &request.prompt)
            }) {
                let mut retry_messages = messages.clone();
                if repair.include_previous_output {
                    retry_messages.push(ProviderMessage {
                        role: "assistant".into(),
                        content: content.clone(),
                    });
                }
                retry_messages.push(ProviderMessage {
                    role: "user".into(),
                    content: repair.prompt,
                });
                // A hidden repair must not hold the UI for the normal 15-minute
                // streaming budget. Keep the original validation failure on timeout.
                match tokio::time::timeout(
                    std::time::Duration::from_secs(90),
                    ai::stream_chat(&config, &api_key, &retry_messages, cancellation, |_| Ok(())),
                )
                .await
                .unwrap_or_else(|_| {
                    Err(AppError::InvalidInput(
                        "交互界面自动修复超时，请重试".into(),
                    ))
                }) {
                    Ok(retried) => {
                        let retried_a2ui = compile_review_action_plan(
                            &retried,
                            &request.workspace_id,
                            &request.assistant_message_id,
                        )
                        .or_else(|| compile_tool_plan(&retried, &request.assistant_message_id))
                        .unwrap_or_else(|| retried.clone());
                        if let Some(retried_result) = a2ui::process_message_with_requirements(
                            storage,
                            &ProcessA2uiRequest {
                                workspace_id: request.workspace_id.clone(),
                                session_id: request.session_id.clone(),
                                message_id: request.assistant_message_id.clone(),
                                raw_message: retried_a2ui,
                            },
                            required_a2ui_action,
                            required_a2ui_component,
                        )? {
                            content = retried;
                            a2ui_result = Some(retried_result);
                        }
                    }
                    Err(AppError::RequestCancelled) => {
                        repository.update_assistant(
                            &request.assistant_message_id,
                            &partial,
                            "stopped",
                            None,
                        )?;
                        let _ = emit(ChatStreamEvent::Stopped {
                            request_id: request.request_id.clone(),
                            message_id: request.assistant_message_id.clone(),
                        });
                        return Ok(stopped_result(request, partial));
                    }
                    Err(_) => {}
                }
            }
            if let Some(surface) = a2ui_result
                .as_ref()
                .and_then(|result| result.surface.as_ref())
            {
                super::result::ensure_portable_surface_by_id(
                    storage,
                    &surface.workspace_id,
                    &surface.surface_id,
                )?;
            }
            let unverified_completion_claim = validated_review.is_none()
                && patch_error.is_none()
                && a2ui_result.is_none()
                && claims_unverified_file_completion(&content);
            let error_code = if review_storage_failed {
                Some("DATABASE_ERROR".to_string())
            } else if patch_error.is_some() {
                Some("PATCH_VALIDATION_FAILED".to_string())
            } else if let Some(review) = &validated_review {
                Some(
                    match review.operation_kind {
                        ReviewOperationKind::DocumentPatch => "PATCH_READY",
                        ReviewOperationKind::CreateFile => "CREATE_REVIEW_READY",
                        ReviewOperationKind::ReplaceResult => "REPLACE_REVIEW_READY",
                    }
                    .to_string(),
                )
            } else if a2ui_result
                .as_ref()
                .is_some_and(|result| result.inspection.validation.valid)
            {
                Some("A2UI_READY".to_string())
            } else if a2ui_result.is_some() {
                Some("A2UI_VALIDATION_FAILED".to_string())
            } else if unverified_completion_claim {
                Some("UNVERIFIED_FILE_COMPLETION_CLAIM".to_string())
            } else {
                None
            };
            let assistant_content = if review_storage_failed {
                "修改方案未能保存到本地。文件没有被修改；请重启应用后重试，不要清空数据。"
                    .to_string()
            } else if let Some(review) = validated_review.as_ref() {
                review_completion_content(review)
            } else if let Some(result) = a2ui_result.as_ref() {
                a2ui_completion_content(result)
            } else {
                content.clone()
            };
            repository.update_assistant(
                &request.assistant_message_id,
                &assistant_content,
                if review_storage_failed {
                    "error"
                } else {
                    "complete"
                },
                error_code.as_deref(),
            )?;
            let _ = emit(ChatStreamEvent::Complete {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
            });
            Ok(ChatStreamResult {
                request_id: request.request_id,
                message_id: request.assistant_message_id,
                content: assistant_content,
                status: if review_storage_failed {
                    "error"
                } else {
                    "complete"
                }
                .into(),
                error_code,
                error_message: None,
                retryable: false,
                retry_after_seconds: None,
                patch: validated_patch,
                review: validated_review,
                patch_error,
                a2ui: a2ui_result,
            })
        }
        Err(AppError::RequestCancelled) => {
            repository.update_assistant(
                &request.assistant_message_id,
                &partial,
                "stopped",
                None,
            )?;
            let _ = emit(ChatStreamEvent::Stopped {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
            });
            Ok(stopped_result(request, partial))
        }
        Err(error) => {
            let code = error.code().to_string();
            let message = error.to_string();
            let retryable = error.retryable();
            let retry_after_seconds = error.retry_after_seconds();
            repository.update_assistant(
                &request.assistant_message_id,
                &partial,
                "error",
                Some(&code),
            )?;
            let _ = emit(ChatStreamEvent::Error {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
                code: code.clone(),
                message: message.clone(),
                retryable,
                retry_after_seconds,
            });
            Ok(ChatStreamResult {
                request_id: request.request_id,
                message_id: request.assistant_message_id,
                content: partial,
                status: "error".into(),
                error_code: Some(code),
                error_message: Some(message),
                retryable,
                retry_after_seconds,
                patch: None,
                review: None,
                patch_error: None,
                a2ui: None,
            })
        }
    }
}

fn stopped_result(request: ChatRequest, content: String) -> ChatStreamResult {
    ChatStreamResult {
        request_id: request.request_id,
        message_id: request.assistant_message_id,
        content,
        status: "stopped".into(),
        error_code: None,
        error_message: None,
        retryable: false,
        retry_after_seconds: None,
        patch: None,
        review: None,
        patch_error: None,
        a2ui: None,
    }
}

fn claims_unverified_file_completion(raw: &str) -> bool {
    raw.split(['。', '！', '？', '.', '!', '?', '\n'])
        .map(str::trim)
        .filter(|clause| !clause.is_empty())
        .any(|clause| {
            let normalized = clause.to_lowercase();
            let mentions_artifact = [
                "文件", "文档", "成果", "file", "document", "artifact", "result",
            ]
            .iter()
            .any(|term| normalized.contains(term));
            let conditional_or_negative = [
                "如果",
                "假如",
                "若您",
                "尚未",
                "还未",
                "还没有",
                "没有创建",
                "没有生成",
                "没有保存",
                "没有修改",
                "未创建",
                "未生成",
                "未保存",
                "未修改",
                "if ",
                "when ",
                "not created",
                "not generated",
                "not saved",
                "not modified",
                "haven't created",
                "have not created",
                "didn't create",
                "did not create",
            ]
            .iter()
            .any(|term| normalized.contains(term));
            let claims_completion = [
                "我已创建",
                "我已经创建",
                "我已经为您创建",
                "我已为您创建",
                "我已生成",
                "我已经生成",
                "我已经为您生成",
                "我已为您生成",
                "我已保存",
                "我已经保存",
                "我已修改",
                "我已经修改",
                "我已写入",
                "我已经写入",
                "已经创建完成",
                "已创建完成",
                "创建完成",
                "已经成功写入",
                "i created",
                "i've created",
                "i have created",
                "i generated",
                "i've generated",
                "i have generated",
                "i saved",
                "i've saved",
                "i have saved",
                "i modified",
                "i've modified",
                "i have modified",
                "has been created",
                "has been saved",
                "has been modified",
            ]
            .iter()
            .any(|term| normalized.contains(term));

            mentions_artifact && claims_completion && !conditional_or_negative
        })
}

fn a2ui_form_example() -> String {
    let capabilities = a2ui::get_capabilities();
    let version = capabilities.preferred_version;
    let catalog_id = capabilities.catalog.catalog_id;
    json!({
        "data": [
            {
                "version": &version,
                "createSurface": {
                    "surfaceId": "profile-form",
                    "catalogId": &catalog_id
                }
            },
            {
                "version": &version,
                "updateComponents": {
                    "surfaceId": "profile-form",
                    "components": [
                        {
                            "id": "root",
                            "component": "Column",
                            "props": {"gap": "md"},
                            "children": ["title", "form"]
                        },
                        {
                            "id": "title",
                            "component": "Text",
                            "props": {"text": "Contact form", "variant": "title"}
                        },
                        {
                            "id": "form",
                            "component": "Form",
                            "props": {"name": "contact"},
                            "children": ["name-input", "submit-button"],
                            "actions": {"submit": {"type": "submit_form"}}
                        },
                        {
                            "id": "name-input",
                            "component": "TextField",
                            "props": {"name": "name", "label": "Name", "required": true},
                            "actions": {"change": {"type": "set_state", "target": "name"}}
                        },
                        {
                            "id": "submit-button",
                            "component": "Button",
                            "props": {"label": "Submit", "variant": "primary"},
                            "actions": {"click": {"type": "submit_form"}}
                        }
                    ]
                }
            },
            {
                "version": &version,
                "updateDataModel": {
                    "surfaceId": "profile-form",
                    "path": "/",
                    "value": {"name": ""}
                }
            }
        ],
        "kind": "data",
        "metadata": {"mimeType": "application/a2ui+json"}
    })
    .to_string()
}

fn a2ui_dashboard_example() -> String {
    let capabilities = a2ui::get_capabilities();
    let version = capabilities.preferred_version;
    let catalog_id = capabilities.catalog.catalog_id;
    json!({
        "data": [
            {
                "version": &version,
                "createSurface": {
                    "surfaceId": "project-panel",
                    "catalogId": &catalog_id
                }
            },
            {
                "version": &version,
                "updateComponents": {
                    "surfaceId": "project-panel",
                    "components": [
                        {
                            "id": "root",
                            "component": "Column",
                            "props": {"gap": "md"},
                            "children": ["checklist", "owner", "date", "status", "table", "issue"]
                        },
                        {
                            "id": "checklist",
                            "component": "Checklist",
                            "props": {
                                "name": "doneItems",
                                "label": "发布清单",
                                "items": [
                                    {"key": "review", "label": "完成评审"},
                                    {"key": "release", "label": "准备发布"}
                                ],
                                "value": ["review"]
                            },
                            "actions": {"change": {"type": "set_state", "target": "doneItems"}}
                        },
                        {
                            "id": "owner",
                            "component": "Owner",
                            "props": {"displayName": "Ada", "label": "负责人", "detail": "产品"}
                        },
                        {
                            "id": "date",
                            "component": "Date",
                            "props": {"name": "dueDate", "label": "截止日期", "value": "2026-09-30"},
                            "actions": {"change": {"type": "set_state", "target": "dueDate"}}
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
                                "caption": "任务表格",
                                "columns": [
                                    {"key": "task", "label": "任务"},
                                    {"key": "progress", "label": "进度", "align": "end"}
                                ],
                                "rows": [
                                    {"task": "设计", "progress": "完成"},
                                    {"task": "发布", "progress": "进行中"}
                                ]
                            }
                        },
                        {
                            "id": "issue",
                            "component": "IssueCard",
                            "props": {
                                "issueKey": "A2UI-32",
                                "title": "完成项目面板",
                                "summary": "固定 Catalog 的可信交互界面",
                                "status": "in_progress",
                                "priority": "high",
                                "owner": "Ada",
                                "dueDate": "2026-09-30"
                            }
                        }
                    ]
                }
            },
            {
                "version": &version,
                "updateDataModel": {
                    "surfaceId": "project-panel",
                    "path": "/",
                    "value": {"doneItems": ["review"], "dueDate": "2026-09-30"}
                }
            }
        ],
        "kind": "data",
        "metadata": {"mimeType": "application/a2ui+json"}
    })
    .to_string()
}

#[cfg(test)]
fn a2ui_review_action_example(workspace_id: &str) -> String {
    a2ui_review_action_message(
        workspace_id,
        "review-action-card",
        "会议纪要",
        "点击后先查看修改",
        "保存为成果",
        json!({
            "version": "1.0",
            "type": "create_file",
            "workspaceId": workspace_id,
            "summary": "保存会议纪要",
            "title": "会议纪要",
            "fileName": "action-created.md",
            "format": "markdown",
            "content": "# 会议纪要\n\n第一行会议内容。\n第二行会议内容。\n",
            "reason": "用户点击后创建可审阅成果",
            "risk": "high"
        }),
    )
}

fn a2ui_review_action_plan_example(workspace_id: &str) -> String {
    json!({
        "type": "a2ui_review_card",
        "title": "会议纪要",
        "description": "点击后先查看修改",
        "buttonLabel": "保存为成果",
        "candidate": {
            "version": "1.0",
            "type": "create_file",
            "workspaceId": workspace_id,
            "summary": "保存会议纪要",
            "title": "会议纪要",
            "fileName": "action-created.md",
            "format": "markdown",
            "content": "# 会议纪要\n\n第一行会议内容。\n第二行会议内容。\n",
            "reason": "用户点击后创建可审阅成果",
            "risk": "high"
        }
    })
    .to_string()
}

fn compile_review_action_plan(raw: &str, workspace_id: &str, message_id: &str) -> Option<String> {
    let json = patch::extract_json(raw)?;
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("a2ui_review_card") {
        return None;
    }
    let plan: A2uiReviewActionPlan = serde_json::from_value(value).ok()?;
    if plan.kind != "a2ui_review_card" {
        return None;
    }
    let surface_id = format!("review-action-{message_id}");
    Some(a2ui_review_action_message(
        workspace_id,
        &surface_id,
        &plan.title,
        &plan.description,
        &plan.button_label,
        plan.candidate,
    ))
}

fn compile_tool_plan(raw: &str, message_id: &str) -> Option<String> {
    let source = patch::extract_json(raw)?;
    let value: serde_json::Value = serde_json::from_str(source).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("a2ui_tool") {
        return None;
    }
    match value.get("toolKind").and_then(serde_json::Value::as_str)? {
        "checklist" => {
            let plan: A2uiChecklistToolPlan = serde_json::from_value(value).ok()?;
            if plan.kind != "a2ui_tool"
                || plan.tool_kind != "checklist"
                || plan.title.trim().is_empty()
                || plan.title.chars().count() > 120
                || plan.items.is_empty()
                || plan.items.len() > 20
            {
                return None;
            }
            let mut keys = std::collections::BTreeSet::new();
            if plan.items.iter().any(|item| {
                !valid_tool_key(&item.key)
                    || !keys.insert(item.key.clone())
                    || item.label.trim().is_empty()
                    || item.label.chars().count() > 120
            }) {
                return None;
            }
            Some(a2ui_checklist_tool_message(
                &format!("checklist-tool-{message_id}"),
                plan,
            ))
        }
        "planner" => {
            let plan: A2uiPlannerToolPlan = serde_json::from_value(value).ok()?;
            if plan.kind != "a2ui_tool"
                || plan.tool_kind != "planner"
                || plan.title.trim().is_empty()
                || plan.title.chars().count() > 120
                || plan.task.chars().count() > 240
                || plan.owner.chars().count() > 120
                || !valid_tool_date(&plan.due_date)
                || !["未开始", "进行中", "已完成", "已暂停"].contains(&plan.status.as_str())
            {
                return None;
            }
            Some(a2ui_planner_tool_message(
                &format!("planner-tool-{message_id}"),
                plan,
            ))
        }
        _ => None,
    }
}

fn valid_tool_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_tool_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

fn a2ui_checklist_tool_message(surface_id: &str, plan: A2uiChecklistToolPlan) -> String {
    let capabilities = a2ui::get_capabilities();
    let selected = plan
        .items
        .iter()
        .filter(|item| item.completed)
        .map(|item| item.key.clone())
        .collect::<Vec<_>>();
    let items = plan
        .items
        .into_iter()
        .map(|item| json!({"key": item.key, "label": item.label}))
        .collect::<Vec<_>>();
    json!({
        "data": [
            {"version": capabilities.preferred_version, "createSurface": {
                "surfaceId": surface_id, "catalogId": capabilities.catalog.catalog_id
            }},
            {"version": capabilities.preferred_version, "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {"id":"root","component":"Column","props":{"gap":"md"},"children":["title","help","items","notes","result"]},
                    {"id":"title","component":"Text","props":{"text":plan.title,"variant":"title"}},
                    {"id":"help","component":"Text","props":{"text":"勾选项目或填写备注后，结果会自动保存；可到成果页导出 JSON。","tone":"muted"}},
                    {"id":"items","component":"Checklist","props":{"name":"doneItems","label":"检查项目","items":items,"value":selected},"actions":{"change":{"type":"set_state","target":"doneItems"}}},
                    {"id":"notes","component":"TextField","props":{"name":"notes","label":"备注","placeholder":"可填写检查说明","maxLength":500},"actions":{"change":{"type":"set_state","target":"notes"}}},
                    {"id":"result","component":"ResultSummary","props":{"title":"当前检查结果","fields":["doneItems","notes"]}}
                ]
            }},
            {"version": capabilities.preferred_version, "updateDataModel": {
                "surfaceId": surface_id, "path":"/", "value":{"doneItems":selected,"notes":""}
            }}
        ],
        "kind":"data",
        "metadata":{"mimeType":"application/a2ui+json"}
    }).to_string()
}

fn a2ui_planner_tool_message(surface_id: &str, plan: A2uiPlannerToolPlan) -> String {
    let capabilities = a2ui::get_capabilities();
    json!({
        "data": [
            {"version": capabilities.preferred_version, "createSurface": {
                "surfaceId": surface_id, "catalogId": capabilities.catalog.catalog_id
            }},
            {"version": capabilities.preferred_version, "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {"id":"root","component":"Column","props":{"gap":"md"},"children":["title","help","task","owner","due-date","status","result"]},
                    {"id":"title","component":"Text","props":{"text":plan.title,"variant":"title"}},
                    {"id":"help","component":"Text","props":{"text":"修改计划后，当前结果会自动保存；可到成果页导出 JSON。","tone":"muted"}},
                    {"id":"task","component":"TextField","props":{"name":"task","label":"任务","value":plan.task,"required":true,"maxLength":240},"actions":{"change":{"type":"set_state","target":"task"}}},
                    {"id":"owner","component":"TextField","props":{"name":"owner","label":"负责人","value":plan.owner,"maxLength":120},"actions":{"change":{"type":"set_state","target":"owner"}}},
                    {"id":"due-date","component":"Date","props":{"name":"dueDate","label":"截止日期","value":plan.due_date},"actions":{"change":{"type":"set_state","target":"dueDate"}}},
                    {"id":"status","component":"Select","props":{"name":"status","label":"状态","value":plan.status,"allowCustom":false,"options":[{"label":"未开始","value":"未开始"},{"label":"进行中","value":"进行中"},{"label":"已完成","value":"已完成"},{"label":"已暂停","value":"已暂停"}]},"actions":{"change":{"type":"set_state","target":"status"}}},
                    {"id":"result","component":"ResultSummary","props":{"title":"当前计划结果","fields":["task","owner","dueDate","status"]}}
                ]
            }},
            {"version": capabilities.preferred_version, "updateDataModel": {
                "surfaceId": surface_id, "path":"/", "value":{"task":plan.task,"owner":plan.owner,"dueDate":plan.due_date,"status":plan.status}
            }}
        ],
        "kind":"data",
        "metadata":{"mimeType":"application/a2ui+json"}
    }).to_string()
}

fn requested_a2ui_tool(prompt: &str) -> Option<A2uiToolKind> {
    let normalized = prompt.to_ascii_lowercase();
    let interactive = ["交互", "小工具", "工具", "surface", "interactive"]
        .iter()
        .any(|marker| normalized.contains(marker));
    if !interactive {
        return None;
    }
    if ["检查表", "检查清单", "checklist"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        Some(A2uiToolKind::Checklist)
    } else if ["计划表", "项目计划", "planner"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        Some(A2uiToolKind::Planner)
    } else {
        None
    }
}

fn a2ui_tool_plan_examples() -> String {
    let checklist = json!({
        "type":"a2ui_tool","toolKind":"checklist","title":"发布检查表",
        "items":[{"key":"review","label":"完成评审","completed":true},{"key":"release","label":"准备发布","completed":false}]
    });
    let planner = json!({
        "type":"a2ui_tool","toolKind":"planner","title":"项目计划表",
        "task":"准备发布","owner":"Ada","dueDate":"2026-09-30","status":"进行中"
    });
    format!("checklist={checklist}; planner={planner}")
}

fn a2ui_review_action_message(
    _workspace_id: &str,
    surface_id: &str,
    title: &str,
    description: &str,
    button_label: &str,
    candidate: serde_json::Value,
) -> String {
    let capabilities = a2ui::get_capabilities();
    let version = capabilities.preferred_version;
    let catalog_id = capabilities.catalog.catalog_id;
    json!({
        "data": [
            {
                "version": &version,
                "createSurface": {
                    "surfaceId": surface_id,
                    "catalogId": &catalog_id
                }
            },
            {
                "version": &version,
                "updateComponents": {
                    "surfaceId": surface_id,
                    "components": [
                        {
                            "id": "root",
                            "component": "Column",
                            "props": {"gap": "md"},
                            "children": ["title", "description", "review-button"]
                        },
                        {
                            "id": "title",
                            "component": "Text",
                            "props": {"text": title, "variant": "title"}
                        },
                        {
                            "id": "description",
                            "component": "Text",
                            "props": {"text": description}
                        },
                        {
                            "id": "review-button",
                            "component": "Button",
                            "props": {"label": button_label, "variant": "primary"},
                            "actions": {
                                "click": {
                                    "type": "request_patch",
                                    "value": candidate
                                }
                            }
                        }
                    ]
                }
            }
        ],
        "kind": "data",
        "metadata": {"mimeType": "application/a2ui+json"}
    })
    .to_string()
}

fn requires_a2ui_review_action(prompt: &str) -> bool {
    let normalized = prompt.to_ascii_lowercase();
    let interactive = [
        "交互",
        "卡片",
        "界面",
        "按钮",
        "surface",
        "button",
        "interactive ui",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    let persistent_review = [
        "request_patch",
        "document_patch",
        "replace_empty_file",
        "查看修改",
        "进入审阅",
        "先让我查看",
        "review before",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    // Local tool autosave is not a request to propose a file write. Keep
    // explicit review markers authoritative, even when autosave is also present.
    let save_request = normalized
        .replace("自动保存为成果", "")
        .replace("automatically save as result", "");
    let save_action = ["保存为成果", "save as result"]
        .iter()
        .any(|marker| save_request.contains(marker));
    interactive && (persistent_review || save_action)
}

fn semantic_patch_system_prompt(workspace_id: &str) -> String {
    let a2ui_form_example = a2ui_form_example();
    let a2ui_dashboard_example = a2ui_dashboard_example();
    let a2ui_review_action_plan_example = a2ui_review_action_plan_example(workspace_id);
    let a2ui_tool_plan_examples = a2ui_tool_plan_examples();
    let capabilities = a2ui::get_capabilities();
    let catalog_components = capabilities.catalog.components.join(", ");
    let catalog_actions = capabilities.catalog.actions.join(", ");
    format!(
        r#"You are A2UI Workbench's coding assistant. Never claim a file was changed.
When modifying a supplied non-empty editable file, return exactly one JSON object and no prose. It must use this schema:
{{"version":"1.0","type":"document_patch","workspaceId":"{workspace_id}","summary":"short summary","changes":[{{"id":"unique id","path":"exact context label","operation":"replace|insert_before|insert_after|delete","anchor":{{"before":"an exact non-empty uniquely occurring substring"}},"content":"replacement or insertion text; empty for delete","reason":"reason","risk":"low|medium|high"}}]}}
Keep the patch compact: at most 3 changes, each anchor at most 500 characters, and each content at most 1500 characters. Never repeat unchanged file content. Do not calculate or include baseRevision, baseHash, or beforeHash; the trusted Rust runtime derives them from the current disk contents. Only propose changes for explicitly supplied editable text context. Do not use regex anchors, absolute paths, traversal, guessed content, or duplicate/overlapping anchors.
When the user asks to create a new text document and no editable target was supplied, return: {{"version":"1.0","type":"create_file","workspaceId":"{workspace_id}","summary":"short summary","title":"result title","fileName":"safe-name.md","format":"markdown","content":"full candidate content","reason":"reason","risk":"low|medium|high"}}. The fileName must be one safe relative name ending in .md, .markdown, or .txt; never use a path. No file exists until the user accepts the review.
When the explicitly supplied editable target is empty, return: {{"version":"1.0","type":"replace_empty_file","workspaceId":"{workspace_id}","summary":"short summary","path":"exact context label","content":"full candidate content","reason":"reason","risk":"low|medium|high"}}. Never use this type for a non-empty file. No content is written until the user accepts the review.
When the user explicitly asks for an interactive form, dashboard, or UI instead of a file change, use the negotiated A2UI v0.9.1 renderer profile. Return exactly one compact A2A DataPart JSON object and no prose. Use this complete valid form as the structural template: {a2ui_form_example}. For a project panel, table, owner, date, status, or issue UI, copy this complete valid seven-component template and change only requested literal values, items, and rows: {a2ui_dashboard_example}. A real interactive checklist tool or planner tool is an exception: return exactly one compact a2ui_tool plan and no prose, using the matching strict example: {a2ui_tool_plan_examples}. Trusted Rust compiles that bounded plan into fixed inputs plus a live ResultSummary, then applies the full Catalog and Schema validator. Do not return a display-only dashboard for a requested tool. A review-action UI is the other exception to the full DataPart response: if the requested UI includes a Button that proposes a persistent file change, return exactly one compact a2ui_review_card plan and no prose, using this schema and example: {a2ui_review_action_plan_example}. Change title, description, buttonLabel, and candidate to match the user. candidate MUST be one complete document_patch, create_file, or replace_empty_file object using the exact schema above and workspaceId={workspace_id}. Trusted Rust compiles this bounded plan into the fixed A2UI Button structure and then applies the same Catalog, Schema, action, resource, and required-action validation; it never repairs malformed JSON or trusts the candidate. A safe but unrelated form or dashboard is not an acceptable answer. request_patch never uses target and is invalid without value; clicking it only opens Review and cannot write before the user accepts. Do not add Row/Text wrappers around Owner, Date, Status, Table, IssueCard, or ResultSummary because those components already provide their own labels. Components are a flat list. A children entry is only a reference and NEVER creates a component: every referenced child id MUST have its own complete object in the same components array, every id MUST be unique, root MUST exist, and every component MUST be reachable from root. Before answering, compare the referenced-id set with the defined-id set and do not omit referenced definitions. Catalog components are only {catalog_components}. Every TextField, Select, Checkbox, Checklist, and Date with props.name MUST declare {{"change":{{"type":"set_state","target":"theSameName"}}}} in actions. Select options MUST use label/value objects. Expanded component props are: Checklist={{name,label,items:[{{key,label,disabled?}}],value?:string[],disabled?}}; Owner={{displayName,label?,detail?,initials?}}; Date={{name,label,value?:YYYY-MM-DD,min?:YYYY-MM-DD,max?:YYYY-MM-DD,required?,disabled?}}; Status={{text,label?,tone?}}; Table={{caption,columns:[{{key,label,align?}}],rows:[objects with only primitive cells]}}; IssueCard={{issueKey,title,summary?,status:open|in_progress|blocked|done|closed,priority?:low|normal|high|urgent,owner?,dueDate?:YYYY-MM-DD}}; ResultSummary={{title,fields:[inputName]}}. Event keys are only click, change, submit, or tab_change; Actions are only {catalog_actions}. Never emit inline catalogs, HTML, script, iframe, URLs, commands, dynamic components, sendDataModel=true, or deleteSurface. Later changes to an existing surface use the same DataPart envelope with updateComponents and/or updateDataModel for that surface, without createSurface.
If neither a safe patch nor a safe A2UI Surface is appropriate, answer with ordinary guidance text."#
    )
}

fn a2ui_repair_instruction(
    result: &A2uiProcessResult,
    workspace_id: &str,
    user_prompt: &str,
) -> Option<A2uiRepairInstruction> {
    (!result.inspection.validation.valid).then(|| {
        let errors = result
            .inspection
            .validation
            .errors
            .join("; ")
            .chars()
            .take(MAX_A2UI_REPAIR_ERROR_CHARS)
            .collect::<String>();
        let syntax_error = result
            .inspection
            .validation
            .errors
            .iter()
            .any(|error| error.starts_with("A2UI JSON 无效："));
        let requires_review_action = requires_a2ui_review_action(user_prompt);
        let requested_tool = requested_a2ui_tool(user_prompt);
        let prompt = if requires_review_action {
            let valid_example = a2ui_review_action_plan_example(workspace_id);
            format!(
                "The requested review-action UI failed validation: {errors}. Start over. Return exactly one compact a2ui_review_card plan and no prose, not a full A2UI DataPart. Use this schema and example; change only title, description, buttonLabel, and the complete candidate required by the original request: {valid_example}"
            )
        } else if requested_tool.is_some() {
            let valid_examples = a2ui_tool_plan_examples();
            format!(
                "The requested real tool failed validation: {errors}. Start over. Return exactly one compact a2ui_tool plan and no prose, using the matching checklist or planner example: {valid_examples}"
            )
        } else if syntax_error {
            let valid_example = a2ui_dashboard_example();
            format!(
                "The A2UI output was invalid JSON: {errors}. Start over instead of repeating or editing the malformed string. Return one complete compact JSON object only. Every object in components must start with {{ and adjacent objects must be separated by }},{{. Use this validator-approved shape as the structural template and change only literal values needed by the original user request: {valid_example}"
            )
        } else {
            format!(
                "Your previous A2UI DataPart was rejected by the trusted validator: {errors}. Regenerate the entire DataPart once as JSON only. Preserve the user's requested UI. Every id referenced by children must also appear exactly once as a complete components-array object; references do not create components. Recheck version, catalogId, component props, event names, actions, root reachability, and the DataPart envelope before answering."
            )
        };
        A2uiRepairInstruction {
            prompt,
            include_previous_output: !syntax_error
                && !requires_review_action
                && requested_tool.is_none(),
        }
    })
}

fn review_completion_content(review: &ReviewRequest) -> String {
    match review.operation_kind {
        ReviewOperationKind::DocumentPatch => {
            "AI 已生成可审阅的文件修改方案；文件尚未被修改。".to_string()
        }
        ReviewOperationKind::CreateFile => {
            "AI 已生成完整成果候选；接受后将保存到“我的成果”，当前尚未创建文件。".to_string()
        }
        ReviewOperationKind::ReplaceResult => {
            "AI 已生成完整内容候选；请在审阅中心确认，当前文件尚未修改。".to_string()
        }
    }
}

fn a2ui_completion_content(result: &A2uiProcessResult) -> String {
    if result.inspection.validation.valid {
        "交互界面已生成并通过安全校验，已在工作台的 Surface 区域打开。原始协议仅在 Inspector 中提供给开发者查看。".into()
    } else {
        "交互界面未通过安全校验，因此没有渲染。你可以重试；技术详情和原始协议已保留在 Inspector。"
            .into()
    }
}

fn should_retry_invalid_review(
    content: &str,
    review_result: &Result<ReviewRequest, AppError>,
) -> bool {
    if !super::review::looks_like_candidate(content) {
        return false;
    }
    matches!(review_result, Err(AppError::InvalidInput(_)))
}

#[cfg(test)]
mod tests {
    use super::{
        a2ui_completion_content, a2ui_dashboard_example, a2ui_form_example,
        a2ui_repair_instruction, a2ui_review_action_example, a2ui_review_action_plan_example,
        claims_unverified_file_completion, compile_review_action_plan, compile_tool_plan,
        requested_a2ui_tool, requires_a2ui_review_action, review_completion_content,
        semantic_patch_system_prompt, should_retry_invalid_review, A2uiToolKind,
    };
    use crate::a2ui;
    use crate::domain::review::{
        ReviewOperationKind, ReviewRequest, ReviewRisk, ReviewSource, ReviewStatus,
    };
    use crate::error::AppError;
    use crate::storage::Storage;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn retries_any_invalid_review_candidate_once() {
        let malformed: Result<ReviewRequest, AppError> =
            Err(AppError::InvalidInput("Patch Schema 无效".into()));
        assert!(should_retry_invalid_review(
            r#"{"type":"document_patch"}"#,
            &malformed
        ));
        assert!(should_retry_invalid_review(
            r#"{"type":"create_file"}"#,
            &Err(AppError::InvalidInput("bad name".into()))
        ));
        assert!(!should_retry_invalid_review(
            "ordinary guidance",
            &malformed
        ));
        assert!(!should_retry_invalid_review(
            r#"{"type":"document_patch"}"#,
            &Err(AppError::Database(rusqlite::Error::InvalidQuery))
        ));
        assert!(!should_retry_invalid_review(
            r#"{"type":"document_patch"}"#,
            &Err(AppError::FileConflict)
        ));
    }

    #[test]
    fn stores_a_human_readable_message_for_a_valid_create_review() {
        let review = ReviewRequest {
            id: "review".into(),
            workspace_id: "workspace".into(),
            result_id: None,
            source: ReviewSource::Chat,
            operation_kind: ReviewOperationKind::CreateFile,
            status: ReviewStatus::Pending,
            summary: "trip".into(),
            risk: ReviewRisk::Low,
            base_revision_id: None,
            base_hash: None,
            blocks: vec![],
            application_operation_id: None,
            output_result_id: None,
            error_code: None,
            created_at: "now".into(),
            decided_at: None,
            applied_at: None,
        };

        let content = review_completion_content(&review);
        assert!(content.contains("我的成果"));
        assert!(!content.contains("create_file"));
    }

    #[test]
    fn catches_file_completion_claims_without_blocking_truthful_guidance() {
        for claim in [
            "您好！我已经为您创建了一个基础出游指南文档。",
            "I have created the requested document.",
            "文档已经创建完成。",
        ] {
            assert!(
                claims_unverified_file_completion(claim),
                "missed claim: {claim}"
            );
        }

        for guidance in [
            "我还没有创建任何文件。",
            "如果您已创建文档，可以继续编辑。",
            "我可以先为您整理一份文档大纲。",
            "The document has not been created.",
        ] {
            assert!(
                !claims_unverified_file_completion(guidance),
                "blocked truthful guidance: {guidance}"
            );
        }
    }

    #[test]
    fn system_prompt_matches_the_rust_owned_a2ui_capabilities() {
        let prompt = semantic_patch_system_prompt("workspace");
        let capabilities = a2ui::get_capabilities();
        assert!(prompt.contains(&format!("A2UI {}", capabilities.preferred_version)));
        assert!(prompt.contains(&capabilities.catalog.catalog_id));
        for component in capabilities.catalog.components {
            assert!(prompt.contains(&component), "missing component {component}");
        }
        for action in capabilities.catalog.actions {
            assert!(prompt.contains(&action), "missing action {action}");
        }
        assert!(prompt.contains("\"type\":\"a2ui_review_card\""));
        assert!(prompt.contains("Trusted Rust compiles this bounded plan"));
        assert!(prompt.contains("request_patch never uses target and is invalid without value"));
        assert!(prompt.contains("workspaceId=workspace"));
    }

    #[test]
    fn system_prompt_form_example_passes_the_real_a2ui_validator() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI prompt", "C:\\a2ui-prompt")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Prompt")
            .unwrap();

        let outcome = a2ui::process_message(
            &storage,
            &a2ui::ProcessA2uiRequest {
                workspace_id,
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: a2ui_form_example(),
            },
        )
        .unwrap()
        .unwrap();

        assert!(outcome.inspection.validation.valid);
        let surface = outcome.surface.as_ref().unwrap();
        assert_eq!(surface.root.id, "root");
        assert_eq!(surface.root.children.len(), 2);
        assert!(a2ui_repair_instruction(&outcome, "workspace", "普通表单").is_none());
        let content = a2ui_completion_content(&outcome);
        assert!(content.contains("通过安全校验"));
        assert!(!content.contains("createSurface"));
    }

    #[test]
    fn system_prompt_dashboard_example_passes_the_real_a2ui_validator() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI dashboard", "C:\\a2ui-dashboard")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Dashboard")
            .unwrap();

        let outcome = a2ui::process_message(
            &storage,
            &a2ui::ProcessA2uiRequest {
                workspace_id,
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: a2ui_dashboard_example(),
            },
        )
        .unwrap()
        .unwrap();

        assert!(outcome.inspection.validation.valid);
        let surface = outcome.surface.unwrap();
        assert_eq!(surface.root.children.len(), 6);
        assert_eq!(surface.root.children[0].component, "Checklist");
        assert_eq!(surface.root.children[5].component, "IssueCard");
    }

    #[test]
    fn review_action_example_passes_the_real_validator_and_intent_gate() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI action", "C:\\a2ui-action")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Action")
            .unwrap();

        let outcome = a2ui::process_message_with_required_action(
            &storage,
            &a2ui::ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: a2ui_review_action_example(&workspace_id),
            },
            Some("request_patch"),
        )
        .unwrap()
        .unwrap();

        assert!(outcome.inspection.validation.valid);
        let surface = outcome.surface.unwrap();
        assert_eq!(surface.root.children.len(), 3);
        assert_eq!(
            surface.root.children[2].actions["click"].action_type,
            "request_patch"
        );
    }

    #[test]
    fn compact_review_action_plan_compiles_then_passes_the_real_validator() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI plan", "C:\\a2ui-plan")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Plan")
            .unwrap();

        let compiled = compile_review_action_plan(
            &a2ui_review_action_plan_example(&workspace_id),
            &workspace_id,
            "assistant-message",
        )
        .unwrap();
        let outcome = a2ui::process_message_with_required_action(
            &storage,
            &a2ui::ProcessA2uiRequest {
                workspace_id,
                session_id,
                message_id: Uuid::new_v4().to_string(),
                raw_message: compiled,
            },
            Some("request_patch"),
        )
        .unwrap()
        .unwrap();

        assert!(outcome.inspection.validation.valid);
        let surface = outcome.surface.unwrap();
        assert_eq!(surface.surface_id, "review-action-assistant-message");
        assert_eq!(surface.root.children[0].props["text"], "会议纪要");
        assert_eq!(
            surface.root.children[2].actions["click"]
                .value
                .as_ref()
                .unwrap()["fileName"],
            "action-created.md"
        );
    }

    #[test]
    fn compact_review_action_plan_rejects_unknown_fields_instead_of_guessing() {
        let raw = serde_json::json!({
            "type": "a2ui_review_card",
            "title": "会议纪要",
            "description": "点击后先查看修改",
            "buttonLabel": "保存为成果",
            "candidate": {},
            "unexpected": true
        })
        .to_string();
        assert!(compile_review_action_plan(&raw, "workspace", "message").is_none());
        assert!(compile_review_action_plan("{truncated", "workspace", "message").is_none());
    }

    #[test]
    fn action_intent_detection_does_not_misclassify_the_s32_no_file_dashboard() {
        assert!(requires_a2ui_review_action(
            "生成交互卡片，提供保存为成果按钮，点击后先查看修改"
        ));
        assert!(requires_a2ui_review_action(
            "按钮提出 document_patch，点击后必须先让我查看修改"
        ));
        assert!(!requires_a2ui_review_action(
            "生成一个中文交互式项目执行面板，不要创建文件，包含清单和表格"
        ));
        assert!(!requires_a2ui_review_action(
            "修改当前文档，但先让我查看修改"
        ));
    }

    #[test]
    fn invalid_a2ui_result_produces_a_bounded_repair_instruction() {
        let result = a2ui::A2uiProcessResult {
            inspection: a2ui::A2uiInspectionView {
                id: "inspection".into(),
                message_id: "message".into(),
                surface_id: Some("form".into()),
                raw_message: "{}".into(),
                validation: a2ui::A2uiValidation {
                    valid: false,
                    errors: vec![format!("A2UI 组件引用不存在：title {}", "x".repeat(5000))],
                    warnings: vec![],
                    duration_ms: 0,
                    error_code: Some("A2UI_VALIDATION_FAILED".into()),
                    negotiation: None,
                },
                created_at: None,
            },
            surface: None,
        };

        let instruction = a2ui_repair_instruction(&result, "workspace", "普通表单").unwrap();
        assert!(instruction.prompt.contains("A2UI 组件引用不存在：title"));
        assert!(instruction
            .prompt
            .contains("references do not create components"));
        assert!(instruction.prompt.chars().count() < 1800);
        assert!(instruction.include_previous_output);
        let content = a2ui_completion_content(&result);
        assert!(content.contains("没有渲染"));
        assert!(!content.contains("组件引用不存在"));
    }

    #[test]
    fn invalid_json_restarts_from_a_validator_approved_template() {
        let result = a2ui::A2uiProcessResult {
            inspection: a2ui::A2uiInspectionView {
                id: "inspection".into(),
                message_id: "message".into(),
                surface_id: None,
                raw_message: r#"{"components":[{"id":"one"},"#.into(),
                validation: a2ui::A2uiValidation {
                    valid: false,
                    errors: vec!["A2UI JSON 无效：expected `,` or `]` at line 1 column 1358".into()],
                    warnings: vec![],
                    duration_ms: 0,
                    error_code: Some("A2UI_VALIDATION_FAILED".into()),
                    negotiation: None,
                },
                created_at: None,
            },
            surface: None,
        };

        let instruction = a2ui_repair_instruction(&result, "workspace", "项目执行面板").unwrap();
        assert!(!instruction.include_previous_output);
        assert!(instruction.prompt.contains("Start over"));
        assert!(instruction.prompt.contains("validator-approved shape"));
        assert!(instruction.prompt.contains("project-panel"));
        assert!(!instruction.prompt.contains(&result.inspection.raw_message));
    }

    #[test]
    fn missing_review_action_restarts_from_the_action_template() {
        let result = a2ui::A2uiProcessResult {
            inspection: a2ui::A2uiInspectionView {
                id: "inspection".into(),
                message_id: "message".into(),
                surface_id: Some("project-panel".into()),
                raw_message: a2ui_dashboard_example(),
                validation: a2ui::A2uiValidation {
                    valid: false,
                    errors: vec!["交互界面缺少用户要求的“查看修改”动作，不能作为本次结果".into()],
                    warnings: vec![],
                    duration_ms: 0,
                    error_code: Some("A2UI_VALIDATION_FAILED".into()),
                    negotiation: None,
                },
                created_at: None,
            },
            surface: None,
        };

        let instruction = a2ui_repair_instruction(
            &result,
            "workspace-action",
            "生成交互卡片，提供保存为成果按钮并先查看修改",
        )
        .unwrap();
        assert!(!instruction.include_previous_output);
        assert!(instruction.prompt.contains("a2ui_review_card"));
        assert!(instruction.prompt.contains("workspace-action"));
        assert!(instruction.prompt.contains("candidate"));
        assert!(!instruction.prompt.contains(&result.inspection.raw_message));
    }

    #[test]
    fn compact_real_tool_plans_compile_to_valid_live_result_surfaces() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4().to_string();
        storage
            .upsert_workspace(&workspace_id, "A2UI tools", "C:\\a2ui-tools")
            .unwrap();
        storage
            .create_session(&workspace_id, &session_id, "Tools")
            .unwrap();
        let plans = [
            json!({
                "type":"a2ui_tool","toolKind":"checklist","title":"发布检查表",
                "items":[{"key":"review","label":"完成评审","completed":true},{"key":"release","label":"准备发布","completed":false}]
            }),
            json!({
                "type":"a2ui_tool","toolKind":"planner","title":"项目计划表",
                "task":"准备发布","owner":"Ada","dueDate":"2026-09-30","status":"进行中"
            }),
        ];
        for (index, plan) in plans.into_iter().enumerate() {
            let manual = include_str!("../../../docs/S3_4_MANUAL_ACCEPTANCE.md");
            let prompt = manual
                .lines()
                .filter_map(|line| line.strip_prefix("> 生成"))
                .nth(index)
                .unwrap();
            assert!(!requires_a2ui_review_action(prompt));
            assert!(requested_a2ui_tool(prompt).is_some());
            let compiled = compile_tool_plan(&plan.to_string(), &format!("message-{index}"))
                .expect("valid tool plan compiles");
            let outcome = a2ui::process_message_with_requirements(
                &storage,
                &a2ui::ProcessA2uiRequest {
                    workspace_id: workspace_id.clone(),
                    session_id: session_id.clone(),
                    message_id: format!("message-{index}"),
                    raw_message: compiled,
                },
                requires_a2ui_review_action(prompt).then_some("request_patch"),
                Some("ResultSummary"),
            )
            .unwrap()
            .unwrap();
            assert!(outcome.inspection.validation.valid);
            let surface = outcome.surface.unwrap();
            assert!(surface
                .root
                .children
                .iter()
                .any(|node| node.component == "ResultSummary"));

            let invalid = a2ui::process_message_with_requirements(
                &storage,
                &a2ui::ProcessA2uiRequest {
                    workspace_id: workspace_id.clone(),
                    session_id: session_id.clone(),
                    message_id: format!("invalid-{index}"),
                    raw_message: "{\"type\":\"a2ui_tool\",".into(),
                },
                None,
                Some("ResultSummary"),
            )
            .unwrap()
            .expect("required tool must not fall through to plain chat");
            assert!(!invalid.inspection.validation.valid);
            assert!(invalid.surface.is_none());
            let repair = a2ui_repair_instruction(&invalid, &workspace_id, prompt).unwrap();
            assert!(repair.prompt.contains("a2ui_tool"));
            assert!(!repair.prompt.contains("a2ui_review_card"));
            assert!(requires_a2ui_review_action(&format!(
                "{prompt} 另加按钮提出 document_patch，先查看修改"
            )));
        }
    }

    #[test]
    fn tool_plan_compiler_rejects_unknown_fields_and_invalid_values() {
        let unknown = json!({
            "type":"a2ui_tool","toolKind":"checklist","title":"检查表",
            "items":[{"key":"one","label":"一"}],"script":"alert(1)"
        });
        let invalid_date = json!({
            "type":"a2ui_tool","toolKind":"planner","title":"计划表",
            "task":"发布","owner":"Ada","dueDate":"tomorrow","status":"进行中"
        });
        assert!(compile_tool_plan(&unknown.to_string(), "message").is_none());
        assert!(compile_tool_plan(&invalid_date.to_string(), "message").is_none());
        assert_eq!(
            requested_a2ui_tool("生成一个真实交互检查表小工具"),
            Some(A2uiToolKind::Checklist)
        );
        assert_eq!(
            requested_a2ui_tool("生成一个交互项目计划表"),
            Some(A2uiToolKind::Planner)
        );
    }
}
