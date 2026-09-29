use a2ui_terminal_lib::application::inline_edit::{InlineEditAction, PlanInlineEditInput};
use a2ui_terminal_lib::{
    ai::{self, ConfirmContextManifestInput, ProviderConfig, ProviderKind},
    application::{critic as app, document, inline_edit, result, review, writing_profile},
    domain::{
        citation::CitationView,
        critic::{CriticOptions, InspectCriticInput},
        document::DocumentTarget,
        result::{CreateTextResultInput, ResultType, SaveResultDocumentInput, TextResultFormat},
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision},
        writing_profile::{SaveWritingProfileInput, TerminologyRule, WritingProfileScope},
    },
    state::AppState,
    storage::Storage,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
};

fn setup(text: &str) -> (tempfile::TempDir, AppState, DocumentTarget) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    let created = result::create_text(
        &state.storage,
        &state.managed_results_dir,
        CreateTextResultInput {
            title: "审稿测试".into(),
            file_name: "critic.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let target = DocumentTarget::Result {
        result_id: created.result.summary.id,
    };
    save(&state, &target, text);
    provider(&state, "http://127.0.0.1:1/v1");
    (dir, state, target)
}
fn save(state: &AppState, target: &DocumentTarget, text: &str) {
    let snap = document::snapshot(&state.storage, &state.managed_results_dir, target).unwrap();
    let DocumentTarget::Result { result_id } = target else {
        panic!()
    };
    result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: result_id.clone(),
            base_hash: snap.content_hash,
            content: text.into(),
        },
    )
    .unwrap();
}
fn inspect(
    state: &AppState,
    target: &DocumentTarget,
) -> a2ui_terminal_lib::domain::critic::CriticView {
    app::inspect(
        state,
        InspectCriticInput {
            target: target.clone(),
            options: CriticOptions::default(),
        },
    )
    .unwrap()
}
fn provider(state: &AppState, endpoint: &str) {
    state
        .storage
        .save_provider_config(&ProviderConfig {
            id: "custom".into(),
            kind: ProviderKind::Custom,
            endpoint: endpoint.into(),
            model: "m7-transport-fixture".into(),
            temperature: 0.0,
            proxy_url: None,
        })
        .unwrap();
}
fn profile(state: &AppState) -> ai::WritingProfileSnapshot {
    writing_profile::save(
        &state.storage,
        SaveWritingProfileInput {
            scope: WritingProfileScope::Global,
            workspace_id: None,
            enabled: true,
            rules: "保持正式".into(),
            terminology: vec![TerminologyRule {
                term: "AI".into(),
                preferred: "AI 助手".into(),
            }],
            forbidden_words: vec!["赋能".into()],
            example_knowledge_ids: vec![],
        },
    )
    .unwrap()
    .effective
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
fn server(
    content: &str,
    pause: Option<std::sync::mpsc::Receiver<()>>,
) -> (String, std::thread::JoinHandle<serde_json::Value>) {
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
        if let Some(pause) = pause {
            pause
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        }
        let body = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            serde_json::json!({"choices":[{"delta":{"content":content}}]})
        );
        let _ = write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
        payload
    });
    (endpoint, thread)
}

#[test]
fn forbidden_words_cover_headings_lists_and_quotes_but_not_code() {
    let (_dir, state, _) = setup("text");
    let p = profile(&state);
    let text = "# 🙂赋能 `赋能`\n\n赋能\n====\n\n- 赋能团队\n\n> 赋能\n\n```txt\n赋能\n```\n";
    let (found, _) = app::local_findings(text, true, &p, &[], &CriticOptions::default());
    let words: Vec<_> = found
        .iter()
        .filter(|f| f.kind == "forbidden_word")
        .collect();
    assert_eq!(words.len(), 4);
    for f in words {
        assert_eq!(
            &text[document::utf16_range(text, f.start, f.end).unwrap()],
            "赋能"
        );
    }
    let mut disabled = p;
    disabled.enabled = false;
    let (found, _) = app::local_findings(text, true, &disabled, &[], &CriticOptions::default());
    assert!(!found.iter().any(|f| f.kind == "forbidden_word"));
}
#[test]
fn deterministic_rules_preserve_unicode_ranges_and_exclude_code_and_preferred_terms() {
    let (_dir, state, _) = setup("text");
    let p = profile(&state);
    let text = "# 标题\r\n\r\n### 跳级\r\n\r\n🙂AI 提供帮助，AI 助手与 RAIL 保持正常。赋能。\r\n\r\n`AI 123 赋能 [S99]`\r\n\r\n```txt\r\nAI 456 赋能\r\n```\r\n";
    let (found, truncated) = app::local_findings(text, true, &p, &[], &CriticOptions::default());
    assert!(!truncated);
    assert_eq!(found.iter().filter(|f| f.kind == "terminology").count(), 1);
    assert_eq!(
        found.iter().filter(|f| f.kind == "forbidden_word").count(),
        1
    );
    assert_eq!(found.iter().filter(|f| f.kind == "heading").count(), 1);
    assert!(!found.iter().any(|f| f.kind == "missing_citation"));
    for f in found {
        let r = document::utf16_range(text, f.start, f.end).unwrap();
        assert_eq!(&text[r], f.quote);
    }
}
#[test]
fn repetition_lengths_and_citation_checks_are_advisory_and_bounded() {
    let p = ai::build_writing_profile_snapshot(None, None);
    let para = "这是用来测试完全重复的段落，所有句子均为虚构测试资料。";
    let text = format!(
        "{para}\n\n{para}\n\n预算 420 元 [S1]。\n\n预算 7 元 [S9]。\n\n{}",
        "长".repeat(130)
    );
    let citations = vec![
        CitationView {
            key: "S1".into(),
            title: "虚构资料".into(),
            status: "verified".into(),
            locator: None,
            excerpt: Some("预算 420 元".into()),
        },
        CitationView {
            key: "S9".into(),
            title: String::new(),
            status: "unknown".into(),
            locator: None,
            excerpt: None,
        },
    ];
    let (found, _) = app::local_findings(
        &text,
        true,
        &p,
        &citations,
        &CriticOptions {
            sentence_limit: 20,
            paragraph_limit: 50,
        },
    );
    for kind in [
        "repetition",
        "sentence_length",
        "paragraph_length",
        "missing_citation",
        "citation",
    ] {
        assert!(found.iter().any(|f| f.kind == kind), "{kind}");
    }
    assert!(!found
        .iter()
        .any(|f| f.kind == "missing_citation" && f.quote.contains("420")));
    let mut p = p;
    p.enabled = true;
    p.forbidden_words = vec!["禁".into()];
    let (found, truncated) = app::local_findings(
        &"禁".repeat(100_000),
        false,
        &p,
        &[],
        &CriticOptions::default(),
    );
    assert!(truncated);
    assert_eq!(found.len(), 100);
}
#[test]
fn report_and_ignored_state_survive_restart_but_document_revision_invalidates_actions() {
    let (dir, state, target) = setup("预算 420 元。\n");
    let report = inspect(&state, &target).local;
    let fid = &report.findings[0].id;
    let selection = app::resolve(&state, &report.id, fid).unwrap();
    document::validate_selection(
        &state.storage,
        &state.managed_results_dir,
        &selection.selection,
    )
    .unwrap();
    app::ignore(&state, &report.id, fid, true).unwrap();
    assert!(app::resolve(&state, &report.id, fid).is_err());
    drop(state);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert!(inspect(&state, &target).local.findings[0].ignored);
    app::ignore(&state, &report.id, fid, false).unwrap();
    save(&state, &target, "预算 421 元。\n");
    save(&state, &target, "预算 420 元。\n");
    assert!(
        app::resolve(&state, &report.id, fid).is_err(),
        "same text restored is a different revision"
    );
    assert_ne!(inspect(&state, &target).local.id, report.id);
}
#[test]
fn profile_change_and_workspace_revocation_invalidate_findings() {
    let (dir, state, target) = setup("预算 420 元。\n");
    let r = inspect(&state, &target).local;
    profile(&state);
    assert!(app::resolve(&state, &r.id, &r.findings[0].id).is_err());
    let ws = a2ui_terminal_lib::workspace::register_standalone_workspace(&state.storage).unwrap();
    let path = dir.path().join("workspace.txt");
    std::fs::write(&path, "预算 420 元。").unwrap();
    let file =
        a2ui_terminal_lib::workspace::attach_selected_file(&state.storage, &ws.id, &path).unwrap();
    let source_id = file.source_id.unwrap();
    let target = DocumentTarget::WorkspaceFile {
        workspace_id: ws.id.clone(),
        source_id: source_id.clone(),
    };
    let r = inspect(&state, &target).local;
    let before = document::snapshot(&state.storage, &state.managed_results_dir, &target).unwrap();
    a2ui_terminal_lib::workspace::save_file_with_history(
        &state.storage,
        &ws.id,
        &file.path,
        "预算 421 元。",
        &before.content_hash,
    )
    .unwrap();
    let changed = document::snapshot(&state.storage, &state.managed_results_dir, &target).unwrap();
    a2ui_terminal_lib::workspace::save_file_with_history(
        &state.storage,
        &ws.id,
        &file.path,
        "预算 420 元。",
        &changed.content_hash,
    )
    .unwrap();
    assert!(
        app::resolve(&state, &r.id, &r.findings[0].id).is_err(),
        "workspace history also invalidates identical restored text"
    );
    let r = inspect(&state, &target).local;
    state
        .storage
        .revoke_workspace_file(&ws.id, &source_id)
        .unwrap();
    assert!(app::resolve(&state, &r.id, &r.findings[0].id).is_err());
    assert!(app::plan(&state, &r.id, "custom").is_err());
    assert!(
        a2ui_terminal_lib::repository::critic::find(&state.storage, &target, "local")
            .unwrap()
            .is_none()
    );
    assert_eq!(std::fs::read_to_string(path).unwrap(), "预算 420 元。");
}

#[test]
fn unsaved_drafts_limits_and_local_data_reset_are_enforced() {
    let (_dir, state, target) = setup("预算 420 元。");
    let r = inspect(&state, &target).local;
    let DocumentTarget::Result { result_id } = &target else {
        panic!()
    };
    result::save_draft(
        &state.storage,
        &state.managed_results_dir,
        a2ui_terminal_lib::domain::result::SaveResultDraftInput {
            result_id: result_id.clone(),
            content: "未保存".into(),
            base_hash: r.binding.content_hash.clone(),
        },
    )
    .unwrap();
    assert!(app::inspect(
        &state,
        InspectCriticInput {
            target: target.clone(),
            options: CriticOptions::default()
        }
    )
    .is_err());
    assert!(app::resolve(&state, &r.id, &r.findings[0].id).is_err());
    state.storage.delete_result_draft(result_id).unwrap();
    assert!(app::inspect(
        &state,
        InspectCriticInput {
            target: target.clone(),
            options: CriticOptions {
                sentence_limit: 0,
                paragraph_limit: 400
            }
        }
    )
    .is_err());
    save(&state, &target, &"字".repeat(100_001));
    assert!(app::inspect(
        &state,
        InspectCriticInput {
            target: target.clone(),
            options: CriticOptions::default()
        }
    )
    .is_err());
    state.storage.clear_all().unwrap();
    assert!(
        a2ui_terminal_lib::repository::critic::find(&state.storage, &target, "local")
            .unwrap()
            .is_none()
    );
}
#[test]
fn strict_model_output_rejects_nonexistent_ambiguous_and_executable_findings() {
    for (text, item) in [
        (
            "原文",
            serde_json::json!({"kind":"logic","quote":"虚构","message":"可能有误"}),
        ),
        (
            "aaaa",
            serde_json::json!({"kind":"logic","quote":"aaa","message":"可能有误"}),
        ),
        (
            "原文",
            serde_json::json!({"kind":"logic","quote":"原文","message":"可能有误","evidence":"不存在"}),
        ),
        (
            "原文",
            serde_json::json!({"kind":"logic","quote":"原文","message":"可能有误","path":"C:/secret.txt"}),
        ),
        (
            "原文",
            serde_json::json!({"kind":"edit","quote":"原文","message":"替换"}),
        ),
    ] {
        assert!(
            app::parse_findings(text, &serde_json::json!({"findings":[item]}).to_string()).is_err()
        );
    }
    assert!(app::parse_findings("text", "not json").is_err());
    let f = app::parse_findings("🙂原文\r\n后文", "{\"findings\":[{\"kind\":\"style\",\"quote\":\"原文\",\"message\":\"请核对风格\",\"evidence\":\"后文\"}]}").unwrap();
    assert_eq!(f[0].start, 2);
    assert_eq!(f[0].end, 4);
}
#[tokio::test]
async fn unconfirmed_canceled_changed_provider_and_stale_plans_do_not_request_keys() {
    let (_dir, state, target) = setup("预算 420 元。");
    let r = inspect(&state, &target).local;
    let p = app::plan(&state, &r.id, "custom").unwrap();
    assert!(app::start_with_key(&state, &p.id, |_| panic!("no consent"))
        .await
        .is_err());
    let a = app::plan(&state, &r.id, "custom").unwrap();
    let b = app::plan(&state, &r.id, "custom").unwrap();
    app::cancel(&state, &a.request_id).unwrap();
    assert!(app::start_with_key(&state, &a.id, |_| panic!("canceled"))
        .await
        .is_err());
    confirm(&state, &b.id);
    provider(&state, "http://127.0.0.1:2/v1");
    assert!(
        app::start_with_key(&state, &b.id, |_| panic!("changed provider"))
            .await
            .is_err()
    );
    let p = app::plan(&state, &r.id, "custom").unwrap();
    confirm(&state, &p.id);
    save(&state, &target, "预算 421 元。");
    assert!(
        app::start_with_key(&state, &p.id, |_| panic!("stale revision"))
            .await
            .is_err()
    );
    assert!(state.active_requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn model_report_is_read_only_and_chosen_finding_requires_inline_review_before_write() {
    let (_dir, state, target) = setup("# 标题\n\n预算 420 元，尚未批准。\n");
    let initial = inspect(&state, &target).local;
    let quote = "预算 420 元，尚未批准。";
    let body = serde_json::json!({"findings":[{"kind":"style","quote":quote,"message":"句式可调整，保留预算与否定关系","evidence":null}]}).to_string();
    let (endpoint, thread) = server(&body, None);
    provider(&state, &endpoint);
    let p = app::plan(&state, &initial.id, "custom").unwrap();
    confirm(&state, &p.id);
    let report = app::start_with_key(&state, &p.id, |_| {
        Ok(zeroize::Zeroizing::new(String::new()))
    })
    .await
    .unwrap();
    let request = thread.join().unwrap().to_string();
    assert!(request.contains(quote));
    assert!(request.contains("read-only"));
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .content_hash,
        initial.binding.content_hash
    );
    assert!(inspect(&state, &target).llm.is_some());
    assert!(app::start_with_key(&state, &p.id, |_| panic!("duplicate"))
        .await
        .is_err());
    let selected = app::resolve(&state, &report.id, &report.findings[0].id).unwrap();
    let replacement = "当前预算为 420 元，仍未获得批准。";
    let (endpoint, thread) = server(replacement, None);
    provider(&state, &endpoint);
    let plan = inline_edit::plan(
        &state,
        PlanInlineEditInput {
            selection: selected.selection,
            provider_id: "custom".into(),
            action: InlineEditAction::Custom,
            custom_instruction: Some(selected.instruction),
        },
    )
    .unwrap();
    confirm(&state, &plan.id);
    let proposal = inline_edit::start_with_key_source(
        &state,
        &plan.id,
        |_| Ok(()),
        |_| Ok(zeroize::Zeroizing::new(String::new())),
    )
    .await
    .unwrap();
    thread.join().unwrap();
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .content_hash,
        initial.binding.content_hash
    );
    let input = ApplyReviewInput {
        review_id: proposal.review.id.clone(),
        workspace_id: proposal.review.workspace_id.clone(),
    };
    assert!(review::apply(&state.storage, &state.managed_results_dir, input.clone()).is_err());
    review::decide(
        &state.storage,
        DecideReviewBlocksInput {
            review_id: proposal.review.id.clone(),
            workspace_id: proposal.review.workspace_id.clone(),
            decisions: vec![ReviewBlockDecision {
                block_id: proposal.review.blocks[0].id.clone(),
                accepted: true,
                file_name: None,
            }],
        },
    )
    .unwrap();
    review::apply(&state.storage, &state.managed_results_dir, input).unwrap();
    let updated = document::snapshot(&state.storage, &state.managed_results_dir, &target).unwrap();
    assert_eq!(
        updated.text,
        initial.binding.text.replace(quote, replacement)
    );
    assert!(app::resolve(&state, &report.id, &report.findings[0].id).is_err());
    assert!(inspect(&state, &target).llm.is_none());
}
#[tokio::test]
async fn document_change_during_network_response_prevents_report_persistence() {
    let (_dir, state, target) = setup("预算 420 元。");
    let r = inspect(&state, &target).local;
    let (release, pause) = std::sync::mpsc::channel();
    let (endpoint, thread) = server("{\"findings\":[]}", Some(pause));
    provider(&state, &endpoint);
    let p = app::plan(&state, &r.id, "custom").unwrap();
    confirm(&state, &p.id);
    let request = app::start_with_key(&state, &p.id, |_| {
        Ok(zeroize::Zeroizing::new(String::new()))
    });
    let mutate = async {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        save(&state, &target, "预算 421 元。");
        release.send(()).unwrap();
    };
    let (outcome, _) = tokio::join!(request, mutate);
    assert!(outcome.is_err());
    thread.join().unwrap();
    assert!(inspect(&state, &target).llm.is_none());
    assert!(state.active_requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn canceled_network_response_never_persists_a_report() {
    let (_dir, state, target) = setup("预算 420 元。");
    let r = inspect(&state, &target).local;
    let (release, pause) = std::sync::mpsc::channel();
    let (endpoint, thread) = server("{\"findings\":[]}", Some(pause));
    provider(&state, &endpoint);
    let p = app::plan(&state, &r.id, "custom").unwrap();
    confirm(&state, &p.id);
    let request = app::start_with_key(&state, &p.id, |_| {
        Ok(zeroize::Zeroizing::new(String::new()))
    });
    let cancel = async {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        app::cancel(&state, &p.request_id).unwrap();
        release.send(()).unwrap();
    };
    let (outcome, _) = tokio::join!(request, cancel);
    assert!(outcome.is_err());
    thread.join().unwrap();
    assert!(inspect(&state, &target).llm.is_none());
    assert!(state.active_requests.lock().unwrap().is_empty());
}
