pub mod a2ui;
pub mod ai;
pub mod application;
pub mod commands;
pub mod document_source;
pub mod domain;
pub mod error;
pub mod patch;
pub mod repository;
pub mod security;
pub mod state;
pub mod storage;
pub mod workspace;

use state::AppState;
use std::sync::atomic::Ordering;
use storage::Storage;
use tauri::{Emitter, Manager};

struct NativeImportDropGuard<'a>(&'a std::sync::atomic::AtomicBool);

impl Drop for NativeImportDropGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

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
        .on_window_event(|window, event| {
            let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) =
                event
            else {
                return;
            };
            let Some(state) = window.try_state::<AppState>() else {
                return;
            };
            let scale_factor = window.scale_factor().unwrap_or(1.0);
            let logical_position = position.to_logical::<f64>(scale_factor);
            let target = {
                let Ok(targets) = state.import_drop_targets.lock() else {
                    return;
                };
                application::import::find_drop_target(
                    &targets,
                    logical_position.x,
                    logical_position.y,
                )
            };
            let Some(target) = target else {
                return;
            };
            let target_id = target.target_id.clone();
            if state
                .native_import_drop_active
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                let outcome = domain::import::ImportDropOutcome::failure(
                    target_id,
                    &error::AppError::InvalidInput("正在检查上一批拖入文件，请稍候".into()),
                );
                let _ = window.emit("import-drop-outcome", outcome);
                return;
            }
            let window = window.clone();
            let paths = paths.clone();
            let import_drop_epoch = state.import_drop_epoch.load(Ordering::Acquire);
            std::thread::spawn(move || {
                let Some(state) = window.try_state::<AppState>() else {
                    return;
                };
                let _active_guard = NativeImportDropGuard(&state.native_import_drop_active);
                let outcome =
                    match application::import::inspect_paths(paths, target.workspace_id.clone()) {
                        Ok(pending) => {
                            let batch = pending.batch.clone();
                            match state.pending_imports.lock() {
                                Ok(mut pending_imports) => {
                                    if state.import_drop_epoch.load(Ordering::Acquire)
                                        != import_drop_epoch
                                    {
                                        domain::import::ImportDropOutcome::failure(
                                            target_id,
                                            &error::AppError::InvalidInput(
                                                "本地数据已清除，本次拖入已取消".into(),
                                            ),
                                        )
                                    } else {
                                        pending_imports.clear();
                                        pending_imports.insert(batch.id.clone(), pending);
                                        domain::import::ImportDropOutcome::success(target_id, batch)
                                    }
                                }
                                Err(_) => domain::import::ImportDropOutcome::failure(
                                    target_id,
                                    &error::AppError::StateUnavailable,
                                ),
                            }
                        }
                        Err(error) => domain::import::ImportDropOutcome::failure(target_id, &error),
                    };
                let _ = window.emit("import-drop-outcome", outcome);
            });
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
            commands::select_import_sources,
            commands::inspect_import_batch,
            commands::set_import_drop_target,
            commands::confirm_import,
            commands::list_document_sources,
            commands::read_document_source,
            commands::revoke_document_source,
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
            commands::plan_context,
            commands::clear_context_index,
            commands::confirm_context_manifest,
            commands::stream_chat,
            commands::stop_chat,
            commands::validate_document_patch,
            commands::apply_document_patch,
            commands::undo_document_patch,
            commands::create_review_request,
            commands::get_review,
            commands::list_active_reviews,
            commands::decide_review_blocks,
            commands::apply_review,
            commands::discard_review,
            commands::resolve_review_conflict,
            commands::undo_review,
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
