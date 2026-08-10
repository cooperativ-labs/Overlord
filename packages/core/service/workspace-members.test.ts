import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession, protocolCreate } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { nowIso } from './util.js';
import { resolveAgentMissionAssignee, resolveWorkspaceMemberId } from './workspace-members.js';

async function seedSecondMember({
  db,
  workspaceId,
  profileId,
  workspaceUserId,
  handle,
  email,
  memberKey
}: {
  db: Awaited<ReturnType<typeof createSeededServiceContext>>['db'];
  workspaceId: string;
  profileId: string;
  workspaceUserId: string;
  handle: string;
  email: string;
  memberKey: string;
}): Promise<void> {
  const now = nowIso();
  await db.run(
    `INSERT INTO "user" (
       "id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"
     ) VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    [profileId, handle, email, now, now]
  );
  await db.run(
    `INSERT INTO workspace_users (
       id, workspace_id, profile_id, member_key, status, metadata_json,
       created_at, updated_at, revision
     ) VALUES (?, ?, ?, ?, 'active', '{}', ?, ?, 1)`,
    [workspaceUserId, workspaceId, profileId, memberKey, now, now]
  );
}

describe('resolveWorkspaceMemberId', () => {
  it('resolves by workspace_users.id, profile UUID, username, and email', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const otherUserId = 'other-workspace-user';
    const otherProfileId = 'other-user';
    await seedSecondMember({
      db,
      workspaceId: ctx.workspace.id,
      profileId: otherProfileId,
      workspaceUserId: otherUserId,
      handle: 'jake',
      email: 'jake@example.com',
      memberKey: `${ctx.workspace.id}-org:jake`
    });

    assert.equal(await resolveWorkspaceMemberId({ ctx, member: otherUserId }), otherUserId);
    assert.equal(await resolveWorkspaceMemberId({ ctx, member: otherProfileId }), otherUserId);
    assert.equal(await resolveWorkspaceMemberId({ ctx, member: 'jake' }), otherUserId);
    assert.equal(await resolveWorkspaceMemberId({ ctx, member: 'Jake@Example.com' }), otherUserId);

    await db.close();
  });

  it('resolves orgid:username and member_key forms', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const otherUserId = 'keyed-workspace-user';
    const orgId = `${ctx.workspace.id}-org`;
    await seedSecondMember({
      db,
      workspaceId: ctx.workspace.id,
      profileId: 'keyed-user',
      workspaceUserId: otherUserId,
      handle: 'sam',
      email: 'sam@example.com',
      memberKey: `${orgId}:sam`
    });

    assert.equal(await resolveWorkspaceMemberId({ ctx, member: `${orgId}:sam` }), otherUserId);
    assert.equal(
      await resolveWorkspaceMemberId({ ctx, member: `${ctx.workspace.id}:sam` }),
      otherUserId
    );

    await db.close();
  });

  it('rejects an unknown member with the REST error message', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });

    await assert.rejects(
      () => resolveWorkspaceMemberId({ ctx, member: 'nobody-here' }),
      (err: unknown) =>
        err instanceof ServiceError &&
        err.status === 400 &&
        err.message === 'Assignee is not a member of this workspace'
    );

    await db.close();
  });
});

describe('resolveAgentMissionAssignee / protocolCreate assignment', () => {
  it('falls back to the token workspace user for an unattached create', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Assign Default' });

    const { mission } = await protocolCreate({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Land on my plate' }]
    });

    const row = (await db.get(`SELECT assigned_workspace_user_id FROM missions WHERE id = ?`, [
      mission.id
    ])) as { assigned_workspace_user_id: string | null };
    assert.equal(row.assigned_workspace_user_id, ctx.actorWorkspaceUserId);

    await db.close();
  });

  it('honors explicit --assigned-to by username', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const otherUserId = 'assignee-workspace-user';
    await seedSecondMember({
      db,
      workspaceId: ctx.workspace.id,
      profileId: 'assignee-user',
      workspaceUserId: otherUserId,
      handle: 'alex',
      email: 'alex@example.com',
      memberKey: 'auth:assignee-user'
    });
    const project = await createProject({ ctx, name: 'Assign Explicit' });

    const { mission } = await protocolCreate({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'For alex' }],
      assignedTo: 'alex'
    });

    const row = (await db.get(`SELECT assigned_workspace_user_id FROM missions WHERE id = ?`, [
      mission.id
    ])) as { assigned_workspace_user_id: string | null };
    assert.equal(row.assigned_workspace_user_id, otherUserId);

    await db.close();
  });

  it('400s when --assigned-to names an unknown member', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Assign Unknown' });

    await assert.rejects(
      () =>
        protocolCreate({
          ctx,
          projectId: project.id,
          objectives: [{ objective: 'Orphaned work' }],
          assignedTo: 'missing-person'
        }),
      (err: unknown) =>
        err instanceof ServiceError && err.message === 'Assignee is not a member of this workspace'
    );

    await db.close();
  });

  it('inherits the parent mission assignee when creating under a session', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const parentAssigneeId = 'parent-assignee';
    await seedSecondMember({
      db,
      workspaceId: ctx.workspace.id,
      profileId: 'parent-assignee-user',
      workspaceUserId: parentAssigneeId,
      handle: 'parent',
      email: 'parent@example.com',
      memberKey: 'auth:parent-assignee-user'
    });
    const project = await createProject({ ctx, name: 'Assign Inherit' });

    const parent = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Parent work' }],
      assignedWorkspaceUserId: parentAssigneeId
    });
    const attached = await attachSession({
      ctx,
      missionId: parent.mission.id,
      agentIdentifier: 'claude-code'
    });

    const childCtx = {
      ...ctx,
      origin: {
        kind: 'agent' as const,
        agent: 'claude-code',
        sessionId: attached.session.id
      }
    };
    const { mission } = await protocolCreate({
      ctx: childCtx,
      projectId: project.id,
      objectives: [{ objective: 'Follow-up for the same person' }]
    });

    const row = (await db.get(`SELECT assigned_workspace_user_id FROM missions WHERE id = ?`, [
      mission.id
    ])) as { assigned_workspace_user_id: string | null };
    assert.equal(row.assigned_workspace_user_id, parentAssigneeId);

    await db.close();
  });

  it('inherits the parent creator when the parent mission is unassigned', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const creatorId = 'creator-workspace-user';
    await seedSecondMember({
      db,
      workspaceId: ctx.workspace.id,
      profileId: 'creator-user',
      workspaceUserId: creatorId,
      handle: 'creator',
      email: 'creator@example.com',
      memberKey: 'auth:creator-user'
    });
    const project = await createProject({ ctx, name: 'Assign Creator Fallback' });
    const parent = await createMissionWithObjectives({
      ctx: { ...ctx, actorWorkspaceUserId: creatorId },
      projectId: project.id,
      objectives: [{ objective: 'Unassigned parent' }],
      assignedWorkspaceUserId: null
    });
    const attached = await attachSession({
      ctx,
      missionId: parent.mission.id,
      agentIdentifier: 'claude-code'
    });

    const assignee = await resolveAgentMissionAssignee({
      ctx: {
        ...ctx,
        origin: { kind: 'agent', agent: 'claude-code', sessionId: attached.session.id }
      }
    });
    assert.equal(assignee, creatorId);

    await db.close();
  });
});
