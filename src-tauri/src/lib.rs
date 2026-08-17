pub mod a2ui;
pub mod ai;
pub mod application;
pub mod commands;
pub mod domain;
pub mod error;
pub mod patch;
pub mod repository;
pub mod security;
pub mod state;
pub mod storage;
pub mod workspace;

use state::AppState;
use storage::Storage;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let managed_results_dir =
                application::result::prepare_managed_results_dir(&app_data_dir)?;
            let storage = Storage::open(&app_data_dir.join("a2ui-terminal.sqlite3"))?;
            storage.cleanup_expired_versions()?;
            app.manage(AppState::new(storage, managed_results_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_status,
            commands::set_provider_secret,
            commands::provider_secret_status,
            commands::delete_provider_secret,
            commands::clear_all_local_data,
            commands::export_diagnostics,
            commands::select_workspace,
            commands::list_recent_workspaces,
            commands::restore_workspace,
            commands::list_workspace_files,
            commands::read_workspace_file,
            commands::list_recovery_drafts,
            commands::save_workspace_file,
            commands::save_workspace_draft,
            commands::discard_workspace_draft,
            commands::remove_workspace,
            commands::select_context_files,
            commands::save_context_file,
            commands::list_document_versions,
            commands::read_document_version,
            commands::restore_document_version,
            commands::list_provider_configs,
            commands::save_provider_config,
            commands::set_active_provider,
            commands::test_provider_connection,
            commands::list_chat_sessions,
            commands::create_chat_session,
            commands::stream_chat,
            commands::stop_chat,
            commands::validate_document_patch,
            commands::apply_document_patch,
            commands::undo_document_patch,
            commands::process_a2ui_message,
            commands::list_a2ui_surfaces,
            commands::list_a2ui_inspections,
            commands::delete_a2ui_surface,
            commands::execute_a2ui_action,
            commands::list_results,
            commands::get_result,
            commands::create_text_result,
            commands::read_result_document,
            commands::save_result_document,
            commands::list_result_revisions,
            commands::read_result_revision,
            commands::restore_result_revision,
            commands::duplicate_result,
            commands::list_task_templates,
            commands::create_task,
            commands::answer_task_questions,
            commands::get_task,
            commands::start_task,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start A2UI Terminal");
}
