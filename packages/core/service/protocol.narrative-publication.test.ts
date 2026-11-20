import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import {
  publishDeliverySummary,
  readDeliverySummaryContext
} from './delivery-summary-publication.js';
import { ServiceError } from './errors.js';
import { advanceMissionNarrativeEvidence } from './mission-narrative.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject } from './projects.js';
import {
  askQuestion,
  attachSession,
  closeAgentMissionItems,
  deliverSession,
  recordWork,
  resumeFollowUp,
  updateSession
} from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';
import { RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE } from './worker-jobs.js';

/**
 * Agent-only narrative publication (coo:1297 phase 2, ADR 0076): stale or
 * absent prose never rejects accepted work, the evidence basis decides
 * publication validity (R1), and only the originating agent publishes once,
 * without a timer.
 */

const risk = (text: string) => ({
  deliveryReport: { schemaVersion: 1, agentReport: { knownRisks: [text] } }
});

async function missionWith(ctx: ServiceContext, name: string, objectiveCount = 1) {
  const project = await createProject({ ctx, name });
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: Array.from({ length: objectiveCount }, (_, index) => ({
      instructions: `Work ${index + 1} for ${name}`
    }))
  });
  for (const objective of objectives) {
    await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objective.id]);
  }
  return { project, mission, objectives };
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

async function summaryRow(ctx: ServiceContext, missionId: string) {
  return ctx.db.get<{
    headline: string;
    generated_by: string;
    content_revision: number | string;
    evidence_revision: number | string;
    published_evidence_revision: number | string | null;
    narrative_delivery_id: string | null;
    narrative_changed_at: string | null;
  }>(
    `SELECT headline, generated_by, content_revision, evidence_revision,
            published_evidence_revision, narrative_delivery_id, narrative_changed_at
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
}

async function count(ctx: ServiceContext, sql: string, params: unknown[]): Promise<number> {
  const row = await ctx.db.get<{ n: number | string }>(sql, params);
  return Number(row?.n ?? 0);
}

describe('inline narrative at delivery (R1)', () => {
  it('a prose-free parallel delivery makes the other agent prose stale by evidence, not content', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Parallel Evidence', 2);
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
    assert.equal(b.missionSummary?.contentRevision, 0);
    assert.equal(b.missionSummary?.evidenceRevision, 0);

    // A delivers without prose: evidence advances, content stays 0.
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: a.sessionKey,
      summary: 'A.',
      payloadJson: risk('A risk.')
    });
    const [aRisk] = (
      await ctx.db.all<{ id: string }>(
        `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
        [mission.id]
      )
    ).map(row => row.id);

    // B's prose matches content 0 but never saw A's accepted work.
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: b.sessionKey,
      summary: 'B.',
      missionSummary: {
        baseContentRevision: 0,
        baseEvidenceRevision: 0,
        headline: 'B landed.',
        summary: 'Only B is described.',
        closeItems: [{ id: aRisk!, status: 'done', reason: 'B fixed it.' }]
      }
    });
    assert.equal(delivered.missionSummary?.narrativeWritten, false);
    assert.deepEqual(delivered.missionSummary?.closedItemIds, [aRisk]);
    assert.equal(delivered.missionSummary?.publication?.withheldReason, 'stale_evidence');
    assert.equal(delivered.missionSummary?.publication?.available, true);
    assert.ok(
      delivered.missionSummary?.warnings.some(
        warning => warning.code === 'mission_summary_withheld'
      )
    );
    assert.equal(delivered.missionSummary?.baseline?.evidenceRevision, 2);
    assert.match(delivered.instruction, /publish-delivery-summary/);
    assert.match(delivered.instruction, /Do not deliver again or resume execution/);
    assert.equal((await summaryRow(ctx, mission.id))?.headline, '');

    // B reconciles from fresh bases and publishes once, with no new execution.
    const context = await readDeliverySummaryContext({
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: b.sessionKey
    });
    assert.equal(context.publication.available, true);
    const published = await publishDeliverySummary({
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: b.sessionKey,
      operationId: 'publish-b-0001',
      narrative: {
        baseContentRevision: context.baseline!.contentRevision,
        baseEvidenceRevision: context.baseline!.evidenceRevision,
        headline: 'A and B landed.',
        summary: 'Both objectives are delivered and tested.'
      }
    });
    assert.equal(published.contentRevision, 1);
    assert.equal(published.evidenceRevision, 2);
    const row = await summaryRow(ctx, mission.id);
    assert.equal(row?.generated_by, 'agent');
    assert.equal(Number(row?.published_evidence_revision), 2);
    assert.equal(row?.narrative_delivery_id, delivered.deliveryId);
    assert.equal(
      await count(ctx, `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`, [mission.id]),
      2
    );
    const objective = await ctx.db.get<{ state: string }>(
      `SELECT state FROM objectives WHERE id = ?`,
      [objectives[1]!.id]
    );
    assert.equal(objective?.state, 'complete');
    await db.close();
  });

  it('stale content and a missing evidence base are accepted with prose withheld', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Stale Content', 3);
    const sessions = [];
    for (const objective of objectives) {
      sessions.push(
        await attachSession({ ctx, missionId: mission.displayId, objectiveId: objective.id })
      );
    }
    const first = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: sessions[0]!.sessionKey,
      summary: 'One.',
      missionSummary: {
        baseContentRevision: 0,
        baseEvidenceRevision: 0,
        headline: 'One landed.',
        summary: 'One is tested.'
      }
    });
    assert.equal(first.missionSummary?.narrativeWritten, true);
    assert.equal(first.missionSummary?.publication?.available, false);

    const stale = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: sessions[1]!.sessionKey,
      summary: 'Two.',
      missionSummary: {
        baseContentRevision: 0,
        baseEvidenceRevision: 1,
        headline: 'Two landed.',
        summary: 'Two is tested.'
      }
    });
    assert.equal(stale.missionSummary?.publication?.withheldReason, 'stale_content');

    // An older client sends no evidence base: delivery succeeds, prose withheld.
    const legacy = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: sessions[2]!.sessionKey,
      summary: 'Three.',
      missionSummary: {
        baseContentRevision: 1,
        headline: 'Three landed.',
        summary: 'Three is tested.'
      }
    });
    assert.equal(legacy.missionSummary?.publication?.withheldReason, 'missing_evidence_base');
    assert.equal((await summaryRow(ctx, mission.id))?.headline, 'One landed.');

    const proposals = await ctx.db.all<{
      delivery_id: string;
      proposed_headline: string | null;
      superseded_reason: string | null;
      published_at: string | null;
    }>(
      `SELECT delivery_id, proposed_headline, superseded_reason, published_at
         FROM delivery_summary_publications WHERE mission_id = ? ORDER BY evidence_revision`,
      [mission.id]
    );
    assert.deepEqual(
      proposals.map(row => [
        row.proposed_headline,
        row.superseded_reason,
        row.published_at !== null
      ]),
      [
        ['One landed.', null, true],
        ['Two landed.', 'newer_delivery', false],
        ['Three landed.', null, false]
      ]
    );
    const context = await readDeliverySummaryContext({
      ctx,
      missionId: mission.displayId,
      deliveryId: legacy.deliveryId,
      sessionKey: sessions[2]!.sessionKey
    });
    assert.equal(context.baseline?.narrative.state, 'outdated');
    assert.equal(context.baseline?.narrative.outstandingDeliveryId, legacy.deliveryId);
    await db.close();
  });

  it('record-work keeps its new-mission exception and needs no base', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Record Work Narrative' });
    const recorded = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Fix the export.',
      summary: 'Fixed the export.',
      missionSummary: { headline: 'The export works.', summary: 'Fixed and tested.' }
    });
    assert.equal(recorded.missionSummary?.narrativeWritten, true);
    assert.equal(recorded.missionSummary?.publication?.available, false);
    const row = await summaryRow(ctx, recorded.mission.id);
    assert.equal(Number(row?.published_evidence_revision), 1);
    await db.close();
  });
});

describe('publish-delivery-summary', () => {
  async function deliveredWithoutProse(name: string) {
    const setup = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(setup.ctx, name, 2);
    const attached = await attachSession({
      ctx: setup.ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    const delivered = await deliverSession({
      ctx: setup.ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Done.'
    });
    return { ...setup, mission, objectives, attached, delivered };
  }

  const prose = (content: number, evidence: number, headline = 'The work is done.') => ({
    baseContentRevision: content,
    baseEvidenceRevision: evidence,
    headline,
    summary: 'It is implemented and tested.'
  });

  it('publishes after an arbitrary elapsed time, replays its receipt, and refuses a second text', async () => {
    const { db, ctx, mission, attached, delivered } = await deliveredWithoutProse('Elapsed');
    assert.equal(delivered.missionSummary?.publication?.withheldReason, 'absent');
    const monthLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const args = {
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: attached.sessionKey,
      operationId: 'publish-elapsed-01',
      narrative: prose(0, 1),
      now: monthLater
    };
    const first = await publishDeliverySummary(args);
    assert.equal(first.contentRevision, 1);
    assert.equal(first.replayed, undefined);
    const replay = await publishDeliverySummary(args);
    assert.equal(replay.replayed, true);
    assert.equal(replay.contentRevision, 1);
    assert.equal(replay.publishedAt, first.publishedAt);

    const changed = await rejection(
      publishDeliverySummary({
        ...args,
        operationId: 'publish-elapsed-02',
        narrative: prose(1, 1, 'Changed.')
      })
    );
    assert.equal(changed.code, 'mission_summary_already_published');
    const sameIdDifferentText = await rejection(
      publishDeliverySummary({ ...args, narrative: prose(0, 1, 'Changed.') })
    );
    assert.equal(sameIdDifferentText.code, 'mission_summary_already_published');
    assert.equal(Number((await summaryRow(ctx, mission.id))?.content_revision), 1);
    await db.close();
  });

  it('a stale base consumes nothing and returns the current baseline', async () => {
    const { db, ctx, mission, attached, delivered } = await deliveredWithoutProse('CAS');
    const stale = await rejection(
      publishDeliverySummary({
        ctx,
        missionId: mission.displayId,
        deliveryId: delivered.deliveryId,
        sessionKey: attached.sessionKey,
        operationId: 'publish-cas-0001',
        narrative: prose(0, 0)
      })
    );
    assert.equal(stale.code, 'mission_summary_conflict');
    assert.equal(stale.status, 409);
    const details = stale.details as { missionSummary: { evidenceRevision: number } };
    assert.equal(details.missionSummary.evidenceRevision, 1);
    const ok = await publishDeliverySummary({
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: attached.sessionKey,
      operationId: 'publish-cas-0001',
      narrative: prose(0, details.missionSummary.evidenceRevision)
    });
    assert.equal(ok.contentRevision, 1);
    await db.close();
  });

  it('a newer delivery, a follow-up or a reopen supersedes the opportunity', async () => {
    const { db, ctx, mission, objectives, attached, delivered } =
      await deliveredWithoutProse('Superseded');
    const next = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    const newer = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: next.sessionKey,
      summary: 'Newer.'
    });
    const superseded = await rejection(
      publishDeliverySummary({
        ctx,
        missionId: mission.displayId,
        deliveryId: delivered.deliveryId,
        sessionKey: attached.sessionKey,
        operationId: 'publish-old-00001',
        narrative: prose(0, 2)
      })
    );
    assert.equal(superseded.code, 'mission_summary_publication_superseded');
    const context = await readDeliverySummaryContext({
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: attached.sessionKey
    });
    assert.deepEqual(
      [context.publication.state, context.publication.supersededReason],
      ['superseded', 'newer_delivery']
    );

    // Follow-up on the newer delivery's objective supersedes its opportunity too.
    await resumeFollowUp({ ctx, missionId: mission.displayId, objectiveId: objectives[1]!.id });
    const followUp = await readDeliverySummaryContext({
      ctx,
      missionId: mission.displayId,
      deliveryId: newer.deliveryId,
      sessionKey: next.sessionKey
    });
    assert.deepEqual(
      [followUp.publication.available, followUp.publication.supersededReason],
      [false, 'follow_up']
    );
    assert.match(followUp.instruction, /can no longer publish/);
    await db.close();
  });

  it('an objective reopen supersedes and makes current prose outdated', async () => {
    const { db, ctx, mission, objectives, attached, delivered } =
      await deliveredWithoutProse('Reopen');
    await publishDeliverySummary({
      ctx,
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      sessionKey: attached.sessionKey,
      operationId: 'publish-reopen-01',
      narrative: prose(0, 1)
    });
    const before = await summaryRow(ctx, mission.id);
    await ctx.db.transaction(async tx => {
      await advanceMissionNarrativeEvidence(tx, {
        mission: { id: mission.id },
        reason: 'reopened',
        attribution: { actorWorkspaceUserId: null, source: 'webapp' }
      });
    });
    const after = await summaryRow(ctx, mission.id);
    assert.equal(Number(after?.evidence_revision), 2);
    assert.equal(Number(after?.published_evidence_revision), 1);
    assert.ok(Date.parse(after!.narrative_changed_at!) > Date.parse(before!.narrative_changed_at!));
    assert.equal(objectives.length, 2);
    await db.close();
  });

  it('only the originating member and delivered session can publish; ids reveal nothing', async () => {
    const { db, ctx, mission, objectives, attached, delivered } =
      await deliveredWithoutProse('Authority');
    const base = {
      missionId: mission.displayId,
      deliveryId: delivered.deliveryId,
      operationId: 'publish-auth-0001',
      narrative: prose(0, 1)
    };
    const otherMember = await rejection(
      publishDeliverySummary({
        ...base,
        ctx: { ...ctx, actorWorkspaceUserId: 'another-member' },
        sessionKey: attached.sessionKey
      })
    );
    assert.equal(otherMember.code, 'mission_summary_publication_not_found');
    const unknown = await rejection(
      readDeliverySummaryContext({
        ctx,
        missionId: mission.displayId,
        deliveryId: 'no-such-delivery',
        sessionKey: attached.sessionKey
      })
    );
    assert.equal(unknown.code, 'mission_summary_publication_not_found');
    const missingKey = await rejection(publishDeliverySummary({ ...base, ctx, sessionKey: null }));
    assert.equal(missingKey.code, 'invalid_input');

    // Another live session of the same member cannot borrow the opportunity.
    const live = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    const borrowed = await rejection(
      publishDeliverySummary({ ...base, ctx, sessionKey: live.sessionKey })
    );
    assert.equal(borrowed.code, 'invalid_session');
    const noOperation = await rejection(
      publishDeliverySummary({
        ...base,
        ctx,
        sessionKey: attached.sessionKey,
        operationId: undefined
      })
    );
    assert.equal(noOperation.code, 'invalid_input');
    const withCloses = await rejection(
      publishDeliverySummary({
        ...base,
        ctx,
        sessionKey: attached.sessionKey,
        narrative: { ...prose(0, 1), closeItems: [] }
      })
    );
    assert.equal(withCloses.code, 'invalid_input');
    await db.close();
  });

  it('a record-work opportunity is bound to its member without a session', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Sessionless' });
    const recorded = await recordWork({
      ctx,
      projectId: project.id,
      objective: 'Fix the import.',
      summary: 'Fixed the import.'
    });
    const published = await publishDeliverySummary({
      ctx,
      missionId: recorded.mission.displayId,
      deliveryId: recorded.deliveryId,
      operationId: 'publish-rw-00001',
      narrative: prose(0, 1, 'The import works.')
    });
    assert.equal(published.contentRevision, 1);
    await db.close();
  });

  it('an ineligible mission gets no publication opportunity', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission } = await missionWith(ctx, 'Ineligible');
    await ctx.db.run(`UPDATE missions SET summary_enabled = ? WHERE id = ?`, [
      ctx.db.dialect === 'postgres' ? false : 0,
      mission.id
    ]);
    const attached = await attachSession({ ctx, missionId: mission.displayId });
    const delivered = await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Done.'
    });
    assert.equal(delivered.missionSummary, undefined);
    assert.doesNotMatch(delivered.instruction, /publish-delivery-summary/);
    assert.equal(
      await count(
        ctx,
        `SELECT COUNT(*) AS n FROM delivery_summary_publications WHERE mission_id = ?`,
        [mission.id]
      ),
      0
    );
    await db.close();
  });
});

describe('no automatic narrative writer remains', () => {
  it('questions, updates and item closes neither enqueue a job nor advance the basis', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'No Triggers', 2);
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
      payloadJson: risk('A risk.')
    });
    const before = await summaryRow(ctx, mission.id);
    const second = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[1]!.id
    });
    await updateSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      summary: 'Progress.'
    });
    await askQuestion({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      question: 'Which path?'
    });
    const [riskId] = (
      await ctx.db.all<{ id: string }>(
        `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
        [mission.id]
      )
    ).map(row => row.id);
    await closeAgentMissionItems({
      ctx,
      missionId: mission.displayId,
      sessionKey: second.sessionKey,
      closeItems: [{ id: riskId!, status: 'done', reason: 'Fixed.' }]
    });
    const after = await summaryRow(ctx, mission.id);
    assert.equal(after?.evidence_revision, before?.evidence_revision);
    assert.equal(after?.headline, '');
    assert.equal(
      await count(ctx, `SELECT COUNT(*) AS n FROM worker_jobs WHERE type = ?`, [
        RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE
      ]),
      0
    );
    await db.close();
  });

  it('the database fence drops automatic jobs and non-agent prose from older replicas', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const { mission, objectives } = await missionWith(ctx, 'Fence');
    const attached = await attachSession({
      ctx,
      missionId: mission.displayId,
      objectiveId: objectives[0]!.id
    });
    await deliverSession({
      ctx,
      missionId: mission.displayId,
      sessionKey: attached.sessionKey,
      summary: 'Done.'
    });
    const now = new Date().toISOString();
    await ctx.db.run(
      `INSERT INTO worker_jobs (id, workspace_id, type, status, priority, run_after, attempt_count,
         max_attempts, payload_json, created_at, updated_at, revision)
       VALUES ('old-job', ?, ?, 'queued', 50, ?, 0, 5, '{}', ?, ?, 1)`,
      [ctx.workspace.id, RETIRED_MISSION_SUMMARY_COMPOSE_JOB_TYPE, now, now, now]
    );
    assert.equal(
      await count(ctx, `SELECT COUNT(*) AS n FROM worker_jobs WHERE id = 'old-job'`, []),
      0
    );
    // An old fallback publication and an old pending trigger change nothing.
    await ctx.db.run(
      `UPDATE mission_summaries SET headline = 'Model text.', generated_by = 'gemini',
              content_revision = content_revision + 1 WHERE mission_id = ?`,
      [mission.id]
    );
    await ctx.db.run(`UPDATE mission_summaries SET status = 'pending' WHERE mission_id = ?`, [
      mission.id
    ]);
    const row = await ctx.db.get<{ headline: string; status: string; content_revision: number }>(
      `SELECT headline, status, content_revision FROM mission_summaries WHERE mission_id = ?`,
      [mission.id]
    );
    assert.deepEqual(
      [row?.headline, row?.status, Number(row?.content_revision)],
      ['', 'composed', 0]
    );
    await db.close();
  });
});
