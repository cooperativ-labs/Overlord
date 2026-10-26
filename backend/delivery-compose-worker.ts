import {
  type ComposeDeliveryDraft,
  type ComposeDeliveryInput,
  composeDeliveryWithGemini,
  isGeminiConfigured,
  readGeminiConfigFromEnv
} from '@overlord/automations';
import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import {
  applyDeliveryPresentation,
  type DeferredWorkObjectiveRef,
  deriveDeterministicActionCandidates,
  reconcileDeliveryComposeDraft
} from '../packages/core/service/delivery-compose.ts';
import {
  type DeliveryComposeContext,
  persistDeliveryPresentation,
  readDeliveryComposeContext
} from '../packages/core/service/delivery-presentation.ts';
import {
  type ClaimedWorkerJob,
  DELIVERY_COMPOSE_JOB_TYPE
} from '../packages/core/service/worker-jobs.ts';

import {
  findActiveMembershipId,
  getActiveTokenId,
  requireDatabaseClient,
  resolveActiveProfileId
} from './db.ts';
import { WorkerJobPoller } from './worker-job-poller.ts';

const CLAIM_BATCH_SIZE = 5;
const MAX_COMPOSE_SUMMARY_CHARS = 6_000;
const MAX_COMPOSE_AUXILIARY_CHARS = 2_000;
const MAX_COMPOSE_EVENT_CHARS = 1_000;

type WorkerJobRow = ClaimedWorkerJob;

type DeliveryRow = DeliveryComposeContext['delivery'];

type ComposeGenerator = (args: {
  prompt: string;
  systemInstruction: string;
}) => Promise<string | null>;

type ComposeResult =
  | { kind: 'missing' }
  | {
      kind: 'updated';
      presentationStatus: 'composed' | 'fallback';
      model: string | null;
      inputBytes: number;
      estimatedInputTokens: number;
    };

/** Emits bounded operational metrics without delivery summaries or prompt content. */
function logComposeMetric(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  console.info('[delivery-compose-worker]', JSON.stringify({ event, ...fields }));
}

/**
 * In-process, database-backed delivery composition worker on the shared
 * WorkerJobPoller loop. Drains up to CLAIM_BATCH_SIZE jobs per tick and skips
 * ticks entirely while OVERLORD_DELIVERY_COMPOSE_DISABLED=1.
 */
class DeliveryComposeWorker extends WorkerJobPoller {
  private generateOverride: ComposeGenerator | null = null;

  constructor() {
    super({
      workerIdPrefix: 'delivery-compose',
      jobTypes: [DELIVERY_COMPOSE_JOB_TYPE],
      logPrefix: 'delivery-compose-worker',
      claimBatchSize: CLAIM_BATCH_SIZE
    });
  }

  /** Test seam: inject a fake Gemini generator. */
  setGenerateOverride(generate: ComposeGenerator | null): void {
    this.generateOverride = generate;
  }

  protected shouldPoll(): boolean {
    return process.env.OVERLORD_DELIVERY_COMPOSE_DISABLED !== '1';
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  protected async processJob(client: DatabaseClient, job: WorkerJobRow): Promise<void> {
    const startedAt = Date.now();
    let deliveryId: string;
    try {
      const payload = JSON.parse(job.payload_json) as { deliveryId?: unknown };
      if (typeof payload.deliveryId !== 'string' || !payload.deliveryId.trim()) {
        throw new Error('Missing deliveryId in worker payload');
      }
      deliveryId = payload.deliveryId.trim();
    } catch (err) {
      await this.finishJob(client, job, 'failed', `Malformed payload: ${String(err)}`);
      return;
    }

    const attemptNumber = job.attempt_count;
    try {
      const result = await this.composeAndPersist(client, deliveryId);
      if (result.kind === 'missing') {
        await this.finishJob(client, job, 'cancelled', 'Delivery not found');
        logComposeMetric('delivery_compose_failed', {
          jobId: job.id,
          deliveryId,
          attempt: job.attempt_count,
          outcome: 'cancelled',
          durationMs: Date.now() - startedAt
        });
        return;
      }
      await this.finishJob(client, job);
      logComposeMetric(
        result.presentationStatus === 'composed'
          ? 'delivery_compose_composed'
          : 'delivery_compose_fallback',
        {
          jobId: job.id,
          deliveryId,
          attempt: job.attempt_count,
          durationMs: Date.now() - startedAt,
          model: result.model,
          inputBytes: result.inputBytes,
          estimatedInputTokens: result.estimatedInputTokens
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[delivery-compose-worker] job ${job.id} failed:`, message);
      const outcome = await this.failOrRetry(client, job, err);
      if (outcome === 'failed') {
        await persistFallbackPresentation(client, deliveryId, message).catch(persistErr => {
          console.warn('[delivery-compose-worker] fallback persist failed', persistErr);
        });
        logComposeMetric('delivery_compose_failed', {
          jobId: job.id,
          deliveryId,
          attempt: attemptNumber,
          durationMs: Date.now() - startedAt
        });
        return;
      }
      logComposeMetric('delivery_compose_failed', {
        jobId: job.id,
        deliveryId,
        attempt: attemptNumber,
        retrying: true,
        durationMs: Date.now() - startedAt
      });
    }
  }

  private async composeAndPersist(
    client: DatabaseClient,
    deliveryId: string
  ): Promise<ComposeResult> {
    const context = await readDeliveryComposeContext(client, deliveryId);
    if (!context) return { kind: 'missing' };

    const { delivery, report, filePaths, objective, plannedObjectives, recentEvents } = context;
    const candidates = deriveDeterministicActionCandidates({ filePaths });
    const model = readGeminiConfigFromEnv()?.model ?? null;

    let draft: ComposeDeliveryDraft | null = null;
    let inputBytes = 0;
    if (isGeminiConfigured() || this.generateOverride) {
      const input = toComposeInput({
        delivery,
        report,
        candidates,
        objective,
        plannedObjectives,
        recentEvents
      });
      inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
      draft = await composeDeliveryWithGemini({
        input,
        ...(this.generateOverride
          ? {
              generate: async ({ prompt, systemInstruction }) =>
                this.generateOverride!({ prompt, systemInstruction })
            }
          : {})
      });
    }

    const presentation = reconcileDeliveryComposeDraft({
      report,
      draft,
      candidates,
      model,
      currentObjective: objective,
      plannedObjectives
    });

    // No provider and no draft → leave deterministic content as fallback.
    if (!draft && !isGeminiConfigured() && !this.generateOverride) {
      presentation.status = 'fallback';
      presentation.generatedBy = 'deterministic';
    }

    const nextReport = applyDeliveryPresentation({ report, presentation });
    await persistDeliveryPresentation({
      db: client,
      delivery,
      nextReport,
      changedFields: ['payload_json', 'presentation'],
      resolveChangeAttribution: tx => deliveryChangeAttribution(tx, delivery.workspace_id)
    });
    return {
      kind: 'updated',
      presentationStatus: presentation.status === 'composed' ? 'composed' : 'fallback',
      model,
      inputBytes,
      estimatedInputTokens: Math.ceil(inputBytes / 4)
    };
  }
}

async function persistFallbackPresentation(
  client: DatabaseClient,
  deliveryId: string,
  _lastError: string
): Promise<void> {
  const context = await readDeliveryComposeContext(client, deliveryId);
  if (!context) return;
  const presentation = reconcileDeliveryComposeDraft({
    report: context.report,
    draft: null,
    candidates: deriveDeterministicActionCandidates({ filePaths: context.filePaths }),
    model: readGeminiConfigFromEnv()?.model ?? null,
    currentObjective: context.objective,
    plannedObjectives: context.plannedObjectives
  });
  presentation.status = 'fallback';
  const nextReport = applyDeliveryPresentation({
    report: context.report,
    presentation
  });
  await persistDeliveryPresentation({
    db: client,
    delivery: context.delivery,
    nextReport,
    changedFields: ['payload_json', 'presentation'],
    resolveChangeAttribution: tx => deliveryChangeAttribution(tx, context.delivery.workspace_id)
  });
}

async function deliveryChangeAttribution(db: DatabaseClient, workspaceId: string) {
  const profileId = await resolveActiveProfileId(db);
  return {
    actorWorkspaceUserId: profileId
      ? await findActiveMembershipId(workspaceId, profileId, db)
      : null,
    actorTokenId: getActiveTokenId(),
    source: 'webapp'
  };
}

function toComposeInput({
  delivery,
  report,
  candidates,
  objective,
  plannedObjectives,
  recentEvents
}: {
  delivery: DeliveryRow;
  report: DeliveryReportPayloadV1;
  candidates: ReturnType<typeof deriveDeterministicActionCandidates>;
  objective: DeferredWorkObjectiveRef;
  plannedObjectives: DeferredWorkObjectiveRef[];
  recentEvents: Array<{ type: string; summary: string }>;
}): ComposeDeliveryInput {
  return {
    summary: boundComposeText(delivery.summary, MAX_COMPOSE_SUMMARY_CHARS),
    objectiveTitle: objective.title ?? null,
    objectiveInstruction: objective.instruction ?? null,
    plannedObjectives,
    verificationSummary: delivery.verification_summary
      ? boundComposeText(delivery.verification_summary, MAX_COMPOSE_AUXILIARY_CHARS)
      : null,
    followUpNotes: delivery.follow_up_notes
      ? boundComposeText(delivery.follow_up_notes, MAX_COMPOSE_AUXILIARY_CHARS)
      : null,
    humanActions: report.agentReport.humanActions.map(action => ({
      id: action.id,
      action: action.action,
      ...(action.reason ? { reason: action.reason } : {}),
      category: action.category,
      ...(action.command ? { command: action.command } : {}),
      ...(action.verify ? { verify: action.verify } : {}),
      ...(action.link ? { link: action.link } : {}),
      source: action.source,
      ...(action.sourceRef ? { sourceRef: action.sourceRef } : {})
    })),
    tradeoffsMade: report.agentReport.tradeoffsMade.map(tradeoff => ({
      id: tradeoff.id,
      decision: tradeoff.decision,
      rationale: tradeoff.rationale,
      alternativesConsidered: tradeoff.alternativesConsidered,
      ...(tradeoff.impact ? { impact: tradeoff.impact } : {}),
      source: tradeoff.source,
      ...(tradeoff.sourceRef ? { sourceRef: tradeoff.sourceRef } : {})
    })),
    knownRisks: report.agentReport.knownRisks,
    assumptions: report.agentReport.assumptions,
    candidateActions: candidates.map(action => ({
      id: action.id,
      action: action.action,
      ...(action.reason ? { reason: action.reason } : {}),
      category: action.category,
      ...(action.command ? { command: action.command } : {}),
      ...(action.verify ? { verify: action.verify } : {}),
      ...(action.link ? { link: action.link } : {}),
      source: action.source,
      ...(action.sourceRef ? { sourceRef: action.sourceRef } : {})
    })),
    recentEvents: recentEvents.slice(0, 12).map(event => ({
      type: event.type,
      summary: boundComposeText(event.summary, MAX_COMPOSE_EVENT_CHARS)
    }))
  };
}

function boundComposeText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

export const deliveryComposeWorker = new DeliveryComposeWorker();
