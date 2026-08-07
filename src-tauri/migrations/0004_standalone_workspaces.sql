BEGIN;

ALTER TABLE workspaces
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'directory'
    CHECK (kind IN ('directory', 'standalone'));

CREATE TABLE IF NOT EXISTS workspace_files (
    source_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    virtual_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE (workspace_id, absolute_path),
    UNIQUE (workspace_id, virtual_path)
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace
    ON workspace_files(workspace_id, created_at);

PRAGMA user_version = 4;
COMMIT;
