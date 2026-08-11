CREATE TABLE IF NOT EXISTS patch_operations (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT,
    assistant_message_id TEXT,
    summary TEXT NOT NULL,
    patch_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'undone')),
    undo_of TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (undo_of) REFERENCES patch_operations(id) ON DELETE SET NULL
);

ALTER TABLE document_versions ADD COLUMN operation_id TEXT;
ALTER TABLE document_versions ADD COLUMN version_kind TEXT NOT NULL DEFAULT 'snapshot'
    CHECK (version_kind IN ('snapshot', 'before', 'after'));

CREATE INDEX IF NOT EXISTS idx_patch_operations_workspace
    ON patch_operations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_operation
    ON document_versions(operation_id, relative_path, version_kind);
