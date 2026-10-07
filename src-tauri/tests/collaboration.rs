use a2ui_terminal_lib::{
    application::{collaboration as app, document, result, review},
    domain::{
        collaboration::*,
        document::DocumentTarget,
        result::{
            CreateTextResultInput, ResultType, SaveResultDocumentInput, SaveResultDraftInput,
            TextResultFormat,
        },
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision, ReviewRequest},
    },
    state::AppState,
    storage::Storage,
};

fn setup() -> (tempfile::TempDir, AppState, String) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    let doc = result::create_text(
        &state.storage,
        &state.managed_results_dir,
        CreateTextResultInput {
            title: "协作测试".into(),
            file_name: "report.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let id = doc.result.summary.id;
    save(&state, &id, "# 预算\n\n预算 420 元，尚未批准。🙂");
    (dir, state, id)
}
fn save(state: &AppState, id: &str, text: &str) {
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
fn text(state: &AppState, id: &str) -> String {
    result::read_document(&state.storage, &state.managed_results_dir, id)
        .unwrap()
        .content
}
fn share(state: &AppState, id: &str, permission: SharePermission) -> SharePackage {
    let s = document::snapshot(
        &state.storage,
        &state.managed_results_dir,
        &DocumentTarget::Result {
            result_id: id.into(),
        },
    )
    .unwrap();
    app::create_share(
        &state.storage,
        &state.managed_results_dir,
        CreateShareInput {
            result_id: id.into(),
            base_hash: s.content_hash,
            revision_id: s.revision_id.unwrap(),
            permission,
        },
    )
    .unwrap()
}
fn feedback(owner: &AppState, peer: &AppState, s: &SharePackage, proposal: Option<&str>) -> String {
    let bytes = app::export_package(&owner.storage, &s.id, false).unwrap();
    let inbox = app::import_bytes(&peer.storage, &bytes).unwrap();
    app::save_feedback(
        &peer.storage,
        SaveFeedbackInput {
            inbox_id: inbox.clone(),
            comments: "保留预算和否定关系。".into(),
            proposed_content: proposal.map(str::to_string),
        },
    )
    .unwrap();
    app::import_bytes(
        &owner.storage,
        &app::export_package(&peer.storage, &inbox, true).unwrap(),
    )
    .unwrap()
}
fn accept(state: &AppState, r: &ReviewRequest) {
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
                    file_name: None,
                })
                .collect(),
        },
    )
    .unwrap();
}
fn input(r: &ReviewRequest) -> ApplyReviewInput {
    ApplyReviewInput {
        review_id: r.id.clone(),
        workspace_id: r.workspace_id.clone(),
    }
}

#[test]
fn two_installations_roundtrip_requires_accept_and_supports_undo() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    assert_ne!(
        app::overview(&owner.storage, None).unwrap().identity.id,
        app::overview(&peer.storage, None).unwrap().identity.id
    );
    app::rename(&peer.storage, "审阅者小林").unwrap();
    let s = share(&owner, &id, SharePermission::Review);
    let peer_share = app::import_bytes(
        &peer.storage,
        &app::export_package(&owner.storage, &s.id, false).unwrap(),
    )
    .unwrap();
    let imported = app::overview(&peer.storage, None).unwrap();
    assert_eq!(imported.pending_count, 1);
    let item = imported
        .inbox
        .iter()
        .find(|item| item.id == peer_share)
        .unwrap();
    assert_eq!(item.status, "received");
    assert_eq!(item.permission, Some(SharePermission::Review));
    assert_eq!(item.sender_name.as_deref(), Some(s.sender_name.as_str()));
    let original = text(&owner, &id);
    let f = feedback(
        &owner,
        &peer,
        &s,
        Some("# 预算\n\n当前预算 420 元，仍未批准。🙂"),
    );
    assert_eq!(text(&owner, &id), original);
    let replied = app::overview(&peer.storage, None).unwrap();
    assert_eq!(replied.inbox[0].status, "replied");
    assert_eq!(replied.pending_count, 0);
    assert_eq!(
        app::overview(&owner.storage, None).unwrap().inbox[0].title,
        "协作测试"
    );
    assert_eq!(
        app::overview(&owner.storage, None).unwrap().inbox[0].status,
        "received"
    );
    let r = app::propose(&owner.storage, &owner.managed_results_dir, &f).unwrap();
    assert_eq!(
        r.id,
        app::propose(&owner.storage, &owner.managed_results_dir, &f)
            .unwrap()
            .id
    );
    assert!(review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).is_err());
    accept(&owner, &r);
    review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).unwrap();
    assert!(text(&owner, &id).contains("仍未批准"));
    assert_eq!(
        app::overview(&owner.storage, None).unwrap().inbox[0].status,
        "applied"
    );
    assert_eq!(
        app::overview(&owner.storage, None).unwrap().pending_count,
        0
    );
    // Repeated apply is idempotent; revocation cannot prevent the owner undoing their edit.
    review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).unwrap();
    app::revoke(&owner.storage, &s.id).unwrap();
    review::undo(&owner.storage, &owner.managed_results_dir, input(&r)).unwrap();
    assert_eq!(text(&owner, &id), original);
}

#[test]
fn comments_only_and_read_only_never_create_writes() {
    let (_a, owner, id) = setup();
    let (_b, peer, peer_id) = setup();
    let s = share(&owner, &id, SharePermission::Read);
    let read_id = app::import_bytes(
        &peer.storage,
        &app::export_package(&owner.storage, &s.id, false).unwrap(),
    )
    .unwrap();
    app::mark_handled(&peer.storage, &read_id).unwrap();
    assert_eq!(
        app::overview(&peer.storage, None).unwrap().inbox[0].status,
        "handled"
    );
    assert_eq!(app::overview(&peer.storage, None).unwrap().pending_count, 0);
    assert_eq!(text(&peer, &peer_id), "# 预算\n\n预算 420 元，尚未批准。🙂");
    assert!(app::save_feedback(
        &peer.storage,
        SaveFeedbackInput {
            inbox_id: s.id,
            comments: "hi".into(),
            proposed_content: None
        }
    )
    .is_err());
    let s = share(&owner, &id, SharePermission::Review);
    let f = feedback(&owner, &peer, &s, None);
    assert!(app::propose(&owner.storage, &owner.managed_results_dir, &f).is_err());
    assert_eq!(text(&owner, &id), s.content);
}

#[test]
fn rejected_feedback_leaves_the_result_unchanged_and_clears_pending_count() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    let s = share(&owner, &id, SharePermission::Review);
    let original = text(&owner, &id);
    let feedback_id = feedback(&owner, &peer, &s, Some("建议修改稿"));
    let proposal = app::propose(&owner.storage, &owner.managed_results_dir, &feedback_id).unwrap();
    review::discard(&owner.storage, &proposal.workspace_id, &proposal.id).unwrap();
    let overview = app::overview(&owner.storage, None).unwrap();
    assert_eq!(overview.inbox[0].status, "rejected");
    assert_eq!(overview.pending_count, 0);
    assert_eq!(text(&owner, &id), original);
}

#[test]
fn revocation_blocks_import_export_proposal_and_pending_apply() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    let s = share(&owner, &id, SharePermission::Review);
    let f = feedback(&owner, &peer, &s, Some("新稿"));
    let r = app::propose(&owner.storage, &owner.managed_results_dir, &f).unwrap();
    accept(&owner, &r);
    let bytes = app::export_package(&peer.storage, &s.id, true).unwrap();
    app::revoke(&owner.storage, &s.id).unwrap();
    assert!(app::import_bytes(&owner.storage, &bytes).is_err());
    assert!(app::export_package(&owner.storage, &s.id, false).is_err());
    assert!(app::propose(&owner.storage, &owner.managed_results_dir, &f).is_err());
    assert!(review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).is_err());
    assert_eq!(text(&owner, &id), s.content);
}

#[test]
fn stale_revision_even_identical_text_and_unsaved_drafts_block_apply() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    let s = share(&owner, &id, SharePermission::Review);
    let f = feedback(&owner, &peer, &s, Some("新稿"));
    let r = app::propose(&owner.storage, &owner.managed_results_dir, &f).unwrap();
    accept(&owner, &r);
    result::save_draft(
        &owner.storage,
        &owner.managed_results_dir,
        SaveResultDraftInput {
            result_id: id.clone(),
            base_hash: s.content_hash.clone(),
            content: "未保存".into(),
        },
    )
    .unwrap();
    assert!(review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).is_err());
    result::discard_draft(&owner.storage, &id).unwrap();
    save(&owner, &id, "另一个版本");
    save(&owner, &id, &s.content);
    assert!(app::propose(&owner.storage, &owner.managed_results_dir, &f).is_err());
    assert!(review::apply(&owner.storage, &owner.managed_results_dir, input(&r)).is_err());
    assert_eq!(text(&owner, &id), s.content);
}

#[test]
fn bounded_strict_packages_cannot_choose_local_targets_and_are_idempotent() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    let s = share(&owner, &id, SharePermission::Review);
    let bytes = app::export_package(&owner.storage, &s.id, false).unwrap();
    let json: String = String::from_utf8(bytes.clone()).unwrap();
    assert!(!json.contains(&id));
    assert!(!json.contains("workspaceId"));
    assert!(!json.contains("sourceRef"));
    app::import_bytes(&peer.storage, &bytes).unwrap();
    app::import_bytes(&peer.storage, &bytes).unwrap();
    assert_eq!(app::overview(&peer.storage, None).unwrap().inbox.len(), 1);
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    value["payload"]["resultId"] = id.into();
    assert!(app::import_bytes(&peer.storage, &serde_json::to_vec(&value).unwrap()).is_err());
    value["payload"].as_object_mut().unwrap().remove("resultId");
    value["payload"]["content"] = "伪造正文".into();
    assert!(app::import_bytes(&peer.storage, &serde_json::to_vec(&value).unwrap()).is_err());
    value["payload"]["contentHash"] = a2ui_terminal_lib::parser::hash("伪造正文".as_bytes()).into();
    assert!(app::import_bytes(&peer.storage, &serde_json::to_vec(&value).unwrap()).is_err()); // same ID, different bytes
    assert!(app::import_bytes(&peer.storage, &vec![b'a'; app::MAX_PACKAGE_BYTES + 1]).is_err());
    assert!(app::import_bytes(&peer.storage, b"{}").is_err());
    let f = feedback(&owner, &peer, &s, Some("review"));
    let unknown = app::export_package(&peer.storage, &s.id, true).unwrap();
    let (_c, stranger, _) = setup();
    assert!(app::import_bytes(&stranger.storage, &unknown).is_err());
    assert!(app::inbox(&owner.storage, &f).unwrap().reply.is_none());
}

#[test]
fn clear_all_rotates_identity_and_removes_collaboration_authority() {
    let (_a, owner, id) = setup();
    let (_b, peer, _) = setup();
    let s = share(&owner, &id, SharePermission::Review);
    let f = feedback(&owner, &peer, &s, Some("新稿"));
    let _ = app::propose(&owner.storage, &owner.managed_results_dir, &f).unwrap();
    let identity = app::overview(&owner.storage, None).unwrap().identity;
    owner.storage.clear_all().unwrap();
    let overview = app::overview(&owner.storage, None).unwrap();
    assert_ne!(identity.id, overview.identity.id);
    assert!(overview.inbox.is_empty());
    assert!(overview.shares.is_empty());
    assert!(app::export_package(&owner.storage, &s.id, false).is_err());
}

#[test]
fn migration_backfills_ownership_without_changing_existing_results() {
    let (dir, state, id) = setup();
    let original = text(&state, &id);
    drop(state);
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    db.execute_batch("DROP TRIGGER result_local_owner; DROP TABLE collaboration_reviews; DROP TABLE collaboration_inbox; DROP TABLE collaboration_shares; DROP TABLE collaboration_audit; DROP TABLE result_ownership; DROP TABLE collaboration_identity; DROP TABLE canvases; PRAGMA user_version=31;").unwrap();
    drop(db);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert_eq!(state.storage.schema_version().unwrap(), 35);
    assert_eq!(text(&state, &id), original);
    let s = share(&state, &id, SharePermission::Review);
    assert_eq!(s.content, original);
    state.storage.delete_result_entry(&id).unwrap();
    assert!(app::export_package(&state.storage, &s.id, false).is_err());
    assert!(app::overview(&state.storage, None)
        .unwrap()
        .shares
        .is_empty());
}
