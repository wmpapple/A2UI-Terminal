BEGIN;

CREATE TABLE IF NOT EXISTS workspace_drafts (
    workspace_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content TEXT NOT NULL,
    base_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, relative_path),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_drafts_updated_at
    ON workspace_drafts(updated_at DESC);

PRAGMA user_version = 2;
COMMIT;
