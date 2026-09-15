use a2ui_terminal_lib::a2ui::{get_capabilities, process_message, ProcessA2uiRequest, CATALOG_ID};
use a2ui_terminal_lib::storage::Storage;
use serde_json::{json, Value};
use uuid::Uuid;

const RUNTIME_CASES: &str = include_str!("../../contracts/a2ui/v0_9_1/runtime-cases.json");
const UPSTREAM_SIMPLE_TEXT: &str =
    include_str!("../../contracts/a2ui/v0_9_1/upstream/00_simple-text.json");

fn setup() -> (tempfile::TempDir, Storage, String, String) {
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(&directory.path().join("conformance.sqlite3")).unwrap();
    let workspace_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    storage
        .upsert_workspace(&workspace_id, "A2UI conformance", "C:\\a2ui-conformance")
        .unwrap();
    storage
        .create_session(&workspace_id, &session_id, "Conformance")
        .unwrap();
    (directory, storage, workspace_id, session_id)
}

fn process(
    storage: &Storage,
    workspace_id: &str,
    session_id: &str,
    value: &Value,
) -> a2ui_terminal_lib::a2ui::A2uiProcessResult {
    process_message(
        storage,
        &ProcessA2uiRequest {
            workspace_id: workspace_id.into(),
            session_id: session_id.into(),
            message_id: Uuid::new_v4().to_string(),
            raw_message: value.to_string(),
        },
    )
    .unwrap()
    .expect("fixture must be recognized as A2UI")
}

#[test]
fn capabilities_negotiate_the_pinned_protocol_and_only_the_local_catalog() {
    let capabilities = get_capabilities();
    assert_eq!(capabilities.preferred_version, "v0.9.1");
    assert_eq!(
        capabilities
            .renderer_capabilities
            .v0_9
            .supported_catalog_ids,
        [CATALOG_ID]
    );
    assert!(!capabilities.catalog.accepts_inline_catalogs);
    assert_eq!(capabilities.catalog.components.len(), 19);
    for component in ["Checklist", "Owner", "Date", "Status", "Table", "IssueCard"] {
        assert!(capabilities.catalog.components.contains(&component.into()));
    }
}

#[test]
fn official_profile_accepts_initial_and_incremental_batches_atomically() {
    let fixtures: Value = serde_json::from_str(RUNTIME_CASES).unwrap();
    let (_directory, storage, workspace_id, session_id) = setup();
    let initial = process(
        &storage,
        &workspace_id,
        &session_id,
        &fixtures["validInitial"],
    );
    let surface = initial.surface.unwrap();
    assert_eq!(surface.protocol_version, "v0.9.1");
    assert_eq!(surface.catalog_id.as_deref(), Some(CATALOG_ID));
    assert_eq!(surface.revision, 1);
    assert_eq!(surface.data["status"], "ready");

    let incremental = process(
        &storage,
        &workspace_id,
        &session_id,
        &fixtures["validIncremental"],
    );
    let surface = incremental.surface.unwrap();
    assert_eq!(surface.revision, 2);
    assert_eq!(surface.root.children[0].props["text"], "Incremental update");
    assert_eq!(surface.data["status"], "updated");
}

#[test]
fn compatible_v09_profile_is_negotiated_and_rendered_with_the_local_catalog() {
    let fixtures: Value = serde_json::from_str(RUNTIME_CASES).unwrap();
    let (_directory, storage, workspace_id, session_id) = setup();
    let result = process(
        &storage,
        &workspace_id,
        &session_id,
        &fixtures["validCompatibleV09"],
    );
    let surface = result.surface.unwrap();
    assert_eq!(surface.protocol_version, "v0.9");
    assert_eq!(surface.catalog_id.as_deref(), Some(CATALOG_ID));
    let negotiation = result.inspection.validation.negotiation.unwrap();
    assert_eq!(negotiation.received_version.as_deref(), Some("v0.9"));
    assert_eq!(negotiation.selected_version.as_deref(), Some("v0.9"));
    assert!(negotiation.compatible);
}

#[test]
fn expanded_catalog_fixture_passes_the_same_official_protocol_gate() {
    let fixtures: Value = serde_json::from_str(RUNTIME_CASES).unwrap();
    let (_directory, storage, workspace_id, session_id) = setup();
    let result = process(
        &storage,
        &workspace_id,
        &session_id,
        &fixtures["validExpandedCatalog"],
    );
    let surface = result.surface.unwrap();
    assert_eq!(surface.root.children.len(), 6);
    assert_eq!(surface.root.children[0].component, "Checklist");
    assert_eq!(surface.root.children[5].component, "IssueCard");
    assert_eq!(surface.data["dueDate"], "2026-09-30");
}

#[test]
fn incompatible_versions_catalogs_components_and_actions_never_render() {
    let fixtures: Value = serde_json::from_str(RUNTIME_CASES).unwrap();
    let (_directory, storage, workspace_id, session_id) = setup();
    for (name, code) in [
        ("invalidVersion", "A2UI_PROTOCOL_INCOMPATIBLE"),
        ("invalidCatalog", "A2UI_CATALOG_UNSUPPORTED"),
        ("unknownComponent", "A2UI_VALIDATION_FAILED"),
        ("unknownAction", "A2UI_VALIDATION_FAILED"),
        ("invalidExpandedProps", "A2UI_VALIDATION_FAILED"),
    ] {
        let result = process(&storage, &workspace_id, &session_id, &fixtures[name]);
        assert!(result.surface.is_none(), "{name} must not render");
        assert!(!result.inspection.validation.valid);
        assert_eq!(
            result.inspection.validation.error_code.as_deref(),
            Some(code)
        );
    }
    assert!(storage.a2ui_surfaces(&workspace_id).unwrap().is_empty());
    assert_eq!(storage.a2ui_inspections(&workspace_id).unwrap().len(), 5);
}

#[test]
fn unchanged_upstream_basic_catalog_fixture_is_recognized_and_safely_degraded() {
    let upstream: Value = serde_json::from_str(UPSTREAM_SIMPLE_TEXT).unwrap();
    let part = json!({
        "data": upstream["messages"],
        "kind": "data",
        "metadata": {"mimeType": "application/a2ui+json"}
    });
    let (_directory, storage, workspace_id, session_id) = setup();
    let result = process(&storage, &workspace_id, &session_id, &part);
    assert!(result.surface.is_none());
    assert_eq!(
        result.inspection.validation.error_code.as_deref(),
        Some("A2UI_CATALOG_UNSUPPORTED")
    );
    assert_eq!(
        result
            .inspection
            .validation
            .negotiation
            .unwrap()
            .catalog_id
            .as_deref(),
        Some("https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json")
    );
}
