use crate::{domain::knowledge::*, error::AppError, storage::Storage};
use rusqlite::{params, OptionalExtension};

const COLUMNS: &str = "id,title,format,original_name,raw_hash,extracted_hash,parser_version,source_version,tags_json,status,created_at,updated_at";

fn source(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeSource> {
    let tags: String = row.get(8)?;
    Ok(KnowledgeSource {
        id: row.get(0)?,
        title: row.get(1)?,
        format: row.get(2)?,
        original_name: row.get(3)?,
        raw_hash: row.get(4)?,
        extracted_hash: row.get(5)?,
        parser_version: row.get(6)?,
        source_version: row.get(7)?,
        tags: serde_json::from_str(&tags).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e))
        })?,
        status: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

pub fn list(storage: &Storage, input: ListKnowledgeInput) -> Result<KnowledgePage, AppError> {
    let limit = input.limit.unwrap_or(40);
    let query = input.query.unwrap_or_default();
    if limit == 0
        || limit > 100
        || query.chars().count() > 200
        || input.after.is_some_and(|n| n < 0)
    {
        return Err(AppError::InvalidInput("Invalid knowledge page".into()));
    }
    storage.with_read(|db| {
        let mut statement = db.prepare(&format!("SELECT {COLUMNS},sequence FROM personal_knowledge WHERE sequence > ?1 AND (?2 = '' OR instr(lower(title || ' ' || tags_json || ' ' || parsed_json), lower(?2)) > 0) ORDER BY sequence LIMIT ?3"))?;
        let rows = statement.query_map(params![input.after.unwrap_or(0),query.trim(),(limit + 1) as i64], |row| Ok((source(row)?, row.get::<_, i64>(12)?)))?.collect::<Result<Vec<_>,_>>()?;
        let next_cursor = if rows.len() > limit { Some(rows[limit - 1].1) } else { None };
        Ok(KnowledgePage { items: rows.into_iter().take(limit).map(|(s,_)|s).collect(), next_cursor })
    })
}

pub fn get(storage: &Storage, id: &str) -> Result<KnowledgeDocument, AppError> {
    storage.with_read(|db| {
        let (source, json) = db.query_row(&format!("SELECT {COLUMNS},parsed_json FROM personal_knowledge WHERE id = ?1 AND status = 'ready'"), [id], |row| Ok((source(row)?, row.get::<_,String>(12)?))).optional()?.ok_or_else(|| AppError::InvalidInput("Knowledge source unavailable".into()))?;
        let parsed = serde_json::from_str(&json).map_err(|_|AppError::StateUnavailable)?;
        Ok(KnowledgeDocument { source, parsed })
    })
}

pub fn insert_all(storage: &Storage, documents: &[KnowledgeDocument]) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        for document in documents {
            let s = &document.source;
            let json = serde_json::to_string(&document.parsed).map_err(|_|AppError::StateUnavailable)?;
            db.execute("INSERT INTO personal_knowledge(id,title,format,original_name,raw_hash,extracted_hash,parser_version,source_version,parsed_json,status) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,'ready')", params![s.id,s.title,s.format,s.original_name,s.raw_hash,s.extracted_hash,s.parser_version,json])?;
        }
        Ok(())
    })
}

pub fn duplicate(storage: &Storage, hash: &str) -> Result<Option<String>, AppError> {
    storage.with_read(|db| {
        Ok(db
            .query_row(
                "SELECT id FROM personal_knowledge WHERE raw_hash = ?1 AND status = 'ready'",
                [hash],
                |r| r.get(0),
            )
            .optional()?)
    })
}

pub fn edit(storage: &Storage, input: EditKnowledgeInput) -> Result<KnowledgeSource, AppError> {
    if input.title.trim().is_empty()
        || input.title.chars().count() > 160
        || input.tags.len() > 20
        || input
            .tags
            .iter()
            .any(|t| t.trim().is_empty() || t.chars().count() > 40)
    {
        return Err(AppError::InvalidInput("Title or tags exceed limits".into()));
    }
    let mut tags = input
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    let tags = serde_json::to_string(&tags).map_err(|_| AppError::StateUnavailable)?;
    storage.with_transaction(|db| {
        if db.execute("UPDATE personal_knowledge SET title=?2,tags_json=?3,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?1 AND status='ready'", params![input.id,input.title.trim(),tags])? != 1 {
            return Err(AppError::InvalidInput("Knowledge source unavailable".into()));
        }
        Ok(())
    })?;
    Ok(get(storage, &input.id)?.source)
}

pub fn files(storage: &Storage) -> Result<Vec<(String, String, String)>, AppError> {
    storage.with_read(|db| {
        let mut s = db.prepare("SELECT id,format,status FROM personal_knowledge")?;
        let rows = s
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn mark_unavailable(storage: &Storage, id: &str, status: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute("UPDATE personal_knowledge SET status=?2,parsed_json='',extracted_hash='',tags_json='[]' WHERE id=?1",params![id,status])?;
        Ok(())
    })
}

pub fn remove(storage: &Storage, id: &str) -> Result<(), AppError> {
    storage.with_transaction(|db| {
        db.execute(
            "DELETE FROM personal_knowledge WHERE id=?1 AND status='deleting'",
            [id],
        )?;
        Ok(())
    })
}
