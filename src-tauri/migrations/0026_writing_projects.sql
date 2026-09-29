CREATE TABLE writing_projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE writing_project_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
    section_id TEXT,
    project_revision INTEGER NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('running','review','accepted','failed','cancelled','interrupted','discarded')),
    content TEXT NOT NULL DEFAULT '',
    error TEXT,
    snapshot_json TEXT NOT NULL,
    draft_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX writing_one_active_run ON writing_project_runs(project_id) WHERE status='running';
CREATE INDEX writing_runs_project ON writing_project_runs(project_id,created_at);
CREATE TRIGGER writing_run_deleted AFTER DELETE ON writing_project_runs BEGIN
    DELETE FROM citation_outputs WHERE owner_kind='writing_run' AND owner_id=OLD.id;
END;
