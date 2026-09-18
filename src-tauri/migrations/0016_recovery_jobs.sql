CREATE TABLE task_runs (
    task_id TEXT PRIMARY KEY NOT NULL,
    result_id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    file_name TEXT NOT NULL UNIQUE,
    storage_ref TEXT NOT NULL UNIQUE,
    managed_state_json TEXT NOT NULL CHECK (json_valid(managed_state_json)),
    revision_id TEXT NOT NULL UNIQUE,
    content BLOB NOT NULL CHECK (length(content) <= 8388608),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    status TEXT NOT NULL DEFAULT 'prepared'
        CHECK (status IN ('prepared', 'completed', 'failed')),
    error_code TEXT,
    recovered INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_runs_status
    ON task_runs(status, updated_at DESC);

CREATE TABLE result_drafts (
    result_id TEXT PRIMARY KEY NOT NULL,
    base_hash TEXT NOT NULL CHECK (length(base_hash) = 64),
    content BLOB NOT NULL CHECK (length(content) <= 8388608),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE INDEX idx_result_drafts_updated
    ON result_drafts(updated_at DESC, result_id);

CREATE TABLE export_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    result_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    format TEXT NOT NULL
        CHECK (format IN ('markdown', 'plain_text', 'docx', 'pdf', 'rtf', 'csv', 'xlsx', 'json')),
    status TEXT NOT NULL
        CHECK (status IN ('preparing', 'generating', 'writing', 'committed', 'completed', 'cancelled', 'failed', 'interrupted')),
    target_path TEXT,
    file_name TEXT,
    output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
    error_code TEXT,
    recovered INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE,
    FOREIGN KEY (revision_id) REFERENCES document_versions(id) ON DELETE CASCADE
);

CREATE INDEX idx_export_jobs_status
    ON export_jobs(status, updated_at DESC, id DESC);
CREATE INDEX idx_export_jobs_result
    ON export_jobs(result_id, updated_at DESC, id DESC);
