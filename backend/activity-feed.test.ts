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

test('a pending-delivery objective appears in the feed as live work', async () => {
  const project = await createProject({ name: 'AF Pending' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Re-attached' });
  const objective = mission.objectives[0]!;
  // Written directly rather than through updateObjective: the state is the only
  // thing under test and the REST update path needs an authorized-workspace
  // context this read-path test does not establish.
  db.prepare(`UPDATE objectives SET state = 'pending_delivery' WHERE id = ?`).run(objective.id);

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `run:${objective.id}`);

  assert.ok(item, 'the pending-delivery objective must be in the feed');
  assert.equal(item.kind, 'objective_run');
  assert.ok(item.kind === 'objective_run' && item.state === 'pending_delivery');
});

test('objectives that are not launching, executing, or pending delivery stay out of the feed', async () => {
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
  const askedAt = nowIso();
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

test('blocking questions older than three days stay out of the feed', async () => {
  const project = await createProject({ name: 'AF Ask Aged' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Old ask' });
  const objective = mission.objectives[0]!;
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const agedId = seedAskEvent({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Stale question from last week?',
    createdAt: fourDaysAgo
  });
  const recentId = seedAskEvent({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Still waiting on this one?',
    createdAt: twoDaysAgo
  });

  const feed = await listActivityFeed();
  assert.ok(
    !feed.items.some(entry => entry.id === `ask:${agedId}`),
    'asks older than three days are excluded'
  );
  assert.ok(
    feed.items.some(entry => entry.id === `ask:${recentId}`),
    'asks within three days still surface'
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

function seedAgentSession({
  workspaceId,
  projectId,
  missionId,
  objectiveId,
  agentIdentifier,
  modelIdentifier,
  startedAt
}: {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  agentIdentifier: string;
  modelIdentifier: string | null;
  startedAt: string;
}): string {
  const id = newId('session');
  db.prepare(
    `INSERT INTO agent_sessions
       (id, workspace_id, project_id, mission_id, objective_id, session_key_hash,
        session_key_prefix, agent_identifier, model_identifier, connection_method,
        phase, delivery_state, started_at, created_at, updated_at, revision, metadata_json)
     VALUES (?, ?, ?, ?, ?, 'hash', 'sess_', ?, ?, 'cli', 'execute', 'not_delivered',
             ?, ?, ?, 1, '{}')`
  ).run(
    id,
    workspaceId,
    projectId,
    missionId,
    objectiveId,
    agentIdentifier,
    modelIdentifier,
    startedAt,
    startedAt,
    startedAt
  );
  return id;
}

test('session agent sentinel unknown falls back to the objective assigned agent', async () => {
  const project = await createProject({ name: 'AF Unknown Agent' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing', assignedAgent: 'cursor' });
  seedAgentSession({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    agentIdentifier: 'unknown',
    modelIdentifier: 'cursor-grok-4.6',
    startedAt: '2026-08-18T05:00:00.000Z'
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `run:${objective.id}`);
  assert.ok(item && item.kind === 'objective_run');
  assert.equal(item.agentIdentifier, 'cursor');
  assert.equal(item.modelIdentifier, 'cursor-grok-4.6');
});

test('feed items expose objective creation provenance', async () => {
  const project = await createProject({ name: 'AF Provenance' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Authored' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });
  db.prepare(
    `UPDATE objectives SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`
  ).run(objective.id);

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `run:${objective.id}`);
  assert.ok(item && item.kind === 'objective_run');
  assert.equal(item.createdByKind, 'agent');
  assert.equal(item.createdByAgent, 'cursor');
});
