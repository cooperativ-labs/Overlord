import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-objectives-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, recordChange } = await import('./db.ts');
const { createTestWorkspaceContext } = await import('./test-helpers.ts');
const { WORKSPACE } = createTestWorkspaceContext(await import('./db.ts'));
const { entityChangeDtoFromRow, parseChangedFields, readChangesAfter } =
  await import('./realtime.ts');
const {
  createMission,
  createProject,
  createObjective,
  getMissionDetail,
  listMissions,
  reorderObjectives,
  updateObjective
} = await import('./repository.ts');
const { getObjectiveEffectiveLaunchConfig, getObjectiveLaunchCommand, getObjectivePrompt } =
  await import('./execution/launch.ts');
const { updateLaunchPreference } = await import('./execution/launch-settings.ts');
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
    workspace_id: 'workspace-1',
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
    workspaceId: 'workspace-1',
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

  const firstPage = await readChangesAfter(before.seq, [WORKSPACE.id], 1);
  assert.equal(firstPage.changes.length, 1);
  assert.equal(firstPage.changes[0]!.entityId, 'sync-1');
  assert.equal(firstPage.hasMore, true);

  const secondPage = await readChangesAfter(firstPage.cursor, [WORKSPACE.id], 1);
  assert.equal(secondPage.changes.length, 1);
  assert.equal(secondPage.changes[0]!.entityId, 'sync-2');
  assert.deepEqual(secondPage.changes[0]!.changedFields, ['state', 'updated_at']);
  assert.equal(secondPage.hasMore, false);

  const emptyPage = await readChangesAfter(secondPage.cursor, [WORKSPACE.id], 1);
  assert.deepEqual(emptyPage, { changes: [], cursor: secondPage.cursor, hasMore: false });
});

test('setting an executed objective back to draft stamps reopenedAt as a last-wins run boundary', async () => {
  const project = await createProject({ name: 'Reopen Run Boundary Test' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run me twice' });
  const objectiveId = mission.objectives[0]!.id;

  // Setting a never-executed draft to draft again is not a reopen.
  assert.equal(mission.objectives[0]!.reopenedAt, null);
  const stillDraft = await updateObjective(objectiveId, { state: 'draft' });
  assert.equal(stillDraft.reopenedAt, null);

  const completed = await updateObjective(objectiveId, { state: 'complete' });
  assert.equal(completed.reopenedAt, null);
  assert.ok(completed.completedAt);

  const reopened = await updateObjective(objectiveId, { state: 'draft' });
  assert.ok(reopened.reopenedAt, 'complete → draft stamps reopened_at');
  assert.ok(reopened.reopenedAt! >= completed.completedAt!);
  // Reopening keeps the run's own timestamps; only the boundary is new.
  assert.equal(reopened.completedAt, completed.completedAt);
  assert.equal(reopened.state, 'draft');

  const changeRow = db
    .prepare(
      `SELECT changed_fields_json FROM entity_changes
        WHERE entity_type = 'objective' AND entity_id = ? AND operation = 'update'
        ORDER BY seq DESC LIMIT 1`
    )
    .get(objectiveId) as { changed_fields_json: string };
  assert.ok(parseChangedFields(changeRow.changed_fields_json).includes('reopened_at'));

  // Second run: re-complete, then reopen again. The stamp is last-wins.
  await new Promise(resolve => setTimeout(resolve, 5));
  await updateObjective(objectiveId, { state: 'complete' });
  const reopenedAgain = await updateObjective(objectiveId, { state: 'draft' });
  assert.ok(reopenedAgain.reopenedAt! > reopened.reopenedAt!);

  // A draft that has been reopened keeps its boundary through unrelated edits.
  const retitled = await updateObjective(objectiveId, { title: 'Renamed' });
  assert.equal(retitled.reopenedAt, reopenedAgain.reopenedAt);

  const detail = await getMissionDetail(mission.id);
  assert.equal(detail.objectives[0]!.reopenedAt, reopenedAgain.reopenedAt);
});

test('force-disconnecting an executing objective to draft also stamps reopenedAt', async () => {
  const project = await createProject({ name: 'Reopen From Executing Test' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Abandon me' });
  const objectiveId = mission.objectives[0]!.id;

  const executing = await updateObjective(objectiveId, { state: 'executing' });
  assert.equal(executing.reopenedAt, null);

  const abandoned = await updateObjective(objectiveId, { state: 'draft' });
  assert.ok(abandoned.reopenedAt);
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

test('effective launch config keeps an explicit empty objective override authoritative', async () => {
  const project = await createProject({ name: 'Effective launch config' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Launch without pod'
  });
  const objectiveId = mission.objectives[0]!.id;

  await updateObjective(objectiveId, {
    launchConfigAgent: 'claude',
    launchConfigOverride: { preCommand: '', flags: [] }
  });

  const effective = await getObjectiveEffectiveLaunchConfig(objectiveId, { agent: 'claude' });
  assert.deepEqual(effective, {
    objectiveId,
    missionId: mission.id,
    executionTargetId: null,
    launchConfig: { preCommand: '', flags: [] },
    source: 'objective'
  });
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

type QueueRow = { id: string; state: string; position: number; revision: number };

function missionRows(missionId: string): QueueRow[] {
  return db
    .prepare(
      `SELECT id, state, position, revision FROM objectives
        WHERE mission_id = ? AND deleted_at IS NULL ORDER BY position`
    )
    .all(missionId) as QueueRow[];
}

async function missionWithDrafts(name: string, count: number) {
  const project = await createProject({ name });
  const mission = await createMission({
    projectId: project.id,
    objectives: Array.from({ length: count }, (_, index) => ({ objective: `Objective ${index}` }))
  });
  return { project, mission, ids: mission.objectives.map(objective => objective.id) };
}

test('reordering the draft queue can move the head and persists swaps safely', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Reorder', 3);
  const [first, second, third] = ids as [string, string, string];

  const reordered = await reorderObjectives(mission.id, {
    orderedObjectiveIds: [third, first, second]
  });

  assert.deepEqual(
    reordered.map(objective => [objective.id, objective.state, objective.position]),
    [
      [third, 'draft', 0],
      [first, 'draft', 1],
      [second, 'draft', 2]
    ]
  );
});

test('reordering leaves a launching objective between queued ones in its slot', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Launching Slot', 4);
  const [a, launching, c, d] = ids as [string, string, string, string];
  db.prepare(`UPDATE objectives SET state = 'launching' WHERE id = ?`).run(launching);

  await reorderObjectives(mission.id, { orderedObjectiveIds: [d, c, a] });

  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.position]),
    [
      [d, 0],
      [launching, 1],
      [c, 2],
      [a, 3]
    ]
  );
});

test('reordering includes submitted objectives and keeps active and complete rows fixed', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Mixed States', 5);
  const [done, active, submitted, blank, draft] = ids as [string, string, string, string, string];
  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(done);
  db.prepare(`UPDATE objectives SET state = 'executing' WHERE id = ?`).run(active);
  db.prepare(`UPDATE objectives SET state = 'submitted' WHERE id = ?`).run(submitted);
  db.prepare(`UPDATE objectives SET instruction_text = '' WHERE id = ?`).run(blank);

  await reorderObjectives(mission.id, { orderedObjectiveIds: [draft, blank, submitted] });

  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.position]),
    [
      [done, 0],
      [active, 1],
      [draft, 2],
      [blank, 3],
      [submitted, 4]
    ]
  );
});

test('reordering rejects incomplete, over-complete, duplicate, foreign and non-queued id lists without writing', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Validation', 3);
  const [first, second, third] = ids as [string, string, string];
  const other = await missionWithDrafts('Draft Queue Validation Other', 1);
  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(first);
  const before = missionRows(mission.id);
  const status = (expected: number) => (error: unknown) =>
    error instanceof ApiError && error.status === expected;

  await assert.rejects(
    () => reorderObjectives(mission.id, { orderedObjectiveIds: [third] }),
    status(400)
  );
  await assert.rejects(
    () => reorderObjectives(mission.id, { orderedObjectiveIds: [third, second, first] }),
    status(400)
  );
  await assert.rejects(
    () => reorderObjectives(mission.id, { orderedObjectiveIds: [third, third] }),
    status(400)
  );
  await assert.rejects(
    () => reorderObjectives(mission.id, { orderedObjectiveIds: [third, second, other.ids[0]!] }),
    status(404)
  );
  assert.deepEqual(missionRows(mission.id), before);
});

test('an unchanged order and an empty queue write no revisions', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue No-op', 2);
  const before = missionRows(mission.id);
  await reorderObjectives(mission.id, { orderedObjectiveIds: ids });
  assert.deepEqual(missionRows(mission.id), before);

  for (const id of ids) db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(id);
  const completed = missionRows(mission.id);
  await reorderObjectives(mission.id, { orderedObjectiveIds: [] });
  assert.deepEqual(missionRows(mission.id), completed);
});

test('direct position writes are refused; an unchanged position is a no-op', async () => {
  const { ids } = await missionWithDrafts('Draft Queue Direct Position', 2);
  await assert.rejects(
    () => updateObjective(ids[0]!, { position: 1 }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
  const unchanged = await updateObjective(ids[0]!, { position: 0 });
  assert.equal(unchanged.position, 0);
});

test('setting one objective to draft never changes another draft', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue No Demotion', 3);
  const before = missionRows(mission.id);
  await updateObjective(ids[2]!, { state: 'draft', title: 'Retitled' });
  const after = missionRows(mission.id);
  assert.deepEqual(
    after.map(row => [row.id, row.state, row.position]),
    before.map(row => [row.id, row.state, row.position])
  );
});

test('marking a queued objective executing leaves other drafts untouched and persists no blank draft', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Execute', 3);
  await updateObjective(ids[1]!, { state: 'executing', assignedAgent: 'codex' });
  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.state]),
    [
      [ids[0], 'draft'],
      [ids[1], 'executing'],
      [ids[2], 'draft']
    ]
  );
});

test('reopening a completed objective moves it to the queue head over existing slots', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Reopen', 6);
  const [doneEarly, active, draftA, launching, draftB, done] = ids as [
    string,
    string,
    string,
    string,
    string,
    string
  ];
  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id IN (?, ?)`).run(doneEarly, done);
  db.prepare(`UPDATE objectives SET state = 'executing' WHERE id = ?`).run(active);
  db.prepare(`UPDATE objectives SET state = 'launching' WHERE id = ?`).run(launching);
  const before = Object.fromEntries(missionRows(mission.id).map(row => [row.id, row]));

  const reopened = await updateObjective(done, { state: 'draft' });
  assert.equal(reopened.state, 'draft');
  assert.ok(reopened.reopenedAt);

  const after = missionRows(mission.id);
  assert.deepEqual(
    after.map(row => [row.id, row.position]),
    [
      [doneEarly, 0],
      [active, 1],
      [done, 2],
      [launching, 3],
      [draftA, 4],
      [draftB, 5]
    ]
  );
  // Revisions only move forward, and the reopened row's history survives.
  for (const row of after) assert.ok(row.revision >= before[row.id]!.revision);
  const changes = db
    .prepare(
      `SELECT changed_fields_json FROM entity_changes
        WHERE entity_type = 'objective' AND entity_id = ? ORDER BY seq`
    )
    .all(done) as Array<{ changed_fields_json: string }>;
  const fields = changes.flatMap(change => parseChangedFields(change.changed_fields_json));
  assert.ok(fields.includes('reopened_at'));
  assert.ok(fields.includes('position'));
});

test('reopening an objective already before the queue, or with no queue, keeps its position', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Reopen Before', 3);
  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(ids[0]);
  await updateObjective(ids[0]!, { state: 'draft' });
  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.position]),
    ids.map((id, index) => [id, index])
  );

  const lone = await missionWithDrafts('Draft Queue Reopen Lone', 1);
  await updateObjective(lone.ids[0]!, { state: 'complete' });
  const reopened = await updateObjective(lone.ids[0]!, { state: 'draft' });
  assert.equal(reopened.position, 0);
});

test('reopening an executing queued objective preserves sparse history slots and its original queue slots', async () => {
  const { mission, ids } = await missionWithDrafts('Queued Reopen Sparse Slots', 5);
  const [a, done, b, active, reopened] = ids as [string, string, string, string, string];
  await updateObjective(reopened, { autoAdvance: true });
  db.prepare('UPDATE objectives SET position = position * 10 + 10 WHERE mission_id = ?').run(
    mission.id
  );
  db.prepare("UPDATE objectives SET state = 'complete' WHERE id = ?").run(done);
  db.prepare("UPDATE objectives SET state = 'executing' WHERE id IN (?, ?)").run(active, reopened);
  const { seedDelivery } = await import('./test-helpers.ts');
  const deliveryId = seedDelivery(db, {
    workspaceId: WORKSPACE.id,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: reopened,
    summary: 'Evidence survives reopen'
  });
  const deliveryBefore = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
  const before = missionRows(mission.id);
  await updateObjective(reopened, { state: 'draft' });
  assert.deepEqual(
    db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId),
    deliveryBefore
  );
  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.position]),
    [
      [reopened, 10],
      [done, 20],
      [a, 30],
      [active, 40],
      [b, 50]
    ]
  );
  for (const id of [done, active]) {
    assert.deepEqual(
      missionRows(mission.id).find(row => row.id === id),
      before.find(row => row.id === id)
    );
  }
});

test('a launch racing a reorder is rejected by the state-checked position writes', async () => {
  const { mission, ids } = await missionWithDrafts('Draft Queue Race', 3);
  const [a, b, c] = ids as [string, string, string];
  // Simulate a launch that committed after the reorder read its set: the row
  // is already launching when the reorder writes.
  const originalPrepare = db.prepare.bind(db);
  let raced = false;
  (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
    if (
      !raced &&
      /UPDATE objectives SET position = \?, updated_at = \?\s+WHERE id = \?/.test(sql)
    ) {
      raced = true;
      originalPrepare(`UPDATE objectives SET state = 'launching' WHERE id = ?`).run(c);
    }
    return originalPrepare(sql);
  }) as typeof db.prepare;
  try {
    await assert.rejects(
      () => reorderObjectives(mission.id, { orderedObjectiveIds: [c, b, a] }),
      (error: unknown) => error instanceof ApiError && error.status === 409
    );
  } finally {
    (db as { prepare: typeof db.prepare }).prepare = originalPrepare;
  }
  // The rejected reorder rolled back every position write.
  assert.deepEqual(
    missionRows(mission.id).map(row => [row.id, row.position]),
    [
      [a, 0],
      [b, 1],
      [c, 2]
    ]
  );
});

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
