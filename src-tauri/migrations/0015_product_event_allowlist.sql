CREATE TABLE product_events_v15 (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL CHECK (event_name IN (
        'task_completed', 'task_created', 'review_presented', 'review_decision',
        'review_adopted', 'accepted_patch', 'undo_completed', 'result_saved',
        'result_created', 'result_exported', 'context_planned', 'context_confirmed',
        'first_core_loop_completed', 'ai_request_completed', 'a2ui_rendered',
        'crash_recovery_detected', 'performance_sample'
    )),
    event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version = 1),
    app_version TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('windows')),
    properties_json TEXT NOT NULL CHECK (length(properties_json) <= 4096),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO product_events_v15
SELECT id, event_name, event_version, app_version, platform, properties_json, created_at
FROM product_events;
DROP TABLE product_events;
ALTER TABLE product_events_v15 RENAME TO product_events;
CREATE INDEX idx_product_events_name_created ON product_events(event_name, created_at);
