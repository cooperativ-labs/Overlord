import type { DatabaseClient } from '@overlord/database';

import { newId } from '../packages/core/service/util.ts';
import {
  type ClaimedWorkerJob,
  claimNextWorkerJob,
  finishWorkerJob,
  retryWorkerJob
} from '../packages/core/service/worker-jobs.ts';

const DEFAULT_POLL_INTERVAL_MS = 1_500;

/**
 * Shared leased worker_jobs polling mechanics. Subclasses own their job
 * payloads and delivery surfaces; this class only claims jobs and applies the
 * common terminal failure or retry policy.
 */
export abstract class WorkerJobPoller {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly workerId: string;

  protected constructor({
    workerIdPrefix,
    jobTypes,
    logPrefix,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  }: {
    workerIdPrefix: string;
    jobTypes: readonly string[];
    logPrefix: string;
    pollIntervalMs?: number;
  }) {
    this.workerId = `${workerIdPrefix}:${process.pid}:${newId().slice(0, 8)}`;
    this.jobTypes = jobTypes;
    this.logPrefix = logPrefix;
    this.pollIntervalMs = pollIntervalMs;
  }

  private readonly jobTypes: readonly string[];
  private readonly logPrefix: string;
  private readonly pollIntervalMs: number;

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

  protected async failOrRetry(
    db: DatabaseClient,
    job: ClaimedWorkerJob,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempt_count >= job.max_attempts) {
      await finishWorkerJob(db, job.id, 'failed', message);
    } else {
      await retryWorkerJob(db, job.id, job.attempt_count, message);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const db = this.databaseClient();
      for (const jobType of this.jobTypes) {
        const job = await claimNextWorkerJob({ db, jobType, workerId: this.workerId });
        if (job) await this.processClaimedJob(db, job, jobType);
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
