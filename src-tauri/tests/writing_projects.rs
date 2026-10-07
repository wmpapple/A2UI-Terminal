use a2ui_terminal_lib::{
    ai::{self, ConfirmContextManifestInput, ProviderConfig, ProviderKind},
    application::{citation, result, writing_project as app},
    domain::{
        citation::CitationQuery,
        knowledge::{KnowledgeDocument, KnowledgeSource},
        result::SaveResultDocumentInput,
        writing_project::*,
    },
    parser,
    repository::{knowledge, writing_project as repo},
    state::AppState,
    storage::Storage,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
};

fn setup() -> (tempfile::TempDir, AppState, WritingProject) {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    storage
        .create_standalone_workspace("66000000-0000-4000-8000-000000000001", "M6")
        .unwrap();
    let state = AppState::new(
        storage,
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    provider(&state, "http://127.0.0.1:1/v1");
    let p = app::save(
        &state,
        SaveProjectInput {
            id: None,
            workspace_id: "66000000-0000-4000-8000-000000000001".into(),
            revision: None,
            config: ProjectConfig {
                title: "星河项目报告".into(),
                goal: "面向经理的分章节报告".into(),
                audience: "经理".into(),
                facts: "预算 420 元，尚未批准，截止日 2026 年 10 月 15 日".into(),
                terminology: "统一称为星河项目".into(),
                knowledge_ids: vec![],
                document_source_ids: vec![],
                context_pack_ids: vec![],
            },
        },
    )
    .unwrap();
    (dir, state, p)
}
#[test]
fn project_list_exposes_persisted_update_time() {
    let (_dir, state, project) = setup();
    assert!(project.updated_at.is_some());
    let listed = repo::list(&state.storage, &project.workspace_id).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].updated_at, project.updated_at);
}
fn provider(state: &AppState, endpoint: &str) {
    state
        .storage
        .save_provider_config(&ProviderConfig {
            id: "custom".into(),
            kind: ProviderKind::Custom,
            endpoint: endpoint.into(),
            model: "m6-fixture".into(),
            temperature: 0.0,
            proxy_url: None,
        })
        .unwrap();
}
fn outline(state: &AppState, p: &WritingProject) -> WritingProject {
    app::outline(
        state,
        SaveOutlineInput {
            project_id: p.id.clone(),
            revision: p.revision,
            confirmed: true,
            sections: vec![
                OutlineSection {
                    id: None,
                    title: "预算现状".into(),
                    objective: "保留预算与审批状态".into(),
                    target_words: 300,
                },
                OutlineSection {
                    id: None,
                    title: "后续行动".into(),
                    objective: "保留截止日并提出下一步".into(),
                    target_words: 300,
                },
            ],
        },
    )
    .unwrap()
}
fn input(p: &WritingProject, section: Option<usize>) -> PlanWritingInput {
    PlanWritingInput {
        project_id: p.id.clone(),
        revision: p.revision,
        section_id: section.map(|i| p.sections[i].id.clone()),
        provider_id: "custom".into(),
        instruction: "不要虚构已批准".into(),
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
fn seed(state: &AppState) {
    let parsed = parser::parse_located_bytes(
        Path::new("facts.txt"),
        "星河项目预算 420 元，尚未批准；截止日 2026 年 10 月 15 日。".as_bytes(),
    )
    .unwrap();
    let root = a2ui_terminal_lib::application::knowledge::root(&state.managed_results_dir).unwrap();
    std::fs::write(
        root.join("66000000-0000-4000-8000-000000000002.txt"),
        "星河项目预算 420 元，尚未批准；截止日 2026 年 10 月 15 日。",
    )
    .unwrap();
    knowledge::insert_all(
        &state.storage,
        &[KnowledgeDocument {
            source: KnowledgeSource {
                id: "66000000-0000-4000-8000-000000000002".into(),
                title: "星河项目资料".into(),
                format: "txt".into(),
                original_name: "facts.txt".into(),
                raw_hash: parsed.raw_hash.clone(),
                extracted_hash: parsed.extracted_hash.clone(),
                parser_version: parsed.parser_version.clone(),
                source_version: 1,
                tags: vec![],
                status: "ready".into(),
                created_at: String::new(),
                updated_at: String::new(),
            },
            parsed,
        }],
    )
    .unwrap();
}
fn server(content: &str) -> (String, std::thread::JoinHandle<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let content = content.to_owned();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .unwrap();
        let mut raw = Vec::new();
        let payload = loop {
            let mut bytes = [0; 8192];
            let n = socket.read(&mut bytes).unwrap();
            assert!(n > 0);
            raw.extend_from_slice(&bytes[..n]);
            if let Some(end) = raw.windows(4).position(|b| b == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&raw[..end]);
                assert!(!header.to_lowercase().contains("authorization:"));
                let length: usize = header
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|n| n.trim().parse().unwrap())
                    })
                    .unwrap();
                if raw.len() >= end + 4 + length {
                    break serde_json::from_slice(&raw[end + 4..end + 4 + length]).unwrap();
                }
            }
        };
        let body = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            serde_json::json!({"choices":[{"delta":{"content":content}}]})
        );
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        payload
    });
    (endpoint, thread)
}
async fn generate(
    state: &AppState,
    p: &WritingProject,
    section: Option<usize>,
    content: &str,
) -> (WritingRun, serde_json::Value) {
    let (endpoint, thread) = server(content);
    provider(state, &endpoint);
    let plan = app::plan(state, input(p, section)).unwrap();
    confirm(state, &plan.id);
    let run = app::start_with_key(state, &plan.id, |_| {
        Ok(zeroize::Zeroizing::new(String::new()))
    })
    .await
    .unwrap();
    assert_eq!(run.status, "review", "{:?}", run.error);
    assert!(
        app::start_with_key(state, &plan.id, |_| panic!("duplicate network request"))
            .await
            .is_err()
    );
    (run, thread.join().unwrap())
}
fn accept(
    state: &AppState,
    p: &WritingProject,
    section: usize,
    run: &WritingRun,
    summary: &str,
) -> WritingProject {
    app::accept(
        state,
        AcceptSectionInput {
            project_id: p.id.clone(),
            revision: p.revision,
            section_id: p.sections[section].id.clone(),
            run_id: run.id.clone(),
            content: run.content.clone(),
            summary: summary.into(),
        },
    )
    .unwrap()
}

#[tokio::test]
async fn outline_and_chapter_consent_are_isolated_and_revision_bound() {
    let (_dir, state, p) = setup();
    let first = app::plan(&state, input(&p, None)).unwrap();
    let second = app::plan(&state, input(&p, None)).unwrap();
    assert_eq!(state.pending_context_manifests.lock().unwrap().len(), 2);
    confirm(&state, &first.id);
    app::cancel(&state, &second.id).unwrap();
    assert!(state
        .pending_context_manifests
        .lock()
        .unwrap()
        .contains_key(&first.id));
    let unconfirmed = app::plan(&state, input(&p, None)).unwrap();
    assert!(app::start_with_key(&state, &unconfirmed.id, |_| panic!(
        "unconfirmed request reached credentials"
    ))
    .await
    .is_err());
    let p = outline(&state, &p);
    assert!(app::start_with_key(&state, &first.id, |_| panic!(
        "stale outline reached credentials"
    ))
    .await
    .is_err());
    assert!(app::plan(&state, input(&p, Some(1))).is_err());
    assert!(app::finalize(&state, &p.id, p.revision).is_err());
    let plan = app::plan(&state, input(&p, Some(0))).unwrap();
    confirm(&state, &plan.id);
    provider(&state, "http://127.0.0.1:2/v1");
    assert!(app::start_with_key(&state, &plan.id, |_| panic!(
        "changed provider reached credentials"
    ))
    .await
    .is_err());
}

#[tokio::test]
async fn real_transport_sections_summaries_citations_assembly_and_repeat_are_safe() {
    let (dir, state, mut p) = setup();
    seed(&state);
    p = app::save(
        &state,
        SaveProjectInput {
            id: Some(p.id.clone()),
            workspace_id: p.workspace_id.clone(),
            revision: Some(p.revision),
            config: ProjectConfig {
                knowledge_ids: vec!["66000000-0000-4000-8000-000000000002".into()],
                ..p.config.clone()
            },
        },
    )
    .unwrap();
    let (proposed,_)=generate(&state,&p,None,r#"{"sections":[{"id":null,"title":"预算现状","objective":"保留预算与审批状态","targetWords":300},{"id":null,"title":"后续行动","objective":"讨论截止日","targetWords":300}]}"#).await;
    let rows = app::proposal_outline(&state, &proposed.id).unwrap();
    assert!(!repo::get(&state.storage, &p.id).unwrap().outline_confirmed);
    p = app::outline(
        &state,
        SaveOutlineInput {
            project_id: p.id.clone(),
            revision: p.revision,
            sections: rows,
            confirmed: true,
        },
    )
    .unwrap();
    let (first, _) = generate(
        &state,
        &p,
        Some(0),
        "星河项目预算 420 元，尚未批准。[S1]\n\n不得把未知来源作为证据。[S999]",
    )
    .await;
    repo::save_draft(
        &state.storage,
        &first.id,
        &WritingDraft {
            content: first.content.clone(),
            summary: "预算 420 元，尚未批准".into(),
        },
    )
    .unwrap();
    assert!(app::view(&state, &p.id)
        .unwrap()
        .runs
        .iter()
        .find(|r| r.id == first.id)
        .unwrap()
        .draft
        .is_some());
    p = accept(&state, &p, 0, &first, "预算 420 元，尚未批准");
    let rewrite_prompt = app::prompt(&p, &input(&p, Some(0))).unwrap();
    assert!(rewrite_prompt.contains(&first.content));
    assert!(rewrite_prompt.contains("作为本次重写、扩写或精简的基础"));
    let (second, request) = generate(
        &state,
        &p,
        Some(1),
        "截止日为 2026 年 10 月 15 日，应先完成审批。[S1]",
    )
    .await;
    let sent = request["messages"][1]["content"].as_str().unwrap();
    assert!(sent.contains("预算 420 元，尚未批准"));
    assert!(!sent.contains("不得把未知来源作为证据"));
    p = accept(&state, &p, 1, &second, "截止日 2026 年 10 月 15 日");
    let prior_revision = p.revision;
    p = accept(&state, &p, 0, &first, "预算仍为 420 元，审批未完成");
    assert!(!p.sections[1].accepted);
    assert!(app::finalize(&state, &p.id, p.revision).is_err());
    assert!(app::accept(
        &state,
        AcceptSectionInput {
            project_id: p.id.clone(),
            revision: prior_revision,
            section_id: p.sections[1].id.clone(),
            run_id: second.id.clone(),
            content: second.content.clone(),
            summary: "旧修订".into()
        }
    )
    .is_err());
    p = accept(&state, &p, 1, &second, "截止日 2026 年 10 月 15 日");
    let result_id = app::finalize(&state, &p.id, p.revision).unwrap();
    assert_eq!(app::finalize(&state, &p.id, p.revision).unwrap(), result_id);
    // Simulate a crash after the review writes the result but before the final
    // project update. The persisted review ID must resolve the same result.
    let mut before_final_save = repo::get(&state.storage, &p.id).unwrap();
    before_final_save.result_id = None;
    repo::save(&state.storage, &mut before_final_save).unwrap();
    assert_eq!(app::finalize(&state, &p.id, 0).unwrap(), result_id);
    let document =
        result::read_document(&state.storage, &state.managed_results_dir, &result_id).unwrap();
    assert!(document.content.contains("[S1]"));
    assert!(document.content.contains("[S2]"));
    assert!(document.content.contains("[来源待核对：S999]"));
    let query = CitationQuery {
        owner_kind: "result".into(),
        owner_id: result_id.clone(),
    };
    let views = citation::list(&state.storage, &state.managed_results_dir, &query).unwrap();
    assert_eq!(views.len(), 2);
    assert!(views.iter().all(|v| v.status == "verified"), "{views:?}");
    knowledge::mark_unavailable(
        &state.storage,
        "66000000-0000-4000-8000-000000000002",
        "deleting",
    )
    .unwrap();
    assert!(
        citation::list(&state.storage, &state.managed_results_dir, &query)
            .unwrap()
            .iter()
            .all(|v| v.status == "unavailable")
    );
    let id = p.id;
    drop(state);
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    let state = AppState::new(
        storage,
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert_eq!(app::finalize(&state, &id, 0).unwrap(), result_id);
    let published = repo::get(&state.storage, &id).unwrap();
    let original =
        result::read_document(&state.storage, &state.managed_results_dir, &result_id).unwrap();
    assert_eq!(
        published.published_result_hash.as_deref(),
        Some(original.content_hash.as_str())
    );
    let updated = app::accept(
        &state,
        AcceptSectionInput {
            project_id: id.clone(),
            revision: published.revision,
            section_id: published.sections[0].id.clone(),
            run_id: first.id.clone(),
            content: format!("{}\n\n补充核对说明。", published.sections[0].content),
            summary: "预算仍为 420 元，审批未完成".into(),
        },
    )
    .unwrap();
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &result_id)
            .unwrap()
            .content_hash,
        original.content_hash
    );
    let updated = accept(&state, &updated, 1, &second, "截止日 2026 年 10 月 15 日");
    assert_eq!(
        app::finalize(&state, &id, updated.revision).unwrap(),
        result_id
    );
    let revised =
        result::read_document(&state.storage, &state.managed_results_dir, &result_id).unwrap();
    assert!(revised.content.contains("补充核对说明"));
    assert_ne!(revised.content_hash, original.content_hash);
    assert_eq!(
        repo::get(&state.storage, &id).unwrap().published_revision,
        Some(updated.revision + 1)
    );
    let published = repo::get(&state.storage, &id).unwrap();
    let changed = app::accept(
        &state,
        AcceptSectionInput {
            project_id: id.clone(),
            revision: published.revision,
            section_id: published.sections[0].id.clone(),
            run_id: first.id.clone(),
            content: format!("{}\n\n再次更新。", published.sections[0].content),
            summary: "预算仍为 420 元，审批未完成".into(),
        },
    )
    .unwrap();
    let changed = accept(&state, &changed, 1, &second, "截止日 2026 年 10 月 15 日");
    let independently_edited = result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: result_id.clone(),
            content: format!("{}\n\n成果独立编辑。", revised.content),
            base_hash: revised.content_hash,
        },
    )
    .unwrap();
    assert!(app::finalize(&state, &id, changed.revision).is_err());
    assert_eq!(
        result::read_document(&state.storage, &state.managed_results_dir, &result_id)
            .unwrap()
            .content_hash,
        independently_edited.content_hash
    );
    app::delete(&state, &id).unwrap();
    assert!(result::read_document(&state.storage, &state.managed_results_dir, &result_id).is_ok());
    assert!(repo::runs(&state.storage, &id).unwrap().is_empty());
}

#[test]
fn interrupted_runs_preserve_partial_drafts_and_never_resume_network() {
    let (dir, state, p) = setup();
    let p = outline(&state, &p);
    let id = uuid::Uuid::new_v4().to_string();
    let run = WritingRun {
        id: id.clone(),
        project_id: p.id.clone(),
        section_id: Some(p.sections[0].id.clone()),
        project_revision: p.revision,
        request_id: id.clone(),
        status: "running".into(),
        content: String::new(),
        error: None,
        snapshot: serde_json::json!({"promptVersion":app::PROMPT_VERSION}),
        created_at: String::new(),
        draft: None,
    };
    repo::start_run(&state.storage, &run).unwrap();
    assert!(repo::start_run(&state.storage, &run).is_err());
    repo::progress(&state.storage, &id, "保留这段未完成内容", "running", None).unwrap();
    drop(state);
    let storage = Storage::open(&dir.path().join("test.sqlite3")).unwrap();
    repo::recover(&storage).unwrap();
    assert_eq!(repo::run(&storage, &id).unwrap().status, "interrupted");
    assert_eq!(
        repo::run(&storage, &id).unwrap().content,
        "保留这段未完成内容"
    );
    storage.clear_all().unwrap();
    let observer = rusqlite::Connection::open(dir.path().join("test.sqlite3")).unwrap();
    for table in ["writing_projects", "writing_project_runs"] {
        assert_eq!(
            observer
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn pending_capacity_rejection_never_evicts_existing_consent() {
    let (_dir, state, p) = setup();
    let mut plans = Vec::new();
    for _ in 0..16 {
        plans.push(app::plan(&state, input(&p, None)).unwrap());
    }
    assert!(app::plan(&state, input(&p, None)).is_err());
    confirm(&state, &plans[0].id);
    app::cancel(&state, &plans[1].id).unwrap();
    assert!(app::plan(&state, input(&p, None)).is_ok());
    assert!(state
        .pending_context_manifests
        .lock()
        .unwrap()
        .contains_key(&plans[0].id));
}

#[tokio::test]
async fn live_cancel_keeps_partial_output_and_blocks_concurrent_mutation() {
    let (_dir, state, p) = setup();
    let p = outline(&state, &p);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    provider(
        &state,
        &format!("http://{}/v1", listener.local_addr().unwrap()),
    );
    let worker = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0; 65536];
        let _ = socket.read(&mut bytes).unwrap();
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let event =
            serde_json::json!({"choices":[{"delta":{"content":"保留已生成的正文。".repeat(130)}}]});
        write!(socket, "data: {event}\n\n").unwrap();
        socket.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1200));
    });
    let plan = app::plan(&state, input(&p, Some(0))).unwrap();
    confirm(&state, &plan.id);
    let start = app::start_with_key(&state, &plan.id, |_| {
        Ok(zeroize::Zeroizing::new(String::new()))
    });
    let cancel = async {
        for _ in 0..100 {
            if repo::runs(&state.storage, &p.id)
                .unwrap()
                .iter()
                .any(|r| !r.content.is_empty())
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(app::plan(&state, input(&p, Some(0))).is_err());
        assert!(app::delete(&state, &p.id).is_err());
        app::cancel(&state, &plan.request_id).unwrap();
    };
    let (run, _) = tokio::join!(start, cancel);
    let run = run.unwrap();
    assert_eq!(run.status, "cancelled");
    assert!(run.content.contains("保留已生成"));
    assert!(!repo::get(&state.storage, &p.id).unwrap().sections[0].accepted);
    assert!(state.active_requests.lock().unwrap().is_empty());
    worker.join().unwrap();
}

#[tokio::test]
#[ignore = "requires an explicitly started local evaluation model"]
async fn real_model_fixed_longform_eval() {
    let endpoint =
        std::env::var("M6_WRITING_ENDPOINT").expect("Start the optional local eval server first");
    assert!(endpoint.starts_with("http://127.0.0.1:"));
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../evals/longform/cases.json")).unwrap();
    let mut reports = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let (_dir, state, mut p) = setup();
        seed(&state);
        provider(&state, &endpoint);
        p.config.goal = case["goal"].as_str().unwrap().into();
        p.config.knowledge_ids = vec!["66000000-0000-4000-8000-000000000002".into()];
        p = app::save(
            &state,
            SaveProjectInput {
                id: Some(p.id.clone()),
                workspace_id: p.workspace_id.clone(),
                revision: Some(p.revision),
                config: p.config.clone(),
            },
        )
        .unwrap();
        p = app::outline(
            &state,
            SaveOutlineInput {
                project_id: p.id.clone(),
                revision: p.revision,
                confirmed: true,
                sections: case["sections"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| OutlineSection {
                        id: None,
                        title: s["title"].as_str().unwrap().into(),
                        objective: s["objective"].as_str().unwrap().into(),
                        target_words: 400,
                    })
                    .collect(),
            },
        )
        .unwrap();
        let mut chapters = Vec::new();
        for i in 0..p.sections.len() {
            let plan = app::plan(&state, input(&p, Some(i))).unwrap();
            confirm(&state, &plan.id);
            let started = std::time::Instant::now();
            let run = app::start_with_key(&state, &plan.id, |_| {
                Ok(zeroize::Zeroizing::new(String::new()))
            })
            .await
            .unwrap();
            chapters.push(serde_json::json!({"title":p.sections[i].title,"objective":p.sections[i].objective,"status":run.status,"error":run.error,"content":run.content,"elapsedMs":started.elapsed().as_millis(),"snapshot":run.snapshot}));
            if run.status != "review" {
                break;
            }
            // Synthetic user-reviewed continuity note; never generated or auto-accepted in product.
            p = accept(&state, &p, i, &run, "星河项目预算 420 元，尚未批准；截止日为 2026 年 10 月 15 日。审批人、人员分工、实施进度未知；所有行动仅为建议。");
        }
        let final_result = if p.sections.iter().all(|s| s.accepted) {
            let id = app::finalize(&state, &p.id, p.revision).unwrap();
            let d = result::read_document(&state.storage, &state.managed_results_dir, &id).unwrap();
            let refs = citation::list(
                &state.storage,
                &state.managed_results_dir,
                &CitationQuery {
                    owner_kind: "result".into(),
                    owner_id: id,
                },
            )
            .unwrap();
            serde_json::json!({"content":d.content,"citations":refs})
        } else {
            serde_json::Value::Null
        };
        reports
            .push(serde_json::json!({"id":case["id"],"chapters":chapters,"result":final_result}));
        let path = std::env::var("M6_WRITING_REPORT").expect("Set M6_WRITING_REPORT");
        std::fs::write(path, serde_json::to_string_pretty(&serde_json::json!({"fixtureVersion":fixture["version"],"promptVersion":app::PROMPT_VERSION,"cases":reports})).unwrap()).unwrap();
    }
}
