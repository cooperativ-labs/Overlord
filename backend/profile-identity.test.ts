import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * The caller's profile is the authenticated one. Only the loopback local
 * operator with no resolvable profile falls back to the oldest human profile;
 * an authenticated caller whose profile row is missing or deleted gets an
 * error, never another account.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-profile-identity-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'profile-identity.sqlite')
});
const dbModule = await import('./db.ts');
const { createUserToken, getProfile, listUserTokens, updateProfile } =
  await import('./repository.ts');

const now = new Date().toISOString();
db.prepare(
  `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
   VALUES ('departed-user', 'Departed', 'departed@overlord.local', 1, NULL, ?, ?)`
).run(now, now);
db.prepare(`UPDATE profiles SET deleted_at = ? WHERE id = 'departed-user'`).run(now);

function asAuthenticated<T>(profileId: string, fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId(profileId);
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: 'test-organization',
      workspaces: [
        {
          workspaceId: 'local-workspace',
          workspaceUserId: 'operator-workspace-user',
          roleKeys: ['ADMIN'],
          workspace: {
            id: 'local-workspace',
            slug: 'local-workspace',
            name: 'local',
            kind: 'local'
          }
        }
      ]
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

describe('caller profile resolution', () => {
  it('never substitutes another account for a missing or deleted profile', async () => {
    for (const profileId of ['departed-user', 'never-existed']) {
      await asAuthenticated(profileId, async () => {
        await assert.rejects(getProfile(), { status: 404 });
        await assert.rejects(updateProfile({ displayName: 'Taken over' }), { status: 404 });
        await assert.rejects(listUserTokens(), { status: 404 });
        await assert.rejects(createUserToken({ label: 'stolen' }), { status: 404 });
      });
    }
    const operator = db
      .prepare(`SELECT display_name FROM profiles WHERE id = 'operator-user'`)
      .get() as { display_name: string };
    assert.notEqual(operator.display_name, 'Taken over');
  });

  it('keeps the loopback operator resolution', async () => {
    await dbModule.withRequestContextAsync(async () => {
      dbModule.setActiveWorkspaceUser(null);
      assert.equal((await getProfile()).userId, 'operator-user');
    });
  });
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
