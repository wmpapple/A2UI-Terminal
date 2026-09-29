CREATE TABLE critic_reports (
    id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    result_id TEXT REFERENCES results(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK(engine IN ('local','llm')),
    payload_json TEXT NOT NULL,
    UNIQUE(target_key,engine)
);
CREATE TRIGGER critic_authorization_revoked AFTER DELETE ON workspace_files BEGIN
    DELETE FROM critic_reports
    WHERE json_extract(target_key, '$.kind') = 'workspace_file'
      AND json_extract(target_key, '$.sourceId') = OLD.source_id;
END;
