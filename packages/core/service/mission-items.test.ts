import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import {
  createSqliteClient,
  type DatabaseClient,
  deriveMissionItems,
  loadBetterSqlite3,
  migrateDatabase,
  MISSION_ITEMS_MIGRATION_VERSION,
  type MissionItemDeliveryScope,
  missionItemRef,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FIXTURE_DELIVERIES,
  FIXTURE_IDS,
  seedMissionItemsFixture
} from '../../../database/src/mission-items.test-fixture.ts';

import { buildDeliveryReport, readDeliveryReport } from './delivery-report.ts';
import { ServiceError } from './errors.ts';
import {
  applyMissionItemSupersedeRules,
  closeMissionItem,
  getMissionItem,
  insertDeliveryMissionItems,
  listMissionItems,
  type MissionItem,
  reconcileDeliveryMissionItems,
  restoreMissionItem
} from './mission-items.ts';
import { seedServiceOperator } from './test-helpers.ts';

const { workspaceId, projectId, missionId, otherMissionId } = FIXTURE_IDS;
const attribution = { actorWorkspaceUserId: null, source: 'protocol' } as const;
const PERSON = 'operator-workspace-user';

/** A database with the fixture mission seeded after every migration, so `mission_items` starts empty. */
async function setup(): Promise<DatabaseClient> {
  const db = createSqliteClient(openInMemoryDatabase());
  await seedMissionItemsFixture(db, { legacyResolutions: false });
  await seedServiceOperator({ db });
  await db.run(
    `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position,
       title, state, created_at, updated_at)
     VALUES ('ox', ?, ?, ?, 'xxxx', 0, 'Other', 'complete', ?, ?)`,
    [workspaceId, projectId, otherMissionId, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']
  );
  return db;
}

function agentReport({
  actions = [],
  risks = [],
  suggestions = []
}: {
  actions?: string[];
  risks?: string[];
  suggestions?: string[];
}): DeliveryReportPayloadV1 {
  return buildDeliveryReport({
    summary: 'Delivered.',
    deliveryReport: {
      schemaVersion: 1,
      agentReport: {
        humanActions: actions.map(action => ({ action, category: 'environment' })),
        knownRisks: risks,
        deferredWork: suggestions.map(title => ({
          title,
          change: `Change ${title}.`,
          location: 'backend/x.ts',
          doneWhen: `${title} done.`
        }))
      }
    }
  });
}

let sequence = 0;
async function addDelivery(
  db: DatabaseClient,
  {
    objectiveId,
    deliveredAt,
    report,
    mission = missionId
  }: { objectiveId: string; deliveredAt: string; report: DeliveryReportPayloadV1; mission?: string }
): Promise<MissionItemDeliveryScope> {
  sequence += 1;
  const id = `d-test-${String(sequence).padStart(3, '0')}`;
  await db.run(
    `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary,
       payload_json, delivered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Delivered.', ?, ?, ?, ?)`,
    [
      id,
      workspaceId,
      projectId,
      mission,
      objectiveId,
      JSON.stringify({ deliveryReport: report }),
      deliveredAt,
      deliveredAt,
      deliveredAt
    ]
  );
  return { id, workspaceId, projectId, missionId: mission, objectiveId, deliveredAt };
}

async function itemsOf(db: DatabaseClient, deliveryId: string): Promise<MissionItem[]> {
  const { items } = await listMissionItems(db, {
    missionId,
    statuses: ['open', 'done', 'dismissed', 'superseded'],
    limit: 1_000
  });
  return items.filter(item => item.deliveryId === deliveryId);
}

async function changeCount(db: DatabaseClient, entityId?: string): Promise<number> {
  const row = await db.get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM entity_changes
      WHERE entity_type = 'mission_item'${entityId ? ' AND entity_id = ?' : ''}`,
    entityId ? [entityId] : []
  );
  return Number(row?.total ?? 0);
}

describe('mission item identity', () => {
  it('suggestions reuse the deferred-work id', () => {
    const report = agentReport({ suggestions: ['Add metrics'] });
    const [item] = deriveMissionItems(report);
    assert.equal(item?.kind, 'suggestion');
    assert.equal(item?.itemRef, report.presentation.deferredWork[0]?.id);
  });

  it('a risk is identified by its normalised text and stored once per delivery', () => {
    const items = deriveMissionItems(
      agentReport({ risks: ['Retry storms under load.', '  RETRY storms  under load.', 'Other.'] })
    );
    assert.deepEqual(
      items.map(item => [item.kind, item.position, item.text]),
      [
        ['risk', 0, 'Retry storms under load.'],
        ['risk', 2, 'Other.']
      ]
    );
    assert.equal(
      missionItemRef({ kind: 'risk', text: 'retry storms under load.' }),
      items[0]?.itemRef
    );
  });

  it('a human action keeps its reference when the composer rewords it', () => {
    const deterministic = agentReport({ actions: ['Set FOO in production.'] });
    const composed: DeliveryReportPayloadV1 = {
      ...deterministic,
      presentation: {
        ...deterministic.presentation,
        status: 'composed',
        generatedBy: 'gemini',
        humanActions: deterministic.presentation.humanActions.map(action => ({
          ...action,
          action: 'Set the FOO variable on the production backend.'
        }))
      }
    };
    const [before] = deriveMissionItems(deterministic);
    const [after] = deriveMissionItems(composed);
    assert.equal(before?.itemRef, after?.itemRef);
    assert.match(before?.itemRef ?? '', /^human_action-[0-9a-f]{16}$/);
    assert.notEqual(after?.text, before?.text);
    assert.notEqual(
      before?.itemRef,
      deriveMissionItems(agentReport({ actions: ['Set BAR in production.'] }))[0]?.itemRef
    );
    assert.deepEqual(after?.detail, {
      actionId: 'human-action-1',
      category: 'environment',
      source: 'agent'
    });
  });
});

describe('mission item writer', () => {
  it('inserts a delivery’s items as open rows with change rows, idempotently', async () => {
    const db = await setup();
    const delivery = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report: agentReport({
        actions: ['Set FOO.'],
        risks: ['Risky.'],
        suggestions: ['Add metrics']
      })
    });
    const report = readDeliveryReport({
      summary: 'Delivered.',
      deliveryReport: agentReport({
        actions: ['Set FOO.'],
        risks: ['Risky.'],
        suggestions: ['Add metrics']
      })
    });
    const first = await insertDeliveryMissionItems(db, { delivery, report, attribution });
    assert.equal(first.inserted.length, 3);
    const items = await itemsOf(db, delivery.id);
    assert.deepEqual(
      items.map(item => [item.kind, item.status, item.text, item.reportedAt]).sort(),
      [
        ['human_action', 'open', 'Set FOO.', delivery.deliveredAt],
        ['risk', 'open', 'Risky.', delivery.deliveredAt],
        ['suggestion', 'open', 'Add metrics', delivery.deliveredAt]
      ]
    );
    assert.equal(await changeCount(db), 3);
    const change = await db.get<Record<string, unknown>>(
      `SELECT mission_id, objective_id, operation, entity_revision FROM entity_changes
        WHERE entity_type = 'mission_item' AND entity_id = ?`,
      [first.inserted[0]]
    );
    assert.deepEqual(change, {
      mission_id: missionId,
      objective_id: 'oa',
      operation: 'insert',
      entity_revision: 1
    });

    const second = await insertDeliveryMissionItems(db, { delivery, report, attribution });
    assert.deepEqual(second, { inserted: [], superseded: [] });
    assert.equal(await changeCount(db), 3);
  });

  it('a re-delivery supersedes only the earlier open human actions', async () => {
    const db = await setup();
    const firstReport = agentReport({
      actions: ['Set FOO.', 'Rotate the key.'],
      risks: ['Risky.'],
      suggestions: ['Add metrics']
    });
    const first = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report: firstReport
    });
    await insertDeliveryMissionItems(db, { delivery: first, report: firstReport, attribution });
    const rotate = (await itemsOf(db, first.id)).find(item => item.text === 'Rotate the key.')!;
    await closeMissionItem(db, {
      itemId: rotate.id,
      status: 'done',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });

    const secondReport = agentReport({ actions: ['Run the backfill.'] });
    const second = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-11T00:00:00.000Z',
      report: secondReport
    });
    const result = await insertDeliveryMissionItems(db, {
      delivery: second,
      report: secondReport,
      attribution
    });
    assert.equal(result.superseded.length, 1);
    const statuses = (await itemsOf(db, first.id)).map(item => [item.text, item.status]).sort();
    assert.deepEqual(statuses, [
      ['Add metrics', 'open'],
      ['Risky.', 'open'],
      ['Rotate the key.', 'done'],
      ['Set FOO.', 'superseded']
    ]);
    assert.deepEqual(
      (await itemsOf(db, second.id)).map(item => item.status),
      ['open']
    );
    // Another objective's delivery never supersedes this one.
    const otherReport = agentReport({ actions: ['Elsewhere.'] });
    const other = await addDelivery(db, {
      objectiveId: 'ob',
      deliveredAt: '2026-11-12T00:00:00.000Z',
      report: otherReport
    });
    await insertDeliveryMissionItems(db, { delivery: other, report: otherReport, attribution });
    assert.deepEqual(
      (await itemsOf(db, second.id)).map(item => item.status),
      ['open']
    );
  });

  it('a reopen supersedes every open item of the objective’s earlier deliveries', async () => {
    const db = await setup();
    const report = agentReport({
      actions: ['Set FOO.'],
      risks: ['Risky.'],
      suggestions: ['A', 'B']
    });
    const delivery = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report
    });
    await insertDeliveryMissionItems(db, { delivery, report, attribution });
    const suggestionA = (await itemsOf(db, delivery.id)).find(item => item.text === 'A')!;
    await closeMissionItem(db, {
      itemId: suggestionA.id,
      status: 'dismissed',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    const changesBefore = await changeCount(db);

    await db.run(`UPDATE objectives SET reopened_at = ? WHERE id = 'oa'`, [
      '2026-11-10T12:00:00.000Z'
    ]);
    const superseded = await applyMissionItemSupersedeRules(db, { objectiveId: 'oa', attribution });
    assert.equal(superseded.length, 3);
    assert.equal(await changeCount(db), changesBefore + 3);
    assert.deepEqual(
      (await itemsOf(db, delivery.id)).map(item => [item.text, item.status]).sort(),
      [
        ['A', 'dismissed'],
        ['B', 'superseded'],
        ['Risky.', 'superseded'],
        ['Set FOO.', 'superseded']
      ]
    );
    // Applying the rules again changes nothing.
    assert.deepEqual(
      await applyMissionItemSupersedeRules(db, { objectiveId: 'oa', attribution }),
      []
    );
  });

  it('reconciles a later presentation without losing decisions', async () => {
    const db = await setup();
    const deterministic = agentReport({
      actions: ['Set FOO.'],
      risks: ['Old wording.', 'Kept closed.'],
      suggestions: ['Add metrics', 'Filtered out']
    });
    const delivery = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report: deterministic
    });
    await insertDeliveryMissionItems(db, { delivery, report: deterministic, attribution });
    const before = await itemsOf(db, delivery.id);
    const closedRisk = before.find(item => item.text === 'Kept closed.')!;
    await closeMissionItem(db, {
      itemId: closedRisk.id,
      status: 'done',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    const action = before.find(item => item.kind === 'human_action')!;

    const composed: DeliveryReportPayloadV1 = {
      ...deterministic,
      presentation: {
        ...deterministic.presentation,
        status: 'composed',
        generatedBy: 'gemini',
        humanActions: [
          { ...deterministic.presentation.humanActions[0]!, action: 'Set FOO on production.' },
          {
            id: 'rule-action-1',
            action: 'Apply the database migration(s) included in this delivery.',
            category: 'database',
            source: 'deterministic_rule',
            sourceRef: 'database/x.sql'
          }
        ],
        knownRisks: ['New wording.'],
        deferredWork: deterministic.presentation.deferredWork.slice(0, 1)
      }
    };
    const result = await reconcileDeliveryMissionItems(db, {
      delivery,
      report: composed,
      attribution
    });
    assert.equal(result.inserted.length, 2, 'rule action and reworded risk');
    assert.deepEqual(result.updated, [action.id]);
    assert.equal(result.deleted.length, 2, 'old risk wording and filtered suggestion');

    const after = await itemsOf(db, delivery.id);
    assert.deepEqual(after.map(item => [item.kind, item.text, item.status]).sort(), [
      ['human_action', 'Apply the database migration(s) included in this delivery.', 'open'],
      ['human_action', 'Set FOO on production.', 'open'],
      ['risk', 'Kept closed.', 'done'],
      ['risk', 'New wording.', 'open'],
      ['suggestion', 'Add metrics', 'open']
    ]);
    const updatedAction = after.find(item => item.id === action.id)!;
    assert.equal(updatedAction.revision, 2);
    const deleteChanges = await db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM entity_changes
        WHERE entity_type = 'mission_item' AND operation = 'delete'`
    );
    assert.equal(Number(deleteChanges?.total), 2);

    // Reconciling again is a no-op.
    assert.deepEqual(
      await reconcileDeliveryMissionItems(db, { delivery, report: composed, attribution }),
      { inserted: [], updated: [], deleted: [], superseded: [] }
    );
  });

  it('an action added to a delivery that is no longer current is superseded at once', async () => {
    const db = await setup();
    const report = agentReport({ actions: ['Set FOO.'] });
    const older = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report
    });
    await insertDeliveryMissionItems(db, { delivery: older, report, attribution });
    const newer = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-11T00:00:00.000Z',
      report
    });
    await insertDeliveryMissionItems(db, { delivery: newer, report, attribution });

    const composed: DeliveryReportPayloadV1 = {
      ...report,
      presentation: {
        ...report.presentation,
        status: 'fallback',
        humanActions: [
          ...report.presentation.humanActions,
          {
            id: 'rule-action-1',
            action: 'Install the new dependencies.',
            category: 'packaging',
            source: 'deterministic_rule',
            sourceRef: 'package.json'
          }
        ]
      }
    };
    const result = await reconcileDeliveryMissionItems(db, {
      delivery: older,
      report: composed,
      attribution
    });
    assert.equal(result.inserted.length, 1);
    assert.deepEqual(result.superseded, result.inserted);
    assert.deepEqual(
      (await itemsOf(db, older.id)).map(item => item.status),
      ['superseded', 'superseded']
    );
  });
});

describe('closing and restoring items', () => {
  async function seededItem(db: DatabaseClient, kind: 'risk' | 'human_action' | 'suggestion') {
    const report = agentReport({
      actions: ['Set FOO.'],
      risks: ['Risky.'],
      suggestions: ['Add metrics']
    });
    const delivery = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report
    });
    await insertDeliveryMissionItems(db, { delivery, report, attribution });
    return { delivery, item: (await itemsOf(db, delivery.id)).find(item => item.kind === kind)! };
  }

  it('an agent closes an open item of its mission with a reason', async () => {
    const db = await setup();
    const { item } = await seededItem(db, 'risk');
    await assert.rejects(
      closeMissionItem(db, {
        itemId: item.id,
        missionId,
        status: 'done',
        resolver: { kind: 'agent', objectiveId: 'ob', deliveryId: 'dB2' },
        attribution
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'invalid_input'
    );
    await assert.rejects(
      closeMissionItem(db, {
        itemId: item.id,
        status: 'done',
        reason: 'x'.repeat(281),
        resolver: { kind: 'agent', objectiveId: 'ob', deliveryId: 'dB2' },
        attribution
      }),
      /at most 280/
    );
    const otherMission = await closeMissionItem(db, {
      itemId: item.id,
      missionId: otherMissionId,
      status: 'done',
      reason: 'Fixed.',
      resolver: { kind: 'agent', objectiveId: 'ox', deliveryId: null },
      attribution
    });
    assert.deepEqual(otherMission.ok ? null : otherMission.problem, 'other_mission');

    const closed = await closeMissionItem(db, {
      itemId: item.id,
      missionId,
      status: 'done',
      reason: '  Fixed by the retry guard.  ',
      resolver: { kind: 'agent', objectiveId: 'ob', deliveryId: 'dB2' },
      attribution
    });
    assert.ok(closed.ok);
    assert.equal(closed.item.status, 'done');
    assert.equal(closed.item.statusReason, 'Fixed by the retry guard.');
    assert.deepEqual(closed.item.resolvedBy, {
      kind: 'agent',
      objectiveId: 'ob',
      deliveryId: 'dB2',
      missionId,
      sessionId: null,
      missionDisplayId: 'w-items:1',
      objectiveDisplayId: 'w-items:1.bbbb'
    });
    assert.ok(closed.item.resolvedAt);
    assert.equal(closed.item.revision, 2);
    assert.equal(await changeCount(db, item.id), 2);

    const again = await closeMissionItem(db, {
      itemId: item.id,
      missionId,
      status: 'dismissed',
      reason: 'No longer applies.',
      resolver: { kind: 'agent', objectiveId: 'ob', deliveryId: 'dB2' },
      attribution
    });
    assert.deepEqual(again.ok ? null : again.problem, 'not_open');
    const missing = await closeMissionItem(db, {
      itemId: 'nope',
      status: 'done',
      reason: 'x',
      resolver: { kind: 'agent', objectiveId: null, deliveryId: null },
      attribution
    });
    assert.deepEqual(missing.ok ? null : missing.problem, 'not_found');
  });

  it('a person may re-decide a closed item and promote a suggestion', async () => {
    const db = await setup();
    const { item } = await seededItem(db, 'suggestion');
    const dismissed = await closeMissionItem(db, {
      itemId: item.id,
      status: 'dismissed',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    assert.ok(dismissed.ok);
    assert.equal(dismissed.item.statusReason, null);
    await assert.rejects(
      closeMissionItem(db, {
        itemId: item.id,
        status: 'dismissed',
        outcome: 'mission_created',
        resolver: { kind: 'person', workspaceUserId: PERSON },
        attribution
      }),
      /outcome requires status 'done'/
    );
    const promoted = await closeMissionItem(db, {
      itemId: item.id,
      status: 'done',
      outcome: 'mission_created',
      outcomeRef: 'w-items:9',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    assert.ok(promoted.ok);
    assert.deepEqual(
      [
        promoted.item.status,
        promoted.item.outcome,
        promoted.item.outcomeRef,
        promoted.item.resolvedBy
      ],
      ['done', 'mission_created', 'w-items:9', { kind: 'person', workspaceUserId: PERSON }]
    );
  });

  it('restore reopens a closed item and clears its resolver; a superseded item is never restored', async () => {
    const db = await setup();
    const { item } = await seededItem(db, 'human_action');
    const untouched = await restoreMissionItem(db, { itemId: item.id, attribution });
    assert.ok(untouched.ok && !untouched.changed);

    await closeMissionItem(db, {
      itemId: item.id,
      status: 'done',
      reason: 'Done in staging.',
      outcome: null,
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    const restored = await restoreMissionItem(db, { itemId: item.id, missionId, attribution });
    assert.ok(restored.ok && restored.changed);
    assert.deepEqual(
      [
        restored.item.status,
        restored.item.statusReason,
        restored.item.resolvedBy,
        restored.item.resolvedAt,
        restored.item.outcome
      ],
      ['open', null, null, null, null]
    );

    await db.run(`UPDATE objectives SET reopened_at = ? WHERE id = 'oa'`, [
      '2026-11-10T12:00:00.000Z'
    ]);
    await applyMissionItemSupersedeRules(db, { objectiveId: 'oa', attribution });
    assert.equal((await getMissionItem(db, item.id))?.status, 'superseded');
    const refusedRestore = await restoreMissionItem(db, { itemId: item.id, attribution });
    assert.deepEqual(refusedRestore.ok ? null : refusedRestore.problem, 'superseded');
    const refusedAgentClose = await closeMissionItem(db, {
      itemId: item.id,
      status: 'done',
      reason: 'Handled.',
      resolver: { kind: 'agent', objectiveId: 'oa', deliveryId: null },
      attribution
    });
    assert.deepEqual(refusedAgentClose.ok ? null : refusedAgentClose.problem, 'superseded');

    // A person may still decide it, as an old delivery card allows; restoring
    // that decision re-applies the supersede rules instead of reopening it.
    const personClose = await closeMissionItem(db, {
      itemId: item.id,
      status: 'dismissed',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    assert.equal(personClose.ok && personClose.item.status, 'dismissed');
    const backToSuperseded = await restoreMissionItem(db, { itemId: item.id, attribution });
    assert.ok(backToSuperseded.ok && backToSuperseded.changed);
    assert.equal(backToSuperseded.item.status, 'superseded');
    assert.equal(backToSuperseded.item.resolvedBy, null);
  });
});

describe('listMissionItems', () => {
  it('reads one mission or one project, by kind and status, newest delivery first', async () => {
    const db = await setup();
    const older = agentReport({ risks: ['Older risk.'], suggestions: ['Older suggestion'] });
    const newer = agentReport({ actions: ['Newer action.'], risks: ['Newer risk.'] });
    const first = await addDelivery(db, {
      objectiveId: 'oa',
      deliveredAt: '2026-11-10T00:00:00.000Z',
      report: older
    });
    await insertDeliveryMissionItems(db, { delivery: first, report: older, attribution });
    const second = await addDelivery(db, {
      objectiveId: 'ob',
      deliveredAt: '2026-11-11T00:00:00.000Z',
      report: newer
    });
    await insertDeliveryMissionItems(db, { delivery: second, report: newer, attribution });
    const elsewhere = agentReport({ risks: ['Other mission risk.'] });
    const other = await addDelivery(db, {
      objectiveId: 'ox',
      deliveredAt: '2026-11-12T00:00:00.000Z',
      report: elsewhere,
      mission: otherMissionId
    });
    await insertDeliveryMissionItems(db, { delivery: other, report: elsewhere, attribution });

    const all = await listMissionItems(db, { missionId });
    assert.deepEqual(
      all.items.map(item => item.text),
      ['Newer action.', 'Newer risk.', 'Older risk.', 'Older suggestion']
    );
    assert.equal(all.truncated, false);

    const risks = await listMissionItems(db, { missionId, kinds: ['risk'] });
    assert.deepEqual(
      risks.items.map(item => item.text),
      ['Newer risk.', 'Older risk.']
    );

    const limited = await listMissionItems(db, { missionId, limit: 2 });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.truncated, true);
    const next = await listMissionItems(db, { missionId, limit: 2, offset: 2 });
    assert.deepEqual(next.items, all.items.slice(2));
    assert.equal(next.truncated, false);

    const project = await listMissionItems(db, { projectId, kinds: ['risk'] });
    assert.deepEqual(
      project.items.map(item => item.text),
      ['Other mission risk.', 'Newer risk.', 'Older risk.']
    );

    const olderRisk = all.items.find(item => item.text === 'Older risk.')!;
    await closeMissionItem(db, {
      itemId: olderRisk.id,
      status: 'dismissed',
      resolver: { kind: 'person', workspaceUserId: PERSON },
      attribution
    });
    assert.deepEqual(
      (await listMissionItems(db, { missionId, kinds: ['risk'] })).items.map(item => item.text),
      ['Newer risk.']
    );
    assert.deepEqual(
      (await listMissionItems(db, { missionId, statuses: ['dismissed'] })).items.map(
        item => item.id
      ),
      [olderRisk.id]
    );

    // A deleted delivery's items are never listed.
    await db.run(`UPDATE deliveries SET deleted_at = ? WHERE id = ?`, [
      '2026-11-13T00:00:00.000Z',
      second.id
    ]);
    assert.deepEqual(
      (await listMissionItems(db, { missionId })).items.map(item => item.text),
      ['Older suggestion']
    );
    await assert.rejects(
      listMissionItems(db, { missionId, statuses: ['resolved' as never] }),
      /Unknown mission item status/
    );
  });
});

describe('backfill against the JSON-derived lists', () => {
  async function backfilledFixture(): Promise<DatabaseClient> {
    const Database = loadBetterSqlite3();
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    migrateDatabase(raw, { stopBeforeVersion: MISSION_ITEMS_MIGRATION_VERSION });
    const db = createSqliteClient(raw);
    await seedMissionItemsFixture(db);
    migrateDatabase(raw);
    return db;
  }

  it('open items equal what the summary route and the delivery cards show today', async () => {
    const db = await backfilledFixture();
    // Captured from the preceding JSON-derived implementation on this fixture.
    // Closed promotions were shown as resolved; the new open list deliberately excludes them.
    const { items: open } = await listMissionItems(db, { missionId });
    const texts = (kind: MissionItem['kind']) =>
      [
        ...new Set(
          open
            .filter(item => item.kind === kind)
            .map(item => item.text.trim().replace(/\s+/g, ' ').toLowerCase())
        )
      ].sort();
    assert.deepEqual(texts('human_action'), [
      'apply the database migration(s) included in this delivery.',
      'rotate the new key.',
      'run the backfill.'
    ]);
    assert.deepEqual(texts('risk'), [
      'cache may serve stale rows.',
      'deleted-objective risk.',
      'new risk.',
      'retry storms under load.'
    ]);
    assert.deepEqual(texts('suggestion'), ['document the flag', 'split the worker']);
    const resolutionStatus = new Map([
      ['dA1:deferred-work-0-a1a1a1a1a1a1a1a1', 'done'],
      ['dB1:deferred-work-0-b1b1b1b1b1b1b1b1', 'dismissed'],
      ['dC1:deferred-work-0-c1c1c1c1c1c1c1c1', 'done']
    ]);

    // Delivery cards: every live delivery's deferred work keeps its resolution.
    const { items: everySuggestion } = await listMissionItems(db, {
      missionId,
      kinds: ['suggestion'],
      statuses: ['open', 'done', 'dismissed', 'superseded']
    });
    const tableResolution = new Map(
      everySuggestion.map(item => [
        `${item.deliveryId}:${item.itemRef}`,
        item.status === 'done' || item.status === 'dismissed' ? item.status : null
      ])
    );
    const cardResolution = new Map(
      FIXTURE_DELIVERIES.filter(delivery => !delivery.deleted).flatMap(delivery => {
        const report = readDeliveryReport({
          summary: 'Delivered.',
          deliveryReport: (delivery.payload as { deliveryReport?: unknown }).deliveryReport
        });
        return report.presentation.deferredWork.map(entry => {
          const status = resolutionStatus.get(`${delivery.id}:${entry.id}`) ?? null;
          return [`${delivery.id}:${entry.id}`, status] as const;
        });
      })
    );
    assert.deepEqual(tableResolution, cardResolution);
  });
});
