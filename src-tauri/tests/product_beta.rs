//! B0 integration: one database and real loopback transport across the writing workflow.
use a2ui_terminal_lib::{
    ai::{self, ConfirmContextManifestInput, ContextIndex},
    application::{
        citation, document, export, generation, import, inline_edit, knowledge, result, review,
        search, writing_profile,
    },
    domain::{
        citation::CitationQuery,
        document::{DocumentTarget, SelectionSnapshot},
        export::{ExportFormat, ExportResultInput},
        import::ConfirmImportInput,
        knowledge::ListKnowledgeInput,
        result::{
            CreateTextResultInput, RestoreResultRevisionInput, ResultDocument, ResultType,
            SaveResultDocumentInput, TextResultFormat,
        },
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision, ReviewRequest},
        writing_profile::{SaveWritingProfileInput, TerminologyRule, WritingProfileScope},
    },
    parser::{self, OffsetUnit},
    repository::{knowledge as knowledge_repo, provider::ProviderRepository},
    state::AppState,
    storage::Storage,
};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

struct Fixture {
    endpoint: String,
    requests: Arc<Mutex<Vec<serde_json::Value>>>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    fn new(answers: Vec<&str>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let stopped = stop.clone();
        let answers = answers.into_iter().map(str::to_string).collect::<Vec<_>>();
        let thread = std::thread::spawn(move || {
            for answer in answers {
                let deadline = Instant::now() + Duration::from_secs(20);
                let mut socket = loop {
                    if stopped.load(Ordering::SeqCst) {
                        return;
                    }
                    assert!(Instant::now() < deadline, "fixture request deadline");
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(10))
                        }
                        Err(e) => panic!("{e}"),
                    }
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut data = Vec::new();
                let mut chunk = [0; 8192];
                loop {
                    let n = socket.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    data.extend_from_slice(&chunk[..n]);
                    assert!(data.len() < 1_000_000);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        assert!(
                            !header.contains("authorization:"),
                            "fixtures must not receive credentials"
                        );
                        let length: usize = header
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if data.len() >= end + 4 + length {
                            captured.lock().unwrap().push(
                                serde_json::from_slice(&data[end + 4..end + 4 + length]).unwrap(),
                            );
                            break;
                        }
                    }
                }
                let delta = serde_json::json!({"choices":[{"delta":{"content":answer}}]});
                let body = format!("data: {delta}\n\ndata: [DONE]\n\n");
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        Self {
            endpoint,
            requests,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let outcome = thread.join();
            if !std::thread::panicking() {
                outcome.unwrap();
            }
        }
    }
}

fn import_text(storage: &Storage, managed: &Path, original: &Path, text: &str) -> String {
    fs::write(original, text).unwrap();
    let batch = import::inspect_paths(vec![original.into()], None).unwrap();
    knowledge::confirm(
        storage,
        &knowledge::root(managed).unwrap(),
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
fn accept(state: &AppState, proposal: &ReviewRequest) -> ResultDocument {
    review::decide(
        &state.storage,
        DecideReviewBlocksInput {
            workspace_id: proposal.workspace_id.clone(),
            review_id: proposal.id.clone(),
            decisions: proposal
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
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: proposal.workspace_id.clone(),
            review_id: proposal.id.clone(),
        },
    )
    .unwrap()
    .result
    .unwrap()
}
fn confirm(state: &AppState, id: &str) {
    ai::confirm_context_manifest(
        &mut state.pending_context_manifests.lock().unwrap(),
        ConfirmContextManifestInput {
            manifest_id: id.into(),
            sensitive_cloud_confirmed: true,
        },
    )
    .unwrap();
}
fn citations(state: &AppState, id: &str) -> Vec<a2ui_terminal_lib::domain::citation::CitationView> {
    citation::list(
        &state.storage,
        &state.managed_results_dir,
        &CitationQuery {
            owner_kind: "result".into(),
            owner_id: id.into(),
        },
    )
    .unwrap()
}

#[tokio::test]
async fn personal_writing_workflow_survives_inline_undo_restart_restore_and_export() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("beta.sqlite3");
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let state = AppState::new(Storage::open(&db).unwrap(), managed.clone());
    let source = import_text(
        &state.storage,
        &managed,
        &dir.path().join("facts.md"),
        "项目星河\n预算 420 元；尚未批准\n负责人小林；截止 2026-10-15",
    );
    let hidden = import_text(
        &state.storage,
        &managed,
        &dir.path().join("not-selected.md"),
        "UNSELECTED_SECRET_9273",
    );
    writing_profile::save(
        &state.storage,
        SaveWritingProfileInput {
            scope: WritingProfileScope::Global,
            workspace_id: None,
            enabled: true,
            rules: "先给结论，每段不超过三句".into(),
            terminology: vec![TerminologyRule {
                term: "AI".into(),
                preferred: "AI 助手".into(),
            }],
            forbidden_words: vec!["赋能".into()],
            example_knowledge_ids: vec![hidden],
        },
    )
    .unwrap();
    let target = result::create_text(
        &state.storage,
        &managed,
        CreateTextResultInput {
            title: "星河 Beta".into(),
            file_name: "beta.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let id = target.result.summary.id.clone();
    let generated = "# 星河\n\n预算 420 元，尚未批准 [S1]。\n\n负责人小林；截止 2026-10-15 [S1]。";
    let fixture = Fixture::new(vec![generated, "项目预算为 420 元，尚未批准 [S1]。"]);
    let mut config = ProviderRepository::new(&state.storage)
        .find("openai")
        .unwrap()
        .unwrap();
    config.endpoint = fixture.endpoint.clone();
    // Prove that a loopback request cannot be sent through a configured proxy.
    config.proxy_url = Some("http://127.0.0.1:9".into());
    ProviderRepository::new(&state.storage)
        .save(&config)
        .unwrap();
    let plan = generation::plan(
        &state,
        generation::PlanGenerationInput {
            result_id: Some(id.clone()),
            task_id: None,
            provider_id: "openai".into(),
            prompt: "总结并引用原文".into(),
            include_result: false,
            knowledge_ids: vec![source.clone()],
            document_source_ids: vec![],
            context_pack_ids: vec![],
        },
    )
    .unwrap();
    assert_eq!(plan.manifest.citations.len(), 1);
    confirm(&state, &plan.id);
    let generated_review = generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| Ok(zeroize::Zeroizing::new(String::new())),
    )
    .await
    .unwrap();
    assert_eq!(
        result::read_document(&state.storage, &managed, &id)
            .unwrap()
            .content,
        target.content
    );
    let applied = accept(&state, &generated_review.review);
    assert_eq!(applied.content, generated);
    assert_eq!(citations(&state, &id)[0].status, "verified");
    let snapshot = document::snapshot(
        &state.storage,
        &managed,
        &DocumentTarget::Result {
            result_id: id.clone(),
        },
    )
    .unwrap();
    let selected = "预算 420 元，尚未批准 [S1]。";
    let start = snapshot.text.find(selected).unwrap();
    let inline = inline_edit::plan(
        &state,
        inline_edit::PlanInlineEditInput {
            selection: SelectionSnapshot {
                target: snapshot.target.clone(),
                revision_id: snapshot.revision_id.clone(),
                content_hash: snapshot.content_hash.clone(),
                start: snapshot.text[..start].encode_utf16().count(),
                end: snapshot.text[..start + selected.len()]
                    .encode_utf16()
                    .count(),
                offset_unit: OffsetUnit::Utf16,
                selected_text_hash: parser::hash(selected.as_bytes()),
            },
            provider_id: "openai".into(),
            action: inline_edit::InlineEditAction::Polish,
            custom_instruction: None,
        },
    )
    .unwrap();
    confirm(&state, &inline.id);
    let proposal = inline_edit::start_with_key_source(
        &state,
        &inline.id,
        |_| Ok(()),
        |_| Ok(zeroize::Zeroizing::new(String::new())),
    )
    .await
    .unwrap();
    let edited = accept(&state, &proposal.review);
    assert_eq!(
        edited.content,
        generated.replacen(selected, "项目预算为 420 元，尚未批准 [S1]。", 1)
    );
    assert_eq!(citations(&state, &id)[0].status, "stale");
    review::undo(
        &state.storage,
        &managed,
        ApplyReviewInput {
            workspace_id: proposal.review.workspace_id,
            review_id: proposal.review.id,
        },
    )
    .unwrap();
    assert_eq!(citations(&state, &id)[0].status, "verified");
    let requests = fixture.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 2);
    for request in &requests {
        let system = request["messages"][0]["content"].as_str().unwrap();
        assert!(system.contains("先给结论"));
        assert!(system.contains("AI 助手"));
        assert!(!request.to_string().contains("UNSELECTED_SECRET_9273"));
    }
    assert!(requests[0]["messages"][1]["content"]
        .as_str()
        .unwrap()
        .contains("截止 2026-10-15"));
    assert!(!requests[1]["messages"][1]["content"]
        .as_str()
        .unwrap()
        .contains("截止 2026-10-15"));
    drop(state);
    let state = AppState::new(Storage::open(&db).unwrap(), managed.clone());
    assert_eq!(citations(&state, &id)[0].status, "verified");
    let current = result::read_document(&state.storage, &managed, &id).unwrap();
    let changed = result::save_document(
        &state.storage,
        &managed,
        SaveResultDocumentInput {
            result_id: id.clone(),
            content: format!("{}\n手工修改", current.content),
            base_hash: current.content_hash,
        },
    )
    .unwrap();
    let restored = result::restore_revision(
        &state.storage,
        &managed,
        RestoreResultRevisionInput {
            result_id: id.clone(),
            revision_id: applied.result.summary.current_revision_id.unwrap(),
            base_hash: changed.content_hash,
        },
    )
    .unwrap();
    assert_eq!(citations(&state, &id)[0].status, "verified");
    let copy = result::duplicate(&state.storage, &managed, &id).unwrap();
    assert_eq!(
        citations(&state, &copy.result.summary.id)[0].status,
        "verified"
    );
    let prepared = export::prepare(
        &state.storage,
        &managed,
        &ExportResultInput {
            export_id: uuid::Uuid::new_v4().to_string(),
            result_id: id.clone(),
            revision_id: restored.result.summary.current_revision_id.unwrap(),
            format: ExportFormat::Docx,
        },
    )
    .unwrap();
    assert!(prepared.content.contains("来源已核验"));
    for format in [
        ExportFormat::Markdown,
        ExportFormat::Docx,
        ExportFormat::Pdf,
    ] {
        let bytes = export::generate(
            ResultType::Document,
            TextResultFormat::Markdown,
            "星河",
            &prepared.content,
            format,
        )
        .unwrap();
        let extension = match format {
            ExportFormat::Markdown => "md",
            ExportFormat::Docx => "docx",
            _ => "pdf",
        };
        let exported = parser::parse_bytes(Path::new(&format!("export.{extension}")), &bytes)
            .unwrap()
            .text();
        assert!(exported.contains("420"));
        assert!(exported.contains("facts.md"));
        assert!(exported.contains("来源"));
        assert!(!exported.contains(dir.path().to_str().unwrap()));
    }
    knowledge::delete(&state.storage, &knowledge::root(&managed).unwrap(), &source).unwrap();
    assert_eq!(citations(&state, &id)[0].status, "unavailable");
    assert!(dir.path().join("facts.md").exists());
    println!(
        "B0_REPORT {}",
        serde_json::json!({"kind":"workflow", "transport":"real_loopback_sse", "requests":2,"formats":["md","docx","pdf"],"credentialsRead":false,"passed":true})
    );
}

#[test]
fn hundred_source_local_baseline_is_paged_and_measured() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let storage = Storage::open(&dir.path().join("bench.sqlite3")).unwrap();
    for i in 0..100 {
        import_text(
            &storage,
            &managed,
            &dir.path().join(format!("sample-{i}.md")),
            &format!(
                "项目星河 {i}\n预算 {} 元，尚未批准\n{}",
                i + 420,
                "虚构的项目进展说明，用于本机性能验证。\n".repeat(30)
            ),
        );
    }
    let page = knowledge_repo::list(
        &storage,
        ListKnowledgeInput {
            limit: Some(40),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.items.len(), 40);
    assert!(page.next_cursor.is_some());
    let mut index = ContextIndex::default();
    let mut times = Vec::new();
    for _ in 0..21 {
        let start = Instant::now();
        let hits = search::search(
            &storage,
            &managed,
            &mut index,
            search::SearchAuthorizedContentInput {
                workspace_id: None,
                query: "星河 420".into(),
                limit: Some(20),
            },
        )
        .unwrap();
        times.push(start.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(hits.indexed_documents, 100);
        assert!(!hits.items.is_empty());
    }
    let cold = times.remove(0);
    times.sort_by(f64::total_cmp);
    println!(
        "B0_REPORT {}",
        serde_json::json!({"kind":"library_performance","sources":100,"charactersPerSourceApprox":650,"firstPage":40,"warmSamples":20,"coldMs":cold,"warmP50Ms":times[9],"warmP95Ms":times[18],"mode":"existing_memory_lexical","largerScaleValidated":false})
    );
}
