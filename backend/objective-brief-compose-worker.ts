import {
  composeObjectiveBrief,
  isGeminiConfigured,
  OBJECTIVE_BRIEF_PROVIDER_TIMEOUT_MS,
  type ObjectiveBriefGenerate
} from '@overlord/automations';
import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from '../packages/core/service/context.ts';
import {
  clearUnsatisfiableObjectiveBriefIntent,
  failObjectiveDescriptionGeneration,
  hashObjectiveInstruction,
  isDescriptionEligibleInstruction,
  listObjectiveBriefCatchUpCandidates,
  listObjectiveBriefOrphans,
  loadObjectiveBriefRow,
  markObjectiveBriefCatchUpPending,
  type ObjectiveBriefResult,
  type ObjectiveBriefRow,
  publishObjectiveBrief,
  settleObjectiveTitleGeneration
} from '../packages/core/service/objective-brief.ts';
import {
  type ClaimedWorkerJob,
  completeObjectiveBriefComposeJob,
  enqueueObjectiveBriefComposeJob,
  OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE
} from '../packages/core/service/worker-jobs.ts';

import { requireDatabaseClient } from './db.ts';
import { realtime } from './realtime.ts';
import { WorkerJobPoller } from './worker-job-poller.ts';

/** Concurrent provider calls per tick are bounded by draining at most this many jobs. */
const CLAIM_BATCH_SIZE = 3;
/** Passes per job before the job hands outstanding intent to a successor. */
const MAX_PASSES_PER_JOB = 3;
/** Catch-up and orphan recovery run at most this often. */
const CATCH_UP_INTERVAL_MS = 5 * 60_000;
/** Rows marked or recovered per catch-up sweep. */
const CATCH_UP_BATCH_SIZE = 25;

/** Emits bounded operational metrics; never instruction or summary text. */
function logBriefMetric(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  console.info('[objective-brief-compose-worker]', JSON.stringify({ event, ...fields }));
}

function runnerContext(db: DatabaseClient, workspaceId: string): ServiceContext {
  return {
    db,
    workspace: { id: workspaceId, slug: '', name: '' },
    actorWorkspaceUserId: null,
    source: 'runner',
    origin: { kind: 'automation' }
  };
}

type Wanted = {
  title: { generation: number } | null;
  description: { generation: number } | null;
};

function wantedFields(row: ObjectiveBriefRow): Wanted {
  return {
    title:
      row.title_status === 'pending' && row.title_source === 'generated'
        ? { generation: row.title_generation }
        : null,
    description:
      row.description_status === 'pending' &&
      !row.description_suppressed &&
      isDescriptionEligibleInstruction(row.instruction_text)
        ? { generation: row.description_generation }
        : null
  };
}

type PassOutcome =
  /** `lastError` records a final provider failure on the finished job. */
  | { kind: 'done'; lastError?: string }
  | { kind: 'missing' }
  | { kind: 'stale' }
  | { kind: 'retry'; message: string };

/**
 * In-process objective brief worker (coo:1275, ADR 0058) on the shared
 * WorkerJobPoller loop, registered for both editions. Each job reads the
 * objective's durable intent, makes one provider call for every field that is
 * still wanted (title and/or summary), and publishes only against the
 * generation and instruction hash it read. A stale result triggers another
 * pass from the current row; completion runs under the row lock and queues a
 * successor while intent is still pending, so no edit is lost.
 *
 * - No provider: the local title stays final and the summary is marked
 *   `failed` with `provider_unavailable` (Retry works once one is configured).
 * - Provider errors retry with the shared backoff; the last attempt records
 *   `provider_error`. Invalid or unfaithful output records its code and the
 *   UI keeps showing the instructions.
 * - A periodic, bounded sweep marks eligible draft/submitted catch-up rows and
 *   re-enqueues pending rows that have no job.
 * - Skips ticks while OVERLORD_OBJECTIVE_BRIEF_COMPOSE_DISABLED=1.
 *
 * Launch never waits for this worker.
 */
class ObjectiveBriefComposeWorker extends WorkerJobPoller {
  private generateOverride: ObjectiveBriefGenerate | null = null;
  private lastCatchUpAt = 0;

  constructor() {
    super({
      workerIdPrefix: 'objective-brief-compose',
      jobTypes: [OBJECTIVE_BRIEF_COMPOSE_JOB_TYPE],
      logPrefix: 'objective-brief-compose-worker',
      claimBatchSize: CLAIM_BATCH_SIZE
    });
  }

  /** Test seam: inject a fake provider (`null` restores the configured one). */
  setGenerateOverride(generate: ObjectiveBriefGenerate | null): void {
    this.generateOverride = generate;
  }

  protected shouldPoll(): boolean {
    return process.env.OVERLORD_OBJECTIVE_BRIEF_COMPOSE_DISABLED !== '1';
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  protected async runOnce(): Promise<void> {
    if (Date.now() - this.lastCatchUpAt >= CATCH_UP_INTERVAL_MS) {
      this.lastCatchUpAt = Date.now();
      await this.catchUp(this.databaseClient()).catch((err: unknown) => {
        console.warn(
          '[objective-brief-compose-worker] catch-up failed:',
          err instanceof Error ? err.message : String(err)
        );
      });
    }
    await super.runOnce();
  }

  /**
   * One bounded sweep: re-enqueue pending rows without a job (intent that
   * predates the worker, or a lost job), then mark eligible draft/submitted
   * agent-written rows that have no summary. Both are idempotent.
   */
  async catchUp(db: DatabaseClient): Promise<{ recovered: number; marked: number }> {
    let recovered = 0;
    for (const orphan of await listObjectiveBriefOrphans(db, { limit: CATCH_UP_BATCH_SIZE })) {
      await db.transaction(tx =>
        enqueueObjectiveBriefComposeJob({
          db: tx,
          workspaceId: orphan.workspaceId,
          objectiveId: orphan.id,
          debounceMs: 0
        })
      );
      recovered += 1;
    }
    let marked = 0;
    for (const id of await listObjectiveBriefCatchUpCandidates(db, {
      limit: CATCH_UP_BATCH_SIZE
    })) {
      const row = await loadObjectiveBriefRow(db, id);
      if (!row) continue;
      if (await markObjectiveBriefCatchUpPending(runnerContext(db, row.workspace_id), id)) {
        marked += 1;
      }
    }
    if (recovered > 0 || marked > 0) {
      logBriefMetric('objective_brief_catch_up', { recovered, marked });
    }
    return { recovered, marked };
  }

  /** Test seam: process one claimed job directly. */
  async processJobForTest(client: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    await this.processJob(client, job);
  }

  protected async processJob(client: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    const startedAt = Date.now();
    let objectiveId: string;
    try {
      const payload = JSON.parse(job.payload_json) as { objectiveId?: unknown };
      if (typeof payload.objectiveId !== 'string' || !payload.objectiveId.trim()) {
        throw new Error('Missing objectiveId in worker payload');
      }
      objectiveId = payload.objectiveId.trim();
    } catch (err) {
      await this.finishJob(client, job, 'failed', `Malformed payload: ${String(err)}`);
      return;
    }

    const finalAttempt = job.attempt_count >= job.max_attempts;
    let lastError: string | null = null;
    for (let pass = 1; pass <= MAX_PASSES_PER_JOB; pass++) {
      const outcome = await this.composePass(client, objectiveId, finalAttempt, job, pass);
      if (outcome.kind === 'missing') {
        await completeObjectiveBriefComposeJob({
          db: client,
          jobId: job.id,
          objectiveId,
          status: 'cancelled',
          lastError: 'Objective not found'
        });
        return;
      }
      if (outcome.kind === 'retry') {
        // Intent stays pending on the row; the job retries with backoff.
        await this.failOrRetry(client, job, new Error(outcome.message));
        logBriefMetric('objective_brief_retrying', {
          jobId: job.id,
          objectiveId,
          attempt: job.attempt_count,
          durationMs: Date.now() - startedAt
        });
        return;
      }
      if (outcome.kind === 'done') {
        lastError = outcome.lastError ?? null;
        break;
      }
      logBriefMetric('objective_brief_stale', { jobId: job.id, objectiveId, pass });
    }
    const { successorJobId } = await completeObjectiveBriefComposeJob({
      db: client,
      jobId: job.id,
      objectiveId,
      status: lastError ? 'failed' : 'succeeded',
      lastError
    });
    if (successorJobId) {
      logBriefMetric('objective_brief_successor_queued', {
        jobId: job.id,
        objectiveId,
        successorJobId
      });
    }
    void realtime.pollNow();
  }

  private async composePass(
    client: DatabaseClient,
    objectiveId: string,
    finalAttempt: boolean,
    job: ClaimedWorkerJob,
    pass: number
  ): Promise<PassOutcome> {
    const row = await loadObjectiveBriefRow(client, objectiveId);
    if (!row) return { kind: 'missing' };
    const ctx = runnerContext(client, row.workspace_id);
    await clearUnsatisfiableObjectiveBriefIntent(ctx, objectiveId);
    const wanted = wantedFields(row);
    if (!wanted.title && !wanted.description) return { kind: 'done' };

    const instructionText = (row.instruction_text ?? '').trim();
    const instructionHash = hashObjectiveInstruction(instructionText)!;
    const generate = this.generateOverride;
    const providerReady = generate !== null || isGeminiConfigured();
    if (!providerReady) {
      if (wanted.title) {
        await settleObjectiveTitleGeneration({
          ctx,
          objectiveId,
          generation: wanted.title.generation,
          status: null
        });
      }
      if (wanted.description) {
        await failObjectiveDescriptionGeneration({
          ctx,
          objectiveId,
          generation: wanted.description.generation,
          failureCode: 'provider_unavailable'
        });
      }
      logBriefMetric('objective_brief_provider_unavailable', { jobId: job.id, objectiveId });
      return { kind: 'done' };
    }

    const startedAt = Date.now();
    const outcome = await composeObjectiveBrief({
      instructionText,
      fields: { title: wanted.title !== null, description: wanted.description !== null },
      ...(generate ? { generate } : {}),
      timeoutMs: OBJECTIVE_BRIEF_PROVIDER_TIMEOUT_MS
    });

    if (outcome.kind === 'provider_unavailable' || outcome.kind === 'provider_error') {
      const code = outcome.kind;
      if (outcome.kind === 'provider_error' && !finalAttempt) {
        return { kind: 'retry', message: outcome.message };
      }
      if (wanted.title) {
        await settleObjectiveTitleGeneration({
          ctx,
          objectiveId,
          generation: wanted.title.generation,
          status: code === 'provider_error' ? 'failed' : null
        });
      }
      if (wanted.description) {
        await failObjectiveDescriptionGeneration({
          ctx,
          objectiveId,
          generation: wanted.description.generation,
          failureCode: code
        });
      }
      logBriefMetric('objective_brief_failed', {
        jobId: job.id,
        objectiveId,
        code,
        attempt: job.attempt_count
      });
      return { kind: 'done', lastError: code };
    }

    const result: ObjectiveBriefResult = { instructionHash };
    if (wanted.title && outcome.title.status === 'ok') {
      result.title = { generation: wanted.title.generation, text: outcome.title.text };
    }
    if (wanted.description && outcome.description.status === 'ok') {
      result.description = {
        generation: wanted.description.generation,
        text: outcome.description.text
      };
    }
    const published =
      result.title || result.description
        ? await publishObjectiveBrief({ ctx, objectiveId, result })
        : { title: 'not_requested' as const, description: 'not_requested' as const };

    // Fields the composer could not produce: keep the instructions readable.
    if (wanted.title && outcome.title.status === 'failed') {
      await settleObjectiveTitleGeneration({
        ctx,
        objectiveId,
        generation: wanted.title.generation,
        status: 'failed'
      });
    }
    if (wanted.description && outcome.description.status === 'failed') {
      await failObjectiveDescriptionGeneration({
        ctx,
        objectiveId,
        generation: wanted.description.generation,
        failureCode: outcome.description.code
      });
    }

    logBriefMetric('objective_brief_composed', {
      jobId: job.id,
      objectiveId,
      pass,
      attempt: job.attempt_count,
      providerAttempts: outcome.attempts,
      durationMs: Date.now() - startedAt,
      inputChars: outcome.inputChars,
      model: outcome.model,
      title: wanted.title ? `${outcome.title.status}:${published.title}` : null,
      description: wanted.description
        ? `${outcome.description.status}:${published.description}`
        : null,
      descriptionWarnings:
        outcome.description.status === 'ok' ? outcome.description.warnings.length : null
    });
    return published.title === 'stale' || published.description === 'stale'
      ? { kind: 'stale' }
      : { kind: 'done' };
  }
}

export const objectiveBriefComposeWorker = new ObjectiveBriefComposeWorker();
