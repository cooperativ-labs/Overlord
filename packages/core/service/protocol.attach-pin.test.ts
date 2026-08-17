import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { createExecutionRequest } from './execution-requests.js';
import { createMissionWithObjectives, insertObjective } from './missions.js';
import { createProject } from './projects.js';
import { attachSession } from './protocol.js';
import { createIsolatedCheckout } from './test-checkout.js';
import { createSeededServiceContext } from './test-helpers.js';

describe('protocol attach pinning', () => {
  it('pins to --objective-id even when rediscovery would pick the draft', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pin Objective Id' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First draft' }, { objective: 'Second future' }]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;
    assert.equal(first.state, 'draft');
    assert.equal(second.state, 'future');

    const rediscovered = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor'
    });
    assert.equal(rediscovered.objective.id, first.id);

    await db.close();
  });

  it('attach with --objective-id of the later objective never selects the draft', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pin Later Objective' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Keep me draft' }, { objective: 'Pin me' }]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: second.displayId
    });

    assert.equal(attached.objective.id, second.id);
    assert.notEqual(attached.objective.id, first.id);
    assert.match(attached.agentInstructions, /--objective-id/);
    assert.ok(attached.agentInstructions.includes(second.displayId));
    assert.doesNotMatch(attached.agentInstructions, /informational only/);

    await db.close();
  });

  it('pins via execution request when --objective-id is omitted', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pin Execution Request' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Draft stays' }]
    });
    const first = objectives[0]!;
    const second = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: 'Queued second'
    });
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [second.id]);

    const request = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: second.id,
      requestedAgent: 'cursor',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-attach-pin-')
    });

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      executionRequestId: request.id
    });

    assert.equal(attached.objective.id, second.id);
    assert.notEqual(attached.objective.id, first.id);

    await db.close();
  });

  it('rejects mismatched --objective-id and execution request', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pin Mismatch' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }]
    });
    const first = objectives[0]!;
    const second = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: 'Second'
    });
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [second.id]);

    const request = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: second.id,
      requestedAgent: 'cursor',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-attach-mismatch-')
    });

    await assert.rejects(
      () =>
        attachSession({
          ctx,
          missionId: mission.displayId,
          agentIdentifier: 'cursor',
          objectiveId: first.id,
          executionRequestId: request.id
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 409 &&
        error.code === 'execution_request_mismatch'
    );

    await db.close();
  });

  it('rejects a pinned attach that reuses another objective’s session key', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pin Session Mismatch' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Objective A' }, { objective: 'Objective B' }]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;

    const sessionA = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: first.displayId
    });

    await assert.rejects(
      () =>
        attachSession({
          ctx,
          missionId: mission.displayId,
          agentIdentifier: 'cursor',
          objectiveId: second.displayId,
          existingSessionKey: sessionA.sessionKey
        }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 409 &&
        error.code === 'session_objective_mismatch'
    );

    await db.close();
  });

  it('unpinned re-attach keeps the existing session’s objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Unpin Reattach' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Stay on me' }, { objective: 'Later draft' }]
    });
    const first = objectives[0]!;
    const second = objectives[1]!;

    const sessionA = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      objectiveId: first.displayId
    });

    const reattached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'cursor',
      existingSessionKey: sessionA.sessionKey
    });

    assert.equal(reattached.objective.id, first.id);
    assert.notEqual(reattached.objective.id, second.id);
    assert.equal(reattached.sessionKey, sessionA.sessionKey);

    await db.close();
  });
});
