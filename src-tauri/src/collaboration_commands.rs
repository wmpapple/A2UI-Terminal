//! Offline collaboration. File paths are supplied only by native pickers.
use crate::{
    application::collaboration as service,
    domain::{collaboration::*, review::ReviewRequest},
    error::AppError,
    state::AppState,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn collaboration_overview(
    state: State<'_, AppState>,
    result_id: Option<String>,
) -> Result<CollaborationOverview, AppError> {
    service::overview(&state.storage, result_id.as_deref())
}
#[tauri::command]
pub fn collaboration_rename(
    state: State<'_, AppState>,
    name: String,
) -> Result<LocalIdentity, AppError> {
    service::rename(&state.storage, &name)
}
#[tauri::command]
pub fn collaboration_share(
    state: State<'_, AppState>,
    input: CreateShareInput,
) -> Result<SharePackage, AppError> {
    service::create_share(&state.storage, &state.managed_results_dir, input)
}
#[tauri::command]
pub fn collaboration_revoke(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    service::revoke(&state.storage, &id)
}
#[tauri::command]
pub fn collaboration_inbox(
    state: State<'_, AppState>,
    id: String,
) -> Result<InboxDetail, AppError> {
    service::inbox(&state.storage, &id)
}
#[tauri::command]
pub fn collaboration_feedback(
    state: State<'_, AppState>,
    input: SaveFeedbackInput,
) -> Result<FeedbackPackage, AppError> {
    service::save_feedback(&state.storage, input)
}
#[tauri::command]
pub fn collaboration_propose(
    state: State<'_, AppState>,
    id: String,
) -> Result<ReviewRequest, AppError> {
    service::propose(&state.storage, &state.managed_results_dir, &id)
}

#[tauri::command]
pub async fn collaboration_import(app: AppHandle) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导入分享包或意见包")
            .add_filter("A2UI 协作包", &["a2uishare"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| AppError::InvalidInput("文件路径无效".into()))?;
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take((service::MAX_PACKAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        let state = app.state::<AppState>();
        service::import_bytes(&state.storage, &bytes).map(Some)
    })
    .await
    .map_err(|_| AppError::StateUnavailable)?
}

#[tauri::command]
pub async fn collaboration_export(
    app: AppHandle,
    id: String,
    feedback: bool,
) -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        service::export_package(&state.storage, &id, feedback)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导出协作包（明文文件）")
            .set_file_name(if feedback {
                "意见.a2uishare"
            } else {
                "分享.a2uishare"
            })
            .add_filter("A2UI 协作包", &["a2uishare"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let mut path = file
            .into_path()
            .map_err(|_| AppError::InvalidInput("文件路径无效".into()))?;
        let appended = path.extension().is_none();
        if appended {
            path.set_extension("a2uishare");
        }
        if !path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("a2uishare"))
        {
            return Err(AppError::InvalidInput("请选择 .a2uishare 文件名".into()));
        }
        if appended
            && path.try_exists()?
            && !app
                .dialog()
                .message("补全扩展名后的文件已存在，是否替换？")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                    "替换".into(),
                    "取消".into(),
                ))
                .blocking_show()
        {
            return Ok(false);
        }
        let cancel = crate::application::export::ExportCancellation::default();
        let target =
            crate::application::export_target::ExportTarget::selected(&path, true, &cancel)?;
        let bytes = service::export_package(&state.storage, &id, feedback)?;
        target.write(&bytes, &cancel)?;
        Ok(true)
    })
    .await
    .map_err(|_| AppError::StateUnavailable)?
}
