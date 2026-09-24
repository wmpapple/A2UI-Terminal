use crate::domain::writing_profile::{
    SaveWritingProfileInput, TerminologyRule, WritingProfile, WritingProfileScope,
};
use crate::error::AppError;
use crate::storage::Storage;
use rusqlite::{params, OptionalExtension};

pub struct WritingProfileRepository<'a> {
    storage: &'a Storage,
}

impl<'a> WritingProfileRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn find(
        &self,
        scope: WritingProfileScope,
        workspace_id: Option<&str>,
    ) -> Result<Option<WritingProfile>, AppError> {
        let id = profile_id(scope, workspace_id)?;
        self.storage.with_read(|connection| {
            let row = connection
                .query_row(
                    "SELECT id, scope, workspace_id, enabled, version, rules,
                            terminology_json, forbidden_words_json, updated_at
                     FROM writing_profiles WHERE id = ?1",
                    [&id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, i64>(3)? != 0,
                            row.get::<_, u32>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                id,
                scope,
                workspace_id,
                enabled,
                version,
                rules,
                terms,
                forbidden,
                updated_at,
            )) = row
            else {
                return Ok(None);
            };
            let mut statement = connection.prepare(
                "SELECT source_id FROM writing_profile_examples
                 WHERE profile_id = ?1 ORDER BY position",
            )?;
            let example_knowledge_ids = statement
                .query_map([&id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Some(WritingProfile {
                id,
                scope: match scope.as_str() {
                    "global" => WritingProfileScope::Global,
                    "workspace" => WritingProfileScope::Workspace,
                    _ => return Err(AppError::StateUnavailable),
                },
                workspace_id,
                enabled,
                version,
                rules,
                terminology: serde_json::from_str::<Vec<TerminologyRule>>(&terms)
                    .map_err(|_| AppError::StateUnavailable)?,
                forbidden_words: serde_json::from_str::<Vec<String>>(&forbidden)
                    .map_err(|_| AppError::StateUnavailable)?,
                example_knowledge_ids,
                updated_at,
            }))
        })
    }

    pub fn save(&self, input: &SaveWritingProfileInput) -> Result<WritingProfile, AppError> {
        let id = profile_id(input.scope, input.workspace_id.as_deref())?;
        let terminology_json =
            serde_json::to_string(&input.terminology).map_err(|_| AppError::StateUnavailable)?;
        let forbidden_json = serde_json::to_string(&input.forbidden_words)
            .map_err(|_| AppError::StateUnavailable)?;
        self.storage.with_transaction(|transaction| {
            if let Some(workspace_id) = input.workspace_id.as_deref() {
                let exists = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1)",
                    [workspace_id],
                    |row| row.get::<_, bool>(0),
                )?;
                if !exists {
                    return Err(AppError::InvalidInput("工作区不存在".into()));
                }
            }
            for source_id in &input.example_knowledge_ids {
                let exists = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM personal_knowledge WHERE id = ?1 AND status = 'ready')",
                    [source_id],
                    |row| row.get::<_, bool>(0),
                )?;
                if !exists {
                    return Err(AppError::InvalidInput("范文资料不存在或已不可用".into()));
                }
            }
            transaction.execute(
                "INSERT INTO writing_profiles(
                    id, scope, workspace_id, enabled, version, rules,
                    terminology_json, forbidden_words_json
                 ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    enabled = excluded.enabled,
                    version = writing_profiles.version + 1,
                    rules = excluded.rules,
                    terminology_json = excluded.terminology_json,
                    forbidden_words_json = excluded.forbidden_words_json,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    id,
                    input.scope.as_str(),
                    input.workspace_id,
                    input.enabled,
                    input.rules,
                    terminology_json,
                    forbidden_json
                ],
            )?;
            transaction.execute(
                "DELETE FROM writing_profile_examples WHERE profile_id = ?1",
                [&id],
            )?;
            for (position, source_id) in input.example_knowledge_ids.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO writing_profile_examples(profile_id, source_id, position)
                     VALUES (?1, ?2, ?3)",
                    params![id, source_id, position as i64],
                )?;
            }
            Ok(())
        })?;
        self.find(input.scope, input.workspace_id.as_deref())?
            .ok_or(AppError::StateUnavailable)
    }

    pub fn delete(
        &self,
        scope: WritingProfileScope,
        workspace_id: Option<&str>,
    ) -> Result<(), AppError> {
        let id = profile_id(scope, workspace_id)?;
        self.storage.with_transaction(|transaction| {
            transaction.execute(
                "DELETE FROM writing_profile_examples WHERE profile_id = ?1",
                [&id],
            )?;
            if scope == WritingProfileScope::Global {
                transaction.execute(
                    "UPDATE writing_profiles SET enabled = 0, version = version + 1,
                        rules = '', terminology_json = '[]', forbidden_words_json = '[]',
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE id = 'global'",
                    [],
                )?;
            } else {
                transaction.execute("DELETE FROM writing_profiles WHERE id = ?1", [&id])?;
            }
            Ok(())
        })
    }
}

pub fn profile_id(
    scope: WritingProfileScope,
    workspace_id: Option<&str>,
) -> Result<String, AppError> {
    match scope {
        WritingProfileScope::Global if workspace_id.is_none() => Ok("global".into()),
        WritingProfileScope::Workspace => workspace_id
            .filter(|value| !value.trim().is_empty() && value.len() <= 128)
            .map(|value| format!("workspace:{value}"))
            .ok_or_else(|| AppError::InvalidInput("Workspace Profile 需要有效工作区".into())),
        _ => Err(AppError::InvalidInput(
            "Global Profile 不能绑定工作区".into(),
        )),
    }
}
