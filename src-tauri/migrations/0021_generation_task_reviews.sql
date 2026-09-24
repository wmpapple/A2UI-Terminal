ALTER TABLE review_requests ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX idx_review_task ON review_requests(task_id);
CREATE TRIGGER generation_task_review_guard BEFORE INSERT ON review_requests
WHEN NEW.task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE id=NEW.task_id AND workspace_id=NEW.workspace_id AND status='ready')
    THEN RAISE(ABORT, 'generation task is not ready') END;
END;
CREATE TRIGGER generation_task_review_pending AFTER INSERT ON review_requests
WHEN NEW.task_id IS NOT NULL
BEGIN
  UPDATE tasks SET status='review_pending', updated_at=CURRENT_TIMESTAMP WHERE id=NEW.task_id;
END;
CREATE TRIGGER generation_task_review_applied AFTER UPDATE OF status ON review_requests
WHEN NEW.task_id IS NOT NULL AND NEW.status='applied'
BEGIN
  UPDATE tasks SET status='completed', result_id=NEW.output_result_id, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=NEW.task_id;
END;
CREATE TRIGGER generation_task_review_retry AFTER UPDATE OF status ON review_requests
WHEN NEW.task_id IS NOT NULL AND NEW.status IN ('rejected','failed','undone')
  AND OLD.status NOT IN ('rejected','failed','undone')
BEGIN
  UPDATE tasks SET status='ready', result_id=NULL, completed_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=NEW.task_id;
END;
