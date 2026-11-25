PRAGMA foreign_keys = ON;
ALTER TABLE missions ADD COLUMN previous_status_id TEXT REFERENCES project_statuses(id) ON DELETE SET NULL;

CREATE TRIGGER mission_previous_status_after_update
AFTER UPDATE OF status_id, status_type, project_id ON missions
WHEN OLD.status_id IS NOT NEW.status_id OR OLD.status_type IS NOT NEW.status_type OR OLD.project_id IS NOT NEW.project_id
BEGIN
  UPDATE missions SET previous_status_id = CASE
    WHEN OLD.project_id = NEW.project_id AND OLD.status_type <> 'complete' AND NEW.status_type = 'complete' AND OLD.status_id <> NEW.status_id THEN OLD.status_id
    WHEN OLD.project_id = NEW.project_id AND OLD.status_type = 'complete' AND NEW.status_type = 'complete' THEN OLD.previous_status_id
    ELSE NULL END
  WHERE id = NEW.id;
END;
