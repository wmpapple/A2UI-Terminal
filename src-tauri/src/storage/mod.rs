use crate::error::AppError;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA_VERSION: i64 = 1;
const MIGRATION_V1: &str = include_str!("../../migrations/0001_initial.sql");

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
            "DELETE FROM audit_events;
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
            connection.execute_batch(MIGRATION_V1)?;
        }
        Ok(())
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self, AppError> {
        let connection = Connection::open_in_memory()?;
        Self::configure(&connection)?;
        Self::migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    fn table_exists(&self, table: &str) -> Result<bool, AppError> {
        use rusqlite::OptionalExtension;

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
}
