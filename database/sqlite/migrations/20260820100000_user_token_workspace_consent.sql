-- Organization-bound USER_TOKEN workspace consent (contract v95).
-- Legacy workspace_id remains issuance/audit metadata; it is backfilled into
-- the explicit allowlist below and is never an authorization input.

PRAGMA foreign_keys = ON;

BEGIN;

ALTER TABLE user_tokens ADD COLUMN organization_id TEXT REFERENCES organizations (id) ON DELETE RESTRICT;
ALTER TABLE user_tokens ADD COLUMN all_workspaces INTEGER NOT NULL DEFAULT 0 CHECK (all_workspaces IN (0, 1));

CREATE TABLE user_token_workspaces (
  token_id TEXT NOT NULL REFERENCES user_tokens (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY (token_id, workspace_id)
);

-- Preserve exactly the consent that legacy tokens had at issuance. Tokens
-- without an issuance workspace deliberately remain consentless.
UPDATE user_tokens
   SET organization_id = (
     SELECT organization_id FROM workspaces WHERE id = user_tokens.workspace_id
   )
 WHERE workspace_id IS NOT NULL;

INSERT INTO user_token_workspaces (token_id, workspace_id, created_at)
SELECT id, workspace_id, created_at
  FROM user_tokens
 WHERE workspace_id IS NOT NULL;

CREATE TRIGGER trg_user_token_workspaces_organization_insert
BEFORE INSERT ON user_token_workspaces
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
    FROM user_tokens t
    JOIN workspaces w ON w.id = NEW.workspace_id
   WHERE t.id = NEW.token_id
     AND t.organization_id IS NOT NULL
     AND t.organization_id = w.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'token workspace consent must belong to the token organization');
END;

CREATE TRIGGER trg_user_token_workspaces_organization_update
BEFORE UPDATE OF token_id, workspace_id ON user_token_workspaces
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
    FROM user_tokens t
    JOIN workspaces w ON w.id = NEW.workspace_id
   WHERE t.id = NEW.token_id
     AND t.organization_id IS NOT NULL
     AND t.organization_id = w.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'token workspace consent must belong to the token organization');
END;

CREATE TRIGGER trg_user_tokens_organization_allowlist
BEFORE UPDATE OF organization_id ON user_tokens
FOR EACH ROW WHEN EXISTS (
  SELECT 1
    FROM user_token_workspaces utw
    JOIN workspaces w ON w.id = utw.workspace_id
   WHERE utw.token_id = NEW.id
     AND (NEW.organization_id IS NULL OR w.organization_id <> NEW.organization_id)
)
BEGIN
  SELECT RAISE(ABORT, 'token organization must match every explicit workspace consent');
END;

CREATE INDEX idx_user_tokens_organization_status ON user_tokens (organization_id, status);
CREATE INDEX idx_user_token_workspaces_workspace_token ON user_token_workspaces (workspace_id, token_id);

COMMIT;
