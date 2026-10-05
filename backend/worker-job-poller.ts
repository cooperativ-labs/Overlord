import type { DatabaseClient } from '@overlord/database';

import { newId } from '../packages/core/service/util.ts';
import {
  type ClaimedWorkerJob,
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob
} from '../packages/core/service/worker-jobs.ts';

import { PollLoop } from './poll-loop.ts';

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_CLAIM_BATCH_SIZE = 1;

/** Terminal failure versus requeued retry, as applied by failOrRetry. */
export type WorkerJobFailureOutcome = 'failed' | 'retrying';

/**
 * Shared leased worker_jobs polling mechanics. Subclasses own their job
 * payloads and delivery surfaces; this class only claims jobs and applies the
 * common terminal failure or retry policy. Per-worker policy hooks:
 * `claimBatchSize` drains up to that many jobs per type per tick, and
 * `shouldPoll()` gates a tick entirely (for example on a kill-switch env var).
 * The timer, re-entrancy guard, and stop() come from PollLoop.
 */
export abstract class WorkerJobPoller extends PollLoop {
  private readonly workerId: string;

  protected constructor({
    workerIdPrefix,
    jobTypes,
    logPrefix,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    claimBatchSize = DEFAULT_CLAIM_BATCH_SIZE
  }: {
    workerIdPrefix: string;
    jobTypes: readonly string[];
    logPrefix: string;
    pollIntervalMs?: number;
    claimBatchSize?: number;
  }) {
    super({ intervalMs: pollIntervalMs, logPrefix });
    this.workerId = `${workerIdPrefix}:${process.pid}:${newId().slice(0, 8)}`;
    this.jobTypes = jobTypes;
    this.claimBatchSize = Math.max(1, Math.trunc(claimBatchSize));
  }

  private readonly jobTypes: readonly string[];
  private readonly claimBatchSize: number;

  protected abstract processJob(
    db: DatabaseClient,
    job: ClaimedWorkerJob,
    jobType: string
  ): Promise<void>;

  protected async finishJob(
    db: DatabaseClient,
    job: ClaimedWorkerJob,
    status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded',
    lastError: string | null = null
  ): Promise<void> {
    await finishWorkerJob(db, job.id, status, lastError);
  }

  /**
   * Finishes the job as failed once its attempts are spent, otherwise requeues
   * it with backoff. Returns which one happened so subclasses that catch their
   * own errors can attach terminal-only side effects.
   */
  protected async failOrRetry(
    db: DatabaseClient,
    job: ClaimedWorkerJob,
    error: unknown
  ): Promise<WorkerJobFailureOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempt_count >= job.max_attempts) {
      await finishWorkerJob(db, job.id, 'failed', message);
      return 'failed';
    }
    await retryWorkerJob(db, job.id, job.attempt_count, message);
    return 'retrying';
  }

  /** One claim/process tick: drains up to claimBatchSize jobs per type. */
  protected async runOnce(): Promise<void> {
    const db = this.databaseClient();
    for (const jobType of this.jobTypes) {
      for (let claimed = 0; claimed < this.claimBatchSize; claimed++) {
        if (this.isStopped) return;
        const job = await claimNextWorkerJob({ db, jobType, workerId: this.workerId });
        if (!job) break;
        await this.processClaimedJob(db, job, jobType);
      }
    }
  }

  private async processClaimedJob(
    db: DatabaseClient,
    job: ClaimedWorkerJob,
    jobType: string
  ): Promise<void> {
    try {
      await this.processJob(db, job, jobType);
    } catch (error) {
      await this.failOrRetry(db, job, error);
    }
  }

  protected abstract databaseClient(): DatabaseClient;
}
