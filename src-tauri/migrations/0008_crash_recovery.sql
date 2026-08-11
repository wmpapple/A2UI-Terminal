ALTER TABLE workspace_drafts
    ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_workspace_drafts_workspace_updated
    ON workspace_drafts(workspace_id, updated_at DESC, relative_path);
