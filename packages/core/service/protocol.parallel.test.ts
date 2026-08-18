import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { claimNextExecutionRequest, createExecutionRequest } from './execution-requests.js';
import { createMissionWithObjectives, listObjectives } from './missions.js';
import { addProjectResource, createProject } from './projects.js';
import { attachSession, deliverSession } from './protocol.js';
import { createIsolatedCheckout } from './test-checkout.js';
import { createSeededServiceContext } from './test-helpers.js';

describe('opt-in cross-resource objective parallelism', () => {
  it('claims and attaches two different-resource objectives, then keeps the mission in execute after delivering one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Parallel Attach Deliver' });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-parallel-primary-'),
      isPrimary: true
    });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-parallel-docs-'),
      resourceKey: 'docs',
      isPrimary: false
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Work the primary checkout' },
        { objective: 'Work the docs checkout', resourceKey: 'docs' }
      ]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;

    await ctx.db.run(`UPDATE missions SET allow_parallel_objectives = 1 WHERE id = ?`, [
      mission.id
    ]);
    await ctx.db.run(`UPDATE objectives SET state = 'launching' WHERE id IN (?, ?)`, [
      first.id,
      second.id
    ]);

    const requestA = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: first.id,
      requestedAgent: 'cursor',
      requestedSource: 'test'
    });
    const requestB = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: second.id,
      requestedAgent: 'cursor',
      requestedSource: 'test'
    });
    assert.equal(requestA.status, 'queued');
    assert.equal(requestB.status, 'queued');

    const claimedA = await claimNextExecutionRequest({ ctx });
    const claimedB = await claimNextExecutionRequest({ ctx });
    assert.ok(claimedA);
    assert.ok(claimedB);
    assert.notEqual(claimedA.id, claimedB.id);
    const claimedIds = new Set([claimedA.objectiveId, claimedB.objectiveId]);
    assert.ok(claimedIds.has(first.id));
    assert.ok(claimedIds.has(second.id));

    const sessionA = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: first.displayId,
      executionRequestId: requestA.id
    });
    const sessionB = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: second.displayId,
      executionRequestId: requestB.id
    });
    assert.equal(sessionA.objective.id, first.id);
    assert.equal(sessionB.objective.id, second.id);
    assert.notEqual(sessionA.sessionKey, sessionB.sessionKey);

    await assert.rejects(
      () =>
        attachSession({
          ctx,
          missionId: mission.displayId,
          agentIdentifier: 'cursor'
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 409 &&
        error.code === 'ambiguous_active_objective'
    );

    const reattachedA = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      existingSessionKey: sessionA.sessionKey
    });
    assert.equal(reattachedA.objective.id, first.id);
    assert.equal(reattachedA.sessionKey, sessionA.sessionKey);

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: sessionA.sessionKey,
      summary: 'Delivered the primary checkout objective.'
    });

    const after = await listObjectives({ ctx, missionId: mission.id });
    assert.equal(after.find(objective => objective.id === first.id)?.state, 'complete');
    assert.equal(after.find(objective => objective.id === second.id)?.state, 'executing');

    const missionRow = (await ctx.db.get(`SELECT status_type FROM missions WHERE id = ?`, [
      mission.id
    ])) as { status_type: string };
    assert.equal(missionRow.status_type, 'execute');

    const sessionBRow = (await ctx.db.get(
      `SELECT delivery_state, ended_at, objective_id FROM agent_sessions WHERE id = ?`,
      [sessionB.session.id]
    )) as { delivery_state: string; ended_at: string | null; objective_id: string };
    assert.equal(sessionBRow.objective_id, second.id);
    assert.notEqual(sessionBRow.delivery_state, 'delivered');
    assert.equal(sessionBRow.ended_at, null);

    await db.close();
  });

  it('claims and attaches two same-resource objectives when parallel is opted in', async () => {
    // Phase E: two objectives on one checkout are legal. The Runner Layer gives
    // each its own branch/worktree when the mission uses worktrees; the control
    // plane only has to keep their sessions and objective states apart.
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Parallel Same Resource Attach' });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: createIsolatedCheckout('ovld-parallel-same-'),
      isPrimary: true
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First on primary' }, { objective: 'Second on primary' }]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;

    await ctx.db.run(`UPDATE missions SET allow_parallel_objectives = 1 WHERE id = ?`, [
      mission.id
    ]);
    await ctx.db.run(`UPDATE objectives SET state = 'launching' WHERE id IN (?, ?)`, [
      first.id,
      second.id
    ]);

    const requestA = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: first.id,
      requestedAgent: 'cursor',
      requestedSource: 'test'
    });
    const requestB = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: second.id,
      requestedAgent: 'cursor',
      requestedSource: 'test'
    });
    assert.equal(requestA.status, 'queued');
    assert.equal(requestB.status, 'queued');

    const claimedA = await claimNextExecutionRequest({ ctx });
    const claimedB = await claimNextExecutionRequest({ ctx });
    assert.ok(claimedA);
    assert.ok(claimedB);
    assert.notEqual(claimedA.id, claimedB.id);

    const sessionA = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: first.displayId,
      executionRequestId: requestA.id
    });
    const sessionB = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: second.displayId,
      executionRequestId: requestB.id
    });
    assert.equal(sessionA.objective.id, first.id);
    assert.equal(sessionB.objective.id, second.id);
    assert.notEqual(sessionA.sessionKey, sessionB.sessionKey);

    // Two live objectives on one resource are still ambiguous for an unpinned attach.
    await assert.rejects(
      () =>
        attachSession({
          ctx,
          missionId: mission.displayId,
          agentIdentifier: 'cursor'
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 409 &&
        error.code === 'ambiguous_active_objective'
    );

    await db.close();
  });
});
