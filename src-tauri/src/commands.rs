use crate::error::AppError;
use crate::security::{validate_provider_id, SecretStore};
use crate::state::AppState;
use crate::workspace::{
    self, SaveOutcome, WorkspaceDocument, WorkspaceFileEntry, WorkspaceSummary,
};
use serde::Serialize;
use std::collections::BTreeSet;
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
pub struct RemoveWorkspaceResult {
    removed: bool,
    project_files_deleted: bool,
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
) -> Result<Vec<WorkspaceDocument>, AppError> {
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
        return Ok(Vec::new());
    };
    let mut documents = Vec::with_capacity(selected.len());
    for selected_file in selected {
        let path = selected_file
            .into_path()
            .map_err(|_| AppError::InvalidInput("Only local files are supported".into()))?
            .canonicalize()?;
        let source_id = uuid::Uuid::new_v4().to_string();
        let document = workspace::read_selected_file(&path, &source_id)?;
        state
            .selected_files
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .insert(source_id, path);
        documents.push(document);
    }
    Ok(documents)
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
        .cloned()
        .ok_or_else(|| AppError::InvalidInput("Selected file authorization expired".into()))?;
    workspace::save_selected_file(&path, &content, &base_hash)
}
