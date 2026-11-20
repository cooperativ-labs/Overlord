import assert from 'node:assert/strict';
import { test } from 'node:test';

import { protocolAttachResponseSchema } from '../../contract/src/generated/api.js';

import { ServiceError } from './errors.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  attachSession,
  deliverSession,
  loadMissionContext,
  resumeFollowUp,
  updateSession
} from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { newId } from './util.js';

test('compact attach preserves mission order, real state and full inspection reads', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  try {
    const project = await createProject({ ctx, name: 'Compact Context' });
    const text = 'Completed instruction. '.repeat(60).trim();
    const future = 'Still planned. '.repeat(60).trim();
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [
        { instructions: future },
        { instructions: 'Execute current task' },
        { instructions: text },
        { instructions: 'Blank soon' },
        { instructions: future }
      ]
    });
    await db.run("UPDATE objectives SET state = 'complete' WHERE id = ?", [objectives[2]!.id]);
    await db.run("UPDATE objectives SET instruction_text = '' WHERE id = ?", [objectives[3]!.id]);
    for (const connectionMethod of ['cli', 'mcp']) {
      const attached = await attachSession({
        ctx,
        missionId: mission.id,
        objectiveId: objectives[1]!.id,
        connectionMethod
      });
      assert.equal(protocolAttachResponseSchema.safeParse(attached).success, true);
      assert.equal(Object.keys(attached)[0], 'agentInstructions');
      for (const key of ['history', 'previousObjectives', 'futureObjectives']) {
        assert.equal(key in attached, false, key);
      }
      assert.deepEqual(
        attached.objectives.map(o => [o.displayId, o.state]),
        [
          [objectives[0]!.displayId, 'draft'],
          [objectives[2]!.displayId, 'complete'],
          [objectives[4]!.displayId, 'draft']
        ]
      );
      assert.deepEqual(Object.keys(attached.objectives[0]!), ['displayId', 'state', 'objective']);
      assert.equal(attached.objectives[0]!.objective, future);
      assert.equal(attached.objectives[2]!.objective, future);
      assert.ok(attached.objectives[1]!.objective.length <= 600);
      assert.ok(attached.objectives[1]!.objective.endsWith('… [truncated]'));
      assert.match(attached.agentInstructions, /`directives`/);
      assert.match(attached.agentInstructions, /`objectives`/);
      assert.match(attached.agentInstructions, /use `OVERLORD_TMPDIR` for task scratch files/);
      assert.match(
        attached.agentInstructions,
        /create and use `\.overlord\/tmp\/` at the checkout root/
      );
    }
    const full = await loadMissionContext({
      ctx,
      missionId: mission.id,
      objectiveId: objectives[2]!.id
    });
    assert.equal(full.objective.objective, text);
    assert.ok(Array.isArray(full.history));
    assert.equal(full.previousObjectives[0]!.objective, future);
  } finally {
    await db.close();
  }
});

test('fresh follow-up sessions receive the latest current-objective directions before the event limit', async () => {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  try {
    const project = await createProject({ ctx, name: 'Follow-up Directions' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ instructions: 'Current' }, { instructions: 'Sibling' }]
    });
    await db.run("UPDATE objectives SET state = 'complete' WHERE id = ?", [objectives[1]!.id]);
    const first = await attachSession({
      ctx,
      missionId: mission.id,
      objectiveId: objectives[0]!.id
    });
    await deliverSession({
      ctx,
      missionId: mission.id,
      sessionKey: first.sessionKey,
      summary: 'Delivered.'
    });
    const add = async (index: number, type: string, objectiveId: string | null) => {
      await db.run(
        `INSERT INTO mission_events
        (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'execute', ?, 'cli', ?)`,
        [
          newId(),
          ctx.workspace.id,
          project.id,
          mission.id,
          objectiveId,
          type,
          `Direction ${index}`,
          new Date(Date.UTC(2026, 10, 17, 12, 0, index)).toISOString()
        ]
      );
    };
    // More than the legacy 100-event window of execute updates, plus newer irrelevant rows.
    for (let i = 0; i < 110; i++) await add(i, 'update', objectives[0]!.id);
    const types = ['user_follow_up', 'decision', 'discussion_summary'];
    for (let i = 110; i < 122; i++) await add(i, types[i % 3]!, objectives[0]!.id);
    await add(122, 'user_follow_up', objectives[1]!.id);
    await add(123, 'decision', null);
    await add(124, 'update', objectives[0]!.id);
    for (const connectionMethod of ['cli', 'mcp']) {
      const resumed = await resumeFollowUp({
        ctx,
        missionId: mission.id,
        objectiveId: objectives[0]!.id,
        connectionMethod
      });
      assert.deepEqual(
        resumed.directives.map(d => d.summary),
        Array.from({ length: 10 }, (_, i) => `Direction ${121 - i}`)
      );
      assert.ok(
        resumed.directives.every(d => d.objectiveId === objectives[0]!.id && types.includes(d.type))
      );
      assert.equal('history' in resumed, false);
      assert.ok(resumed.missionSummary);
      assert.match(resumed.agentInstructions, /use `OVERLORD_TMPDIR` for task scratch files/);
      const attached = await attachSession({
        ctx,
        missionId: mission.id,
        existingSessionKey: resumed.sessionKey,
        connectionMethod
      });
      assert.equal('history' in attached, false);
      assert.deepEqual(attached.directives, resumed.directives);
      await deliverSession({
        ctx,
        missionId: mission.id,
        sessionKey: resumed.sessionKey,
        summary: 'Follow-up delivered.'
      });
      if (connectionMethod === 'mcp') {
        await assert.rejects(
          updateSession({
            ctx,
            missionId: mission.id,
            sessionKey: resumed.sessionKey,
            summary: 'Attempt to update after delivery.'
          }),
          (error: unknown) =>
            error instanceof ServiceError &&
            error.code === 'invalid_session' &&
            error.message.includes('ask them to start follow-up work from Overlord') &&
            !error.message.includes('ovld protocol')
        );
      }
    }
  } finally {
    await db.close();
  }
});

test('fixed five-objective attach fixture fits 12000 response / 6500 instruction character budgets', async t => {
  const { db, ctx } = await createSeededServiceContext({ source: 'protocol' });
  try {
    const project = await createProject({ ctx, name: 'Size Budget' });
    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: Array.from({ length: 5 }, (_, i) => ({
        instructions: `Task ${i}. ` + 'Details. '.repeat(i === 2 ? 10 : 150)
      }))
    });
    await db.run("UPDATE objectives SET state = 'complete' WHERE id IN (?, ?)", [
      objectives[0]!.id,
      objectives[4]!.id
    ]);
    for (const connectionMethod of ['cli', 'mcp']) {
      const attached = await attachSession({
        ctx,
        missionId: mission.id,
        objectiveId: objectives[2]!.id,
        connectionMethod
      });
      const responseSize = JSON.stringify(attached).length;
      const instructionSize = attached.agentInstructions.length;
      t.diagnostic(
        `${connectionMethod}: response ${responseSize}, instructions ${instructionSize} characters`
      );
      assert.ok(responseSize <= 12000, `response: ${responseSize}`);
      assert.ok(instructionSize <= 6500, `instructions: ${instructionSize}`);
    }
  } finally {
    await db.close();
  }
});
