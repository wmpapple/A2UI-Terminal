use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 2;
const MIGRATION_V1: &str = include_str!("../../migrations/0001_initial.sql");
const MIGRATION_V2: &str = include_str!("../../migrations/0002_workspace_drafts.sql");

#[derive(Debug, Clone)]
pub struct WorkspaceRow {
    pub id: String,
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Clone)]
pub struct DraftRow {
    pub content: String,
    pub base_hash: String,
    pub updated_at: String,
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

    pub fn provider_ids(&self) -> Result<Vec<String>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut statement = connection.prepare("SELECT provider_id FROM credential_refs")?;
        let rows = statement.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<Result<Vec<String>, _>>()?)
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
        })
    }

    pub fn workspace(&self, workspace_id: &str) -> Result<Option<WorkspaceRow>, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(connection
            .query_row(
                "SELECT id, name, root_path FROM workspaces WHERE id = ?1",
                [workspace_id],
                |row| {
                    Ok(WorkspaceRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
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
            "SELECT id, name, root_path FROM workspaces
             ORDER BY updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit.min(20) as i64], |row| {
            Ok(WorkspaceRow {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
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
            "DELETE FROM workspace_drafts;
             DELETE FROM audit_events;
             DELETE FROM document_versions;
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
        if current < SCHEMA_VERSION {
            if current < 1 {
                connection.execute_batch(MIGRATION_V1)?;
            }
            connection.execute_batch(MIGRATION_V2)?;
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
    use super::{Storage, SCHEMA_VERSION};

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
}
