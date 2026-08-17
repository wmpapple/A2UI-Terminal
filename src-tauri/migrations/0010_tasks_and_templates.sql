CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
    task_kind TEXT NOT NULL CHECK (task_kind IN ('write', 'modify', 'organize', 'analyze')),
    desired_result_type TEXT NOT NULL CHECK (desired_result_type = 'document'),
    field_schema_json TEXT NOT NULL CHECK (json_valid(field_schema_json) AND json_type(field_schema_json) = 'array'),
    default_sections_json TEXT NOT NULL CHECK (json_valid(default_sections_json) AND json_type(default_sections_json) = 'array'),
    risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
    builtin INTEGER NOT NULL DEFAULT 1 CHECK (builtin IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL CHECK (template_version > 0),
    task_kind TEXT NOT NULL CHECK (task_kind IN ('write', 'modify', 'organize', 'analyze')),
    desired_result_type TEXT NOT NULL CHECK (desired_result_type = 'document'),
    status TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_input', 'ready', 'running', 'review_pending', 'completed', 'failed', 'cancelled')),
    input_answers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_answers_json) AND json_type(input_answers_json) = 'object'),
    question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count BETWEEN 0 AND 3),
    result_id TEXT UNIQUE,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id, template_version) REFERENCES task_templates(id, version),
    FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_recent
    ON tasks(workspace_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks(status, updated_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_task_unique
    ON results(task_id) WHERE task_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_results_task_guard_insert
BEFORE INSERT ON results
WHEN NEW.task_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id
    ) THEN RAISE(ABORT, 'result task must exist in the same workspace') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_results_task_guard_update
BEFORE UPDATE OF task_id, workspace_id ON results
WHEN NEW.task_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND workspace_id = NEW.workspace_id
    ) THEN RAISE(ABORT, 'result task must exist in the same workspace') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_result_guard_insert
BEFORE INSERT ON tasks
WHEN NEW.result_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM results
        WHERE id = NEW.result_id AND task_id = NEW.id AND workspace_id = NEW.workspace_id
    ) THEN RAISE(ABORT, 'task result must be its result in the same workspace') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_tasks_result_guard_update
BEFORE UPDATE OF result_id, workspace_id ON tasks
WHEN NEW.result_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM results
        WHERE id = NEW.result_id AND task_id = NEW.id AND workspace_id = NEW.workspace_id
    ) THEN RAISE(ABORT, 'task result must be its result in the same workspace') END;
END;

INSERT OR IGNORE INTO task_templates
    (id, version, name, description, task_kind, desired_result_type, field_schema_json, default_sections_json, risk_level, builtin)
VALUES
    ('meeting_minutes', 1, '会议纪要', '把已授权的会议资料整理为结构清晰的纪要草稿。', 'organize', 'document',
     '[{"id":"meetingTitle","label":"会议主题","kind":"short_text","required":true,"maxLength":120},{"id":"audience","label":"阅读对象","kind":"short_text","required":false,"maxLength":80,"defaultValue":"参会人员"},{"id":"focus","label":"重点关注","kind":"short_text","required":false,"maxLength":160}]',
     '["会议信息","核心结论","讨论要点","行动项","待确认事项"]', 'low', 1),
    ('document_summary', 1, '文档总结', '把已授权的文档资料整理为面向指定用途的摘要草稿。', 'analyze', 'document',
     '[{"id":"summaryPurpose","label":"总结用途","kind":"select","required":true,"options":["快速阅读","决策支持","汇报分享"]},{"id":"audience","label":"阅读对象","kind":"short_text","required":false,"maxLength":80,"defaultValue":"普通读者"},{"id":"length","label":"篇幅","kind":"select","required":false,"options":["简短","标准","详细"],"defaultValue":"标准"}]',
     '["内容概览","关键观点","重要事实","结论与建议","待核实事项"]', 'low', 1),
    ('weekly_report', 1, '周报', '把已授权的本周资料整理为周报草稿。', 'organize', 'document',
     '[{"id":"reportPeriod","label":"报告周期","kind":"short_text","required":true,"maxLength":80},{"id":"audience","label":"汇报对象","kind":"short_text","required":false,"maxLength":80,"defaultValue":"团队负责人"},{"id":"tone","label":"表达风格","kind":"select","required":false,"options":["简洁","正式","详细"],"defaultValue":"简洁"}]',
     '["本周完成","关键进展","问题与风险","下周计划","需要支持"]', 'low', 1),
    ('resume_optimization', 1, '简历优化', '基于已授权的简历资料生成面向目标岗位的优化草稿。', 'modify', 'document',
     '[{"id":"targetRole","label":"目标岗位","kind":"short_text","required":true,"maxLength":120},{"id":"language","label":"简历语言","kind":"select","required":false,"options":["中文","英文","中英双语"],"defaultValue":"中文"},{"id":"focus","label":"优化重点","kind":"select","required":false,"options":["内容表达","岗位匹配","结构精简"],"defaultValue":"岗位匹配"}]',
     '["个人概述","核心能力","工作经历","项目经历","教育与技能","待补充信息"]', 'medium', 1);
