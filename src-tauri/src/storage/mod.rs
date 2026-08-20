use crate::ai::{default_providers, ProviderConfig, ProviderKind, ProviderMessage};
use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

const SCHEMA_VERSION: i64 = 10;
const MIGRATION_V1: &str = include_str!("../../migrations/0001_initial.sql");
const MIGRATION_V2: &str = include_str!("../../migrations/0002_workspace_drafts.sql");
const MIGRATION_V3: &str = include_str!("../../migrations/0003_providers_and_chat.sql");
const MIGRATION_V4: &str = include_str!("../../migrations/0004_standalone_workspaces.sql");
const MIGRATION_V5: &str = include_str!("../../migrations/0005_semantic_patches.sql");
const MIGRATION_V6: &str = include_str!("../../migrations/0006_a2ui_runtime.sql");
const MIGRATION_V7: &str = include_str!("../../migrations/0007_document_history.sql");
const MIGRATION_V8: &str = include_str!("../../migrations/0008_crash_recovery.sql");
const MIGRATION_V9: &str = include_str!("../../migrations/0009_results.sql");
const MIGRATION_V10: &str = include_str!("../../migrations/0010_tasks_and_templates.sql");
const MIGRATIONS: &[(i64, &str)] = &[
    (1, MIGRATION_V1),
    (2, MIGRATION_V2),
    (3, MIGRATION_V3),
    (4, MIGRATION_V4),
    (5, MIGRATION_V5),
    (6, MIGRATION_V6),
    (7, MIGRATION_V7),
    (8, MIGRATION_V8),
    (9, MIGRATION_V9),
    (10, MIGRATION_V10),
];

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

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

pub struct NewWorkspaceFileRow<'a> {
    pub source_id: &'a str,
    pub absolute_path: &'a str,
    pub virtual_path: &'a str,
}

fn workspace_file_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceFileRow> {
    Ok(WorkspaceFileRow {
        source_id: row.get(0)?,
        workspace_id: row.get(1)?,
        absolute_path: row.get(2)?,
        virtual_path: row.get(3)?,
    })
}

fn document_version_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentVersionRecord> {
    let bytes: Vec<u8> = row.get(3)?;
    let content = String::from_utf8(bytes).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Blob, Box::new(error))
    })?;
    Ok(DocumentVersionRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        relative_path: row.get(2)?,
        content,
        content_hash: row.get(4)?,
        source: row.get(5)?,
        summary: row.get(6)?,
        version_kind: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn document_version_metadata_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<DocumentVersionMetadata> {
    Ok(DocumentVersionMetadata {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        relative_path: row.get(2)?,
        content_hash: row.get(3)?,
        source: row.get(4)?,
        summary: row.get(5)?,
        version_kind: row.get(6)?,
        created_at: row.get(7)?,
    })
}

#[derive(Debug, Clone)]
pub struct DraftRow {
    pub relative_path: String,
    pub content: String,
    pub content_hash: String,
    pub base_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct DraftSummaryRow {
    pub relative_path: String,
    pub content_hash: String,
    pub base_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersionRecord {
    pub id: String,
    pub workspace_id: String,
    pub relative_path: String,
    pub content: String,
    pub content_hash: String,
    pub source: String,
    pub summary: Option<String>,
    pub version_kind: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentVersionMetadata {
    pub id: String,
    pub workspace_id: String,
    pub relative_path: String,
    pub content_hash: String,
    pub source: String,
    pub summary: Option<String>,
    pub version_kind: String,
    pub created_at: String,
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

#[derive(Debug, Clone)]
pub struct ResultRow {
    pub id: String,
    pub workspace_id: String,
    pub result_type: String,
    pub title: String,
    pub status: String,
    pub storage_kind: String,
    pub storage_ref: String,
    pub current_revision_id: Option<String>,
    pub active_session_id: Option<String>,
    pub a2ui_surface_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub managed_state_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResultSourceRow {
    pub result: ResultRow,
    pub source_kind: String,
    pub source_ref: String,
}

pub struct NewManagedResultRow<'a> {
    pub result_id: &'a str,
    pub workspace_id: &'a str,
    pub title: &'a str,
    pub storage_ref: &'a str,
    pub source_ref: &'a str,
    pub managed_state_json: &'a str,
    pub revision_id: &'a str,
    pub content: &'a str,
    pub content_hash: &'a str,
}

#[derive(Debug, Clone)]
pub struct TaskTemplateRow {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub task_kind: String,
    pub desired_result_type: String,
    pub field_schema_json: String,
    pub default_sections_json: String,
    pub risk_level: String,
    pub builtin: bool,
}

#[derive(Debug, Clone)]
pub struct TaskRow {
    pub id: String,
    pub workspace_id: String,
    pub template_id: String,
    pub template_version: u32,
    pub task_kind: String,
    pub desired_result_type: String,
    pub status: String,
    pub input_answers_json: String,
    pub question_count: u32,
    pub result_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

pub struct NewTaskRow<'a> {
    pub id: &'a str,
    pub workspace_id: &'a str,
    pub template_id: &'a str,
    pub template_version: u32,
    pub task_kind: &'a str,
    pub desired_result_type: &'a str,
    pub status: &'a str,
    pub input_answers_json: &'a str,
    pub question_count: u32,
}

pub struct ManagedTaskResultRow<'a> {
    pub result_id: &'a str,
    pub task_id: &'a str,
    pub workspace_id: &'a str,
    pub title: &'a str,
    pub storage_ref: &'a str,
    pub source_ref: &'a str,
    pub managed_state_json: &'a str,
    pub revision_id: &'a str,
    pub content: &'a str,
    pub content_hash: &'a str,
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
    pub tasks: u64,
    pub results: u64,
}

fn result_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResultRow> {
    Ok(ResultRow {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        result_type: row.get(2)?,
        title: row.get(3)?,
        status: row.get(4)?,
        storage_kind: row.get(5)?,
        storage_ref: row.get(6)?,
        current_revision_id: row.get(7)?,
        active_session_id: row.get(8)?,
        a2ui_surface_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
        managed_state_json: row.get(13)?,
    })
}

fn result_source_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResultSourceRow> {
    Ok(ResultSourceRow {
        result: result_from_row(row)?,
        source_kind: row.get(14)?,
        source_ref: row.get(15)?,
    })
}

fn task_template_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskTemplateRow> {
    Ok(TaskTemplateRow {
        id: row.get(0)?,
        version: row.get::<_, i64>(1)?.max(0) as u32,
        name: row.get(2)?,
        description: row.get(3)?,
        task_kind: row.get(4)?,
        desired_result_type: row.get(5)?,
        field_schema_json: row.get(6)?,
        default_sections_json: row.get(7)?,
        risk_level: row.get(8)?,
        builtin: row.get::<_, i64>(9)? != 0,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        template_id: row.get(2)?,
        template_version: row.get::<_, i64>(3)?.max(0) as u32,
        task_kind: row.get(4)?,
        desired_result_type: row.get(5)?,
        status: row.get(6)?,
        input_answers_json: row.get(7)?,
        question_count: row.get::<_, i64>(8)?.max(0) as u32,
        result_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
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

        let mut connection = Connection::open(database_path)?;
        Self::verify_integrity(&connection)?;
        Self::configure(&connection)?;
        Self::migrate(&mut connection)?;
        Self::backfill_draft_hashes(&mut connection)?;
        Self::verify_integrity(&connection)?;
        Self::verify_foreign_keys(&connection)?;
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
            tasks: count("tasks")?,
            results: count("results")?,
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
        context_snapshot_id: &str,
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
                context_snapshot_id,
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

    pub fn ensure_managed_results_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspaceRow, AppError> {
        let root_path = "a2ui://managed-results";
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO workspaces(id, name, root_path, kind)
             VALUES (?1, '我的成果', ?2, 'standalone')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![workspace_id, root_path],
        )?;
        Ok(WorkspaceRow {
            id: workspace_id.to_string(),
            name: "我的成果".to_string(),
            root_path: root_path.to_string(),
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

    pub fn attach_workspace_files(
        &self,
        workspace_id: &str,
        files: &[NewWorkspaceFileRow<'_>],
    ) -> Result<Vec<WorkspaceFileRow>, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let mut rows = Vec::with_capacity(files.len());
        for file in files {
            transaction.execute(
                "INSERT INTO workspace_files(source_id, workspace_id, absolute_path, virtual_path)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(workspace_id, absolute_path) DO NOTHING",
                params![
                    file.source_id,
                    workspace_id,
                    file.absolute_path,
                    file.virtual_path
                ],
            )?;
            rows.push(transaction.query_row(
                "SELECT source_id, workspace_id, absolute_path, virtual_path
                 FROM workspace_files WHERE workspace_id = ?1 AND absolute_path = ?2",
                params![workspace_id, file.absolute_path],
                workspace_file_from_row,
            )?);
        }
        transaction.execute(
            "UPDATE workspaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [workspace_id],
        )?;
        transaction.commit()?;
        Ok(rows)
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

    pub fn revoke_workspace_file(
        &self,
        workspace_id: &str,
        source_id: &str,
    ) -> Result<bool, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let removed = transaction.execute(
            "DELETE FROM workspace_files WHERE workspace_id = ?1 AND source_id = ?2",
            params![workspace_id, source_id],
        )? > 0;
        if removed {
            transaction.execute(
                "UPDATE workspaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                [workspace_id],
            )?;
        }
        transaction.commit()?;
        Ok(removed)
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
             WHERE root_path <> 'a2ui://managed-results'
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
            "INSERT INTO workspace_drafts
                (workspace_id, relative_path, content, content_hash, base_hash)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(workspace_id, relative_path) DO UPDATE SET
                content = excluded.content,
                content_hash = excluded.content_hash,
                base_hash = excluded.base_hash,
                updated_at = CURRENT_TIMESTAMP",
            params![
                workspace_id,
                relative_path,
                content,
                sha256(content.as_bytes()),
                base_hash
            ],
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
                "SELECT relative_path, content, content_hash, base_hash, updated_at
                 FROM workspace_drafts
                 WHERE workspace_id = ?1 AND relative_path = ?2",
                params![workspace_id, relative_path],
                |row| {
                    Ok(DraftRow {
                        relative_path: row.get(0)?,
                        content: row.get(1)?,
                        content_hash: row.get(2)?,
                        base_hash: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn workspace_draft_summaries(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<DraftSummaryRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT relative_path, content_hash, base_hash, updated_at
             FROM workspace_drafts WHERE workspace_id = ?1
             ORDER BY updated_at DESC, relative_path LIMIT 1001",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(DraftSummaryRow {
                relative_path: row.get(0)?,
                content_hash: row.get(1)?,
                base_hash: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        let rows = rows.collect::<Result<Vec<_>, _>>()?;
        if rows.len() > 1000 {
            return Err(AppError::InvalidInput(
                "待恢复草稿超过 1000 个安全上限".into(),
            ));
        }
        Ok(rows)
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
    pub fn record_file_save_versions(
        &self,
        workspace_id: &str,
        relative_path: &str,
        before: &str,
        before_hash: &str,
        after: &str,
        after_hash: &str,
        source: &str,
        summary: &str,
    ) -> Result<(), AppError> {
        if before_hash == after_hash {
            return Ok(());
        }
        if !matches!(source, "autosave" | "restore") {
            return Err(AppError::InvalidInput("文档版本来源无效".into()));
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let before_exists = transaction
            .query_row(
                "SELECT 1 FROM document_versions
                 WHERE workspace_id = ?1 AND relative_path = ?2 AND content_hash = ?3
                 LIMIT 1",
                params![workspace_id, relative_path, before_hash],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !before_exists {
            transaction.execute(
                "INSERT INTO document_versions
                 (id, workspace_id, relative_path, content, content_hash, expires_at,
                  version_kind, source, summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                         'snapshot', 'initial', ?6)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    workspace_id,
                    relative_path,
                    before.as_bytes(),
                    before_hash,
                    "首次记录的磁盘版本"
                ],
            )?;
        }
        transaction.execute(
            "INSERT INTO document_versions
             (id, workspace_id, relative_path, content, content_hash, expires_at,
              version_kind, source, summary)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                     'snapshot', ?6, ?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                workspace_id,
                relative_path,
                after.as_bytes(),
                after_hash,
                source,
                summary
            ],
        )?;
        transaction.execute(
            "DELETE FROM document_versions
             WHERE id IN (
                 SELECT id FROM document_versions
                 WHERE workspace_id = ?1 AND relative_path = ?2
                   AND source IN ('initial', 'autosave', 'restore')
                 ORDER BY created_at DESC, id DESC
                 LIMIT -1 OFFSET 100
             )",
            params![workspace_id, relative_path],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn document_versions(
        &self,
        workspace_id: &str,
        relative_path: &str,
        limit: usize,
    ) -> Result<Vec<DocumentVersionMetadata>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, workspace_id, relative_path, content_hash,
                    source, summary, version_kind, created_at
             FROM document_versions
             WHERE workspace_id = ?1 AND relative_path = ?2
             ORDER BY created_at DESC, id DESC
             LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![workspace_id, relative_path, limit.clamp(1, 200) as i64],
            document_version_metadata_from_row,
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn document_version(
        &self,
        workspace_id: &str,
        relative_path: &str,
        version_id: &str,
    ) -> Result<Option<DocumentVersionRecord>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, workspace_id, relative_path, content, content_hash,
                        source, summary, version_kind, created_at
                 FROM document_versions
                 WHERE id = ?1 AND workspace_id = ?2 AND relative_path = ?3",
                params![version_id, workspace_id, relative_path],
                document_version_from_row,
            )
            .optional()?)
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
                   operation_id, version_kind, source, summary)
                  VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'), ?6, ?7,
                          'patch', ?8)",
                params![
                    snapshot.id,
                    snapshot.workspace_id,
                    snapshot.relative_path,
                    snapshot.content.as_bytes(),
                    snapshot.content_hash,
                    snapshot.operation_id,
                    snapshot.version_kind,
                    summary
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

    pub fn delete_a2ui_surface(
        &self,
        workspace_id: &str,
        surface_id: &str,
    ) -> Result<bool, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        let surface_row_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM a2ui_surfaces WHERE workspace_id = ?1 AND surface_id = ?2",
                params![workspace_id, surface_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(surface_row_id) = surface_row_id else {
            return Ok(false);
        };
        transaction.execute(
            "DELETE FROM results
             WHERE workspace_id = ?1
               AND (a2ui_surface_row_id = ?2
                    OR (source_kind = 'a2ui_surface' AND source_ref = ?3))",
            params![workspace_id, surface_row_id, surface_id],
        )?;
        transaction.execute(
            "DELETE FROM a2ui_messages WHERE workspace_id = ?1 AND surface_id = ?2",
            params![workspace_id, surface_id],
        )?;
        let deleted = transaction.execute(
            "DELETE FROM a2ui_surfaces WHERE id = ?1 AND workspace_id = ?2",
            params![surface_row_id, workspace_id],
        )?;
        transaction.commit()?;
        Ok(deleted == 1)
    }

    pub fn results(
        &self,
        workspace_id: Option<&str>,
        include_archived: bool,
    ) -> Result<Vec<ResultRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                    r.storage_kind, r.storage_ref, r.current_revision_id,
                    r.active_session_id,
                    CASE WHEN r.source_kind = 'a2ui_surface' THEN r.source_ref END,
                    r.created_at, r.updated_at,
                    r.completed_at, r.managed_state_json
             FROM results r
             WHERE (?1 IS NULL OR r.workspace_id = ?1)
               AND (?2 = 1 OR r.status <> 'archived')
             ORDER BY r.updated_at DESC, r.id DESC
             LIMIT 200",
        )?;
        let rows = statement.query_map(params![workspace_id, include_archived], result_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn result(&self, result_id: &str) -> Result<Option<ResultRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                        r.storage_kind, r.storage_ref, r.current_revision_id,
                        r.active_session_id,
                        CASE WHEN r.source_kind = 'a2ui_surface' THEN r.source_ref END,
                        r.created_at, r.updated_at,
                        r.completed_at, r.managed_state_json
                 FROM results r
                 WHERE r.id = ?1",
                [result_id],
                result_from_row,
            )
            .optional()?)
    }

    pub fn result_source(&self, result_id: &str) -> Result<Option<ResultSourceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                        r.storage_kind, r.storage_ref, r.current_revision_id,
                        r.active_session_id,
                        CASE WHEN r.source_kind = 'a2ui_surface' THEN r.source_ref END,
                        r.created_at, r.updated_at, r.completed_at, r.managed_state_json,
                        r.source_kind, r.source_ref
                 FROM results r WHERE r.id = ?1",
                [result_id],
                result_source_from_row,
            )
            .optional()?)
    }

    pub fn create_managed_text_result(
        &self,
        input: NewManagedResultRow<'_>,
    ) -> Result<ResultRow, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO document_versions
                (id, workspace_id, relative_path, content, content_hash, expires_at,
                 version_kind, source, summary)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                     'snapshot', 'initial', '创建成果')",
            params![
                input.revision_id,
                input.workspace_id,
                input.source_ref,
                input.content.as_bytes(),
                input.content_hash,
            ],
        )?;
        transaction.execute(
            "INSERT INTO results
                (id, workspace_id, result_type, title, status, storage_kind,
                 storage_ref, source_kind, source_ref, current_revision_id,
                 managed_state_json)
             VALUES (?1, ?2, 'document', ?3, 'draft', 'managed_local',
                     ?4, 'managed_local', ?5, ?6, ?7)",
            params![
                input.result_id,
                input.workspace_id,
                input.title,
                input.storage_ref,
                input.source_ref,
                input.revision_id,
                input.managed_state_json,
            ],
        )?;
        let row = transaction.query_row(
            "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                    r.storage_kind, r.storage_ref, r.current_revision_id,
                    r.active_session_id, NULL, r.created_at, r.updated_at,
                    r.completed_at, r.managed_state_json
             FROM results r WHERE r.id = ?1",
            [input.result_id],
            result_from_row,
        )?;
        transaction.commit()?;
        Ok(row)
    }

    pub fn ensure_managed_result_initial_revision(
        &self,
        result_id: &str,
        workspace_id: &str,
        source_ref: &str,
        revision_id: &str,
        content: &str,
        content_hash: &str,
    ) -> Result<(), AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let matches = transaction.query_row(
            "SELECT COUNT(*) FROM results
             WHERE id = ?1 AND workspace_id = ?2 AND source_kind = 'managed_local'
               AND source_ref = ?3 AND result_type = 'document'",
            params![result_id, workspace_id, source_ref],
            |row| row.get::<_, i64>(0),
        )?;
        if matches != 1 {
            return Err(AppError::InvalidInput("成果不是可编辑的托管文档".into()));
        }
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM document_versions
                 WHERE workspace_id = ?1 AND relative_path = ?2 AND content_hash = ?3
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![workspace_id, source_ref, content_hash],
                |row| row.get(0),
            )
            .optional()?;
        let stable_revision_id = if let Some(existing) = existing {
            existing
        } else {
            transaction.execute(
                "INSERT INTO document_versions
                    (id, workspace_id, relative_path, content, content_hash, expires_at,
                     version_kind, source, summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                         'snapshot', 'initial', '补录托管成果初始版本')",
                params![
                    revision_id,
                    workspace_id,
                    source_ref,
                    content.as_bytes(),
                    content_hash,
                ],
            )?;
            revision_id.to_string()
        };
        transaction.execute(
            "UPDATE results SET current_revision_id = ?2, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND current_revision_id IS NULL",
            params![result_id, stable_revision_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_managed_result_save_versions(
        &self,
        result_id: &str,
        workspace_id: &str,
        source_ref: &str,
        before: &str,
        before_hash: &str,
        after: &str,
        after_hash: &str,
        source: &str,
        summary: &str,
    ) -> Result<Option<String>, AppError> {
        if before_hash == after_hash {
            return Ok(None);
        }
        if !matches!(source, "autosave" | "restore") {
            return Err(AppError::InvalidInput("成果版本来源无效".into()));
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let matches = transaction.query_row(
            "SELECT COUNT(*) FROM results
             WHERE id = ?1 AND workspace_id = ?2 AND source_kind = 'managed_local'
               AND source_ref = ?3 AND result_type = 'document'",
            params![result_id, workspace_id, source_ref],
            |row| row.get::<_, i64>(0),
        )?;
        if matches != 1 {
            return Err(AppError::InvalidInput("成果不是可编辑的托管文档".into()));
        }
        let before_exists = transaction
            .query_row(
                "SELECT 1 FROM document_versions
                 WHERE workspace_id = ?1 AND relative_path = ?2 AND content_hash = ?3 LIMIT 1",
                params![workspace_id, source_ref, before_hash],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !before_exists {
            transaction.execute(
                "INSERT INTO document_versions
                    (id, workspace_id, relative_path, content, content_hash, expires_at,
                     version_kind, source, summary)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                         'snapshot', 'initial', '首次记录的成果版本')",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    workspace_id,
                    source_ref,
                    before.as_bytes(),
                    before_hash,
                ],
            )?;
        }
        let revision_id = uuid::Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO document_versions
                (id, workspace_id, relative_path, content, content_hash, expires_at,
                 version_kind, source, summary)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                     'snapshot', ?6, ?7)",
            params![
                revision_id,
                workspace_id,
                source_ref,
                after.as_bytes(),
                after_hash,
                source,
                summary,
            ],
        )?;
        transaction.execute(
            "UPDATE results SET current_revision_id = ?2, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            params![result_id, revision_id],
        )?;
        transaction.execute(
            "DELETE FROM document_versions
             WHERE id IN (
                 SELECT id FROM document_versions
                 WHERE workspace_id = ?1 AND relative_path = ?2
                   AND source IN ('initial', 'autosave', 'restore')
                 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 100
             )",
            params![workspace_id, source_ref],
        )?;
        transaction.commit()?;
        Ok(Some(revision_id))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ensure_file_result(
        &self,
        result_id: &str,
        workspace_id: &str,
        relative_path: &str,
        title: &str,
        storage_kind: &str,
        storage_ref: &str,
        current_revision_id: Option<&str>,
    ) -> Result<ResultRow, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO results
                (id, workspace_id, result_type, title, status, storage_kind,
                 storage_ref, source_kind, source_ref, current_revision_id)
             VALUES (?1, ?2, 'document', ?3, 'ready', ?4, ?5,
                     'workspace_file', ?6, ?7)
             ON CONFLICT(workspace_id, source_kind, source_ref) DO UPDATE SET
                title = excluded.title,
                current_revision_id = COALESCE(excluded.current_revision_id, results.current_revision_id),
                updated_at = CURRENT_TIMESTAMP",
            params![
                result_id,
                workspace_id,
                title,
                storage_kind,
                storage_ref,
                relative_path,
                current_revision_id
            ],
        )?;
        let row = transaction.query_row(
            "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                    r.storage_kind, r.storage_ref, r.current_revision_id,
                    r.active_session_id, NULL, r.created_at, r.updated_at,
                    r.completed_at, r.managed_state_json
             FROM results r
             WHERE r.workspace_id = ?1 AND r.source_kind = 'workspace_file'
               AND r.source_ref = ?2",
            params![workspace_id, relative_path],
            result_from_row,
        )?;
        transaction.commit()?;
        Ok(row)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ensure_surface_result(
        &self,
        result_id: &str,
        surface_row_id: &str,
        workspace_id: &str,
        surface_id: &str,
        session_id: &str,
        title: &str,
        managed_state_json: &str,
    ) -> Result<ResultRow, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO results
                (id, workspace_id, result_type, title, status, storage_kind,
                 storage_ref, source_kind, source_ref, active_session_id,
                 a2ui_surface_row_id, managed_state_json)
             VALUES (?1, ?2, 'tool', ?3, 'ready', 'managed_local', ?4,
                     'a2ui_surface', ?5, ?6, ?7, ?8)
             ON CONFLICT(workspace_id, source_kind, source_ref) DO UPDATE SET
                title = excluded.title,
                active_session_id = COALESCE(results.active_session_id, excluded.active_session_id),
                a2ui_surface_row_id = excluded.a2ui_surface_row_id,
                managed_state_json = excluded.managed_state_json,
                updated_at = CURRENT_TIMESTAMP",
            params![
                result_id,
                workspace_id,
                title,
                format!("result://a2ui/{result_id}"),
                surface_id,
                session_id,
                surface_row_id,
                managed_state_json
            ],
        )?;
        let row = transaction.query_row(
            "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                    r.storage_kind, r.storage_ref, r.current_revision_id,
                    r.active_session_id, r.source_ref, r.created_at, r.updated_at,
                    r.completed_at, r.managed_state_json
             FROM results r
             WHERE r.workspace_id = ?1 AND r.source_kind = 'a2ui_surface'
               AND r.source_ref = ?2",
            params![workspace_id, surface_id],
            result_from_row,
        )?;
        transaction.commit()?;
        Ok(row)
    }

    pub fn task_templates(&self) -> Result<Vec<TaskTemplateRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare(
            "SELECT id, version, name, description, task_kind, desired_result_type,
                    field_schema_json, default_sections_json, risk_level, builtin
             FROM task_templates
             WHERE status = 'active'
             ORDER BY CASE id
                WHEN 'meeting_minutes' THEN 1
                WHEN 'document_summary' THEN 2
                WHEN 'weekly_report' THEN 3
                WHEN 'resume_optimization' THEN 4
                ELSE 5 END, version DESC",
        )?;
        let rows = statement.query_map([], task_template_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn task_template(&self, template_id: &str) -> Result<Option<TaskTemplateRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, version, name, description, task_kind, desired_result_type,
                        field_schema_json, default_sections_json, risk_level, builtin
                 FROM task_templates
                 WHERE id = ?1 AND status = 'active'
                 ORDER BY version DESC LIMIT 1",
                [template_id],
                task_template_from_row,
            )
            .optional()?)
    }

    pub fn task_template_version(
        &self,
        template_id: &str,
        version: u32,
    ) -> Result<Option<TaskTemplateRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, version, name, description, task_kind, desired_result_type,
                        field_schema_json, default_sections_json, risk_level, builtin
                 FROM task_templates WHERE id = ?1 AND version = ?2",
                params![template_id, version],
                task_template_from_row,
            )
            .optional()?)
    }

    pub fn insert_task(&self, task: NewTaskRow<'_>) -> Result<TaskRow, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        connection.execute(
            "INSERT INTO tasks
                (id, workspace_id, template_id, template_version, task_kind,
                 desired_result_type, status, input_answers_json, question_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                task.id,
                task.workspace_id,
                task.template_id,
                task.template_version,
                task.task_kind,
                task.desired_result_type,
                task.status,
                task.input_answers_json,
                task.question_count,
            ],
        )?;
        connection
            .query_row(
                "SELECT id, workspace_id, template_id, template_version, task_kind,
                    desired_result_type, status, input_answers_json, question_count,
                    result_id, created_at, updated_at, completed_at
             FROM tasks WHERE id = ?1",
                [task.id],
                task_from_row,
            )
            .map_err(AppError::from)
    }

    pub fn task(&self, task_id: &str) -> Result<Option<TaskRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, workspace_id, template_id, template_version, task_kind,
                        desired_result_type, status, input_answers_json, question_count,
                        result_id, created_at, updated_at, completed_at
                 FROM tasks WHERE id = ?1",
                [task_id],
                task_from_row,
            )
            .optional()?)
    }

    pub fn update_task_answers(
        &self,
        task_id: &str,
        input_answers_json: &str,
        status: &str,
        question_count: u32,
    ) -> Result<TaskRow, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let updated = connection.execute(
            "UPDATE tasks
             SET input_answers_json = ?2, status = ?3, question_count = ?4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND status IN ('draft', 'awaiting_input')",
            params![task_id, input_answers_json, status, question_count],
        )?;
        if updated != 1 {
            return Err(AppError::InvalidInput(
                "当前任务状态不允许继续回答问题".into(),
            ));
        }
        connection
            .query_row(
                "SELECT id, workspace_id, template_id, template_version, task_kind,
                        desired_result_type, status, input_answers_json, question_count,
                        result_id, created_at, updated_at, completed_at
                 FROM tasks WHERE id = ?1",
                [task_id],
                task_from_row,
            )
            .map_err(AppError::from)
    }

    pub fn complete_task_with_managed_result(
        &self,
        input: ManagedTaskResultRow<'_>,
    ) -> Result<ResultRow, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let claimed = transaction.execute(
            "UPDATE tasks SET status = 'running', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND workspace_id = ?2 AND status = 'ready' AND result_id IS NULL",
            params![input.task_id, input.workspace_id],
        )?;
        if claimed != 1 {
            return Err(AppError::InvalidInput(
                "当前任务尚未就绪、已经执行或不属于该工作区".into(),
            ));
        }
        transaction.execute(
            "INSERT INTO document_versions
                (id, workspace_id, relative_path, content, content_hash, expires_at,
                 version_kind, source, summary)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 days'),
                     'snapshot', 'initial', '创建本地任务草稿')",
            params![
                input.revision_id,
                input.workspace_id,
                input.source_ref,
                input.content.as_bytes(),
                input.content_hash,
            ],
        )?;
        transaction.execute(
            "INSERT INTO results
                (id, workspace_id, task_id, result_type, title, status, storage_kind,
                 storage_ref, source_kind, source_ref, current_revision_id,
                 managed_state_json)
             VALUES (?1, ?2, ?3, 'document', ?4, 'draft', 'managed_local',
                     ?5, 'managed_local', ?6, ?7, ?8)",
            params![
                input.result_id,
                input.workspace_id,
                input.task_id,
                input.title,
                input.storage_ref,
                input.source_ref,
                input.revision_id,
                input.managed_state_json,
            ],
        )?;
        transaction.execute(
            "UPDATE tasks
             SET status = 'completed', result_id = ?2, question_count = 0,
                 completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND status = 'running'",
            params![input.task_id, input.result_id],
        )?;
        let row = transaction.query_row(
            "SELECT r.id, r.workspace_id, r.result_type, r.title, r.status,
                    r.storage_kind, r.storage_ref, r.current_revision_id,
                    r.active_session_id, NULL, r.created_at, r.updated_at,
                    r.completed_at, r.managed_state_json
             FROM results r WHERE r.id = ?1",
            [input.result_id],
            result_from_row,
        )?;
        transaction.commit()?;
        Ok(row)
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
            "DELETE FROM tasks;
             DELETE FROM results;
             DELETE FROM a2ui_events;
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
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA wal_autocheckpoint = 1000;",
        )?;
        Ok(())
    }

    fn verify_integrity(connection: &Connection) -> Result<(), AppError> {
        let result = connection
            .query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))
            .map_err(|_| AppError::DatabaseIntegrity)?;
        if result.eq_ignore_ascii_case("ok") {
            Ok(())
        } else {
            Err(AppError::DatabaseIntegrity)
        }
    }

    fn verify_foreign_keys(connection: &Connection) -> Result<(), AppError> {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(|_| AppError::DatabaseIntegrity)?;
        let mut rows = statement
            .query([])
            .map_err(|_| AppError::DatabaseIntegrity)?;
        if rows
            .next()
            .map_err(|_| AppError::DatabaseIntegrity)?
            .is_some()
        {
            Err(AppError::DatabaseIntegrity)
        } else {
            Ok(())
        }
    }

    fn migrate(connection: &mut Connection) -> Result<(), AppError> {
        Self::migrate_to(connection, SCHEMA_VERSION, MIGRATIONS)
    }

    fn migrate_to(
        connection: &mut Connection,
        target_version: i64,
        migrations: &[(i64, &str)],
    ) -> Result<(), AppError> {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current =
            transaction.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?;
        if current > target_version {
            return Err(AppError::InvalidInput(format!(
                "Database schema version {current} is newer than supported version {target_version}"
            )));
        }
        let mut applied = current;
        for &(version, sql) in migrations.iter().filter(|(version, _)| *version > current) {
            if version != applied + 1 || version > target_version {
                break;
            }
            transaction.execute_batch(sql)?;
            transaction.pragma_update(None, "user_version", version)?;
            applied = version;
        }
        if applied != target_version {
            return Err(AppError::StateUnavailable);
        }
        transaction.commit()?;
        Ok(())
    }

    fn backfill_draft_hashes(connection: &mut Connection) -> Result<(), AppError> {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let pending = {
            let mut statement = transaction.prepare(
                "SELECT workspace_id, relative_path, content
                 FROM workspace_drafts WHERE content_hash = ''",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for (workspace_id, relative_path, content) in pending {
            transaction.execute(
                "UPDATE workspace_drafts SET content_hash = ?1
                 WHERE workspace_id = ?2 AND relative_path = ?3 AND content_hash = ''",
                params![sha256(content.as_bytes()), workspace_id, relative_path],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> Result<Self, AppError> {
        let mut connection = Connection::open_in_memory()?;
        Self::verify_integrity(&connection)?;
        Self::configure(&connection)?;
        Self::migrate(&mut connection)?;
        Self::backfill_draft_hashes(&mut connection)?;
        Self::verify_integrity(&connection)?;
        Self::verify_foreign_keys(&connection)?;
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
    use super::{Storage, MIGRATIONS, MIGRATION_V1, SCHEMA_VERSION};
    use crate::error::AppError;
    use rusqlite::{params, Connection, OptionalExtension};
    use std::fs;

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
            "results",
            "task_templates",
            "tasks",
        ] {
            assert!(
                storage.table_exists(table).unwrap(),
                "missing table {table}"
            );
        }
    }

    #[test]
    fn upgrades_an_existing_v6_database_and_preserves_patch_history() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("upgrade.sqlite3");
        {
            let mut connection = Connection::open(&database_path).unwrap();
            Storage::configure(&connection).unwrap();
            Storage::migrate_to(&mut connection, 6, MIGRATIONS).unwrap();
            connection
                .execute(
                    "INSERT INTO workspaces(id, name, root_path, kind)
                     VALUES ('workspace-upgrade', 'Upgrade', 'C:\\upgrade', 'directory')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO patch_operations(id, workspace_id, summary, patch_json)
                     VALUES ('operation-upgrade', 'workspace-upgrade', 'Existing patch', '{}')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO document_versions
                     (id, workspace_id, relative_path, content, content_hash, expires_at,
                      operation_id, version_kind)
                     VALUES ('version-upgrade', 'workspace-upgrade', 'a.md', X'6F6C64',
                             'hash', datetime('now', '+30 days'), 'operation-upgrade', 'after')",
                    [],
                )
                .unwrap();
        }

        let storage = Storage::open(&database_path).unwrap();
        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        let version = storage
            .document_version("workspace-upgrade", "a.md", "version-upgrade")
            .unwrap()
            .unwrap();
        assert_eq!(version.content, "old");
        assert_eq!(version.source, "patch");
        assert_eq!(version.summary.as_deref(), Some("Existing patch"));
    }

    #[test]
    fn upgrades_every_supported_schema_version_and_preserves_existing_rows() {
        for starting_version in 0..SCHEMA_VERSION {
            let directory = tempfile::tempdir().unwrap();
            let database_path = directory
                .path()
                .join(format!("upgrade-from-{starting_version}.sqlite3"));
            if starting_version > 0 {
                let mut connection = Connection::open(&database_path).unwrap();
                Storage::configure(&connection).unwrap();
                Storage::migrate_to(&mut connection, starting_version, MIGRATIONS).unwrap();
                connection
                    .execute(
                        "INSERT INTO workspaces(id, name, root_path) VALUES (?1, ?2, ?3)",
                        [
                            format!("workspace-{starting_version}"),
                            "Preserved".into(),
                            format!("C:\\upgrade-{starting_version}"),
                        ],
                    )
                    .unwrap();
            }

            let storage = Storage::open(&database_path).unwrap();
            assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
            if starting_version > 0 {
                assert!(storage
                    .workspace(&format!("workspace-{starting_version}"))
                    .unwrap()
                    .is_some());
            }
        }
    }

    #[test]
    fn v9_migration_does_not_eagerly_copy_legacy_files_or_surfaces() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("lazy-results.sqlite3");
        {
            let mut connection = Connection::open(&database_path).unwrap();
            Storage::configure(&connection).unwrap();
            Storage::migrate_to(&mut connection, 8, MIGRATIONS).unwrap();
            connection
                .execute(
                    "INSERT INTO workspaces(id, name, root_path, kind)
                     VALUES ('workspace-lazy', 'Lazy', 'C:\\lazy', 'directory')",
                    [],
                )
                .unwrap();
        }

        let storage = Storage::open(&database_path).unwrap();
        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        assert!(storage.results(None, true).unwrap().is_empty());
    }

    #[test]
    fn v8_to_v9_preserves_legacy_records_and_adds_only_empty_result_aggregate() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("v8-to-v9.sqlite3");
        {
            let mut connection = Connection::open(&database_path).unwrap();
            Storage::configure(&connection).unwrap();
            Storage::migrate_to(&mut connection, 8, MIGRATIONS).unwrap();
            connection
                .execute(
                    "INSERT INTO workspaces(id, name, root_path, kind)
                     VALUES ('workspace-v8', 'Legacy', 'C:\\legacy-v8', 'directory')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO sessions(id, workspace_id, title)
                     VALUES ('session-v8', 'workspace-v8', 'Legacy chat')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO messages(id, session_id, role, body)
                     VALUES ('message-v8', 'session-v8', 'assistant', 'preserved')",
                    [],
                )
                .unwrap();
        }

        let storage = Storage::open(&database_path).unwrap();
        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(
            storage.sessions("workspace-v8").unwrap()[0].messages[0].content,
            "preserved"
        );
        assert!(storage
            .results(Some("workspace-v8"), true)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn failed_v9_migration_rolls_back_result_table_and_schema_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        Storage::configure(&connection).unwrap();
        Storage::migrate_to(&mut connection, 8, MIGRATIONS).unwrap();

        let failure = Storage::migrate_to(
            &mut connection,
            9,
            &[(
                9,
                "CREATE TABLE results(id TEXT PRIMARY KEY); INSERT INTO missing_table VALUES (1);",
            )],
        );
        assert!(failure.is_err());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            8
        );
        let exists = connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'results'",
                [],
                |_| Ok(true),
            )
            .optional()
            .unwrap();
        assert!(exists.is_none());
    }

    #[test]
    fn v9_to_v10_preserves_results_and_seeds_versioned_templates() {
        let mut connection = Connection::open_in_memory().unwrap();
        Storage::configure(&connection).unwrap();
        Storage::migrate_to(&mut connection, 9, MIGRATIONS).unwrap();
        connection
            .execute(
                "INSERT INTO workspaces(id, name, root_path) VALUES ('w-v9', 'V9', 'C:\\v9')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO results
                   (id, workspace_id, result_type, title, status, storage_kind,
                    storage_ref, source_kind, source_ref)
                 VALUES ('r-v9', 'w-v9', 'document', 'Preserved', 'ready',
                         'workspace_file', 'result://file/r-v9', 'workspace_file', 'a.md')",
                [],
            )
            .unwrap();

        Storage::migrate_to(&mut connection, 10, MIGRATIONS).unwrap();

        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM task_templates", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT title FROM results WHERE id = 'r-v9'", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "Preserved"
        );
    }

    #[test]
    fn failed_v10_migration_rolls_back_task_tables_and_schema_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        Storage::configure(&connection).unwrap();
        Storage::migrate_to(&mut connection, 9, MIGRATIONS).unwrap();
        let failure = Storage::migrate_to(
            &mut connection,
            10,
            &[(
                10,
                "CREATE TABLE tasks(id TEXT); INSERT INTO missing_table VALUES (1);",
            )],
        );
        assert!(failure.is_err());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            9
        );
        assert!(!connection
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
                [],
                |_| Ok(true),
            )
            .optional()
            .unwrap()
            .unwrap_or(false));
    }

    #[test]
    fn v10_enforces_question_limit_and_same_workspace_task_result_binding() {
        let storage = Storage::open_in_memory().unwrap();
        let connection = storage.connection.lock().unwrap();
        connection
            .execute_batch(
                "INSERT INTO workspaces(id, name, root_path) VALUES
                    ('w-task-a', 'A', 'C:\\a'), ('w-task-b', 'B', 'C:\\b');
                 INSERT INTO tasks
                    (id, workspace_id, template_id, template_version, task_kind,
                     desired_result_type, status, question_count)
                 VALUES ('task-a', 'w-task-a', 'meeting_minutes', 1, 'organize',
                         'document', 'ready', 0);",
            )
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO tasks
                    (id, workspace_id, template_id, template_version, task_kind,
                     desired_result_type, status, question_count)
                 VALUES ('task-too-many', 'w-task-a', 'meeting_minutes', 1, 'organize',
                         'document', 'awaiting_input', 4)",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO results
                    (id, workspace_id, task_id, result_type, title, status, storage_kind,
                     storage_ref, source_kind, source_ref)
                 VALUES ('result-cross', 'w-task-b', 'task-a', 'document', 'Invalid',
                         'draft', 'managed_local', 'result://file/result-cross',
                         'managed_local', 'result-cross.md')",
                [],
            )
            .is_err());
    }

    #[test]
    fn result_survives_session_removal_and_workspace_delete_cascades_only_records() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace = storage
            .upsert_workspace("workspace-result", "Result", "C:\\result")
            .unwrap();
        let session = storage
            .create_session(
                &workspace.id,
                "550e8400-e29b-41d4-a716-446655440010",
                "Disposable chat",
            )
            .unwrap();
        {
            let connection = storage.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO results
                       (id, workspace_id, result_type, title, status, storage_kind,
                        storage_ref, source_kind, source_ref, active_session_id)
                     VALUES ('550e8400-e29b-41d4-a716-446655440011', ?1, 'document',
                             'Independent result', 'ready', 'workspace_file',
                             'result://file/test', 'workspace_file', 'notes.md', ?2)",
                    params![workspace.id, session.id],
                )
                .unwrap();
            connection
                .execute("DELETE FROM sessions WHERE id = ?1", [session.id])
                .unwrap();
        }

        let result = storage
            .result("550e8400-e29b-41d4-a716-446655440011")
            .unwrap()
            .unwrap();
        assert!(result.active_session_id.is_none());
        assert!(storage.remove_workspace(&workspace.id).unwrap());
        assert!(storage
            .result("550e8400-e29b-41d4-a716-446655440011")
            .unwrap()
            .is_none());
    }

    #[test]
    fn a2ui_result_keeps_validated_snapshot_after_source_session_is_deleted() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace = storage
            .upsert_workspace("workspace-tool", "Tool", "C:\\tool")
            .unwrap();
        let session = storage
            .create_session(
                &workspace.id,
                "550e8400-e29b-41d4-a716-446655440030",
                "Disposable surface chat",
            )
            .unwrap();
        {
            let connection = storage.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO a2ui_surfaces
                       (id, surface_id, workspace_id, session_id, message_id,
                        protocol_version, revision, state_json, raw_message, validation_json)
                     VALUES ('surface-row', 'meeting-tool', ?1, ?2, 'message-id',
                             '1.0', 1, '{\"safe\":true}', '{}', '{}')",
                    params![workspace.id, session.id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO results
                       (id, workspace_id, result_type, title, status, storage_kind,
                        storage_ref, source_kind, source_ref, active_session_id,
                        a2ui_surface_row_id, managed_state_json)
                     VALUES ('550e8400-e29b-41d4-a716-446655440031', ?1, 'tool',
                             'Meeting tool', 'ready', 'managed_local',
                             'result://a2ui/tool', 'a2ui_surface', 'meeting-tool', ?2,
                             'surface-row', '{\"safe\":true}')",
                    params![workspace.id, session.id],
                )
                .unwrap();
            connection
                .execute("DELETE FROM sessions WHERE id = ?1", [session.id])
                .unwrap();
            let snapshot: String = connection
                .query_row(
                    "SELECT managed_state_json FROM results WHERE id = ?1",
                    ["550e8400-e29b-41d4-a716-446655440031"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(snapshot, r#"{"safe":true}"#);
        }

        let result = storage
            .result("550e8400-e29b-41d4-a716-446655440031")
            .unwrap()
            .unwrap();
        assert!(result.active_session_id.is_none());
        assert_eq!(result.a2ui_surface_id.as_deref(), Some("meeting-tool"));
        let detail = crate::repository::result::ResultRepository::new(&storage)
            .get("550e8400-e29b-41d4-a716-446655440031")
            .unwrap()
            .unwrap();
        assert_eq!(detail.managed_state.unwrap()["safe"], true);
    }

    #[test]
    fn deleting_a2ui_surface_is_workspace_scoped_and_removes_its_full_history() {
        let storage = Storage::open_in_memory().unwrap();
        let workspace_a = storage
            .upsert_workspace("workspace-delete-a", "Delete A", "C:\\delete-a")
            .unwrap();
        let workspace_b = storage
            .upsert_workspace("workspace-delete-b", "Delete B", "C:\\delete-b")
            .unwrap();
        let session_a = storage
            .create_session(
                &workspace_a.id,
                "550e8400-e29b-41d4-a716-446655440060",
                "Surface A",
            )
            .unwrap();
        let session_b = storage
            .create_session(
                &workspace_b.id,
                "550e8400-e29b-41d4-a716-446655440061",
                "Surface B",
            )
            .unwrap();
        let state_json = r#"{"surfaceId":"shared-surface","revision":1,"root":{"id":"root","component":"Text","text":"safe"},"data":{}}"#;
        let validation_json = r#"{"valid":true,"errors":[],"warnings":[],"durationMs":1}"#;
        storage
            .save_a2ui_surface(
                "surface-row-a",
                "shared-surface",
                &workspace_a.id,
                &session_a.id,
                "message-a",
                1,
                state_json,
                "{}",
                validation_json,
                "inspection-a",
                1,
            )
            .unwrap();
        storage
            .save_a2ui_surface(
                "surface-row-b",
                "shared-surface",
                &workspace_b.id,
                &session_b.id,
                "message-b",
                1,
                state_json,
                "{}",
                validation_json,
                "inspection-b",
                1,
            )
            .unwrap();
        storage
            .ensure_surface_result(
                "550e8400-e29b-41d4-a716-446655440062",
                "surface-row-a",
                &workspace_a.id,
                "shared-surface",
                &session_a.id,
                "Surface A",
                state_json,
            )
            .unwrap();
        storage
            .record_a2ui_action(
                "surface-row-a",
                None,
                "event-a",
                "root",
                "click",
                "set_state",
                "low",
                "allowed",
                "{}",
                1,
            )
            .unwrap();

        assert!(!storage
            .delete_a2ui_surface(&workspace_b.id, "missing-surface")
            .unwrap());
        assert!(storage
            .delete_a2ui_surface(&workspace_a.id, "shared-surface")
            .unwrap());
        assert!(storage
            .a2ui_surface(&workspace_a.id, "shared-surface")
            .unwrap()
            .is_none());
        assert!(storage
            .a2ui_inspections(&workspace_a.id)
            .unwrap()
            .is_empty());
        assert!(storage.a2ui_events("surface-row-a").unwrap().is_empty());
        assert!(storage
            .result("550e8400-e29b-41d4-a716-446655440062")
            .unwrap()
            .is_none());
        assert!(storage
            .a2ui_surface(&workspace_b.id, "shared-surface")
            .unwrap()
            .is_some());
        assert_eq!(storage.a2ui_inspections(&workspace_b.id).unwrap().len(), 1);
        assert!(!storage
            .delete_a2ui_surface(&workspace_a.id, "shared-surface")
            .unwrap());
    }

    #[test]
    fn result_current_revision_tracks_new_versions_without_command_coupling() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .upsert_workspace(
                "workspace-revision-result",
                "Revision",
                "C:\\revision-result",
            )
            .unwrap();
        storage
            .ensure_file_result(
                "550e8400-e29b-41d4-a716-446655440040",
                "workspace-revision-result",
                "notes.md",
                "Notes",
                "workspace_file",
                "result://file/revision",
                None,
            )
            .unwrap();
        storage
            .record_file_save_versions(
                "workspace-revision-result",
                "notes.md",
                "before",
                "before-hash",
                "after",
                "after-hash",
                "autosave",
                "save",
            )
            .unwrap();

        let result = storage
            .result("550e8400-e29b-41d4-a716-446655440040")
            .unwrap()
            .unwrap();
        let current_hash: String = {
            let connection = storage.connection.lock().unwrap();
            connection
                .query_row(
                    "SELECT content_hash FROM document_versions WHERE id = ?1",
                    [result.current_revision_id.as_deref().unwrap()],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(current_hash, "after-hash");
    }

    #[test]
    fn failed_migration_rolls_back_all_schema_changes_and_version_updates() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("failed-migration.sqlite3");
        let mut connection = Connection::open(&database_path).unwrap();
        Storage::configure(&connection).unwrap();
        Storage::migrate_to(&mut connection, 6, MIGRATIONS).unwrap();

        let failure = Storage::migrate_to(
            &mut connection,
            7,
            &[(
                7,
                "CREATE TABLE migration_probe(id INTEGER); INSERT INTO missing_table VALUES (1);",
            )],
        );
        assert!(failure.is_err());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            6
        );
        let probe = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .unwrap();
        assert!(probe.is_none());
    }

    #[test]
    fn upgrades_v7_drafts_and_backfills_their_content_hash() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("draft-upgrade.sqlite3");
        {
            let mut connection = Connection::open(&database_path).unwrap();
            Storage::configure(&connection).unwrap();
            Storage::migrate_to(&mut connection, 7, MIGRATIONS).unwrap();
            connection
                .execute(
                    "INSERT INTO workspaces(id, name, root_path)
                     VALUES ('workspace-draft', 'Draft', 'C:\\draft')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO workspace_drafts
                        (workspace_id, relative_path, content, base_hash)
                     VALUES ('workspace-draft', 'notes.md', 'recover me', 'base')",
                    [],
                )
                .unwrap();
        }

        let storage = Storage::open(&database_path).unwrap();
        let draft = storage
            .draft("workspace-draft", "notes.md")
            .unwrap()
            .unwrap();
        assert_eq!(storage.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(draft.content, "recover me");
        assert_eq!(draft.content_hash, super::sha256(b"recover me"));
    }

    #[test]
    fn rejects_a_corrupt_database_with_a_stable_integrity_error() {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("corrupt.sqlite3");
        fs::write(&database_path, b"not a sqlite database").unwrap();

        assert!(matches!(
            Storage::open(&database_path),
            Err(AppError::DatabaseIntegrity)
        ));
    }

    #[test]
    fn configures_wal_full_sync_foreign_keys_and_lock_waiting() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(&directory.path().join("durable.sqlite3")).unwrap();
        let connection = storage.connection.lock().unwrap();
        let journal = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap();
        let synchronous = connection
            .query_row("PRAGMA synchronous", [], |row| row.get::<_, i64>(0))
            .unwrap();
        let foreign_keys = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap();
        let busy_timeout = connection
            .query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))
            .unwrap();
        assert_eq!(journal.to_ascii_lowercase(), "wal");
        assert_eq!(synchronous, 2);
        assert_eq!(foreign_keys, 1);
        assert_eq!(busy_timeout, 5_000);
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
        assert_eq!(counts.results, 0);
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
                "550e8400-e29b-41d4-a716-446655440005",
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
