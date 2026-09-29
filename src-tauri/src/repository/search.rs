use crate::{
    ai::retrieval::{chunk_text, tokenize},
    error::AppError,
    storage::Storage,
};
use rusqlite::params;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

// Bump whenever chunking, tokenization, or stored representation changes.
pub(crate) const INDEX_VERSION: i64 = 1;

pub(crate) fn generation(storage: &Storage) -> Result<i64, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT generation FROM search_state WHERE singleton=1",
            [],
            |r| r.get(0),
        )?)
    })
}

fn check_generation(db: &rusqlite::Connection, expected: i64) -> Result<(), AppError> {
    let current: i64 = db.query_row(
        "SELECT generation FROM search_state WHERE singleton=1",
        [],
        |r| r.get(0),
    )?;
    if current != expected {
        return Err(AppError::InvalidInput("资料已发生变化，请重新搜索".into()));
    }
    Ok(())
}

pub(crate) struct Document {
    pub key: String,
    pub kind: &'static str,
    pub source_id: String,
    pub fingerprint: String,
    // None means the durable fingerprint was checked and content is unchanged.
    pub content: Option<String>,
}

pub(crate) struct Hit {
    pub key: String,
    pub content: String,
    pub score: f64,
}

pub(crate) fn fingerprints(
    storage: &Storage,
    scope: &str,
) -> Result<BTreeMap<String, String>, AppError> {
    storage.with_read(|db| {
        let mut statement = db.prepare("SELECT source_key,fingerprint FROM search_documents WHERE scope=?1 AND index_version=?2")?;
        let rows = statement.query_map(params![scope,INDEX_VERSION], |r| Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        Ok(rows)
    })
}

// Encode each existing bigram/word as one ASCII token. This preserves the existing
// tokenizer exactly, including underscores/non-ASCII letters; user input can never
// become FTS operators, column names, or syntax.
fn encoded_terms(text: &str) -> Vec<String> {
    tokenize(text)
        .into_iter()
        .map(|term| {
            let mut encoded = String::from("t");
            for byte in term.as_bytes() {
                write!(&mut encoded, "{byte:02x}").expect("String write");
            }
            encoded
        })
        .collect()
}

pub(crate) fn synchronize(
    storage: &Storage,
    scope: &str,
    documents: &[Document],
    expected_generation: i64,
) -> Result<usize, AppError> {
    let existing = fingerprints(storage, scope)?;
    let changed = documents
        .iter()
        .filter(|d| existing.get(&d.key) != Some(&d.fingerprint))
        .collect::<Vec<_>>();
    let allowed = documents
        .iter()
        .map(|d| d.key.as_str())
        .collect::<BTreeSet<_>>();
    storage.with_transaction(|db| {
        check_generation(db, expected_generation)?;
        let mut statement = db.prepare("SELECT source_key FROM search_documents WHERE scope=?1")?;
        let old = statement
            .query_map([scope], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for key in old.iter().filter(|k| !allowed.contains(k.as_str())) {
            db.execute(
                "DELETE FROM search_documents WHERE scope=?1 AND source_key=?2",
                params![scope, key],
            )?;
        }
        Ok(())
    })?;
    // Small restartable batches bound token memory and lock time. Previously
    // completed batches survive process interruption; the next search resumes.
    for batch in changed.chunks(16) {
        let prepared = batch
            .iter()
            .map(|d| {
                let text = d.content.as_deref().ok_or(AppError::StateUnavailable)?;
                let chunks = chunk_text(text)
                    .into_iter()
                    .map(|c| {
                        let tokens = encoded_terms(&c.content).join(" ");
                        (c, tokens)
                    })
                    .collect::<Vec<_>>();
                Ok((*d, chunks))
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        storage.with_transaction(|db| {
            check_generation(db, expected_generation)?;
            for (document,chunks) in &prepared {
                db.execute("DELETE FROM search_documents WHERE scope=?1 AND source_key=?2",params![scope,document.key])?;
                db.execute("INSERT INTO search_documents(scope,source_key,kind,source_id,fingerprint,index_version) VALUES(?1,?2,?3,?4,?5,?6)",params![scope,document.key,document.kind,document.source_id,document.fingerprint,INDEX_VERSION])?;
                let id = db.last_insert_rowid();
                let mut insert = db.prepare_cached("INSERT INTO search_chunks(document_id,ordinal,start_character,end_character,text,tokens) VALUES(?1,?2,?3,?4,?5,?6)")?;
                for (ordinal,(chunk,tokens)) in chunks.iter().enumerate() {
                    insert.execute(params![id,ordinal as i64,chunk.start_character as i64,chunk.end_character as i64,chunk.content,tokens])?;
                }
            }
            Ok(())
        })?;
    }
    Ok(changed.len())
}

pub(crate) fn query(
    storage: &Storage,
    scope: &str,
    text: &str,
    limit: usize,
) -> Result<Vec<Hit>, AppError> {
    query_selected(storage, scope, text, limit, None)
}

pub(crate) fn query_selected(
    storage: &Storage,
    scope: &str,
    text: &str,
    limit: usize,
    keys: Option<&[String]>,
) -> Result<Vec<Hit>, AppError> {
    let keys = keys
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| AppError::StateUnavailable)?;
    let terms = encoded_terms(text).into_iter().collect::<BTreeSet<_>>();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let expression = terms.into_iter().collect::<Vec<_>>().join(" OR ");
    storage.with_read(|db| {
        // Materialize bm25 before windowing (FTS auxiliary functions require their
        // own MATCH cursor). Restrict scope BEFORE selecting the best per document.
        let mut statement = db.prepare("WITH matches AS MATERIALIZED (
            SELECT d.source_key,c.id AS chunk_id,c.ordinal,-bm25(search_fts) AS score
            FROM search_fts JOIN search_chunks c ON c.id=search_fts.rowid
            JOIN search_documents d ON d.id=c.document_id
            WHERE search_fts MATCH ?1 AND d.scope=?2 AND d.index_version=?3
              AND (?5 IS NULL OR d.source_key IN (SELECT value FROM json_each(?5)))
        ), best AS (
            SELECT *,row_number() OVER(PARTITION BY source_key ORDER BY score DESC,ordinal) AS n FROM matches
        ), top AS (
            SELECT source_key,chunk_id,score FROM best WHERE n=1 ORDER BY score DESC,source_key LIMIT ?4
        ) SELECT top.source_key,c.text,top.score FROM top JOIN search_chunks c ON c.id=top.chunk_id ORDER BY top.score DESC,top.source_key")?;
        let rows = statement.query_map(params![expression,scope,INDEX_VERSION,limit as i64,keys], |r|Ok(Hit {key:r.get(0)?,content:r.get(1)?,score:r.get(2)?}))?.collect::<Result<_,_>>()?;
        Ok(rows)
    })
}

pub(crate) fn clear(storage: &Storage) -> Result<usize, AppError> {
    storage.with_transaction(|db| {
        // Repair FTS from its content table before firing delete triggers. A
        // damaged/missing posting must not make the repair action itself fail.
        db.execute("INSERT INTO search_fts(search_fts) VALUES('rebuild')", [])?;
        let count = db.execute("DELETE FROM search_documents", [])?;
        // Rebuild the derived FTS structure too, including after index-only damage.
        db.execute("INSERT INTO search_fts(search_fts) VALUES('rebuild')", [])?;
        Ok(count)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::retrieval::rank_chunks;

    fn document(key: &str, text: &str) -> Document {
        Document {
            key: key.into(),
            kind: "knowledge",
            source_id: key.into(),
            fingerprint: text.into(),
            content: Some(text.into()),
        }
    }

    #[test]
    fn chinese_tokenization_matches_bigram_baseline_and_queries_are_literal() {
        let storage = Storage::open_in_memory().unwrap();
        let corpus = [
            document("budget", "预算讨论和发布计划 budget review and launch plan"),
            document("weather", "天气预报 weather forecast"),
            document("unicode", "école alpha_beta 金额420 归档 编号１２３"),
        ];
        synchronize(&storage, "global", &corpus, 0).unwrap();
        let old = corpus
            .iter()
            .enumerate()
            .map(|(i, d)| (i, d.key.clone(), chunk_text(d.content.as_deref().unwrap())))
            .collect::<Vec<_>>();
        for (text, expected) in [
            ("预算发布", "budget"),
            ("budget launch", "budget"),
            ("天气", "weather"),
            ("alpha_beta", "unicode"),
            ("420", "unicode"),
            ("ÉCOLE", "unicode"),
            ("１２３", "unicode"),
        ] {
            assert_eq!(rank_chunks(text, &old)[0].source_id, expected);
            assert_eq!(
                query(&storage, "global", text, 20).unwrap()[0].key,
                expected
            );
        }
        for text in ["\"", "***", "NOT", "tokens:secret", "\" OR 1=1 --"] {
            assert!(query(&storage, "global", text, 20).is_ok());
        }
        // Default unicode61 treats an uninterrupted CJK run as one token.
        storage.with_read(|db| {
            db.execute_batch("CREATE VIRTUAL TABLE raw_chinese USING fts5(text); INSERT INTO raw_chinese VALUES('预算讨论和发布计划');")?;
            let count: i64 = db.query_row("SELECT count(*) FROM raw_chinese WHERE raw_chinese MATCH '预算'",[],|r|r.get(0))?;
            assert_eq!(count,0);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn scopes_incremental_updates_and_failed_batch_are_isolated() {
        let storage = Storage::open_in_memory().unwrap();
        synchronize(&storage, "one", &[document("a", "privateone")], 0).unwrap();
        synchronize(&storage, "two", &[document("b", "privatetwo")], 0).unwrap();
        assert!(query(&storage, "one", "privatetwo", 20).unwrap().is_empty());
        assert_eq!(
            synchronize(&storage, "one", &[document("a", "privateone")], 0).unwrap(),
            0
        );
        synchronize(&storage, "one", &[document("a", "updated")], 0).unwrap();
        assert!(query(&storage, "one", "privateone", 20).unwrap().is_empty());
        assert_eq!(query(&storage, "two", "privatetwo", 20).unwrap().len(), 1);
        storage.with_transaction(|db| {
            db.execute_batch("CREATE TRIGGER fail_batch BEFORE INSERT ON search_chunks BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")?;
            Ok(())
        }).unwrap();
        assert!(synchronize(&storage, "one", &[document("a", "failure")], 0).is_err());
        assert_eq!(query(&storage, "one", "updated", 20).unwrap().len(), 1);
        storage
            .with_transaction(|db| {
                db.execute_batch("DROP TRIGGER fail_batch;")?;
                Ok(())
            })
            .unwrap();
        storage
            .create_standalone_workspace("w", "Workspace")
            .unwrap();
        assert!(synchronize(&storage, "one", &[document("a", "raced")], 0).is_err());
        assert_eq!(query(&storage, "one", "updated", 20).unwrap().len(), 1);
    }

    #[test]
    fn reset_repairs_missing_postings_and_clears_only_derived_data() {
        let storage = Storage::open_in_memory().unwrap();
        synchronize(&storage, "one", &[document("a", "visible")], 0).unwrap();
        storage
            .with_transaction(|db| {
                db.execute(
                    "INSERT INTO search_fts(search_fts) VALUES('delete-all')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(query(&storage, "one", "visible", 20).unwrap().is_empty());
        assert_eq!(clear(&storage).unwrap(), 1);
        synchronize(&storage, "one", &[document("a", "visible")], 0).unwrap();
        assert_eq!(query(&storage, "one", "visible", 20).unwrap().len(), 1);
    }
}
