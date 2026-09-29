use a2ui_terminal_lib::{
    ai::{
        embedding::{EmbeddingFuture, EmbeddingProvider, HttpEmbeddingProvider},
        ProviderConfig, ProviderKind,
    },
    application::{
        result, search,
        semantic_search::{self as semantic, EmbeddingConfig, PlanInput},
    },
    domain::knowledge::{KnowledgeDocument, KnowledgeSource},
    error::AppError,
    parser,
    repository::knowledge,
    state::AppState,
    storage::Storage,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Instant,
};

fn setup(dir: &Path, endpoint: &str) -> AppState {
    let storage = Storage::open(&dir.join("test.sqlite3")).unwrap();
    storage
        .save_provider_config(&ProviderConfig {
            id: "m5b-eval".into(),
            kind: ProviderKind::Custom,
            endpoint: endpoint.into(),
            model: "chat-unused".into(),
            temperature: 0.0,
            proxy_url: None,
        })
        .unwrap();
    AppState::new(storage, result::prepare_managed_results_dir(dir).unwrap())
}
fn seed(state: &AppState, id: &str, text: &str) {
    let parsed = parser::parse_located_bytes(Path::new("source.txt"), text.as_bytes()).unwrap();
    knowledge::insert_all(
        &state.storage,
        &[KnowledgeDocument {
            source: KnowledgeSource {
                id: id.into(),
                title: format!("资料 {id}"),
                format: "txt".into(),
                original_name: "source.txt".into(),
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
fn input(query: &str) -> PlanInput {
    PlanInput {
        search: search::SearchAuthorizedContentInput {
            workspace_id: None,
            query: query.into(),
            limit: Some(20),
        },
        config: EmbeddingConfig {
            provider_id: "m5b-eval".into(),
            model: "embedding-fixture".into(),
            revision: "fixture-v1".into(),
            dimensions: 2,
            location: "local".into(),
        },
        source_keys: None,
    }
}
struct Fake {
    calls: AtomicUsize,
    fail: bool,
}

struct DeleteDuringRequest<'a> {
    state: &'a AppState,
}
impl EmbeddingProvider for DeleteDuringRequest<'_> {
    fn embed<'a>(
        &'a self,
        _: &'a ProviderConfig,
        texts: &'a [String],
        _: usize,
        _: Arc<AtomicBool>,
    ) -> EmbeddingFuture<'a> {
        Box::pin(async move {
            knowledge::mark_unavailable(&self.state.storage, "first", "deleting")?;
            Ok(texts.iter().map(|_| vec![1.0, 0.0]).collect())
        })
    }
}

#[tokio::test]
async fn removal_during_request_discards_vectors_and_stale_results() {
    let dir = tempfile::tempdir().unwrap();
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    seed(&state, "first", "预算 420");
    let plan = semantic::plan(&state, input("预算")).unwrap();
    assert!(semantic::step_with_provider(
        &state,
        &plan.id,
        true,
        &DeleteDuringRequest { state: &state }
    )
    .await
    .is_err());
    let observer = rusqlite::Connection::open(dir.path().join("test.sqlite3")).unwrap();
    assert_eq!(
        observer
            .query_row("SELECT count(*) FROM embedding_vectors", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
impl EmbeddingProvider for Fake {
    fn embed<'a>(
        &'a self,
        _: &'a ProviderConfig,
        texts: &'a [String],
        _: usize,
        _: Arc<AtomicBool>,
    ) -> EmbeddingFuture<'a> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err(AppError::InvalidInput("offline fixture".into()))
            } else {
                Ok(texts.iter().map(|_| vec![1.0, 0.0]).collect())
            }
        })
    }
}

struct CancelDuringRequest;
impl EmbeddingProvider for CancelDuringRequest {
    fn embed<'a>(
        &'a self,
        _: &'a ProviderConfig,
        texts: &'a [String],
        _: usize,
        cancelled: Arc<AtomicBool>,
    ) -> EmbeddingFuture<'a> {
        Box::pin(async move {
            cancelled.store(true, Ordering::Release);
            // Even an adapter which returns a late successful response cannot commit it.
            Ok(texts.iter().map(|_| vec![1.0, 0.0]).collect())
        })
    }
}

#[tokio::test]
async fn completed_batches_survive_restart_but_cancelled_responses_do_not_commit() {
    let dir = tempfile::tempdir().unwrap();
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    for index in 0..10 {
        seed(
            &state,
            &format!("source{index}"),
            &format!("预算 420，项目 {index}"),
        );
    }
    let adapter = Fake {
        calls: AtomicUsize::new(0),
        fail: false,
    };
    let plan = semantic::plan(&state, input("预算")).unwrap();
    let progress = semantic::step_with_provider(&state, &plan.id, true, &adapter)
        .await
        .unwrap();
    assert_eq!(
        (progress.completed, progress.total, progress.done),
        (8, 10, false)
    );
    drop(state);
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    assert!(state.semantic_searches.lock().unwrap().is_empty());
    let plan = semantic::plan(&state, input("预算")).unwrap();
    assert_eq!(plan.missing_chunks, 2);
    assert!(matches!(
        semantic::step_with_provider(&state, &plan.id, true, &CancelDuringRequest).await,
        Err(AppError::RequestCancelled)
    ));
    let next = semantic::plan(&state, input("预算")).unwrap();
    assert_eq!(next.missing_chunks, 2);
    let progress = semantic::step_with_provider(&state, &next.id, true, &adapter)
        .await
        .unwrap();
    assert_eq!(progress.completed, 10);
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn explicit_consent_cache_restart_change_delete_and_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    seed(&state, "first", "预算发布测试");
    seed(&state, "second", "天气晴朗");
    let adapter = Fake {
        calls: AtomicUsize::new(0),
        fail: false,
    };
    let plan = semantic::plan(&state, input("预算")).unwrap();
    assert_eq!(plan.missing_chunks, 2);
    assert!(
        semantic::step_with_provider(&state, &plan.id, false, &adapter)
            .await
            .is_err()
    );
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 0);
    assert!(
        !semantic::step_with_provider(&state, &plan.id, true, &adapter)
            .await
            .unwrap()
            .done
    );
    let done = semantic::step_with_provider(&state, &plan.id, true, &adapter)
        .await
        .unwrap();
    assert_eq!(done.result.unwrap().index_mode, "hybrid");
    assert_eq!(adapter.calls.load(Ordering::SeqCst), 2);
    assert!(state.semantic_searches.lock().unwrap().is_empty());
    drop(state);
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    let plan = semantic::plan(&state, input("预算")).unwrap();
    assert_eq!(plan.missing_chunks, 0);
    let offline = Fake {
        calls: AtomicUsize::new(0),
        fail: true,
    };
    let fallback = semantic::step_with_provider(&state, &plan.id, true, &offline)
        .await
        .unwrap();
    assert!(fallback.fallback_reason.is_some());
    assert_eq!(fallback.result.unwrap().items[0].id, "first");
    let mut changed = input("预算");
    changed.config.revision = "changed".into();
    let plan = semantic::plan(&state, changed).unwrap();
    assert_eq!(plan.missing_chunks, 2);
    semantic::cancel(&state, &plan.id).unwrap();
    assert!(
        semantic::step_with_provider(&state, &plan.id, true, &adapter)
            .await
            .is_err()
    );
    let plan = semantic::plan(&state, input("预算")).unwrap();
    knowledge::mark_unavailable(&state.storage, "first", "deleting").unwrap();
    assert!(
        semantic::step_with_provider(&state, &plan.id, true, &adapter)
            .await
            .is_err()
    );
    let observer = rusqlite::Connection::open(dir.path().join("test.sqlite3")).unwrap();
    assert_eq!(
        observer
            .query_row("SELECT count(*) FROM embedding_vectors", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    state.storage.clear_all().unwrap();
    for table in [
        "embedding_vectors",
        "embedding_models",
        "embedding_settings",
    ] {
        assert_eq!(
            observer
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn selected_scope_precedes_ranking_and_changed_provider_cannot_send() {
    let dir = tempfile::tempdir().unwrap();
    let state = setup(dir.path(), "http://127.0.0.1:1/v1");
    for i in 0..30 {
        seed(&state, &format!("source{i}"), &format!("预算 项目编号 {i}"));
    }
    let mut request = input("预算");
    request.source_keys = Some(vec!["knowledge:source29".into()]);
    let plan = semantic::plan(&state, request.clone()).unwrap();
    assert_eq!(plan.sources.len(), 1);
    let offline = Fake {
        calls: AtomicUsize::new(0),
        fail: true,
    };
    let out = semantic::step_with_provider(&state, &plan.id, true, &offline)
        .await
        .unwrap();
    assert_eq!(out.result.unwrap().items[0].id, "source29");
    let plan = semantic::plan(&state, request).unwrap();
    state
        .storage
        .save_provider_config(&ProviderConfig {
            id: "m5b-eval".into(),
            kind: ProviderKind::Custom,
            endpoint: "https://example.com/v1".into(),
            model: "other".into(),
            temperature: 0.0,
            proxy_url: None,
        })
        .unwrap();
    assert!(
        semantic::step_with_provider(&state, &plan.id, true, &offline)
            .await
            .is_err()
    );
    assert_eq!(offline.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "Requires the explicitly started local real-model evaluation server"]
async fn real_model_fixed_retrieval_eval() {
    let endpoint = std::env::var("M5B_EMBEDDING_ENDPOINT")
        .expect("Start scripts/semantic-eval-server.mjs first");
    assert!(endpoint.starts_with("http://127.0.0.1:"));
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../evals/retrieval/cases.json")).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let state = setup(dir.path(), &endpoint);
    for source in fixture["sources"].as_array().unwrap() {
        seed(
            &state,
            source["id"].as_str().unwrap(),
            source["text"].as_str().unwrap(),
        );
    }
    let adapter = HttpEmbeddingProvider {
        key_source: |_| Ok(zeroize::Zeroizing::new(String::new())),
    };
    let mut cases = Vec::new();
    let mut lexical_mrr = 0.0;
    let mut hybrid_mrr = 0.0;
    for case in fixture["queries"].as_array().unwrap() {
        let query = case["query"].as_str().unwrap();
        let relevant = case["relevant"].as_str().unwrap();
        let mut request = input(query);
        request.config.dimensions = 384;
        request.config.model = "multilingual-minilm".into();
        request.config.revision = "2c4055b12046f11709e9df2c122e59ffbdc2f900".into();
        let lexical = search::search(
            &state.storage,
            &state.managed_results_dir,
            request.search.clone(),
        )
        .unwrap();
        let plan = semantic::plan(&state, request).unwrap();
        let started = Instant::now();
        let hybrid = loop {
            let step = semantic::step_with_provider(&state, &plan.id, true, &adapter)
                .await
                .unwrap();
            assert!(step.fallback_reason.is_none(), "{:?}", step.fallback_reason);
            if step.done {
                break step.result.unwrap();
            }
        };
        let rank = |items: &[search::SearchAuthorizedContentItem]| {
            items
                .iter()
                .take(5)
                .position(|i| i.id == relevant)
                .map(|i| i + 1)
        };
        let l = rank(&lexical.items);
        let h = rank(&hybrid.items);
        lexical_mrr += l.map(|r| 1.0 / r as f64).unwrap_or(0.0);
        hybrid_mrr += h.map(|r| 1.0 / r as f64).unwrap_or(0.0);
        cases.push(serde_json::json!({"query":query,"relevant":relevant,"lexicalRank":l,"hybridRank":h,"elapsedMs":started.elapsed().as_secs_f64()*1000.0,"newChunks":plan.missing_chunks}));
    }
    let n = cases.len() as f64;
    lexical_mrr /= n;
    hybrid_mrr /= n;
    let report = serde_json::json!({"fixture":"retrieval-v1","realModel":true,"remoteInference":false,"queries":cases.len(),"lexicalMrrAt5":lexical_mrr,"hybridMrrAt5":hybrid_mrr,"cases":cases});
    std::fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../logs/m5b-quality.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("M5B_QUALITY {}", report);
    assert!(
        hybrid_mrr > lexical_mrr + 0.05,
        "Hybrid must measurably improve the fixed set"
    );
    assert!(hybrid_mrr >= 0.75, "Minimum MRR@5");
}
