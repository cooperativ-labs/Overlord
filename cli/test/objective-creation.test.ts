import {
  addObjectivesToMission,
  createMissionWithObjectives,
  updateObjective
} from '@overlord/core/service/missions';
import { createProject } from '@overlord/core/service/projects';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeededCliContext } from './support/seeded-context.ts';

test('mission creation creates one draft objective and future objectives for the rest', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Objective Creation Test' });

  const { objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [
      { objective: 'First objective' },
      { objective: 'Second objective' },
      { objective: 'Third objective' }
    ]
  });

  assert.deepEqual(
    objectives.map(objective => objective.state),
    ['draft', 'future', 'future']
  );

  await db.close();
});

test('adding objectives to a mission with a draft creates future objectives', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Test' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing draft' }]
  });

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ objective: 'Additional objective' }, { objective: 'Another objective' }]
  });

  assert.deepEqual(
    added.map(objective => objective.state),
    ['future', 'future']
  );

  await db.close();
});

test('adding objectives to a mission without a draft creates exactly one draft', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Refill Draft Test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing objective' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ objective: 'New next-up' }, { objective: 'Future follow-up' }]
  });

  assert.deepEqual(
    added.map(objective => objective.state),
    ['draft', 'future']
  );

  await db.close();
});

test('adding objectives persists autoAdvance when requested', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Auto Advance' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing draft' }]
  });

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [
      { objective: 'Auto-advance follow-up', autoAdvance: true },
      { objective: 'Manual follow-up' }
    ]
  });

  assert.equal(added[0]?.autoAdvance, true);
  assert.equal(added[1]?.autoAdvance, false);

  await db.close();
});

test('adding objectives persists an explicit agent and model', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Agent Model' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing draft' }]
  });

  const [added] = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ objective: 'Run with Codex', agent: 'codex', model: 'gpt-5.6-terra' }]
  });

  const stored = await db.get<{ assigned_agent: string | null; model: string | null }>(
    `SELECT assigned_agent, model FROM objectives WHERE id = ?`,
    [added!.id]
  );
  assert.equal(stored?.assigned_agent, 'codex');
  assert.equal(stored?.model, 'gpt-5.6-terra');

  await db.close();
});

test('adding an objective rejects a model without an agent', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Model Validation' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing draft' }]
  });

  await assert.rejects(
    addObjectivesToMission({
      ctx,
      missionId: mission.id,
      objectives: [{ objective: 'Invalid model selection', model: 'gpt-5.6-terra' }]
    }),
    /model requires an assigned agent/
  );

  await db.close();
});

test('updateObjective toggles autoAdvance on an existing objective', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Update Objective Auto Advance' });
  const { objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'Existing draft' }]
  });

  const updated = await updateObjective({
    ctx,
    objectiveId: objectives[0]!.id,
    autoAdvance: true
  });
  assert.equal(updated.autoAdvance, true);

  const disabled = await updateObjective({
    ctx,
    objectiveId: objectives[0]!.id,
    autoAdvance: false
  });
  assert.equal(disabled.autoAdvance, false);

  await db.close();
});
