import type { DatabaseClient } from '@overlord/database';

import { newId } from '../packages/core/service/util.ts';
import {
  type ClaimedWorkerJob,
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob
} from '../packages/core/service/worker-jobs.ts';

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
 */
export abstract class WorkerJobPoller {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
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
    this.workerId = `${workerIdPrefix}:${process.pid}:${newId().slice(0, 8)}`;
    this.jobTypes = jobTypes;
    this.logPrefix = logPrefix;
    this.pollIntervalMs = pollIntervalMs;
    this.claimBatchSize = Math.max(1, Math.trunc(claimBatchSize));
  }

  private readonly jobTypes: readonly string[];
  private readonly logPrefix: string;
  private readonly pollIntervalMs: number;
  private readonly claimBatchSize: number;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /** Drives one claim/deliver cycle without waiting for the next interval. */
  pollNow(): void {
    void this.poll();
  }

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

  /** Per-tick gate; a false result skips the tick without claiming anything. */
  protected shouldPoll(): boolean {
    return true;
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

  /** One claim/process tick; protected so tests can await a tick directly. */
  protected async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.shouldPoll()) return;
    this.polling = true;
    try {
      const db = this.databaseClient();
      for (const jobType of this.jobTypes) {
        for (let claimed = 0; claimed < this.claimBatchSize; claimed++) {
          const job = await claimNextWorkerJob({ db, jobType, workerId: this.workerId });
          if (!job) break;
          await this.processClaimedJob(db, job, jobType);
        }
      }
    } catch (error) {
      console.error(`[${this.logPrefix}] poll failed`, error);
    } finally {
      this.polling = false;
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
