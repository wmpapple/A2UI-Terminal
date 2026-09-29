CREATE TABLE document_structures (
    target_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    result_id TEXT REFERENCES results(id) ON DELETE CASCADE,
    ast_json TEXT NOT NULL,
    PRIMARY KEY(target_key, content_hash)
);
CREATE TRIGGER structure_authorization_revoked AFTER DELETE ON workspace_files BEGIN
    DELETE FROM document_structures
    WHERE json_extract(target_key, '$.kind') = 'workspace_file'
      AND json_extract(target_key, '$.sourceId') = OLD.source_id;
END;
ALTER TABLE review_requests ADD COLUMN structured_binding TEXT;
