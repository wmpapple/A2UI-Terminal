CREATE TABLE knowledge_fragments (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    locator_json TEXT NOT NULL
);
CREATE INDEX idx_fragments_source ON knowledge_fragments(source_kind, source_id);
CREATE TABLE citation_requests (
    id TEXT PRIMARY KEY,
    manifest_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE request_citations (
    request_id TEXT NOT NULL REFERENCES citation_requests(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    fragment_id TEXT REFERENCES knowledge_fragments(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    locator_json TEXT NOT NULL,
    unavailable_status TEXT NOT NULL DEFAULT 'unavailable',
    PRIMARY KEY(request_id, key)
);
CREATE TABLE citation_outputs (
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    request_id TEXT NOT NULL REFERENCES citation_requests(id) ON DELETE CASCADE,
    PRIMARY KEY(owner_kind, owner_id, revision_id)
);
CREATE TABLE citation_reviews (
    review_id TEXT PRIMARY KEY REFERENCES review_requests(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL REFERENCES citation_requests(id) ON DELETE CASCADE
);
CREATE TABLE knowledge_locator_jobs (
    source_id TEXT PRIMARY KEY REFERENCES personal_knowledge(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT
);
CREATE TRIGGER citation_knowledge_deleted AFTER DELETE ON personal_knowledge BEGIN
    DELETE FROM knowledge_fragments WHERE source_kind='personal_knowledge' AND source_id=OLD.id;
END;
CREATE TRIGGER citation_knowledge_invalid AFTER UPDATE OF status,raw_hash ON personal_knowledge
WHEN NEW.status <> 'ready' OR OLD.raw_hash <> NEW.raw_hash BEGIN
    UPDATE request_citations SET unavailable_status=CASE WHEN OLD.raw_hash <> NEW.raw_hash THEN 'stale' ELSE 'unavailable' END
    WHERE fragment_id IN (SELECT id FROM knowledge_fragments WHERE source_kind='personal_knowledge' AND source_id=OLD.id);
    DELETE FROM knowledge_fragments WHERE source_kind='personal_knowledge' AND source_id=OLD.id;
END;
CREATE TRIGGER citation_authorization_revoked AFTER DELETE ON workspace_files BEGIN
    DELETE FROM knowledge_fragments WHERE source_kind='workspace' AND source_id=OLD.source_id;
END;
CREATE TRIGGER citation_message_deleted AFTER DELETE ON messages BEGIN
    DELETE FROM citation_outputs WHERE owner_kind='message' AND owner_id=OLD.id;
END;
CREATE TRIGGER citation_result_deleted AFTER DELETE ON results BEGIN
    DELETE FROM citation_outputs WHERE owner_kind='result' AND owner_id=OLD.id;
END;
