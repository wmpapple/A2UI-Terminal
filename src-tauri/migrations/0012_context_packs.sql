CREATE TABLE IF NOT EXISTS context_packs (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 80),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS context_pack_items (
    pack_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (pack_id, source_id),
    FOREIGN KEY (pack_id) REFERENCES context_packs(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES workspace_files(source_id) ON DELETE CASCADE,
    UNIQUE (pack_id, position)
);

CREATE INDEX IF NOT EXISTS idx_context_packs_workspace
    ON context_packs(workspace_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_context_pack_items_source
    ON context_pack_items(source_id, pack_id);
