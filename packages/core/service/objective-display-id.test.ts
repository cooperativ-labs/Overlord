import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveObjectiveRef } from './context.js';
import { ServiceError } from './errors.js';
import { createMissionWithObjectives, insertObjective, listObjectives } from './missions.js';
import { allocateObjectiveDisplayKey, parseObjectiveRef } from './objective-display-id.js';
import { createProject } from './projects.js';
import { attachSession } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

const DISPLAY_ID_RE = /^[a-z0-9-]+:\d+\.[0-9a-hjkmnp-tv-z]{4}$/;
const KEY_RE = /^[0-9a-hjkmnp-tv-z]{4}$/;

describe('objective display ids', () => {
  it('allocates a unique Crockford key on insert and computes displayId', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Display Ids' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });

    assert.equal(objectives.length, 2);
    for (const objective of objectives) {
      assert.match(objective.displayKey, KEY_RE);
      assert.equal(objective.displayId, `${mission.displayId}.${objective.displayKey}`);
      assert.match(objective.displayId, DISPLAY_ID_RE);
    }
    assert.notEqual(objectives[0]!.displayKey, objectives[1]!.displayKey);

    const listed = await listObjectives({ ctx, missionId: mission.id });
    assert.deepEqual(
      listed.map(row => row.displayId),
      objectives.map(row => row.displayId)
    );

    await db.close();
  });

  it('retries a colliding key and lengthens to 5 after eight collisions', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Display Key Collision' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Existing' }]
    });
    const existingKey = objectives[0]!.displayKey;
    let fourCharAttempts = 0;

    const next = await allocateObjectiveDisplayKey({
      db: ctx.db,
      missionId: mission.id,
      generate: ({ length }) => {
        if (length === 4) {
          fourCharAttempts += 1;
          return existingKey;
        }
        return 'abcde';
      }
    });

    assert.equal(fourCharAttempts, 8);
    assert.equal(next, 'abcde');

    await db.close();
  });

  it('resolves a UUID and a full display id, and rejects a mission id or wrong separator', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Resolve Objective Ref' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Resolve me' }]
    });
    const objective = objectives[0]!;

    const byUuid = await resolveObjectiveRef({ ctx, ref: objective.id });
    assert.equal(byUuid.id, objective.id);
    assert.equal(byUuid.displayId, objective.displayId);

    const byDisplay = await resolveObjectiveRef({ ctx, ref: objective.displayId });
    assert.equal(byDisplay.id, objective.id);
    assert.equal(byDisplay.displayKey, objective.displayKey);

    const byKey = await resolveObjectiveRef({
      ctx,
      ref: objective.displayKey,
      missionId: mission.id
    });
    assert.equal(byKey.id, objective.id);

    await assert.rejects(
      () => resolveObjectiveRef({ ctx, ref: mission.displayId }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'invalid_objective_ref' &&
        error.message.includes('is a mission id')
    );

    await assert.rejects(
      () => resolveObjectiveRef({ ctx, ref: `${mission.displayId}:${objective.displayKey}` }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'invalid_objective_ref' &&
        parseObjectiveRef(`${mission.displayId}:${objective.displayKey}`).kind === 'wrong_separator'
    );
    await assert.rejects(
      () => resolveObjectiveRef({ ctx, ref: `${mission.displayId}|${objective.displayKey}` }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'invalid_objective_ref'
    );
    await assert.rejects(
      () => resolveObjectiveRef({ ctx, ref: `${mission.displayId}-${objective.displayKey}` }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.status === 400 &&
        error.code === 'invalid_objective_ref'
    );

    await db.close();
  });

  it('shows the computed display id on attach and instructs pinning with --objective-id', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach Display Id' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Attach with display id' }]
    });
    const attached = await attachSession({
      ctx,
      missionId: mission.id,
      agentIdentifier: 'cursor'
    });

    assert.equal(attached.objective.displayId, objectives[0]!.displayId);
    assert.ok(attached.agentInstructions.includes(`Objective ID: ${objectives[0]!.displayId}`));
    assert.match(attached.agentInstructions, /--objective-id/);
    assert.doesNotMatch(attached.agentInstructions, /informational only/);

    await db.close();
  });

  it('inserts a follow-up objective with its own key', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Follow-up Key' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }]
    });
    const followUp = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: 'Second'
    });
    assert.match(followUp.displayKey, KEY_RE);
    assert.notEqual(followUp.displayKey, objectives[0]!.displayKey);
    assert.equal(followUp.displayId, `${mission.displayId}.${followUp.displayKey}`);

    await db.close();
  });
});
