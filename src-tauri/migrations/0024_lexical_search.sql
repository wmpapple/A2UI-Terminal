-- Derived, local-only search data. Citation authority remains request-scoped.
CREATE TABLE search_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation INTEGER NOT NULL);
INSERT INTO search_state VALUES(1,0);
CREATE TABLE search_documents (
    id INTEGER PRIMARY KEY,
    scope TEXT NOT NULL,
    source_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    index_version INTEGER NOT NULL,
    UNIQUE(scope, source_key)
);
CREATE INDEX search_documents_source ON search_documents(kind, source_id);
CREATE TABLE search_chunks (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES search_documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    start_character INTEGER NOT NULL,
    end_character INTEGER NOT NULL,
    text TEXT NOT NULL,
    tokens TEXT NOT NULL,
    UNIQUE(document_id, ordinal)
);
CREATE VIRTUAL TABLE search_fts USING fts5(tokens, content='search_chunks', content_rowid='id');
CREATE TRIGGER search_chunk_insert AFTER INSERT ON search_chunks BEGIN
    INSERT INTO search_fts(rowid,tokens) VALUES(NEW.id,NEW.tokens);
END;
CREATE TRIGGER search_chunk_delete AFTER DELETE ON search_chunks BEGIN
    INSERT INTO search_fts(search_fts,rowid,tokens) VALUES('delete',OLD.id,OLD.tokens);
END;
CREATE TRIGGER search_knowledge_delete AFTER DELETE ON personal_knowledge BEGIN
    DELETE FROM search_documents WHERE kind='knowledge' AND source_id=OLD.id;
END;
CREATE TRIGGER search_knowledge_update AFTER UPDATE ON personal_knowledge BEGIN
    DELETE FROM search_documents WHERE kind='knowledge' AND source_id=OLD.id;
END;
CREATE TRIGGER search_result_delete AFTER DELETE ON results BEGIN
    DELETE FROM search_documents WHERE kind='result' AND source_id=OLD.id;
END;
CREATE TRIGGER search_result_update AFTER UPDATE ON results BEGIN
    DELETE FROM search_documents WHERE kind='result' AND source_id=OLD.id;
END;
CREATE TRIGGER search_source_revoke AFTER DELETE ON workspace_files BEGIN
    DELETE FROM search_documents WHERE kind='source' AND source_id=OLD.source_id;
    DELETE FROM search_documents WHERE kind='result' AND source_id IN (
        SELECT id FROM results WHERE workspace_id=OLD.workspace_id AND source_kind='workspace_file'
    );
END;
CREATE TRIGGER search_pack_delete AFTER DELETE ON context_packs BEGIN
    DELETE FROM search_documents WHERE kind='pack' AND source_id=OLD.id;
END;
CREATE TRIGGER search_workspace_delete AFTER DELETE ON workspaces BEGIN
    DELETE FROM search_documents WHERE scope='workspace:' || OLD.id;
END;

CREATE TRIGGER search_epoch_personal_knowledge_insert AFTER INSERT ON personal_knowledge BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_personal_knowledge_update AFTER UPDATE ON personal_knowledge BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_personal_knowledge_delete AFTER DELETE ON personal_knowledge BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_results_insert AFTER INSERT ON results BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_results_update AFTER UPDATE ON results BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_results_delete AFTER DELETE ON results BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspace_files_insert AFTER INSERT ON workspace_files BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspace_files_update AFTER UPDATE ON workspace_files BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspace_files_delete AFTER DELETE ON workspace_files BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspaces_insert AFTER INSERT ON workspaces BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspaces_update AFTER UPDATE ON workspaces BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_workspaces_delete AFTER DELETE ON workspaces BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_packs_insert AFTER INSERT ON context_packs BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_packs_update AFTER UPDATE ON context_packs BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_packs_delete AFTER DELETE ON context_packs BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_pack_items_insert AFTER INSERT ON context_pack_items BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_pack_items_update AFTER UPDATE ON context_pack_items BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;

CREATE TRIGGER search_epoch_context_pack_items_delete AFTER DELETE ON context_pack_items BEGIN
    UPDATE search_state SET generation=generation+1 WHERE singleton=1;
END;
