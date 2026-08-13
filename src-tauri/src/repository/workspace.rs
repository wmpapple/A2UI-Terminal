use crate::error::AppError;
use crate::storage::{Storage, WorkspaceFileRow};

pub struct WorkspaceRepository<'a> {
    storage: &'a Storage,
}

impl<'a> WorkspaceRepository<'a> {
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    pub fn remove(&self, workspace_id: &str) -> Result<bool, AppError> {
        self.storage.remove_workspace(workspace_id)
    }

    pub fn authorized_file(&self, source_id: &str) -> Result<Option<WorkspaceFileRow>, AppError> {
        self.storage.workspace_file_by_source(source_id)
    }
}
