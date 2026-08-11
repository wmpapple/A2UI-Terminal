use crate::ai::{default_providers, ProviderConfig, ProviderKind, ProviderMessage};
use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 6;
const MIGRATION_V1: &str = include_str!("../../migrations/0001_initial.sql");
const MIGRATION_V2: &str = include_str!("../../migrations/0002_workspace_drafts.sql");
const MIGRATION_V3: &str = include_str!("../../migrations/0003_providers_and_chat.sql");
const MIGRATION_V4: &str = include_str!("../../migrations/0004_standalone_workspaces.sql");
const MIGRATION_V5: &str = include_str!("../../migrations/0005_semantic_patches.sql");
const MIGRATION_V6: &str = include_str!("../../migrations/0006_a2ui_runtime.sql");

#[derive(Debug, Clone)]
pub struct WorkspaceRow {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct WorkspaceFileRow {
    pub source_id: String,
    pub workspace_id: String,
    pub absolute_path: String,
    pub virtual_path: String,
}

fn workspace_file_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceFileRow> {
    Ok(WorkspaceFileRow {
        source_id: row.get(0)?,
        workspace_id: row.get(1)?,
        absolute_path: row.get(2)?,
        virtual_path: row.get(3)?,
    })
}

#[derive(Debug, Clone)]
pub struct DraftRow {
    pub content: String,
    pub base_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub role: String,
    pub content: String,
    pub status: String,
    pub request_id: Option<String>,
    pub provider_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionRecord {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatMessageRecord>,
}

#[derive(Debug, Clone)]
pub struct PatchOperationRecord {
    pub workspace_id: String,
    pub summary: String,
    pub patch_json: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct PatchSnapshot {
    pub id: String,
    pub operation_id: String,
    pub workspace_id: String,
    pub relative_path: String,
    pub content: String,
    pub content_hash: String,
    pub version_kind: String,
}

#[derive(Debug, Clone)]
pub struct A2uiSurfaceRow {
    pub id: String,
    pub surface_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub message_id: String,
    pub revision: u64,
    pub state_json: String,
    pub raw_message: String,
    pub validation_json: String,
}

#[derive(Debug, Clone)]
pub struct A2uiInspectionRow {
    pub id: String,
    pub message_id: String,
    pub surface_id: Option<String>,
    pub raw_message: String,
    pub valid: bool,
    pub validation_json: String,
    pub duration_ms: u64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct A2uiEventRow {
    pub id: String,
    pub component_id: String,
    pub event_name: String,
    pub action_type: String,
    pub risk: String,
    pub decision: String,
    pub payload_json: String,
    pub duration_ms: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCounts {
    pub workspaces: u64,
    pub sessions: u64,
    pub messages: u64,
    pub workspace_drafts: u64,
    pub document_versions: u64,
    pub patch_operations: u64,
    pub a2ui_surfaces: u64,
    pub a2ui_messages: u64,
    pub a2ui_events: u64,
    pub configured_providers: u64,
}

fn a2ui_surface_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<A2uiSurfaceRow> {
    Ok(A2uiSurfaceRow {
        id: row.get(0)?,
        surface_id: row.get(1)?,
        workspace_id: row.get(2)?,
        session_id: row.get(3)?,
        message_id: row.get(4)?,
        revision: row.get::<_, i64>(5)?.max(0) as u64,
        state_json: row.get(6)?,
        raw_message: row.get(7)?,
        validation_json: row.get(8)?,
    })
}

pub struct Storage {
    connection: Mutex<Connection>,
}

impl Storage {
    pub fn open(database_path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(database_path)?;
        Self::configure(&connection)?;
        Self::migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn schema_version(&self) -> Result<i64, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn diagnostic_counts(&self) -> Result<DiagnosticCounts, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let count = |table: &str| -> Result<u64, AppError> {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            Ok(connection
                .query_row(&sql, [], |row| row.get::<_, i64>(0))?
                .max(0) as u64)
        };

        Ok(DiagnosticCounts {
            workspaces: count("workspaces")?,
            sessions: count("sessions")?,
            messages: count("messages")?,
            workspace_drafts: count("workspace_drafts")?,
            document_versions: count("document_versions")?,
            patch_operations: count("patch_operations")?,
            a2ui_surfaces: count("a2ui_surfaces")?,
            a2ui_messages: count("a2ui_messages")?,
            a2ui_events: count("a2ui_events")?,
            configured_providers: count("credential_refs")?,
        })
    }

    pub fn provider_ids(&self) -> Result<Vec<String>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare("SELECT provider_id FROM credential_refs")?;
        let rows = statement.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<Result<Vec<String>, _>>()?)
    }

    pub fn ensure_default_providers(&self) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        for config in default_providers() {
            connection.execute(
                "INSERT OR IGNORE INTO provider_settings
                 (id, provider_type, endpoint, model, temperature, proxy_url)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    config.id,
                    config.kind.as_str(),
                    config.endpoint,
                    config.model,
                    config.temperature,
                    config.proxy_url
                ],
            )?;
        }
        connection.execute(
            "UPDATE provider_settings
             SET model = 'Qwen/Qwen3.5-35B-A3B', updated_at = CURRENT_TIMESTAMP
             WHERE id = 'siliconflow' AND model = 'Pro/zai-org/GLM-4.7'",
            [],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO app_settings(key, value_json) VALUES ('active_provider', '\"siliconflow\"')",
            [],
        )?;
        Ok(())
    }

    pub fn provider_configs(&self) -> Result<Vec<ProviderConfig>, AppError> {
        self.ensure_default_providers()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, provider_type, endpoint, model, temperature, proxy_url
             FROM provider_settings ORDER BY CASE id
             WHEN 'siliconflow' THEN 1 WHEN 'deepseek' THEN 2
             WHEN 'openai' THEN 3 ELSE 4 END, id",
        )?;
        let rows = statement.query_map([], |row| {
            let kind = row.get::<_, String>(1)?;
            Ok((
                row.get::<_, String>(0)?,
                kind,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?;
        rows.map(|row| {
            let (id, kind, endpoint, model, temperature, proxy_url) = row?;
            Ok(ProviderConfig {
                id,
                kind: ProviderKind::parse(&kind)?,
                endpoint,
                model,
                temperature,
                proxy_url,
            })
        })
        .collect()
    }

    pub fn provider_config(&self, provider_id: &str) -> Result<Option<ProviderConfig>, AppError> {
        self.ensure_default_providers()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let row = connection
            .query_row(
                "SELECT id, provider_type, endpoint, model, temperature, proxy_url
                 FROM provider_settings WHERE id = ?1",
                [provider_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?;
        row.map(|(id, kind, endpoint, model, temperature, proxy_url)| {
            Ok(ProviderConfig {
                id,
                kind: ProviderKind::parse(&kind)?,
                endpoint,
                model,
                temperature,
                proxy_url,
            })
        })
        .transpose()
    }

    pub fn save_provider_config(&self, config: &ProviderConfig) -> Result<(), AppError> {
        config.validate()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO provider_settings
             (id, provider_type, endpoint, model, temperature, proxy_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                provider_type = excluded.provider_type,
                endpoint = excluded.endpoint,
                model = excluded.model,
                temperature = excluded.temperature,
                proxy_url = excluded.proxy_url,
                updated_at = CURRENT_TIMESTAMP",
            params![
                config.id,
                config.kind.as_str(),
                config.endpoint,
                config.model,
                config.temperature,
                config.proxy_url
            ],
        )?;
        Ok(())
    }

    pub fn active_provider_id(&self) -> Result<String, AppError> {
        self.ensure_default_providers()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let value: String = connection.query_row(
            "SELECT value_json FROM app_settings WHERE key = 'active_provider'",
            [],
            |row| row.get(0),
        )?;
        serde_json::from_str(&value)
            .map_err(|_| AppError::InvalidInput("活动 Provider 设置无效".into()))
    }

    pub fn set_active_provider(&self, provider_id: &str) -> Result<(), AppError> {
        if self.provider_config(provider_id)?.is_none() {
            return Err(AppError::InvalidInput("Provider 不存在".into()));
        }
        let value = serde_json::to_string(provider_id)
            .map_err(|_| AppError::InvalidInput("Provider 标识无法保存".into()))?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO app_settings(key, value_json) VALUES ('active_provider', ?1)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
             updated_at = CURRENT_TIMESTAMP",
            [value],
        )?;
        Ok(())
    }

    pub fn create_session(
        &self,
        workspace_id: &str,
        session_id: &str,
        title: &str,
    ) -> Result<ChatSessionRecord, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO sessions(id, workspace_id, title) VALUES (?1, ?2, ?3)",
            params![session_id, workspace_id, title],
        )?;
        drop(connection);
        self.session(session_id)?
            .ok_or_else(|| AppError::StateUnavailable)
    }

    pub fn sessions(&self, workspace_id: &str) -> Result<Vec<ChatSessionRecord>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, workspace_id, title, created_at, updated_at FROM sessions
             WHERE workspace_id = ?1 ORDER BY updated_at DESC, id",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        let sessions = rows.collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        drop(connection);
        sessions
            .into_iter()
            .map(|(id, workspace_id, title, created_at, updated_at)| {
                Ok(ChatSessionRecord {
                    messages: self.messages(&id)?,
                    id,
                    workspace_id,
                    title,
                    created_at,
                    updated_at,
                })
            })
            .collect()
    }

    pub fn session(&self, session_id: &str) -> Result<Option<ChatSessionRecord>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let row = connection
            .query_row(
                "SELECT id, workspace_id, title, created_at, updated_at FROM sessions WHERE id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        drop(connection);
        row.map(|(id, workspace_id, title, created_at, updated_at)| {
            Ok(ChatSessionRecord {
                messages: self.messages(&id)?,
                id,
                workspace_id,
                title,
                created_at,
                updated_at,
            })
        })
        .transpose()
    }

    pub fn recent_chat_messages(
        &self,
        session_id: &str,
        limit: u32,
    ) -> Result<Vec<ProviderMessage>, AppError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT role, body FROM (
               SELECT role, body, created_at, id FROM messages
               WHERE session_id = ?1 AND role IN ('user', 'assistant')
                 AND status IN ('complete', 'stopped') AND body <> ''
               ORDER BY created_at DESC, id DESC LIMIT ?2
             ) ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement.query_map(params![session_id, limit.min(20)], |row| {
            Ok(ProviderMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_chat_request(
        &self,
        workspace_id: &str,
        session_id: &str,
        request_id: &str,
        user_message_id: &str,
        assistant_message_id: &str,
        provider_id: &str,
        prompt: &str,
        sources_json: &str,
        character_count: usize,
        estimated_tokens: usize,
        has_sensitive_warning: bool,
    ) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let session_workspace: Option<String> = transaction
            .query_row(
                "SELECT workspace_id FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .optional()?;
        if session_workspace.as_deref() != Some(workspace_id) {
            return Err(AppError::InvalidInput("会话不属于当前工作区".into()));
        }
        transaction.execute(
            "INSERT INTO messages
             (id, session_id, role, body, status, request_id, provider_id)
             VALUES (?1, ?2, 'user', ?3, 'complete', ?4, ?5)",
            params![user_message_id, session_id, prompt, request_id, provider_id],
        )?;
        transaction.execute(
            "INSERT INTO messages
             (id, session_id, role, body, status, request_id, provider_id)
             VALUES (?1, ?2, 'assistant', '', 'streaming', ?3, ?4)",
            params![assistant_message_id, session_id, request_id, provider_id],
        )?;
        transaction.execute(
            "INSERT INTO context_snapshots
             (id, session_id, request_id, sources_json, character_count,
              estimated_tokens, has_sensitive_warning)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                request_id,
                sources_json,
                character_count as i64,
                estimated_tokens as i64,
                has_sensitive_warning
            ],
        )?;
        let title = prompt.trim().chars().take(36).collect::<String>();
        transaction.execute(
            "UPDATE sessions SET
               title = CASE
                 WHEN (SELECT COUNT(*) FROM messages WHERE session_id = ?1 AND role = 'user') = 1
                 THEN ?2 ELSE title END,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![session_id, title],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn update_assistant_message(
        &self,
        message_id: &str,
        body: &str,
        status: &str,
        error_code: Option<&str>,
    ) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "UPDATE messages SET body = ?2, status = ?3, error_code = ?4 WHERE id = ?1",
            params![message_id, body, status, error_code],
        )?;
        Ok(())
    }

    fn messages(&self, session_id: &str) -> Result<Vec<ChatMessageRecord>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, role, body, status, request_id, provider_id, error_code, created_at
             FROM messages WHERE session_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([session_id], |row| {
            Ok(ChatMessageRecord {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                status: row.get(3)?,
                request_id: row.get(4)?,
                provider_id: row.get(5)?,
                error_code: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_workspace(
        &self,
        proposed_id: &str,
        name: &str,
        root_path: &str,
    ) -> Result<WorkspaceRow, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let existing_id = connection
            .query_row(
                "SELECT id FROM workspaces WHERE root_path = ?1",
                [root_path],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let id = existing_id.as_deref().unwrap_or(proposed_id);
        connection.execute(
            "INSERT INTO workspaces(id, name, root_path)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                root_path = excluded.root_path,
                updated_at = CURRENT_TIMESTAMP",
            params![id, name, root_path],
        )?;
        if existing_id.is_some() {
            connection.execute(
                "UPDATE workspaces SET name = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![id, name],
            )?;
        }
        Ok(WorkspaceRow {
            id: id.to_string(),
            name: name.to_string(),
            root_path: root_path.to_string(),
            kind: "directory".to_string(),
        })
    }

    pub fn create_standalone_workspace(
        &self,
        workspace_id: &str,
        name: &str,
    ) -> Result<WorkspaceRow, AppError> {
        let root_path = format!("a2ui://standalone/{workspace_id}");
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO workspaces(id, name, root_path, kind) VALUES (?1, ?2, ?3, 'standalone')",
            params![workspace_id, name, root_path],
        )?;
        Ok(WorkspaceRow {
            id: workspace_id.to_string(),
            name: name.to_string(),
            root_path,
            kind: "standalone".to_string(),
        })
    }

    pub fn attach_workspace_file(
        &self,
        workspace_id: &str,
        source_id: &str,
        absolute_path: &str,
        virtual_path: &str,
    ) -> Result<WorkspaceFileRow, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO workspace_files(source_id, workspace_id, absolute_path, virtual_path)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(workspace_id, absolute_path) DO NOTHING",
            params![source_id, workspace_id, absolute_path, virtual_path],
        )?;
        connection
            .query_row(
                "SELECT source_id, workspace_id, absolute_path, virtual_path
             FROM workspace_files WHERE workspace_id = ?1 AND absolute_path = ?2",
                params![workspace_id, absolute_path],
                workspace_file_from_row,
            )
            .map_err(AppError::from)
    }

    pub fn workspace_files(&self, workspace_id: &str) -> Result<Vec<WorkspaceFileRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT source_id, workspace_id, absolute_path, virtual_path
             FROM workspace_files WHERE workspace_id = ?1 ORDER BY created_at, virtual_path",
        )?;
        let rows = statement.query_map([workspace_id], workspace_file_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn workspace_file(
        &self,
        workspace_id: &str,
        virtual_path: &str,
    ) -> Result<Option<WorkspaceFileRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT source_id, workspace_id, absolute_path, virtual_path
                 FROM workspace_files WHERE workspace_id = ?1 AND virtual_path = ?2",
                params![workspace_id, virtual_path],
                workspace_file_from_row,
            )
            .optional()?)
    }

    pub fn workspace_file_by_source(
        &self,
        source_id: &str,
    ) -> Result<Option<WorkspaceFileRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT source_id, workspace_id, absolute_path, virtual_path
                 FROM workspace_files WHERE source_id = ?1",
                [source_id],
                workspace_file_from_row,
            )
            .optional()?)
    }

    pub fn workspace(&self, workspace_id: &str) -> Result<Option<WorkspaceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, name, root_path, kind FROM workspaces WHERE id = ?1",
                [workspace_id],
                |row| {
                    Ok(WorkspaceRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        kind: row.get(3)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn recent_workspaces(&self, limit: usize) -> Result<Vec<WorkspaceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, name, root_path, kind FROM workspaces
             ORDER BY updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit.min(20) as i64], |row| {
            Ok(WorkspaceRow {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                kind: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn touch_workspace(&self, workspace_id: &str) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "UPDATE workspaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [workspace_id],
        )?;
        Ok(())
    }

    pub fn remove_workspace(&self, workspace_id: &str) -> Result<bool, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])? > 0)
    }

    pub fn save_draft(
        &self,
        workspace_id: &str,
        relative_path: &str,
        content: &str,
        base_hash: &str,
    ) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO workspace_drafts(workspace_id, relative_path, content, base_hash)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(workspace_id, relative_path) DO UPDATE SET
                content = excluded.content,
                base_hash = excluded.base_hash,
                updated_at = CURRENT_TIMESTAMP",
            params![workspace_id, relative_path, content, base_hash],
        )?;
        Ok(())
    }

    pub fn draft(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<Option<DraftRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT content, base_hash, updated_at FROM workspace_drafts
                 WHERE workspace_id = ?1 AND relative_path = ?2",
                params![workspace_id, relative_path],
                |row| {
                    Ok(DraftRow {
                        content: row.get(0)?,
                        base_hash: row.get(1)?,
                        updated_at: row.get(2)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn delete_draft(&self, workspace_id: &str, relative_path: &str) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "DELETE FROM workspace_drafts WHERE workspace_id = ?1 AND relative_path = ?2",
            params![workspace_id, relative_path],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_patch_operation(
        &self,
        operation_id: &str,
        workspace_id: &str,
        session_id: Option<&str>,
        assistant_message_id: Option<&str>,
        summary: &str,
        patch_json: &str,
        undo_of: Option<&str>,
        snapshots: &[PatchSnapshot],
    ) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        if let Some(undo_target) = undo_of {
            let changed = transaction.execute(
                "UPDATE patch_operations SET status = 'undone'
                 WHERE id = ?1 AND workspace_id = ?2 AND status = 'applied'",
                params![undo_target, workspace_id],
            )?;
            if changed != 1 {
                return Err(AppError::InvalidInput("Patch 已撤销或不存在".into()));
            }
        }
        transaction.execute(
            "INSERT INTO patch_operations
             (id, workspace_id, session_id, assistant_message_id, summary, patch_json, undo_of)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                operation_id,
                workspace_id,
                session_id,
                assistant_message_id,
                summary,
                patch_json,
                undo_of
            ],
        )?;
        for snapshot in snapshots {
            transaction.execute(
                "INSERT INTO document_versions
                 (id, workspace_id, relative_path, content, content_hash, expires_at,
                  operation_id, version_kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'), ?6, ?7)",
                params![
                    snapshot.id,
                    snapshot.workspace_id,
                    snapshot.relative_path,
                    snapshot.content.as_bytes(),
                    snapshot.content_hash,
                    snapshot.operation_id,
                    snapshot.version_kind
                ],
            )?;
        }
        transaction.execute(
            "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [session_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn patch_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<PatchOperationRecord>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT workspace_id, summary, patch_json, status
                 FROM patch_operations WHERE id = ?1",
                [operation_id],
                |row| {
                    Ok(PatchOperationRecord {
                        workspace_id: row.get(0)?,
                        summary: row.get(1)?,
                        patch_json: row.get(2)?,
                        status: row.get(3)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn patch_snapshots(&self, operation_id: &str) -> Result<Vec<PatchSnapshot>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, operation_id, workspace_id, relative_path, content,
                    content_hash, version_kind
             FROM document_versions WHERE operation_id = ?1
             ORDER BY relative_path, version_kind",
        )?;
        let rows = statement.query_map([operation_id], |row| {
            let bytes: Vec<u8> = row.get(4)?;
            let content = String::from_utf8(bytes).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Blob,
                    Box::new(error),
                )
            })?;
            Ok(PatchSnapshot {
                id: row.get(0)?,
                operation_id: row.get(1)?,
                workspace_id: row.get(2)?,
                relative_path: row.get(3)?,
                content,
                content_hash: row.get(5)?,
                version_kind: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn cleanup_expired_versions(&self) -> Result<usize, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection.execute(
            "DELETE FROM document_versions WHERE expires_at <= CURRENT_TIMESTAMP",
            [],
        )?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_a2ui_surface(
        &self,
        row_id: &str,
        surface_id: &str,
        workspace_id: &str,
        session_id: &str,
        message_id: &str,
        revision: u64,
        state_json: &str,
        raw_message: &str,
        validation_json: &str,
        inspection_id: &str,
        duration_ms: u64,
    ) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let existing_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM a2ui_surfaces WHERE workspace_id = ?1 AND surface_id = ?2",
                params![workspace_id, surface_id],
                |row| row.get(0),
            )
            .optional()?;
        let stable_row_id = existing_id.as_deref().unwrap_or(row_id);
        transaction.execute(
            "INSERT INTO a2ui_surfaces
             (id, surface_id, workspace_id, session_id, message_id, protocol_version,
              revision, state_json, raw_message, validation_json)
             VALUES (?1, ?2, ?3, ?4, ?5, '1.0', ?6, ?7, ?8, ?9)
             ON CONFLICT(workspace_id, surface_id) DO UPDATE SET
                session_id = excluded.session_id,
                message_id = excluded.message_id,
                protocol_version = excluded.protocol_version,
                revision = excluded.revision,
                state_json = excluded.state_json,
                raw_message = excluded.raw_message,
                validation_json = excluded.validation_json,
                updated_at = CURRENT_TIMESTAMP",
            params![
                stable_row_id,
                surface_id,
                workspace_id,
                session_id,
                message_id,
                revision as i64,
                state_json,
                raw_message,
                validation_json
            ],
        )?;
        transaction.execute(
            "INSERT INTO a2ui_messages
             (id, workspace_id, session_id, message_id, surface_id, raw_message,
              valid, validation_json, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
            params![
                inspection_id,
                workspace_id,
                session_id,
                message_id,
                surface_id,
                raw_message,
                validation_json,
                duration_ms as i64
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_invalid_a2ui_message(
        &self,
        inspection_id: &str,
        workspace_id: &str,
        session_id: &str,
        message_id: &str,
        surface_id: Option<&str>,
        raw_message: &str,
        validation_json: &str,
        duration_ms: u64,
    ) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO a2ui_messages
             (id, workspace_id, session_id, message_id, surface_id, raw_message,
              valid, validation_json, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
            params![
                inspection_id,
                workspace_id,
                session_id,
                message_id,
                surface_id,
                raw_message,
                validation_json,
                duration_ms as i64
            ],
        )?;
        Ok(())
    }

    pub fn a2ui_surface(
        &self,
        workspace_id: &str,
        surface_id: &str,
    ) -> Result<Option<A2uiSurfaceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, surface_id, workspace_id, session_id, message_id, revision,
                        state_json, raw_message, validation_json
                 FROM a2ui_surfaces WHERE workspace_id = ?1 AND surface_id = ?2",
                params![workspace_id, surface_id],
                a2ui_surface_from_row,
            )
            .optional()?)
    }

    pub fn a2ui_surfaces(&self, workspace_id: &str) -> Result<Vec<A2uiSurfaceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, surface_id, workspace_id, session_id, message_id, revision,
                    state_json, raw_message, validation_json
             FROM a2ui_surfaces WHERE workspace_id = ?1 ORDER BY updated_at DESC, surface_id",
        )?;
        let rows = statement.query_map([workspace_id], a2ui_surface_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn a2ui_inspections(&self, workspace_id: &str) -> Result<Vec<A2uiInspectionRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, message_id, surface_id, raw_message, valid, validation_json,
                    duration_ms, created_at
             FROM a2ui_messages WHERE workspace_id = ?1 ORDER BY created_at DESC, id DESC
             LIMIT 100",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(A2uiInspectionRow {
                id: row.get(0)?,
                message_id: row.get(1)?,
                surface_id: row.get(2)?,
                raw_message: row.get(3)?,
                valid: row.get::<_, i64>(4)? != 0,
                validation_json: row.get(5)?,
                duration_ms: row.get::<_, i64>(6)?.max(0) as u64,
                created_at: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn a2ui_events(&self, surface_row_id: &str) -> Result<Vec<A2uiEventRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, component_id, event_name, action_type, risk, decision,
                    payload_json, duration_ms, created_at
             FROM a2ui_events WHERE surface_row_id = ?1
             ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = statement.query_map([surface_row_id], |row| {
            Ok(A2uiEventRow {
                id: row.get(0)?,
                component_id: row.get(1)?,
                event_name: row.get(2)?,
                action_type: row.get(3)?,
                risk: row.get(4)?,
                decision: row.get(5)?,
                payload_json: row.get(6)?,
                duration_ms: row.get::<_, i64>(7)?.max(0) as u64,
                created_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_a2ui_action(
        &self,
        surface_row_id: &str,
        new_state_json: Option<&str>,
        event_id: &str,
        component_id: &str,
        event_name: &str,
        action_type: &str,
        risk: &str,
        decision: &str,
        payload_json: &str,
        duration_ms: u64,
    ) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        if let Some(state_json) = new_state_json {
            transaction.execute(
                "UPDATE a2ui_surfaces SET state_json = ?2, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?1",
                params![surface_row_id, state_json],
            )?;
        }
        transaction.execute(
            "INSERT INTO a2ui_events
             (id, surface_row_id, component_id, event_name, action_type, risk,
              decision, payload_json, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                event_id,
                surface_row_id,
                component_id,
                event_name,
                action_type,
                risk,
                decision,
                payload_json,
                duration_ms as i64
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn remember_provider_id(&self, provider_id: &str) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT OR IGNORE INTO credential_refs(provider_id) VALUES (?1)",
            [provider_id],
        )?;
        Ok(())
    }

    pub fn forget_provider_id(&self, provider_id: &str) -> Result<(), AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "DELETE FROM credential_refs WHERE provider_id = ?1",
            [provider_id],
        )?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "DELETE FROM a2ui_events;
             DELETE FROM a2ui_messages;
             DELETE FROM a2ui_surfaces;
             DELETE FROM workspace_drafts;
             DELETE FROM workspace_files;
             DELETE FROM audit_events;
             DELETE FROM document_versions;
             DELETE FROM patch_operations;
             DELETE FROM messages;
             DELETE FROM sessions;
             DELETE FROM workspaces;
             DELETE FROM credential_refs;
             DELETE FROM provider_settings;
             DELETE FROM app_settings;",
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn configure(connection: &Connection) -> Result<(), AppError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;
        Ok(())
    }

    fn migrate(connection: &Connection) -> Result<(), AppError> {
        let current =
            connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?;
        if current > SCHEMA_VERSION {
            return Err(AppError::InvalidInput(format!(
                "Database schema version {current} is newer than supported version {SCHEMA_VERSION}"
            )));
        }
        if current < 1 {
            connection.execute_batch(MIGRATION_V1)?;
        }
        if current < 2 {
            connection.execute_batch(MIGRATION_V2)?;
        }
        if current < 3 {
            connection.execute_batch(MIGRATION_V3)?;
        }
        if current < 4 {
            connection.execute_batch(MIGRATION_V4)?;
        }
        if current < 5 {
            connection.execute_batch(MIGRATION_V5)?;
        }
        if current < 6 {
            connection.execute_batch(MIGRATION_V6)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory()?;
        Self::configure(&connection)?;
        Self::migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn table_exists(&self, table: &str) -> Result<bool, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false))
    }
}

#[cfg(test)]
mod tests {
    use super::{Storage, MIGRATION_V1, SCHEMA_VERSION};

    #[test]
    fn applies_initial_schema_once() {
        let storage = Storage::open_in_memory().expect("migration should succeed");

        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        for table in [
            "workspaces",
            "sessions",
            "messages",
            "document_versions",
            "credential_refs",
            "provider_settings",
            "app_settings",
            "audit_events",
            "workspace_drafts",
            "context_snapshots",
            "patch_operations",
            "a2ui_surfaces",
            "a2ui_messages",
            "a2ui_events",
        ] {
            assert!(
                storage.table_exists(table).unwrap(),
                "missing table {table}"
            );
        }
    }

    #[test]
    fn clear_all_preserves_schema() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        storage.clear_all().expect("clear should succeed");

        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        assert!(storage.table_exists("workspaces").unwrap());
    }

    #[test]
    fn diagnostics_expose_counts_without_record_contents() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        storage
            .upsert_workspace(
                "workspace-diagnostic",
                "Private project",
                "C:\\private\\project",
            )
            .unwrap();
        let counts = storage.diagnostic_counts().unwrap();

        assert_eq!(counts.workspaces, 1);
        let serialized = serde_json::to_string(&counts).unwrap();
        assert!(!serialized.contains("Private project"));
        assert!(!serialized.contains("C:\\\\private"));
    }

    #[test]
    fn cleanup_removes_only_expired_document_versions() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        storage
            .upsert_workspace("workspace-expiry", "Project", "C:\\expiry-project")
            .unwrap();
        {
            let connection = storage.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO document_versions
                     (id, workspace_id, relative_path, content, content_hash, expires_at)
                     VALUES ('expired', 'workspace-expiry', 'a.ts', X'61', 'hash', datetime('now', '-1 day')),
                            ('current', 'workspace-expiry', 'a.ts', X'62', 'hash', datetime('now', '+1 day'))",
                    [],
                )
                .unwrap();
        }
        assert_eq!(storage.cleanup_expired_versions().unwrap(), 1);
        let connection = storage.connection.lock().unwrap();
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM document_versions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 1);
    }

    #[test]
    fn removing_workspace_cascades_drafts_without_touching_project_paths() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        let workspace = storage
            .upsert_workspace("workspace-1", "Project", "C:\\project")
            .unwrap();
        storage
            .save_draft(&workspace.id, "src/main.ts", "draft", "base-hash")
            .unwrap();

        assert!(storage.remove_workspace(&workspace.id).unwrap());
        assert!(storage.workspace(&workspace.id).unwrap().is_none());
        assert!(storage
            .draft(&workspace.id, "src/main.ts")
            .unwrap()
            .is_none());
    }

    #[test]
    fn persists_complete_chat_bodies_and_context_metadata() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        let workspace = storage
            .upsert_workspace(
                "550e8400-e29b-41d4-a716-446655440000",
                "Project",
                "C:\\chat-project",
            )
            .unwrap();
        let session = storage
            .create_session(
                &workspace.id,
                "550e8400-e29b-41d4-a716-446655440001",
                "New chat",
            )
            .unwrap();
        storage
            .start_chat_request(
                &workspace.id,
                &session.id,
                "550e8400-e29b-41d4-a716-446655440002",
                "550e8400-e29b-41d4-a716-446655440003",
                "550e8400-e29b-41d4-a716-446655440004",
                "openai",
                "完整用户消息",
                r#"[{"label":"src/main.ts","contentHash":"hash"}]"#,
                12,
                5,
                false,
            )
            .unwrap();
        storage
            .update_assistant_message(
                "550e8400-e29b-41d4-a716-446655440004",
                "完整助手回复",
                "complete",
                None,
            )
            .unwrap();

        let sessions = storage.sessions(&workspace.id).unwrap();
        assert_eq!(sessions[0].messages.len(), 2);
        assert_eq!(sessions[0].messages[0].content, "完整用户消息");
        assert_eq!(sessions[0].messages[1].content, "完整助手回复");
        assert_eq!(sessions[0].messages[1].status, "complete");
    }

    #[test]
    fn provider_settings_contain_only_non_secret_configuration() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        storage.ensure_default_providers().unwrap();
        let configs = storage.provider_configs().unwrap();
        assert_eq!(configs.len(), 4);
        assert_eq!(storage.active_provider_id().unwrap(), "siliconflow");
        assert!(!MIGRATION_V1.to_ascii_lowercase().contains("api_key"));
    }

    #[test]
    fn replaces_only_the_deprecated_siliconflow_default_model() {
        let storage = Storage::open_in_memory().expect("migration should succeed");
        let mut config = storage.provider_config("siliconflow").unwrap().unwrap();
        config.model = "Pro/zai-org/GLM-4.7".into();
        storage.save_provider_config(&config).unwrap();

        storage.ensure_default_providers().unwrap();
        assert_eq!(
            storage
                .provider_config("siliconflow")
                .unwrap()
                .unwrap()
                .model,
            "Qwen/Qwen3.5-35B-A3B"
        );

        config.model = "Qwen/custom-model".into();
        storage.save_provider_config(&config).unwrap();
        storage.ensure_default_providers().unwrap();
        assert_eq!(
            storage
                .provider_config("siliconflow")
                .unwrap()
                .unwrap()
                .model,
            "Qwen/custom-model"
        );
    }
}
