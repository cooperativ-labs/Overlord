import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'Authorization Boundary' });
const dbModule = await import('./db.ts');
const { getMissionDetail } = await import('./repository.ts');
const { resolveObjectiveIdForRest } = await import('./objective-ref.ts');
const client = dbModule.requireDatabaseClient();

type WorkspaceSnapshotEntry = {
  workspaceId: string;
  workspaceUserId: string;
  roleKeys: string[];
  workspace: { id: string; slug: string; name: string; kind: string };
};

let workspaceA: WorkspaceSnapshotEntry;
let workspaceB: WorkspaceSnapshotEntry;
let objectiveDisplayId: string;

async function snapshotEntry(workspaceId: string): Promise<WorkspaceSnapshotEntry> {
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
  const roles = await client.all<{ role_key: string }>(
    `SELECT role_key FROM role_assignments
      WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [workspaceId, row.workspace_user_id]
  );
  return {
    workspaceId,
    workspaceUserId: row.workspace_user_id,
    roleKeys: roles.map(role => role.role_key),
    workspace: { id: row.id, slug: row.slug, name: row.name, kind: row.kind }
  };
}

async function withAuthorized<T>(
  workspaces: WorkspaceSnapshotEntry[],
  fn: () => Promise<T>
): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId('operator-user');
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: 'test-organization',
      workspaces
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

before(async () => {
  workspaceA = await snapshotEntry(fixture.workspaceAId);
  workspaceB = await snapshotEntry(fixture.secondary.id);
  const objective = await client.get<{ display_key: string }>(
    `SELECT display_key FROM objectives WHERE id = ?`,
    [fixture.objectiveId]
  );
  assert.ok(objective);
  objectiveDisplayId = `${fixture.mission.displayId}.${objective.display_key}`;
});

describe('organization-bounded resource addressing', () => {
  it('resolves mission and objective display ids in a secondary authorized workspace', async () => {
    await withAuthorized([workspaceA, workspaceB], async () => {
      const mission = await getMissionDetail(fixture.mission.displayId);
      assert.equal(mission.id, fixture.mission.id);
      assert.equal(mission.workspaceId, fixture.secondary.id);

      const objective = await resolveObjectiveIdForRest({
        ref: objectiveDisplayId,
        db: client
      });
      assert.equal(objective.id, fixture.objectiveId);
      assert.equal(objective.workspaceId, fixture.secondary.id);
    });
  });

  it('returns not found instead of leaking labels when consent excludes the owning workspace', async () => {
    await withAuthorized([workspaceA], async () => {
      await assert.rejects(
        () => getMissionDetail(fixture.mission.displayId),
        (error: unknown) => {
          assert.equal((error as { status?: number }).status, 404);
          assert.equal((error as Error).message, 'Mission not found');
          assert.ok(!(error as Error).message.includes(fixture.secondary.name));
          return true;
        }
      );
      await assert.rejects(
        () => resolveObjectiveIdForRest({ ref: objectiveDisplayId, db: client }),
        (error: unknown) => {
          assert.equal((error as { status?: number }).status, 404);
          assert.equal((error as Error).message, 'Objective not found');
          return true;
        }
      );
    });
  });
});

after(async () => {
  await client.close();
});
