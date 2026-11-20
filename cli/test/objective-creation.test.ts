import {
  addObjectivesToMission,
  createMissionWithObjectives,
  updateObjective
} from '@overlord/core/service/missions';
import { createProject } from '@overlord/core/service/projects';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeededCliContext } from './support/seeded-context.ts';

test('mission creation creates every objective as a draft', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Objective Creation Test' });

  const { objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [
      { instructions: 'First objective' },
      { instructions: 'Second objective' },
      { instructions: 'Third objective' }
    ]
  });

  assert.deepEqual(
    objectives.map(objective => objective.state),
    ['draft', 'draft', 'draft']
  );

  await db.close();
});

test('adding objectives to a mission with a draft appends more drafts', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Test' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Existing draft' }]
  });

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ instructions: 'Additional objective' }, { instructions: 'Another objective' }]
  });

  assert.deepEqual(
    added.map(objective => objective.state),
    ['draft', 'draft']
  );

  await db.close();
});

test('adding objectives to a mission without a draft creates drafts and leaves the submitted objective alone', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Refill Draft Test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Existing objective' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ instructions: 'New next-up' }, { instructions: 'Future follow-up' }]
  });

  assert.deepEqual(
    added.map(objective => objective.state),
    ['draft', 'draft']
  );
  const discussed = await ctx.db.get<{ state: string }>(
    `SELECT state FROM objectives WHERE id = ?`,
    [objectives[0]?.id]
  );
  assert.equal(discussed?.state, 'submitted');

  await db.close();
});

test('adding objectives persists autoAdvance when requested', async () => {
  const { db, ctx } = await createSeededCliContext();
  const project = await createProject({ ctx, name: 'Add Objectives Auto Advance' });
  const { mission } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Existing draft' }]
  });

  const added = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [
      { instructions: 'Auto-advance follow-up', autoAdvance: true },
      { instructions: 'Manual follow-up' }
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
    objectives: [{ instructions: 'Existing draft' }]
  });

  const [added] = await addObjectivesToMission({
    ctx,
    missionId: mission.id,
    objectives: [{ instructions: 'Run with Codex', agent: 'codex', model: 'gpt-5.6-terra' }]
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
    objectives: [{ instructions: 'Existing draft' }]
  });

  await assert.rejects(
    addObjectivesToMission({
      ctx,
      missionId: mission.id,
      objectives: [{ instructions: 'Invalid model selection', model: 'gpt-5.6-terra' }]
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
    objectives: [{ instructions: 'Existing draft' }]
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
