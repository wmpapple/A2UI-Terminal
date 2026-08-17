CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT,
    result_type TEXT NOT NULL
        CHECK (result_type IN ('document', 'spreadsheet', 'checklist', 'form', 'tool')),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'generating', 'review_pending', 'ready', 'exporting', 'failed', 'archived')),
    storage_kind TEXT NOT NULL
        CHECK (storage_kind IN ('workspace_file', 'standalone_file', 'managed_local')),
    storage_ref TEXT NOT NULL UNIQUE,
    source_kind TEXT NOT NULL
        CHECK (source_kind IN ('workspace_file', 'a2ui_surface', 'managed_local')),
    source_ref TEXT NOT NULL,
    current_revision_id TEXT,
    active_session_id TEXT,
    a2ui_surface_row_id TEXT,
    managed_state_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (current_revision_id) REFERENCES document_versions(id) ON DELETE SET NULL,
    FOREIGN KEY (active_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (a2ui_surface_row_id) REFERENCES a2ui_surfaces(id) ON DELETE SET NULL,
    UNIQUE (workspace_id, source_kind, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_results_recent
    ON results(status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_results_workspace
    ON results(workspace_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_results_session
    ON results(active_session_id) WHERE active_session_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_results_revision_insert
AFTER INSERT ON document_versions
BEGIN
    UPDATE results
    SET current_revision_id = (
            SELECT id FROM document_versions
            WHERE workspace_id = NEW.workspace_id
              AND relative_path = NEW.relative_path
            ORDER BY created_at DESC, rowid DESC LIMIT 1
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = NEW.workspace_id
      AND source_kind = 'workspace_file'
      AND source_ref = NEW.relative_path;
END;

CREATE TRIGGER IF NOT EXISTS trg_results_revision_delete
AFTER DELETE ON document_versions
BEGIN
    UPDATE results
    SET current_revision_id = (
            SELECT id FROM document_versions
            WHERE workspace_id = OLD.workspace_id
              AND relative_path = OLD.relative_path
            ORDER BY created_at DESC, rowid DESC LIMIT 1
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = OLD.workspace_id
      AND source_kind = 'workspace_file'
      AND source_ref = OLD.relative_path;
END;
