import assert from 'node:assert/strict';
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
