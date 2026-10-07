ALTER TABLE canvases ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE canvases ADD COLUMN viewport_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}';
ALTER TABLE canvases ADD COLUMN edges_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX canvases_workspace_idx ON canvases(workspace_id, updated_at DESC);
-- Older result-bound canvases can be assigned without inspecting document content.
UPDATE canvases SET workspace_id = (
    SELECT workspace_id FROM results
    WHERE results.id = json_extract(canvases.binding_json, '$.resultId')
) WHERE json_extract(binding_json, '$.type') = 'result';
-- Preview canvases without a binding did not record a workspace. Attach them to
-- the most recently used workspace so they stay accessible and remain isolated.
UPDATE canvases SET workspace_id = (
    SELECT id FROM workspaces ORDER BY updated_at DESC, id DESC LIMIT 1
) WHERE workspace_id IS NULL;
