import { MISSION_LIFECYCLE_GRANTS, PROJECT_AUTOMATION_GRANTS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

/**
 * Recording a runner-prepared branch resolves the mission like every other
 * mission route (organization-bounded, consented workspaces, 409 on an
 * ambiguous display id) and requires `execution_request:claim` there.
 */

const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'Branch Prepared Auth' });
const dbModule = await import('./db.ts');
const { createMission, createProject } = await import('./repository.ts');
const { recordBranchPrepared } = await import('./execution/runner.ts');
const client = dbModule.requireDatabaseClient();

const PROFILE_ID = 'operator-user';

type SnapshotEntry = {
  workspaceId: string;
  workspaceUserId: string;
  roleKeys: string[];
  workspace: { id: string; slug: string; name: string; kind: string };
};

let workspaceA: SnapshotEntry;
let workspaceB: SnapshotEntry;

async function snapshotEntry(workspaceId: string): Promise<SnapshotEntry> {
  const row = await client.get<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    wu: string;
  }>(
    `SELECT w.id, w.slug, w.name, w.kind, wu.id AS wu
       FROM workspaces w JOIN workspace_users wu ON wu.workspace_id = w.id
      WHERE w.id = ? AND wu.profile_id = ?`,
    [workspaceId, PROFILE_ID]
  );
  assert.ok(row);
  return {
    workspaceId,
    workspaceUserId: row.wu,
    roleKeys: ['ADMIN'],
    workspace: { id: row.id, slug: row.slug, name: row.name, kind: row.kind }
  };
}

function asToken<T>(snapshot: SnapshotEntry[], scopes: string[] | null, fn: () => Promise<T>) {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId(PROFILE_ID);
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: 'test-organization',
      workspaces: snapshot
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveTokenAuth({
      workspaceUserId: null,
      tokenId: 'runner-token',
      scopeGrants: scopes
    });
    return fn();
  });
}

const payload = {
  branchName: 'overlord/branch-prepared-auth',
  baseBranch: 'main',
  worktreePath: '/tmp/.ovld/worktrees/branch-prepared-auth',
  resourceKey: 'primary-repo',
  action: 'create',
  cycle: 1
};

before(async () => {
  workspaceA = await snapshotEntry(fixture.workspaceAId);
  workspaceB = await snapshotEntry(fixture.secondary.id);
});

describe('branch-prepared authorization', () => {
  it('treats a mission outside the token consent as not found', async () => {
    await asToken([workspaceA], null, async () => {
      await assert.rejects(recordBranchPrepared({ missionId: fixture.mission.id, payload }), {
        status: 404
      });
      await assert.rejects(
        recordBranchPrepared({ missionId: fixture.mission.displayId, payload }),
        { status: 404 }
      );
    });
  });

  it('requires execution_request:claim within the token scope', async () => {
    await asToken([workspaceA, workspaceB], [...PROJECT_AUTOMATION_GRANTS], async () => {
      await assert.rejects(recordBranchPrepared({ missionId: fixture.mission.id, payload }), {
        status: 403
      });
    });
    await asToken([workspaceA, workspaceB], [...MISSION_LIFECYCLE_GRANTS], async () => {
      assert.deepEqual(await recordBranchPrepared({ missionId: fixture.mission.id, payload }), {
        ok: true
      });
    });
  });

  it('answers 409 for a display id that matches missions in two workspaces', async () => {
    const projectA = await createProject({
      name: 'Branch Prepared Auth A',
      workspaceId: workspaceA.workspaceId
    });
    const missionA = await createMission({ projectId: projectA.id, firstObjective: 'Twin' });
    await client.run(`UPDATE missions SET display_id = ? WHERE id = ?`, [
      fixture.mission.displayId,
      missionA.id
    ]);
    await asToken([workspaceA, workspaceB], null, async () => {
      await assert.rejects(
        recordBranchPrepared({ missionId: fixture.mission.displayId, payload }),
        { status: 409 }
      );
    });
  });
});

after(async () => {
  await client.close();
});
