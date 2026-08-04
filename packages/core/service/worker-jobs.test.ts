import { createSqliteClient, type DatabaseClient, openInMemoryDatabase } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { seedServiceOperator } from './test-helpers.js';
import {
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob,
  workerJobRetryDelay
} from './worker-jobs.js';

const JOB_TYPE = 'test.worker.v1';
const NOW = '2026-08-04T12:00:00.000Z';

async function setup() {
  const db = createSqliteClient(openInMemoryDatabase());
  await seedServiceOperator({ db });
  return db;
}

async function insertJob(
  db: DatabaseClient,
  values: Partial<{
    id: string;
    status: 'queued' | 'running';
    priority: number;
    runAfter: string;
    attemptCount: number;
    lockedUntil: string | null;
  }> = {}
): Promise<string> {
  const id = values.id ?? crypto.randomUUID();
  await db.run(
    `INSERT INTO worker_jobs
       (id, workspace_id, type, status, priority, run_after, attempt_count, max_attempts,
        locked_by, locked_until, payload_json, created_at, updated_at, revision)
     VALUES (?, 'local-workspace', ?, ?, ?, ?, ?, 5, ?, ?, '{}', ?, ?, 1)`,
    [
      id,
      JOB_TYPE,
      values.status ?? 'queued',
      values.priority ?? 50,
      values.runAfter ?? NOW,
      values.attemptCount ?? 0,
      values.lockedUntil ? 'other-worker' : null,
      values.lockedUntil ?? null,
      NOW,
      NOW
    ]
  );
  return id;
}

describe('worker job claiming and completion', () => {
  it('reclaims an expired lease and claims it with a new lease', async () => {
    const db = await setup();
    const id = await insertJob(db, {
      status: 'running',
      attemptCount: 1,
      lockedUntil: '2026-08-04T11:59:59.999Z'
    });

    const claimed = await claimNextWorkerJob({
      db,
      jobType: JOB_TYPE,
      workerId: 'worker-a',
      now: NOW
    });

    assert.equal(claimed?.id, id);
    assert.equal(claimed?.attempt_count, 2);
    const row = await db.get<{ status: string; locked_by: string; locked_until: string }>(
      `SELECT status, locked_by, locked_until FROM worker_jobs WHERE id = ?`,
      [id]
    );
    assert.deepEqual(row, {
      status: 'running',
      locked_by: 'worker-a',
      locked_until: '2026-08-04T12:01:00.000Z'
    });
    await db.close();
  });

  it('returns no job when the revision CAS loses its claim race', async () => {
    let updateCalls = 0;
    const candidate = {
      id: 'raced-job',
      payload_json: '{}',
      attempt_count: 0,
      max_attempts: 5,
      revision: 1
    };
    const raceDb = {
      dialect: 'sqlite',
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(raceDb),
      get: async () => candidate,
      run: async () => ({ changes: updateCalls++ === 0 ? 1 : 0 })
    } as unknown as DatabaseClient;

    const claimed = await claimNextWorkerJob({
      db: raceDb,
      jobType: JOB_TYPE,
      workerId: 'worker-a',
      now: NOW
    });

    assert.equal(claimed, null);
    assert.equal(updateCalls, 2, 'the stale reclaim and the failed CAS are both attempted');
  });

  it('uses the shared backoff table and clears leases on retry and terminal completion', async () => {
    const db = await setup();
    const id = await insertJob(db, { status: 'running', lockedUntil: '2026-08-04T12:01:00.000Z' });

    assert.equal(workerJobRetryDelay(1), 15_000);
    assert.equal(workerJobRetryDelay(99), 3_600_000);
    await retryWorkerJob(db, id, 2, 'temporary failure', NOW);
    let row = await db.get<{
      status: string;
      run_after: string;
      last_error: string | null;
      locked_by: string | null;
    }>(`SELECT status, run_after, last_error, locked_by FROM worker_jobs WHERE id = ?`, [id]);
    assert.deepEqual(row, {
      status: 'queued',
      run_after: '2026-08-04T12:01:00.000Z',
      last_error: 'temporary failure',
      locked_by: null
    });

    await finishWorkerJob(db, id, 'succeeded', null, NOW);
    row = await db.get(`SELECT status, last_error, locked_by FROM worker_jobs WHERE id = ?`, [id]);
    assert.deepEqual(row, { status: 'succeeded', last_error: null, locked_by: null });
    await db.close();
  });
});
