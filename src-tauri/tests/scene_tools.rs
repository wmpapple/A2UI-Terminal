use a2ui_terminal_lib::{
    a2ui::{self, SaveA2uiTemplateRequest},
    application::{export, result, scene_link::ToolBinding, scene_tool as app},
    domain::{
        export::ExportResultInput,
        result::{CreateTextResultInput, ResultType, TextResultFormat},
    },
    storage::Storage,
};
use serde_json::{json, Value};

fn create(storage: &Storage, root: &std::path::Path, template: &str) -> app::SceneToolView {
    let template = app::templates("zh-CN")
        .unwrap()
        .into_iter()
        .find(|t| t.id == template)
        .unwrap();
    bound(
        storage,
        root,
        app::CreateSceneTool {
            template_id: template.id,
            title: template.name,
            items: template.default_items,
            locale: "zh-CN".into(),
        },
    )
    .unwrap()
}
fn binding(storage: &Storage, root: &std::path::Path, required: bool) -> ToolBinding {
    if !required {
        return ToolBinding::None;
    }
    let doc = result::create_text(
        storage,
        root,
        CreateTextResultInput {
            title: "关联文档".into(),
            file_name: format!("{}.md", uuid::Uuid::new_v4()),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    ToolBinding::document_result(&doc.result.summary.id)
}
fn bound(
    storage: &Storage,
    root: &std::path::Path,
    input: app::CreateSceneTool,
) -> Result<app::SceneToolView, a2ui_terminal_lib::error::AppError> {
    let b = binding(
        storage,
        root,
        matches!(input.template_id.as_str(), "publish" | "review"),
    );
    app::create_bound(storage, root, input, &b)
}
fn save(
    storage: &Storage,
    view: &app::SceneToolView,
    data: Value,
) -> Result<app::SceneToolView, a2ui_terminal_lib::error::AppError> {
    app::save(
        storage,
        app::SaveSceneTool {
            result_id: view.result.summary.id.clone(),
            base_hash: view.state_hash.clone(),
            data: data.as_object().unwrap().clone(),
        },
    )
}
fn setup() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    (dir, storage)
}

#[test]
fn all_five_scenes_and_bounded_custom_items_validate_in_both_languages() {
    let (dir, storage) = setup();
    for locale in ["zh-CN", "en-US"] {
        let templates = app::templates(locale).unwrap();
        assert_eq!(templates.len(), 5);
        for template in templates {
            let view = bound(
                &storage,
                dir.path(),
                app::CreateSceneTool {
                    template_id: template.id,
                    title: template.name,
                    items: (0..template.max_items)
                        .map(|i| format!("自定义检查项 {i}"))
                        .collect(),
                    locale: locale.into(),
                },
            )
            .unwrap();
            assert!(view.surface.validation.valid);
            assert!(view.result.summary.current_revision_id.is_some());
            assert_eq!(view.result.summary.result_type, ResultType::Tool);
            assert!(view.surface.data.is_empty());
        }
    }
    assert_eq!(
        result::list(&storage, None, false)
            .unwrap()
            .into_iter()
            .filter(|r| r.result_type == ResultType::Tool)
            .count(),
        0
    );
    assert_eq!(app::list(&storage).unwrap().len(), 10);
}

#[test]
fn manual_publication_is_separate_durable_and_conflict_checked() {
    let (dir, storage) = setup();
    let tool = create(&storage, dir.path(), "collect");
    let tool = save(&storage, &tool, json!({"subject":"first"})).unwrap();
    assert!(result::list(&storage, None, false).unwrap().is_empty());
    assert_eq!(app::list(&storage).unwrap().len(), 1);
    let publish = |s: &Storage, v: &app::SceneToolView| {
        app::publish(
            s,
            app::PublishSceneTool {
                result_id: v.result.summary.id.clone(),
                base_hash: v.state_hash.clone(),
                expected_revision: v.publication.as_ref().map(|p| p.revision_id.clone()),
                title: if v.publication.is_none() { Some("资料收集结果".into()) } else { None },
            },
        )
    };
    let published = publish(&storage, &tool).unwrap();
    let first_publication = published.publication.as_ref().unwrap();
    let id = first_publication.result_id.clone();
    assert_eq!(first_publication.revision_number, 1);
    assert_eq!(first_publication.title, "资料收集结果");
    assert!(first_publication.synced);
    let initial = result::read_document(&storage, dir.path(), &id).unwrap();
    assert!(!initial.editable);
    assert!(initial.content.contains("first"));
    assert_eq!(result::list(&storage, None, false).unwrap().len(), 1);
    assert!(
        publish(&storage, &tool).is_err(),
        "stale publication must not overwrite"
    );
    let changed = save(&storage, &published, json!({"subject":"second"})).unwrap();
    assert!(!changed.publication.as_ref().unwrap().synced);
    assert!(
        publish(&storage, &published).is_err(),
        "stale tool state must not publish"
    );
    assert_eq!(
        result::read_document(&storage, dir.path(), &id)
            .unwrap()
            .content,
        initial.content
    );
    let updated = publish(&storage, &changed).unwrap();
    assert_eq!(updated.publication.as_ref().unwrap().result_id, id);
    assert_eq!(updated.publication.as_ref().unwrap().revision_number, 2);
    assert!(updated.publication.as_ref().unwrap().synced);
    let renamed = app::rename(
        &storage,
        app::RenameSceneTool {
            result_id: updated.result.summary.id.clone(),
            title: "第二版资料收集".into(),
        },
    )
    .unwrap();
    assert!(renamed.publication.as_ref().unwrap().synced);
    let updated = publish(&storage, &renamed).unwrap();
    assert_eq!(updated.publication.as_ref().unwrap().revision_number, 3);
    assert_eq!(
        updated.publication.as_ref().unwrap().title,
        "资料收集结果"
    );
    assert!(updated.publication.as_ref().unwrap().synced);
    assert!(result::read_document(&storage, dir.path(), &id)
        .unwrap()
        .content
        .contains("second"));
    assert_eq!(result::list(&storage, None, false).unwrap().len(), 1);
    drop(storage);
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    let reopened = app::read(&storage, &tool.result.summary.id).unwrap();
    assert_eq!(reopened.result.summary.title, "第二版资料收集");
    assert_eq!(reopened.surface.data["subject"], "second");
    assert_eq!(reopened.publication.unwrap().result_id, id);
}

#[test]
fn tool_identity_reset_and_list_metadata_are_durable() {
    let (dir, storage) = setup();
    let tool = create(&storage, dir.path(), "interview");
    let saved = save(
        &storage,
        &tool,
        json!({"subject":"原始主题","guest":"王教授"}),
    )
    .unwrap();
    let renamed = app::rename(
        &storage,
        app::RenameSceneTool {
            result_id: saved.result.summary.id.clone(),
            title: "王教授访谈".into(),
        },
    )
    .unwrap();
    assert_eq!(renamed.result.summary.title, "王教授访谈");
    assert_eq!(renamed.template_id, "interview");
    let reset = app::reset(
        &storage,
        app::ResetSceneTool {
            result_id: renamed.result.summary.id.clone(),
            base_hash: renamed.state_hash,
        },
    )
    .unwrap();
    assert!(reset.surface.data.is_empty());
    let item = app::list_items(&storage).unwrap().remove(0);
    assert_eq!(item.summary.title, "王教授访谈");
    assert_eq!(item.template_id, "interview");
    assert!(item.binding_title.is_none());
    assert!(item.publication.is_none());
}

#[test]
fn state_snapshot_and_exports_survive_database_reopen() {
    let (dir, storage) = setup();
    let view = create(&storage, dir.path(), "publish");
    let saved = save(
        &storage,
        &view,
        json!({"subject":"星河 420 尚未批准","checks":["item0"],"owner":"小林"}),
    )
    .unwrap();
    assert_ne!(saved.state_hash, view.state_hash);
    let id = saved.result.summary.id.clone();
    let revision = saved.result.summary.current_revision_id.clone().unwrap();
    drop(storage);
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    assert_eq!(
        app::read(&storage, &id).unwrap().surface.data["owner"],
        "小林"
    );
    let prepared = export::prepare(
        &storage,
        dir.path(),
        &ExportResultInput {
            export_id: uuid::Uuid::new_v4().to_string(),
            result_id: id,
            revision_id: revision,
            format: export::ExportFormat::Json,
        },
    )
    .unwrap();
    assert!(prepared.content.contains("[x] 标题与摘要"));
    assert!(prepared.content.contains("[ ] 数据来源"));
    assert!(!prepared.content.contains("surfaceId"));
    let pdf = export::generate(
        ResultType::Tool,
        TextResultFormat::Json,
        "发布检查表",
        &prepared.content,
        export::ExportFormat::Pdf,
    )
    .unwrap();
    let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
    assert!(
        text.contains("小林") && text.contains("尚未批准") && text.contains("数据来源"),
        "{text}"
    );
}

#[test]
fn stale_hash_unknown_fields_and_invalid_values_never_partially_write() {
    let (dir, storage) = setup();
    let view = create(&storage, dir.path(), "review");
    for data in [
        json!({"subject":"不能写入","item0_status":"approved"}),
        json!({"subject":"不能写入","__proto__":"unsafe"}),
        json!({"item0_note":"x".repeat(1001)}),
        json!({"item0_note":{"action":"request_patch"}}),
    ] {
        assert!(save(&storage, &view, data).is_err());
        assert_eq!(
            app::read(&storage, &view.result.summary.id)
                .unwrap()
                .state_hash,
            view.state_hash
        );
    }
    let changed = save(&storage, &view, json!({"item0_status":"issue"})).unwrap();
    assert!(matches!(
        save(&storage, &view, json!({"subject":"过期覆盖"})),
        Err(a2ui_terminal_lib::error::AppError::FileConflict)
    ));
    let same = save(&storage, &changed, json!({})).unwrap();
    assert_eq!(
        same.result.summary.current_revision_id,
        changed.result.summary.current_revision_id
    );
    assert_eq!(
        result::list_revisions(&storage, dir.path(), &view.result.summary.id)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn dates_checkboxes_and_checklist_keys_use_existing_runtime_constraints() {
    let (dir, storage) = setup();
    let task = create(&storage, dir.path(), "tasks");
    for data in [
        json!({"item0_date":"2026-02-30"}),
        json!({"item0_done":"true"}),
    ] {
        assert!(save(&storage, &task, data).is_err());
    }
    assert!(save(
        &storage,
        &task,
        json!({"item0_date":"2026-10-15","item0_done":true})
    )
    .is_ok());
    let publish = create(&storage, dir.path(), "publish");
    assert!(save(&storage, &publish, json!({"checks":["unknown"]})).is_err());
    assert!(save(&storage, &publish, json!({"checks":["item0","item0"]})).is_err());
}

#[test]
fn failed_snapshot_commit_rolls_back_form_state() {
    let (dir, storage) = setup();
    let view = create(&storage, dir.path(), "collect");
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    db.execute_batch("CREATE TRIGGER simulate_disk_failure BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;").unwrap();
    assert!(save(&storage, &view, json!({"item0":"不应保存"})).is_err());
    assert_eq!(
        app::read(&storage, &view.result.summary.id)
            .unwrap()
            .state_hash,
        view.state_hash
    );
    assert_eq!(
        result::list_revisions(&storage, dir.path(), &view.result.summary.id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn personal_templates_clear_values_and_reuse_independent_state() {
    let (dir, storage) = setup();
    for id in ["publish", "interview", "review", "tasks", "collect"] {
        let view = create(&storage, dir.path(), id);
        let saved = save(&storage, &view, json!({"subject":"私人填写值"})).unwrap();
        let template = a2ui::save_template(
            &storage,
            SaveA2uiTemplateRequest {
                workspace_id: saved.surface.workspace_id.clone(),
                surface_id: saved.surface.surface_id.clone(),
                name: format!("复用 {id}"),
            },
        )
        .unwrap();
        assert_eq!(template.source_template_id.as_deref(), Some(id));
        let target = binding(&storage, dir.path(), matches!(id, "publish" | "review"));
        let opened = app::open_bound_template(&storage, dir.path(), &template.id, &target).unwrap();
        assert_ne!(opened.result.summary.id, saved.result.summary.id);
        assert_eq!(opened.surface.data["subject"], "");
        assert!(!serde_json::to_string(&opened)
            .unwrap()
            .contains("私人填写值"));
        assert_eq!(
            app::read(&storage, &saved.result.summary.id)
                .unwrap()
                .surface
                .data["subject"],
            "私人填写值"
        );
    }
}

#[test]
fn deleted_tool_cannot_write_and_clear_all_cleans_every_scene_record() {
    let (dir, storage) = setup();
    let view = create(&storage, dir.path(), "collect");
    storage
        .delete_a2ui_surface(&view.surface.workspace_id, &view.surface.surface_id)
        .unwrap();
    assert!(app::read(&storage, &view.result.summary.id).is_err());
    assert!(save(&storage, &view, json!({"subject":"失效"})).is_err());
    create(&storage, dir.path(), "publish");
    storage.clear_all().unwrap();
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    for table in [
        "results",
        "a2ui_surfaces",
        "a2ui_events",
        "document_versions",
        "sessions",
        "scene_tool_bindings",
        "scene_tool_instances",
        "scene_template_policies",
    ] {
        let count: i64 = db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}

#[test]
fn invalid_creation_is_rejected_before_any_tool_is_created() {
    let (_dir, storage) = setup();
    for (id, title, items) in [
        ("unknown", "标题", vec!["项目".into()]),
        ("publish", "", vec!["项目".into()]),
        ("publish", "标题", vec![]),
        ("tasks", "标题", vec!["项目".into(); 6]),
        ("review", "标题", vec!["字".repeat(25)]),
    ] {
        assert!(app::create(
            &storage,
            app::CreateSceneTool {
                template_id: id.into(),
                title: title.into(),
                items,
                locale: "zh-CN".into()
            }
        )
        .is_err());
    }
    assert!(result::list(&storage, None, true).unwrap().is_empty());
}

#[test]
fn scene_ipc_contract_matches_frontend_fixture() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../contracts/v2x/scene-tool.json")).unwrap();
    let input: app::CreateSceneTool = serde_json::from_value(fixture["create"].clone()).unwrap();
    let (dir, storage) = setup();
    let view = bound(&storage, dir.path(), input).unwrap();
    let encoded = serde_json::to_value(&view).unwrap();
    for key in fixture["outputs"].as_array().unwrap() {
        assert!(encoded.get(key.as_str().unwrap()).is_some());
    }
    let mut save = fixture["save"].clone();
    save["resultId"] = json!(view.result.summary.id);
    save["baseHash"] = json!(view.state_hash);
    let saved = app::save(&storage, serde_json::from_value(save.clone()).unwrap()).unwrap();
    assert_eq!(saved.surface.data["subject"], "星河 420");
    save["path"] = json!("C:/outside.txt");
    assert!(serde_json::from_value::<app::SaveSceneTool>(save).is_err());
}
