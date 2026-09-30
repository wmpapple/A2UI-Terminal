use a2ui_terminal_lib::{
    a2ui::{self, SaveA2uiTemplateRequest},
    application::{critic, document, result, scene_link as links, scene_tool as tools, task},
    domain::{
        critic::InspectCriticInput,
        document::DocumentTarget,
        result::{
            CreateTextResultInput, ResultType, SaveResultDocumentInput, SaveResultDraftInput,
            TextResultFormat,
        },
        task::CreateTaskInput,
    },
    state::AppState,
    storage::Storage,
    workspace,
};
use links::{ConfirmSceneLink, SetSceneLink, ToolBinding};
use serde_json::json;
fn remove_collaboration_schema_for_legacy_fixture(db: &rusqlite::Connection) {
    db.execute_batch("DROP TRIGGER result_local_owner; DROP TABLE collaboration_reviews; DROP TABLE collaboration_inbox; DROP TABLE collaboration_shares; DROP TABLE collaboration_audit; DROP TABLE result_ownership; DROP TABLE collaboration_identity;").unwrap();
}
fn setup() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    (dir, state)
}
fn input(id: &str) -> tools::CreateSceneTool {
    let t = tools::templates("zh-CN")
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .unwrap();
    tools::CreateSceneTool {
        template_id: t.id,
        title: t.name,
        items: t.default_items,
        locale: "zh-CN".into(),
    }
}
fn doc(state: &AppState) -> String {
    result::create_text(
        &state.storage,
        &state.managed_results_dir,
        CreateTextResultInput {
            title: "测试文档".into(),
            file_name: format!("{}.md", uuid::Uuid::new_v4()),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap()
    .result
    .summary
    .id
}
fn create(state: &AppState, id: &str, binding: &ToolBinding) -> String {
    tools::create_linked(state, input(id), binding)
        .unwrap()
        .result
        .summary
        .id
}
fn confirmation(state: &AppState, tool: &str) -> ConfirmSceneLink {
    let v = links::read(state, tool).unwrap();
    ConfirmSceneLink {
        tool_result_id: tool.into(),
        version: v.link.unwrap().version,
        target_hash: v.current_hash.unwrap(),
        target_revision_id: v.current_revision_id,
        tool_state_hash: v.tool_state_hash,
    }
}
fn save_doc(state: &AppState, id: &str, text: &str) {
    let d = result::read_document(&state.storage, &state.managed_results_dir, id).unwrap();
    result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: id.into(),
            base_hash: d.content_hash,
            content: text.into(),
        },
    )
    .unwrap();
}
#[test]
fn every_scene_supports_standalone_creation_and_optional_binding() {
    let (_dir, state) = setup();
    assert!(result::list(&state.storage, None, false)
        .unwrap()
        .is_empty());
    for t in ["publish", "review", "interview", "collect", "tasks"] {
        let id = create(&state, t, &ToolBinding::None);
        let view = links::read(&state, &id).unwrap();
        assert_eq!(view.status, "unbound");
        assert_eq!(view.binding_policy, "optional");
        assert!(view.context.is_none());
    }
    let target = doc(&state);
    let id = create(&state, "review", &ToolBinding::document_result(&target));
    let item = tools::list_items(&state.storage)
        .unwrap()
        .into_iter()
        .find(|item| item.summary.id == id)
        .unwrap();
    assert_eq!(item.binding_title.as_deref(), Some("测试文档"));
    let encoded = serde_json::to_value(item).unwrap();
    assert_eq!(encoded["id"], id);
    assert!(encoded.get("content").is_none());
    let view = links::read(&state, &id).unwrap();
    assert_eq!(view.bound_revision.as_ref().unwrap().source, "initial");
    assert!(view.reviewed_revision.is_none());
    assert_eq!(
        view.link.as_ref().unwrap().bound_revision_id,
        view.current_revision_id
    );
    assert!(links::set(
        &state,
        SetSceneLink {
            tool_result_id: id,
            binding: ToolBinding::None,
            expected_version: Some(view.link.unwrap().version)
        }
    )
    .is_ok());
}

#[test]
fn readable_revision_uses_historical_time_and_tolerates_pruned_history() {
    let (dir, state) = setup();
    let d = doc(&state);
    let t = create(&state, "publish", &ToolBinding::document_result(&d));
    let bound = links::read(&state, &t).unwrap().link.unwrap();
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    db.execute(
        "UPDATE document_versions SET created_at='2026-09-01 02:24:08' WHERE id=?1",
        [bound.bound_revision_id.as_deref().unwrap()],
    )
    .unwrap();
    links::confirm(&state, confirmation(&state, &t)).unwrap();
    save_doc(&state, &d, "New content");
    let view = links::read(&state, &t).unwrap();
    assert_eq!(view.bound_revision.unwrap().saved_at, "2026-09-01 02:24:08");
    assert_eq!(
        view.reviewed_revision.unwrap().saved_at,
        "2026-09-01 02:24:08"
    );
    assert_eq!(view.status, "changed");
    db.execute(
        "DELETE FROM document_versions WHERE id=?1",
        [bound.bound_revision_id.as_deref().unwrap()],
    )
    .unwrap();
    let view = links::read(&state, &t).unwrap();
    assert!(view.bound_revision.is_none() && view.reviewed_revision.is_none());
    assert_eq!(view.link.unwrap().bound_hash, bound.bound_hash);
    assert_eq!(view.status, "changed");
}
#[test]
fn non_file_result_binding_does_not_grant_model_or_knowledge_access() {
    let (_dir, state) = setup();
    let result = create(&state, "collect", &ToolBinding::None);
    let binding = ToolBinding::Result {
        target_id: result.clone(),
    };
    let tool = create(&state, "tasks", &binding);
    let view = links::read(&state, &tool).unwrap();
    let context = view.context.unwrap();
    assert_eq!(context.scope, "result_content");
    assert!(!context.model_access && !context.knowledge_access);
    assert_eq!(links::list(&state, &binding).unwrap()[0].id, tool);
    assert!(tools::create_linked(&state, input("publish"), &binding).is_ok());
    assert!(links::set(
        &state,
        SetSceneLink {
            tool_result_id: tool.clone(),
            binding: ToolBinding::Result { target_id: tool },
            expected_version: Some(view.link.unwrap().version)
        }
    )
    .is_err());
}
#[test]
fn revisions_drafts_and_stale_confirmations_cannot_reuse_approval() {
    let (_dir, state) = setup();
    let d = doc(&state);
    save_doc(&state, &d, "Original");
    let t = create(&state, "publish", &ToolBinding::document_result(&d));
    let stale = confirmation(&state, &t);
    let first = confirmation(&state, &t);
    assert_eq!(links::confirm(&state, first).unwrap().status, "current");
    assert!(links::confirm(&state, stale).is_err());
    save_doc(&state, &d, "Changed");
    save_doc(&state, &d, "Original");
    let view = links::read(&state, &t).unwrap();
    assert_eq!(view.current_hash, view.link.as_ref().unwrap().reviewed_hash);
    assert_ne!(
        view.current_revision_id,
        view.link.as_ref().unwrap().reviewed_revision_id
    );
    assert_eq!(view.status, "changed");
    let pending = confirmation(&state, &t);
    result::save_draft(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDraftInput {
            result_id: d,
            content: "draft".into(),
            base_hash: pending.target_hash.clone(),
        },
    )
    .unwrap();
    assert!(links::confirm(&state, pending).is_err());
    assert_eq!(links::read(&state, &t).unwrap().status, "unsaved");
}
#[test]
fn editing_tool_invalidates_checkpoint_and_preserves_entries() {
    let (_dir, state) = setup();
    let d = doc(&state);
    let t = create(&state, "publish", &ToolBinding::document_result(&d));
    let stale = confirmation(&state, &t);
    links::confirm(&state, confirmation(&state, &t)).unwrap();
    let tool = tools::read(&state.storage, &t).unwrap();
    tools::save(
        &state.storage,
        tools::SaveSceneTool {
            result_id: t.clone(),
            base_hash: tool.state_hash,
            data: json!({"checks":["item0"]}).as_object().unwrap().clone(),
        },
    )
    .unwrap();
    assert_eq!(links::read(&state, &t).unwrap().status, "unchecked");
    assert!(links::confirm(&state, stale).is_err());
    assert_eq!(
        tools::read(&state.storage, &t).unwrap().surface.data["checks"],
        json!(["item0"])
    );
}
#[test]
fn template_copies_keep_policy_but_clear_target_and_checkpoint() {
    let (_dir, state) = setup();
    let d = doc(&state);
    let t = create(&state, "review", &ToolBinding::document_result(&d));
    let tool = tools::read(&state.storage, &t).unwrap();
    let template = a2ui::save_template(
        &state.storage,
        SaveA2uiTemplateRequest {
            workspace_id: tool.surface.workspace_id,
            surface_id: tool.surface.surface_id,
            name: "Review template".into(),
        },
    )
    .unwrap();
    let standalone = tools::open_template(&state.storage, &template.id).unwrap();
    assert_eq!(
        links::read(&state, &standalone.result.summary.id)
            .unwrap()
            .status,
        "unbound"
    );
    let other = doc(&state);
    let copy = tools::open_bound_template(
        &state.storage,
        &state.managed_results_dir,
        &template.id,
        &ToolBinding::document_result(&other),
    )
    .unwrap();
    let v = links::read(&state, &copy.result.summary.id).unwrap();
    assert_eq!(v.binding_policy, "optional");
    assert_eq!(
        v.link.unwrap().binding,
        ToolBinding::document_result(&other)
    );
    assert_eq!(v.status, "unchecked");
}
#[test]
fn workspace_file_revisions_revocation_and_citations_use_existing_authorization() {
    let (dir, state) = setup();
    let ws = workspace::register_standalone_workspace(&state.storage).unwrap();
    let path = dir.path().join("readme.md");
    std::fs::write(&path, "Budget 420 [cite:missing]").unwrap();
    let file = workspace::attach_selected_file(&state.storage, &ws.id, &path).unwrap();
    let source = file.source_id.unwrap();
    let target = DocumentTarget::WorkspaceFile {
        workspace_id: ws.id.clone(),
        source_id: source.clone(),
    };
    let t = create(
        &state,
        "publish",
        &ToolBinding::Document {
            target: target.clone(),
        },
    );
    links::confirm(&state, confirmation(&state, &t)).unwrap();
    let before = document::snapshot(&state.storage, &state.managed_results_dir, &target).unwrap();
    workspace::save_file_with_history(
        &state.storage,
        &ws.id,
        &file.path,
        "changed",
        &before.content_hash,
    )
    .unwrap();
    let changed = document::snapshot(&state.storage, &state.managed_results_dir, &target).unwrap();
    workspace::save_file_with_history(
        &state.storage,
        &ws.id,
        &file.path,
        &before.text,
        &changed.content_hash,
    )
    .unwrap();
    assert_eq!(links::read(&state, &t).unwrap().status, "changed");
    state
        .storage
        .revoke_workspace_file(&ws.id, &source)
        .unwrap();
    let denied = links::read(&state, &t).unwrap();
    assert_eq!(denied.status, "unavailable");
    assert!(denied.context.is_none());
    assert_eq!(std::fs::read_to_string(path).unwrap(), before.text);
    assert_eq!(
        result::list(&state.storage, None, false).unwrap().len(),
        0,
        "association must not silently create a document Result"
    );
}
#[test]
fn existing_critic_reports_are_read_only_and_stale_findings_are_hidden() {
    let (_dir, state) = setup();
    let d = doc(&state);
    save_doc(&state, &d, "预算 420 元。");
    let target = DocumentTarget::Result {
        result_id: d.clone(),
    };
    let t = create(
        &state,
        "review",
        &ToolBinding::Document {
            target: target.clone(),
        },
    );
    assert!(links::read(&state, &t).unwrap().critics.is_empty());
    critic::inspect(
        &state,
        InspectCriticInput {
            target,
            options: Default::default(),
        },
    )
    .unwrap();
    assert!(links::read(&state, &t).unwrap().critics[0].current);
    save_doc(&state, &d, "Budget 421");
    let view = links::read(&state, &t).unwrap();
    assert!(!view.critics[0].current);
    assert!(view.critics[0].findings.is_empty());
}
#[test]
fn task_and_workspace_bindings_are_real_metadata_targets() {
    let (_dir, state) = setup();
    let ws = workspace::register_standalone_workspace(&state.storage).unwrap();
    let template = task::list_templates(&state.storage).unwrap().remove(0);
    let task = task::create(
        &state.storage,
        CreateTaskInput {
            workspace_id: ws.id.clone(),
            template_id: template.id,
        },
    )
    .unwrap();
    for (binding, scope) in [
        (ToolBinding::Task { target_id: task.id }, "task_metadata"),
        (
            ToolBinding::Workspace { target_id: ws.id },
            "workspace_identity",
        ),
    ] {
        let t = create(&state, "tasks", &binding);
        assert_eq!(
            links::read(&state, &t).unwrap().context.unwrap().scope,
            scope
        );
        assert_eq!(
            links::confirm(&state, confirmation(&state, &t))
                .unwrap()
                .status,
            "current"
        );
    }
    assert!(links::targets(&state.storage)
        .unwrap()
        .iter()
        .any(|c| matches!(c.binding, ToolBinding::Task { .. })));
}
#[test]
fn links_survive_restart_deleted_targets_fail_closed_and_tool_deletion_cascades() {
    let (dir, state) = setup();
    let d = doc(&state);
    let t = create(&state, "publish", &ToolBinding::document_result(&d));
    links::confirm(&state, confirmation(&state, &t)).unwrap();
    drop(state);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert_eq!(links::read(&state, &t).unwrap().status, "current");
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db.execute("DELETE FROM results WHERE id=?1", [d]).unwrap();
    assert_eq!(links::read(&state, &t).unwrap().status, "unavailable");
    db.execute("DELETE FROM results WHERE id=?1", [t]).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM scene_tool_bindings", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn upgrade_from_28_preserves_legacy_tools_without_inventing_a_binding() {
    let (dir, state) = setup();
    let t = create(&state, "collect", &ToolBinding::None);
    drop(state);
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    remove_collaboration_schema_for_legacy_fixture(&db);
    db.execute_batch("DROP TABLE scene_tool_bindings;DROP TABLE scene_tool_instances;DROP TABLE scene_template_policies;PRAGMA user_version=28;").unwrap();
    drop(db);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert_eq!(state.storage.schema_version().unwrap(), 32);
    assert_eq!(links::read(&state, &t).unwrap().status, "unbound");
    assert!(result::list(&state.storage, None, false)
        .unwrap()
        .is_empty());
    assert_eq!(tools::list(&state.storage).unwrap()[0].id, t);
}

#[test]
fn upgrade_from_30_unlocks_existing_tools_and_templates_without_losing_state() {
    let (dir, state) = setup();
    let d = doc(&state);
    let id = create(&state, "publish", &ToolBinding::document_result(&d));
    let view = tools::read(&state.storage, &id).unwrap();
    tools::save(
        &state.storage,
        tools::SaveSceneTool {
            result_id: id.clone(),
            base_hash: view.state_hash,
            data: json!({"subject":"retained","checks":["item0"]})
                .as_object()
                .unwrap()
                .clone(),
        },
    )
    .unwrap();
    let template = a2ui::save_template(
        &state.storage,
        SaveA2uiTemplateRequest {
            workspace_id: view.surface.workspace_id,
            surface_id: view.surface.surface_id,
            name: "Legacy publication template".into(),
        },
    )
    .unwrap();
    drop(state);
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    remove_collaboration_schema_for_legacy_fixture(&db);
    db.execute_batch("UPDATE scene_tool_instances SET binding_policy='document'; UPDATE scene_template_policies SET binding_policy='document'; PRAGMA user_version=30;").unwrap();
    drop(db);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    let link = links::read(&state, &id).unwrap();
    assert_eq!(link.binding_policy, "optional");
    assert_eq!(
        link.link.as_ref().unwrap().binding,
        ToolBinding::document_result(&d)
    );
    let view = tools::read(&state.storage, &id).unwrap();
    assert_eq!(view.surface.data["subject"], "retained");
    links::set(
        &state,
        SetSceneLink {
            tool_result_id: id.clone(),
            binding: ToolBinding::None,
            expected_version: Some(link.link.unwrap().version),
        },
    )
    .unwrap();
    assert_eq!(
        tools::read(&state.storage, &id).unwrap().surface.data["checks"],
        json!(["item0"])
    );
    let copy = tools::open_template(&state.storage, &template.id).unwrap();
    assert_eq!(
        links::read(&state, &copy.result.summary.id).unwrap().status,
        "unbound"
    );
    assert_eq!(copy.surface.data["subject"], "");
    assert_eq!(copy.surface.data["checks"], json!([]));
}
