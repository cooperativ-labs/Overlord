import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';
import {
  MISSION_SUMMARY_CLOSE_ITEMS_MAX,
  type MissionSummaryBaseline,
  parseMissionSummaryInput
} from './mission-summary-agent.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  attachSession,
  deliverSession,
  loadMissionContext,
  MISSION_SUMMARY_INSTRUCTIONS,
  recordWork,
  resumeFollowUp
} from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { enqueueMissionSummaryComposeJob } from './worker-jobs.js';

/**
 * The agent-facing mission summary surface (coo:1260.shmg): the attach
 * baseline, validation of `missionSummary`, the narrative and close writes in
 * the delivery transaction, and the stale-base conflict.
 */

const report = (tag: string) => ({
  deliveryReport: {
    schemaVersion: 1,
    agentReport: {
      humanActions: [
        {
          action: `Run the ${tag} migration in production.`,
          reason: 'The table is missing until it runs.',
          category: 'database',
          blocking: true
        }
      ],
      knownRisks: [`The ${tag} backfill is slow on large workspaces.`],
      deferredWork: [
        {
          title: `Add a ${tag} progress bar`,
          change: 'Show backfill progress.',
          location: 'database/src/backfill.ts',
          doneWhen: 'Progress is visible.'
        }
      ]
    }
  }
});

async function missionWith(ctx: ServiceContext, name: string, objectiveCount = 1) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: Array.from({ length: objectiveCount }, (_, index) => ({
      objective: `Work ${index + 1} for ${name}`
    }))
  });
  for (const objective of objectives) {
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objective.id]);
  }
  return { project, mission, objectives };
}

async function summaryRow(ctx: ServiceContext, missionId: string) {
  return ctx.db.get<{
    status: string;
    headline: string;
    summary_markdown: string;
    generated_by: string;
    model: string | null;
    content_revision: number | string;
    narrative_delivery_id: string | null;
    narrative_objective_id: string | null;
    requested_generation: number | string;
    completed_generation: number | string;
  }>(
    `SELECT status, headline, summary_markdown, generated_by, model, content_revision,
            narrative_delivery_id, narrative_objective_id, requested_generation, completed_generation
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
}

async function openItemIds(ctx: ServiceContext, missionId: string, kind: string) {
  return (
    await ctx.db.all<{ id: string }>(
      `SELECT id FROM mission_items WHERE mission_id = ? AND kind = ? AND status = 'open'`,
      [missionId, kind]
    )
  ).map(row => row.id);
}

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ServiceError, String(error));
    return error;
  }
  assert.fail('expected the call to reject');
}

describe('parseMissionSummaryInput', () => {
  const ok = { baseContentRevision: 0, headline: 'Done.', summary: 'It works.' };

  it('returns null for absent or empty input', () => {
    assert.equal(parseMissionSummaryInput(undefined, { requireBase: true }), null);
    assert.equal(parseMissionSummaryInput(null, { requireBase: true }), null);
    assert.equal(parseMissionSummaryInput({}, { requireBase: true }), null);
  });

  it('accepts prose with a base, and close entries alone', () => {
    assert.deepEqual(parseMissionSummaryInput(ok, { requireBase: true }), {
      baseContentRevision: 0,
      narrative: { headline: 'Done.', summary: 'It works.' },
      closeItems: []
    });
    assert.deepEqual(
      parseMissionSummaryInput(
        { closeItems: [{ id: ' a ', status: 'done', reason: ' Fixed. ' }] },
        { requireBase: true }
      ),
      {
        baseContentRevision: null,
        narrative: null,
        closeItems: [{ id: 'a', status: 'done', reason: 'Fixed.' }]
      }
    );
  });

  it('rejects malformed, partial and over-long input with invalid_input', () => {
    const cases: unknown[] = [
      'text',
      [],
      { ...ok, extra: true },
      { ...ok, baseContentRevision: -1 },
      { ...ok, baseContentRevision: 1.5 },
      { baseContentRevision: 0, headline: 'Only a headline.' },
      { ...ok, headline: '' },
      { ...ok, headline: 'Two\nlines.' },
      { ...ok, headline: 'x'.repeat(141) },
      { ...ok, summary: 'x'.repeat(1_201) },
      { headline: 'No base.', summary: 'Missing base.' },
      { closeItems: 'a' },
      { closeItems: [{ id: 'a', status: 'done' }] },
      { closeItems: [{ id: 'a', status: 'done', reason: '   ' }] },
      { closeItems: [{ id: 'a', status: 'open', reason: 'r' }] },
      { closeItems: [{ id: '', status: 'done', reason: 'r' }] },
      { closeItems: [{ id: 'a', status: 'done', reason: 'x'.repeat(281) }] },
      { closeItems: [{ id: 'a', status: 'done', reason: 'r', note: 'x' }] },
      {
        closeItems: Array.from({ length: MISSION_SUMMARY_CLOSE_ITEMS_MAX + 1 }, (_, i) => ({
          id: `i${i}`,
          status: 'done',
          reason: 'r'
        }))
      }
    ];
    for (const value of cases) {
      assert.throws(
        () => parseMissionSummaryInput(value, { requireBase: true }),
        (error: unknown) => error instanceof ServiceError && error.code === 'invalid_input',
        JSON.stringify(value).slice(0, 120)
      );
    }
  });

  it('record-work needs no base', () => {
    const parsed = parseMissionSummaryInput(
      { headline: 'Done.', summary: 'It works.' },
      { requireBase: false }
    );
    assert.equal(parsed?.baseContentRevision, null);
  });
});

describe('mission summary on attach', () => {
  it('attach and resume-follow-up return the baseline; load-context does not', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Baseline Attach', 2);

    const first = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    assert.deepEqual(first.missionSummary, {
      contentRevision: 0,
      headline: '',
      summary: '',
      author: null,
      openItems: [],
      truncated: false
    });
    assert.ok(first.agentInstructions.includes('## Mission summary'));
    assert.ok(first.agentInstructions.includes(MISSION_SUMMARY_INSTRUCTIONS));

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: first.sessionKey,
      summary: 'Added the table.',
      payloadJson: report('first'),
      missionSummary: { baseContentRevision: 0, headline: 'The table exists.', summary: 'Tested.' }
    });

    const second = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    const baseline = second.missionSummary!;
    assert.equal(baseline.contentRevision, 1);
    assert.equal(baseline.headline, 'The table exists.');
    assert.equal(baseline.author, 'agent');
    assert.deepEqual(
      baseline.openItems.map(item => [item.kind, item.objective, item.blocking]).sort(),
      [
        ['human_action', objectives[0]!.displayId, true],
        ['risk', objectives[0]!.displayId, undefined],
        ['suggestion', objectives[0]!.displayId, undefined]
      ].sort()
    );

    const context = await loadMissionContext({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    assert.equal('missionSummary' in context, false);
    assert.equal(context.agentInstructions.includes('## Mission summary'), false);

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      summary: 'Second.'
    });
    const resumed = await resumeFollowUp({ ctx, missionId: mission.displayId });
    assert.equal(resumed.missionSummary?.contentRevision, 1);
    assert.ok(resumed.agentInstructions.includes('## Mission summary'));
    await db.close();
  });

  it('a mission without a summary gets no baseline and no instructions block', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission } = await missionWith(ctx, 'Baseline Disabled');
    await ctx.db.run(`UPDATE missions SET summary_enabled = ? WHERE id = ?`, [
      ctx.db.dialect === 'postgres' ? false : 0,
      mission.id
    ]);
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    assert.equal(attached.missionSummary, undefined);
    assert.equal(attached.agentInstructions.includes('## Mission summary'), false);

    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Done.',
      missionSummary: { baseContentRevision: 0, headline: 'Done.', summary: 'Works.' }
    });
    assert.equal(delivered.missionSummary?.narrativeWritten, false);
    assert.equal(delivered.missionSummary?.contentRevision, null);
    assert.deepEqual(
      delivered.missionSummary?.warnings.map(warning => warning.code),
      ['mission_summary_disabled']
    );
    assert.equal(await summaryRow(ctx, mission.id), undefined);
    await db.close();
  });
});

describe('mission summary on deliver', () => {
  it('writes agent prose at once and closes own-mission items with agent provenance', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Agent Write', 2);
    const other = await missionWith(ctx, 'Agent Write Other');

    const first = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: first.sessionKey,
      summary: 'First.',
      payloadJson: report('first')
    });
    const otherSession = await attachSession({ ctx, missionId: other.mission.displayId });
    await deliverSession({
      ctx,
      missionId: other.mission.displayId,
      sessionKey: otherSession.sessionKey,
      summary: 'Other.',
      payloadJson: report('other')
    });
    // A trigger from an earlier delivery left the row pending.
    await enqueueMissionSummaryComposeJob({ ctx, missionId: mission.id, reason: 'delivery' });
    assert.equal((await summaryRow(ctx, mission.id))?.status, 'pending');

    const [riskId] = await openItemIds(ctx, mission.id, 'risk');
    const [foreignId] = await openItemIds(ctx, other.mission.id, 'risk');
    const second = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id,
      modelIdentifier: 'claude-opus-5-5'
    });
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      summary: 'Second.',
      missionSummary: {
        baseContentRevision: second.missionSummary!.contentRevision,
        headline: 'The backfill is fast and tested.',
        summary: 'The backfill now runs in batches. It is tested and not deployed.',
        closeItems: [
          { id: riskId, status: 'done', reason: 'Batched in this objective.' },
          { id: riskId, status: 'done', reason: 'Listed twice.' },
          { id: foreignId, status: 'dismissed', reason: 'Not this mission.' },
          { id: 'no-such-item', status: 'dismissed', reason: 'Unknown.' }
        ]
      }
    });

    assert.deepEqual(delivered.missionSummary?.closedItemIds, [riskId]);
    assert.equal(delivered.missionSummary?.narrativeWritten, true);
    assert.equal(delivered.missionSummary?.contentRevision, 1);
    assert.deepEqual(
      delivered.missionSummary?.warnings
        .filter(warning => warning.code === 'mission_summary_item_skipped')
        .map(warning => warning.itemId),
      [riskId, foreignId, 'no-such-item']
    );

    const row = await summaryRow(ctx, mission.id);
    assert.equal(row?.status, 'composed');
    assert.equal(row?.generated_by, 'agent');
    assert.equal(row?.model, 'claude-opus-5-5');
    assert.equal(row?.headline, 'The backfill is fast and tested.');
    assert.equal(Number(row?.content_revision), 1);
    assert.equal(row?.narrative_delivery_id, delivered.deliveryId);
    assert.equal(row?.narrative_objective_id, objectives[1]!.id);
    assert.equal(Number(row?.completed_generation), Number(row?.requested_generation));

    const closed = await ctx.db.get<{
      status: string;
      status_reason: string;
      resolved_by_kind: string;
      resolved_by_objective_id: string;
      resolved_by_delivery_id: string;
    }>(
      `SELECT status, status_reason, resolved_by_kind, resolved_by_objective_id, resolved_by_delivery_id
         FROM mission_items WHERE id = ?`,
      [riskId]
    );
    assert.deepEqual(closed, {
      status: 'done',
      status_reason: 'Batched in this objective.',
      resolved_by_kind: 'agent',
      resolved_by_objective_id: objectives[1]!.id,
      resolved_by_delivery_id: delivered.deliveryId
    });
    assert.deepEqual(await openItemIds(ctx, other.mission.id, 'risk'), [foreignId]);
    const payload = await ctx.db.get<{ payload_json: string }>(
      `SELECT payload_json FROM deliveries WHERE id = ?`,
      [delivered.deliveryId]
    );
    assert.equal(JSON.parse(payload!.payload_json).missionSummary, undefined);

    // The fallback composer never overwrites the newest delivery's agent prose.
    const trigger = await enqueueMissionSummaryComposeJob({
      ctx,
      missionId: mission.id,
      reason: 'delivery'
    });
    assert.equal(trigger.triggered, false);
    assert.equal((await summaryRow(ctx, mission.id))?.status, 'composed');
    await db.close();
  });

  it('a stale base rejects the whole parallel delivery with a fresh baseline', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Parallel Conflict', 2);
    const a = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    const b = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    assert.equal(a.missionSummary?.contentRevision, 0);
    assert.equal(b.missionSummary?.contentRevision, 0);

    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: a.sessionKey,
      summary: 'A.',
      payloadJson: report('a'),
      missionSummary: { baseContentRevision: 0, headline: 'A landed.', summary: 'A is tested.' }
    });

    const error = await rejection(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey: b.sessionKey,
        summary: 'B.',
        payloadJson: report('b'),
        missionSummary: { baseContentRevision: 0, headline: 'B landed.', summary: 'B is tested.' }
      })
    );
    assert.equal(error.code, 'mission_summary_conflict');
    assert.equal(error.status, 409);
    const details = error.details as {
      baseContentRevision: number;
      missionSummary: MissionSummaryBaseline;
    };
    assert.equal(details.baseContentRevision, 0);
    assert.equal(details.missionSummary.contentRevision, 1);
    assert.equal(details.missionSummary.headline, 'A landed.');
    // The baseline never shows rows of the rejected delivery.
    assert.ok(
      details.missionSummary.openItems.every(item => item.objective === objectives[0]!.displayId)
    );

    const deliveries = await ctx.db.all<{ objective_id: string }>(
      `SELECT objective_id FROM deliveries WHERE mission_id = ?`,
      [mission.id]
    );
    assert.deepEqual(
      deliveries.map(row => row.objective_id),
      [objectives[0]!.id]
    );
    const state = await ctx.db.get<{ state: string }>(`SELECT state FROM objectives WHERE id = ?`, [
      objectives[1]!.id
    ]);
    assert.equal(state?.state, 'executing');

    // Retry once from the fresh base; the delivery then succeeds.
    const retried = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: b.sessionKey,
      summary: 'B.',
      missionSummary: {
        baseContentRevision: details.missionSummary.contentRevision,
        headline: 'A and B landed.',
        summary: 'Both are tested.'
      }
    });
    assert.equal(retried.missionSummary?.contentRevision, 2);
    await db.close();
  });

  it('close entries alone never conflict and need no base', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Close Only', 2);
    const a = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: a.sessionKey,
      summary: 'A.',
      payloadJson: report('a'),
      missionSummary: { baseContentRevision: 0, headline: 'A landed.', summary: 'Tested.' }
    });
    const [actionId] = await openItemIds(ctx, mission.id, 'human_action');
    const b = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: b.sessionKey,
      summary: 'B.',
      missionSummary: {
        closeItems: [{ id: actionId!, status: 'dismissed', reason: 'Migration ran in CI.' }]
      }
    });
    assert.deepEqual(delivered.missionSummary?.closedItemIds, [actionId]);
    assert.equal(delivered.missionSummary?.narrativeWritten, false);
    assert.equal(delivered.missionSummary?.contentRevision, 1);
    assert.equal((await summaryRow(ctx, mission.id))?.headline, 'A landed.');
    await db.close();
  });

  it('invalid input is rejected before any write', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission } = await missionWith(ctx, 'Invalid Input');
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    const error = await rejection(
      deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey: attached.sessionKey,
        summary: 'Done.',
        missionSummary: { baseContentRevision: 0, headline: 'x'.repeat(200), summary: 'ok' }
      })
    );
    assert.equal(error.code, 'invalid_input');
    const count = await ctx.db.get<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`,
      [mission.id]
    );
    assert.equal(Number(count?.n), 0);
    await db.close();
  });

  it('returns advisory style warnings for the prose', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission } = await missionWith(ctx, 'Style Warnings');
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Done.',
      missionSummary: {
        baseContentRevision: 0,
        headline: "It's done.",
        summary: 'The import works; the export is next.'
      }
    });
    const rules = delivered.missionSummary?.warnings
      .filter(warning => warning.code === 'mission_summary_style')
      .map(warning => warning.rule);
    assert.ok(rules?.includes('contraction'));
    assert.ok(rules?.includes('semicolon'));
    assert.equal(delivered.missionSummary?.narrativeWritten, true);
    await db.close();
  });
});

describe('mission summary on record-work', () => {
  it('writes the narrative on the new mission without a base check', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Record Work Summary' });
    const recorded = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Fix the export.',
      summary: 'Fixed the export.',
      missionSummary: { headline: 'The export works.', summary: 'Fixed and tested.' }
    });
    assert.equal(recorded.missionSummary?.narrativeWritten, true);
    const row = await summaryRow(ctx, recorded.mission.id);
    assert.equal(row?.generated_by, 'agent');
    assert.equal(row?.narrative_delivery_id, recorded.deliveryId);
    assert.equal(Number(row?.content_revision), 1);

    const plain = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Fix the import.',
      summary: 'Fixed the import.'
    });
    assert.equal(plain.missionSummary, undefined);
    assert.equal(await summaryRow(ctx, plain.mission.id), undefined);
    await db.close();
  });
});
