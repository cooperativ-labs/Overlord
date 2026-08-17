import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-objectives-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, WORKSPACE, setActiveWorkspaceUser, nowIso, newId, recordChange } =
  await import('./db.ts');
const { entityChangeDtoFromRow, parseChangedFields, readChangesAfter } =
  await import('./realtime.ts');
const {
  createMission,
  createProject,
  createObjective,
  getMissionDetail,
  listMissions,
  reorderFutureObjectives,
  updateObjective
} = await import('./repository.ts');
const { getObjectiveLaunchCommand, getObjectivePrompt, updateLaunchPreference } =
  await import('./execution/launch.ts');
const { ApiError } = await import('./errors.ts');

const OBJECTIVE_DISPLAY_ID_RE = /^[a-z0-9-]+:\d+\.[0-9a-hjkmnp-tv-z]{4}$/;

// Operator is seeded by bootstrapIntegrationTestDb.

test('mission detail includes computed objective display ids', async () => {
  const project = await createProject({ name: 'Objective Display Ids' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Ship display ids'
  });
  const created = mission.objectives[0]!;
  assert.match(created.displayKey, /^[0-9a-hjkmnp-tv-z]{4}$/);
  assert.equal(created.displayId, `${mission.displayId}.${created.displayKey}`);
  assert.match(created.displayId, OBJECTIVE_DISPLAY_ID_RE);

  const detail = await getMissionDetail(mission.id);
  assert.equal(detail.objectives[0]!.displayId, created.displayId);

  const byDisplayId = await updateObjective(created.displayId, { autoAdvance: true });
  assert.equal(byDisplayId.id, created.id);
  assert.equal(byDisplayId.displayId, created.displayId);
  assert.equal(byDisplayId.autoAdvance, true);

  await assert.rejects(
    () => updateObjective(mission.displayId, { autoAdvance: false }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 400 && error.code === 'invalid_objective_ref'
  );
});

test('realtime change DTOs include safely parsed changed fields', () => {
  assert.deepEqual(parseChangedFields('["state","completed_at"]'), ['state', 'completed_at']);
  assert.deepEqual(parseChangedFields('{"state":true}'), []);
  assert.deepEqual(parseChangedFields('not json'), []);
  assert.deepEqual(parseChangedFields('["state",42,null,"phase"]'), ['state', 'phase']);

  const dto = entityChangeDtoFromRow({
    seq: 42,
    entity_type: 'objective',
    entity_id: 'objective-1',
    operation: 'update',
    project_id: 'project-1',
    mission_id: 'mission-1',
    objective_id: 'objective-1',
    changed_fields_json: '["state","completed_at"]',
    occurred_at: '2026-06-29T00:00:00.000Z'
  });

  assert.deepEqual(dto, {
    seq: 42,
    entityType: 'objective',
    entityId: 'objective-1',
    operation: 'update',
    projectId: 'project-1',
    missionId: 'mission-1',
    objectiveId: 'objective-1',
    changedFields: ['state', 'completed_at'],
    occurredAt: '2026-06-29T00:00:00.000Z'
  });
});

test('realtime catch-up reads changes after the cursor in order', async () => {
  const before = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM entity_changes`).get() as {
    seq: number;
  };

  await recordChange({
    entityType: 'test_sync',
    entityId: 'sync-1',
    operation: 'insert',
    workspaceId: WORKSPACE.id,
    changedFields: ['state']
  });
  await recordChange({
    entityType: 'test_sync',
    entityId: 'sync-2',
    operation: 'update',
    workspaceId: WORKSPACE.id,
    changedFields: ['state', 'updated_at']
  });

  const firstPage = await readChangesAfter(before.seq, 1);
  assert.equal(firstPage.changes.length, 1);
  assert.equal(firstPage.changes[0]!.entityId, 'sync-1');
  assert.equal(firstPage.hasMore, true);

  const secondPage = await readChangesAfter(firstPage.cursor, 1);
  assert.equal(secondPage.changes.length, 1);
  assert.equal(secondPage.changes[0]!.entityId, 'sync-2');
  assert.deepEqual(secondPage.changes[0]!.changedFields, ['state', 'updated_at']);
  assert.equal(secondPage.hasMore, false);

  const emptyPage = await readChangesAfter(secondPage.cursor, 1);
  assert.deepEqual(emptyPage, { changes: [], cursor: secondPage.cursor, hasMore: false });
});

test('completed objectives cannot be moved back to the future queue', async () => {
  const project = await createProject({ name: 'Complete To Future Guard Test' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Done' });
  const objectiveId = mission.objectives[0]!.id;

  await updateObjective(objectiveId, { state: 'complete' });

  await assert.rejects(
    () => updateObjective(objectiveId, { state: 'future' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test('clearing a draft objective instruction to empty leaves it blank instead of erroring', async () => {
  const project = await createProject({ name: 'Clear Instruction Test' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Do the thing' });
  const objectiveId = mission.objectives[0]!.id;

  const updated = await updateObjective(objectiveId, { instructionText: '   ' });

  assert.equal(updated.instructionText, '');
});

test('clearing a submitted objective instruction to empty is still rejected', async () => {
  const project = await createProject({ name: 'Clear Submitted Instruction Test' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Do the thing' });
  const objectiveId = mission.objectives[0]!.id;
  await updateObjective(objectiveId, { state: 'submitted' });

  await assert.rejects(
    updateObjective(objectiveId, { instructionText: '   ' }),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test('copyable objective prompts avoid shell-unbalanced Markdown fences', async () => {
  const project = await createProject({ name: 'Copyable Prompt Test' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Use the supplied terminal command.'
  });

  const prompt = await getObjectivePrompt(mission.objectives[0]!.id);

  assert.doesNotMatch(prompt.prompt, /```/);
  assert.match(prompt.prompt, /\n {4}ovld protocol attach --mission-id /);
  assert.match(prompt.prompt, /--objective-id /);
  assert.doesNotMatch(prompt.prompt, /informational only/);
});

test('copyable launch commands include agent, mission, and resolved launch mechanics', async () => {
  const project = await createProject({ name: 'Copyable Launch Command Test' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Launch from the terminal.'
  });
  const objectiveId = mission.objectives[0]!.id;

  await updateObjective(objectiveId, {
    launchConfigAgent: 'cursor',
    launchConfigOverride: {
      preCommand: 'agp',
      flags: [{ name: '--sandbox', value: 'workspace-write' }]
    }
  });

  const launchCommand = await getObjectiveLaunchCommand(objectiveId, {
    agent: 'cursor',
    model: 'gpt-5.6-terra',
    reasoningEffort: 'high'
  });

  assert.equal(
    launchCommand.command,
    `ovld launch cursor --mission-id ${mission.displayId} --objective-id ${mission.objectives[0]!.displayId} --model gpt-5.6-terra --thinking high --pre-command agp --flag '--sandbox workspace-write'`
  );
});

test('objective launch mechanics are persisted as an explicit any-target override', async () => {
  const project = await createProject({ name: 'Objective launch override' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Build it' });
  const objectiveId = mission.objectives[0]!.id;

  const updated = await updateObjective(objectiveId, {
    launchConfigAgent: 'codex',
    launchConfigOverride: {
      preCommand: 'agp',
      flags: [{ name: '--sandbox', value: 'workspace-write' }]
    }
  });

  assert.deepEqual(updated.launchConfigOverrides, {
    '*': {
      codex: {
        preCommand: 'agp',
        flags: [{ name: '--sandbox', value: 'workspace-write' }]
      }
    }
  });
  const stored = db
    .prepare(`SELECT launch_config_json FROM objectives WHERE id = ?`)
    .get(objectiveId) as { launch_config_json: string };
  assert.deepEqual(JSON.parse(stored.launch_config_json), updated.launchConfigOverrides);
});

test('new draft objectives inherit the project last-used agent', async () => {
  const project = await createProject({ name: 'Default Agent Objectives' });
  updateLaunchPreference(project.id, {
    selectedAgent: 'claude',
    selectedModel: 'claude-opus-4-8',
    selectedReasoningEffort: 'high'
  });

  // The mission's first objective is created through the same insert path and must
  // record the launch selection so the button and execution read it from the db.
  const mission = await createMission({ projectId: project.id, firstObjective: 'Do the thing' });
  const firstObjective = mission.objectives[0]!;
  assert.equal(firstObjective.assignedAgent, 'claude');
  assert.equal(firstObjective.model, 'claude-opus-4-8');
  assert.equal(firstObjective.reasoningEffort, 'high');

  // An objective added afterwards (the add-objective affordance, which persists
  // only once the composer has text) also stamps the agent rather than leaving
  // it null for auto-advance to misread.
  const added = await createObjective({
    missionId: mission.id,
    instructionText: 'Follow-up objective'
  });
  assert.equal(added.assignedAgent, 'claude');
  assert.equal(added.model, 'claude-opus-4-8');
  assert.equal(added.reasoningEffort, 'high');
});

test('new draft objectives leave the agent unset without a launch preference', async () => {
  const project = await createProject({ name: 'No Preference Objectives' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Do the thing' });
  assert.equal(mission.objectives[0]!.assignedAgent, null);
});

test('listing missions can embed every objective in one batched read', async () => {
  const project = await createProject({ name: 'Batched Objectives Listing' });
  const first = await createMission({
    projectId: project.id,
    firstObjective: 'First mission work'
  });
  const second = await createMission({
    projectId: project.id,
    firstObjective: 'Second mission work'
  });
  const secondFollowUp = await createObjective({
    missionId: second.id,
    instructionText: 'Second mission follow-up',
    state: 'draft'
  });

  // Default listing stays lean: no objective bodies unless asked for.
  const lean = await listMissions(project.id);
  assert.equal(lean.length, 2);
  assert.ok(lean.every(mission => mission.objectives === undefined));

  const withObjectives = await listMissions(project.id, { includeObjectives: true });
  const firstDto = withObjectives.find(mission => mission.id === first.id)!;
  const secondDto = withObjectives.find(mission => mission.id === second.id)!;

  assert.deepEqual(
    firstDto.objectives?.map(objective => objective.instructionText),
    ['First mission work']
  );
  // Objectives arrive grouped by mission and ordered by position.
  assert.deepEqual(
    secondDto.objectives?.map(objective => objective.instructionText),
    ['Second mission work', 'Second mission follow-up']
  );
  assert.equal(secondDto.objectives?.[1]!.id, secondFollowUp.id);
});

test('reordering future objectives persists swaps without violating the unique position constraint', async () => {
  const project = await createProject({ name: 'Future Objective Reorder' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'First draft' });
  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second future objective',
    state: 'draft'
  });
  const third = await createObjective({
    missionId: mission.id,
    instructionText: 'Third future objective',
    state: 'draft'
  });

  const reordered = await reorderFutureObjectives(mission.id, {
    orderedObjectiveIds: [third.id, second.id]
  });

  assert.deepEqual(
    reordered.map(objective => ({
      text: objective.instructionText,
      state: objective.state,
      position: objective.position
    })),
    [
      { text: 'First draft', state: 'draft', position: 0 },
      { text: 'Third future objective', state: 'future', position: 1 },
      { text: 'Second future objective', state: 'future', position: 2 }
    ]
  );
});

test('marking a queued objective executing promotes the earliest future objective to draft', async () => {
  const project = await createProject({ name: 'Promote Future On Execute' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Execute first' });
  const running = mission.objectives[0]!;
  const future = await createObjective({
    missionId: mission.id,
    instructionText: 'Continue with second objective',
    state: 'draft'
  });

  assert.equal(future.state, 'future');

  await updateObjective(running.id, { state: 'executing' });

  const rows = db
    .prepare(
      `SELECT id, instruction_text, state
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`
    )
    .all(mission.id) as Array<{ id: string; instruction_text: string; state: string }>;

  assert.deepEqual(
    rows.map(row => row.state),
    ['executing', 'draft']
  );
  assert.equal(rows[1]!.id, future.id);
  assert.equal(rows[1]!.instruction_text, 'Continue with second objective');
});

test('marking a queued objective executing promotes future over a blank draft placeholder', async () => {
  const project = await createProject({ name: 'Promote Future Over Placeholder' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Execute first' });
  const running = mission.objectives[0]!;
  db.prepare(`UPDATE objectives SET state = 'launching' WHERE id = ?`).run(running.id);

  const placeholder = await createObjective({
    missionId: mission.id,
    instructionText: '',
    state: 'draft'
  });
  const future = await createObjective({
    missionId: mission.id,
    instructionText: 'Continue with real future objective',
    state: 'draft'
  });

  assert.equal(placeholder.state, 'draft');
  assert.equal(future.state, 'future');

  await updateObjective(running.id, { state: 'executing' });

  const rows = db
    .prepare(
      `SELECT id, instruction_text, state
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`
    )
    .all(mission.id) as Array<{ id: string; instruction_text: string; state: string }>;

  assert.deepEqual(
    rows.map(row => row.state),
    ['executing', 'draft']
  );
  assert.equal(rows[1]!.id, future.id);
  assert.equal(rows[1]!.instruction_text, 'Continue with real future objective');

  const placeholderRow = db
    .prepare(`SELECT deleted_at FROM objectives WHERE id = ?`)
    .get(placeholder.id) as { deleted_at: string | null };
  assert.ok(placeholderRow.deleted_at);
});

test('marking the only queued objective executing persists no blank draft fallback', async () => {
  const project = await createProject({ name: 'No Blank Draft On Execute' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Execute first' });
  const running = mission.objectives[0]!;

  await updateObjective(running.id, { state: 'executing', assignedAgent: 'codex' });

  const rows = db
    .prepare(
      `SELECT instruction_text, state, assigned_agent
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`
    )
    .all(mission.id) as Array<{
    instruction_text: string;
    state: string;
    assigned_agent: string | null;
  }>;

  // The empty next-up slot is the mission panel's client-only composer, so
  // nothing is written until the user actually authors an objective.
  assert.deepEqual(
    rows.map(row => row.state),
    ['executing']
  );
});

test('promoting a future objective splices it into the draft slot and cascades positions', async () => {
  const project = await createProject({ name: 'Promote Future Splice' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Objective 1' });
  const objectiveIds = [mission.objectives[0]!.id];

  for (let index = 2; index <= 5; index += 1) {
    const objective = await createObjective({
      missionId: mission.id,
      instructionText: `Objective ${index}`
    });
    objectiveIds.push(objective.id);
  }

  const promoted = await createObjective({
    missionId: mission.id,
    instructionText: 'Inserted objective'
  });

  const [firstId, secondId, thirdId, fourthId, fifthId] = objectiveIds;
  db.prepare(`UPDATE objectives SET state = 'complete', position = 0 WHERE id = ?`).run(firstId);
  db.prepare(`UPDATE objectives SET state = 'complete', position = 1 WHERE id = ?`).run(secondId);
  db.prepare(`UPDATE objectives SET state = 'draft', position = 2 WHERE id = ?`).run(thirdId);
  db.prepare(`UPDATE objectives SET state = 'future', position = 3 WHERE id = ?`).run(fourthId);
  db.prepare(`UPDATE objectives SET state = 'future', position = 4 WHERE id = ?`).run(fifthId);
  db.prepare(`UPDATE objectives SET state = 'future', position = 5 WHERE id = ?`).run(promoted.id);

  await updateObjective(promoted.id, { state: 'draft' });

  const rows = db
    .prepare(
      `SELECT id, instruction_text, state, position
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`
    )
    .all(mission.id) as Array<{
    id: string;
    instruction_text: string;
    state: string;
    position: number;
  }>;

  assert.deepEqual(
    rows.map(row => ({
      text: row.instruction_text,
      state: row.state,
      position: row.position
    })),
    [
      { text: 'Objective 1', state: 'complete', position: 0 },
      { text: 'Objective 2', state: 'complete', position: 1 },
      { text: 'Inserted objective', state: 'draft', position: 2 },
      { text: 'Objective 3', state: 'future', position: 3 },
      { text: 'Objective 4', state: 'future', position: 4 },
      { text: 'Objective 5', state: 'future', position: 5 }
    ]
  );
});

test('promoting the second-from-last future objective demotes the draft to first future', async () => {
  const project = await createProject({ name: 'Promote Second From Last' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Draft objective' });
  const draftId = mission.objectives[0]!.id;

  const futureIds: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const objective = await createObjective({
      missionId: mission.id,
      instructionText: `Future ${index}`
    });
    futureIds.push(objective.id);
  }

  const [firstFutureId, secondFutureId, thirdFutureId, fourthFutureId] = futureIds;
  const promoteId = thirdFutureId;

  db.prepare(`UPDATE objectives SET state = 'draft', position = 0 WHERE id = ?`).run(draftId);
  db.prepare(`UPDATE objectives SET state = 'future', position = 1 WHERE id = ?`).run(
    firstFutureId
  );
  db.prepare(`UPDATE objectives SET state = 'future', position = 2 WHERE id = ?`).run(
    secondFutureId
  );
  db.prepare(`UPDATE objectives SET state = 'future', position = 3 WHERE id = ?`).run(
    thirdFutureId
  );
  db.prepare(`UPDATE objectives SET state = 'future', position = 4 WHERE id = ?`).run(
    fourthFutureId
  );

  await updateObjective(promoteId, { state: 'draft' });

  const rows = db
    .prepare(
      `SELECT instruction_text, state, position
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`
    )
    .all(mission.id) as Array<{ instruction_text: string; state: string; position: number }>;

  assert.deepEqual(
    rows.map(row => ({
      text: row.instruction_text,
      state: row.state,
      position: row.position
    })),
    [
      { text: 'Future 3', state: 'draft', position: 0 },
      { text: 'Draft objective', state: 'future', position: 1 },
      { text: 'Future 1', state: 'future', position: 2 },
      { text: 'Future 2', state: 'future', position: 3 },
      { text: 'Future 4', state: 'future', position: 4 }
    ]
  );
});

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
