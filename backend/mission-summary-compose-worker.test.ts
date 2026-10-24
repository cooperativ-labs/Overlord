import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-mission-summary-worker-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, requireDatabaseClient } = await import('./db.ts');
const { seedDelivery } = await import('./test-helpers.ts');
const { createMission, createProject } = await import('./repository.ts');
const { missionSummaryComposeWorker } = await import('./mission-summary-compose-worker.ts');
const { buildDeliveryReport } = await import('../packages/core/service/delivery-report.ts');
const { claimNextWorkerJob, enqueueMissionSummaryComposeJob, MISSION_SUMMARY_COMPOSE_JOB_TYPE } =
  await import('../packages/core/service/worker-jobs.ts');

after(() => {
  missionSummaryComposeWorker.setGenerateOverride(null);
  rmSync(tempDir, { recursive: true, force: true });
});

type SummaryRow = {
  status: string;
  headline: string;
  generated_by: string;
  requested_generation: number;
  completed_generation: number;
  risks_json: string;
};

async function seedEligibleMission(name: string) {
  const project = await createProject({ name, color: '#123456' });
  const mission = await createMission({ projectId: project.id, firstObjective: `${name} work` });
  const objective = mission.objectives[0]!;
  const summary = 'The exporter now writes CSV files. Tests cover the header row.';
  const deliveryId = seedDelivery(db, {
    id: `delivery-${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: mission.workspaceId,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: objective.id,
    summary,
    payload: {
      deliveryReport: buildDeliveryReport({
        summary,
        deliveryReport: {
          schemaVersion: 1,
          agentReport: { humanActions: [], knownRisks: ['Large exports are slow.'] }
        }
      })
    },
    deliveredAt: '2026-10-20T10:00:00.000Z'
  });
  return { mission, deliveryId };
}

function trigger(mission: { id: string; workspaceId: string }) {
  return enqueueMissionSummaryComposeJob({
    ctx: {
      db: requireDatabaseClient(),
      workspaceId: mission.workspaceId,
      actorWorkspaceUserId: null,
      source: 'runner'
    },
    missionId: mission.id,
    reason: 'delivery_presented'
  });
}

async function runQueuedJob(): Promise<string> {
  const job = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'test-worker'
  });
  assert.ok(job, 'a mission summary job is queued');
  await missionSummaryComposeWorker.processJobForTest(requireDatabaseClient(), job);
  return job.id;
}

async function summaryRow(missionId: string): Promise<SummaryRow> {
  const row = (await requireDatabaseClient().get(
    `SELECT status, headline, generated_by, requested_generation, completed_generation, risks_json
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  )) as SummaryRow | undefined;
  assert.ok(row);
  return row;
}

test('a trigger during generation causes a fresh pass before publication', async () => {
  const { mission, deliveryId } = await seedEligibleMission('Summary Race');
  const first = await trigger(mission);
  assert.equal(first.triggered, true);
  assert.equal(first.generation, 1);
  const shell = await summaryRow(mission.id);
  assert.equal(shell.status, 'pending');
  assert.equal(shell.headline, '');

  const prompts: string[] = [];
  missionSummaryComposeWorker.setGenerateOverride(async ({ prompt }) => {
    prompts.push(prompt);
    if (prompts.length === 1) {
      // A new trigger lands while the model is generating.
      const during = await trigger(mission);
      assert.equal(during.generation, 2);
      return JSON.stringify({ headline: 'Stale headline.', summary: 'Stale.', risks: [] });
    }
    return JSON.stringify({
      headline: 'The exporter writes CSV files.',
      summary: 'The exporter writes CSV files. Tests cover the header row.',
      risks: [{ ref: `${deliveryId}:0` }, { ref: 'invented:0' }]
    });
  });

  const jobId = await runQueuedJob();
  assert.equal(prompts.length, 2, 'the stale draft is discarded and composed again');
  assert.ok(!prompts[0]!.includes('constraints'), 'the model input has no mission constraints');

  const row = await summaryRow(mission.id);
  assert.equal(row.status, 'composed');
  assert.equal(row.generated_by, 'gemini');
  assert.equal(row.headline, 'The exporter writes CSV files.');
  assert.equal(Number(row.requested_generation), 2);
  assert.equal(Number(row.completed_generation), 2);
  const risks = (
    typeof row.risks_json === 'string' ? JSON.parse(row.risks_json) : row.risks_json
  ) as Array<{ deliveryId: string; index: number }>;
  assert.deepEqual(
    risks.map(risk => [risk.deliveryId, risk.index]),
    [[deliveryId, 0]],
    'the invented risk ref is dropped'
  );

  const jobs = (await requireDatabaseClient().all(
    `SELECT id, status FROM worker_jobs WHERE type = ? AND payload_json LIKE ?`,
    [MISSION_SUMMARY_COMPOSE_JOB_TYPE, `%${mission.id}%`]
  )) as Array<{ id: string; status: string }>;
  assert.deepEqual(jobs, [{ id: jobId, status: 'succeeded' }], 'no successor is left over');

  const changes = (await requireDatabaseClient().get(
    `SELECT COUNT(*) AS total FROM entity_changes
      WHERE entity_type = 'mission_summary' AND entity_id = ?`,
    [mission.id]
  )) as { total: number };
  assert.equal(Number(changes.total), 3, 'two triggers and one publication');
});

test('a null draft publishes the deterministic fallback', async () => {
  const { mission } = await seedEligibleMission('Summary Fallback');
  await trigger(mission);
  missionSummaryComposeWorker.setGenerateOverride(async () => null);
  await runQueuedJob();

  const row = await summaryRow(mission.id);
  assert.equal(row.status, 'fallback');
  assert.equal(row.generated_by, 'deterministic');
  assert.equal(row.headline, 'The exporter now writes CSV files.');
  assert.equal(Number(row.completed_generation), 1);
});

test('retries preserve outstanding generations and the last failure publishes current fallback', async () => {
  const { mission } = await seedEligibleMission('Summary Retry');
  await trigger(mission);
  missionSummaryComposeWorker.setGenerateOverride(async () => {
    throw new Error('test provider unavailable');
  });
  const first = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'retry-test'
  });
  assert.ok(first);
  await missionSummaryComposeWorker.processJobForTest(requireDatabaseClient(), first);
  const queued = await requireDatabaseClient().get<{ status: string; attempt_count: number }>(
    'SELECT status, attempt_count FROM worker_jobs WHERE id = ?',
    [first.id]
  );
  assert.equal(queued?.status, 'queued');
  assert.equal(Number(queued?.attempt_count), 1);
  const pending = await summaryRow(mission.id);
  assert.equal(pending.status, 'pending');
  assert.equal(Number(pending.completed_generation), 0);
  await trigger(mission);
  await requireDatabaseClient().run(
    "UPDATE worker_jobs SET run_after = '2000-01-01T00:00:00.000Z', max_attempts = 2 WHERE id = ?",
    [first.id]
  );
  const last = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'retry-test'
  });
  assert.ok(last);
  await missionSummaryComposeWorker.processJobForTest(requireDatabaseClient(), last);
  const fallback = await summaryRow(mission.id);
  assert.equal(fallback.status, 'fallback');
  assert.equal(Number(fallback.requested_generation), 2);
  assert.equal(Number(fallback.completed_generation), 2);
});

test('a crashed lease is reclaimed without losing its pending generation', async () => {
  const { mission } = await seedEligibleMission('Summary Crash');
  await trigger(mission);
  const first = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'crashed'
  });
  assert.ok(first);
  await requireDatabaseClient().run(
    "UPDATE worker_jobs SET locked_until = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    [first.id]
  );
  const reclaimed = await claimNextWorkerJob({
    db: requireDatabaseClient(),
    jobType: MISSION_SUMMARY_COMPOSE_JOB_TYPE,
    workerId: 'replacement'
  });
  assert.equal(reclaimed?.id, first.id);
  assert.equal(reclaimed?.attempt_count, 2);
  missionSummaryComposeWorker.setGenerateOverride(async () => null);
  await missionSummaryComposeWorker.processJobForTest(requireDatabaseClient(), reclaimed!);
  assert.equal(Number((await summaryRow(mission.id)).completed_generation), 1);
});

test('an ineligible mission is never triggered', async () => {
  const { mission } = await seedEligibleMission('Summary Ineligible');
  db.prepare(`UPDATE missions SET summary_enabled = 0 WHERE id = ?`).run(mission.id);
  const result = await trigger(mission);
  assert.equal(result.triggered, false);
  const row = await requireDatabaseClient().get(
    `SELECT 1 FROM mission_summaries WHERE mission_id = ?`,
    [mission.id]
  );
  assert.equal(row, undefined);
});
