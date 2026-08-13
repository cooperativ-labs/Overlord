import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives, insertObjective } from './missions.js';
import { createProject } from './projects.js';
import { attachSession, protocolCreate, protocolPrompt } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { newId, nowIso } from './util.js';

describe('protocol objective creation', () => {
  it('creates ordered objectives from an array payload', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Protocol Objectives' });

    const result = await protocolCreate({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First protocol objective' },
        { objective: 'Second protocol objective' }
      ]
    });

    assert.equal(result.objectives.length, 2);
    assert.deepEqual(
      result.objectives.map(objective => objective.state),
      ['draft', 'future']
    );

    await db.close();
  });

  it('allows blank inline-authored draft and future objective slots', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Blank Objective Slots' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Existing draft objective' }]
    });

    await ctx.db.run(`UPDATE objectives SET state = 'complete' WHERE mission_id = ?`, [mission.id]);
    const draft = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: '',
      state: 'draft'
    });

    assert.equal(draft.state, 'draft');
    assert.equal(draft.objective, '');
    assert.equal(draft.title, 'New objective');

    const future = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: '',
      state: 'draft'
    });

    assert.equal(future.state, 'future');
    assert.equal(future.objective, '');
    assert.equal(future.title, 'New objective');

    await db.close();
  });

  it('rejects blank submitted objectives', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Submitted Objective Validation' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Existing draft objective' }]
    });

    await assert.rejects(
      async () =>
        await insertObjective({
          ctx,
          missionId: mission.id,
          instructionText: '',
          state: 'submitted'
        })
    );

    await db.close();
  });

  it('prompts with multiple objectives and attaches to the first one', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Protocol Prompt Objectives' });

    const result = await protocolPrompt({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First prompt objective' },
        { objective: 'Second prompt objective' }
      ],
      agentIdentifier: 'codex'
    });

    assert.equal(result.objective.objective, 'First prompt objective');
    assert.equal(result.objective.state, 'executing');
    // The current objective is excluded from both arrays.
    assert.equal(result.previousObjectives.length, 0);
    assert.equal(result.futureObjectives.length, 1);
    assert.equal(result.futureObjectives[0]?.state, 'draft');
    assert.ok(!result.previousObjectives.some(o => o.id === result.objective.id));
    assert.ok(!result.futureObjectives.some(o => o.id === result.objective.id));

    await db.close();
  });

  it('persists no blank draft slot when attach consumes the only next-up objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach Refill' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Only objective' }]
    });

    await ctx.db.run(`UPDATE objectives SET assigned_agent = 'claude' WHERE id = ?`, [
      objectives[0]?.id
    ]);

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.equal(attached.objective.state, 'executing');
    assert.equal(attached.previousObjectives.length, 0);
    assert.equal(attached.futureObjectives.length, 0);

    // The empty next-up field is the mission panel's client-only composer, so
    // execution leaves no draft row behind for agents or counts to misread.
    const draftRow = (await ctx.db.get(
      `SELECT id FROM objectives
         WHERE mission_id = ? AND state = 'draft' AND deleted_at IS NULL`,
      [mission.id]
    )) as { id: string } | undefined;
    assert.equal(draftRow, undefined);

    await db.close();
  });

  it('promotes the earliest future objective when attach consumes the next-up objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach Future Refill' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Run current objective' },
        { objective: 'Use existing future objective' }
      ]
    });

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.equal(attached.objective.state, 'executing');
    assert.equal(attached.previousObjectives.length, 0);
    assert.deepEqual(
      attached.futureObjectives.map(objective => objective.state),
      ['draft']
    );
    assert.equal(attached.futureObjectives[0]?.id, objectives[1]?.id);
    assert.equal(attached.futureObjectives[0]?.objective, 'Use existing future objective');

    await db.close();
  });

  it('promotes a future objective over a blank draft placeholder when attach begins execution', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach Future Before Placeholder' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Run current objective' },
        { objective: 'Use queued future objective' }
      ]
    });

    await ctx.db.run(`UPDATE objectives SET state = 'launching' WHERE id = ?`, [objectives[0]?.id]);
    const placeholder = await insertObjective({
      ctx,
      missionId: mission.id,
      instructionText: '',
      state: 'draft'
    });

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.equal(attached.objective.state, 'executing');
    assert.equal(attached.previousObjectives.length, 0);
    assert.deepEqual(
      attached.futureObjectives.map(objective => objective.state),
      ['draft']
    );
    assert.equal(attached.futureObjectives[0]?.id, objectives[1]?.id);
    assert.equal(attached.futureObjectives[0]?.objective, 'Use queued future objective');

    const placeholderRow = (await ctx.db.get(`SELECT deleted_at FROM objectives WHERE id = ?`, [
      placeholder.id
    ])) as { deleted_at: string | null };
    assert.ok(placeholderRow.deleted_at);

    await db.close();
  });

  it('excludes blank objective slots from the objective list handed to the agent', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Blank Slot Exclusion' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'Already finished work' },
        { objective: 'Work to do now' },
        { objective: 'Real queued follow-up' }
      ]
    });

    await ctx.db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objectives[0]?.id]);
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[1]?.id]);
    // A blank slot is an input placeholder, not planned work.
    await ctx.db.run(`UPDATE objectives SET instruction_text = '' WHERE id = ?`, [
      objectives[0]?.id
    ]);

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.equal(attached.objective.id, objectives[1]?.id);
    assert.deepEqual(attached.previousObjectives, []);
    assert.deepEqual(
      attached.futureObjectives.map(objective => objective.objective),
      ['Real queued follow-up']
    );

    await db.close();
  });

  it('splits completed prior work into previousObjectives, excluding the current objective', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach Previous Split' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Already finished work' }, { objective: 'Work to do now' }]
    });

    // The first objective is complete; the second is the one being executed.
    await ctx.db.run(`UPDATE objectives SET state = 'complete' WHERE id = ?`, [objectives[0]?.id]);
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[1]?.id]);

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.equal(attached.objective.id, objectives[1]?.id);
    assert.equal(attached.objective.state, 'executing');

    // Prior completed objective lands in previousObjectives.
    assert.deepEqual(
      attached.previousObjectives.map(objective => objective.id),
      [objectives[0]?.id]
    );
    // A fresh blank draft is created after the current objective, but blank
    // slots are not planned work and never reach the agent.
    assert.equal(attached.futureObjectives.length, 0);

    // The current objective never appears in either array.
    assert.ok(!attached.previousObjectives.some(o => o.id === attached.objective.id));
    assert.ok(!attached.futureObjectives.some(o => o.id === attached.objective.id));

    await db.close();
  });

  it('keeps history in structured fields instead of duplicating it in agent instructions', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach History Filter' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Filter my history' }]
    });

    const insertEvent = async (type: string, summary: string): Promise<void> => {
      await ctx.db.run(
        `INSERT INTO mission_events (
             id, workspace_id, project_id, mission_id, type, summary, source, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'cli', ?)`,
        [newId(), ctx.workspace.id, project.id, mission.id, type, summary, nowIso()]
      );
    };

    await insertEvent('status_change', 'Runner claimed execution request');
    await insertEvent('execution_requested', 'Queued execution for a runner');
    await insertEvent('update', 'Agent made meaningful progress');

    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      agentIdentifier: 'codex'
    });

    assert.deepEqual(
      attached.history.map(event => event.summary),
      [
        'Runner claimed execution request',
        'Queued execution for a runner',
        'Agent made meaningful progress'
      ]
    );
    assert.doesNotMatch(attached.agentInstructions, /Agent made meaningful progress/);
    assert.doesNotMatch(attached.agentInstructions, /Runner claimed execution request/);
    assert.doesNotMatch(attached.agentInstructions, /Queued execution for a runner/);

    await db.close();
  });

  it('persists autoAdvance from create payloads', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Protocol Auto Advance Create' });

    const result = await protocolCreate({
      ctx,
      projectId: project.id,
      objectives: [
        { objective: 'First protocol objective', autoAdvance: true },
        { objective: 'Second protocol objective', autoAdvance: false }
      ]
    });

    assert.equal(result.objectives[0]?.autoAdvance, true);
    assert.equal(result.objectives[1]?.autoAdvance, false);

    await db.close();
  });
});
