-- Organization-bound USER_TOKEN workspace consent (contract v95).
-- Legacy workspace_id remains issuance/audit metadata; it is backfilled into
-- the explicit allowlist below and is never an authorization input.

BEGIN;

ALTER TABLE user_tokens
  ADD COLUMN organization_id text REFERENCES organizations (id) ON DELETE RESTRICT,
  ADD COLUMN all_workspaces boolean NOT NULL DEFAULT false;

CREATE TABLE user_token_workspaces (
  token_id text NOT NULL REFERENCES user_tokens (id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (token_id, workspace_id)
);

-- Preserve exactly the consent that legacy tokens had at issuance. Tokens
-- without an issuance workspace deliberately remain consentless.
UPDATE user_tokens t
   SET organization_id = w.organization_id
  FROM workspaces w
 WHERE w.id = t.workspace_id;

INSERT INTO user_token_workspaces (token_id, workspace_id, created_at)
SELECT t.id, t.workspace_id, t.created_at
  FROM user_tokens t
 WHERE t.workspace_id IS NOT NULL
ON CONFLICT (token_id, workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_user_token_workspace_organization()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  token_organization_id text;
  workspace_organization_id text;
BEGIN
  SELECT organization_id INTO token_organization_id FROM user_tokens WHERE id = NEW.token_id;
  SELECT organization_id INTO workspace_organization_id FROM workspaces WHERE id = NEW.workspace_id;
  IF token_organization_id IS NULL OR token_organization_id <> workspace_organization_id THEN
    RAISE EXCEPTION 'token workspace consent must belong to the token organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_token_workspaces_organization
  BEFORE INSERT OR UPDATE OF token_id, workspace_id ON user_token_workspaces
  FOR EACH ROW EXECUTE FUNCTION enforce_user_token_workspace_organization();

CREATE OR REPLACE FUNCTION enforce_user_token_organization_allowlist()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM user_token_workspaces utw
      JOIN workspaces w ON w.id = utw.workspace_id
     WHERE utw.token_id = NEW.id
       AND (NEW.organization_id IS NULL OR w.organization_id <> NEW.organization_id)
  ) THEN
    RAISE EXCEPTION 'token organization must match every explicit workspace consent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_tokens_organization_allowlist
  BEFORE UPDATE OF organization_id ON user_tokens
  FOR EACH ROW EXECUTE FUNCTION enforce_user_token_organization_allowlist();

CREATE INDEX idx_user_tokens_organization_status ON user_tokens (organization_id, status);
CREATE INDEX idx_user_token_workspaces_workspace_token ON user_token_workspaces (workspace_id, token_id);

COMMIT;
