import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-deferred-work-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const { seedDelivery: seedDeliveryRow } = await import('./test-helpers.ts');
const { createProject, createMission, listMissionDeliveries } = await import('./repository.ts');
const { reopenDeferredWork, resolveDeferredWork } = await import('./deferred-work-resolutions.ts');
const { buildDeliveryReport, deferredWorkId } =
  await import('../packages/core/service/delivery-report.ts');

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

interface DeferredWorkInput {
  title: string;
  change: string;
  location: string;
  doneWhen: string;
}

/** A structured deferred-work item (contract v166) whose fields all derive from `title`. */
function item(title: string): DeferredWorkInput {
  return {
    title,
    change: `${title} in the exporter.`,
    location: 'backend/exporter.ts',
    doneWhen: `${title} is visible in the export.`
  };
}

/** Narrows `presentation.deferredWork` to the agent items at `indexes`, as the composer's eligibility filter does. */
function keepPresentationDeferredWork(deliveryId: string, indexes: number[]): void {
  const row = db.prepare(`SELECT payload_json FROM deliveries WHERE id = ?`).get(deliveryId) as {
    payload_json: string;
  };
  const payload = JSON.parse(row.payload_json) as {
    deliveryReport: {
      agentReport: { deferredWork: unknown[] };
      presentation: { deferredWork: unknown[]; status: string; generatedBy: string };
    };
  };
  payload.deliveryReport.presentation.deferredWork = indexes.map(
    index => payload.deliveryReport.agentReport.deferredWork[index]
  );
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
  humanActions = [],
  deferredWork = []
}: {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  humanActions?: Array<{ action: string; reason?: string; blocking?: boolean }>;
  deferredWork?: DeferredWorkInput[];
}): string {
  const id = newId('delivery');
  const summary = 'Delivered.';
  const deliveredAt = new Date().toISOString();
  const report = buildDeliveryReport({
    summary,
    deliveryReport: { schemaVersion: 1, agentReport: { humanActions, deferredWork } }
  });
  return seedDeliveryRow(db, {
    id,
    workspaceId,
    projectId,
    missionId,
    objectiveId,
    summary,
    payload: { deliveryReport: report },
    deliveredAt
  });
}

async function seedMission(name: string) {
  const project = await createProject({ name, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  return { project, mission, objective: mission.objectives[0]! };
}

async function deferredWorkItems(missionId: string, deliveryId: string) {
  const delivery = (await listMissionDeliveries(missionId)).items.find(d => d.id === deliveryId);
  assert.ok(delivery, 'delivery is listed');
  return delivery.deferredWorkItems;
}

test('duplicate deferred-work items stay distinct and resolve independently', async () => {
  const { project, mission, objective } = await seedMission('DW Duplicate');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deferredWork: [item('Add the audit-log export'), item('Add the audit-log export')]
  });

  const items = await deferredWorkItems(mission.id, deliveryId);
  assert.equal(items.length, 2);
  assert.notEqual(items[0]!.actionId, items[1]!.actionId);

  const resolved = await resolveDeferredWork(deliveryId, items[0]!.actionId, { status: 'done' });
  assert.equal(resolved.actionId, items[0]!.actionId);
  assert.equal(resolved.title, 'Add the audit-log export');
  assert.equal(resolved.location, 'backend/exporter.ts');
  assert.equal(resolved.resolution?.status, 'done');
  assert.equal(resolved.resolution?.resolvedByWorkspaceUserId, 'operator-workspace-user');

  const after = await deferredWorkItems(mission.id, deliveryId);
  assert.equal(after[0]!.resolution?.status, 'done');
  assert.equal(after[1]!.resolution, null);
});

test('items carry the agent id through a narrowed presentation', async () => {
  const { project, mission, objective } = await seedMission('DW Subset');
  const dropped = item('Implement the CSV export API');
  const kept = item('Fix the date-dependent lifecycle test');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deferredWork: [dropped, kept]
  });
  const [, second] = await deferredWorkItems(mission.id, deliveryId);
  assert.equal(second!.actionId, deferredWorkId(1, kept));
  await resolveDeferredWork(deliveryId, second!.actionId, { status: 'done' });

  keepPresentationDeferredWork(deliveryId, [1]);

  const items = await deferredWorkItems(mission.id, deliveryId);
  assert.deepEqual(
    items.map(entry => [entry.actionId, entry.title, entry.change, entry.doneWhen]),
    [[deferredWorkId(1, kept), kept.title, kept.change, kept.doneWhen]]
  );
  assert.equal(items[0]!.resolution?.status, 'done');
  await assert.rejects(
    resolveDeferredWork(deliveryId, deferredWorkId(0, dropped), { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
});

test('resolving records a realtime change, and reopening forgets the decision', async () => {
  const { project, mission, objective } = await seedMission('DW Resolve');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deferredWork: [item('Split the exporter')]
  });
  const [open] = await deferredWorkItems(mission.id, deliveryId);
  assert.ok(open);

  const dismissed = await resolveDeferredWork(deliveryId, open.actionId, { status: 'dismissed' });
  assert.equal(dismissed.resolution?.status, 'dismissed');
  assert.ok(dismissed.resolution?.resolvedAt);

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

  const reopened = await reopenDeferredWork(deliveryId, open.actionId);
  assert.equal(reopened.resolution, null);
  const [after] = await deferredWorkItems(mission.id, deliveryId);
  assert.equal(after!.resolution, null);

  const again = await reopenDeferredWork(deliveryId, open.actionId);
  assert.equal(again.resolution, null, 'reopening an open item is a no-op');
});

test('a promotion records which button was chosen on the delivery card', async () => {
  const { project, mission, objective } = await seedMission('DW Outcome');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deferredWork: [item('Split the exporter'), item('Add retries'), item('Rename the flag')]
  });

  const before = await deferredWorkItems(mission.id, deliveryId);
  assert.deepEqual(
    before.map(entry => [entry.title, entry.resolution]),
    [
      ['Split the exporter', null],
      ['Add retries', null],
      ['Rename the flag', null]
    ]
  );
  const [first, second, third] = before;

  const promoted = await resolveDeferredWork(deliveryId, first!.actionId, {
    status: 'done',
    outcome: 'mission_created',
    outcomeRef: 'coo:77'
  });
  assert.equal(promoted.resolution?.outcome, 'mission_created');
  assert.equal(promoted.resolution?.outcomeRef, 'coo:77');
  await resolveDeferredWork(deliveryId, second!.actionId, {
    status: 'done',
    outcome: 'objective_added'
  });
  await resolveDeferredWork(deliveryId, third!.actionId, { status: 'dismissed' });

  const after = await deferredWorkItems(mission.id, deliveryId);
  assert.deepEqual(
    after.map(entry => [
      entry.actionId,
      entry.resolution?.status,
      entry.resolution?.outcome,
      entry.resolution?.outcomeRef
    ]),
    [
      [first!.actionId, 'done', 'mission_created', 'coo:77'],
      [second!.actionId, 'done', 'objective_added', null],
      [third!.actionId, 'dismissed', null, null]
    ]
  );
});

test('a malformed outcome is rejected', async () => {
  const { project, mission, objective } = await seedMission('DW Outcome Reject');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    deferredWork: [item('Split the exporter')]
  });
  const [open] = await deferredWorkItems(mission.id, deliveryId);
  const rejects400 = (body: unknown) =>
    assert.rejects(
      resolveDeferredWork(deliveryId, open!.actionId, body),
      (error: { status?: number }) => error.status === 400
    );

  await rejects400({ status: 'dismissed', outcome: 'mission_created' });
  await rejects400({ status: 'done', outcome: 'shipped' });
  await rejects400({ status: 'done', outcomeRef: 'coo:1' });
  await rejects400({ status: 'done', outcome: 'objective_added', outcomeRef: '  ' });
  await rejects400({ status: 'later' });
});

test('a reported human action, an unknown id, and an unknown delivery are rejected', async () => {
  const { project, mission, objective } = await seedMission('DW Reject');
  const deliveryId = seedDelivery({
    workspaceId: mission.workspaceId,
    projectId: project.id,
    missionId: mission.id,
    objectiveId: objective.id,
    humanActions: [{ action: 'Deploy the worker' }],
    deferredWork: [item('Split the exporter')]
  });

  // Reported human actions are shown on the delivery card but have no resolution.
  await assert.rejects(
    resolveDeferredWork(deliveryId, 'human-action-1', { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
  await assert.rejects(
    resolveDeferredWork(deliveryId, 'deferred-work-9-0123456789abcdef', { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
  await assert.rejects(
    resolveDeferredWork('missing-delivery', 'deferred-work-0-0123456789abcdef', { status: 'done' }),
    (error: { status?: number }) => error.status === 404
  );
  await assert.rejects(
    reopenDeferredWork(deliveryId, 'human-action-1'),
    (error: { status?: number }) => error.status === 404
  );
});
