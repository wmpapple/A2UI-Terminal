use a2ui_terminal_lib::{
    ai::{
        self, ChatRequest, ConfirmContextManifestInput, ContextCandidate, ContextIndex,
        ContextManifestInput, ContextSourceKind,
    },
    application::{import, knowledge, result, search},
    domain::{
        import::ConfirmImportInput,
        knowledge::{EditKnowledgeInput, ListKnowledgeInput},
    },
    repository::knowledge as repo,
    storage::Storage,
};
use std::{collections::HashMap, fs, path::Path};

fn import_file(storage: &Storage, root: &Path, file: &Path) -> String {
    let pending = import::inspect_paths(vec![file.to_path_buf()], None).unwrap();
    let input = ConfirmImportInput {
        batch_id: pending.batch.id.clone(),
        accepted_item_ids: vec![pending.batch.items[0].id.clone()],
        confirmed: true,
    };
    knowledge::confirm(storage, root, &pending, input).unwrap()[0]
        .id
        .clone()
}

#[test]
fn library_pack_references_survive_restart_and_clean_up_without_deleting_sources() {
    use a2ui_terminal_lib::{
        application::context_pack, domain::context_pack::CreateContextPackInput,
    };
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let db = dir.path().join("packs.sqlite3");
    let storage = Storage::open(&db).unwrap();
    storage.create_standalone_workspace("one", "One").unwrap();
    storage.create_standalone_workspace("two", "Two").unwrap();
    let file = dir.path().join("evidence.txt");
    fs::write(&file, "Library evidence 420").unwrap();
    let id = import_file(&storage, &root, &file);
    storage
        .attach_workspace_file(
            "one",
            "workspace-source",
            file.to_str().unwrap(),
            "evidence.txt",
        )
        .unwrap();
    let create = |workspace: &str, name: &str, ids: Vec<String>| CreateContextPackInput {
        workspace_id: workspace.into(),
        name: name.into(),
        source_ids: ids,
    };
    let pack = context_pack::create(
        &storage,
        create("one", "Mixed", vec!["workspace-source".into(), id.clone()]),
    )
    .unwrap();
    assert!(!pack.items[0].personal_knowledge);
    assert!(pack.items[1].personal_knowledge);
    assert!(context_pack::create(
        &storage,
        create(
            "two",
            "Forbidden",
            vec!["workspace-source".into(), id.clone()]
        )
    )
    .is_err());
    let second =
        context_pack::create(&storage, create("two", "Reusable", vec![id.clone()])).unwrap();
    context_pack::delete(&storage, "two", &second.id).unwrap();
    assert!(knowledge::get(&storage, &id).is_ok());
    assert!(file.exists());
    drop(storage);
    let storage = Storage::open(&db).unwrap();
    knowledge::edit(
        &storage,
        EditKnowledgeInput {
            id: id.clone(),
            title: "Updated title".into(),
            tags: vec![],
        },
    )
    .unwrap();
    assert_eq!(
        context_pack::list(&storage, "one").unwrap()[0].items[1].label,
        "Updated title"
    );
    storage
        .revoke_workspace_file("one", "workspace-source")
        .unwrap();
    assert_eq!(
        context_pack::list(&storage, "one").unwrap()[0].items.len(),
        1
    );
    let session = uuid::Uuid::new_v4().to_string();
    storage.create_session("one", &session, "Test").unwrap();
    let input = ContextManifestInput {
        workspace_id: "one".into(),
        session_id: session,
        provider_id: "openai".into(),
        prompt: "summarize".into(),
        candidates: vec![],
        context_pack_ids: vec![pack.id.clone()],
        include_recent_messages: false,
        recent_message_count: 0,
    };
    let expanded = context_pack::expand_manifest_input(&storage, input.clone()).unwrap();
    let manifest =
        ai::plan_context_manifest(&storage, &mut ContextIndex::default(), expanded).unwrap();
    assert_eq!(manifest.view.included_sources.len(), 1);
    assert_eq!(manifest.view.included_sources[0].label, "Updated title");
    assert!(manifest.view.included_sources[0].character_count > 0);
    let mut direct = input.clone();
    direct.candidates.push(ContextCandidate {
        kind: ContextSourceKind::PersonalKnowledge,
        label: "forged".into(),
        selected: true,
        source_id: Some(id.clone()),
        content: Some("forged".into()),
        base_hash: None,
    });
    assert_eq!(
        context_pack::expand_manifest_input(&storage, direct)
            .unwrap()
            .candidates
            .len(),
        1
    );
    knowledge::delete(&storage, &root, &id).unwrap();
    assert!(context_pack::list(&storage, "one").unwrap().is_empty());
    assert!(context_pack::expand_manifest_input(&storage, input).is_err());
    assert!(context_pack::create(&storage, create("one", "Stale", vec![id])).is_err());
    assert!(file.exists());
}

#[test]
fn imports_all_six_formats_and_rejects_invalid_or_oversized_sources() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    fs::write(dir.path().join("source.txt"), "Plain evidence 420").unwrap();
    fs::write(dir.path().join("source.md"), "# Markdown evidence 420").unwrap();
    fs::write(
        dir.path().join("source.csv"),
        "Name,Value\nEvidence,420\nFormula,=1+2\n",
    )
    .unwrap();
    let mut workbook = rust_xlsxwriter::Workbook::new();
    workbook
        .add_worksheet()
        .write_string(0, 0, "Spreadsheet evidence 420")
        .unwrap();
    workbook.save(dir.path().join("source.xlsx")).unwrap();
    let mut zip = zip::ZipWriter::new(fs::File::create(dir.path().join("source.docx")).unwrap());
    zip.start_file(
        "word/document.xml",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    std::io::Write::write_all(
        &mut zip,
        b"<w:document><w:p><w:r><w:t>Document evidence 420</w:t></w:r></w:p></w:document>",
    )
    .unwrap();
    zip.finish().unwrap();
    let (pdf, page, layer) =
        printpdf::PdfDocument::new("Source", printpdf::Mm(210.0), printpdf::Mm(297.0), "Text");
    let font = pdf
        .add_builtin_font(printpdf::BuiltinFont::Helvetica)
        .unwrap();
    pdf.get_page(page).get_layer(layer).use_text(
        "PDF evidence 420",
        12.0,
        printpdf::Mm(20.0),
        printpdf::Mm(250.0),
        &font,
    );
    fs::write(dir.path().join("source.pdf"), pdf.save_to_bytes().unwrap()).unwrap();
    for format in ["txt", "md", "csv", "xlsx", "docx", "pdf"] {
        let id = import_file(
            &storage,
            &root,
            &dir.path().join(format!("source.{format}")),
        );
        assert!(knowledge::get(&storage, &id)
            .unwrap()
            .parsed
            .text()
            .contains("420"));
        let bad = dir.path().join(format!("invalid.{format}"));
        fs::write(&bad, [255, 254, 0, 255]).unwrap();
        let pending = import::inspect_paths(vec![bad], None).unwrap();
        assert!(
            knowledge::confirm(
                &storage,
                &root,
                &pending,
                ConfirmImportInput {
                    batch_id: pending.batch.id.clone(),
                    accepted_item_ids: vec![pending.batch.items[0].id.clone()],
                    confirmed: true
                }
            )
            .is_err(),
            "accepted invalid {format}"
        );
    }
    let large = dir.path().join("large.txt");
    fs::write(&large, vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(
        !import::inspect_paths(vec![large], None)
            .unwrap()
            .batch
            .can_confirm
    );
    assert_eq!(repo::files(&storage).unwrap().len(), 6);
}

#[test]
fn failed_batch_compensates_copies_and_missing_copy_is_not_ready_after_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let first = dir.path().join("first.txt");
    let second = dir.path().join("second.txt");
    fs::write(&first, "first").unwrap();
    fs::write(&second, "second").unwrap();
    let pending = import::inspect_paths(vec![first.clone(), second.clone()], None).unwrap();
    fs::write(&second, "modified after inspect").unwrap();
    assert!(knowledge::confirm(
        &storage,
        &root,
        &pending,
        ConfirmImportInput {
            batch_id: pending.batch.id.clone(),
            accepted_item_ids: pending.batch.items.iter().map(|i| i.id.clone()).collect(),
            confirmed: true
        }
    )
    .is_err());
    assert!(repo::files(&storage).unwrap().is_empty());
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name() != ".operation-lock")
            .count(),
        0
    );
    let id = import_file(&storage, &root, &first);
    fs::write(root.join(format!("{id}.txt")), "tampered copy").unwrap();
    knowledge::reconcile(&storage, &root).unwrap();
    assert!(knowledge::get(&storage, &id).is_err());
    assert_eq!(
        knowledge::list(&storage, ListKnowledgeInput::default())
            .unwrap()
            .items[0]
            .status,
        "failed"
    );
}

#[test]
fn survives_restart_workspace_removal_and_original_move_but_delete_preserves_original() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let db = dir.path().join("database.sqlite3");
    let original = dir.path().join("notes.md");
    fs::write(&original, "# Launch\nApproved budget 420. 中文🙂").unwrap();
    let storage = Storage::open(&db).unwrap();
    storage
        .create_standalone_workspace("workspace-a", "A")
        .unwrap();
    let id = import_file(&storage, &root, &original);
    assert_eq!(id, import_file(&storage, &root, &original));
    storage.remove_workspace("workspace-a").unwrap();
    let moved = dir.path().join("moved.md");
    fs::rename(&original, &moved).unwrap();
    drop(storage);
    let storage = Storage::open(&db).unwrap();
    knowledge::reconcile(&storage, &root).unwrap();
    assert!(knowledge::get(&storage, &id)
        .unwrap()
        .parsed
        .text()
        .contains("420"));
    let found = search::search(
        &storage,
        &managed,
        &mut ContextIndex::default(),
        search::SearchAuthorizedContentInput {
            workspace_id: None,
            query: "420".into(),
            limit: Some(20),
        },
    )
    .unwrap();
    assert_eq!(found.items[0].id, id);
    knowledge::delete(&storage, &root, &id).unwrap();
    assert!(knowledge::get(&storage, &id).is_err());
    assert!(moved.exists());
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name() != ".operation-lock")
            .count(),
        0
    );
    let found = search::search(
        &storage,
        &managed,
        &mut ContextIndex::default(),
        search::SearchAuthorizedContentInput {
            workspace_id: None,
            query: "420".into(),
            limit: Some(20),
        },
    )
    .unwrap();
    assert!(found.items.is_empty());
}

#[test]
fn cancel_changed_source_and_foreign_item_publish_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let file = dir.path().join("notes.txt");
    fs::write(&file, "before").unwrap();
    let pending = import::inspect_paths(vec![file.clone()], None).unwrap();
    knowledge::confirm(
        &storage,
        &root,
        &pending,
        ConfirmImportInput {
            batch_id: pending.batch.id.clone(),
            accepted_item_ids: vec![],
            confirmed: false,
        },
    )
    .unwrap();
    assert!(repo::files(&storage).unwrap().is_empty());
    fs::write(&file, "changed").unwrap();
    assert!(knowledge::confirm(
        &storage,
        &root,
        &pending,
        ConfirmImportInput {
            batch_id: pending.batch.id.clone(),
            accepted_item_ids: vec![pending.batch.items[0].id.clone()],
            confirmed: true
        }
    )
    .is_err());
    assert!(knowledge::confirm(
        &storage,
        &root,
        &pending,
        ConfirmImportInput {
            batch_id: pending.batch.id.clone(),
            accepted_item_ids: vec!["foreign".into()],
            confirmed: true
        }
    )
    .is_err());
    assert!(repo::files(&storage).unwrap().is_empty());
    assert_eq!(
        fs::read_dir(&root)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name() != ".operation-lock")
            .count(),
        0
    );
}

#[test]
fn stable_pagination_metadata_and_recovery_keep_unrelated_files() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let file = dir.path().join("notes.txt");
    let mut ids = vec![];
    for n in 0..3 {
        fs::write(&file, format!("Content {n}")).unwrap();
        ids.push(import_file(&storage, &root, &file));
    }
    let first = knowledge::list(
        &storage,
        ListKnowledgeInput {
            limit: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(first.items.len(), 2);
    knowledge::edit(
        &storage,
        EditKnowledgeInput {
            id: ids[0].clone(),
            title: "Renamed".into(),
            tags: vec!["release".into()],
        },
    )
    .unwrap();
    let second = knowledge::list(
        &storage,
        ListKnowledgeInput {
            after: first.next_cursor,
            limit: Some(2),
            query: None,
        },
    )
    .unwrap();
    assert_eq!(second.items[0].id, ids[2]);
    assert!(second.next_cursor.is_none());
    assert_eq!(
        knowledge::list(
            &storage,
            ListKnowledgeInput {
                query: Some("release".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .items[0]
            .id,
        ids[0]
    );
    let orphan = root.join(format!("{}.stage", uuid::Uuid::new_v4()));
    fs::write(&orphan, "partial").unwrap();
    let unrelated = root.join("keep.txt");
    fs::write(&unrelated, "not managed").unwrap();
    knowledge::reconcile(&storage, &root).unwrap();
    assert!(!orphan.exists());
    assert!(unrelated.exists());
    fs::remove_file(root.join(format!("{}.txt", ids[1]))).unwrap();
    knowledge::reconcile(&storage, &root).unwrap();
    assert!(knowledge::get(&storage, &ids[1]).is_err());
    knowledge::clear(&storage, &root).unwrap();
    storage.clear_all().unwrap();
    assert!(repo::files(&storage).unwrap().is_empty());
    assert!(file.exists());
    assert!(unrelated.exists());
}

#[test]
fn global_context_is_explicit_trusted_and_revocable_in_another_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let file = dir.path().join("trusted.txt");
    fs::write(&file, "Trusted local knowledge 420").unwrap();
    let id = import_file(&storage, &root, &file);
    for workspace in ["first", "second"] {
        storage
            .create_standalone_workspace(workspace, workspace)
            .unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        storage.create_session(workspace, &session, "Test").unwrap();
        let input = |selected| ContextManifestInput {
            workspace_id: workspace.into(),
            session_id: session.clone(),
            provider_id: "openai".into(),
            prompt: "summarize".into(),
            candidates: vec![ContextCandidate {
                kind: ContextSourceKind::PersonalKnowledge,
                label: "forged label".into(),
                source_id: Some(id.clone()),
                selected,
                content: Some("FORGED BODY".into()),
                base_hash: None,
            }],
            include_recent_messages: false,
            recent_message_count: 0,
            context_pack_ids: vec![],
        };
        let excluded =
            ai::plan_context_manifest(&storage, &mut ContextIndex::default(), input(false))
                .unwrap();
        assert!(excluded.view.included_sources.is_empty());
        let pending =
            ai::plan_context_manifest(&storage, &mut ContextIndex::default(), input(true)).unwrap();
        assert_eq!(pending.view.included_sources[0].label, "trusted.txt");
        let manifest_id = pending.view.id.clone();
        let mut manifests = HashMap::from([(manifest_id.clone(), pending)]);
        ai::confirm_context_manifest(
            &mut manifests,
            ConfirmContextManifestInput {
                manifest_id: manifest_id.clone(),
                sensitive_cloud_confirmed: true,
            },
        )
        .unwrap();
        let request = ChatRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            user_message_id: uuid::Uuid::new_v4().to_string(),
            assistant_message_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace.into(),
            session_id: session,
            provider_id: "openai".into(),
            prompt: "summarize".into(),
            context_manifest_id: manifest_id,
            review_source: None,
            explanation_only: false,
        };
        if workspace == "first" {
            let confirmed =
                ai::consume_context_manifest(&storage, &mut manifests, &request).unwrap();
            assert_eq!(confirmed.sources[0].content, "Trusted local knowledge 420");
        } else {
            knowledge::delete(&storage, &root, &id).unwrap();
            assert!(ai::consume_context_manifest(&storage, &mut manifests, &request).is_err());
        }
    }
}
