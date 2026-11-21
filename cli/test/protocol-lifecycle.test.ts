import { createMissionWithObjectives } from '@overlord/core/service/missions';
import { addProjectResource, createProject } from '@overlord/core/service/projects';
import {
  askQuestion,
  attachSession,
  closeAgentMissionItems,
  deliverSession,
  recordHookEvent,
  recordWork,
  updateSession
} from '@overlord/core/service/protocol';
import { createIsolatedCheckout } from '@overlord/core/service/test-checkout';
import {
  listSqliteMigrationFiles,
  migrateDatabase,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeededCliContext } from './support/seeded-context.ts';

test('protocol lifecycle: attach → update → deliver', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });

  const project = await createProject({ ctx, name: 'Test Project' });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: createIsolatedCheckout('ovld-lifecycle-'),
    isPrimary: true
  });

  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Implement feature X' }]
  });
  assert.equal(mission.statusType, 'draft');

  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const attached = await attachSession({
    ctx,
    missionId: mission.id,
    agentIdentifier: 'test-agent'
  });
  assert.ok(attached.sessionKey);
  assert.equal(attached.mission.statusType, 'execute');
  assert.equal(attached.objective.state, 'executing');
  assert.equal(attached.objective.objective, 'Implement feature X');
  assert.match(attached.agentInstructions, /objective\.objective/);
  assert.match(attached.agentInstructions, /Implement feature X/);
  assert.match(attached.agentInstructions, /immediately begin executing it/i);
  assert.match(attached.agentInstructions, /do not wait for more instructions/i);

  const sessionRow = (await ctx.db.get(
    `SELECT external_session_id FROM agent_sessions WHERE id = ?`,
    [attached.session.id]
  )) as { external_session_id: string | null };
  assert.equal(sessionRow.external_session_id, null);

  await updateSession({
    ctx,
    missionId: mission.displayId,
    sessionKey: attached.sessionKey,
    summary: 'Made progress on feature X'
  });

  const delivered = await deliverSession({
    ctx,
    missionId: mission.displayId,
    sessionKey: attached.sessionKey,
    summary: 'Completed feature X implementation'
  });
  assert.ok(delivered.deliveryId);

  const missionRow = (await ctx.db.get(`SELECT status_type FROM missions WHERE id = ?`, [
    mission.id
  ])) as { status_type: string };
  assert.equal(missionRow.status_type, 'review');

  const objectiveRow = (await ctx.db.get(`SELECT state FROM objectives WHERE id = ?`, [
    objectives[0]?.id
  ])) as { state: string };
  assert.equal(objectiveRow.state, 'complete');

  await db.close();
});

test('attach records and clears native external session id', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });

  const project = await createProject({ ctx, name: 'External Session Test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Track native session id' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const attached = await attachSession({
    ctx,
    missionId: mission.id,
    agentIdentifier: 'claude',
    externalSessionId: 'claude-native-123'
  });

  let sessionRow = (await ctx.db.get(
    `SELECT external_session_id FROM agent_sessions WHERE id = ?`,
    [attached.session.id]
  )) as { external_session_id: string | null };
  assert.equal(sessionRow.external_session_id, 'claude-native-123');

  await attachSession({
    ctx,
    missionId: mission.id,
    existingSessionKey: attached.sessionKey,
    externalSessionId: null
  });

  sessionRow = (await ctx.db.get(`SELECT external_session_id FROM agent_sessions WHERE id = ?`, [
    attached.session.id
  ])) as { external_session_id: string | null };
  assert.equal(sessionRow.external_session_id, null);

  await db.close();
});

test('hook-event persists external session id on the active agent session', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });

  const project = await createProject({ ctx, name: 'Hook external session test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Capture hook session id' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const attached = await attachSession({
    ctx,
    missionId: mission.id,
    agentIdentifier: 'cursor'
  });

  await recordHookEvent({
    ctx,
    missionId: mission.displayId,
    hookType: 'UserPromptSubmit',
    prompt: 'Follow-up from the harness',
    sessionKey: attached.sessionKey,
    externalSessionId: 'cursor-conversation-abc',
    turnIndex: '1'
  });

  const sessionRow = (await ctx.db.get(
    `SELECT external_session_id FROM agent_sessions WHERE id = ?`,
    [attached.session.id]
  )) as { external_session_id: string | null };
  assert.equal(sessionRow.external_session_id, 'cursor-conversation-abc');

  await db.close();
});

test('hook-event Stop reports delivery status read-only for the bound session', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });

  const project = await createProject({ ctx, name: 'Hook stop status test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Remind before stopping' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
  const attached = await attachSession({ ctx, missionId: mission.id, agentIdentifier: 'claude' });
  const countEvents = async () =>
    (
      (await ctx.db.get(`SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ?`, [
        mission.id
      ])) as { n: number }
    ).n;
  const before = await countEvents();

  const stop = (sessionKey: string | null) =>
    recordHookEvent({
      ctx,
      missionId: mission.displayId,
      hookType: 'Stop',
      prompt: '',
      sessionKey
    });

  const executing = await stop(attached.sessionKey);
  assert.equal(executing.eventId, null);
  assert.equal(executing.sessionId, attached.session.id);
  assert.equal(executing.deliveryStatus?.needed, true);
  assert.match(String(executing.deliveryStatus?.reason), /still executing/);
  assert.equal(await countEvents(), before, 'Stop records no mission event');

  // No session key, or an unknown one, never selects a session.
  assert.deepEqual((await stop(null)).deliveryStatus, { needed: false, reason: null });
  assert.deepEqual((await stop('sess_unknown')).deliveryStatus, { needed: false, reason: null });

  // A session waiting on a person is not reminded.
  await askQuestion({
    ctx,
    missionId: mission.displayId,
    sessionKey: attached.sessionKey,
    question: 'Which branch should this land on?'
  });
  assert.deepEqual((await stop(attached.sessionKey)).deliveryStatus, {
    needed: false,
    reason: null
  });

  await db.close();
});

test('attach response includes attach-response-v4 fields', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });

  const project = await createProject({ ctx, name: 'Shape Test' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Verify attach shape' }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);

  const attached = await attachSession({ ctx, missionId: mission.id });
  assert.equal(attached.mission.statusType, 'execute');
  for (const field of [
    'directives',
    'artifacts',
    'attachments',
    'objectives',
    'session',
    'sharedState',
    'agentInstructions'
  ] as const) {
    assert.ok(field in attached, `missing ${field}`);
  }
  for (const field of ['history', 'previousObjectives', 'futureObjectives']) {
    assert.ok(!(field in attached), `retired field ${field}`);
  }
  assert.ok(!('promptContext' in attached), 'promptContext field should be removed in v3');
  assert.ok(attached.session.sessionKey);
  assert.ok(attached.agentInstructions.includes('Required Protocol Workflow'));

  await db.close();
});

test('migrateDatabase applies every discovered SQLite migration without resetting data', () => {
  const db = openInMemoryDatabase();
  const now = '2026-01-01T00:00:00.000Z';

  db.prepare(
    `INSERT INTO organizations (id, name, settings_json, created_at, updated_at, revision)
     VALUES (?, ?, '{}', ?, ?, 1)`
  ).run('org-migration-smoke', 'Migration smoke org', now, now);

  db.prepare(
    `INSERT INTO workspaces (
      id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision
    ) VALUES (
      'workspace-migration-smoke', ?, 'migration-smoke', 'Migration smoke test', 'local', '{}',
      ?, ?, 1
    )`
  ).run('org-migration-smoke', now, now);

  migrateDatabase(db);

  const applied = db
    .prepare(
      `SELECT version
       FROM schema_migrations
       WHERE adapter = 'sqlite'
       ORDER BY version`
    )
    .all() as Array<{ version: string }>;
  const workspace = db
    .prepare(`SELECT name FROM workspaces WHERE id = 'workspace-migration-smoke'`)
    .get() as { name: string } | undefined;

  assert.deepEqual(
    applied.map(row => row.version),
    listSqliteMigrationFiles().map(fileName => fileName.split('_', 1)[0])
  );
  assert.equal(workspace?.name, 'Migration smoke test');
  db.close();
});

test('protocol lifecycle: attach baseline → deliver with missionSummary → next attach', async () => {
  const { db, ctx } = await createSeededCliContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: 'Mission Summary Lifecycle' });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Build the export' }, { instructions: 'Document the export' }]
  });
  for (const objective of objectives) {
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objective.id]);
  }

  const first = await attachSession({ ctx, missionId: mission.id, objectiveId: objectives[0]!.id });
  assert.equal(first.missionSummary?.contentRevision, 0);
  assert.match(first.agentInstructions, /## Mission summary/);

  const delivered = await deliverSession({
    ctx,
    missionId: mission.displayId,
    sessionKey: first.sessionKey,
    summary: 'Built the export.',
    missionSummary: {
      baseContentRevision: first.missionSummary!.contentRevision,
      baseEvidenceRevision: first.missionSummary!.evidenceRevision,
      headline: 'The export is built and tested.',
      summary: 'The export writes CSV files. It is tested and not deployed.'
    }
  });
  assert.equal(delivered.missionSummary?.narrativeWritten, true);
  assert.equal(delivered.missionSummary?.contentRevision, 1);

  const second = await attachSession({
    ctx,
    missionId: mission.id,
    objectiveId: objectives[1]!.id
  });
  assert.equal(second.missionSummary?.contentRevision, 1);
  assert.equal(second.missionSummary?.headline, 'The export is built and tested.');
  assert.equal(second.missionSummary?.author, 'agent');

  await db.close();
});

test('protocol lifecycle links a verified foreign close through the public core exports', async () => {
  const { ctx, db } = await createSeededCliContext({ source: 'protocol' });
  const project = await createProject({ ctx, name: 'Cross-mission lifecycle' });
  const target = await recordWork({
    ctx,
    projectId: project.id,
    objective: 'Report risk',
    summary: 'Verified risk.',
    payloadJson: {
      deliveryReport: { schemaVersion: 1, agentReport: { knownRisks: ['Missing retry guard.'] } }
    }
  });
  const source = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: 'Add retry guard' }]
  });
  const attached = await attachSession({
    ctx,
    missionId: source.mission.id,
    objectiveId: source.objectives[0]!.id
  });
  const item = (await db.get<{ id: string }>('SELECT id FROM mission_items WHERE mission_id = ?', [
    target.mission.id
  ]))!;
  const closed = await closeAgentMissionItems({
    ctx,
    missionId: source.mission.id,
    sessionKey: attached.sessionKey,
    closeItems: [{ id: item.id, status: 'dismissed', reason: 'The retry guard is verified.' }]
  });
  assert.deepEqual(closed.targets, [{ missionDisplayId: target.mission.displayId, closed: 1 }]);
  const request = {
    ctx,
    missionId: source.mission.id,
    sessionKey: attached.sessionKey,
    summary: 'Verified guard.',
    operationId: 'op-cli-cross-mission-001'
  };
  const accepted = await deliverSession(request);
  assert.equal((await deliverSession(request)).replayed, true);
  const row = await db.get<{ resolved_by_delivery_id: string; resolved_by_mission_id: string }>(
    'SELECT resolved_by_delivery_id, resolved_by_mission_id FROM mission_items WHERE id = ?',
    [item.id]
  );
  assert.equal(row!.resolved_by_delivery_id, accepted.deliveryId);
  assert.equal(row!.resolved_by_mission_id, source.mission.id);
});
