-- All scene tools support standalone use. Preserve existing targets and entries.
UPDATE scene_tool_instances SET binding_policy='optional';
UPDATE scene_template_policies SET binding_policy='optional';
