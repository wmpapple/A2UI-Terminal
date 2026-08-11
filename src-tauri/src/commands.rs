use crate::a2ui::{
    self, A2uiInspectionView, A2uiProcessResult, A2uiSurfaceView, ActionExecutionResult,
    ExecuteActionRequest, ProcessA2uiRequest,
};
use crate::ai::{self, ChatRequest, ProviderConfig, ProviderConfigView, ProviderMessage};
use crate::error::AppError;
use crate::patch::{self, DocumentPatch, PatchApplication, PatchReview};
use crate::security::{validate_provider_id, SecretStore};
use crate::state::AppState;
use crate::storage::{ChatSessionRecord, DiagnosticCounts};
use crate::workspace::{
    self, DocumentVersion, DocumentVersionSummary, SaveOutcome, WorkspaceDocument,
    WorkspaceFileEntry, WorkspaceSummary,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

const CLEAR_CONFIRMATION: &str = "DELETE_ALL_LOCAL_DATA";
const BUILT_IN_PROVIDERS: &[&str] = &["siliconflow", "deepseek", "openai"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
    runtime: &'static str,
    database_ready: bool,
    schema_version: i64,
    credential_store: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    provider_id: String,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAllResult {
    cleared: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    format_version: &'static str,
    app_version: String,
    schema_version: i64,
    generated_at_unix_seconds: u64,
    platform: &'static str,
    architecture: &'static str,
    counts: DiagnosticCounts,
    privacy: DiagnosticPrivacy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPrivacy {
    message_bodies_included: bool,
    file_contents_included: bool,
    workspace_paths_included: bool,
    provider_secrets_included: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResult {
    exported: bool,
    file_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedWorkspaceFiles {
    workspace: WorkspaceSummary,
    documents: Vec<WorkspaceDocument>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorkspaceResult {
    removed: bool,
    project_files_deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Serialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchRequest {
    workspace_id: String,
    patch: DocumentPatch,
    selected_change_ids: Vec<String>,
    session_id: Option<String>,
    assistant_message_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionResult {
    provider_id: String,
    reachable: bool,
    latency_ms: u128,
}

#[tauri::command]
pub fn get_bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, AppError> {
    Ok(BootstrapStatus {
        runtime: "desktop",
        database_ready: true,
        schema_version: state.storage.schema_version()?,
        credential_store: "windows-credential-manager",
    })
}

#[tauri::command]
pub fn set_provider_secret(
    state: State<'_, AppState>,
    provider_id: String,
    secret: String,
) -> Result<SecretStatus, AppError> {
    let secret = Zeroizing::new(secret);
    let provider_id = validate_provider_id(&provider_id)?;
    let previous = SecretStore::get_optional(&provider_id)?;
    SecretStore::set(&provider_id, secret.as_str())?;
    if let Err(error) = state.storage.remember_provider_id(&provider_id) {
        if let Some(previous) = previous {
            let _ = SecretStore::set(&provider_id, previous.as_str());
        } else {
            let _ = SecretStore::delete(&provider_id);
        }
        return Err(error);
    }
    Ok(SecretStatus {
        provider_id,
        configured: true,
    })
}

#[tauri::command]
pub fn provider_secret_status(provider_id: String) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    Ok(SecretStatus {
        configured: SecretStore::exists(&provider_id)?,
        provider_id,
    })
}

#[tauri::command]
pub fn delete_provider_secret(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<SecretStatus, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    SecretStore::delete(&provider_id)?;
    state.storage.forget_provider_id(&provider_id)?;
    Ok(SecretStatus {
        provider_id,
        configured: false,
    })
}

#[tauri::command]
pub fn clear_all_local_data(
    state: State<'_, AppState>,
    confirmation: String,
) -> Result<ClearAllResult, AppError> {
    if confirmation != CLEAR_CONFIRMATION {
        return Err(AppError::InvalidInput(
            "清除本地数据需要精确确认文本".into(),
        ));
    }

    let mut provider_ids = state
        .storage
        .provider_ids()?
        .into_iter()
        .collect::<BTreeSet<_>>();
    provider_ids.extend(BUILT_IN_PROVIDERS.iter().map(ToString::to_string));
    for provider_id in provider_ids {
        SecretStore::delete(&provider_id)?;
    }
    state.storage.clear_all()?;
    state
        .selected_files
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .clear();
    for cancellation in state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .drain()
        .map(|(_, cancellation)| cancellation)
    {
        cancellation.store(true, Ordering::Release);
    }

    Ok(ClearAllResult { cleared: true })
}

fn build_diagnostic_report(
    app_version: String,
    schema_version: i64,
    counts: DiagnosticCounts,
) -> DiagnosticReport {
    DiagnosticReport {
        format_version: "1.0",
        app_version,
        schema_version,
        generated_at_unix_seconds: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        counts,
        privacy: DiagnosticPrivacy {
            message_bodies_included: false,
            file_contents_included: false,
            workspace_paths_included: false,
            provider_secrets_included: false,
        },
    }
}

#[tauri::command]
pub fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DiagnosticExportResult, AppError> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("导出脱敏诊断信息")
        .set_file_name("a2ui-terminal-diagnostics.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(DiagnosticExportResult {
            exported: false,
            file_name: None,
        });
    };
    let path = selection
        .into_path()
        .map_err(|_| AppError::InvalidInput("诊断导出路径无效".into()))?;
    let report = build_diagnostic_report(
        app.package_info().version.to_string(),
        state.storage.schema_version()?,
        state.storage.diagnostic_counts()?,
    );
    let json = serde_json::to_vec_pretty(&report)
        .map_err(|error| AppError::InvalidInput(format!("诊断信息序列化失败: {error}")))?;
    fs::write(&path, json)?;
    Ok(DiagnosticExportResult {
        exported: true,
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned),
    })
}

#[tauri::command]
pub async fn select_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<WorkspaceSummary>, AppError> {
    let selected = app
        .dialog()
        .file()
        .set_title("选择 A2UI Terminal 工作区")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected_path = selected
        .into_path()
        .map_err(|_| AppError::InvalidInput("只支持本机文件系统目录".into()))?;
    Ok(Some(workspace::register_workspace(
        &state.storage,
        &selected_path,
    )?))
}

#[tauri::command]
pub fn list_recent_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceSummary>, AppError> {
    workspace::list_recent(&state.storage)
}

#[tauri::command]
pub fn restore_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceSummary, AppError> {
    workspace::restore_workspace(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn list_workspace_files(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceFileEntry>, AppError> {
    workspace::list_files(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn read_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
) -> Result<WorkspaceDocument, AppError> {
    workspace::read_file(&state.storage, &workspace_id, &relative_path)
}

#[tauri::command]
pub fn list_recovery_drafts(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<workspace::RecoveryDraftSummary>, AppError> {
    workspace::list_recovery_drafts(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn save_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    content: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    workspace::save_file_with_history(
        &state.storage,
        &workspace_id,
        &relative_path,
        &content,
        &base_hash,
    )
}

#[tauri::command]
pub fn save_workspace_draft(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    content: String,
    base_hash: String,
) -> Result<(), AppError> {
    workspace::save_draft(
        &state.storage,
        &workspace_id,
        &relative_path,
        &content,
        &base_hash,
    )
}

#[tauri::command]
pub fn discard_workspace_draft(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
) -> Result<(), AppError> {
    workspace::discard_draft(&state.storage, &workspace_id, &relative_path)
}

#[tauri::command]
pub fn remove_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<RemoveWorkspaceResult, AppError> {
    Ok(RemoveWorkspaceResult {
        removed: state.storage.remove_workspace(&workspace_id)?,
        project_files_deleted: false,
    })
}

#[tauri::command]
pub async fn select_context_files(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<Option<SelectedWorkspaceFiles>, AppError> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select files for A2UI Terminal")
        .add_filter(
            "Supported files",
            &[
                "css", "docx", "html", "js", "json", "jsx", "md", "mjs", "pdf", "py", "toml", "ts",
                "tsx", "txt", "yaml", "yml",
            ],
        )
        .blocking_pick_files();
    let Some(selected) = selected else {
        return Ok(None);
    };
    if selected.is_empty() {
        return Ok(None);
    }
    let workspace = if let Some(workspace_id) = workspace_id {
        workspace::restore_workspace(&state.storage, &workspace_id)?
    } else {
        workspace::register_standalone_workspace(&state.storage)?
    };
    let mut documents = Vec::with_capacity(selected.len());
    for selected_file in selected {
        let path = selected_file
            .into_path()
            .map_err(|_| AppError::InvalidInput("Only local files are supported".into()))?
            .canonicalize()?;
        let document = workspace::attach_selected_file(&state.storage, &workspace.id, &path)?;
        let source_id = document
            .source_id
            .clone()
            .ok_or_else(|| AppError::StateUnavailable)?;
        state
            .selected_files
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .insert(source_id, path);
        documents.push(document);
    }
    Ok(Some(SelectedWorkspaceFiles {
        workspace,
        documents,
    }))
}

#[tauri::command]
pub fn save_context_file(
    state: State<'_, AppState>,
    source_id: String,
    content: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    let selected = state
        .storage
        .workspace_file_by_source(&source_id)?
        .ok_or_else(|| AppError::InvalidInput("Selected file authorization expired".into()))?;
    workspace::save_file_with_history(
        &state.storage,
        &selected.workspace_id,
        &selected.virtual_path,
        &content,
        &base_hash,
    )
}

#[tauri::command]
pub fn list_document_versions(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
) -> Result<Vec<DocumentVersionSummary>, AppError> {
    workspace::list_document_versions(&state.storage, &workspace_id, &relative_path)
}

#[tauri::command]
pub fn read_document_version(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    version_id: String,
) -> Result<DocumentVersion, AppError> {
    workspace::read_document_version(&state.storage, &workspace_id, &relative_path, &version_id)
}

#[tauri::command]
pub fn restore_document_version(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    version_id: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    workspace::restore_document_version(
        &state.storage,
        &workspace_id,
        &relative_path,
        &version_id,
        &base_hash,
    )
}

#[tauri::command]
pub fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigView>, AppError> {
    let active_id = state.storage.active_provider_id()?;
    state
        .storage
        .provider_configs()?
        .into_iter()
        .map(|config| {
            Ok(ProviderConfigView {
                configured: SecretStore::exists(&config.id)?,
                active: config.id == active_id,
                config,
            })
        })
        .collect()
}

#[tauri::command]
pub fn save_provider_config(
    state: State<'_, AppState>,
    config: ProviderConfig,
    secret: Option<String>,
) -> Result<ProviderConfigView, AppError> {
    let secret = secret.map(Zeroizing::new);
    config.validate()?;
    let previous_config = state
        .storage
        .provider_config(&config.id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if previous_config.kind != config.kind {
        return Err(AppError::InvalidInput(
            "不能修改已有 Provider 的适配器类型".into(),
        ));
    }
    let secret = secret.filter(|value| !value.trim().is_empty());
    let previous_secret = if secret.is_some() {
        SecretStore::get_optional(&config.id)?
    } else {
        None
    };
    state.storage.save_provider_config(&config)?;
    if let Some(secret) = secret {
        if let Err(error) = SecretStore::set(&config.id, secret.as_str()) {
            let _ = state.storage.save_provider_config(&previous_config);
            return Err(error);
        }
        if let Err(error) = state.storage.remember_provider_id(&config.id) {
            if let Some(previous_secret) = previous_secret {
                let _ = SecretStore::set(&config.id, previous_secret.as_str());
            } else {
                let _ = SecretStore::delete(&config.id);
            }
            let _ = state.storage.save_provider_config(&previous_config);
            return Err(error);
        }
    }
    Ok(ProviderConfigView {
        configured: SecretStore::exists(&config.id)?,
        active: state.storage.active_provider_id()? == config.id,
        config,
    })
}

#[tauri::command]
pub fn set_active_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    state.storage.set_active_provider(&provider_id)
}

#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderConnectionResult, AppError> {
    let provider_id = validate_provider_id(&provider_id)?;
    let config = state
        .storage
        .provider_config(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput("请先保存 API Key".into()));
    }
    let api_key = SecretStore::get(&provider_id)?;
    let latency_ms = ai::test_connection(&config, &api_key).await?;
    Ok(ProviderConnectionResult {
        provider_id,
        reachable: true,
        latency_ms,
    })
}

#[tauri::command]
pub fn list_chat_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ChatSessionRecord>, AppError> {
    state.storage.sessions(&workspace_id)
}

#[tauri::command]
pub fn create_chat_session(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    title: String,
) -> Result<ChatSessionRecord, AppError> {
    uuid::Uuid::parse_str(&session_id)
        .map_err(|_| AppError::InvalidInput("会话标识必须是有效 UUID".into()))?;
    if state.storage.workspace(&workspace_id)?.is_none() {
        return Err(AppError::InvalidInput("工作区不存在".into()));
    }
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 80 {
        return Err(AppError::InvalidInput(
            "会话标题不能为空且不能超过 80 个字符".into(),
        ));
    }
    state
        .storage
        .create_session(&workspace_id, &session_id, title)
}

#[tauri::command]
pub async fn stream_chat(
    state: State<'_, AppState>,
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<ChatStreamResult, AppError> {
    let validated = ai::validate_chat_request(&request)?;
    let provider_id = validate_provider_id(&request.provider_id)?;
    let config = state
        .storage
        .provider_config(&provider_id)?
        .ok_or_else(|| AppError::InvalidInput("Provider 不存在".into()))?;
    if !SecretStore::exists(&provider_id)? {
        return Err(AppError::InvalidInput(
            "当前 Provider 尚未配置 API Key".into(),
        ));
    }
    let api_key = SecretStore::get(&provider_id)?;
    let history = state
        .storage
        .recent_chat_messages(&request.session_id, request.recent_message_count)?;
    let sources_json =
        serde_json::to_string(&validated.sources).map_err(|_| AppError::StateUnavailable)?;
    state.storage.start_chat_request(
        &request.workspace_id,
        &request.session_id,
        &request.request_id,
        &request.user_message_id,
        &request.assistant_message_id,
        &provider_id,
        request.prompt.trim(),
        &sources_json,
        validated.character_count,
        validated.estimated_tokens,
        validated.has_sensitive_warning,
    )?;

    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .insert(request.request_id.clone(), cancellation.clone());

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
            on_event
                .send(ChatStreamEvent::Delta {
                    request_id: request.request_id.clone(),
                    message_id: request.assistant_message_id.clone(),
                    delta: delta.to_string(),
                })
                .map_err(|_| AppError::StreamReceiverClosed)?;
            if last_persist.elapsed().as_millis() >= 250 {
                state.storage.update_assistant_message(
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

    let cleanup_request_id = request.request_id.clone();
    let final_result = async {
        match stream_result {
        Ok(first_content) => {
            let mut content = first_content;
            let mut patch_result =
                patch::parse_review(&state.storage, &request.workspace_id, &content);
            if patch_result.is_err() && patch::looks_like_patch_candidate(&content) {
                let mut retry_messages = messages.clone();
                retry_messages.push(ProviderMessage {
                    role: "user".into(),
                    content: "Your previous document_patch was invalid or truncated. Regenerate it once as compact JSON only. Use at most 3 changes. Each exact anchor must be at most 500 characters and each change content at most 1500 characters. Do not repeat unchanged file content, and omit all hash fields.".into(),
                });
                match ai::stream_chat(
                    &config,
                    &api_key,
                    &retry_messages,
                    cancellation,
                    |_| Ok(()),
                )
                .await
                {
                    Ok(retried) => {
                        content = retried;
                        patch_result =
                            patch::parse_review(&state.storage, &request.workspace_id, &content);
                    }
                    Err(AppError::RequestCancelled) => {
                        state.storage.update_assistant_message(
                            &request.assistant_message_id,
                            &partial,
                            "stopped",
                            None,
                        )?;
                        let _ = on_event.send(ChatStreamEvent::Stopped {
                            request_id: request.request_id.clone(),
                            message_id: request.assistant_message_id.clone(),
                        });
                        return Ok(ChatStreamResult {
                            request_id: request.request_id,
                            message_id: request.assistant_message_id,
                            content: partial,
                            status: "stopped".into(),
                            error_code: None,
                            error_message: None,
                            retryable: false,
                            retry_after_seconds: None,
                            patch: None,
                            patch_error: None,
                            a2ui: None,
                        });
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
                    &state.storage,
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
            } else {
                None
            };
            state.storage.update_assistant_message(
                &request.assistant_message_id,
                &content,
                "complete",
                error_code.as_deref(),
            )?;
            let _ = on_event.send(ChatStreamEvent::Complete {
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
            state.storage.update_assistant_message(
                &request.assistant_message_id,
                &partial,
                "stopped",
                None,
            )?;
            let _ = on_event.send(ChatStreamEvent::Stopped {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
            });
            Ok(ChatStreamResult {
                request_id: request.request_id,
                message_id: request.assistant_message_id,
                content: partial,
                status: "stopped".into(),
                error_code: None,
                error_message: None,
                retryable: false,
                retry_after_seconds: None,
                patch: None,
                patch_error: None,
                a2ui: None,
            })
        }
        Err(error) => {
            let code = error.code().to_string();
            let message = error.to_string();
            let retryable = error.retryable();
            let retry_after_seconds = error.retry_after_seconds();
            state.storage.update_assistant_message(
                &request.assistant_message_id,
                &partial,
                "error",
                Some(&code),
            )?;
            let _ = on_event.send(ChatStreamEvent::Error {
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
    .await;
    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .remove(&cleanup_request_id);
    final_result
}

#[tauri::command]
pub fn validate_document_patch(
    state: State<'_, AppState>,
    workspace_id: String,
    raw: String,
) -> Result<PatchReview, AppError> {
    patch::parse_review(&state.storage, &workspace_id, &raw)
}

#[tauri::command]
pub fn apply_document_patch(
    state: State<'_, AppState>,
    request: ApplyPatchRequest,
) -> Result<PatchApplication, AppError> {
    patch::apply_patch(
        &state.storage,
        &request.workspace_id,
        request.patch,
        &request.selected_change_ids,
        request.session_id.as_deref(),
        request.assistant_message_id.as_deref(),
    )
}

#[tauri::command]
pub fn undo_document_patch(
    state: State<'_, AppState>,
    workspace_id: String,
    operation_id: String,
) -> Result<PatchApplication, AppError> {
    patch::undo_patch(&state.storage, &workspace_id, &operation_id)
}

#[tauri::command]
pub fn process_a2ui_message(
    state: State<'_, AppState>,
    request: ProcessA2uiRequest,
) -> Result<Option<A2uiProcessResult>, AppError> {
    a2ui::process_message(&state.storage, &request)
}

#[tauri::command]
pub fn list_a2ui_surfaces(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<A2uiSurfaceView>, AppError> {
    a2ui::list_surfaces(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn list_a2ui_inspections(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<A2uiInspectionView>, AppError> {
    a2ui::list_inspections(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn execute_a2ui_action(
    state: State<'_, AppState>,
    request: ExecuteActionRequest,
) -> Result<ActionExecutionResult, AppError> {
    a2ui::execute_action(&state.storage, request)
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

#[tauri::command]
pub fn stop_chat(state: State<'_, AppState>, request_id: String) -> Result<bool, AppError> {
    let requests = state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?;
    if let Some(cancellation) = requests.get(&request_id) {
        cancellation.store(true, Ordering::Release);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::build_diagnostic_report;
    use crate::storage::DiagnosticCounts;

    #[test]
    fn diagnostic_report_declares_every_sensitive_payload_excluded() {
        let report = build_diagnostic_report(
            "1.0.0".into(),
            6,
            DiagnosticCounts {
                workspaces: 1,
                sessions: 2,
                messages: 3,
                workspace_drafts: 4,
                document_versions: 5,
                patch_operations: 6,
                a2ui_surfaces: 7,
                a2ui_messages: 8,
                a2ui_events: 9,
                configured_providers: 1,
            },
        );
        let json = serde_json::to_value(report).unwrap();

        assert_eq!(json["privacy"]["messageBodiesIncluded"], false);
        assert_eq!(json["privacy"]["fileContentsIncluded"], false);
        assert_eq!(json["privacy"]["workspacePathsIncluded"], false);
        assert_eq!(json["privacy"]["providerSecretsIncluded"], false);
    }
}
