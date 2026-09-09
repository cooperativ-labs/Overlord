import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-human-actions-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const { createProject, createMission } = await import('./repository.ts');
const { listHumanActions, reopenHumanAction, resolveHumanAction } =
  await import('./human-actions.ts');
const { buildDeliveryReport } = await import('../packages/core/service/delivery-report.ts');

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function legacyDeferredWorkId(text: string, occurrence: number): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  return `deferred-work-${digest}-${occurrence}`;
}

function rewritePresentationDeferredWork(deliveryId: string, deferredWork: string[]): void {
  const row = db.prepare(`SELECT payload_json FROM deliveries WHERE id = ?`).get(deliveryId) as {
    payload_json: string;
  };
  const payload = JSON.parse(row.payload_json) as {
    deliveryReport: {
      presentation: { deferredWork: string[]; status: string; generatedBy: string };
    };
  };
  payload.deliveryReport.presentation.deferredWork = deferredWork;
  payload.deliveryReport.presentation.status = 'composed';
  payload.deliveryReport.presentation.generatedBy = 'gemini';
  db.prepare(`UPDATE deliveries SET payload_json = ? WHERE id = ?`).run(
    JSON.stringify(payload),
    deliveryId
  );
}

/**
 * Deliveries are written by the protocol service behind a live session; tests
 * seed them directly with the same report shape `deliverSession` persists.
 */
function seedDelivery({
  workspaceId,
  projectId,
  missionId,
  objectiveId,
  deliveredAt,
  humanActions,
  deferredWork = []
}: {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  deliveredAt: string;
  humanActions: Array<{
    action: string;
    reason?: string;
    blocking?: boolean;
    category?: string;
    command?: string;
    verify?: string;
    link?: string;
  }>;
  deferredWork?: string[];
}): string {
  const id = newId('delivery');
  const summary = 'Delivered.';
  const report = buildDeliveryReport({
    summary,
    deliveryReport: { schemaVersion: 1, agentReport: { humanActions, deferredWork } }
  });
  db.prepare(
    `INSERT INTO deliveries
       (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
        delivered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    projectId,
    missionId,
    objectiveId,
    summary,
    JSON.stringify({ deliveryReport: report }),
    deliveredAt,
    deliveredAt,
    deliveredAt
  );
  return id;
}

async function seedMission(name: string) {
  const project = await createProject({ name, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  return { project, mission, objective: mission.objectives[0]! };
}

test('reported actions surface with mission context, blocking first', async () => {
  const { project, mission, objective } = await seedMission('HA Basic');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [
      { action: 'Add STRIPE_KEY to the production environment', category: 'environment' },
      {
        action: 'Run the pending migration',
        blocking: true,
        category: 'database',
        command: 'yarn db:migrate',
        verify: 'schema_migrations lists 20260907_human_actions',
        link: 'database/sqlite/migrations/20260907_human_actions.sql'
      },
      { action: 'git push the branch' }
    ]
  });

  const result = await listHumanActions();
  const mine = result.items.filter(item => item.deliveryId === deliveryId);

  assert.equal(mine.length, 2, 'the Git-only action is filtered out at normalization');
  assert.equal(mine[0]!.action, 'Run the pending migration');
  assert.equal(mine[0]!.kind, 'blocking_question');
  assert.equal(mine[0]!.blocking, true);
  assert.equal(mine[0]!.category, 'database');
  assert.equal(mine[0]!.command, 'yarn db:migrate');
  assert.equal(mine[0]!.verify, 'schema_migrations lists 20260907_human_actions');
  assert.equal(mine[0]!.link, 'database/sqlite/migrations/20260907_human_actions.sql');
  assert.equal(mine[1]!.command, null);
  assert.equal(mine[1]!.kind, 'follow_up');
  assert.equal(mine[1]!.verify, null);
  assert.equal(mine[1]!.link, null);
  assert.equal(mine[0]!.resolution, null);
  assert.equal(mine[0]!.projectName, 'HA Basic');
  assert.equal(mine[0]!.projectColor, '#123456');
  assert.equal(mine[0]!.missionDisplayId, mission.displayId);
  assert.equal(mine[0]!.objectiveDisplayId, objective.displayId);
  assert.equal(mine[0]!.id, `human-action:${deliveryId}:${mine[0]!.actionId}`);
  assert.ok(result.counts.open >= 2);
  assert.ok(result.counts.blocking >= 1);
});

test('deferred work joins the rail after blocking questions and uses the same resolution', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [
      { action: 'Answer the rollout question', blocking: true },
      { action: 'Configure the optional webhook' }
    ],
    deferredWork: ['Add the audit-log export', 'Add the audit-log export']
  });

  const result = await listHumanActions();
  const mine = result.items.filter(item => item.deliveryId === deliveryId);

  assert.deepEqual(
    mine.map(item => item.kind),
    ['blocking_question', 'deferred_work', 'deferred_work', 'follow_up']
  );
  assert.notEqual(mine[1]!.actionId, mine[2]!.actionId, 'duplicate deferred items stay distinct');
  assert.equal(mine[1]!.category, 'other');
  assert.ok(result.counts.deferred >= 2);

  const resolved = await resolveHumanAction(deliveryId, mine[1]!.actionId, { status: 'done' });
  assert.equal(resolved.kind, 'deferred_work');
  assert.equal(resolved.resolution?.status, 'done');
});

test('deferred-work ids stay stable across presentation composition', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred Stable');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [],
    deferredWork: ['Finish the initial audit-log export implementation']
  });

  const [before] = (await listHumanActions()).items.filter(item => item.deliveryId === deliveryId);
  assert.ok(before);
  const resolvedBefore = await resolveHumanAction(deliveryId, before.actionId, { status: 'done' });
  assert.equal(resolvedBefore.resolution?.status, 'done');

  rewritePresentationDeferredWork(deliveryId, [
    'Extend the audit-log export implementation with the remaining retention filters.'
  ]);

  const [after] = (await listHumanActions({ includeResolved: true })).items.filter(
    item => item.deliveryId === deliveryId
  );
  assert.ok(after);
  assert.equal(after.actionId, before.actionId);
  assert.equal(
    after.action,
    'Extend the audit-log export implementation with the remaining retention filters.'
  );
  assert.equal(after.resolution?.status, 'done');
});

test('a compose-added deferred-work item gets a distinct stable id', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred Extra');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [],
    deferredWork: ['Complete the initial export implementation']
  });
  rewritePresentationDeferredWork(deliveryId, [
    'Complete the initial export implementation with the missing retention filters.',
    'Document the new retention-filter configuration.'
  ]);

  const items = (await listHumanActions()).items.filter(item => item.deliveryId === deliveryId);
  assert.equal(items.length, 2);
  assert.notEqual(items[0]!.actionId, items[1]!.actionId);
  assert.equal(items[1]!.actionId, 'deferred-work-1-composed');
});

test('deferred-work ids follow the agent source after an earlier item is dropped', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred Dropped');
  const kept = 'Fix the date-dependent employee lifecycle test that failed in payroll.';
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [],
    deferredWork: ['Implement the CSV export API for reports.', kept]
  });
  const digest = createHash('sha256').update(kept).digest('hex').slice(0, 16);
  rewritePresentationDeferredWork(deliveryId, [
    'Fix the date-dependent employee lifecycle test that failed in payroll before the next close.'
  ]);

  const items = (await listHumanActions()).items.filter(item => item.deliveryId === deliveryId);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.actionId, `deferred-work-1-${digest}`);
});

test('a legacy deferred-work resolution remains visible through the fallback', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred Legacy Read');
  const deferredWork = 'Complete the initial audit-log export implementation';
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [],
    deferredWork: [deferredWork]
  });
  const legacyId = legacyDeferredWorkId(deferredWork, 1);
  db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status,
        resolved_by_workspace_user_id, resolved_at)
     VALUES (?, ?, ?, ?, ?, 'done', ?, ?)`
  ).run(
    deliveryId,
    legacyId,
    mission.workspaceId,
    mission.id,
    objective.id,
    'operator-workspace-user',
    new Date().toISOString()
  );

  const [item] = (await listHumanActions({ includeResolved: true })).items.filter(
    candidate => candidate.deliveryId === deliveryId
  );
  assert.ok(item);
  assert.equal(item.resolution?.status, 'done');
  assert.notEqual(item.actionId, legacyId);

  const reopened = await reopenHumanAction(deliveryId, legacyId);
  assert.equal(reopened.resolution, null);
});

test('resolving through a legacy deferred-work id writes the stable id', async () => {
  const { project, mission, objective } = await seedMission('HA Deferred Legacy Write');
  const deferredWork = 'Complete the initial audit-log export implementation';
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [],
    deferredWork: [deferredWork]
  });
  const legacyId = legacyDeferredWorkId(deferredWork, 1);

  const resolved = await resolveHumanAction(deliveryId, legacyId, { status: 'done' });
  assert.equal(resolved.resolution?.status, 'done');
  assert.notEqual(resolved.actionId, legacyId);
  const row = db
    .prepare(`SELECT action_id FROM human_action_resolutions WHERE delivery_id = ?`)
    .get(deliveryId) as { action_id: string };
  assert.equal(row.action_id, resolved.actionId);
});

test('resolving hides an action from the open list and records a change', async () => {
  const { project, mission, objective } = await seedMission('HA Resolve');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [{ action: 'Rotate the webhook secret', reason: 'It was logged.' }]
  });
  const [open] = (await listHumanActions()).items.filter(item => item.deliveryId === deliveryId);
  assert.ok(open);

  const resolved = await resolveHumanAction(deliveryId, open.actionId, { status: 'done' });
  assert.equal(resolved.resolution?.status, 'done');
  assert.ok(resolved.resolution?.resolvedAt);
  assert.equal(resolved.resolution?.resolvedByWorkspaceUserId, 'operator-workspace-user');

  const withoutResolved = await listHumanActions();
  assert.ok(!withoutResolved.items.some(item => item.id === open.id));

  const withResolved = await listHumanActions({ includeResolved: true });
  const listed = withResolved.items.find(item => item.id === open.id);
  assert.equal(listed?.resolution?.status, 'done');
  assert.ok(withResolved.counts.resolved >= 1);

  const change = db
    .prepare(
      `SELECT entity_type, mission_id, objective_id, operation FROM entity_changes
        WHERE entity_type = 'human_action_resolution' AND entity_id = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(`${deliveryId}:${open.actionId}`) as
    | { entity_type: string; mission_id: string; objective_id: string; operation: string }
    | undefined;
  assert.ok(change, 'a realtime change row is recorded');
  assert.equal(change.mission_id, mission.id);
  assert.equal(change.objective_id, objective.id);
  assert.equal(change.operation, 'update');

  const dismissed = await resolveHumanAction(deliveryId, open.actionId, { status: 'dismissed' });
  assert.equal(dismissed.resolution?.status, 'dismissed');

  const reopened = await reopenHumanAction(deliveryId, open.actionId);
  assert.equal(reopened.resolution, null);
  assert.ok((await listHumanActions()).items.some(item => item.id === open.id));
});

test('an unknown action id or a bad status is rejected', async () => {
  const { project, mission, objective } = await seedMission('HA Reject');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: new Date().toISOString(),
    humanActions: [{ action: 'Deploy the worker' }]
  });

  await assert.rejects(
    resolveHumanAction(deliveryId, 'human-action-9', { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
  await assert.rejects(
    resolveHumanAction(deliveryId, 'human-action-1', { status: 'later' }),
    (error: { status?: number }) => error.status === 400
  );
  await assert.rejects(
    resolveHumanAction('missing-delivery', 'human-action-1', { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
});

test('only the latest delivery of an objective contributes actions', async () => {
  const { project, mission, objective } = await seedMission('HA Latest');
  const older = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: '2026-09-01T00:00:00.000Z',
    humanActions: [{ action: 'Old instruction' }]
  });
  const newer = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: '2026-09-02T00:00:00.000Z',
    humanActions: [{ action: 'New instruction' }]
  });

  const items = (await listHumanActions()).items;
  assert.ok(items.some(item => item.deliveryId === newer));
  assert.ok(!items.some(item => item.deliveryId === older));
});

test('a delivery without actions and one outside the window are skipped', async () => {
  const { project, mission, objective } = await seedMission('HA Window');
  const stale = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deliveredAt: '2025-01-01T00:00:00.000Z',
    humanActions: [{ action: 'Long forgotten' }]
  });
  const emptyId = newId('delivery');
  db.prepare(
    `INSERT INTO deliveries
       (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
        delivered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Nothing to do', '{}', ?, ?, ?)`
  ).run(
    emptyId,
    mission.workspaceId,
    project.id,
    mission.id,
    objective.id,
    ...Array(3).fill(new Date().toISOString())
  );

  const items = (await listHumanActions()).items;
  assert.ok(!items.some(item => item.deliveryId === stale));
  assert.ok(!items.some(item => item.deliveryId === emptyId));
});
