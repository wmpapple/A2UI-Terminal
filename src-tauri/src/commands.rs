use crate::ai::{self, ChatRequest, ProviderConfig, ProviderConfigView, ProviderMessage};
use crate::error::AppError;
use crate::security::{validate_provider_id, SecretStore};
use crate::state::AppState;
use crate::storage::ChatSessionRecord;
use crate::workspace::{
    self, SaveOutcome, WorkspaceDocument, WorkspaceFileEntry, WorkspaceSummary,
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

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
    let provider_id = validate_provider_id(&provider_id)?;
    SecretStore::set(&provider_id, &secret)?;
    if let Err(error) = state.storage.remember_provider_id(&provider_id) {
        let _ = SecretStore::delete(&provider_id);
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
pub fn save_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    content: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    workspace::save_file(
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
    let path = state
        .selected_files
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .get(&source_id)
        .cloned();
    let path = match path {
        Some(path) => path,
        None => state
            .storage
            .workspace_file_by_source(&source_id)?
            .map(|row| std::path::PathBuf::from(row.absolute_path))
            .ok_or_else(|| AppError::InvalidInput("Selected file authorization expired".into()))?,
    };
    workspace::save_selected_file(&path, &content, &base_hash)
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
) -> Result<ProviderConfigView, AppError> {
    config.validate()?;
    state.storage.save_provider_config(&config)?;
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
        content: "You are A2UI Terminal's coding assistant. Never claim a file was changed. Return guidance or a semantic patch proposal for user review.".into(),
    }];
    messages.extend(history);
    messages.push(ProviderMessage {
        role: "user".into(),
        content: ai::build_context_prompt(&request.prompt, &request.context_sources),
    });

    let mut partial = String::new();
    let mut last_persist = Instant::now();
    let stream_result = ai::stream_chat(&config, &api_key, &messages, cancellation, |delta| {
        partial.push_str(delta);
        on_event
            .send(ChatStreamEvent::Delta {
                request_id: request.request_id.clone(),
                message_id: request.assistant_message_id.clone(),
                delta: delta.to_string(),
            })
            .map_err(|_| AppError::Provider("前端流通道已关闭".into()))?;
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
    })
    .await;

    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .remove(&request.request_id);

    match stream_result {
        Ok(content) => {
            state.storage.update_assistant_message(
                &request.assistant_message_id,
                &content,
                "complete",
                None,
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
                error_code: None,
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
            })
        }
        Err(error) => {
            let code = error.code().to_string();
            let message = error.to_string();
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
                message,
            });
            Ok(ChatStreamResult {
                request_id: request.request_id,
                message_id: request.assistant_message_id,
                content: partial,
                status: "error".into(),
                error_code: Some(code),
            })
        }
    }
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
