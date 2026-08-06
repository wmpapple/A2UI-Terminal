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
        ])
        .run(tauri::generate_context!())
        .expect("failed to start A2UI Terminal");
}
