fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "get_bootstrap_status",
        "set_provider_secret",
        "provider_secret_status",
        "delete_provider_secret",
        "clear_all_local_data",
        "select_workspace",
        "list_recent_workspaces",
        "restore_workspace",
        "list_workspace_files",
        "read_workspace_file",
        "save_workspace_file",
        "save_workspace_draft",
        "discard_workspace_draft",
        "remove_workspace",
        "select_context_files",
        "save_context_file",
        "list_provider_configs",
        "save_provider_config",
        "set_active_provider",
        "test_provider_connection",
        "list_chat_sessions",
        "create_chat_session",
        "stream_chat",
        "stop_chat",
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to build Tauri application manifest");
}
