use crate::{error::AppError, parser, storage::Storage};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeProgress {
    pub pending: u32,
    pub completed: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

// Each IPC processes at most one source. Committed parser versions are the
// durable checkpoint; stopping between calls needs no background thread.
pub fn step(
    storage: &Storage,
    managed_root: &Path,
    process: bool,
    retry_failed: bool,
) -> Result<UpgradeProgress, AppError> {
    if retry_failed {
        storage.with_transaction(|db| {
            db.execute(
                "DELETE FROM knowledge_locator_jobs WHERE status='failed'",
                [],
            )?;
            Ok(())
        })?;
    }
    if process {
        let next=storage.with_read(|db|Ok(db.query_row("SELECT id FROM personal_knowledge WHERE status='ready' AND parser_version<>?1 AND id NOT IN (SELECT source_id FROM knowledge_locator_jobs WHERE status='failed') ORDER BY sequence LIMIT 1",[parser::LOCATED_PARSER_VERSION],|r|r.get::<_,String>(0)).optional()?))?;
        if let Some(id) = next {
            let outcome = (|| {
                let document = crate::repository::knowledge::get(storage, &id)?;
                let root = super::knowledge::root(managed_root)?;
                let path = super::knowledge::path(&root, &id, &document.source.format)?;
                let parsed = parser::parse_located(&path)?;
                if parsed.raw_hash != document.source.raw_hash {
                    return Err(AppError::FileConflict);
                }
                // A fallback is a completed source-level result, not an endless retry.
                let mut parsed = parsed;
                parsed.parser_version = parser::LOCATED_PARSER_VERSION.into();
                let json =
                    serde_json::to_string(&parsed).map_err(|_| AppError::StateUnavailable)?;
                storage.with_transaction(|db|{
                    db.execute("UPDATE personal_knowledge SET parsed_json=?2,parser_version=?3,extracted_hash=?4 WHERE id=?1 AND status='ready' AND raw_hash=?5",params![id,json,parsed.parser_version,parsed.extracted_hash,parsed.raw_hash])?;
                    db.execute("INSERT INTO knowledge_locator_jobs(source_id,status,error) VALUES (?1,'complete',NULL) ON CONFLICT(source_id) DO UPDATE SET status='complete',error=NULL",[&id])?;
                    Ok(())
                })
            })();
            if outcome.is_err() {
                storage.with_transaction(|db| {db.execute("INSERT INTO knowledge_locator_jobs(source_id,status,error) VALUES (?1,'failed','定位提取失败；原始资料已保留，可重试') ON CONFLICT(source_id) DO UPDATE SET status='failed',error=excluded.error",[&id])?;Ok(())})?;
            }
        }
    }
    storage.with_read(|db|{
        let pending=db.query_row("SELECT count(*) FROM personal_knowledge WHERE status='ready' AND parser_version<>?1 AND id NOT IN (SELECT source_id FROM knowledge_locator_jobs WHERE status='failed')",[parser::LOCATED_PARSER_VERSION],|r|r.get(0))?;
        let completed=db.query_row("SELECT count(*) FROM personal_knowledge WHERE status='ready' AND parser_version=?1",[parser::LOCATED_PARSER_VERSION],|r|r.get(0))?;
        let failed=db.query_row("SELECT count(*) FROM knowledge_locator_jobs WHERE status='failed'",[],|r|r.get(0))?;
        let mut s=db.prepare("SELECT p.title || '：' || j.error FROM knowledge_locator_jobs j JOIN personal_knowledge p ON p.id=j.source_id WHERE j.status='failed' ORDER BY p.sequence LIMIT 10")?;
        let errors=s.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        Ok(UpgradeProgress{pending,completed,failed,errors})
    })
}
