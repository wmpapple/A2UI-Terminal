pub mod a2ui;
pub mod ai;
pub mod commands;
pub mod error;
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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let storage = Storage::open(&app_data_dir.join("a2ui-terminal.sqlite3"))?;
            app.manage(AppState::new(storage));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_status,
            commands::set_provider_secret,
            commands::provider_secret_status,
            commands::delete_provider_secret,
            commands::clear_all_local_data,
            commands::select_workspace,
            commands::list_recent_workspaces,
            commands::restore_workspace,
            commands::list_workspace_files,
            commands::read_workspace_file,
            commands::save_workspace_file,
            commands::save_workspace_draft,
            commands::discard_workspace_draft,
            commands::remove_workspace,
            commands::select_context_files,
            commands::save_context_file,
            commands::list_provider_configs,
            commands::save_provider_config,
            commands::set_active_provider,
            commands::test_provider_connection,
            commands::list_chat_sessions,
            commands::create_chat_session,
            commands::stream_chat,
            commands::stop_chat,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start A2UI Terminal");
}
