-- Durable tool instances are not user-published results. Preserve legacy tools.
INSERT OR IGNORE INTO scene_tool_instances(tool_result_id,template_id,binding_policy)
SELECT r.id,'legacy','optional' FROM results r
JOIN a2ui_surfaces s ON s.id=r.a2ui_surface_row_id
WHERE r.source_kind='a2ui_surface' AND s.raw_message='{"source":"scene_tool"}';
ALTER TABLE scene_tool_instances ADD COLUMN published_result_id TEXT REFERENCES results(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX scene_tool_publication ON scene_tool_instances(published_result_id);
