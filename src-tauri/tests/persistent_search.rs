use a2ui_terminal_lib::{
    application::{result, search},
    domain::knowledge::{EditKnowledgeInput, KnowledgeDocument, KnowledgeSource},
    parser,
    repository::knowledge,
    storage::Storage,
};
use std::{path::Path, time::Instant};

fn document(id: usize, text: &str) -> KnowledgeDocument {
    let parsed = parser::parse_located_bytes(Path::new("sample.txt"), text.as_bytes()).unwrap();
    KnowledgeDocument {
        source: KnowledgeSource {
            id: format!("sample-{id}"),
            title: format!("Sample {id}"),
            format: "txt".into(),
            original_name: "sample.txt".into(),
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
    }
}

fn find(storage: &Storage, managed: &Path, query: &str) -> search::SearchAuthorizedContentOutput {
    search::search(
        storage,
        managed,
        search::SearchAuthorizedContentInput {
            workspace_id: None,
            query: query.into(),
            limit: Some(20),
        },
    )
    .unwrap()
}

#[test]
fn persistence_incremental_lifecycle_and_rebuild_preserve_sources() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.sqlite3");
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let storage = Storage::open(&path).unwrap();
    knowledge::insert_all(
        &storage,
        &[
            document(1, "预算发布 星河420 budget launch"),
            document(2, "天气预报 weather"),
        ],
    )
    .unwrap();
    assert_eq!(find(&storage, &managed, "预算").items[0].id, "sample-1");
    let observer = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        observer
            .query_row("SELECT sqlite_compileoption_used('ENABLE_FTS5')", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    // Any rewrite on restart/warm query is a regression, even if row IDs are reused.
    observer.execute_batch("CREATE TRIGGER detect_unnecessary_rebuild BEFORE INSERT ON search_chunks BEGIN SELECT RAISE(ABORT,'unexpected rebuild'); END;").unwrap();
    drop(storage);
    let storage = Storage::open(&path).unwrap();
    assert_eq!(
        find(&storage, &managed, "预算发布").index_mode,
        "persistent_lexical"
    );
    observer
        .execute_batch("DROP TRIGGER detect_unnecessary_rebuild;")
        .unwrap();
    knowledge::edit(
        &storage,
        EditKnowledgeInput {
            id: "sample-1".into(),
            title: "新标题银河".into(),
            tags: vec!["验收词条".into()],
        },
    )
    .unwrap();
    assert_eq!(
        find(&storage, &managed, "验收词条").items[0].title,
        "新标题银河"
    );
    knowledge::mark_unavailable(&storage, "sample-1", "deleting").unwrap();
    // Immediate physical removal, without a search or synchronization first.
    assert_eq!(
        observer
            .query_row(
                "SELECT count(*) FROM search_documents WHERE source_id='sample-1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert!(find(&storage, &managed, "预算").items.is_empty());
    let cleared = search::rebuild(&storage).unwrap();
    assert!(cleared.cleared_documents > 0);
    assert!(!cleared.result_data_changed);
    assert_eq!(find(&storage, &managed, "weather").items[0].id, "sample-2");
    // Incompatible index version is rebuilt automatically, once.
    observer
        .execute("UPDATE search_documents SET index_version=0", [])
        .unwrap();
    assert_eq!(find(&storage, &managed, "weather").items[0].id, "sample-2");
    assert_eq!(
        observer
            .query_row("SELECT min(index_version) FROM search_documents", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    storage.clear_all().unwrap();
    for table in ["search_documents", "search_chunks", "search_fts"] {
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
fn thousand_sources_ten_thousand_chunks_benchmark() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("benchmark.sqlite3");
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let storage = Storage::open(&path).unwrap();
    let observer = rusqlite::Connection::open(&path).unwrap();
    for (start, total) in [(0, 100), (100, 1000)] {
        let documents = (start..total)
            .map(|i| {
                let prefix = format!("项目星河 预算未批准 budget launch project unique{i} ");
                let text = format!("{prefix}{}", "ordinary progress report ".repeat(600));
                document(i, &text.chars().take(13_950).collect::<String>())
            })
            .collect::<Vec<_>>();
        knowledge::insert_all(&storage, &documents).unwrap();
        let cold_start = Instant::now();
        assert_eq!(
            find(&storage, &managed, "预算 launch").indexed_documents,
            total
        );
        let cold = cold_start.elapsed().as_secs_f64() * 1000.0;
        let chunks: i64 = observer
            .query_row("SELECT count(*) FROM search_chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(chunks, total as i64 * 10);
        observer.execute_batch("CREATE TRIGGER detect_benchmark_rebuild BEFORE INSERT ON search_chunks BEGIN SELECT RAISE(ABORT,'warm rebuilt'); END;").unwrap();
        let mut times = Vec::new();
        // Mix selective, common (all 10k fragments), Chinese and multi-term queries.
        for query in ["unique42", "预算发布", "ordinary", "budget launch"] {
            for _ in 0..5 {
                let now = Instant::now();
                let found = find(&storage, &managed, query);
                times.push(now.elapsed().as_secs_f64() * 1000.0);
                assert!(!found.items.is_empty());
            }
        }
        times.sort_by(f64::total_cmp);
        println!(
            "M5A_REPORT {}",
            serde_json::json!({"sources":total,"fragments":chunks,"samples":20,"coldMs":cold,"warmP50Ms":times[9],"warmP95Ms":times[18],"mode":"persistent_lexical","warmRebuilt":false})
        );
        assert!(times[18] <= 300.0, "warm p95 exceeded 300ms: {}", times[18]);
        observer
            .execute_batch("DROP TRIGGER detect_benchmark_rebuild;")
            .unwrap();
    }
}

#[test]
fn personal_knowledge_search_keeps_the_entire_previously_searchable_text() {
    let dir = tempfile::tempdir().unwrap();
    let managed = result::prepare_managed_results_dir(dir.path()).unwrap();
    let storage = Storage::open(&dir.path().join("long.sqlite3")).unwrap();
    let text = format!("{} tailbeyondtwomillion", "padding ".repeat(250_050));
    knowledge::insert_all(&storage, &[document(1, &text)]).unwrap();
    assert_eq!(
        find(&storage, &managed, "tailbeyondtwomillion").items[0].id,
        "sample-1"
    );
}
