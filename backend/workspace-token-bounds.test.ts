import { MISSION_LIFECYCLE_GRANTS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { setupSecondaryWorkspaceFixture } from './secondary-workspace-fixture.ts';

/**
 * Workspace and organization management operations apply a token request's
 * authorization snapshot (organization binding and workspace consent) and its
 * scope, as every other route does, while sessions keep their behaviour.
 */

const fixture = await setupSecondaryWorkspaceFixture({ namePrefix: 'Token Bounds' });
const dbModule = await import('./db.ts');
const workspaces = await import('./workspaces.ts');
const organizations = await import('./organizations.ts');
const { seedAuthenticatedOperatorClient } = await import('./test-helpers.ts');
const client = dbModule.requireDatabaseClient();

const PROFILE_ID = 'operator-user';
const ORGANIZATION_ID = 'test-organization';
const OTHER_ORGANIZATION_ID = 'token-bounds-other-org';
const OTHER_WORKSPACE_ID = 'token-bounds-other-ws';

type SnapshotEntry = {
  workspaceId: string;
  workspaceUserId: string;
  roleKeys: string[];
  workspace: { id: string; slug: string; name: string; kind: string };
};

let workspaceA: SnapshotEntry;
let workspaceB: SnapshotEntry;
let otherWorkspace: SnapshotEntry;

async function snapshotEntry(workspaceId: string): Promise<SnapshotEntry> {
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
      WHERE w.id = ? AND wu.profile_id = ? AND wu.deleted_at IS NULL`,
    [workspaceId, PROFILE_ID]
  );
  assert.ok(row);
  return {
    workspaceId,
    workspaceUserId: row.workspace_user_id,
    roleKeys: ['ADMIN'],
    workspace: { id: row.id, slug: row.slug, name: row.name, kind: row.kind }
  };
}

function asToken<T>(
  {
    organizationId = ORGANIZATION_ID,
    snapshot,
    scopes = null
  }: { organizationId?: string; snapshot: SnapshotEntry[]; scopes?: string[] | null },
  fn: () => Promise<T>
): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId(PROFILE_ID);
    dbModule.setAuthorizedWorkspacesContext({ organizationId, workspaces: snapshot });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveTokenAuth({
      workspaceUserId: null,
      tokenId: 'token-bounds-token',
      scopeGrants: scopes
    });
    return fn();
  });
}

function asSession<T>(snapshot: SnapshotEntry[], fn: () => Promise<T>): Promise<T> {
  return dbModule.withRequestContextAsync(async () => {
    dbModule.setActiveProfileId(PROFILE_ID);
    dbModule.setAuthorizedWorkspacesContext({
      organizationId: ORGANIZATION_ID,
      workspaces: snapshot
    });
    dbModule.setActiveWorkspaceContext(null);
    dbModule.setActiveWorkspaceUser(null);
    return fn();
  });
}

async function rejectsWith(promise: Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { status?: number }).status, status, String(error));
    return true;
  });
}

before(async () => {
  await seedAuthenticatedOperatorClient({
    client,
    organizationId: OTHER_ORGANIZATION_ID,
    workspaceId: OTHER_WORKSPACE_ID,
    profileId: PROFILE_ID,
    workspaceUserId: 'token-bounds-other-member'
  });
  workspaceA = await snapshotEntry(fixture.workspaceAId);
  workspaceB = await snapshotEntry(fixture.secondary.id);
  otherWorkspace = await snapshotEntry(OTHER_WORKSPACE_ID);
});

describe('workspace management under a token', () => {
  it('treats a workspace outside the token consent as not found', async () => {
    await asToken({ snapshot: [workspaceA] }, async () => {
      assert.ok((await workspaces.listWorkspaceMembers(workspaceA.workspaceId)).length > 0);
      await rejectsWith(workspaces.listWorkspaceMembers(workspaceB.workspaceId), 404);
      await rejectsWith(workspaces.updateWorkspace(workspaceB.workspaceId, { name: 'x' }), 404);
      await rejectsWith(workspaces.deleteWorkspace(workspaceB.workspaceId), 404);
      await rejectsWith(
        workspaces.inviteWorkspaceMember(workspaceB.workspaceId, {
          email: 'consent@example.com',
          roleKey: 'MEMBER'
        }),
        404
      );
      await rejectsWith(workspaces.listWorkspaceInvitations(workspaceB.workspaceId), 404);
      await rejectsWith(workspaces.exportWorkspaceObjectivesCsv(workspaceB.workspaceId), 404);
      assert.deepEqual(
        (await workspaces.listWorkspaces()).map(workspace => workspace.id),
        [workspaceA.workspaceId]
      );
    });
  });

  it('applies the token scope to management actions', async () => {
    await asToken(
      { snapshot: [workspaceA, workspaceB], scopes: [...MISSION_LIFECYCLE_GRANTS] },
      async () => {
        assert.ok((await workspaces.listWorkspaceMembers(workspaceA.workspaceId)).length > 0);
        await rejectsWith(workspaces.updateWorkspace(workspaceA.workspaceId, { name: 'x' }), 403);
        await rejectsWith(workspaces.deleteWorkspace(workspaceB.workspaceId), 403);
        await rejectsWith(
          workspaces.inviteWorkspaceMember(workspaceA.workspaceId, {
            email: 'scope@example.com',
            roleKey: 'MEMBER'
          }),
          403
        );
        await rejectsWith(workspaces.listWorkspaceInvitations(workspaceA.workspaceId), 403);
        await rejectsWith(
          workspaces.updateWorkspaceMemberRole(workspaceA.workspaceId, workspaceA.workspaceUserId, {
            roleKey: 'MEMBER'
          }),
          403
        );
        await rejectsWith(
          workspaces.removeWorkspaceMember(workspaceA.workspaceId, workspaceA.workspaceUserId),
          403
        );
        await rejectsWith(
          workspaces.createWorkspace({ organizationId: ORGANIZATION_ID, name: 'Scoped' }),
          403
        );
      }
    );
  });

  it('bounds organizations and workspace creation to the token organization', async () => {
    await asToken(
      { organizationId: OTHER_ORGANIZATION_ID, snapshot: [otherWorkspace] },
      async () => {
        assert.deepEqual(
          (await organizations.listOrganizationsForUser(PROFILE_ID)).map(org => org.id),
          [OTHER_ORGANIZATION_ID]
        );
        assert.deepEqual(
          (await workspaces.listWorkspaces()).map(workspace => workspace.id),
          [OTHER_WORKSPACE_ID]
        );
        await rejectsWith(organizations.updateOrganization(ORGANIZATION_ID, { name: 'x' }), 404);
        await rejectsWith(organizations.listOrganizationAdmins(ORGANIZATION_ID), 404);
        await rejectsWith(
          workspaces.createWorkspace({ organizationId: ORGANIZATION_ID, name: 'Elsewhere' }),
          404
        );
      }
    );
  });

  it('requires consent to every workspace for organization administration', async () => {
    await asToken({ snapshot: [workspaceA] }, async () => {
      await rejectsWith(organizations.updateOrganization(ORGANIZATION_ID, { name: 'x' }), 403);
      await rejectsWith(organizations.listOrganizationAdmins(ORGANIZATION_ID), 403);
      await rejectsWith(
        organizations.addOrganizationAdmin(ORGANIZATION_ID, { userId: PROFILE_ID }),
        403
      );
    });
    await asToken({ snapshot: [workspaceA, workspaceB] }, async () => {
      assert.ok((await organizations.listOrganizationAdmins(ORGANIZATION_ID)).length > 0);
    });
  });

  it('refuses invitation acceptance by a scoped token', async () => {
    const invite = await asSession([workspaceA, workspaceB], () =>
      workspaces.inviteWorkspaceMember(workspaceA.workspaceId, {
        email: 'token-bounds-invitee@example.com',
        roleKey: 'MEMBER'
      })
    );
    assert.ok(invite.acceptUrl);
    const token = new URL(invite.acceptUrl).searchParams.get('token');
    assert.ok(token);
    await asToken(
      { snapshot: [workspaceA, workspaceB], scopes: [...MISSION_LIFECYCLE_GRANTS] },
      async () => {
        await assert.rejects(workspaces.acceptWorkspaceInvitation({ token }), {
          status: 403,
          message: 'This token cannot accept invitations'
        });
      }
    );
  });

  it('leaves session behaviour unchanged', async () => {
    await asSession([workspaceA, workspaceB], async () => {
      const ids = (await workspaces.listWorkspaces()).map(workspace => workspace.id);
      assert.ok(ids.includes(OTHER_WORKSPACE_ID));
      assert.ok(ids.includes(workspaceB.workspaceId));
      assert.equal((await organizations.listOrganizationsForUser(PROFILE_ID)).length, 2);
      assert.ok((await workspaces.listWorkspaceMembers(workspaceB.workspaceId)).length > 0);
    });
  });
});

after(async () => {
  await client.close();
});
