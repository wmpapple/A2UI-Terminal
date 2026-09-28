use a2ui_terminal_lib::{
    ai::{
        self, ChatRequest, ConfirmContextManifestInput, ContextCandidate, ContextIndex,
        ContextManifestInput, ContextSourceKind,
    },
    application::{citation, context, generation, import, knowledge, result, review},
    domain::{
        citation::CitationQuery,
        import::ConfirmImportInput,
        result::{
            CreateTextResultInput, RestoreResultRevisionInput, ResultType, SaveResultDocumentInput,
            TextResultFormat,
        },
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision},
    },
    parser::{self, Locator},
    repository::citation as repo,
    storage::Storage,
};
use std::{collections::HashMap, fs, path::Path, sync::atomic::AtomicBool};

fn import_source(storage: &Storage, root: &Path, path: &Path) -> String {
    let batch = import::inspect_paths(vec![path.into()], None).unwrap();
    knowledge::confirm(
        storage,
        root,
        &batch,
        ConfirmImportInput {
            batch_id: batch.batch.id.clone(),
            accepted_item_ids: vec![batch.batch.items[0].id.clone()],
            confirmed: true,
        },
    )
    .unwrap()[0]
        .id
        .clone()
}
fn plan(
    storage: &Storage,
    workspace: &str,
    source: &str,
    personal: bool,
) -> (ChatRequest, ai::ConfirmedContextManifest) {
    let session = uuid::Uuid::new_v4().to_string();
    storage
        .create_session(workspace, &session, "Citation test")
        .unwrap();
    let mut pending = HashMap::new();
    let manifest = context::plan(
        storage,
        &mut ContextIndex::default(),
        &mut pending,
        ContextManifestInput {
            workspace_id: workspace.into(),
            session_id: session.clone(),
            provider_id: "openai".into(),
            prompt: "Summarize 420".into(),
            candidates: vec![ContextCandidate {
                kind: if personal {
                    ContextSourceKind::PersonalKnowledge
                } else {
                    ContextSourceKind::AttachedDocument
                },
                label: "Evidence".into(),
                selected: true,
                source_id: Some(source.into()),
                content: None,
                base_hash: None,
            }],
            include_recent_messages: false,
            recent_message_count: 0,
            context_pack_ids: vec![],
        },
    )
    .unwrap();
    assert!(!manifest.citations.is_empty());
    context::confirm(
        &mut pending,
        ConfirmContextManifestInput {
            manifest_id: manifest.id.clone(),
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
        prompt: "Summarize 420".into(),
        context_manifest_id: manifest.id,
        review_source: None,
        explanation_only: false,
    };
    let confirmed = ai::consume_context_manifest(storage, &mut pending, &request).unwrap();
    (request, confirmed)
}

#[test]
fn citation_result_lifecycle_survives_restart_session_delete_copy_edit_restore_and_source_delete() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test.db");
    let storage = Storage::open(&db).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let source = dir.path().join("facts.md");
    fs::write(&source, "项目：星河\n预算：420 元\n状态：尚未批准").unwrap();
    let id = import_source(&storage, &root, &source);
    let before = result::create_text(
        &storage,
        &managed,
        CreateTextResultInput {
            title: "Report".into(),
            file_name: "report.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let workspace = &before.result.summary.workspace_id;
    let (request, manifest) = plan(&storage, workspace, &id, true);
    assert!(manifest.sources[0].content.contains("[S1]"));
    let output = generation::finish(
        &storage,
        &managed,
        &generation::GenerationTarget::Result(Box::new(before)),
        "预算 420 元 [S1]。伪造引用 [S999]。",
        &AtomicBool::new(false),
    )
    .unwrap();
    repo::bind_review(&storage, &output.review.id, &request.request_id).unwrap();
    review::decide(
        &storage,
        DecideReviewBlocksInput {
            workspace_id: output.review.workspace_id.clone(),
            review_id: output.review.id.clone(),
            decisions: output
                .review
                .blocks
                .iter()
                .map(|b| ReviewBlockDecision {
                    block_id: b.id.clone(),
                    accepted: true,
                    file_name: None,
                })
                .collect(),
        },
    )
    .unwrap();
    let applied = review::apply(
        &storage,
        &managed,
        ApplyReviewInput {
            workspace_id: output.review.workspace_id.clone(),
            review_id: output.review.id,
        },
    )
    .unwrap()
    .result
    .unwrap();
    let query = CitationQuery {
        owner_kind: "result".into(),
        owner_id: applied.result.summary.id.clone(),
    };
    let refs = citation::list(&storage, &managed, &query).unwrap();
    assert_eq!(refs[0].status, "verified");
    assert_eq!(refs[1].status, "unknown");
    assert!(refs[0].excerpt.as_ref().unwrap().contains("尚未批准"));
    let notes = citation::export_notes(&storage, &managed, &applied).unwrap();
    assert!(notes.contains("facts.md"));
    assert!(notes.contains("第 1–3 行"));
    assert!(!notes.contains(&request.request_id));
    assert!(!notes.contains(dir.path().to_str().unwrap()));
    storage
        .delete_chat_session(&request.workspace_id, &request.session_id)
        .unwrap();
    drop(storage);
    let storage = Storage::open(&db).unwrap();
    assert_eq!(
        citation::list(&storage, &managed, &query).unwrap()[0].status,
        "verified"
    );
    let copy = result::duplicate(&storage, &managed, &query.owner_id).unwrap();
    assert_eq!(
        citation::list(
            &storage,
            &managed,
            &CitationQuery {
                owner_kind: "result".into(),
                owner_id: copy.result.summary.id
            }
        )
        .unwrap()[0]
            .status,
        "verified"
    );
    let edited = result::save_document(
        &storage,
        &managed,
        SaveResultDocumentInput {
            result_id: query.owner_id.clone(),
            base_hash: applied.content_hash,
            content: "预算 999 元 [S1] [S999]".into(),
        },
    )
    .unwrap();
    let refs = citation::list(&storage, &managed, &query).unwrap();
    assert_eq!(refs[0].status, "stale");
    assert_eq!(refs[1].status, "unknown");
    assert!(refs[0].excerpt.is_none());
    result::restore_revision(
        &storage,
        &managed,
        RestoreResultRevisionInput {
            result_id: query.owner_id.clone(),
            revision_id: applied.result.summary.current_revision_id.unwrap(),
            base_hash: edited.content_hash,
        },
    )
    .unwrap();
    assert_eq!(
        citation::list(&storage, &managed, &query).unwrap()[0].status,
        "verified"
    );
    knowledge::delete(&storage, &root, &id).unwrap();
    let refs = citation::list(&storage, &managed, &query).unwrap();
    assert_eq!(refs[0].status, "unavailable");
    assert!(refs[0].excerpt.is_none());
    assert!(
        repo::fragment(&storage, &manifest.view.citations[0].fragment_id)
            .unwrap()
            .is_none()
    );
    assert!(source.exists());
}

#[test]
fn workspace_file_results_keep_full_generation_citations() {
    use a2ui_terminal_lib::workspace;
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let work = dir.path().join("work");
    fs::create_dir(&work).unwrap();
    fs::write(work.join("report.md"), "Old draft").unwrap();
    let workspace = workspace::register_workspace(&storage, &work).unwrap();
    let file = workspace::read_file(&storage, &workspace.id, "report.md").unwrap();
    let detail = result::ensure_file_result(&storage, &workspace.id, &file).unwrap();
    let document = result::read_document(&storage, &managed, &detail.summary.id).unwrap();
    let source = dir.path().join("evidence.txt");
    fs::write(&source, "Budget 420").unwrap();
    let source_id = import_source(&storage, &knowledge::root(&managed).unwrap(), &source);
    let (request, _) = plan(&storage, &workspace.id, &source_id, true);
    let output = generation::finish(
        &storage,
        &managed,
        &generation::GenerationTarget::Result(Box::new(document)),
        "Budget 420 [S1]",
        &AtomicBool::new(false),
    )
    .unwrap();
    repo::bind_review(&storage, &output.review.id, &request.request_id).unwrap();
    review::decide(
        &storage,
        DecideReviewBlocksInput {
            workspace_id: workspace.id.clone(),
            review_id: output.review.id.clone(),
            decisions: output
                .review
                .blocks
                .iter()
                .map(|b| ReviewBlockDecision {
                    block_id: b.id.clone(),
                    accepted: true,
                    file_name: None,
                })
                .collect(),
        },
    )
    .unwrap();
    review::apply(
        &storage,
        &managed,
        ApplyReviewInput {
            workspace_id: workspace.id,
            review_id: output.review.id,
        },
    )
    .unwrap();
    let refs = citation::list(
        &storage,
        &managed,
        &CitationQuery {
            owner_kind: "result".into(),
            owner_id: detail.summary.id,
        },
    )
    .unwrap();
    assert_eq!(refs[0].status, "verified");
    assert_eq!(
        fs::read_to_string(work.join("report.md")).unwrap(),
        "Budget 420 [S1]"
    );
}

#[test]
fn source_change_revocation_and_cross_workspace_never_verify() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    storage.create_standalone_workspace("one", "One").unwrap();
    storage.create_standalone_workspace("two", "Two").unwrap();
    let path = dir.path().join("source.txt");
    fs::write(&path, "budget 420").unwrap();
    storage
        .attach_workspace_file("one", "source", path.to_str().unwrap(), "source.txt")
        .unwrap();
    let (request, _) = plan(&storage, "one", "source", false);
    repo::bind_output(
        &storage,
        "result",
        "owner",
        &parser::hash(b"[S1]"),
        None,
        &request.request_id,
    )
    .unwrap();
    let inspect = |workspace| {
        citation::views(&storage, &managed, "result", "owner", "[S1]", workspace).unwrap()
    };
    assert_eq!(inspect("one")[0].status, "verified");
    assert_eq!(inspect("two")[0].status, "unauthorized");
    fs::write(&path, "budget 999").unwrap();
    assert_eq!(inspect("one")[0].status, "stale");
    storage.revoke_workspace_file("one", "source").unwrap();
    assert_eq!(inspect("one")[0].status, "unauthorized");
    repo::register_request(&storage, "other-request", "other-manifest", "one", &[]).unwrap();
    repo::bind_output(
        &storage,
        "result",
        "other-owner",
        &parser::hash(b"[S1]"),
        None,
        "other-request",
    )
    .unwrap();
    assert_eq!(
        citation::views(&storage, &managed, "result", "other-owner", "[S1]", "one").unwrap()[0]
            .status,
        "unknown"
    );
}

#[test]
fn identical_text_keeps_immutable_request_bindings_per_revision() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    storage
        .upsert_workspace("revision-workspace", "Revisions", "C:\\revisions")
        .unwrap();
    for request in ["request-a", "request-b"] {
        repo::register_request(&storage, request, request, "revision-workspace", &[]).unwrap();
    }
    let hash = parser::hash(b"same [S1]");
    repo::bind_output(
        &storage,
        "result",
        "owner",
        &hash,
        Some("revision-a"),
        "request-a",
    )
    .unwrap();
    repo::bind_output(
        &storage,
        "result",
        "owner",
        &hash,
        Some("revision-b"),
        "request-b",
    )
    .unwrap();
    repo::bind_output(
        &storage,
        "result",
        "owner",
        &hash,
        Some("revision-a"),
        "request-b",
    )
    .unwrap();
    for (revision, request) in [("revision-a", "request-a"), ("revision-b", "request-b")] {
        assert_eq!(
            repo::output_request_for_revision(&storage, "result", "owner", &hash, Some(revision))
                .unwrap()
                .as_deref(),
            Some(request)
        );
    }
    assert!(repo::output_request(&storage, "result", "owner", &hash)
        .unwrap()
        .is_none());
    assert!(repo::output_request_for_revision(
        &storage,
        "result",
        "owner",
        &hash,
        Some("unknown-revision")
    )
    .unwrap()
    .is_none());
}

#[test]
fn selected_budget_ranges_and_duplicate_text_keep_exact_locations() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.db")).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let content = (0..40).map(|_| "same").collect::<Vec<_>>().join("\n");
    let path = dir.path().join("same.txt");
    fs::write(&path, &content).unwrap();
    let id = import_source(&storage, &root, &path);
    let mut sources = vec![ai::ContextSource {
        kind: ContextSourceKind::PersonalKnowledge,
        label: "same".into(),
        content: content.chars().skip(100).collect(),
        base_hash: None,
    }];
    let included = vec![ai::ContextManifestSource {
        kind: "personal_knowledge".into(),
        label: "same".into(),
        source_ref: Some(id),
        content_hash: Some(parser::hash(content.as_bytes())),
        size_bytes: content.len() as u64,
        character_count: 99,
        mode: ai::ContextSourceMode::Retrieved,
        selected_ranges: vec![ai::ContextChunkRange {
            chunk_id: "second".into(),
            start_character: 100,
            end_character: 199,
        }],
        exclusion_reason: None,
    }];
    let refs = citation::decorate(&storage, "workspace", &mut sources, &included).unwrap();
    assert_eq!(refs.len(), 1);
    assert!(matches!(
        refs[0].locator,
        Locator::Lines {
            start_line: 21,
            end_line: 40
        }
    ));
    assert_eq!(sources[0].content.matches("[S1]").count(), 1);
    sources[0].content = "forged draft".into();
    assert!(
        citation::decorate(&storage, "workspace", &mut sources, &included)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn six_formats_have_real_structural_locations() {
    use std::io::Write;
    for format in ["md", "txt"] {
        let p = parser::parse_located_bytes(
            Path::new(&format!("test.{format}")),
            "a\r\n🙂\n".as_bytes(),
        )
        .unwrap();
        assert_eq!(p.text(), "a\r\n🙂\n");
        assert!(matches!(
            p.blocks[0].locator,
            Locator::Lines {
                start_line: 1,
                end_line: 3
            }
        ));
    }
    let csv = parser::parse_located_bytes(Path::new("t.csv"), b"name,value\nA,420").unwrap();
    assert!(matches!(
        csv.blocks[1].locator,
        Locator::TableRange {
            start_row: 2,
            end_column: 2,
            ..
        }
    ));
    let mut workbook = rust_xlsxwriter::Workbook::new();
    workbook
        .add_worksheet()
        .set_name("Budget")
        .unwrap()
        .write_string(0, 0, "420")
        .unwrap();
    let xlsx =
        parser::parse_located_bytes(Path::new("t.xlsx"), &workbook.save_to_buffer().unwrap())
            .unwrap();
    assert!(matches!(&xlsx.blocks[0].locator,Locator::TableRange{sheet,..} if sheet=="Budget"));
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zip.start_file(
        "word/document.xml",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>"#).unwrap();
    let docx =
        parser::parse_located_bytes(Path::new("t.docx"), &zip.finish().unwrap().into_inner())
            .unwrap();
    assert_eq!(docx.blocks[1].text, "Second");
    assert!(matches!(
        docx.blocks[1].locator,
        Locator::Paragraph { paragraph: 2 }
    ));
    let (pdf, p1, l1) =
        printpdf::PdfDocument::new("Source", printpdf::Mm(210.), printpdf::Mm(297.), "Text");
    let font = pdf
        .add_builtin_font(printpdf::BuiltinFont::Helvetica)
        .unwrap();
    pdf.get_page(p1).get_layer(l1).use_text(
        "PAGE ONE",
        12.,
        printpdf::Mm(20.),
        printpdf::Mm(250.),
        &font,
    );
    let (p2, l2) = pdf.add_page(printpdf::Mm(210.), printpdf::Mm(297.), "Two");
    pdf.get_page(p2).get_layer(l2).use_text(
        "PAGE TWO",
        12.,
        printpdf::Mm(20.),
        printpdf::Mm(250.),
        &font,
    );
    let parsed =
        parser::parse_located_bytes(Path::new("t.pdf"), &pdf.save_to_bytes().unwrap()).unwrap();
    assert_eq!(parsed.blocks.len(), 2);
    assert!(parsed.blocks[1].text.contains("PAGE TWO"));
    assert!(matches!(
        parsed.blocks[1].locator,
        Locator::Page { page: 2 }
    ));
}

#[test]
fn reordered_xlsx_relationships_keep_names_with_the_actual_sheet_content() {
    use std::io::{Cursor, Read, Write};
    let mut workbook = rust_xlsxwriter::Workbook::new();
    workbook
        .add_worksheet()
        .set_name("Budget")
        .unwrap()
        .write_string(0, 0, "420")
        .unwrap();
    workbook
        .add_worksheet()
        .set_name("Owner")
        .unwrap()
        .write_string(0, 0, "Lin")
        .unwrap();
    let bytes = workbook.save_to_buffer().unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut output = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        if entry.name() == "xl/workbook.xml" {
            let text = String::from_utf8(bytes).unwrap();
            bytes = text
                .replace("r:id=\"rId1\"", "r:id=\"TEMP\"")
                .replace("r:id=\"rId2\"", "r:id=\"rId1\"")
                .replace("r:id=\"TEMP\"", "r:id=\"rId2\"")
                .into_bytes();
        }
        output
            .start_file(entry.name(), zip::write::SimpleFileOptions::default())
            .unwrap();
        output.write_all(&bytes).unwrap();
    }
    let parsed = parser::parse_located_bytes(
        Path::new("reordered.xlsx"),
        &output.finish().unwrap().into_inner(),
    )
    .unwrap();
    let budget = parsed.blocks.iter().find(|b| b.text == "420").unwrap();
    assert!(matches!(&budget.locator, Locator::TableRange{sheet,..} if sheet == "Owner"));
    let owner = parsed.blocks.iter().find(|b| b.text == "Lin").unwrap();
    assert!(matches!(&owner.locator, Locator::TableRange{sheet,..} if sheet == "Budget"));
}

#[test]
fn old_sources_upgrade_in_resumable_steps_and_failure_preserves_the_copy() {
    use a2ui_terminal_lib::application::locator_upgrade;
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("upgrade.db");
    let storage = Storage::open(&db).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let a = dir.path().join("a.txt");
    let b = dir.path().join("b.txt");
    fs::write(&a, "First").unwrap();
    fs::write(&b, "Second").unwrap();
    let first = import_source(&storage, &root, &a);
    let second = import_source(&storage, &root, &b);
    let connection = rusqlite::Connection::open(&db).unwrap();
    connection
        .execute(
            "UPDATE personal_knowledge SET parser_version='local-v1'",
            [],
        )
        .unwrap();
    drop(connection);
    let progress = locator_upgrade::step(&storage, &managed, false, false).unwrap();
    assert_eq!(progress.pending, 2);
    let progress = locator_upgrade::step(&storage, &managed, true, false).unwrap();
    assert_eq!(progress.pending, 1);
    assert_eq!(progress.completed, 1);
    drop(storage);
    let storage = Storage::open(&db).unwrap();
    assert_eq!(
        knowledge::get(&storage, &first)
            .unwrap()
            .source
            .parser_version,
        parser::LOCATED_PARSER_VERSION
    );
    let managed_copy = root.join(format!("{second}.txt"));
    fs::write(&managed_copy, "external tamper").unwrap();
    let progress = locator_upgrade::step(&storage, &managed, true, false).unwrap();
    assert_eq!(progress.failed, 1);
    assert_eq!(progress.pending, 0);
    assert!(managed_copy.exists());
    assert_eq!(fs::read_to_string(&b).unwrap(), "Second");
    fs::write(&managed_copy, "Second").unwrap();
    let progress = locator_upgrade::step(&storage, &managed, true, true).unwrap();
    assert_eq!(progress.completed, 2);
    assert_eq!(progress.failed, 0);
}

#[tokio::test]
async fn real_local_sse_generation_binds_only_this_requests_approved_evidence() {
    use a2ui_terminal_lib::{repository::provider::ProviderRepository, state::AppState};
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("sse.db")).unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let root = knowledge::root(&managed).unwrap();
    let file = dir.path().join("evidence.txt");
    fs::write(&file, "Budget 420; not approved").unwrap();
    let source_id = import_source(&storage, &root, &file);
    let target = result::create_text(
        &storage,
        &managed,
        CreateTextResultInput {
            title: "Report".into(),
            file_name: "report.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let state = AppState::new(storage, managed);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let n = socket.read(&mut chunk).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let body = String::from_utf8_lossy(&bytes);
        assert!(body.contains("[S1]"));
        assert!(body.contains("Budget 420; not approved"));
        let payload: serde_json::Value =
            serde_json::from_str(body.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert!(
            !payload["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap()
                .contains("[S2]")
        );
        let body="data: {\"choices\":[{\"delta\":{\"content\":\"Budget 420; not approved [S1]. Unknown [S99].\"}}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let mut provider = ProviderRepository::new(&state.storage)
        .find("openai")
        .unwrap()
        .unwrap();
    provider.endpoint = format!("http://{address}/v1");
    provider.proxy_url = None;
    ProviderRepository::new(&state.storage)
        .save(&provider)
        .unwrap();
    let plan = generation::plan(
        &state,
        generation::PlanGenerationInput {
            result_id: Some(target.result.summary.id),
            task_id: None,
            provider_id: "openai".into(),
            prompt: "Summarize".into(),
            include_result: false,
            knowledge_ids: vec![source_id],
            document_source_ids: vec![],
            context_pack_ids: vec![],
        },
    )
    .unwrap();
    ai::confirm_context_manifest(
        &mut state.pending_context_manifests.lock().unwrap(),
        ConfirmContextManifestInput {
            manifest_id: plan.id.clone(),
            sensitive_cloud_confirmed: true,
        },
    )
    .unwrap();
    let output = generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| Ok(zeroize::Zeroizing::new(String::new())),
    )
    .await
    .unwrap();
    server.join().unwrap();
    review::decide(
        &state.storage,
        DecideReviewBlocksInput {
            workspace_id: output.review.workspace_id.clone(),
            review_id: output.review.id.clone(),
            decisions: output
                .review
                .blocks
                .iter()
                .map(|b| ReviewBlockDecision {
                    block_id: b.id.clone(),
                    accepted: true,
                    file_name: None,
                })
                .collect(),
        },
    )
    .unwrap();
    let result = review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: output.review.workspace_id,
            review_id: output.review.id,
        },
    )
    .unwrap()
    .result
    .unwrap();
    let refs = citation::list(
        &state.storage,
        &state.managed_results_dir,
        &CitationQuery {
            owner_kind: "result".into(),
            owner_id: result.result.summary.id,
        },
    )
    .unwrap();
    assert_eq!(refs[0].status, "verified");
    assert_eq!(refs[1].status, "unknown");
}
