use a2ui_terminal_lib::{
    ai::{self, ConfirmContextManifestInput},
    application::{
        generation::{self, GenerationTarget, PlanGenerationInput},
        result, review, task,
    },
    domain::{
        result::{CreateTextResultInput, ResultType, SaveResultDocumentInput, TextResultFormat},
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision, ReviewStatus},
        task::{AnswerTaskInput, CreateTaskInput, TaskStatus},
    },
    repository::provider::ProviderRepository,
    state::AppState,
    storage::Storage,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::AtomicBool,
};

fn setup() -> (tempfile::TempDir, AppState, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = result::prepare_managed_results_dir(dir.path()).unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let document = result::create_text(
        &storage,
        &root,
        CreateTextResultInput {
            title: "Test document".into(),
            file_name: "test.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    (
        dir,
        AppState::new(storage, root),
        document.result.summary.id,
    )
}
fn input(id: &str) -> PlanGenerationInput {
    PlanGenerationInput {
        result_id: Some(id.into()),
        task_id: None,
        provider_id: "openai".into(),
        prompt: "Rewrite using approved facts only".into(),
        include_result: false,
        knowledge_ids: vec![],
        document_source_ids: vec![],
        context_pack_ids: vec![],
    }
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
fn accept(state: &AppState, r: &a2ui_terminal_lib::domain::review::ReviewRequest) {
    review::decide(
        &state.storage,
        DecideReviewBlocksInput {
            review_id: r.id.clone(),
            workspace_id: r.workspace_id.clone(),
            decisions: r
                .blocks
                .iter()
                .map(|b| ReviewBlockDecision {
                    block_id: b.id.clone(),
                    accepted: true,
                    file_name: b.suggested_file_name.clone(),
                })
                .collect(),
        },
    )
    .unwrap();
}

#[tokio::test]
async fn result_context_is_opt_in_and_unconfirmed_generation_cannot_reach_credentials() {
    let (_dir, state, id) = setup();
    let plan = generation::plan(&state, input(&id)).unwrap();
    assert!(plan.manifest.included_sources.is_empty());
    assert!(generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| panic!("unconfirmed request reached credentials")
    )
    .await
    .is_err());
    let mut request = input(&id);
    request.include_result = true;
    let plan = generation::plan(&state, request).unwrap();
    assert_eq!(plan.manifest.included_sources.len(), 1);
    assert_eq!(plan.manifest.included_sources[0].character_count, 17);
    confirm(&state, &plan.id);
    result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: id.clone(),
            base_hash: result::read_document(&state.storage, &state.managed_results_dir, &id)
                .unwrap()
                .content_hash,
            content: "Human edit".into(),
        },
    )
    .unwrap();
    assert!(generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| panic!("stale target reached credentials")
    )
    .await
    .is_err());
}

#[test]
fn cancellation_and_stale_targets_create_no_review_or_result_write() {
    let (_dir, state, id) = setup();
    let before = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
    let target = GenerationTarget::Result(Box::new(before.clone()));
    assert!(generation::finish(
        &state.storage,
        &state.managed_results_dir,
        &target,
        "Generated",
        &AtomicBool::new(true)
    )
    .is_err());
    assert!(
        review::list_active(&state.storage, &before.result.summary.workspace_id)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &id)
            .unwrap()
            .content,
        before.content
    );
}

#[tokio::test]
async fn changed_provider_and_credential_failure_never_write_and_allow_replanning() {
    let (_dir, state, id) = setup();
    let before = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
    let plan = generation::plan(&state, input(&id)).unwrap();
    confirm(&state, &plan.id);
    let repository = ProviderRepository::new(&state.storage);
    let mut config = repository.find("openai").unwrap().unwrap();
    config.model = "changed-model".into();
    repository.save(&config).unwrap();
    assert!(generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| panic!("changed provider reached credentials")
    )
    .await
    .is_err());
    let retry = generation::plan(&state, input(&id)).unwrap();
    confirm(&state, &retry.id);
    assert!(generation::start_with_key_source(
        &state,
        &retry.id,
        |_| Ok(()),
        |_| Err(a2ui_terminal_lib::error::AppError::InvalidInput(
            "Missing test key".into()
        ))
    )
    .await
    .is_err());
    assert!(state.active_requests.lock().unwrap().is_empty());
    assert!(
        review::list_active(&state.storage, &before.result.summary.workspace_id)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &id)
            .unwrap()
            .content,
        before.content
    );
    assert!(generation::plan(&state, input(&id)).is_ok());
}

#[test]
fn managed_result_conflict_preserves_human_edit_and_copy_can_be_undone() {
    use a2ui_terminal_lib::domain::review::{ResolveReviewConflictInput, ReviewConflictResolution};
    let (_dir, state, id) = setup();
    let before = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
    let output = generation::finish(
        &state.storage,
        &state.managed_results_dir,
        &GenerationTarget::Result(Box::new(before.clone())),
        "AI candidate",
        &AtomicBool::new(false),
    )
    .unwrap();
    result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: id.clone(),
            base_hash: before.content_hash,
            content: "Human edit".into(),
        },
    )
    .unwrap();
    accept(&state, &output.review);
    let apply = ApplyReviewInput {
        review_id: output.review.id.clone(),
        workspace_id: output.review.workspace_id.clone(),
    };
    assert!(review::apply(&state.storage, &state.managed_results_dir, apply.clone()).is_err());
    assert_eq!(
        review::get(&state.storage, &apply.review_id)
            .unwrap()
            .status,
        ReviewStatus::Conflicted
    );
    let copy = review::resolve_conflict(
        &state.storage,
        &state.managed_results_dir,
        ResolveReviewConflictInput {
            review_id: apply.review_id.clone(),
            workspace_id: apply.workspace_id.clone(),
            resolution: ReviewConflictResolution::SaveCopy,
        },
    )
    .unwrap()
    .result
    .unwrap();
    assert_ne!(copy.result.summary.id, id);
    assert_eq!(copy.content, "AI candidate");
    review::undo(&state.storage, &state.managed_results_dir, apply).unwrap();
    assert!(result::read_document(
        &state.storage,
        &state.managed_results_dir,
        &copy.result.summary.id
    )
    .is_err());
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &id)
            .unwrap()
            .content,
        "Human edit"
    );
}

#[tokio::test]
async fn cancellation_during_real_stream_discards_partial_output() {
    let (_dir, state, id) = setup();
    let before = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        // Drain the complete request before closing the response. Closing with an
        // unread body can reset TCP on Windows before the client receives SSE.
        let mut bytes = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let n = socket.read(&mut chunk).unwrap();
            assert!(n > 0, "request ended before its body");
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Partial candidate\"}}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let repository = ProviderRepository::new(&state.storage);
    let mut config = repository.find("openai").unwrap().unwrap();
    config.endpoint = format!("http://{address}/v1");
    config.proxy_url = None;
    repository.save(&config).unwrap();
    let plan = generation::plan(&state, input(&id)).unwrap();
    confirm(&state, &plan.id);
    let mut emitted = false;
    let outcome = generation::start_with_key_source(
        &state,
        &plan.id,
        |_| {
            emitted = true;
            state
                .active_requests
                .lock()
                .unwrap()
                .get(&plan.request_id)
                .unwrap()
                .store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        },
        |_| Ok(zeroize::Zeroizing::new(String::new())),
    )
    .await;
    server.join().unwrap();
    assert!(emitted);
    assert!(outcome.is_err());
    assert!(state.active_requests.lock().unwrap().is_empty());
    assert!(
        review::list_active(&state.storage, &before.result.summary.workspace_id)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &id)
            .unwrap()
            .content,
        before.content
    );
}

#[tokio::test]
async fn real_sse_transport_produces_review_then_apply_and_undo_survive_restart() {
    let (dir, state, id) = setup();
    let before = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buf = [0; 4096];
        loop {
            let n = socket.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let len: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + len {
                    break;
                }
            }
        }
        let request = String::from_utf8_lossy(&bytes);
        assert!(!request.contains("# Test document"));
        assert!(request.contains("Rewrite using approved facts only"));
        let body="data: {\"choices\":[{\"delta\":{\"content\":\"# Generated\\n\\nVerified 420\"}}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let mut config = ProviderRepository::new(&state.storage)
        .find("openai")
        .unwrap()
        .unwrap();
    config.endpoint = format!("http://{address}/v1");
    config.proxy_url = None;
    ProviderRepository::new(&state.storage)
        .save(&config)
        .unwrap();
    let plan = generation::plan(&state, input(&id)).unwrap();
    confirm(&state, &plan.id);
    let mut delta = String::new();
    let output = generation::start_with_key_source(
        &state,
        &plan.id,
        |event| {
            if let a2ui_terminal_lib::application::chat::ChatStreamEvent::Delta {
                delta: d, ..
            } = event
            {
                delta.push_str(&d);
            }
            Ok(())
        },
        |_| Ok(zeroize::Zeroizing::new("test-only-key".into())),
    )
    .await
    .unwrap();
    server.join().unwrap();
    assert_eq!(delta, "# Generated\n\nVerified 420");
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &id)
            .unwrap()
            .content,
        before.content
    );
    assert!(generation::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| panic!("replayed generation")
    )
    .await
    .is_err());
    let apply = ApplyReviewInput {
        review_id: output.review.id.clone(),
        workspace_id: output.review.workspace_id.clone(),
    };
    assert!(review::apply(&state.storage, &state.managed_results_dir, apply.clone()).is_err());
    accept(&state, &output.review);
    let applied = review::apply(&state.storage, &state.managed_results_dir, apply.clone()).unwrap();
    assert_eq!(applied.result.unwrap().content, delta);
    let root = state.managed_results_dir.clone();
    drop(state);
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    assert_eq!(
        review::get(&storage, &apply.review_id).unwrap().status,
        ReviewStatus::Applied
    );
    let undone = review::undo(&storage, &root, apply).unwrap();
    assert_eq!(undone.result.unwrap().content, before.content);
}

#[test]
fn task_generation_requires_ready_answers_and_review_application_links_the_result() {
    let (_dir, state, _) = setup();
    let workspace = uuid::Uuid::new_v4().to_string();
    state
        .storage
        .create_standalone_workspace(&workspace, "Tasks")
        .unwrap();
    let template = task::list_templates(&state.storage).unwrap().remove(0);
    let created = task::create(
        &state.storage,
        CreateTaskInput {
            workspace_id: workspace.clone(),
            template_id: template.id,
        },
    )
    .unwrap();
    let answers = template
        .fields
        .iter()
        .map(|f| {
            (
                f.id.clone(),
                serde_json::Value::String(
                    f.options
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "Test answer".into()),
                ),
            )
        })
        .collect();
    let ready = task::answer(
        &state.storage,
        AnswerTaskInput {
            task_id: created.id,
            answers,
        },
    )
    .unwrap();
    assert_eq!(ready.status, TaskStatus::Ready);
    let output = generation::finish(
        &state.storage,
        &state.managed_results_dir,
        &GenerationTarget::Task(Box::new(ready.clone())),
        "# AI task\n\nEvidence 420",
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        task::get(&state.storage, &ready.id).unwrap().status,
        TaskStatus::ReviewPending
    );
    assert!(task::get(&state.storage, &ready.id)
        .unwrap()
        .result_id
        .is_none());
    // Rejecting an older failed review must not reset a newer pending attempt.
    accept(&state, &output.review);
    state
        .storage
        .mark_review_error(&output.review.id, "failed", "TEST_FAILURE")
        .unwrap();
    let failed = output.review;
    let output = generation::finish(
        &state.storage,
        &state.managed_results_dir,
        &GenerationTarget::Task(Box::new(ready.clone())),
        "# AI task\n\nEvidence 420",
        &AtomicBool::new(false),
    )
    .unwrap();
    review::discard(&state.storage, &failed.workspace_id, &failed.id).unwrap();
    assert_eq!(
        task::get(&state.storage, &ready.id).unwrap().status,
        TaskStatus::ReviewPending
    );
    accept(&state, &output.review);
    let apply = ApplyReviewInput {
        review_id: output.review.id,
        workspace_id: workspace.clone(),
    };
    let document = review::apply(&state.storage, &state.managed_results_dir, apply.clone())
        .unwrap()
        .result
        .unwrap();
    assert_eq!(document.result.summary.workspace_id, workspace);
    let completed = task::get(&state.storage, &ready.id).unwrap();
    assert_eq!(completed.status, TaskStatus::Completed);
    assert_eq!(completed.result_id, Some(document.result.summary.id));
    review::undo(&state.storage, &state.managed_results_dir, apply).unwrap();
    assert_eq!(
        task::get(&state.storage, &ready.id).unwrap().status,
        TaskStatus::Ready
    );
}
