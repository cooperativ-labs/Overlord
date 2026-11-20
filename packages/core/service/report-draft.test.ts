import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import { attachSession, deliverSession, recordWork, updateSession } from './protocol.js';
import {
  listObjectiveReportDrafts,
  mergeDraftEvidence,
  parseReportDraftInput,
  readReportDraft,
  REPORT_DRAFT_CONFLICT,
  REPORT_DRAFT_FORBIDDEN,
  REPORT_DRAFT_LIMIT_EXCEEDED,
  REPORT_DRAFT_NOT_FOUND,
  REPORT_DRAFT_OPERATION_CONFLICT
} from './report-draft.js';
import { createSeededServiceContext, seedServiceOperator } from './test-helpers.js';

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

async function attachedMission(ctx: ServiceContext, name: string) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ instructions: `Work for ${name}` }]
  });
  const objectiveId = objectives[0]!.id;
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectiveId]);
  const attached = await attachSession({
    ctx,
    missionId: mission.displayId,
    objectiveId,
    agentIdentifier: 'claude'
  });
  return { project, mission, objectiveId, sessionKey: attached.sessionKey };
}

async function count(ctx: ServiceContext, sql: string, params: unknown[]): Promise<number> {
  const row = await ctx.db.get<{ n: number }>(sql, params as never[]);
  return Number(row?.n ?? 0);
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof ServiceError && error.code === code;
}

const risk = (entryId: string, text: string) => ({
  op: 'upsert' as const,
  entryId,
  kind: 'known_risk' as const,
  content: { text }
});

function batch(
  operationId: string,
  expectedRevision: number,
  operations: unknown[]
): { operationId: string; expectedRevision: number; operations: unknown[] } {
  return { operationId, expectedRevision, operations };
}

async function draftEvents(ctx: ServiceContext, missionId: string): Promise<number> {
  return await count(
    ctx,
    `SELECT COUNT(*) AS n FROM mission_events WHERE mission_id = ? AND type = 'update'`,
    [missionId]
  );
}

describe('report draft input validation (ADR 0078)', () => {
  it('requires a batch identity, a revision and bounded, well-formed operations', () => {
    assert.throws(() => parseReportDraftInput({ expectedRevision: 0, operations: [] }, 'update'));
    assert.throws(() =>
      parseReportDraftInput(
        { operationId: 'op-batch-0001', expectedRevision: 0, operations: [] },
        'update'
      )
    );
    assert.throws(() =>
      parseReportDraftInput(
        { operationId: 'op-batch-0001', expectedRevision: -1, operations: [risk('r1', 'x')] },
        'update'
      )
    );
    assert.throws(() =>
      parseReportDraftInput(
        {
          operationId: 'op-batch-0001',
          expectedRevision: 0,
          operations: [{ op: 'upsert', entryId: 'r1', kind: 'opinion', content: { text: 'x' } }]
        },
        'update'
      )
    );
    assert.throws(() =>
      parseReportDraftInput(
        {
          operationId: 'op-batch-0001',
          expectedRevision: 0,
          operations: [risk('r1', 'x'), risk('r1', 'y')]
        },
        'update'
      )
    );
    // Strict per-kind content: deferred work needs every field.
    assert.throws(() =>
      parseReportDraftInput(
        {
          operationId: 'op-batch-0001',
          expectedRevision: 0,
          operations: [
            { op: 'upsert', entryId: 'd1', kind: 'deferred_work', content: { title: 'x' } }
          ]
        },
        'update'
      )
    );
    // deliver carries no batch id of its own and may send no operations.
    assert.throws(() =>
      parseReportDraftInput({ operationId: 'op-batch-0001', expectedRevision: 0 }, 'deliver')
    );
    assert.deepEqual(parseReportDraftInput({ expectedRevision: 3 }, 'deliver'), {
      expectedRevision: 3,
      operations: []
    });
  });

  it('merges legacy final arrays by canonical content without truncating', () => {
    const merge = mergeDraftEvidence(
      [
        { entry_id: 'r1', kind: 'known_risk', content: { text: 'Cache may be stale' } },
        { entry_id: 'h1', kind: 'human_action', content: { action: 'git push the branch' } }
      ],
      {
        schemaVersion: 1,
        agentReport: { knownRisks: ['Cache may be stale', 'Index rebuild is slow'] }
      }
    );
    assert.deepEqual(merge.deliveryReport.agentReport.knownRisks, [
      'Cache may be stale',
      'Index rebuild is slow'
    ]);
    assert.deepEqual(
      merge.refs.map(ref => [ref.entryId, ref.ref]),
      [
        ['h1', null],
        ['r1', 'knownRisks[0]'],
        [null, 'knownRisks[1]']
      ]
    );
    assert.ok(merge.warnings.some(warning => warning.includes('draft entry h1')));

    const thirteen = Array.from({ length: 13 }, (_, index) => `Risk ${index}`);
    assert.throws(
      () => mergeDraftEvidence([], { schemaVersion: 1, agentReport: { knownRisks: thirteen } }),
      hasCode(REPORT_DRAFT_LIMIT_EXCEEDED)
    );
  });
});

describe('durable report draft batches (ADR 0078)', () => {
  it('records, inspects and seals evidence without creating live mission items early', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey, objectiveId } = await attachedMission(ctx, 'Draft Seal');

    const first = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-draft-0001', 0, [
        risk('risk-cache', 'Cache invalidation is untested on Postgres'),
        {
          op: 'upsert',
          entryId: 'action-env',
          kind: 'human_action',
          content: { action: 'Set FEATURE_X=1 in production', category: 'environment' }
        },
        {
          op: 'upsert',
          entryId: 'assume-1',
          kind: 'assumption',
          content: { text: 'Single region' }
        }
      ])
    });
    assert.equal(first.reportDraft?.revision, 1);
    assert.equal(first.reportDraft?.activeCounts?.known_risk, 1);

    // Provisional evidence never becomes a live mission item.
    assert.equal(
      await count(ctx, `SELECT COUNT(*) AS n FROM mission_items WHERE mission_id = ?`, [
        mission.id
      ]),
      0
    );
    const event = await ctx.db.get<{ summary: string; payload_json: string }>(
      `SELECT summary, payload_json FROM mission_events WHERE id = ?`,
      [first.eventId]
    );
    assert.match(event!.summary, /Draft report evidence: 3 recorded/);
    assert.equal(JSON.parse(event!.payload_json).reportDraft.revision, 1);
    assert.doesNotMatch(event!.payload_json, /Cache invalidation/);

    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Resolved the assumption.',
      reportDraft: batch('op-draft-0002', 1, [
        { op: 'withdraw', entryId: 'assume-1', reason: 'Confirmed multi-region support' }
      ])
    });

    const read = await readReportDraft({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      includeWithdrawn: true
    });
    assert.equal(read.revision, 2);
    assert.equal(read.draft?.state, 'open');
    assert.deepEqual(
      read.draft?.entries.map(entry => entry.entryId),
      ['risk-cache', 'action-env']
    );
    assert.equal(read.draft?.withdrawn?.[0]?.withdrawnReason, 'Confirmed multi-region support');
    assert.deepEqual(read.inspection?.agentReport.knownRisks, [
      'Cache invalidation is untested on Postgres'
    ]);
    assert.equal(read.inspection?.agentReport.assumptions.length, 0);

    // A session with a draft must deliver against the revision it inspected.
    await assert.rejects(
      deliverSession({ ctx, missionId: mission.displayId, sessionKey, summary: 'Done.' }),
      (error: unknown) =>
        hasCode(REPORT_DRAFT_CONFLICT)(error) &&
        (error as ServiceError & { details: { currentRevision: number } }).details
          .currentRevision === 2
    );
    await assert.rejects(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Done.',
        reportDraft: { expectedRevision: 1 }
      }),
      hasCode(REPORT_DRAFT_CONFLICT)
    );
    const draftBefore = await ctx.db.get<{ sealed_at: string | null }>(
      `SELECT sealed_at FROM delivery_report_drafts WHERE objective_id = ?`,
      [objectiveId]
    );
    assert.equal(draftBefore?.sealed_at, null, 'a failed delivery leaves the draft open');

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      operationId: 'op-deliver-draft-1',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            knownRisks: ['Cache invalidation is untested on Postgres'],
            tradeoffsMade: [{ decision: 'Kept SQLite triggers', rationale: 'Parity with Postgres' }]
          }
        }
      },
      reportDraft: {
        expectedRevision: 2,
        operations: [
          {
            op: 'upsert',
            entryId: 'deferred-1',
            kind: 'deferred_work',
            content: {
              title: 'Add a draft retention dashboard',
              change: 'Chart batch counts per draft.',
              location: 'webapp/web/components/drafts',
              doneWhen: 'Operators can see retained batches per draft.'
            }
          }
        ]
      }
    });
    assert.equal(delivered.reportDraft?.sealed, true);
    assert.deepEqual(
      delivered.reportDraft?.refs.map(ref => [ref.entryId, ref.ref]),
      [
        ['risk-cache', 'knownRisks[0]'],
        ['action-env', 'human-action-1'],
        ['deferred-1', delivered.reportDraft?.refs[2]?.ref]
      ]
    );
    assert.match(delivered.reportDraft!.refs[2]!.ref!, /^deferred-work-0-/);

    const stored = await ctx.db.get<{ payload_json: string }>(
      `SELECT payload_json FROM deliveries WHERE id = ?`,
      [delivered.deliveryId]
    );
    const payload = JSON.parse(stored!.payload_json);
    assert.equal(payload.reportDraft, undefined, 'reportDraft is never stored in the payload');
    assert.deepEqual(payload.deliveryReport.agentReport.knownRisks, [
      'Cache invalidation is untested on Postgres'
    ]);
    assert.equal(payload.deliveryReport.agentReport.tradeoffsMade.length, 1);
    assert.equal(payload.deliveryReport.agentReport.humanActions[0].id, 'human-action-1');
    assert.equal(payload.deliveryReport.agentReport.assumptions.length, 0);

    // Only the accepted delivery evidence created live items.
    const items = await ctx.db.all<{ kind: string; delivery_id: string }>(
      `SELECT kind, delivery_id FROM mission_items WHERE mission_id = ?`,
      [mission.id]
    );
    assert.ok(items.length > 0);
    assert.ok(items.every(item => item.delivery_id === delivered.deliveryId));

    // Sealed drafts are immutable: in the service and in the database.
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'More.',
        reportDraft: batch('op-draft-0003', 3, [risk('late', 'Too late')])
      }),
      hasCode('delivery_boundary')
    );
    await assert.rejects(
      ctx.db.run(`UPDATE delivery_report_draft_entries SET content_json = '{}'`, [])
    );
    const sealedRead = await readReportDraft({ ctx, missionId: mission.displayId, sessionKey });
    assert.equal(sealedRead.draft?.state, 'sealed');
    assert.equal(sealedRead.draft?.sealedDeliveryId, delivered.deliveryId);
    assert.equal(sealedRead.inspection, null);

    // A lost deliver response replays the sealed result without resealing.
    const replay = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      operationId: 'op-deliver-draft-1',
      payloadJson: {
        deliveryReport: {
          schemaVersion: 1,
          agentReport: {
            knownRisks: ['Cache invalidation is untested on Postgres'],
            tradeoffsMade: [{ decision: 'Kept SQLite triggers', rationale: 'Parity with Postgres' }]
          }
        }
      },
      reportDraft: {
        expectedRevision: 2,
        operations: [
          {
            op: 'upsert',
            entryId: 'deferred-1',
            kind: 'deferred_work',
            content: {
              title: 'Add a draft retention dashboard',
              change: 'Chart batch counts per draft.',
              location: 'webapp/web/components/drafts',
              doneWhen: 'Operators can see retained batches per draft.'
            }
          }
        ]
      }
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.deliveryId, delivered.deliveryId);
    assert.deepEqual(replay.reportDraft, delivered.reportDraft);

    const projection = await listObjectiveReportDrafts(ctx.db, {
      workspaceId: ctx.workspace.id,
      objectiveId
    });
    assert.equal(projection.length, 1);
    assert.equal(projection[0]?.state, 'sealed');
    assert.equal(projection[0]?.withdrawn?.length, 1);
    await db.close();
  });

  it('A commits with a lost response, B edits, replaying A returns A without overwriting B', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Draft ABA');
    const batchA = {
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Noted a risk.',
      reportDraft: batch('op-batch-a-001', 0, [risk('risk-1', 'Original wording')])
    };
    const a = await updateSession(batchA);
    const b = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Refined the risk.',
      reportDraft: batch('op-batch-b-001', 1, [risk('risk-1', 'Refined wording')])
    });
    assert.equal(b.reportDraft?.revision, 2);
    const eventsBefore = await draftEvents(ctx, mission.id);

    const replayA = await updateSession(batchA);
    assert.equal(replayA.eventId, a.eventId);
    assert.equal(replayA.reportDraft?.revision, 1);
    assert.equal(replayA.reportDraft?.replayed, true);
    assert.equal(replayA.reportDraft?.currentRevision, 2);
    assert.equal(await draftEvents(ctx, mission.id), eventsBefore, 'no duplicate event');
    const read = await readReportDraft({ ctx, missionId: mission.displayId, sessionKey });
    assert.equal(read.revision, 2);
    assert.deepEqual(read.draft?.entries[0]?.content, { text: 'Refined wording' });

    // Same id, different body: refused, nothing written.
    await assert.rejects(
      updateSession({
        ...batchA,
        reportDraft: batch('op-batch-a-001', 0, [risk('risk-1', 'Tampered')])
      }),
      hasCode(REPORT_DRAFT_OPERATION_CONFLICT)
    );

    // A stale revision returns the fresh draft and applies nothing.
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-batch-c-001', 1, [risk('risk-2', 'Another')])
      }),
      (error: unknown) => {
        if (!hasCode(REPORT_DRAFT_CONFLICT)(error)) return false;
        const details = (error as ServiceError).details as {
          currentRevision: number;
          draft: { entries: unknown[] };
        };
        return details.currentRevision === 2 && details.draft.entries.length === 1;
      }
    );

    // After sealing and session end, the replay is still a receipt read.
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      reportDraft: { expectedRevision: 2 }
    });
    const afterSeal = await updateSession(batchA);
    assert.equal(afterSeal.eventId, a.eventId);
    assert.equal(afterSeal.reportDraft?.revision, 1);
    assert.equal(afterSeal.reportDraft?.currentRevision, 3);
    assert.equal(await draftEvents(ctx, mission.id), eventsBefore);
    // ...but never regains update authority.
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-batch-d-001', 3, [risk('risk-3', 'After seal')])
      }),
      hasCode('delivery_boundary')
    );
    await db.close();
  });

  it('serializes an update and a deliver racing on the same session', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Draft Race');
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-race-00001', 0, [risk('r1', 'First')])
    });
    const results = await Promise.allSettled([
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-race-00002', 1, [risk('r2', 'Second')])
      }),
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Done.',
        reportDraft: { expectedRevision: 1 }
      })
    ]);
    const [update, deliver] = results;
    // Exactly one order happened: either the update landed first (and the
    // delivery saw a stale revision) or the delivery sealed first (and the
    // update hit the delivery boundary).
    assert.notEqual(update.status === 'fulfilled', deliver.status === 'fulfilled');
    const sealed = await ctx.db.get<{ sealed_at: string | null; revision: number }>(
      `SELECT sealed_at, revision FROM delivery_report_drafts WHERE mission_id = ?`,
      [mission.id]
    );
    if (deliver.status === 'fulfilled') {
      assert.ok(sealed?.sealed_at);
    } else {
      assert.equal(sealed?.sealed_at, null);
      assert.equal(Number(sealed?.revision), 2);
    }
    await db.close();
  });

  it('enforces active-per-kind and retained-history bounds without pruning', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Draft Bounds');
    const twelve = Array.from({ length: 12 }, (_, index) => risk(`r${index}`, `Risk ${index}`));
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-bound-0001', 0, twelve)
    });
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-bound-0002', 1, [risk('r12', 'Thirteenth')])
      }),
      hasCode(REPORT_DRAFT_LIMIT_EXCEEDED)
    );
    // Withdrawn entries do not count toward the active limit.
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-bound-0003', 1, [
        { op: 'withdraw', entryId: 'r0', reason: 'Resolved' },
        risk('r12', 'Thirteenth')
      ])
    });
    // Once 1,000 batches are retained, new batches are refused; receipts still replay.
    await ctx.db.run(`UPDATE delivery_report_drafts SET batch_count = 1000 WHERE mission_id = ?`, [
      mission.id
    ]);
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-bound-0004', 2, [risk('r1', 'Edited')])
      }),
      hasCode(REPORT_DRAFT_LIMIT_EXCEEDED)
    );
    const replay = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-bound-0001', 0, twelve)
    });
    assert.equal(replay.reportDraft?.replayed, true);
    // Finalization is still possible at the bound.
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: 'Done.',
      reportDraft: { expectedRevision: 2 }
    });
    assert.equal(delivered.reportDraft?.activeEntries, 12);
    await db.close();
  });

  it('refuses a merged final report over the limit and leaves the draft open', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Draft Merge Limit');
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch(
        'op-merge-0001',
        0,
        Array.from({ length: 10 }, (_, index) => risk(`r${index}`, `Draft risk ${index}`))
      )
    });
    await assert.rejects(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: 'Done.',
        payloadJson: {
          deliveryReport: {
            schemaVersion: 1,
            agentReport: { knownRisks: ['Legacy A', 'Legacy B', 'Legacy C'] }
          }
        },
        reportDraft: { expectedRevision: 1 }
      }),
      hasCode(REPORT_DRAFT_LIMIT_EXCEEDED)
    );
    assert.equal(
      await count(ctx, `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`, [mission.id]),
      0
    );
    const read = await readReportDraft({ ctx, missionId: mission.displayId, sessionKey });
    assert.equal(read.draft?.state, 'open');
    await db.close();
  });

  it('lets a replacement execution read and import abandoned observations explicitly', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey, objectiveId } = await attachedMission(ctx, 'Draft Import');
    const first = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-import-001', 0, [
        risk('risk-keep', 'Migration needs a backfill'),
        risk('risk-skip', 'Probably fine')
      ])
    });
    const abandonedDraftId = first.reportDraft!.draftId;

    // The replacement session cannot read a draft that is still open.
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectiveId]);
    const second = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId,
      agentIdentifier: 'claude'
    });
    await assert.rejects(
      readReportDraft({
        ctx,
        missionId: mission.displayId,
        sessionKey: second.sessionKey,
        draftId: abandonedDraftId
      }),
      hasCode(REPORT_DRAFT_NOT_FOUND)
    );

    // The first execution ends without delivering.
    await ctx.db.run(`UPDATE agent_sessions SET ended_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      (await ctx.db.get<{ session_id: string }>(
        `SELECT session_id FROM delivery_report_drafts WHERE id = ?`,
        [abandonedDraftId]
      ))!.session_id
    ]);
    const read = await readReportDraft({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey
    });
    assert.equal(read.draft, null);
    assert.equal(read.abandoned[0]?.draftId, abandonedDraftId);
    assert.equal(read.abandoned[0]?.activeEntryCount, 2);
    const abandoned = await readReportDraft({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      draftId: abandonedDraftId
    });
    assert.equal(abandoned.draft?.state, 'abandoned');
    assert.equal(abandoned.inspection, null);

    // A fresh attach advertises the abandoned draft in its compact baseline.
    const third = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId,
      agentIdentifier: 'claude'
    });
    assert.equal(third.reportDraft?.current, null);
    assert.equal(third.reportDraft?.abandoned[0]?.draftId, abandonedDraftId);

    const imported = await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      summary: '',
      reportDraft: batch('op-import-002', 0, [
        { op: 'import', sourceDraftId: abandonedDraftId, sourceEntryId: 'risk-keep' }
      ])
    });
    assert.notEqual(imported.reportDraft?.draftId, abandonedDraftId);
    const own = await readReportDraft({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey
    });
    assert.deepEqual(
      own.draft?.entries.map(entry => entry.importedFrom),
      [{ draftId: abandonedDraftId, entryId: 'risk-keep' }]
    );
    // The old draft keeps its observations and is never sealed by the new session.
    const old = await ctx.db.get<{ sealed_at: string | null }>(
      `SELECT sealed_at FROM delivery_report_drafts WHERE id = ?`,
      [abandonedDraftId]
    );
    assert.equal(old?.sealed_at, null);
    // The abandoned session's key gives no write authority.
    await assert.rejects(
      updateSession({
        ctx,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-import-003', 1, [risk('risk-new', 'Nope')])
      }),
      hasCode('invalid_session')
    );
    await db.close();
  });

  it('re-attach of the same execution returns its compact draft baseline', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey } = await attachedMission(ctx, 'Draft Reattach');
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-reatt-0001', 0, [risk('r1', 'Noted')])
    });
    const reattached = await attachSession({
      ctx,
      missionId: mission.displayId,
      existingSessionKey: sessionKey,
      agentIdentifier: 'claude'
    });
    assert.equal(reattached.reportDraft?.current?.revision, 1);
    assert.equal(reattached.reportDraft?.current?.activeCounts.known_risk, 1);
    await db.close();
  });

  it('only the owning member writes the draft; record-work stays sessionless', async () => {
    const { db, ctx } = await setup();
    const { mission, sessionKey, project } = await attachedMission(ctx, 'Draft Owner');
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey,
      summary: '',
      reportDraft: batch('op-owner-0001', 0, [risk('r1', 'Mine')])
    });
    const otherMember = await seedServiceOperator({
      db,
      profileId: 'draft-other-user',
      workspaceUserId: 'draft-other-workspace-user'
    });
    const other: ServiceContext = { ...ctx, actorWorkspaceUserId: otherMember };
    await assert.rejects(
      updateSession({
        ctx: other,
        missionId: mission.displayId,
        sessionKey,
        summary: '',
        reportDraft: batch('op-owner-0002', 1, [risk('r2', 'Theirs')])
      }),
      hasCode(REPORT_DRAFT_FORBIDDEN)
    );
    await assert.rejects(
      recordWork({
        ctx,
        projectId: project.id,
        summary: 'Retrospective work.',
        objective: 'Retrospective objective',
        payloadJson: { reportDraft: { expectedRevision: 0 } }
      }),
      hasCode('invalid_input')
    );
    await db.close();
  });
});
