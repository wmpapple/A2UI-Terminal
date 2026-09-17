use crate::error::AppError;
use crate::repository::workspace::WorkspaceRepository;
use crate::storage::Storage;
use crate::workspace::{
    self, RecoveryDraftSummary, SaveOutcome, WorkspaceDocument, WorkspaceFileEntry,
    WorkspaceSummary,
};
use std::path::Path;

pub fn register(storage: &Storage, path: &Path) -> Result<WorkspaceSummary, AppError> {
    workspace::register_workspace(storage, path)
}

pub fn list_recent(storage: &Storage) -> Result<Vec<WorkspaceSummary>, AppError> {
    workspace::list_recent(storage)
}

pub fn restore(storage: &Storage, workspace_id: &str) -> Result<WorkspaceSummary, AppError> {
    workspace::restore_workspace(storage, workspace_id)
}

pub fn list_files(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<WorkspaceFileEntry>, AppError> {
    workspace::list_files(storage, workspace_id)
}

pub fn read_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceDocument, AppError> {
    workspace::read_file(storage, workspace_id, relative_path)
}

pub fn list_recovery_drafts(
    storage: &Storage,
    workspace_id: &str,
) -> Result<Vec<RecoveryDraftSummary>, AppError> {
    workspace::list_recovery_drafts(storage, workspace_id)
}

pub fn save_file(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    let saved = super::telemetry::observe(
        storage,
        super::telemetry::PerformanceOperation::ResultSave,
        || {
            workspace::save_file_with_history(
                storage,
                workspace_id,
                relative_path,
                content,
                base_hash,
            )
        },
    )?;
    let _ = super::telemetry::record(storage, super::telemetry::ProductEvent::ResultSaved);
    super::telemetry::mark_first_core_loop(storage, super::telemetry::CoreLoopTrigger::Save);
    Ok(saved)
}

pub fn save_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    base_hash: &str,
) -> Result<(), AppError> {
    workspace::save_draft(storage, workspace_id, relative_path, content, base_hash)
}

pub fn discard_draft(
    storage: &Storage,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), AppError> {
    workspace::discard_draft(storage, workspace_id, relative_path)
}

pub fn remove(storage: &Storage, workspace_id: &str) -> Result<bool, AppError> {
    WorkspaceRepository::new(storage).remove(workspace_id)
}

pub fn resolve_context_workspace(
    storage: &Storage,
    workspace_id: Option<&str>,
) -> Result<WorkspaceSummary, AppError> {
    if let Some(workspace_id) = workspace_id {
        workspace::restore_workspace(storage, workspace_id)
    } else {
        workspace::register_standalone_workspace(storage)
    }
}

pub fn attach_file(
    storage: &Storage,
    workspace_id: &str,
    path: &Path,
) -> Result<WorkspaceDocument, AppError> {
    workspace::attach_selected_file(storage, workspace_id, path)
}

pub fn attach_files(
    storage: &Storage,
    workspace_id: &str,
    paths: &[std::path::PathBuf],
) -> Result<Vec<WorkspaceDocument>, AppError> {
    workspace::attach_selected_files(storage, workspace_id, paths)
}

pub fn save_authorized_file(
    storage: &Storage,
    source_id: &str,
    content: &str,
    base_hash: &str,
) -> Result<SaveOutcome, AppError> {
    let selected = WorkspaceRepository::new(storage)
        .authorized_file(source_id)?
        .ok_or_else(|| AppError::InvalidInput("Selected file authorization expired".into()))?;
    save_file(
        storage,
        &selected.workspace_id,
        &selected.virtual_path,
        content,
        base_hash,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::telemetry::get_settings;

    #[test]
    fn workbench_save_invites_only_after_success_without_collecting_events() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("test.md"), "before").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register(&storage, directory.path()).unwrap();
        let opened = read_file(&storage, &workspace.id, "test.md").unwrap();
        save_draft(
            &storage,
            &workspace.id,
            "test.md",
            "draft",
            &opened.content_hash,
        )
        .unwrap();
        assert!(!get_settings(&storage).unwrap().invitation_eligible);
        assert!(save_file(&storage, &workspace.id, "test.md", "after", "stale").is_err());
        assert!(!get_settings(&storage).unwrap().invitation_eligible);
        save_file(
            &storage,
            &workspace.id,
            "test.md",
            "after",
            &opened.content_hash,
        )
        .unwrap();
        let settings = get_settings(&storage).unwrap();
        assert!(settings.invitation_eligible);
        assert!(!settings.enabled);
        assert_eq!(settings.local_event_count, 0);
    }

    #[test]
    fn standalone_authorized_save_also_enables_the_invitation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.md");
        std::fs::write(&path, "before").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = resolve_context_workspace(&storage, None).unwrap();
        let opened = attach_file(&storage, &workspace.id, &path).unwrap();
        save_authorized_file(
            &storage,
            opened.source_id.as_deref().unwrap(),
            "after",
            &opened.content_hash,
        )
        .unwrap();
        assert!(get_settings(&storage).unwrap().invitation_eligible);
        assert_eq!(get_settings(&storage).unwrap().local_event_count, 0);
    }

    #[test]
    fn existing_file_save_and_version_restore_produce_operation_samples() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("old.md"), "before").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let workspace = register(&storage, directory.path()).unwrap();
        let opened = read_file(&storage, &workspace.id, "old.md").unwrap();
        storage.set_telemetry_settings(true, false).unwrap();
        let saved = save_file(
            &storage,
            &workspace.id,
            "old.md",
            "after",
            &opened.content_hash,
        )
        .unwrap();
        let versions = super::super::revision::list(&storage, &workspace.id, "old.md").unwrap();
        super::super::revision::restore(
            &storage,
            &workspace.id,
            "old.md",
            &versions.last().unwrap().id,
            &saved.content_hash,
        )
        .unwrap();
        let settings = get_settings(&storage).unwrap();
        for key in ["export_save_rate", "undo_rate"] {
            let metric = settings.kpis.iter().find(|k| k.key == key).unwrap();
            assert_eq!((metric.numerator, metric.denominator), (1, 1));
        }
        assert!(!settings.event_counts.contains_key("result_created"));
    }
}
