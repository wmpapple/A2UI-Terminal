use crate::{domain::citation::CitationSource, error::AppError, parser::Locator, storage::Storage};
use rusqlite::{params, OptionalExtension};

pub struct Fragment {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub workspace_id: String,
    pub source_hash: String,
    pub source_version: i64,
    pub text: String,
    pub content_hash: String,
    pub locator: Locator,
}

pub fn put_fragment(storage: &Storage, f: &Fragment) -> Result<(), AppError> {
    let locator = serde_json::to_string(&f.locator).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        db.execute(
            "INSERT OR IGNORE INTO knowledge_fragments VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                f.id,
                f.source_kind,
                f.source_id,
                f.workspace_id,
                f.source_hash,
                f.source_version,
                f.content_hash,
                f.text,
                locator
            ],
        )?;
        Ok(())
    })
}

pub fn fragment(storage: &Storage, id: &str) -> Result<Option<Fragment>, AppError> {
    storage.with_read(|db| {
        let row = db.query_row("SELECT source_kind,source_id,workspace_id,source_hash,source_version,content_hash,text,locator_json FROM knowledge_fragments WHERE id=?1", [id], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,String>(3)?, r.get::<_,i64>(4)?, r.get::<_,String>(5)?, r.get::<_,String>(6)?, r.get::<_,String>(7)?))).optional()?;
        row.map(|(source_kind,source_id,workspace_id,source_hash,source_version,content_hash,text,json)| Ok(Fragment { id:id.into(), source_kind,source_id,workspace_id,source_hash,source_version,content_hash,text,locator:serde_json::from_str(&json).map_err(|_|AppError::StateUnavailable)? })).transpose()
    })
}

pub fn register_request(
    storage: &Storage,
    request: &str,
    manifest: &str,
    workspace: &str,
    sources: &[CitationSource],
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute("INSERT INTO citation_requests(id,manifest_id,workspace_id) VALUES (?1,?2,?3)",params![request,manifest,workspace])?;
        for source in sources {
            db.execute("INSERT INTO request_citations(request_id,key,fragment_id,title,locator_json,unavailable_status) VALUES (?1,?2,?3,?4,?5, CASE WHEN (SELECT source_kind FROM knowledge_fragments WHERE id=?3)='workspace' THEN 'unauthorized' ELSE 'unavailable' END)",params![request,source.key,source.fragment_id,source.title,serde_json::to_string(&source.locator).map_err(|_|AppError::StateUnavailable)?])?;
        }
        Ok(())
    })
}

pub fn bind_output(
    storage: &Storage,
    kind: &str,
    id: &str,
    hash: &str,
    revision: Option<&str>,
    request: &str,
) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute("INSERT OR IGNORE INTO citation_outputs(owner_kind,owner_id,content_hash,revision_id,request_id) VALUES (?1,?2,?3,?4,?5)",params![kind,id,hash,revision.unwrap_or(hash),request])?;
        Ok(())
    })
}

pub fn output_request(
    storage: &Storage,
    kind: &str,
    id: &str,
    hash: &str,
) -> Result<Option<String>, AppError> {
    storage.with_read(|db| Ok(db.query_row("SELECT min(request_id) FROM citation_outputs WHERE owner_kind=?1 AND owner_id=?2 AND content_hash=?3 HAVING count(DISTINCT request_id)=1", params![kind,id,hash], |r|r.get(0)).optional()?))
}

pub fn output_request_for_revision(
    storage: &Storage,
    kind: &str,
    id: &str,
    hash: &str,
    revision: Option<&str>,
) -> Result<Option<String>, AppError> {
    if let Some(revision) = revision {
        let exact=storage.with_read(|db|Ok(db.query_row("SELECT request_id FROM citation_outputs WHERE owner_kind=?1 AND owner_id=?2 AND content_hash=?3 AND revision_id=?4",params![kind,id,hash,revision],|r|r.get(0)).optional()?))?;
        if exact.is_some() {
            return Ok(exact);
        }
    }
    output_request(storage, kind, id, hash)
}

pub fn has_output(storage: &Storage, kind: &str, id: &str) -> Result<bool, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT EXISTS(SELECT 1 FROM citation_outputs WHERE owner_kind=?1 AND owner_id=?2)",
            params![kind, id],
            |r| r.get(0),
        )?)
    })
}

pub fn sources(storage: &Storage, request: &str) -> Result<Vec<CitationSource>, AppError> {
    storage.with_read(|db| {
        let mut s=db.prepare("SELECT key,coalesce(fragment_id,''),title,locator_json FROM request_citations WHERE request_id=?1 ORDER BY key")?;
        let rows=s.query_map([request], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?)))?.collect::<Result<Vec<_>,_>>()?;
        rows.into_iter().map(|(key,fragment_id,title,json)|Ok(CitationSource{key,fragment_id,title,locator:serde_json::from_str(&json).map_err(|_|AppError::StateUnavailable)?})).collect()
    })
}

pub fn bind_review(storage: &Storage, review: &str, request: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute(
            "INSERT INTO citation_reviews VALUES (?1,?2)",
            params![review, request],
        )?;
        Ok(())
    })
}

pub fn review_request(storage: &Storage, review: &str) -> Result<Option<String>, AppError> {
    storage.with_read(|db| {
        Ok(db
            .query_row(
                "SELECT request_id FROM citation_reviews WHERE review_id=?1",
                [review],
                |r| r.get(0),
            )
            .optional()?)
    })
}

pub fn missing_status(storage: &Storage, request: &str, key: &str) -> Result<String, AppError> {
    storage.with_read(|db| {
        Ok(db.query_row(
            "SELECT unavailable_status FROM request_citations WHERE request_id=?1 AND key=?2",
            params![request, key],
            |r| r.get(0),
        )?)
    })
}

pub fn previously_known(
    storage: &Storage,
    kind: &str,
    id: &str,
    key: &str,
) -> Result<bool, AppError> {
    storage.with_read(|db|Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM citation_outputs o JOIN request_citations c ON c.request_id=o.request_id WHERE o.owner_kind=?1 AND o.owner_id=?2 AND c.key=?3)",params![kind,id,key],|r|r.get(0))?))
}
