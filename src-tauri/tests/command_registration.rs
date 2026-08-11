use serde_json::Value;
use std::{fs, path::PathBuf};

const NATIVE_COMMANDS: [&str; 8] = [
    "validate_document_patch",
    "apply_document_patch",
    "undo_document_patch",
    "process_a2ui_message",
    "list_a2ui_surfaces",
    "list_a2ui_inspections",
    "execute_a2ui_action",
    "export_diagnostics",
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
}
