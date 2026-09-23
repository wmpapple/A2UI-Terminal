CREATE TABLE personal_knowledge (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    format TEXT NOT NULL CHECK(format IN ('txt','md','docx','pdf','csv','xlsx')),
    original_name TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    extracted_hash TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    source_version INTEGER NOT NULL CHECK(source_version > 0),
    parsed_json TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('ready','deleting','failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX personal_knowledge_ready_hash ON personal_knowledge(raw_hash) WHERE status = 'ready';
