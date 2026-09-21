ALTER TABLE results ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_results_pinned_recent
    ON results(pinned DESC, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_results_workspace_pinned_recent
    ON results(workspace_id, pinned DESC, updated_at DESC, id DESC);
