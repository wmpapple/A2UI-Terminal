use crate::a2ui::{
    A2uiInspectionView, A2uiProcessResult, A2uiSurfaceView, ActionExecutionResult,
    ExecuteActionRequest, ProcessA2uiRequest,
};
use crate::ai::{ChatRequest, ProviderConfig, ProviderConfigView};
pub use crate::application::chat::{ChatStreamEvent, ChatStreamResult};
pub use crate::application::provider::{ProviderConnectionResult, SecretStatus};
use crate::application::{adapters, chat, provider, revision, workspace as workspace_service};
use crate::domain::result::{ResultDetail, ResultSummary};
use crate::domain::task::{
    AnswerTaskInput, CreateTaskInput, TaskDetail, TaskRunResult, TaskTemplate,
};
use crate::error::AppError;
use crate::patch::{DocumentPatch, PatchApplication, PatchReview};
use crate::security::SecretStore;
use crate::state::AppState;
use crate::storage::{ChatSessionRecord, DiagnosticCounts};
use crate::workspace::{
    DocumentVersion, DocumentVersionSummary, RecoveryDraftSummary, SaveOutcome, WorkspaceDocument,
    WorkspaceFileEntry, WorkspaceSummary,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchRequest {
    workspace_id: String,
    patch: DocumentPatch,
    selected_change_ids: Vec<String>,
    session_id: Option<String>,
    assistant_message_id: Option<String>,
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
    provider::set_secret(&state.storage, &provider_id, secret)
}

#[tauri::command]
pub fn provider_secret_status(provider_id: String) -> Result<SecretStatus, AppError> {
    provider::secret_status(&provider_id)
}

#[tauri::command]
pub fn delete_provider_secret(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<SecretStatus, AppError> {
    provider::delete_secret(&state.storage, &provider_id)
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
    Ok(Some(workspace_service::register(
        &state.storage,
        &selected_path,
    )?))
}

#[tauri::command]
pub fn list_recent_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceSummary>, AppError> {
    workspace_service::list_recent(&state.storage)
}

#[tauri::command]
pub fn restore_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceSummary, AppError> {
    workspace_service::restore(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn list_workspace_files(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceFileEntry>, AppError> {
    workspace_service::list_files(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn read_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
) -> Result<WorkspaceDocument, AppError> {
    let document = workspace_service::read_file(&state.storage, &workspace_id, &relative_path)?;
    crate::application::result::ensure_file_result(&state.storage, &workspace_id, &document)?;
    Ok(document)
}

#[tauri::command]
pub fn list_recovery_drafts(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<RecoveryDraftSummary>, AppError> {
    workspace_service::list_recovery_drafts(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn save_workspace_file(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    content: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    workspace_service::save_file(
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
    workspace_service::save_draft(
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
    workspace_service::discard_draft(&state.storage, &workspace_id, &relative_path)
}

#[tauri::command]
pub fn remove_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<RemoveWorkspaceResult, AppError> {
    Ok(RemoveWorkspaceResult {
        removed: workspace_service::remove(&state.storage, &workspace_id)?,
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
    let workspace =
        workspace_service::resolve_context_workspace(&state.storage, workspace_id.as_deref())?;
    let mut documents = Vec::with_capacity(selected.len());
    for selected_file in selected {
        let path = selected_file
            .into_path()
            .map_err(|_| AppError::InvalidInput("Only local files are supported".into()))?
            .canonicalize()?;
        let document = workspace_service::attach_file(&state.storage, &workspace.id, &path)?;
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
    workspace_service::save_authorized_file(&state.storage, &source_id, &content, &base_hash)
}

#[tauri::command]
pub fn list_document_versions(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
) -> Result<Vec<DocumentVersionSummary>, AppError> {
    revision::list(&state.storage, &workspace_id, &relative_path)
}

#[tauri::command]
pub fn read_document_version(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    version_id: String,
) -> Result<DocumentVersion, AppError> {
    revision::read(&state.storage, &workspace_id, &relative_path, &version_id)
}

#[tauri::command]
pub fn restore_document_version(
    state: State<'_, AppState>,
    workspace_id: String,
    relative_path: String,
    version_id: String,
    base_hash: String,
) -> Result<SaveOutcome, AppError> {
    revision::restore(
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
    provider::list_configs(&state.storage)
}

#[tauri::command]
pub fn save_provider_config(
    state: State<'_, AppState>,
    config: ProviderConfig,
    secret: Option<String>,
) -> Result<ProviderConfigView, AppError> {
    provider::save_config(&state.storage, config, secret)
}

#[tauri::command]
pub fn set_active_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<(), AppError> {
    provider::set_active(&state.storage, &provider_id)
}

#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderConnectionResult, AppError> {
    provider::test_connection(&state.storage, &provider_id).await
}

#[tauri::command]
pub fn list_chat_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ChatSessionRecord>, AppError> {
    chat::list_sessions(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn create_chat_session(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    title: String,
) -> Result<ChatSessionRecord, AppError> {
    chat::create_session(&state.storage, &workspace_id, &session_id, &title)
}

#[tauri::command]
pub async fn stream_chat(
    state: State<'_, AppState>,
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<ChatStreamResult, AppError> {
    let request_id = request.request_id.clone();
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .insert(request_id.clone(), cancellation.clone());

    let result = chat::stream(&state.storage, request, cancellation, |event| {
        on_event
            .send(event)
            .map_err(|_| AppError::StreamReceiverClosed)
    })
    .await;
    state
        .active_requests
        .lock()
        .map_err(|_| AppError::StateUnavailable)?
        .remove(&request_id);
    result
}

#[tauri::command]
pub fn validate_document_patch(
    state: State<'_, AppState>,
    workspace_id: String,
    raw: String,
) -> Result<PatchReview, AppError> {
    adapters::validate_patch(&state.storage, &workspace_id, &raw)
}

#[tauri::command]
pub fn apply_document_patch(
    state: State<'_, AppState>,
    request: ApplyPatchRequest,
) -> Result<PatchApplication, AppError> {
    adapters::apply_patch(
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
    adapters::undo_patch(&state.storage, &workspace_id, &operation_id)
}

#[tauri::command]
pub fn process_a2ui_message(
    state: State<'_, AppState>,
    request: ProcessA2uiRequest,
) -> Result<Option<A2uiProcessResult>, AppError> {
    let processed = adapters::process_a2ui(&state.storage, &request)?;
    if let Some(surface) = processed
        .as_ref()
        .and_then(|processed| processed.surface.as_ref())
    {
        crate::application::result::ensure_surface_by_id(
            &state.storage,
            &surface.workspace_id,
            &surface.surface_id,
        )?;
    }
    Ok(processed)
}

#[tauri::command]
pub fn list_a2ui_surfaces(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<A2uiSurfaceView>, AppError> {
    let surfaces = adapters::list_surfaces(&state.storage, &workspace_id)?;
    for surface in &surfaces {
        crate::application::result::ensure_surface_by_id(
            &state.storage,
            &surface.workspace_id,
            &surface.surface_id,
        )?;
    }
    Ok(surfaces)
}

#[tauri::command]
pub fn list_a2ui_inspections(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<A2uiInspectionView>, AppError> {
    adapters::list_inspections(&state.storage, &workspace_id)
}

#[tauri::command]
pub fn delete_a2ui_surface(
    state: State<'_, AppState>,
    workspace_id: String,
    surface_id: String,
) -> Result<bool, AppError> {
    adapters::delete_surface(&state.storage, &workspace_id, &surface_id)
}

#[tauri::command]
pub fn execute_a2ui_action(
    state: State<'_, AppState>,
    request: ExecuteActionRequest,
) -> Result<ActionExecutionResult, AppError> {
    adapters::execute_action(&state.storage, request)
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

#[tauri::command]
pub fn list_results(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<ResultSummary>, AppError> {
    crate::application::result::list(
        &state.storage,
        workspace_id.as_deref(),
        include_archived.unwrap_or(false),
    )
}

#[tauri::command]
pub fn get_result(state: State<'_, AppState>, result_id: String) -> Result<ResultDetail, AppError> {
    crate::application::result::get(&state.storage, &result_id)
}

#[tauri::command]
pub fn create_text_result(
    state: State<'_, AppState>,
    input: crate::domain::result::CreateTextResultInput,
) -> Result<crate::domain::result::ResultDocument, AppError> {
    crate::application::result::create_text(&state.storage, &state.managed_results_dir, input)
}

#[tauri::command]
pub fn read_result_document(
    state: State<'_, AppState>,
    result_id: String,
) -> Result<crate::domain::result::ResultDocument, AppError> {
    crate::application::result::read_document(
        &state.storage,
        &state.managed_results_dir,
        &result_id,
    )
}

#[tauri::command]
pub fn save_result_document(
    state: State<'_, AppState>,
    input: crate::domain::result::SaveResultDocumentInput,
) -> Result<crate::domain::result::ResultDocument, AppError> {
    crate::application::result::save_document(&state.storage, &state.managed_results_dir, input)
}

#[tauri::command]
pub fn list_result_revisions(
    state: State<'_, AppState>,
    result_id: String,
) -> Result<Vec<crate::domain::result::ResultRevisionSummary>, AppError> {
    crate::application::result::list_revisions(
        &state.storage,
        &state.managed_results_dir,
        &result_id,
    )
}

#[tauri::command]
pub fn read_result_revision(
    state: State<'_, AppState>,
    result_id: String,
    revision_id: String,
) -> Result<crate::domain::result::ResultRevision, AppError> {
    crate::application::result::read_revision(
        &state.storage,
        &state.managed_results_dir,
        &result_id,
        &revision_id,
    )
}

#[tauri::command]
pub fn restore_result_revision(
    state: State<'_, AppState>,
    input: crate::domain::result::RestoreResultRevisionInput,
) -> Result<crate::domain::result::ResultDocument, AppError> {
    crate::application::result::restore_revision(&state.storage, &state.managed_results_dir, input)
}

#[tauri::command]
pub fn duplicate_result(
    state: State<'_, AppState>,
    result_id: String,
) -> Result<crate::domain::result::ResultDocument, AppError> {
    crate::application::result::duplicate(&state.storage, &state.managed_results_dir, &result_id)
}

#[tauri::command]
pub fn list_task_templates(state: State<'_, AppState>) -> Result<Vec<TaskTemplate>, AppError> {
    crate::application::task::list_templates(&state.storage)
}

#[tauri::command]
pub fn create_task(
    state: State<'_, AppState>,
    input: CreateTaskInput,
) -> Result<TaskDetail, AppError> {
    crate::application::task::create(&state.storage, input)
}

#[tauri::command]
pub fn answer_task_questions(
    state: State<'_, AppState>,
    input: AnswerTaskInput,
) -> Result<TaskDetail, AppError> {
    crate::application::task::answer(&state.storage, input)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, task_id: String) -> Result<TaskDetail, AppError> {
    crate::application::task::get(&state.storage, &task_id)
}

#[tauri::command]
pub fn start_task(state: State<'_, AppState>, task_id: String) -> Result<TaskRunResult, AppError> {
    crate::application::task::start(&state.storage, &state.managed_results_dir, &task_id)
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
                tasks: 4,
                results: 10,
            },
        );
        let json = serde_json::to_value(report).unwrap();

        assert_eq!(json["privacy"]["messageBodiesIncluded"], false);
        assert_eq!(json["privacy"]["fileContentsIncluded"], false);
        assert_eq!(json["privacy"]["workspacePathsIncluded"], false);
        assert_eq!(json["privacy"]["providerSecretsIncluded"], false);
    }
}
