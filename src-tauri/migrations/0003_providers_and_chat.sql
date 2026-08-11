ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'
    CHECK (status IN ('streaming', 'complete', 'stopped', 'error'));
ALTER TABLE messages ADD COLUMN request_id TEXT;
ALTER TABLE messages ADD COLUMN provider_id TEXT;
ALTER TABLE messages ADD COLUMN error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON messages(session_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_request_role
    ON messages(request_id, role) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    sources_json TEXT NOT NULL,
    character_count INTEGER NOT NULL,
    estimated_tokens INTEGER NOT NULL,
    has_sensitive_warning INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_session
    ON context_snapshots(session_id, created_at DESC);
