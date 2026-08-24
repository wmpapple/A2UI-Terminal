CREATE TABLE IF NOT EXISTS review_requests (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    result_id TEXT,
    source TEXT NOT NULL
        CHECK (source IN ('chat', 'selection', 'template', 'a2ui_action', 'import_transform')),
    operation_kind TEXT NOT NULL
        CHECK (operation_kind IN ('document_patch', 'create_file', 'replace_result')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partially_accepted', 'accepted', 'rejected', 'applied', 'conflicted', 'failed', 'undone')),
    summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    base_revision_id TEXT,
    base_hash TEXT,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    application_operation_id TEXT,
    output_result_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    applied_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE SET NULL,
    FOREIGN KEY (application_operation_id) REFERENCES patch_operations(id) ON DELETE SET NULL,
    FOREIGN KEY (output_result_id) REFERENCES results(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS review_blocks (
    id TEXT PRIMARY KEY NOT NULL,
    review_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('document_patch', 'create_file', 'replace_result')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    target_label TEXT NOT NULL CHECK (length(target_label) BETWEEN 1 AND 240),
    operation TEXT,
    before_content TEXT NOT NULL,
    after_content TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    suggested_file_name TEXT,
    decided_file_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (review_id) REFERENCES review_requests(id) ON DELETE CASCADE,
    UNIQUE (review_id, position)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_workspace
    ON review_requests(workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_status
    ON review_requests(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_review_blocks_review
    ON review_blocks(review_id, position);
