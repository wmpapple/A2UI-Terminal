CREATE TABLE IF NOT EXISTS a2ui_surfaces (
    id TEXT PRIMARY KEY NOT NULL,
    surface_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    protocol_version TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    validation_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE (workspace_id, surface_id)
);

CREATE TABLE IF NOT EXISTS a2ui_messages (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    surface_id TEXT,
    raw_message TEXT NOT NULL,
    valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
    validation_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS a2ui_events (
    id TEXT PRIMARY KEY NOT NULL,
    surface_row_id TEXT NOT NULL,
    component_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'review_required', 'denied')),
    payload_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (surface_row_id) REFERENCES a2ui_surfaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_a2ui_surfaces_workspace
    ON a2ui_surfaces(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2ui_messages_workspace
    ON a2ui_messages(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2ui_events_surface
    ON a2ui_events(surface_row_id, created_at);
