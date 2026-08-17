const V1_COMMANDS: [&str; 36] = [
    "get_bootstrap_status",
    "set_provider_secret",
    "provider_secret_status",
    "delete_provider_secret",
    "clear_all_local_data",
    "export_diagnostics",
    "select_workspace",
    "list_recent_workspaces",
    "restore_workspace",
    "list_workspace_files",
    "read_workspace_file",
    "list_recovery_drafts",
    "save_workspace_file",
    "save_workspace_draft",
    "discard_workspace_draft",
    "remove_workspace",
    "select_context_files",
    "save_context_file",
    "list_document_versions",
    "read_document_version",
    "restore_document_version",
    "list_provider_configs",
    "save_provider_config",
    "set_active_provider",
    "test_provider_connection",
    "list_chat_sessions",
    "create_chat_session",
    "stream_chat",
    "stop_chat",
    "validate_document_patch",
    "apply_document_patch",
    "undo_document_patch",
    "process_a2ui_message",
    "list_a2ui_surfaces",
    "list_a2ui_inspections",
    "execute_a2ui_action",
];

#[test]
fn all_36_v1_commands_remain_registered() {
    let runtime = include_str!("../src/lib.rs");
    let commands = include_str!("../src/commands.rs");

    assert!(runtime.matches("commands::").count() >= V1_COMMANDS.len());
    assert!(commands.matches("#[tauri::command]").count() >= V1_COMMANDS.len());
    for command in V1_COMMANDS {
        assert!(runtime.contains(&format!("commands::{command},")));
        assert!(commands.contains(&format!("fn {command}(")));
    }
}

#[test]
fn tauri_commands_delegate_domain_work_to_application_services() {
    let commands = include_str!("../src/commands.rs");

    for forbidden in [
        "    ai::",
        "    a2ui::",
        "    patch::",
        "    workspace::",
        ".provider_config(",
        ".provider_configs(",
        ".active_provider_id(",
        ".set_active_provider(",
        ".sessions(",
        ".create_session(",
        ".recent_chat_messages(",
        ".start_chat_request(",
        ".update_assistant_message(",
        ".workspace_file_by_source(",
        ".remove_workspace(",
    ] {
        assert!(
            !commands.contains(forbidden),
            "commands.rs bypassed the S0.4 application boundary with {forbidden}"
        );
    }
}

#[test]
fn application_services_do_not_depend_on_tauri() {
    for source in [
        include_str!("../src/application/adapters.rs"),
        include_str!("../src/application/chat.rs"),
        include_str!("../src/application/import.rs"),
        include_str!("../src/application/provider.rs"),
        include_str!("../src/application/result.rs"),
        include_str!("../src/application/task.rs"),
        include_str!("../src/application/revision.rs"),
        include_str!("../src/application/workspace.rs"),
    ] {
        assert!(!source.contains("tauri::"));
        assert!(!source.contains("State<'_"));
        assert!(!source.contains("Channel<"));
    }
}

#[test]
fn task_orchestrator_does_not_bypass_the_unresolved_model_boundary() {
    let task = include_str!("../src/application/task.rs");

    assert!(!task.contains("crate::ai"));
    assert!(!task.contains("Provider"));
    assert!(!task.contains("stream_chat"));
    assert!(task.contains("local_scaffold"));
}

#[test]
fn safety_kernels_remain_outside_the_command_adapter() {
    let adapters = include_str!("../src/application/adapters.rs");
    let chat = include_str!("../src/application/chat.rs");

    assert!(adapters.contains("patch::parse_review"));
    assert!(adapters.contains("patch::apply_patch"));
    assert!(adapters.contains("a2ui::process_message"));
    assert!(chat.contains("patch::parse_review"));
    assert!(chat.contains("a2ui::process_message"));
}

#[test]
fn native_drop_paths_stay_inside_rust_and_emit_only_the_sanitized_outcome() {
    let runtime = include_str!("../src/lib.rs");
    let domain = include_str!("../src/domain/import.rs");

    assert!(runtime.contains(".on_webview_event("));
    assert!(runtime.contains("DragDropEvent::Drop"));
    assert!(runtime.contains("application::import::inspect_paths("));
    assert!(runtime.contains("ImportDropOutcome::success"));
    assert!(runtime.contains("webview.emit(\"import-drop-outcome\", outcome)"));
    assert!(!domain.contains("pub path:"));
    assert!(!domain.contains("pub paths:"));
}
