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
            let create_input = |raw: String| CreateReviewRequestInput {
                workspace_id: request.workspace_id.clone(),
                source: request.review_source.unwrap_or(ReviewSource::Chat),
                result_id: None,
                raw,
            };
            let mut review_result = (!request.explanation_only)
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
                    a2ui::process_message(
                        storage,
                        &ProcessA2uiRequest {
                            workspace_id: request.workspace_id.clone(),
                            session_id: request.session_id.clone(),
                            message_id: request.assistant_message_id.clone(),
                            raw_message: content.clone(),
                        },
                    )?
                } else {
                    None
                };
            if let Some(repair) = a2ui_result.as_ref().and_then(a2ui_repair_instruction) {
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
                match ai::stream_chat(&config, &api_key, &retry_messages, cancellation, |_| Ok(()))
                    .await
                {
                    Ok(retried) => {
                        if let Some(retried_result) = a2ui::process_message(
                            storage,
                            &ProcessA2uiRequest {
                                workspace_id: request.workspace_id.clone(),
                                session_id: request.session_id.clone(),
                                message_id: request.assistant_message_id.clone(),
                                raw_message: retried.clone(),
                            },
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
            let unverified_completion_claim = validated_review.is_none()
                && patch_error.is_none()
                && a2ui_result.is_none()
                && claims_unverified_file_completion(&content);
            let error_code = if patch_error.is_some() {
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
            let assistant_content = if let Some(review) = validated_review.as_ref() {
                review_completion_content(review)
            } else if let Some(result) = a2ui_result.as_ref() {
                a2ui_completion_content(result)
            } else {
                content.clone()
            };
            repository.update_assistant(
                &request.assistant_message_id,
                &assistant_content,
                "complete",
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
                status: "complete".into(),
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

fn semantic_patch_system_prompt(workspace_id: &str) -> String {
    let a2ui_form_example = a2ui_form_example();
    let a2ui_dashboard_example = a2ui_dashboard_example();
    let capabilities = a2ui::get_capabilities();
    let catalog_components = capabilities.catalog.components.join(", ");
    let catalog_actions = capabilities.catalog.actions.join(", ");
    format!(
        r#"You are A2UI Terminal's coding assistant. Never claim a file was changed.
When modifying a supplied non-empty editable file, return exactly one JSON object and no prose. It must use this schema:
{{"version":"1.0","type":"document_patch","workspaceId":"{workspace_id}","summary":"short summary","changes":[{{"id":"unique id","path":"exact context label","operation":"replace|insert_before|insert_after|delete","anchor":{{"before":"an exact non-empty uniquely occurring substring"}},"content":"replacement or insertion text; empty for delete","reason":"reason","risk":"low|medium|high"}}]}}
Keep the patch compact: at most 3 changes, each anchor at most 500 characters, and each content at most 1500 characters. Never repeat unchanged file content. Do not calculate or include baseRevision, baseHash, or beforeHash; the trusted Rust runtime derives them from the current disk contents. Only propose changes for explicitly supplied editable text context. Do not use regex anchors, absolute paths, traversal, guessed content, or duplicate/overlapping anchors.
When the user asks to create a new text document and no editable target was supplied, return: {{"version":"1.0","type":"create_file","workspaceId":"{workspace_id}","summary":"short summary","title":"result title","fileName":"safe-name.md","format":"markdown","content":"full candidate content","reason":"reason","risk":"low|medium|high"}}. The fileName must be one safe relative name ending in .md, .markdown, or .txt; never use a path. No file exists until the user accepts the review.
When the explicitly supplied editable target is empty, return: {{"version":"1.0","type":"replace_empty_file","workspaceId":"{workspace_id}","summary":"short summary","path":"exact context label","content":"full candidate content","reason":"reason","risk":"low|medium|high"}}. Never use this type for a non-empty file. No content is written until the user accepts the review.
When the user explicitly asks for an interactive form, dashboard, or UI instead of a file change, use the negotiated A2UI v0.9.1 renderer profile. Return exactly one compact A2A DataPart JSON object and no prose. Use this complete valid form as the structural template: {a2ui_form_example}. For a project panel, checklist, table, owner, date, status, or issue UI, copy this complete valid seven-component template and change only requested literal values, items, and rows: {a2ui_dashboard_example}. Do not add Row/Text wrappers around Owner, Date, Status, Table, or IssueCard because those components already provide their own labels. Components are a flat list. A children entry is only a reference and NEVER creates a component: every referenced child id MUST have its own complete object in the same components array, every id MUST be unique, root MUST exist, and every component MUST be reachable from root. Before answering, compare the referenced-id set with the defined-id set and do not omit referenced definitions. Catalog components are only {catalog_components}. Every TextField, Select, Checkbox, Checklist, and Date with props.name MUST declare {{"change":{{"type":"set_state","target":"theSameName"}}}} in actions. Select options MUST use label/value objects. Expanded component props are: Checklist={{name,label,items:[{{key,label,disabled?}}],value?:string[],disabled?}}; Owner={{displayName,label?,detail?,initials?}}; Date={{name,label,value?:YYYY-MM-DD,min?:YYYY-MM-DD,max?:YYYY-MM-DD,required?,disabled?}}; Status={{text,label?,tone?}}; Table={{caption,columns:[{{key,label,align?}}],rows:[objects with only primitive cells]}}; IssueCard={{issueKey,title,summary?,status:open|in_progress|blocked|done|closed,priority?:low|normal|high|urgent,owner?,dueDate?:YYYY-MM-DD}}. Event keys are only click, change, submit, or tab_change; Actions are only {catalog_actions}. Never emit inline catalogs, HTML, script, iframe, URLs, commands, dynamic components, sendDataModel=true, or deleteSurface. Later changes to an existing surface use the same DataPart envelope with updateComponents and/or updateDataModel for that surface, without createSurface.
If neither a safe patch nor a safe A2UI Surface is appropriate, answer with ordinary guidance text."#
    )
}

fn a2ui_repair_instruction(result: &A2uiProcessResult) -> Option<A2uiRepairInstruction> {
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
        let prompt = if syntax_error {
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
            include_previous_output: !syntax_error,
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
    review_result.is_err()
}

#[cfg(test)]
mod tests {
    use super::{
        a2ui_completion_content, a2ui_dashboard_example, a2ui_form_example,
        a2ui_repair_instruction, claims_unverified_file_completion, review_completion_content,
        semantic_patch_system_prompt, should_retry_invalid_review,
    };
    use crate::a2ui;
    use crate::domain::review::{
        ReviewOperationKind, ReviewRequest, ReviewRisk, ReviewSource, ReviewStatus,
    };
    use crate::error::AppError;
    use crate::storage::Storage;
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
        assert!(a2ui_repair_instruction(&outcome).is_none());
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

        let instruction = a2ui_repair_instruction(&result).unwrap();
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

        let instruction = a2ui_repair_instruction(&result).unwrap();
        assert!(!instruction.include_previous_output);
        assert!(instruction.prompt.contains("Start over"));
        assert!(instruction.prompt.contains("validator-approved shape"));
        assert!(instruction.prompt.contains("project-panel"));
        assert!(!instruction.prompt.contains(&result.inspection.raw_message));
    }
}
