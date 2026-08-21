use serde_json::Value;
use std::{fs, path::PathBuf};

const NATIVE_COMMANDS: [&str; 13] = [
    "validate_document_patch",
    "apply_document_patch",
    "undo_document_patch",
    "process_a2ui_message",
    "list_a2ui_surfaces",
    "list_a2ui_inspections",
    "delete_a2ui_surface",
    "execute_a2ui_action",
    "export_diagnostics",
    "list_document_versions",
    "read_document_version",
    "restore_document_version",
    "list_recovery_drafts",
];

const RESULT_COMMANDS: [&str; 9] = [
    "list_results",
    "get_result",
    "create_text_result",
    "read_result_document",
    "save_result_document",
    "list_result_revisions",
    "read_result_revision",
    "restore_result_revision",
    "duplicate_result",
];
const TASK_COMMANDS: [&str; 5] = [
    "list_task_templates",
    "create_task",
    "answer_task_questions",
    "get_task",
    "start_task",
];
const IMPORT_COMMANDS: [&str; 7] = [
    "select_import_sources",
    "inspect_import_batch",
    "set_import_drop_target",
    "confirm_import",
    "list_document_sources",
    "read_document_source",
    "revoke_document_source",
];
const CONTEXT_COMMANDS: [&str; 3] = [
    "plan_context",
    "clear_context_index",
    "confirm_context_manifest",
];

#[test]
fn native_commands_are_registered_and_allowed_for_the_main_window() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let build_script = fs::read_to_string(root.join("build.rs")).expect("read build.rs");
    let runtime = fs::read_to_string(root.join("src/lib.rs")).expect("read src/lib.rs");
    let capability: Value = serde_json::from_str(
        &fs::read_to_string(root.join("capabilities/main.json")).expect("read capability"),
    )
    .expect("parse capability");
    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions array");

    for permission in ["core:event:allow-listen", "core:event:allow-unlisten"] {
        assert!(
            permissions.iter().any(|value| value == permission),
            "{permission} is required for the sanitized native-drop event bridge"
        );
    }
    assert!(
        permissions
            .iter()
            .all(|value| value != "core:event:allow-emit" && value != "core:event:allow-emit-to"),
        "the frontend must not gain event emission permission for native file paths"
    );

    for command in NATIVE_COMMANDS {
        assert!(
            build_script.contains(&format!("\"{command}\"")),
            "{command} is missing from the Tauri app manifest"
        );
        assert!(
            runtime.contains(&format!("commands::{command},")),
            "{command} is missing from the invoke handler"
        );
        assert!(
            permissions
                .iter()
                .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))),
            "{command} is missing from the main-window capability"
        );
    }

    for command in RESULT_COMMANDS {
        assert!(build_script.contains(&format!("\"{command}\"")));
        assert!(runtime.contains(&format!("commands::{command},")));
        assert!(permissions
            .iter()
            .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))));
    }

    for command in TASK_COMMANDS {
        assert!(build_script.contains(&format!("\"{command}\"")));
        assert!(runtime.contains(&format!("commands::{command},")));
        assert!(permissions
            .iter()
            .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))));
    }

    for command in IMPORT_COMMANDS {
        assert!(build_script.contains(&format!("\"{command}\"")));
        assert!(runtime.contains(&format!("commands::{command},")));
        assert!(permissions
            .iter()
            .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))));
    }

    for command in CONTEXT_COMMANDS {
        assert!(build_script.contains(&format!("\"{command}\"")));
        assert!(runtime.contains(&format!("commands::{command},")));
        assert!(permissions
            .iter()
            .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))));
    }
}
