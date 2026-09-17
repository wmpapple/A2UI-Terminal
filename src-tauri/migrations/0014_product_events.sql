CREATE TABLE telemetry_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    invitation_eligible INTEGER NOT NULL DEFAULT 0 CHECK (invitation_eligible IN (0, 1)),
    invitation_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (invitation_dismissed IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO telemetry_settings(singleton) VALUES (1);

CREATE TABLE product_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL CHECK (event_name IN (
        'task_completed',
        'task_created',
        'review_presented',
        'review_decision',
        'review_adopted',
        'accepted_patch',
        'undo_completed',
        'result_saved',
        'result_created',
        'result_exported',
        'context_planned',
        'context_confirmed',
        'first_core_loop_completed',
        'ai_request_completed',
        'a2ui_rendered',
        'crash_recovery_detected',
        'performance_sample'
    )),
    event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version = 1),
    app_version TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('windows')),
    properties_json TEXT NOT NULL CHECK (length(properties_json) <= 4096),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_events_name_created
ON product_events(event_name, created_at);
