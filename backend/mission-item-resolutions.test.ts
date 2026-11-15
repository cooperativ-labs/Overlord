import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Item writes outside the protocol (coo:1260.430y): a person closes and
 * restores any mission item through `/api/mission-items/:id/resolution`, the
 * delivery card's deferred-work routes write the same rows and report an
 * agent's close, and reopening an objective supersedes its earlier items.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mission-items-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, requireDatabaseClient } = await import('./db.ts');
const { seedDelivery } = await import('./test-helpers.ts');
const { createProject, createMission, listMissionDeliveries, updateObjective } =
  await import('./repository.ts');
const { reopenDeferredWork, resolveDeferredWork } = await import('./deferred-work-resolutions.ts');
const { resolveMissionItem, restoreMissionItemResolution } =
  await import('./mission-item-resolutions.ts');
const { buildDeliveryReport } = await import('../packages/core/service/delivery-report.ts');
const { closeMissionItem } = await import('../packages/core/service/mission-items.ts');

interface ItemRow {
  id: string;
  kind: string;
  text: string;
  status: string;
}

async function seeded(name: string) {
  const project = await createProject({ name, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  const objective = mission.objectives[0]!;
  const deliver = (deliveredAt: string) => {
    const summary = 'Delivered.';
    const report = buildDeliveryReport({
      summary,
      deliveryReport: {
        schemaVersion: 1,
        agentReport: {
          humanActions: [{ action: 'Rotate the signing key.', category: 'environment' }],
          knownRisks: ['Exports may time out on large projects.'],
          deferredWork: [
            {
              title: 'Stream the export',
              change: 'Stream rows instead of buffering.',
              location: 'backend/exporter.ts',
              doneWhen: 'Memory stays flat on large exports.'
            }
          ]
        }
      }
    });
    return seedDelivery(db, {
      workspaceId: mission.workspaceId,
      projectId: project.id,
      missionId: mission.id,
      objectiveId: objective.id,
      summary,
      payload: { deliveryReport: report },
      deliveredAt
    });
  };
  return { project, mission, objective, deliver };
}

function itemsOf(deliveryId: string): ItemRow[] {
  return db
    .prepare(
      `SELECT id, kind, text, status FROM mission_items WHERE delivery_id = ? ORDER BY kind, position`
    )
    .all(deliveryId) as ItemRow[];
}

function item(deliveryId: string, kind: string): ItemRow {
  const row = itemsOf(deliveryId).find(candidate => candidate.kind === kind);
  assert.ok(row, `${kind} row exists`);
  return row;
}

function lastChange(
  itemId: string
): { operation: string; changed_fields_json: string } | undefined {
  return db
    .prepare(
      `SELECT operation, changed_fields_json FROM entity_changes
        WHERE entity_type = 'mission_item' AND entity_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(itemId) as { operation: string; changed_fields_json: string } | undefined;
}

test('a person closes and restores a risk and a human action', async () => {
  const { deliver } = await seeded('Items Route');
  const deliveryId = deliver(new Date().toISOString());
  const risk = item(deliveryId, 'risk');
  const action = item(deliveryId, 'human_action');

  const closedRisk = await resolveMissionItem(risk.id, {
    status: 'dismissed',
    reason: '  The exporter was removed.  '
  });
  assert.equal(closedRisk.status, 'dismissed');
  assert.equal(closedRisk.kind, 'risk');
  assert.equal(closedRisk.reason, 'The exporter was removed.');
  assert.deepEqual(closedRisk.resolvedBy, {
    kind: 'person',
    workspaceUserId: 'operator-workspace-user',
    objectiveId: null,
    deliveryId: null
  });
  assert.ok(closedRisk.resolvedAt);
  assert.equal(lastChange(risk.id)?.operation, 'update');

  const closedAction = await resolveMissionItem(action.id, { status: 'done' });
  assert.equal(closedAction.status, 'done');
  assert.equal(closedAction.reason, null, 'a person may close without a reason');

  const redecided = await resolveMissionItem(action.id, {
    status: 'dismissed',
    reason: 'Not needed.'
  });
  assert.equal(redecided.status, 'dismissed', 'a person may re-decide a closed item');

  const restoredRisk = await restoreMissionItemResolution(risk.id);
  assert.equal(restoredRisk.status, 'open');
  assert.equal(restoredRisk.reason, null);
  assert.equal(restoredRisk.resolvedBy, null);
  assert.equal(restoredRisk.resolvedAt, null);
  const restoredAction = await restoreMissionItemResolution(action.id);
  assert.equal(restoredAction.status, 'open');

  const again = await restoreMissionItemResolution(action.id);
  assert.equal(again.revision, restoredAction.revision, 'restoring an open item is a no-op');
});

test('the item route validates its input and hides unknown items', async () => {
  const { deliver } = await seeded('Items Route Reject');
  const deliveryId = deliver(new Date().toISOString());
  const risk = item(deliveryId, 'risk');
  const status = (code: number) => (error: { status?: number }) => error.status === code;

  await assert.rejects(resolveMissionItem(risk.id, { status: 'superseded' }), status(400));
  await assert.rejects(resolveMissionItem(risk.id, { status: 'open' }), status(400));
  await assert.rejects(resolveMissionItem(risk.id, { status: 'done', reason: 7 }), status(400));
  await assert.rejects(
    resolveMissionItem(risk.id, { status: 'done', reason: 'x'.repeat(281) }),
    status(400)
  );
  await assert.rejects(resolveMissionItem('missing-item', { status: 'done' }), status(404));
  await assert.rejects(restoreMissionItemResolution('missing-item'), status(404));

  db.prepare(`UPDATE deliveries SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    deliveryId
  );
  await assert.rejects(
    resolveMissionItem(risk.id, { status: 'done' }),
    status(404),
    'an item of a deleted delivery is not found'
  );
});

test('reopening an objective supersedes its earlier items; a superseded item cannot be restored', async () => {
  const { objective, deliver } = await seeded('Items Reopen');
  const deliveryId = deliver(new Date(Date.now() - 60_000).toISOString());
  const risk = item(deliveryId, 'risk');
  await resolveMissionItem(risk.id, { status: 'done', reason: 'Fixed.' });

  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(objective.id);
  await updateObjective(objective.id, { state: 'draft' });

  assert.deepEqual(
    itemsOf(deliveryId).map(row => [row.kind, row.status]),
    [
      ['human_action', 'superseded'],
      ['risk', 'done'],
      ['suggestion', 'superseded']
    ],
    'open items are superseded and a decision is kept'
  );
  const superseded = item(deliveryId, 'human_action');
  assert.equal(lastChange(superseded.id)?.operation, 'update');

  await assert.rejects(
    restoreMissionItemResolution(superseded.id),
    (error: { status?: number; code?: string }) =>
      error.status === 409 && error.code === 'mission_item_superseded'
  );

  // Restoring the decided risk re-applies the supersede rules: its delivery is no longer current.
  const restored = await restoreMissionItemResolution(risk.id);
  assert.equal(restored.status, 'superseded');
});

test('delivery cards keep resolving suggestions and report an agent close', async () => {
  const { mission, objective, deliver } = await seeded('Items Card');
  const deliveryId = deliver(new Date(Date.now() - 60_000).toISOString());
  const suggestion = item(deliveryId, 'suggestion');
  const [card] = (await listMissionDeliveries(mission.id)).items.find(
    delivery => delivery.id === deliveryId
  )!.deferredWorkItems;
  assert.equal(card!.resolution, null);

  // An agent closes the suggestion; the card reports it through the same field.
  const agentClose = await closeMissionItem(requireDatabaseClient(), {
    itemId: suggestion.id,
    missionId: mission.id,
    status: 'done',
    reason: 'Streaming landed in the export objective.',
    resolver: { kind: 'agent', objectiveId: objective.id, deliveryId },
    attribution: { actorWorkspaceUserId: null, actorTokenId: null, source: 'cli' }
  });
  assert.equal(agentClose.ok, true);
  const [byAgent] = (await listMissionDeliveries(mission.id)).items.find(
    delivery => delivery.id === deliveryId
  )!.deferredWorkItems;
  assert.deepEqual(byAgent!.resolution, {
    status: 'done',
    resolvedAt: byAgent!.resolution!.resolvedAt,
    resolvedByWorkspaceUserId: null,
    outcome: null,
    outcomeRef: null,
    reason: 'Streaming landed in the export objective.',
    resolvedBy: { kind: 'agent', workspaceUserId: null, objectiveId: objective.id, deliveryId }
  });

  // A person overrides the agent from the card, and the item route sees the same row.
  const overridden = await resolveDeferredWork(deliveryId, card!.actionId, { status: 'dismissed' });
  assert.equal(overridden.resolution?.status, 'dismissed');
  assert.equal(overridden.resolution?.resolvedBy.kind, 'person');
  assert.equal(overridden.resolution?.reason, null);
  const reopened = await restoreMissionItemResolution(suggestion.id);
  assert.equal(reopened.status, 'open');

  // After the objective reopens, the old card still resolves and reopens its suggestion.
  db.prepare(`UPDATE objectives SET state = 'complete' WHERE id = ?`).run(objective.id);
  await updateObjective(objective.id, { state: 'draft' });
  assert.equal(item(deliveryId, 'suggestion').status, 'superseded');
  const [stale] = (await listMissionDeliveries(mission.id)).items.find(
    delivery => delivery.id === deliveryId
  )!.deferredWorkItems;
  assert.equal(stale!.resolution, null, 'a superseded suggestion shows unresolved');

  const decided = await resolveDeferredWork(deliveryId, card!.actionId, {
    status: 'done',
    outcome: 'objective_added',
    outcomeRef: 'coo:1.abcd'
  });
  assert.equal(decided.resolution?.outcome, 'objective_added');
  const undone = await reopenDeferredWork(deliveryId, card!.actionId);
  assert.equal(undone.resolution, null);
  assert.equal(item(deliveryId, 'suggestion').status, 'superseded');
  const noop = await reopenDeferredWork(deliveryId, card!.actionId);
  assert.equal(noop.resolution, null, 'reopening a superseded suggestion is a no-op');
});
