BEGIN;

ALTER TABLE user_tokens ADD COLUMN scope text NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'mission_lifecycle', 'project_automation'));
UPDATE user_tokens t SET scope = 'mission_lifecycle'
 WHERE EXISTS (SELECT 1 FROM user_token_scopes s WHERE s.token_id = t.id AND s.deleted_at IS NULL);

CREATE TABLE user_token_projects (
  token_id text NOT NULL REFERENCES user_tokens (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (token_id, project_id)
);
CREATE INDEX idx_user_token_projects_project_token ON user_token_projects (project_id, token_id);

CREATE FUNCTION enforce_user_token_project_selection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_selection boolean;
BEGIN
  SELECT true INTO valid_selection FROM user_tokens t
  JOIN projects p ON p.id = NEW.project_id AND p.deleted_at IS NULL
  JOIN workspaces w ON w.id = p.workspace_id AND w.deleted_at IS NULL
  JOIN user_token_workspaces utw ON utw.token_id = t.id AND utw.workspace_id = w.id
  WHERE t.id = NEW.token_id AND t.scope = 'project_automation'
    AND t.all_workspaces = false AND t.organization_id = w.organization_id;
  IF valid_selection IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'token project must belong to its organization and consented workspace';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_user_token_projects_guard
  BEFORE INSERT OR UPDATE OF token_id, project_id ON user_token_projects
  FOR EACH ROW EXECUTE FUNCTION enforce_user_token_project_selection();

CREATE FUNCTION enforce_user_token_project_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_token_workspaces' THEN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM user_token_projects
        WHERE token_id = OLD.token_id
          AND project_id IN (SELECT id FROM projects WHERE workspace_id = OLD.workspace_id);
      RETURN OLD;
    END IF;
    IF OLD.token_id <> NEW.token_id OR OLD.workspace_id <> NEW.workspace_id THEN
      DELETE FROM user_token_projects
        WHERE token_id = OLD.token_id
          AND project_id IN (SELECT id FROM projects WHERE workspace_id = OLD.workspace_id);
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM user_token_projects utp
             JOIN projects p ON p.id = utp.project_id
             JOIN workspaces w ON w.id = p.workspace_id
             WHERE utp.token_id = NEW.id AND
               (NEW.scope <> 'project_automation' OR NEW.all_workspaces OR NEW.organization_id <> w.organization_id)) THEN
    RAISE EXCEPTION 'token project selection cannot outlive its scope or organization';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_user_token_projects_consent_delete
  BEFORE DELETE OR UPDATE OF token_id, workspace_id ON user_token_workspaces FOR EACH ROW
  EXECUTE FUNCTION enforce_user_token_project_consistency();
CREATE TRIGGER trg_user_token_projects_token_update
  BEFORE UPDATE OF organization_id, scope, all_workspaces ON user_tokens FOR EACH ROW
  EXECUTE FUNCTION enforce_user_token_project_consistency();

COMMIT;
