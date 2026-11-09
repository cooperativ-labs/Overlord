import { PERMISSIONS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'RBAC Helpers' });
const dbModule = await import('./db.ts');
const { requireObjectivePermission, requireWorkspacePermission } = await import('./rbac.ts');
const client = dbModule.requireDatabaseClient();

after(async () => {
  await client.close();
});

type SnapshotEntry = {
  workspaceId: string;
  workspaceUserId: string;
  roleKeys: string[];
  workspace: { id: string; slug: string; name: string; kind: string };
};

async function snapshotEntry(workspaceId: string, roleKeys: string[]): Promise<SnapshotEntry> {
  const row = await client.get<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    workspace_user_id: string;
  }>(
    `SELECT w.id, w.slug, w.name, w.kind, wu.id AS workspace_user_id
       FROM workspaces w
       JOIN workspace_users wu ON wu.workspace_id = w.id
      WHERE w.id = ? AND wu.profile_id = 'operator-user'
        AND w.deleted_at IS NULL AND wu.deleted_at IS NULL`,
    [workspaceId]
  );
  assert.ok(row);
  return {
    workspaceId,
    workspaceUserId: row.workspace_user_id,
    roleKeys,
    workspace: { id: row.id, slug: row.slug, name: row.name, kind: row.kind }
  };
}

/** Run `fn` as an authenticated request whose immutable snapshot is `workspaces`. */
async function withAuthorized<T>(workspaces: SnapshotEntry[], fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId('operator-user');
    dbModule.setAuthorizedWorkspacesContext({ organizationId: 'test-organization', workspaces });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

function rejectsWith(status: number, message: string) {
  return (error: unknown) => {
    assert.equal((error as { status?: number }).status, status);
    assert.equal((error as Error).message, message);
    return true;
  };
}

describe('requireWorkspacePermission', () => {
  it('accepts any-of permissions when one is granted', async () => {
    const entry = await snapshotEntry(fixture.secondary.id, ['MEMBER']);
    await withAuthorized([entry], async () => {
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId: fixture.secondary.id,
        permission: [PERMISSIONS.LAUNCH_CONFIGURE, PERMISSIONS.EXECUTION_REQUEST_CLAIM]
      });
      assert.equal(workspaceUserId, entry.workspaceUserId);
    });
  });

  it('denies any-of permissions with 403 when none is granted', async () => {
    const entry = await snapshotEntry(fixture.secondary.id, ['PUBLIC']);
    await withAuthorized([entry], async () => {
      await assert.rejects(
        () =>
          requireWorkspacePermission({
            workspaceId: fixture.secondary.id,
            permission: [PERMISSIONS.LAUNCH_CONFIGURE, PERMISSIONS.EXECUTION_REQUEST_CLAIM],
            deniedMessage: 'Not allowed.'
          }),
        rejectsWith(403, 'Not allowed.')
      );
    });
  });

  it('keeps the single-permission 403 message unchanged', async () => {
    const entry = await snapshotEntry(fixture.secondary.id, ['PUBLIC']);
    await withAuthorized([entry], async () => {
      await assert.rejects(
        () =>
          requireWorkspacePermission({
            workspaceId: fixture.secondary.id,
            permission: PERMISSIONS.OBJECTIVE_READ
          }),
        rejectsWith(403, `Permission denied: ${PERMISSIONS.OBJECTIVE_READ}`)
      );
    });
  });

  it('reads a workspace outside the snapshot as not found', async () => {
    const entry = await snapshotEntry(fixture.workspaceAId, ['ADMIN']);
    await withAuthorized([entry], async () => {
      await assert.rejects(
        () =>
          requireWorkspacePermission({
            workspaceId: fixture.secondary.id,
            permission: [PERMISSIONS.LAUNCH_CONFIGURE, PERMISSIONS.EXECUTION_REQUEST_CLAIM],
            notFoundMessage: 'Execution target not found'
          }),
        rejectsWith(404, 'Execution target not found')
      );
    });
  });
});

describe('requireObjectivePermission', () => {
  it("resolves the objective's own workspace and membership", async () => {
    const workspaceA = await snapshotEntry(fixture.workspaceAId, ['ADMIN']);
    const secondary = await snapshotEntry(fixture.secondary.id, ['MEMBER']);
    await withAuthorized([workspaceA, secondary], async () => {
      const result = await requireObjectivePermission({
        objectiveId: fixture.objectiveId,
        permission: PERMISSIONS.OBJECTIVE_READ
      });
      assert.deepEqual(result, {
        workspaceId: fixture.secondary.id,
        workspaceUserId: secondary.workspaceUserId,
        objectiveId: fixture.objectiveId
      });
    });
  });

  it('returns 403 for a member lacking the permission', async () => {
    const secondary = await snapshotEntry(fixture.secondary.id, ['PUBLIC']);
    await withAuthorized([secondary], async () => {
      await assert.rejects(
        () =>
          requireObjectivePermission({
            objectiveId: fixture.objectiveId,
            permission: PERMISSIONS.OBJECTIVE_READ
          }),
        rejectsWith(403, `Permission denied: ${PERMISSIONS.OBJECTIVE_READ}`)
      );
    });
  });

  it('returns 404 when the owning workspace is outside the snapshot', async () => {
    const workspaceA = await snapshotEntry(fixture.workspaceAId, ['ADMIN']);
    await withAuthorized([workspaceA], async () => {
      await assert.rejects(
        () =>
          requireObjectivePermission({
            objectiveId: fixture.objectiveId,
            permission: PERMISSIONS.OBJECTIVE_READ
          }),
        rejectsWith(404, 'Objective not found')
      );
    });
  });
});
