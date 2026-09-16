use a2ui_terminal_lib::a2ui::{process_message, ExecuteActionRequest, ProcessA2uiRequest};
use a2ui_terminal_lib::application::{adapters, review};
use a2ui_terminal_lib::domain::review::{
    ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision, ReviewOperationKind,
    ReviewRisk, ReviewSource, ReviewStatus,
};
use a2ui_terminal_lib::storage::Storage;
use serde_json::{json, Value};
use std::fs;
use uuid::Uuid;

fn setup() -> (
    tempfile::TempDir,
    tempfile::TempDir,
    Storage,
    String,
    String,
) {
    let workspace = tempfile::tempdir().unwrap();
    let managed = tempfile::tempdir().unwrap();
    let storage = Storage::open(&managed.path().join("a2ui-action-review.sqlite3")).unwrap();
    let workspace_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    storage
        .upsert_workspace(
            &workspace_id,
            "A2UI action review",
            workspace.path().to_str().unwrap(),
        )
        .unwrap();
    storage
        .create_session(&workspace_id, &session_id, "Review")
        .unwrap();
    (workspace, managed, storage, workspace_id, session_id)
}

fn create_file_candidate(workspace_id: &str, file_name: &str, risk: &str) -> Value {
    json!({
        "version": "1.0",
        "type": "create_file",
        "workspaceId": workspace_id,
        "summary": "保存会议纪要",
        "title": "会议纪要",
        "fileName": file_name,
        "format": "markdown",
        "content": "# 会议纪要\n\n由交互界面提出，等待用户确认。\n",
        "reason": "用户点击了保存为成果",
        "risk": risk
    })
}

fn save_surface(
    storage: &Storage,
    workspace_id: &str,
    session_id: &str,
    surface_id: &str,
    candidate: Value,
) {
    let raw_message = json!({
        "version": "1.0",
        "type": "a2ui_surface",
        "surfaceId": surface_id,
        "revision": 1,
        "root": {
            "id": "save",
            "component": "Button",
            "props": {"label": "保存为成果"},
            "actions": {
                "click": {"type": "request_patch", "value": candidate}
            }
        }
    })
    .to_string();
    let result = process_message(
        storage,
        &ProcessA2uiRequest {
            workspace_id: workspace_id.into(),
            session_id: session_id.into(),
            message_id: Uuid::new_v4().to_string(),
            raw_message,
        },
    )
    .unwrap()
    .unwrap();
    assert!(result.inspection.validation.valid);
    assert!(result.surface.is_some());
}

#[test]
fn persisted_medium_action_creates_review_and_ignores_forged_frontend_candidate() {
    let (_workspace, managed, storage, workspace_id, session_id) = setup();
    save_surface(
        &storage,
        &workspace_id,
        &session_id,
        "review-surface",
        create_file_candidate(&workspace_id, "declared.md", "high"),
    );

    let result = adapters::execute_action(
        &storage,
        ExecuteActionRequest {
            workspace_id: workspace_id.clone(),
            surface_id: "review-surface".into(),
            component_id: "save".into(),
            event_name: "click".into(),
            payload: create_file_candidate(&workspace_id, "forged.md", "low"),
        },
    )
    .unwrap();

    assert_eq!(result.decision.as_str(), "review_required");
    let created = result.review.unwrap();
    assert_eq!(created.source, ReviewSource::A2uiAction);
    assert_eq!(created.status, ReviewStatus::Pending);
    assert_eq!(created.risk, ReviewRisk::High);
    assert_eq!(
        created.blocks[0].suggested_file_name.as_deref(),
        Some("declared.md")
    );
    assert!(!result.surface.events[0]
        .payload
        .to_string()
        .contains("forged.md"));
    assert_eq!(result.surface.events[0].payload["reviewId"], created.id);
    assert!(!managed.path().join("declared.md").exists());
    assert!(storage.results(None, true).unwrap().is_empty());

    review::decide(
        &storage,
        DecideReviewBlocksInput {
            review_id: created.id.clone(),
            workspace_id: workspace_id.clone(),
            decisions: vec![ReviewBlockDecision {
                block_id: created.blocks[0].id.clone(),
                accepted: true,
                file_name: Some("declared.md".into()),
            }],
        },
    )
    .unwrap();
    let applied = review::apply(
        &storage,
        managed.path(),
        ApplyReviewInput {
            review_id: created.id,
            workspace_id,
        },
    )
    .unwrap();
    assert_eq!(applied.status, ReviewStatus::Applied);
    assert_eq!(
        applied.result.unwrap().content,
        "# 会议纪要\n\n由交互界面提出，等待用户确认。\n"
    );
    assert!(managed.path().join("declared.md").exists());
    assert!(!managed.path().join("forged.md").exists());
}

#[test]
fn every_supported_persistent_candidate_kind_reaches_the_same_review_pipeline() {
    let (workspace, _managed, storage, workspace_id, session_id) = setup();
    fs::write(workspace.path().join("notes.md"), "old line\n").unwrap();
    fs::write(workspace.path().join("empty.md"), "").unwrap();
    let candidates = [
        (
            "patch-surface",
            json!({
                "version": "1.0",
                "type": "document_patch",
                "workspaceId": workspace_id.clone(),
                "summary": "更新一行",
                "changes": [{
                    "id": "change-1",
                    "path": "notes.md",
                    "operation": "replace",
                    "anchor": {"before": "old line"},
                    "content": "new line",
                    "reason": "用户要求更新",
                    "risk": "medium"
                }]
            }),
            ReviewOperationKind::DocumentPatch,
        ),
        (
            "empty-surface",
            json!({
                "version": "1.0",
                "type": "replace_empty_file",
                "workspaceId": workspace_id.clone(),
                "summary": "写入空白文档",
                "path": "empty.md",
                "content": "first line\n",
                "reason": "用户要求首次写入",
                "risk": "low"
            }),
            ReviewOperationKind::ReplaceResult,
        ),
    ];

    for (surface_id, candidate, expected_kind) in candidates {
        save_surface(&storage, &workspace_id, &session_id, surface_id, candidate);
        let result = adapters::execute_action(
            &storage,
            ExecuteActionRequest {
                workspace_id: workspace_id.clone(),
                surface_id: surface_id.into(),
                component_id: "save".into(),
                event_name: "click".into(),
                payload: json!({"risk": "low", "action": "allowed"}),
            },
        )
        .unwrap();
        let created = result.review.unwrap();
        assert_eq!(created.source, ReviewSource::A2uiAction);
        assert_eq!(created.operation_kind, expected_kind);
        assert_eq!(created.status, ReviewStatus::Pending);
    }
    assert_eq!(
        fs::read_to_string(workspace.path().join("notes.md")).unwrap(),
        "old line\n"
    );
    assert_eq!(
        fs::read_to_string(workspace.path().join("empty.md")).unwrap(),
        ""
    );
}

#[test]
fn malformed_review_action_and_system_command_never_become_surfaces() {
    let (_workspace, _managed, storage, workspace_id, session_id) = setup();
    for action in [
        json!({"type": "request_patch"}),
        json!({"type": "run_command", "value": {"command": "whoami"}}),
    ] {
        let raw_message = json!({
            "version": "1.0",
            "type": "a2ui_surface",
            "surfaceId": Uuid::new_v4().to_string(),
            "revision": 1,
            "root": {
                "id": "unsafe",
                "component": "Button",
                "props": {"label": "执行"},
                "actions": {"click": action}
            }
        })
        .to_string();
        let result = process_message(
            &storage,
            &ProcessA2uiRequest {
                workspace_id: workspace_id.clone(),
                session_id: session_id.clone(),
                message_id: Uuid::new_v4().to_string(),
                raw_message,
            },
        )
        .unwrap()
        .unwrap();
        assert!(result.surface.is_none());
        assert!(!result.inspection.validation.valid);
    }
    assert!(storage.a2ui_surfaces(&workspace_id).unwrap().is_empty());
    assert!(storage.results(None, true).unwrap().is_empty());
}
