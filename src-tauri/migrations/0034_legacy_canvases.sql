-- Keep the schema deployed by the earlier canvas preview so existing local data survives.
CREATE TABLE canvases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    binding_fingerprint TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    blocks_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX canvases_updated_idx ON canvases(updated_at DESC, id);
