use crate::a2ui::{self, A2uiProcessResult, ProcessA2uiRequest};
use crate::ai::{self, ChatRequest, ContextSourceKind, ProviderMessage};
use crate::error::AppError;
use crate::patch::{self, PatchReview};
use crate::repository::chat::{ChatRepository, StartChatRequest};
use crate::repository::provider::ProviderRepository;
use crate::security::{validate_provider_id, SecretStore};
use crate::storage::{ChatSessionRecord, Storage};
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

const FILE_CREATION_NOT_AVAILABLE_CODE: &str = "FILE_CREATION_NOT_AVAILABLE";
const FILE_CREATION_NOT_AVAILABLE_MESSAGE: &str =
    "当前版本尚不支持直接新建文件；没有文件被创建。请选择一个可编辑文本文件后请求修改。";

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
    cancellation: Arc<AtomicBool>,
    mut emit: F,
) -> Result<ChatStreamResult, AppError>
where
    F: FnMut(ChatStreamEvent) -> Result<(), AppError>,
{
    let validated = ai::validate_chat_request(&request)?;
    let provider_id = validate_provider_id(&request.provider_id)?;
    let config = ProviderRepository::new(storage)
        .find(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    let repository = ChatRepository::new(storage);
    let sources_json =
        serde_json::to_string(&validated.sources).map_err(|_| AppError::StateUnavailable)?;
    let start_request = || {
        repository.start_request(StartChatRequest {
            workspace_id: &request.workspace_id,
            session_id: &request.session_id,
            request_id: &request.request_id,
            user_message_id: &request.user_message_id,
            assistant_message_id: &request.assistant_message_id,
            provider_id: &provider_id,
            prompt: request.prompt.trim(),
            sources_json: &sources_json,
            character_count: validated.character_count,
            estimated_tokens: validated.estimated_tokens,
            has_sensitive_warning: validated.has_sensitive_warning,
        })
    };
    if requests_unsupported_file_creation(&request) {
        start_request()?;
        repository.update_assistant(
            &request.assistant_message_id,
            FILE_CREATION_NOT_AVAILABLE_MESSAGE,
            "complete",
            Some(FILE_CREATION_NOT_AVAILABLE_CODE),
        )?;
        let _ = emit(ChatStreamEvent::Complete {
            request_id: request.request_id.clone(),
            message_id: request.assistant_message_id.clone(),
        });
        return Ok(ChatStreamResult {
            request_id: request.request_id,
            message_id: request.assistant_message_id,
            content: FILE_CREATION_NOT_AVAILABLE_MESSAGE.into(),
            status: "complete".into(),
            error_code: Some(FILE_CREATION_NOT_AVAILABLE_CODE.into()),
            error_message: None,
            retryable: false,
            retry_after_seconds: None,
            patch: None,
            patch_error: None,
            a2ui: None,
        });
    }
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput(
            "当前 Provider 尚未配置 API Key".into(),
        ));
    }
    let api_key = SecretStore::get(&provider_id)?;
    let history = repository.recent_messages(&request.session_id, request.recent_message_count)?;
    start_request()?;

    let mut messages = vec![ProviderMessage {
        role: "system".into(),
        content: semantic_patch_system_prompt(&request.workspace_id),
    }];
    messages.extend(history);
    messages.push(ProviderMessage {
        role: "user".into(),
        content: ai::build_context_prompt(&request.prompt, &request.context_sources),
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
            let mut patch_result = patch::parse_review(storage, &request.workspace_id, &content);
            if patch_result.is_err() && patch::looks_like_patch_candidate(&content) {
                let mut retry_messages = messages.clone();
                retry_messages.push(ProviderMessage {
                    role: "user".into(),
                    content: "Your previous document_patch was invalid or truncated. Regenerate it once as compact JSON only. Use at most 3 changes. Each exact anchor must be at most 500 characters and each change content at most 1500 characters. Do not repeat unchanged file content, and omit all hash fields.".into(),
                });
                match ai::stream_chat(&config, &api_key, &retry_messages, cancellation, |_| Ok(()))
                    .await
                {
                    Ok(retried) => {
                        content = retried;
                        patch_result =
                            patch::parse_review(storage, &request.workspace_id, &content);
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
            let (validated_patch, patch_error) = match patch_result {
                Ok(review) => (Some(review), None),
                Err(error) if patch::looks_like_patch_candidate(&content) => {
                    (None, Some(format!("AI 修改方案未通过安全校验：{error}")))
                }
                Err(_) => (None, None),
            };
            let a2ui_result = if validated_patch.is_none() && patch_error.is_none() {
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
            let unverified_completion_claim = validated_patch.is_none()
                && patch_error.is_none()
                && a2ui_result.is_none()
                && claims_unverified_file_completion(&content);
            let error_code = if patch_error.is_some() {
                Some("PATCH_VALIDATION_FAILED".to_string())
            } else if validated_patch.is_some() {
                Some("PATCH_READY".to_string())
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
            repository.update_assistant(
                &request.assistant_message_id,
                &content,
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
                content,
                status: "complete".into(),
                error_code,
                error_message: None,
                retryable: false,
                retry_after_seconds: None,
                patch: validated_patch,
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

fn requests_unsupported_file_creation(request: &ChatRequest) -> bool {
    let has_editable_context = request.context_sources.iter().any(|source| {
        matches!(
            source.kind,
            ContextSourceKind::Selection
                | ContextSourceKind::CurrentFile
                | ContextSourceKind::ProjectFile
        )
    });
    if has_editable_context {
        return false;
    }

    request
        .prompt
        .split(['。', '！', '？', '.', '!', '?', '\n'])
        .map(str::trim)
        .filter(|clause| !clause.is_empty())
        .any(|clause| {
            let normalized = clause.to_lowercase();
            let asks_how_or_status = [
                "为什么",
                "为何",
                "怎么",
                "如何",
                "是否",
                "有没有",
                "在哪里",
                "在哪呢",
                "没生成",
                "未生成",
                "how to",
                "why",
                "where is",
                "did you",
                "was it",
            ]
            .iter()
            .any(|term| normalized.contains(term));
            let requests_creation = [
                "新建",
                "创建",
                "生成",
                "制作",
                "起草",
                "写一份",
                "create",
                "generate",
                "make",
                "draft",
            ]
            .iter()
            .any(|term| normalized.contains(term));
            let mentions_file_artifact = [
                "文件",
                "文档",
                "报告",
                "指南",
                "纪要",
                "周报",
                "简历",
                "计划书",
                "行程单",
                "file",
                "document",
                "report",
                "guide",
                "minutes",
                "resume",
            ]
            .iter()
            .any(|term| normalized.contains(term));

            requests_creation && mentions_file_artifact && !asks_how_or_status
        })
}

fn semantic_patch_system_prompt(workspace_id: &str) -> String {
    format!(
        r#"You are A2UI Terminal's coding assistant. Never claim a file was changed.
When a file modification is appropriate, return exactly one JSON object and no prose. It must use this schema:
{{"version":"1.0","type":"document_patch","workspaceId":"{workspace_id}","summary":"short summary","changes":[{{"id":"unique id","path":"exact context label","operation":"replace|insert_before|insert_after|delete","anchor":{{"before":"an exact non-empty uniquely occurring substring"}},"content":"replacement or insertion text; empty for delete","reason":"reason","risk":"low|medium|high"}}]}}
Keep the patch compact: at most 3 changes, each anchor at most 500 characters, and each content at most 1500 characters. Never repeat unchanged file content. Do not calculate or include baseRevision, baseHash, or beforeHash; the trusted Rust runtime derives them from the current disk contents. Only propose changes for explicitly supplied editable text context. Do not use regex anchors, absolute paths, traversal, guessed content, or duplicate/overlapping anchors.
When the user explicitly asks for an interactive form, dashboard, or UI instead of a file change, return exactly one compact JSON object with version "1.0", type "a2ui_surface", a safe surfaceId, revision 1, one root component node, and optional data. Every node uses {{"id":"safe-id","component":"CatalogName","props":{{}},"children":[],"actions":{{}}}}. CatalogName must be one of Row, Column, Stack, Text, Card, Badge, Progress, TextField, Select, Checkbox, Button, Tabs, Form. Every TextField, Select, and Checkbox with props.name MUST declare {{"change":{{"type":"set_state","target":"theSameName"}}}} so the input is editable. Select options MUST use objects such as [{{"label":"Admin","value":"admin"}}], never string arrays. Select options are suggestions and custom text is allowed by default; use props.allowCustom=false only when the user explicitly requires a fixed enumeration. Event keys MUST be exactly click, change, submit, or tab_change; never use on_click, onClick, or other on-prefixed names. The actions object maps event names to action objects, never to strings. Use exact shapes such as {{"change":{{"type":"set_state","target":"fieldName"}}}}, {{"submit":{{"type":"submit_form"}}}}, or {{"click":{{"type":"request_patch"}}}}. Actions may only be set_state, submit_form, or request_patch. Never emit HTML, script, iframe, URLs, commands, or dynamic components. Later changes to an existing surface may use type "a2ui_update" with the next revision and operations set_data, remove_data, replace_props, or replace_children.
If neither a safe patch nor a safe A2UI Surface is appropriate, answer with ordinary guidance text."#
    )
}

#[cfg(test)]
mod tests {
    use super::{claims_unverified_file_completion, requests_unsupported_file_creation};
    use crate::ai::{ChatRequest, ContextSource, ContextSourceKind};

    fn chat_request(prompt: &str, context_sources: Vec<ContextSource>) -> ChatRequest {
        ChatRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            user_message_id: uuid::Uuid::new_v4().to_string(),
            assistant_message_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
            session_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "test-provider".into(),
            prompt: prompt.into(),
            recent_message_count: 0,
            context_sources,
            sensitive_confirmed: true,
        }
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
    fn blocks_new_document_intent_only_when_editable_context_is_missing() {
        for prompt in [
            "生成出游文档",
            "帮我创建一份会议纪要",
            "Draft a travel guide document",
        ] {
            assert!(
                requests_unsupported_file_creation(&chat_request(prompt, vec![])),
                "missed creation request: {prompt}"
            );
        }

        for prompt in [
            "如何生成文档？",
            "基础出游指南文档在哪里呢？",
            "为什么没生成文件？",
        ] {
            assert!(
                !requests_unsupported_file_creation(&chat_request(prompt, vec![])),
                "blocked a question: {prompt}"
            );
        }

        let editable = ContextSource {
            kind: ContextSourceKind::CurrentFile,
            label: "TRAVEL_GUIDE.md".into(),
            content: "# Travel\n".into(),
            base_hash: None,
        };
        assert!(!requests_unsupported_file_creation(&chat_request(
            "生成出游文档",
            vec![editable]
        )));
    }
}
