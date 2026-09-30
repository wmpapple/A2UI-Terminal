-- Binding is ownership, never an implicit source grant or executable action.
CREATE TABLE scene_tool_instances (
 tool_result_id TEXT PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
 template_id TEXT NOT NULL,
 binding_policy TEXT NOT NULL CHECK(binding_policy IN ('optional','document'))
);
CREATE TABLE scene_template_policies (
 template_id TEXT PRIMARY KEY REFERENCES a2ui_templates(id) ON DELETE CASCADE,
 source_template_id TEXT NOT NULL,
 binding_policy TEXT NOT NULL CHECK(binding_policy IN ('optional','document'))
);
CREATE TABLE scene_tool_bindings (
 tool_result_id TEXT PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
 binding_json TEXT NOT NULL,
 target_title TEXT NOT NULL,
 bound_hash TEXT NOT NULL,
 bound_revision_id TEXT,
 version TEXT NOT NULL,
 reviewed_hash TEXT,
 reviewed_revision_id TEXT,
 reviewed_at TEXT
);
CREATE INDEX scene_bindings_target ON scene_tool_bindings(binding_json);
