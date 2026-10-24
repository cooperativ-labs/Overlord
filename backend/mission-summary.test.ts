import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mission-summary-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const { seedDelivery: seedDeliveryRow } = await import('./test-helpers.ts');
const { createObjective, createProject, createMission } = await import('./repository.ts');
const { getMissionSummary, markMissionSummarySeen } = await import('./mission-summary.ts');
const { resolveDeferredWork } = await import('./deferred-work-resolutions.ts');
const { buildDeliveryReport } = await import('../packages/core/service/delivery-report.ts');

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function deferred(title: string) {
  return {
    title,
    change: `${title} in the exporter.`,
    location: 'backend/exporter.ts',
    doneWhen: `${title} is visible.`
  };
}

function seedDelivery({
  mission,
  objectiveId,
  deliveredAt,
  humanActions = [],
  knownRisks = [],
  deferredWork = []
}: {
  mission: { id: string; workspaceId: string; projectId: string };
  objectiveId: string;
  deliveredAt: string;
  humanActions?: Array<{ action: string; blocking?: boolean; category?: 'other' }>;
  knownRisks?: string[];
  deferredWork?: ReturnType<typeof deferred>[];
}) {
  const summary = `Delivered at ${deliveredAt}.`;
  const report = buildDeliveryReport({
    summary,
    deliveryReport: {
      schemaVersion: 1,
      agentReport: { humanActions, knownRisks, deferredWork }
    }
  });
  const id = seedDeliveryRow(db, {
    id: newId('delivery'),
    workspaceId: mission.workspaceId,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId,
    summary,
    payload: { deliveryReport: report },
    deliveredAt
  });
  return { id, report };
}

async function seedMission(name: string) {
  const project = await createProject({ name, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  return { project, mission, objective: mission.objectives[0]! };
}

test('an ineligible mission returns an all-null envelope and rejects seen writes', async () => {
  const { mission, objective } = await seedMission('Summary Old');
  db.prepare(`UPDATE missions SET summary_enabled = 0 WHERE id = ?`).run(mission.id);
  seedDelivery({
    mission: { id: mission.id, workspaceId: mission.workspaceId, projectId: mission.projectId },
    objectiveId: objective.id,
    deliveredAt: '2026-10-20T10:00:00.000Z'
  });

  assert.deepEqual(await getMissionSummary(mission.id), {
    eligible: false,
    summary: null,
    evidence: null,
    watermark: null,
    seenAt: null
  });
  await assert.rejects(
    markMissionSummarySeen(mission.id, { watermark: '2026-10-20T10:00:00.000Z' }),
    (error: { status?: number; code?: string }) =>
      error.status === 400 && error.code === 'invalid_input'
  );
});

test('a new mission is eligible and returns evidence before its first summary row', async () => {
  const { mission, objective } = await seedMission('Summary New');
  const empty = await getMissionSummary(mission.displayId);
  assert.equal(empty.eligible, true);
  assert.equal(empty.summary, null);
  assert.equal(empty.watermark, null);
  assert.deepEqual(empty.evidence, {
    actions: [],
    sources: [],
    totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
    truncated: { actions: false, sources: false }
  });

  const delivered = seedDelivery({
    mission: { id: mission.id, workspaceId: mission.workspaceId, projectId: mission.projectId },
    objectiveId: objective.id,
    deliveredAt: '2026-10-21T09:00:00.000Z',
    humanActions: [{ action: 'Add GEMINI_API_KEY to the backend service.', category: 'other' }]
  });
  const response = await getMissionSummary(mission.id);
  assert.equal(response.eligible, true);
  assert.equal(response.summary, null);
  assert.equal(response.seenAt, null);
  assert.equal(response.watermark, '2026-10-21T09:00:00.000Z');
  assert.deepEqual(response.evidence?.sources, [
    { objectiveId: objective.id, deliveryId: delivered.id, deliveredAt: '2026-10-21T09:00:00.000Z' }
  ]);
  assert.deepEqual(response.evidence?.actions, [
    {
      action: 'Add GEMINI_API_KEY to the backend service.',
      category: 'other',
      source: 'agent',
      deliveryId: delivered.id,
      objectiveId: objective.id,
      actionId: 'human-action-1',
      deliveredAt: '2026-10-21T09:00:00.000Z'
    }
  ]);
});

test('the envelope projects current-run evidence, risks, suggestions, and the seen watermark', async () => {
  const { project, mission, objective: first } = await seedMission('Summary Shape');
  const second = await createObjective({
    missionId: mission.id,
    instructionText: 'Second objective'
  });
  const third = await createObjective({
    missionId: mission.id,
    instructionText: 'Reopened objective'
  });
  const scope = { id: mission.id, workspaceId: mission.workspaceId, projectId: project.id };

  // Objective one: an older delivery superseded by a newer one.
  const firstOld = seedDelivery({
    mission: scope,
    objectiveId: first.id,
    deliveredAt: '2026-10-21T08:00:00.000Z',
    humanActions: [{ action: 'Superseded action', category: 'other' }],
    knownRisks: ['Old risk'],
    deferredWork: [deferred('Keep the old suggestion'), deferred('Dismiss me')]
  });
  const firstNew = seedDelivery({
    mission: scope,
    objectiveId: first.id,
    deliveredAt: '2026-10-21T10:00:00.000Z',
    humanActions: [
      { action: 'Run the backfill script on production.', category: 'other' },
      { action: 'Rotate the webhook secret.', blocking: true, category: 'other' }
    ],
    deferredWork: [deferred('Promote me')]
  });
  // Objective two: one delivery.
  const secondOnly = seedDelivery({
    mission: scope,
    objectiveId: second.id,
    deliveredAt: '2026-10-21T09:00:00.000Z',
    humanActions: [{ action: 'Enable the flag in staging.', category: 'other' }]
  });
  // Objective three: delivered, then reopened, so its delivery is no longer current-run.
  const reopenedDelivery = seedDelivery({
    mission: scope,
    objectiveId: third.id,
    deliveredAt: '2026-10-21T07:00:00.000Z',
    humanActions: [{ action: 'Stale action', category: 'other' }],
    knownRisks: ['Stale risk'],
    deferredWork: [deferred('Stale suggestion')]
  });
  db.prepare(`UPDATE objectives SET reopened_at = ? WHERE id = ?`).run(
    '2026-10-21T11:00:00.000Z',
    third.id
  );

  const keepId = firstOld.report.agentReport.deferredWork[0]!.id;
  const dismissId = firstOld.report.agentReport.deferredWork[1]!.id;
  const promoteId = firstNew.report.agentReport.deferredWork[0]!.id;
  const staleId = reopenedDelivery.report.agentReport.deferredWork[0]!.id;
  await resolveDeferredWork(firstOld.id, dismissId, { status: 'dismissed' });
  await resolveDeferredWork(firstNew.id, promoteId, {
    status: 'done',
    outcome: 'mission_created',
    outcomeRef: 'coo:99'
  });

  db.prepare(
    // The resolutions above already created the pending shell; replace it.
    `INSERT OR REPLACE INTO mission_summaries
       (mission_id, workspace_id, project_id, revision, requested_generation, completed_generation,
        status, headline, summary_markdown, risks_json, suggestions_json, source_delivery_id,
        generated_by, generated_at, model, created_at, updated_at)
     VALUES (?, ?, ?, 4, 3, 2, 'pending', 'Backfill is waiting on you.', 'Objective one shipped.',
             ?, ?, ?, 'gemini', '2026-10-21T10:01:00.000Z', 'gemini-test',
             '2026-10-21T08:01:00.000Z', '2026-10-21T10:02:00.000Z')`
  ).run(
    mission.id,
    mission.workspaceId,
    project.id,
    JSON.stringify([
      { deliveryId: firstOld.id, objectiveId: first.id, index: 0, text: 'Old risk, rewritten.' },
      { deliveryId: reopenedDelivery.id, objectiveId: third.id, index: 0, text: 'Stale risk' }
    ]),
    JSON.stringify([
      { deliveryId: firstNew.id, objectiveId: first.id, actionId: promoteId },
      { deliveryId: firstOld.id, objectiveId: first.id, actionId: keepId },
      { deliveryId: firstOld.id, objectiveId: first.id, actionId: dismissId },
      { deliveryId: reopenedDelivery.id, objectiveId: third.id, actionId: staleId },
      { deliveryId: firstOld.id, objectiveId: first.id, actionId: 'deferred-work-9-missing' }
    ]),
    firstNew.id
  );

  const countSummaryChanges = () =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type = 'mission_summary'`)
        .get() as { n: number }
    ).n;
  // The two resolutions above each triggered a recompose.
  const changesBeforeReads = countSummaryChanges();
  assert.equal(changesBeforeReads, 2);

  const response = await getMissionSummary(mission.id);
  assert.equal(response.eligible, true);
  assert.equal(response.watermark, '2026-10-21T10:00:00.000Z');

  const summary = response.summary!;
  assert.equal(summary.missionId, mission.id);
  assert.equal(summary.revision, 4);
  assert.equal(summary.status, 'pending');
  assert.equal(summary.headline, 'Backfill is waiting on you.');
  assert.equal(summary.summary, 'Objective one shipped.');
  assert.equal(summary.sourceDeliveryId, firstNew.id);
  assert.equal(summary.generatedBy, 'gemini');
  assert.equal(summary.generatedAt, '2026-10-21T10:01:00.000Z');
  assert.equal(summary.model, 'gemini-test');
  assert.deepEqual(summary.risks, [
    {
      deliveryId: firstOld.id,
      objectiveId: first.id,
      deliveredAt: '2026-10-21T08:00:00.000Z',
      text: 'Old risk, rewritten.'
    }
  ]);
  assert.equal(summary.suggestions.length, 2);
  const [promoted, open] = summary.suggestions;
  assert.equal(promoted!.state, 'resolved');
  assert.equal(promoted!.title, 'Promote me');
  assert.equal(promoted!.resolution?.outcomeRef, 'coo:99');
  assert.equal('change' in promoted!, false, 'resolved suggestions omit their details');
  assert.deepEqual(open, {
    deliveryId: firstOld.id,
    objectiveId: first.id,
    deliveredAt: '2026-10-21T08:00:00.000Z',
    actionId: keepId,
    title: 'Keep the old suggestion',
    state: 'open',
    change: 'Keep the old suggestion in the exporter.',
    location: 'backend/exporter.ts',
    doneWhen: 'Keep the old suggestion is visible.',
    resolution: null
  });

  const evidence = response.evidence!;
  assert.deepEqual(
    evidence.sources.map(source => source.deliveryId),
    [firstNew.id, secondOnly.id],
    'one current-run source per objective, newest first; the reopened objective has none'
  );
  assert.deepEqual(
    evidence.actions.map(action => [action.action, action.deliveryId]),
    [
      ['Rotate the webhook secret.', firstNew.id],
      ['Run the backfill script on production.', firstNew.id],
      ['Enable the flag in staging.', secondOnly.id]
    ]
  );
  assert.deepEqual(evidence.totals, { actions: 3, sources: 2, currentRunDeliveries: 3 });
  assert.deepEqual(evidence.truncated, { actions: false, sources: false });

  // Seen: a watermark newer than any evidence is rejected; valid writes never move back.
  await assert.rejects(
    markMissionSummarySeen(mission.id, { watermark: '2026-10-21T12:00:00.000Z' }),
    (error: { code?: string }) => error.code === 'invalid_input'
  );
  await assert.rejects(
    markMissionSummarySeen(mission.id, { watermark: 'yesterday' }),
    (error: { code?: string }) => error.code === 'invalid_input'
  );
  assert.deepEqual(await markMissionSummarySeen(mission.id, { watermark: response.watermark }), {
    seenAt: '2026-10-21T10:00:00.000Z'
  });
  assert.deepEqual(
    await markMissionSummarySeen(mission.id, { watermark: '2026-10-21T09:00:00.000Z' }),
    { seenAt: '2026-10-21T10:00:00.000Z' }
  );
  assert.equal((await getMissionSummary(mission.id)).seenAt, '2026-10-21T10:00:00.000Z');
  assert.equal(
    countSummaryChanges(),
    changesBeforeReads,
    'reads and seen writes record no entity change'
  );
});
