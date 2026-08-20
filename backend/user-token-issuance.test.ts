import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// A `USER_TOKEN` a signed-in user mints for themselves — `ovld login` and the
// settings page — must keep working across every workspace that user belongs to.
// Consent narrowing exists for third-party OAuth clients, which pass it
// explicitly; there is nobody to narrow for when the user is consenting to
// their own CLI, and requiring a selection broke login for anyone with more
// than one workspace.

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-token-issuance-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'issuance.sqlite');

const dbModule = await import('./db.ts');
const { db, initDatabase } = dbModule;
await initDatabase();

const { resolveAuthorizedWorkspaces } = await import('./auth.ts');
const { DEFAULT_TEST_ORGANIZATION_ID, seedAuthenticatedOperator } =
  await import('./test-helpers.ts');
const { createWorkspace } = await import('./workspaces.ts');
const { createUserToken, listUserTokens } = await import('./repository.ts');
const { verifyUserToken } = await import('../auth/src/index.ts');
const { authDomainDatabase } = await import('./db.ts');

const operatorWorkspaceUserId = seedAuthenticatedOperator({ db });
dbModule.setActiveWorkspaceUser(operatorWorkspaceUserId);
await dbModule.setActiveWorkspace('local-workspace');

// A second workspace in the same organization, with the operator an active
// member of both — the shape that produced "Token creation requires explicit
// organization/workspace consent when more than one workspace is authorized".
const secondary = await createWorkspace({
  organizationId: DEFAULT_TEST_ORGANIZATION_ID,
  name: 'Second Token Issuance Workspace'
});
const authorized = await resolveAuthorizedWorkspaces('operator-user', null);
assert.equal(authorized.workspaces.length, 2, 'the operator must be a member of both workspaces');

/** Run `fn` as a browser/CLI session request: an authorization set, no ambient workspace. */
async function asSession<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
  const snapshot = await resolveAuthorizedWorkspaces(profileId, null);
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId(profileId);
    dbModule.setAuthorizedWorkspacesContext(snapshot);
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

test('a user with several workspaces can mint a token without selecting one', async () => {
  const { token, secret } = await asSession('operator-user', () =>
    createUserToken({ label: 'CLI login on test host' })
  );
  assert.equal(token.scope, 'full');

  const row = db
    .prepare(
      `SELECT t.profile_id, t.organization_id, t.all_workspaces,
              (SELECT COUNT(*) FROM user_token_workspaces WHERE token_id = t.id) AS allowlist
         FROM user_tokens t
        WHERE t.id = ?`
    )
    .get(token.id) as {
    profile_id: string;
    organization_id: string;
    all_workspaces: number;
    allowlist: number;
  };
  assert.deepEqual(row, {
    profile_id: 'operator-user',
    organization_id: DEFAULT_TEST_ORGANIZATION_ID,
    all_workspaces: 1,
    allowlist: 0
  });

  // The whole point: the minted credential authorizes both memberships.
  const verified = await verifyUserToken(authDomainDatabase(), secret);
  assert.ok(verified);
  const tokenScope = await resolveAuthorizedWorkspaces(verified.profileId, verified);
  assert.equal(tokenScope.organizationId, DEFAULT_TEST_ORGANIZATION_ID);
  assert.deepEqual(
    tokenScope.workspaces.map(workspace => workspace.workspaceId).sort(),
    ['local-workspace', secondary.id].sort()
  );
});

test('a token is owned by the authenticated profile, not the oldest account on the instance', async () => {
  // Session requests carry no ambient workspace member, so an owner lookup that
  // falls back to "the oldest human profile" would mint this token for someone
  // else entirely on a shared instance.
  const older = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`
  ).run('earlier-user', 'earlier-user', 'earlier-user@overlord.local', older, older);

  const { token } = await asSession('operator-user', () =>
    createUserToken({ label: 'owned by the caller' })
  );
  const owner = db.prepare(`SELECT profile_id FROM user_tokens WHERE id = ?`).get(token.id) as {
    profile_id: string;
  };
  assert.equal(owner.profile_id, 'operator-user');

  const listed = await asSession('operator-user', () => listUserTokens());
  assert.ok(listed.some(candidate => candidate.id === token.id));
});
