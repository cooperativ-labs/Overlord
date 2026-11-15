import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * The agent-facing mission summary through the protocol dispatch
 * (coo:1260.shmg): the attach baseline, a delivery that writes the summary and
 * closes items, the parallel-objective conflict, and fallback composition for
 * a delivery without an agent summary.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-mission-summary-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const { createMission, createObjective, createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { getMissionSummary } = await import('./mission-summary.ts');
const { missionSummaryComposeWorker } = await import('./mission-summary-compose-worker.ts');
const { ServiceError } = await import('../packages/core/service/errors.ts');
const { claimNextWorkerJob, enqueueMissionSummaryComposeJob, MISSION_SUMMARY_COMPOSE_JOB_TYPE } =
  await import('../packages/core/service/worker-jobs.ts');

after(() => {
  missionSummaryComposeWorker.setGenerateOverride(null);
  rmSync(tempDir, { recursive: true, force: true });
});

type Baseline = {
  contentRevision: number;
  headline: string;
  summary: string;
  author: string | null;
  openItems: Array<{ id: string; kind: string; objective: string | null; text: string }>;
  truncated: boolean;
};
type AttachResult = { sessionKey: string; missionSummary?: Baseline; agentInstructions: string };
type DeliverResult = {
  deliveryId: string;
  missionSummary?: {
    contentRevision: number | null;
    narrativeWritten: boolean;
    closedItemIds: string[];
    warnings: Array<{ code: string; itemId?: string }>;
  };
};

const report = (tag: string) => ({
  schemaVersion: 1,
  agentReport: {
    humanActions: [
      {
        action: `Run the ${tag} migration in production.`,
        reason: 'Missing table.',
        category: 'database'
      }
    ],
    knownRisks: [`The ${tag} export is slow.`],
    deferredWork: []
  }
});

async function missionFixture(name: string) {
  const project = await createProject({ name: `${name} ${Date.now()}`, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} first` });
  const second = await createObjective({
    missionId: mission.id,
    instructionText: `${name} second`,
    state: 'draft'
  });
  return {
    mission,
    first: mission.objectives[0]!,
    second: { id: second.id, displayId: `${mission.displayId}.${second.displayKey}` }
  };
}

function attach(objectiveDisplayId: string): Promise<AttachResult> {
  return runProtocolSubcommand('attach', {
    flags: { '--objective-id': objectiveDisplayId, '--model': 'claude-opus-5-5' }
  }) as Promise<AttachResult>;
}

function deliver(
  objectiveDisplayId: string,
  sessionKey: string,
  payload: Record<string, unknown>,
  extra: { flags?: Record<string, string | boolean>; fileInputs?: Record<string, string> } = {}
): Promise<DeliverResult> {
  return runProtocolSubcommand('deliver', {
    flags: {
      '--objective-id': objectiveDisplayId,
      '--session-key': sessionKey,
      '--summary': 'Delivered.',
      '--payload-json': JSON.stringify(payload),
      ...extra.flags
    },
    ...(extra.fileInputs ? { fileInputs: extra.fileInputs } : {})
  }) as Promise<DeliverResult>;
}

test('attach returns the baseline; load-context and connect do not', async () => {
  const { mission, first } = await missionFixture('Baseline');
  const attached = await attach(first.displayId);
  assert.deepEqual(attached.missionSummary, {
    contentRevision: 0,
    headline: '',
    summary: '',
    author: null,
    openItems: [],
    truncated: false
  });
  assert.ok(attached.agentInstructions.includes('## Mission summary'));

  const context = (await runProtocolSubcommand('load-context', {
    flags: { '--mission-id': mission.displayId }
  })) as Record<string, unknown>;
  assert.equal('missionSummary' in context, false);
  const connected = (await runProtocolSubcommand('connect', {
    flags: { '--objective-id': first.displayId }
  })) as Record<string, unknown>;
  assert.equal('missionSummary' in connected, false);
});

test('a delivery with missionSummary shows agent prose at once and closes own items', async () => {
  const { mission, first, second } = await missionFixture('Agent Prose');
  const other = await missionFixture('Agent Prose Other');

  const a = await attach(first.displayId);
  await deliver(first.displayId, a.sessionKey, { deliveryReport: report('first') });
  const o = await attach(other.first.displayId);
  await deliver(other.first.displayId, o.sessionKey, { deliveryReport: report('other') });
  const foreignRisk = (await getMissionSummary(other.mission.id)).summary;
  const foreignRiskId = (await requireDatabaseClient().get<{ id: string }>(
    `SELECT id FROM mission_items WHERE mission_id = ? AND kind = 'risk'`,
    [other.mission.id]
  ))!.id;
  assert.equal(foreignRisk, null, 'no summary row before the fallback composer runs');

  const b = await attach(second.displayId);
  const risk = b.missionSummary!.openItems.find(item => item.kind === 'risk')!;
  assert.equal(risk.objective, first.displayId);

  // The flag form, as the CLI sends `--mission-summary-file -`.
  const delivered = await deliver(
    second.displayId,
    b.sessionKey,
    {},
    {
      flags: { '--mission-summary-file': true },
      fileInputs: {
        '--mission-summary-file': JSON.stringify({
          baseContentRevision: b.missionSummary!.contentRevision,
          headline: 'The export is fast and tested.',
          summary: 'The export streams rows. It is tested and not deployed.',
          closeItems: [
            { id: risk.id, status: 'done', reason: 'Streaming removed the slow path.' },
            { id: foreignRiskId, status: 'dismissed', reason: 'Not this mission.' }
          ]
        })
      }
    }
  );
  assert.deepEqual(delivered.missionSummary?.closedItemIds, [risk.id]);
  assert.deepEqual(
    delivered.missionSummary?.warnings
      .filter(warning => warning.code === 'mission_summary_item_skipped')
      .map(warning => warning.itemId),
    [foreignRiskId]
  );

  const response = await getMissionSummary(mission.displayId);
  const summary = response.summary!;
  assert.equal(summary.status, 'composed', 'no pending state over agent text');
  assert.equal(summary.headline, 'The export is fast and tested.');
  assert.equal(summary.generatedBy, 'agent');
  assert.equal(summary.model, 'claude-opus-5-5');
  assert.deepEqual(summary.author, {
    kind: 'agent',
    objectiveId: second.id,
    deliveryId: delivered.deliveryId
  });
  assert.equal(summary.contentRevision, 1);
  assert.equal(
    summary.risks.some(item => item.id === risk.id),
    false,
    'the closed risk left the open list'
  );
  const closed = summary.closedItems.find(item => item.id === risk.id);
  assert.equal(closed?.status, 'done');
  assert.equal(closed?.reason, 'Streaming removed the slow path.');
  assert.equal(closed?.resolvedBy?.kind, 'agent');

  const foreign = await requireDatabaseClient().get<{ status: string }>(
    `SELECT status FROM mission_items WHERE id = ?`,
    [foreignRiskId]
  );
  assert.equal(foreign?.status, 'open', "another mission's item is never closed");

  // The delivery compose worker's trigger never dims or overwrites the agent text.
  const trigger = await enqueueMissionSummaryComposeJob({
    ctx: {
      db: requireDatabaseClient(),
      workspaceId: mission.workspaceId,
      actorWorkspaceUserId: null,
      source: 'runner'
    },
    missionId: mission.id,
    reason: 'delivery_presented'
  });
  assert.equal(trigger.triggered, false);
  assert.equal((await getMissionSummary(mission.id)).summary?.status, 'composed');
});

test('a second parallel delivery with a stale base receives 409 with a fresh baseline', async () => {
  const { mission, first, second } = await missionFixture('Parallel');
  const a = await attach(first.displayId);
  const b = await attach(second.displayId);

  await deliver(first.displayId, a.sessionKey, {
    deliveryReport: report('a'),
    missionSummary: { baseContentRevision: 0, headline: 'A landed.', summary: 'A is tested.' }
  });

  await assert.rejects(
    deliver(second.displayId, b.sessionKey, {
      deliveryReport: report('b'),
      missionSummary: { baseContentRevision: 0, headline: 'B landed.', summary: 'B is tested.' }
    }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'mission_summary_conflict');
      const details = error.details as { missionSummary: Baseline };
      assert.equal(details.missionSummary.contentRevision, 1);
      assert.equal(details.missionSummary.headline, 'A landed.');
      assert.equal(details.missionSummary.author, 'agent');
      return true;
    }
  );
  const deliveries = await requireDatabaseClient().all<{ objective_id: string }>(
    `SELECT objective_id FROM deliveries WHERE mission_id = ?`,
    [mission.id]
  );
  assert.deepEqual(
    deliveries.map(row => row.objective_id),
    [first.id],
    'nothing of the rejected delivery was written'
  );
});

test('malformed missionSummary is a 400 before any write', async () => {
  const { mission, first } = await missionFixture('Malformed');
  const a = await attach(first.displayId);
  await assert.rejects(
    deliver(first.displayId, a.sessionKey, {
      missionSummary: { baseContentRevision: 0, closeItems: [{ id: 'x', status: 'done' }] }
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.status === 400 && error.code === 'invalid_input'
  );
  const count = await requireDatabaseClient().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM deliveries WHERE mission_id = ?`,
    [mission.id]
  );
  assert.equal(Number(count?.n), 0);
});

test('a delivery without missionSummary succeeds and gets fallback prose', async () => {
  const { mission, first, second } = await missionFixture('Fallback');
  const a = await attach(first.displayId);
  await deliver(first.displayId, a.sessionKey, {
    missionSummary: { baseContentRevision: 0, headline: 'A landed.', summary: 'A is tested.' }
  });
  const b = await attach(second.displayId);
  // An older client: no missionSummary field at all.
  const delivered = await deliver(second.displayId, b.sessionKey, { deliveryReport: report('b') });
  assert.equal(delivered.missionSummary, undefined);

  const trigger = await enqueueMissionSummaryComposeJob({
    ctx: {
      db: requireDatabaseClient(),
      workspaceId: mission.workspaceId,
      actorWorkspaceUserId: null,
      source: 'runner'
    },
    missionId: mission.id,
    reason: 'delivery_presented'
  });
  assert.equal(trigger.triggered, true, 'the newest delivery has no agent prose');

  const prompts: string[] = [];
  missionSummaryComposeWorker.setGenerateOverride(async ({ prompt }) => {
    prompts.push(prompt);
    return JSON.stringify({ headline: 'A and B landed.', summary: 'Both are delivered.' });
  });
  const job = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'protocol-mission-summary-test'
  });
  assert.ok(job);
  await missionSummaryComposeWorker.processJobForTest(requireDatabaseClient(), job);

  assert.ok(prompts[0]?.includes('A landed.'), 'the agent text is the previous summary');
  const summary = (await getMissionSummary(mission.id)).summary!;
  assert.equal(summary.generatedBy, 'gemini');
  assert.equal(summary.headline, 'A and B landed.');
  assert.equal(summary.author.kind, 'gemini');
  assert.equal(summary.author.deliveryId, null);
  assert.equal(summary.contentRevision, 2);
});

test('record-work accepts missionSummary without a base', async () => {
  const project = await createProject({
    name: `Record Work Summary ${Date.now()}`,
    color: '#123456'
  });
  const result = (await runProtocolSubcommand('record-work', {
    flags: {
      '--project-id': project.id,
      '--payload-json': JSON.stringify({
        objective: 'Fixed the export.',
        summary: 'Fixed the export.',
        missionSummary: { headline: 'The export works.', summary: 'Fixed and tested.' }
      })
    }
  })) as {
    mission: { id: string };
    deliveryId: string;
    missionSummary?: { narrativeWritten: boolean };
  };
  assert.equal(result.missionSummary?.narrativeWritten, true);
  const summary = (await getMissionSummary(result.mission.id)).summary!;
  assert.equal(summary.author.kind, 'agent');
  assert.equal(summary.headline, 'The export works.');
  const payload = await requireDatabaseClient().get<{ payload_json: string }>(
    `SELECT payload_json FROM deliveries WHERE id = ?`,
    [result.deliveryId]
  );
  assert.equal(JSON.parse(payload!.payload_json).missionSummary, undefined);
});
