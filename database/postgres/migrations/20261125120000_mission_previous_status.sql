ALTER TABLE missions ADD COLUMN previous_status_id TEXT REFERENCES project_statuses(id) ON DELETE SET NULL;

CREATE FUNCTION mission_previous_status_on_update() RETURNS trigger AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.status_id IS DISTINCT FROM NEW.status_id OR OLD.status_type IS DISTINCT FROM NEW.status_type THEN
    IF OLD.project_id = NEW.project_id AND OLD.status_type <> 'complete' AND NEW.status_type = 'complete' AND OLD.status_id <> NEW.status_id THEN
      NEW.previous_status_id := OLD.status_id;
    ELSIF OLD.project_id = NEW.project_id AND OLD.status_type = 'complete' AND NEW.status_type = 'complete' THEN
      NEW.previous_status_id := OLD.previous_status_id;
    ELSE
      NEW.previous_status_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mission_previous_status_before_update BEFORE UPDATE OF status_id, status_type, project_id ON missions
FOR EACH ROW EXECUTE FUNCTION mission_previous_status_on_update();
