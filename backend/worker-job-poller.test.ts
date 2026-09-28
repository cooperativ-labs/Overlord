import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-worker-job-poller-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { requireDatabaseClient } = await import('./db.ts');
const { WorkerJobPoller } = await import('./worker-job-poller.ts');
const { enqueueWorkerJob } = await import('../packages/core/service/worker-jobs.ts');
type ClaimedWorkerJob = import('../packages/core/service/worker-jobs.ts').ClaimedWorkerJob;
type WorkerJobFailureOutcome = import('./worker-job-poller.ts').WorkerJobFailureOutcome;

const JOB_TYPE = 'test.worker-job-poller';

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await requireDatabaseClient().run(`DELETE FROM worker_jobs WHERE type = ?`, [JOB_TYPE]);
});

class TestPoller extends WorkerJobPoller {
  readonly processed: string[] = [];
  readonly outcomes: WorkerJobFailureOutcome[] = [];
  enabled = true;
  failWith: Error | null = null;

  constructor(claimBatchSize?: number) {
    super({
      workerIdPrefix: 'test-poller',
      jobTypes: [JOB_TYPE],
      logPrefix: 'test-poller',
      ...(claimBatchSize === undefined ? {} : { claimBatchSize })
    });
  }

  tick(): Promise<void> {
    return this.poll();
  }

  protected shouldPoll(): boolean {
    return this.enabled;
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  protected async processJob(db: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    if (this.failWith) {
      this.outcomes.push(await this.failOrRetry(db, job, this.failWith));
      return;
    }
    this.processed.push(job.id);
    await this.finishJob(db, job);
  }
}

async function enqueue(n: number, maxAttempts = 5): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { jobId } = await enqueueWorkerJob({
      db: requireDatabaseClient(),
      workspaceId: 'local-workspace',
      type: JOB_TYPE,
      dedupeBy: { field: 'n', value: String(i) },
      payload: { n: String(i) },
      maxAttempts
    });
    ids.push(jobId!);
  }
  return ids;
}

async function statuses(): Promise<string[]> {
  const rows = await requireDatabaseClient().all<{ status: string }>(
    `SELECT status FROM worker_jobs WHERE type = ? ORDER BY created_at, id`,
    [JOB_TYPE]
  );
  return rows.map(row => row.status);
}

test('default claimBatchSize claims one job per type per tick', async () => {
  await enqueue(3);
  const poller = new TestPoller();
  await poller.tick();
  assert.equal(poller.processed.length, 1);
  assert.deepEqual((await statuses()).sort(), ['queued', 'queued', 'succeeded']);
});

test('claimBatchSize drains up to that many jobs per tick and stops when the queue empties', async () => {
  await enqueue(3);
  const poller = new TestPoller(2);
  await poller.tick();
  assert.equal(poller.processed.length, 2);
  await poller.tick();
  assert.equal(poller.processed.length, 3);
  await poller.tick();
  assert.equal(poller.processed.length, 3);
  assert.deepEqual(await statuses(), ['succeeded', 'succeeded', 'succeeded']);
});

test('shouldPoll() false skips the tick without claiming', async () => {
  await enqueue(1);
  const poller = new TestPoller(5);
  poller.enabled = false;
  await poller.tick();
  assert.equal(poller.processed.length, 0);
  assert.deepEqual(await statuses(), ['queued']);
  poller.enabled = true;
  await poller.tick();
  assert.equal(poller.processed.length, 1);
});

test('failOrRetry reports retrying before the attempt ceiling and failed at it', async () => {
  const [jobId] = await enqueue(1, 2);
  const poller = new TestPoller();
  poller.failWith = new Error('boom');
  await poller.tick();
  assert.deepEqual(poller.outcomes, ['retrying']);
  // Retry backoff pushes run_after forward; pull it back so the next tick claims it.
  await requireDatabaseClient().run(
    `UPDATE worker_jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE id = ?`,
    [jobId]
  );
  await poller.tick();
  assert.deepEqual(poller.outcomes, ['retrying', 'failed']);
  const row = await requireDatabaseClient().get<{ status: string; last_error: string }>(
    `SELECT status, last_error FROM worker_jobs WHERE id = ?`,
    [jobId]
  );
  assert.deepEqual(row, { status: 'failed', last_error: 'boom' });
});
