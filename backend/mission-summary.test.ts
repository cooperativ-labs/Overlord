import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mission-summary-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, requireDatabaseClient } = await import('./db.ts');
const { seedDelivery: seedDeliveryRow } = await import('./test-helpers.ts');
const { createObjective, createProject, createMission } = await import('./repository.ts');
const { getMissionSummary, markMissionSummarySeen } = await import('./mission-summary.ts');
const { resolveDeferredWork } = await import('./deferred-work-resolutions.ts');
const { buildDeliveryReport } = await import('../packages/core/service/delivery-report.ts');

/**
 * Writes a row as it existed before migration 20261118140000 (ADR 0076):
 * model-written prose that the agent-only fence would now drop. The fence
 * triggers are removed for this write only and restored from their own SQL.
 */
function writeHistoricalSummaryRow(sql: string, ...params: unknown[]): void {
  const triggers = db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'mission_summaries'`
    )
    .all() as Array<{ name: string; sql: string }>;
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
  try {
    db.prepare(sql).run(...params);
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

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
    narrative: null,
    narrativeWatermark: null,
    itemsWatermark: null,
    itemsTruncated: false,
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
      id: response.evidence!.actions[0]!.id,
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
  seedDelivery({
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

  const { applyMissionItemSupersedeRules } =
    await import('../packages/core/service/mission-items.ts');
  await applyMissionItemSupersedeRules(requireDatabaseClient(), {
    objectiveId: third.id,
    attribution: { actorWorkspaceUserId: null, source: 'protocol' }
  });

  const keepId = firstOld.report.agentReport.deferredWork[0]!.id;
  const dismissId = firstOld.report.agentReport.deferredWork[1]!.id;
  const promoteId = firstNew.report.agentReport.deferredWork[0]!.id;
  await resolveDeferredWork(firstOld.id, dismissId, { status: 'dismissed' });
  await resolveDeferredWork(firstNew.id, promoteId, {
    status: 'done',
    outcome: 'mission_created',
    outcomeRef: 'coo:99'
  });

  // A legacy model-written row as the migration left it: composed, with its
  // last change time and no coverage basis.
  writeHistoricalSummaryRow(
    `INSERT INTO mission_summaries
       (mission_id, workspace_id, project_id, revision, requested_generation, completed_generation,
        status, headline, summary_markdown, source_delivery_id,
        generated_by, generated_at, model, created_at, updated_at, narrative_changed_at)
     VALUES (?, ?, ?, 4, 3, 3, 'composed', 'Backfill is waiting on you.', 'Objective one shipped.',
             ?, 'gemini', '2026-10-21T10:01:00.000Z', 'gemini-test',
             '2026-10-21T08:01:00.000Z', '2026-10-21T10:02:00.000Z', '2026-10-21T10:01:00.000Z')`,
    mission.id,
    mission.workspaceId,
    project.id,
    firstNew.id
  );

  const countSummaryChanges = () =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type = 'mission_summary'`)
        .get() as { n: number }
    ).n;
  // Item decisions never touch the narrative (ADR 0076): no summary change.
  const changesBeforeReads = countSummaryChanges();
  assert.equal(changesBeforeReads, 0);

  const response = await getMissionSummary(mission.id);
  assert.equal(response.eligible, true);
  assert.equal(response.watermark, '2026-10-21T10:00:00.000Z');

  const summary = response.summary!;
  assert.equal(summary.missionId, mission.id);
  assert.equal(summary.revision, 4);
  assert.equal(summary.status, 'composed');
  assert.deepEqual(response.narrative, {
    state: 'legacy',
    evidenceRevision: 0,
    publishedEvidenceRevision: null,
    deliveryId: null,
    objectiveId: null,
    publishedAt: null,
    changedAt: '2026-10-21T10:01:00.000Z',
    outstandingDeliveryId: null
  });
  assert.equal(response.narrativeWatermark, '2026-10-21T10:01:00.000Z');
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
      id: summary.risks[0]!.id,
      text: 'Old risk'
    }
  ]);
  assert.equal(summary.suggestions.length, 1);
  const [open] = summary.suggestions;
  assert.deepEqual(
    summary.closedItems.map(item => [item.text, item.status]),
    [
      ['Promote me', 'done'],
      ['Dismiss me', 'dismissed']
    ]
  );
  assert.equal(summary.contentRevision, 0);
  assert.deepEqual(summary.author, { kind: 'gemini', objectiveId: null, deliveryId: null });
  assert.deepEqual(open, {
    id: open!.id,
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
  // The retained narrative change bounds the marker too, and nothing later is accepted.
  await assert.rejects(
    markMissionSummarySeen(mission.id, { watermark: '2026-10-21T10:01:00.001Z' }),
    (error: { code?: string }) => error.code === 'invalid_input'
  );
  assert.deepEqual(
    await markMissionSummarySeen(mission.id, { watermark: response.narrativeWatermark! }),
    { seenAt: '2026-10-21T10:01:00.000Z' }
  );
  assert.equal(
    countSummaryChanges(),
    changesBeforeReads,
    'reads and seen writes record no entity change'
  );
});

test('item closures update risks and actions immediately and resolved history is bounded newest first', async () => {
  const { mission, objective } = await seedMission('Live closures');
  const delivered = seedDelivery({
    mission: { id: mission.id, workspaceId: mission.workspaceId, projectId: mission.projectId },
    objectiveId: objective.id,
    deliveredAt: '2026-10-22T10:00:00.000Z',
    humanActions: [{ action: 'Deploy.', category: 'other' }],
    knownRisks: ['Still open.']
  });
  db.prepare(
    `INSERT INTO mission_summaries (mission_id, workspace_id, project_id, status, generated_by, headline,
    created_at, updated_at, content_revision, narrative_delivery_id, narrative_objective_id) VALUES (?, ?, ?, 'composed', 'agent', 'Verified.', ?, ?, 3, ?, ?)`
  ).run(
    mission.id,
    mission.workspaceId,
    mission.projectId,
    '2026-10-22T11:00:00.000Z',
    '2026-10-22T11:00:00.000Z',
    delivered.id,
    objective.id
  );
  const { resolveMissionItem } = await import('./mission-item-resolutions.ts');
  const before = await getMissionSummary(mission.id);
  await resolveMissionItem(before.summary!.risks[0]!.id, { status: 'done', reason: 'Fixed.' });
  await resolveMissionItem(before.evidence!.actions[0]!.id, { status: 'dismissed' });
  const after = await getMissionSummary(mission.id);
  assert.deepEqual(after.summary!.risks, []);
  assert.deepEqual(after.evidence!.actions, []);
  assert.deepEqual(after.summary!.author, {
    kind: 'agent',
    objectiveId: objective.id,
    deliveryId: delivered.id
  });
  assert.equal(after.summary!.contentRevision, 3);
  assert.equal(after.summary!.closedItems.length, 2);
  assert.ok(after.summary!.closedItems.every(item => item.resolvedBy?.kind === 'person'));
  assert.ok(after.summary!.closedItems.some(item => item.reason === 'Fixed.'));
  // More than a page of decisions: cap after resolution ordering, independent of delivery age.
  const risk = db
    .prepare(`SELECT * FROM mission_items WHERE id = ?`)
    .get(before.summary!.risks[0]!.id) as Record<string, unknown>;
  const columns = Object.keys(risk);
  const insert = db.prepare(
    `INSERT INTO mission_items (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
  );
  for (let i = 0; i < 105; i++) {
    const row = {
      ...risk,
      id: `closed-${i}`,
      item_ref: `closed-${i}`,
      resolved_at: new Date(Date.UTC(2026, 11, 1, 0, i)).toISOString()
    };
    insert.run(...columns.map(key => row[key as keyof typeof row]));
  }
  const capped = await getMissionSummary(mission.id);
  assert.equal(capped.itemsTruncated, true);
  const history = capped.summary!.closedItems;
  assert.equal(history.length, 100);
  assert.equal(history[0]!.id, 'closed-104');
  assert.equal(history[99]!.id, 'closed-5');
  for (let i = 0; i < 1005; i++) {
    const row: Record<string, unknown> = {
      ...risk,
      id: `open-${i}`,
      item_ref: `open-${i}`,
      kind: 'human_action',
      text: `Open action ${i}`,
      detail_json: JSON.stringify({
        actionId: `human-action-${i}`,
        category: 'other',
        source: 'agent'
      }),
      status: 'open',
      status_reason: null,
      resolved_by_kind: null,
      resolved_at: null,
      resolved_by_workspace_user_id: null,
      resolved_by_objective_id: null,
      resolved_by_delivery_id: null
    };
    insert.run(...columns.map(key => row[key]));
  }
  const paged = (await getMissionSummary(mission.id)).evidence!;
  assert.equal(paged.totals.actions, 1005, 'totals span all item-reader pages');
  assert.equal(paged.actions.length, 100);
  assert.equal(paged.truncated.actions, true);
});

test('equal open risks and same-scope suggestions group into one row; different scope stays apart', async () => {
  const { project, mission, objective: first } = await seedMission('Grouped items');
  const second = await createObjective({ missionId: mission.id, instructionText: 'Second' });
  const third = await createObjective({ missionId: mission.id, instructionText: 'Third' });
  const scope = { id: mission.id, workspaceId: mission.workspaceId, projectId: project.id };
  const retry = {
    title: 'Cap retries',
    change: 'Add the retry cap.',
    location: 'backend/retry.ts',
    doneWhen: 'Retries stop at three.'
  };

  const older = seedDelivery({
    mission: scope,
    objectiveId: first.id,
    deliveredAt: '2026-10-23T08:00:00.000Z',
    knownRisks: ['Retries may duplicate requests.'],
    deferredWork: [retry]
  });
  seedDelivery({
    mission: scope,
    objectiveId: second.id,
    deliveredAt: '2026-10-23T09:00:00.000Z',
    knownRisks: ['  retries may  DUPLICATE requests. '],
    deferredWork: [retry]
  });
  seedDelivery({
    mission: scope,
    objectiveId: third.id,
    deliveredAt: '2026-10-23T10:00:00.000Z',
    knownRisks: ['A different risk.'],
    deferredWork: [{ ...retry, location: 'cli/src/retry.ts', doneWhen: 'The CLI stops at three.' }]
  });
  db.prepare(
    `INSERT INTO mission_summaries (mission_id, workspace_id, project_id, status, generated_by, headline,
    created_at, updated_at) VALUES (?, ?, ?, 'composed', 'agent', 'Grouped.', ?, ?)`
  ).run(
    mission.id,
    mission.workspaceId,
    mission.projectId,
    '2026-10-23T11:00:00.000Z',
    '2026-10-23T11:00:00.000Z'
  );

  const summary = (await getMissionSummary(mission.id)).summary!;
  assert.equal(summary.risks.length, 2);
  const grouped = summary.risks.find(risk => risk.objectiveId === second.id)!;
  assert.deepEqual(
    grouped.duplicates!.map(duplicate => [duplicate.objectiveId, duplicate.deliveryId]),
    [[first.id, older.id]],
    'the newest record represents the group and the older one is listed, not hidden'
  );
  const single = summary.risks.find(risk => risk.objectiveId === third.id)!;
  assert.equal(single.duplicates, undefined, 'a single record carries no duplicates field');

  assert.equal(summary.suggestions.length, 2);
  const sameScope = summary.suggestions.find(item => item.location === 'backend/retry.ts')!;
  assert.equal(sameScope.objectiveId, second.id);
  assert.deepEqual(
    sameScope.duplicates!.map(duplicate => duplicate.objectiveId),
    [first.id]
  );
  const otherScope = summary.suggestions.find(item => item.location === 'cli/src/retry.ts')!;
  assert.equal(otherScope.title, sameScope.title);
  assert.equal(otherScope.duplicates, undefined, 'same title, different scope: its own row');

  // Stored identity is unchanged: each record closes through its own id.
  const { resolveMissionItem } = await import('./mission-item-resolutions.ts');
  await resolveMissionItem(grouped.id, { status: 'done' });
  const afterOne = (await getMissionSummary(mission.id)).summary!;
  const remaining = afterOne.risks.find(risk => risk.objectiveId === first.id)!;
  assert.equal(remaining.id, grouped.duplicates![0]!.id);
  assert.equal(remaining.duplicates, undefined);
  await resolveMissionItem(remaining.id, { status: 'done' });
  const afterAll = (await getMissionSummary(mission.id)).summary!;
  assert.deepEqual(
    afterAll.risks.map(risk => risk.text),
    ['A different risk.']
  );
});

test('cross-mission live decisions extend seen without advancing narrative or delivery watermarks', async () => {
  const { mission, objective } = await seedMission('Cross decision seen');
  const source = await createMission({
    projectId: mission.projectId,
    firstObjective: 'Fix target risk'
  });
  const delivery = seedDelivery({
    mission,
    objectiveId: objective.id,
    deliveredAt: '2026-10-21T10:00:00.000Z',
    knownRisks: ['Target risk']
  });
  // seedDeliveryRow already materializes mission items in the test helper.
  const item = db
    .prepare('SELECT id FROM mission_items WHERE delivery_id = ?')
    .get(delivery.id) as { id: string };
  assert.ok(item);
  const at = '2026-10-24T12:00:00.000Z';
  db.prepare(
    `UPDATE mission_items SET status = 'dismissed', status_reason = 'Verified elsewhere',
    resolved_by_kind = 'agent', resolved_by_objective_id = ?, resolved_by_mission_id = ?, resolved_at = ? WHERE id = ?`
  ).run(source.objectives[0]!.id, source.id, at, item.id);
  const before = await getMissionSummary(mission.id);
  assert.equal(before.itemsWatermark, at);
  assert.equal(before.itemsTruncated, false);
  assert.equal(before.watermark, '2026-10-21T10:00:00.000Z');
  assert.equal(before.narrativeWatermark, null);
  await assert.rejects(
    markMissionSummarySeen(mission.id, { watermark: '2026-10-24T12:00:00.001Z' })
  );
  assert.equal((await markMissionSummarySeen(mission.id, { watermark: at })).seenAt, at);
  db.prepare('UPDATE mission_items SET resolved_by_mission_id = ? WHERE id = ?').run(
    mission.id,
    item.id
  );
  assert.equal(
    (await getMissionSummary(mission.id)).itemsWatermark,
    null,
    'own-mission close excluded'
  );
  db.prepare('UPDATE mission_items SET resolved_by_mission_id = ? WHERE id = ?').run(
    source.id,
    item.id
  );
  db.prepare(
    "UPDATE mission_items SET status = 'open', status_reason = NULL, resolved_by_kind = NULL, resolved_by_mission_id = NULL, resolved_by_objective_id = NULL, resolved_at = NULL WHERE id = ?"
  ).run(item.id);
  assert.equal(
    (await getMissionSummary(mission.id)).itemsWatermark,
    null,
    'restore removes watermark'
  );
  db.prepare(
    `UPDATE mission_items SET status = 'done', resolved_by_kind = 'person', resolved_at = ? WHERE id = ?`
  ).run(at, item.id);
  assert.equal((await getMissionSummary(mission.id)).itemsWatermark, null, 'person close excluded');
  db.prepare(
    `UPDATE mission_items SET status_reason = 'Verified', resolved_by_kind = 'agent', resolved_by_objective_id = ?, resolved_by_mission_id = ? WHERE id = ?`
  ).run(source.objectives[0]!.id, source.id, item.id);
  db.prepare('UPDATE deliveries SET deleted_at = ? WHERE id = ?').run(at, delivery.id);
  assert.equal(
    (await getMissionSummary(mission.id)).itemsWatermark,
    null,
    'deleted source evidence excluded'
  );
});
