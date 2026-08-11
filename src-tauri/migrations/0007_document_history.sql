ALTER TABLE document_versions ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'
    CHECK (source IN ('legacy', 'initial', 'autosave', 'patch', 'restore'));
ALTER TABLE document_versions ADD COLUMN summary TEXT;

UPDATE document_versions
SET source = 'patch',
    summary = (
        SELECT patch_operations.summary
        FROM patch_operations
        WHERE patch_operations.id = document_versions.operation_id
    )
WHERE operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_versions_history
    ON document_versions(workspace_id, relative_path, created_at DESC, id DESC);
