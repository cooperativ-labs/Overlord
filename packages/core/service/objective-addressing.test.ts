import { missionDisplayIdFromObjectiveRef } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import { createMissionWithObjectives, discussObjective, listAttachments } from './missions.js';
import { createProject } from './projects.js';
import { connectSession, loadMissionContext } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * The reconnect surface: an agent that holds only `coo:756.k7xm` must be able to
 * address every mission-scoped entry point with it, and every entry point that
 * used to rediscover "the active objective" must be pinnable so a mission
 * running objectives in parallel is still addressable.
 */
describe('objective-addressed protocol entry points', () => {
  it('derives the mission display id from an objective display id', () => {
    assert.equal(missionDisplayIdFromObjectiveRef('coo:756.k7xm'), 'coo:756');
    assert.equal(missionDisplayIdFromObjectiveRef('my-team:12.n4w2'), 'my-team:12');
    // A UUID names no mission, and a bare mission id is not an objective ref.
    assert.equal(missionDisplayIdFromObjectiveRef('550e8400-e29b-41d4-a716-446655440000'), null);
    assert.equal(missionDisplayIdFromObjectiveRef('coo:756'), null);
    assert.equal(missionDisplayIdFromObjectiveRef('coo:756|k7xm'), null);
    assert.equal(missionDisplayIdFromObjectiveRef(undefined), null);
  });

  it('load-context pins to an objective display id instead of rediscovering', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pinned Context' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });
    const second = objectives[1]!;

    const context = await loadMissionContext({
      ctx,
      missionId: mission.displayId,
      objectiveId: second.displayId
    });

    assert.equal(context.objective.id, second.id);
    assert.equal(context.objective.displayId, second.displayId);
    // The pinned objective is the current one, so it is excluded from the
    // sibling arrays and the first objective lands in `previousObjectives`.
    assert.deepEqual(
      context.previousObjectives.map(row => row.id),
      [objectives[0]!.id]
    );
    assert.deepEqual(context.futureObjectives, []);

    await db.close();
  });

  it('load-context rejects an objective belonging to another mission', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Cross Mission' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Mine' }]
    });
    const other = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Theirs' }]
    });

    await assert.rejects(
      loadMissionContext({
        ctx,
        missionId: mission.displayId,
        objectiveId: other.objectives[0]!.displayId
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'invalid_objective_ref'
    );

    await db.close();
  });

  it('load-context without a pin is ambiguous once two objectives are executing', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Parallel Context' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });
    for (const objective of objectives) {
      await ctx.db.run(`UPDATE objectives SET state = 'executing' WHERE id = ?`, [objective.id]);
    }

    await assert.rejects(
      loadMissionContext({ ctx, missionId: mission.displayId }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === 'ambiguous_active_objective'
    );

    // ...and the pin is what makes it addressable again.
    const pinned = await loadMissionContext({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.displayId
    });
    assert.equal(pinned.objective.id, objectives[1]!.id);

    await db.close();
  });

  it('connect pins the session to the requested objective and reports its display id', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Pinned Connect' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });
    const second = objectives[1]!;

    const connected = await connectSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: second.displayId,
      agentIdentifier: 'test-agent'
    });

    assert.equal(connected.objectiveId, second.id);
    assert.equal(connected.objectiveDisplayId, second.displayId);
    const session = (await ctx.db.get(
      `SELECT objective_id FROM agent_sessions WHERE mission_id = ? ORDER BY started_at DESC LIMIT 1`,
      [mission.id]
    )) as { objective_id: string };
    assert.equal(session.objective_id, second.id);

    await db.close();
  });

  it('discuss-objective submits the named draft rather than the first one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Named Draft' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });
    // createMissionWithObjectives leaves later objectives in `future`; make both
    // drafts so "the draft" is genuinely ambiguous.
    for (const objective of objectives) {
      await ctx.db.run(`UPDATE objectives SET state = 'draft' WHERE id = ?`, [objective.id]);
    }
    const second = objectives[1]!;

    const submitted = await discussObjective({
      ctx,
      missionId: mission.displayId,
      objectiveId: second.displayId
    });
    assert.equal(submitted.id, second.id);

    const first = (await ctx.db.get(`SELECT state FROM objectives WHERE id = ?`, [
      objectives[0]!.id
    ])) as { state: string };
    assert.equal(first.state, 'draft');

    await db.close();
  });

  it('discuss-objective refuses an objective that is not a draft', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Non Draft' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });
    await ctx.db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objectives[1]!.id]);

    await assert.rejects(
      discussObjective({
        ctx,
        missionId: mission.displayId,
        objectiveId: objectives[1]!.displayId
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'validation_error'
    );

    await db.close();
  });

  it('attachment listing accepts an objective display id as its filter', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attachment Scope' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'First' }, { objective: 'Second' }]
    });

    // A display-id filter used to be compared against the UUID column, so it
    // silently returned nothing instead of the objective's own attachments.
    const scoped = await listAttachments({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.displayId
    });
    assert.deepEqual(scoped, []);

    await assert.rejects(
      listAttachments({
        ctx,
        missionId: mission.displayId,
        objectiveId: 'coo:999.zzzz'
      }),
      (error: unknown) => error instanceof ServiceError
    );

    await db.close();
  });
});
