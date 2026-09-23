-- Preserve existing workspace references and add library references without copying content.
CREATE TABLE context_pack_knowledge_items (
    pack_id TEXT NOT NULL REFERENCES context_packs(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES personal_knowledge(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (pack_id, source_id),
    UNIQUE (pack_id, position)
);
CREATE INDEX idx_pack_knowledge_source ON context_pack_knowledge_items(source_id);

CREATE TRIGGER knowledge_unavailable_pack_cleanup
AFTER UPDATE OF status ON personal_knowledge WHEN NEW.status <> 'ready'
BEGIN
    DELETE FROM context_pack_knowledge_items WHERE source_id = NEW.id;
    DELETE FROM context_packs
    WHERE NOT EXISTS (SELECT 1 FROM context_pack_items WHERE pack_id = context_packs.id)
      AND NOT EXISTS (SELECT 1 FROM context_pack_knowledge_items WHERE pack_id = context_packs.id);
END;
