import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-activity-feed-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, nowIso } = await import('./db.ts');
const { createProject, createMission, createObjective, updateObjective } =
  await import('./repository.ts');
const { listActivityFeed } = await import('./activity-feed.ts');

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Delivery rows are written by the protocol service, which needs a live agent
 * session. The feed only reads them, so the test seeds the row directly rather
 * than standing up a session handshake for a read-path assertion.
 */
function seedDelivery({
  workspaceId,
  projectId,
  missionId,
  objectiveId,
  summary,
  deliveredAt
}: {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  summary: string;
  deliveredAt: string;
}): string {
  const id = newId('delivery');
  db.prepare(
    `INSERT INTO deliveries
       (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
        delivered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    projectId,
    missionId,
    objectiveId,
    summary,
    deliveredAt,
    deliveredAt,
    deliveredAt
  );
  return id;
}

function seedAskEvent({
  workspaceId,
  projectId,
  missionId,
  objectiveId,
  summary,
  createdAt
}: {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string | null;
  summary: string;
  createdAt: string;
}): string {
  const id = newId('event');
  db.prepare(
    `INSERT INTO mission_events
       (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
        payload_json, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'ask', 'blocked', ?, '{}', 'agent', ?)`
  ).run(id, workspaceId, projectId, missionId, objectiveId, summary, createdAt);
  return id;
}

test('an executing objective appears with its project and mission context', async () => {
  const project = await createProject({ name: 'AF Running', color: '#445566' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run me' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `run:${objective.id}`);

  assert.ok(item, 'the executing objective must be in the feed');
  assert.equal(item.kind, 'objective_run');
  assert.equal(item.projectName, 'AF Running');
  assert.equal(item.projectColor, '#445566');
  assert.equal(item.missionId, mission.id);
  assert.equal(item.objectiveDisplayId, objective.displayId);
});

test('objectives that are not launching or executing stay out of the feed', async () => {
  const project = await createProject({ name: 'AF Idle' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Idle' });
  const objective = mission.objectives[0]!;

  const feed = await listActivityFeed();

  assert.ok(!feed.items.some(entry => entry.id === `run:${objective.id}`));
});

test('the auto-advance queue stops at the first objective that will not advance on its own', async () => {
  const project = await createProject({ name: 'AF Queue' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'First' });
  const running = mission.objectives[0]!;
  await updateObjective(running.id, { state: 'executing' });

  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second',
    state: 'future',
    autoAdvance: true
  });
  const third = await createObjective({
    missionId: mission.id,
    instructionText: 'Third',
    state: 'future',
    autoAdvance: true
  });
  // A manual gate: everything behind it is not "up next".
  const gate = await createObjective({
    missionId: mission.id,
    instructionText: 'Manual gate',
    state: 'future',
    autoAdvance: false
  });
  const behindGate = await createObjective({
    missionId: mission.id,
    instructionText: 'Behind the gate',
    state: 'future',
    autoAdvance: true
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `run:${running.id}`);
  assert.ok(item && item.kind === 'objective_run');

  assert.deepEqual(
    item.upcoming.map(next => next.objectiveId),
    [second.id, third.id],
    'the queue is the contiguous auto-advance run only'
  );
  assert.ok(!item.upcoming.some(next => next.objectiveId === gate.id));
  assert.ok(!item.upcoming.some(next => next.objectiveId === behindGate.id));
});

test('deliveries are capped at the newest seven, with the true total in counts', async () => {
  const project = await createProject({ name: 'AF Deliveries' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Deliver' });
  const objective = mission.objectives[0]!;

  for (let index = 0; index < 9; index += 1) {
    seedDelivery({
      workspaceId: mission.workspaceId,
      projectId: project.id,
      missionId: mission.id,
      objectiveId: objective.id,
      summary: `Delivery ${index}`,
      // Ascending timestamps: the last one written is the newest.
      deliveredAt: `2026-08-1${index}T00:00:00.000Z`
    });
  }

  const feed = await listActivityFeed();
  const deliveries = feed.items.filter(entry => entry.kind === 'delivery');

  assert.equal(deliveries.length, 7, 'the feed shows at most seven deliveries');
  assert.equal(feed.counts.delivery, 7);
  assert.equal(
    deliveries[0]!.kind === 'delivery' ? deliveries[0]!.delivery.summary : null,
    'Delivery 8',
    'the newest delivery leads'
  );
});

test('a delivery carries the normalized report rather than raw payload JSON', async () => {
  const project = await createProject({ name: 'AF Report' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Report' });
  const objective = mission.objectives[0]!;
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Normalized please',
    deliveredAt: '2026-08-20T00:00:00.000Z'
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.kind === 'delivery');

  assert.ok(item && item.kind === 'delivery');
  assert.ok(item.delivery.report, 'a versioned report is synthesized for legacy payloads');
  assert.ok(!('payloadJson' in item.delivery), 'raw payload JSON is never projected');
});

test('an unseen blocking question surfaces and a seen one drops out', async () => {
  const project = await createProject({ name: 'AF Ask' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Ask' });
  const objective = mission.objectives[0]!;
  const askedAt = '2026-08-15T00:00:00.000Z';
  const eventId = seedAskEvent({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Which database should I use?',
    createdAt: askedAt
  });

  const before = await listActivityFeed();
  const question = before.items.find(entry => entry.id === `ask:${eventId}`);
  assert.ok(question && question.kind === 'blocking_question');
  assert.equal(question.question, 'Which database should I use?');

  db.prepare(
    `INSERT INTO mission_status_seen (mission_id, status_id, seen_at)
     VALUES (?, 'blocking_question', ?)`
  ).run(mission.id, nowIso());

  const after = await listActivityFeed();
  assert.ok(
    !after.items.some(entry => entry.id === `ask:${eventId}`),
    'an acknowledged question leaves the feed'
  );
});

test('the feed reads through workspace membership, not through the rows themselves', async () => {
  const project = await createProject({ name: 'AF Membership' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Members only' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });

  assert.ok(
    (await listActivityFeed()).items.some(entry => entry.missionId === mission.id),
    'a member sees their own workspace'
  );

  // Rather than re-home the rows (their composite workspace FKs make that a
  // schema fight, not a test), drop the membership the feed scopes on. Losing
  // access must hide the work even though every row is still exactly where it was.
  const restore = db
    .prepare(`SELECT id, status FROM workspace_users WHERE workspace_id = ?`)
    .all(mission.workspaceId) as Array<{ id: string; status: string }>;
  db.prepare(`UPDATE workspace_users SET status = 'disabled' WHERE workspace_id = ?`).run(
    mission.workspaceId
  );

  try {
    const feed = await listActivityFeed();
    assert.deepEqual(feed.items, [], 'no membership, no rows');
    assert.equal(feed.counts.objective_run, 0);
  } finally {
    for (const row of restore) {
      db.prepare(`UPDATE workspace_users SET status = ? WHERE id = ?`).run(row.status, row.id);
    }
  }

  assert.ok(
    (await listActivityFeed()).items.some(entry => entry.missionId === mission.id),
    'restoring the membership restores visibility'
  );
});
