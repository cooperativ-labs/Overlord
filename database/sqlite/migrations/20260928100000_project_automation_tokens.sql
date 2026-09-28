PRAGMA foreign_keys = ON;
BEGIN;

ALTER TABLE user_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'mission_lifecycle', 'project_automation'));
UPDATE user_tokens SET scope = 'mission_lifecycle'
 WHERE EXISTS (SELECT 1 FROM user_token_scopes s WHERE s.token_id = user_tokens.id AND s.deleted_at IS NULL);

CREATE TABLE user_token_projects (
  token_id TEXT NOT NULL REFERENCES user_tokens (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (token_id, project_id)
);
CREATE INDEX idx_user_token_projects_project_token ON user_token_projects (project_id, token_id);

CREATE TRIGGER trg_user_token_projects_insert BEFORE INSERT ON user_token_projects
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM user_tokens t
  JOIN projects p ON p.id = NEW.project_id AND p.deleted_at IS NULL
  JOIN workspaces w ON w.id = p.workspace_id AND w.deleted_at IS NULL
  JOIN user_token_workspaces utw ON utw.token_id = t.id AND utw.workspace_id = w.id
  WHERE t.id = NEW.token_id AND t.scope = 'project_automation'
    AND t.all_workspaces = 0 AND t.organization_id = w.organization_id
)
BEGIN SELECT RAISE(ABORT, 'token project must belong to its organization and consented workspace'); END;

CREATE TRIGGER trg_user_token_projects_update BEFORE UPDATE OF token_id, project_id ON user_token_projects
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM user_tokens t
  JOIN projects p ON p.id = NEW.project_id AND p.deleted_at IS NULL
  JOIN workspaces w ON w.id = p.workspace_id AND w.deleted_at IS NULL
  JOIN user_token_workspaces utw ON utw.token_id = t.id AND utw.workspace_id = w.id
  WHERE t.id = NEW.token_id AND t.scope = 'project_automation'
    AND t.all_workspaces = 0 AND t.organization_id = w.organization_id
)
BEGIN SELECT RAISE(ABORT, 'token project must belong to its organization and consented workspace'); END;

CREATE TRIGGER trg_user_token_projects_consent_delete BEFORE DELETE ON user_token_workspaces
FOR EACH ROW
BEGIN
  DELETE FROM user_token_projects
   WHERE token_id = OLD.token_id
     AND project_id IN (SELECT id FROM projects WHERE workspace_id = OLD.workspace_id);
END;

CREATE TRIGGER trg_user_token_projects_consent_update BEFORE UPDATE OF token_id, workspace_id ON user_token_workspaces
FOR EACH ROW WHEN OLD.token_id <> NEW.token_id OR OLD.workspace_id <> NEW.workspace_id
BEGIN
  DELETE FROM user_token_projects
   WHERE token_id = OLD.token_id
     AND project_id IN (SELECT id FROM projects WHERE workspace_id = OLD.workspace_id);
END;

CREATE TRIGGER trg_user_token_projects_token_update BEFORE UPDATE OF organization_id, scope, all_workspaces ON user_tokens
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM user_token_projects utp
  JOIN projects p ON p.id = utp.project_id
  JOIN workspaces w ON w.id = p.workspace_id
  JOIN user_token_workspaces utw ON utw.token_id = NEW.id AND utw.workspace_id = w.id
  WHERE utp.token_id = NEW.id AND
    (NEW.scope <> 'project_automation' OR NEW.all_workspaces <> 0 OR NEW.organization_id <> w.organization_id)
)
BEGIN SELECT RAISE(ABORT, 'token project selection cannot outlive its scope or organization'); END;

COMMIT;
