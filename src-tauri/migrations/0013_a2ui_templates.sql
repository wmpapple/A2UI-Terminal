CREATE TABLE IF NOT EXISTS a2ui_templates (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_surface_id TEXT NOT NULL,
    protocol_version TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    state_json TEXT NOT NULL,
    permission_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_a2ui_templates_workspace
    ON a2ui_templates(workspace_id, updated_at DESC);
