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
 * session. Tests seed them directly so the feed can project a delivered mission
 * without going through attach/deliver.
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

test('a mission with an executing objective appears with its project context', async () => {
  const project = await createProject({ name: 'AF Running', color: '#445566' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run me' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);

  assert.ok(item, 'the running mission must be in the feed');
  assert.equal(item.kind, 'mission_run');
  assert.equal(item.projectName, 'AF Running');
  assert.equal(item.projectColor, '#445566');
  assert.equal(item.missionId, mission.id);
  assert.equal(item.objectiveDisplayId, objective.displayId);
});

test('a pending-delivery objective keeps its mission on the feed as live work', async () => {
  const project = await createProject({ name: 'AF Pending' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Re-attached' });
  const objective = mission.objectives[0]!;
  // Written directly rather than through updateObjective: the state is the only
  // thing under test and the REST update path needs an authorized-workspace
  // context this read-path test does not establish.
  db.prepare(`UPDATE objectives SET state = 'pending_delivery' WHERE id = ?`).run(objective.id);

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);

  assert.ok(item && item.kind === 'mission_run');
  assert.equal(item.runState, 'executing');
  assert.deepEqual(item.activeObjectiveIds, [objective.id]);
});

test('a mission with nothing running stays out of the feed', async () => {
  const project = await createProject({ name: 'AF Idle' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Idle' });

  const feed = await listActivityFeed();

  assert.ok(!feed.items.some(entry => entry.id === `mission:${mission.id}`));
});

test('a mission card lists every objective in mission-panel display order', async () => {
  const project = await createProject({ name: 'AF Objectives' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'First' });
  const done = mission.objectives[0]!;
  db.prepare(
    `UPDATE objectives SET state = 'complete', completed_at = '2026-08-01T00:00:00.000Z'
      WHERE id = ?`
  ).run(done.id);

  const running = await createObjective({
    missionId: mission.id,
    instructionText: 'Second',
    state: 'future'
  });
  db.prepare(
    `UPDATE objectives SET state = 'executing', started_at = '2026-08-02T00:00:00.000Z'
      WHERE id = ?`
  ).run(running.id);

  const planned = await createObjective({
    missionId: mission.id,
    instructionText: 'Third',
    state: 'future',
    autoAdvance: true
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);
  assert.ok(item && item.kind === 'mission_run');

  assert.deepEqual(
    item.objectives.map(objective => objective.objectiveId),
    [done.id, running.id, planned.id],
    'completed, then active, then the plan — the mission panel ordering'
  );
  assert.deepEqual(
    item.objectives.map(objective => objective.state),
    ['complete', 'executing', 'future']
  );
  assert.equal(item.objectives[2]!.autoAdvance, true);
});

test('one mission running two objectives is still a single card', async () => {
  const project = await createProject({ name: 'AF Parallel' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Left' });
  const left = mission.objectives[0]!;
  const right = await createObjective({
    missionId: mission.id,
    instructionText: 'Right',
    state: 'future'
  });
  db.prepare(`UPDATE objectives SET state = 'executing' WHERE id IN (?, ?)`).run(left.id, right.id);

  const feed = await listActivityFeed();
  const cards = feed.items.filter(entry => entry.missionId === mission.id);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.kind === 'mission_run' && cards[0]!.activeObjectiveIds.length, 2);
});

test('a launching objective makes its mission lead the feed, above executing missions', async () => {
  const project = await createProject({ name: 'AF Order' });
  const executing = await createMission({ projectId: project.id, firstObjective: 'Executing' });
  await updateObjective(executing.objectives[0]!.id, { state: 'executing' });

  const launching = await createMission({ projectId: project.id, firstObjective: 'Launching' });
  db.prepare(`UPDATE objectives SET state = 'launching' WHERE id = ?`).run(
    launching.objectives[0]!.id
  );

  const feed = await listActivityFeed();
  const missionCards = feed.items.filter(entry => entry.kind === 'mission_run');
  const launchingIndex = missionCards.findIndex(entry => entry.missionId === launching.id);
  const executingIndex = missionCards.findIndex(entry => entry.missionId === executing.id);

  assert.ok(launchingIndex >= 0 && executingIndex >= 0);
  assert.ok(launchingIndex < executingIndex, 'launching missions lead');
  assert.equal(
    missionCards[launchingIndex]!.kind === 'mission_run' && missionCards[launchingIndex]!.runState,
    'launching'
  );
});

test('a recent delivered mission appears as a mission card, not a delivery card', async () => {
  const project = await createProject({ name: 'AF Deliveries' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Deliver' });
  const objective = mission.objectives[0]!;
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Shipped it',
    deliveredAt: threeDaysAgo
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.missionId === mission.id);

  assert.ok(!feed.items.some(entry => (entry.kind as string) === 'delivery'));
  assert.ok(!('delivery' in feed.counts));
  assert.ok(item && item.kind === 'mission_delivered');
  assert.equal(item.runState, 'delivered');
  assert.equal(item.latestEventSummary, 'Shipped it');
  assert.deepEqual(item.activeObjectiveIds, []);
});

test('a delivery older than two weeks stays off the first page', async () => {
  const project = await createProject({ name: 'AF Aged Delivery' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Old ship' });
  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: mission.objectives[0]!.id,
    summary: 'Shipped last month',
    deliveredAt: twentyDaysAgo
  });

  const feed = await listActivityFeed();
  assert.ok(
    !feed.items.some(entry => entry.missionId === mission.id),
    'first page is only the last two weeks of deliveries'
  );
  assert.ok(feed.nextBefore, 'older delivered missions remain reachable by scrolling');
});

test('scrolling before loads the next two weeks of delivered missions', async () => {
  const project = await createProject({ name: 'AF Scroll Delivery' });
  const recent = await createMission({ projectId: project.id, firstObjective: 'Recent ship' });
  const older = await createMission({ projectId: project.id, firstObjective: 'Older ship' });
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  seedDelivery({
    workspaceId: recent.workspaceId,
    projectId: project.id,
    missionId: recent.id,
    objectiveId: recent.objectives[0]!.id,
    summary: 'This week',
    deliveredAt: threeDaysAgo
  });
  seedDelivery({
    workspaceId: older.workspaceId,
    projectId: project.id,
    missionId: older.id,
    objectiveId: older.objectives[0]!.id,
    summary: 'Three weeks ago',
    deliveredAt: twentyDaysAgo
  });

  const first = await listActivityFeed();
  assert.ok(first.items.some(entry => entry.missionId === recent.id));
  assert.ok(!first.items.some(entry => entry.missionId === older.id));
  assert.ok(first.nextBefore);

  const second = await listActivityFeed({ before: first.nextBefore });
  assert.ok(
    second.items.some(entry => entry.missionId === older.id),
    'the next two-week window includes the older delivery'
  );
  assert.ok(
    !second.items.some(entry => entry.kind === 'mission_run' || entry.kind === 'blocking_question'),
    'scrolled pages are delivered missions only'
  );
});

test('a live mission with a delivery is one running card, not also a delivered card', async () => {
  const project = await createProject({ name: 'AF Live And Delivered' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Still going' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Partial ship',
    deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  });

  const feed = await listActivityFeed();
  const cards = feed.items.filter(entry => entry.missionId === mission.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.kind, 'mission_run');
  assert.equal(cards[0]!.kind === 'mission_run' && cards[0]!.runState, 'executing');
});

test('the most recent delivery decides which two-week window a mission belongs to', async () => {
  const project = await createProject({ name: 'AF Latest Delivery' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Follow-up' });
  const objective = mission.objectives[0]!;
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'First ship',
    deliveredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
  });
  seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    summary: 'Follow-up ship',
    deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  });

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.missionId === mission.id);
  assert.ok(item && item.kind === 'mission_delivered');
  assert.equal(item.latestEventSummary, 'Follow-up ship');
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
    assert.equal(feed.counts.mission_run, 0);
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
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);
  assert.ok(item && item.kind === 'mission_run');
  assert.equal(item.agentIdentifier, 'cursor');
  assert.equal(item.modelIdentifier, 'cursor-grok-4.6');
});

test('a mission card carries the mission creation provenance', async () => {
  const project = await createProject({ name: 'AF Provenance' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Authored' });
  const objective = mission.objectives[0]!;
  await updateObjective(objective.id, { state: 'executing' });
  db.prepare(
    `UPDATE missions SET created_by_kind = 'agent', created_by_agent = 'cursor' WHERE id = ?`
  ).run(mission.id);

  const feed = await listActivityFeed();
  const item = feed.items.find(entry => entry.id === `mission:${mission.id}`);
  assert.ok(item && item.kind === 'mission_run');
  assert.equal(item.createdByKind, 'agent');
  assert.equal(item.createdByAgent, 'cursor');
});
