import {
  type ComposeMissionSummaryInput,
  composeMissionSummaryWithGemini,
  isGeminiConfigured,
  readGeminiConfigFromEnv
} from '@overlord/automations';
import { formatObjectiveDisplayId } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { readDeliveryReport } from '../packages/core/service/delivery-report.ts';
import {
  buildDeterministicMissionSummary,
  collectMissionSummaryOpenActions,
  collectMissionSummaryRiskCandidates,
  deliveryFirstParagraph,
  MISSION_SUMMARY_LIMITS,
  type MissionSummaryDeliveryEvidence,
  type MissionSummaryObjectiveEvidence,
  type MissionSummaryQuestionEvidence,
  type MissionSummaryResult,
  missionSummaryRiskRef,
  type MissionSummaryRuns,
  reconcileMissionSummaryDraft,
  selectMissionSummarySuggestions,
  splitMissionSummaryRuns
} from '../packages/core/service/mission-summary-compose.ts';
import {
  type ClaimedWorkerJob,
  completeMissionSummaryComposeJob,
  MISSION_SUMMARY_COMPOSE_JOB_TYPE,
  publishMissionSummary,
  readMissionSummaryGeneration
} from '../packages/core/service/worker-jobs.ts';

import { requireDatabaseClient } from './db.ts';
import { WorkerJobPoller } from './worker-job-poller.ts';

const CLAIM_BATCH_SIZE = 5;
/** Compose passes per job before the job hands outstanding triggers to a successor. */
const MAX_PASSES_PER_JOB = 3;

type MissionSummaryGenerator = (args: {
  prompt: string;
  systemInstruction: string;
}) => Promise<string | null>;

/** Emits bounded operational metrics without summary text or prompt content. */
function logSummaryMetric(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  console.info('[mission-summary-compose-worker]', JSON.stringify({ event, ...fields }));
}

/** Evidence for one compose pass, read together with the generation it serves. */
export type MissionSummaryEvidence = {
  generation: number;
  sourceDeliveryId: string | null;
  previous: { headline: string; summary: string } | null;
  mission: { title: string; statusType: string; displayId: string };
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
  resolutionStatus: Map<string, string>;
  counts: { deliveries: number; filePaths: number };
};

/**
 * Loads the evidence for one pass in a single transaction, so the generation
 * and the evidence form one consistent snapshot. Deliveries are selected in the
 * database by current-run eligibility before any limit (plan §4.4a): every
 * current-run delivery of the mission, whose count is bounded by the run
 * boundaries rather than by a presentation page.
 */
export async function loadMissionSummaryEvidence(
  client: DatabaseClient,
  missionId: string
): Promise<MissionSummaryEvidence | null> {
  return client.transaction(async tx => {
    const generation = await readMissionSummaryGeneration(tx, missionId);
    if (!generation) return null;
    const mission = await tx.get<{
      title: string;
      status_type: string;
      display_id: string;
      summary_enabled: unknown;
    }>(
      `SELECT title, status_type, display_id, summary_enabled FROM missions
        WHERE id = ? AND deleted_at IS NULL`,
      [missionId]
    );
    if (!mission) return null;

    const objectiveRows = await tx.all<{
      id: string;
      display_key: string;
      title: string | null;
      state: string;
      reopened_at: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id, display_key, title, state, reopened_at, deleted_at
         FROM objectives WHERE mission_id = ?`,
      [missionId]
    );
    const objectives: MissionSummaryObjectiveEvidence[] = objectiveRows.map(row => ({
      id: row.id,
      key: formatObjectiveDisplayId({
        missionDisplayId: mission.display_id,
        displayKey: row.display_key
      }),
      title: row.title?.trim() || 'Untitled objective',
      state: row.state,
      reopenedAt: row.reopened_at,
      deleted: row.deleted_at !== null
    }));

    const deliveryRows = await tx.all<{
      id: string;
      objective_id: string;
      delivered_at: string;
      summary: string;
      payload_json: string | null;
    }>(
      `SELECT d.id, d.objective_id, d.delivered_at, d.summary, d.payload_json
         FROM deliveries d
         LEFT JOIN objectives o ON o.id = d.objective_id
        WHERE d.mission_id = ? AND d.deleted_at IS NULL
          AND (o.reopened_at IS NULL OR d.delivered_at >= o.reopened_at)
        ORDER BY d.delivered_at DESC, d.id DESC`,
      [missionId]
    );
    const deliveries: MissionSummaryDeliveryEvidence[] = deliveryRows.map(row => ({
      id: row.id,
      objectiveId: row.objective_id,
      deliveredAt: row.delivered_at,
      summary: row.summary,
      report: reportFromPayload(row.payload_json, row.summary)
    }));
    const runs = splitMissionSummaryRuns({ objectives, deliveries });

    const resolutionRows =
      runs.currentRun.length === 0
        ? []
        : await tx.all<{ delivery_id: string; action_id: string; status: string }>(
            `SELECT delivery_id, action_id, status FROM human_action_resolutions
              WHERE mission_id = ?`,
            [missionId]
          );
    const resolutionStatus = new Map(
      resolutionRows.map(row => [`${row.delivery_id}:${row.action_id}`, row.status])
    );

    const questionRows = await tx.all<{
      id: string;
      objective_id: string | null;
      summary: string;
      created_at: string;
    }>(
      `SELECT id, objective_id, summary, created_at FROM agent_requests
        WHERE mission_id = ? AND deleted_at IS NULL AND status = 'open'
          AND kind IN ('question', 'choice')
        ORDER BY created_at DESC
        LIMIT 20`,
      [missionId]
    );

    const filePathCount = await tx.get<{ total: number | string }>(
      `SELECT COUNT(DISTINCT file_path) AS total FROM changed_files
        WHERE mission_id = ? AND deleted_at IS NULL`,
      [missionId]
    );

    return {
      generation: generation.requestedGeneration,
      sourceDeliveryId: generation.sourceDeliveryId,
      previous: generation.previous,
      mission: {
        title: mission.title,
        statusType: mission.status_type,
        displayId: mission.display_id
      },
      objectives,
      runs,
      openQuestions: questionRows.map(row => ({
        requestId: row.id,
        objectiveId: row.objective_id,
        prompt: row.summary,
        createdAt: row.created_at
      })),
      resolutionStatus,
      counts: {
        deliveries: runs.currentRun.length,
        filePaths: Number(filePathCount?.total ?? 0)
      }
    };
  });
}

function reportFromPayload(payloadJson: string | null, summary: string) {
  let deliveryReport: unknown;
  try {
    deliveryReport = payloadJson
      ? (JSON.parse(payloadJson) as { deliveryReport?: unknown }).deliveryReport
      : undefined;
  } catch {
    deliveryReport = undefined;
  }
  return readDeliveryReport({ summary, deliveryReport });
}

function bound(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

/**
 * Builds the bounded model input (plan §4.5, §11 item 5). Only unresolved
 * deferred work enters the model context, and only by title.
 */
export function toMissionSummaryInput(
  evidence: MissionSummaryEvidence,
  suggestions: ReturnType<typeof selectMissionSummarySuggestions>
): ComposeMissionSummaryInput {
  const keyOf = (objectiveId: string | null) =>
    evidence.objectives.find(objective => objective.id === objectiveId && !objective.deleted)
      ?.key ?? 'unassigned';
  const latest = new Map(
    evidence.runs.latestByObjective.map(delivery => [delivery.objectiveId, delivery])
  );
  const newest = evidence.runs.latestByObjective[0] ?? null;
  const deliveries = new Map(evidence.runs.currentRun.map(delivery => [delivery.id, delivery]));
  return {
    mission: { title: evidence.mission.title, statusType: evidence.mission.statusType },
    previousSummary: evidence.previous,
    objectives: evidence.objectives
      .filter(objective => !objective.deleted)
      .slice(0, MISSION_SUMMARY_LIMITS.objectives)
      .map(objective => {
        const delivery = latest.get(objective.id);
        return {
          key: objective.key,
          title: objective.title,
          state: objective.state,
          latestDelivery: delivery
            ? {
                deliveryId: delivery.id,
                deliveredAt: delivery.deliveredAt,
                firstParagraph: deliveryFirstParagraph(delivery)
              }
            : null
        };
      }),
    newestDelivery: newest
      ? {
          objectiveKey: keyOf(newest.objectiveId),
          markdown: bound(
            newest.report.presentation.markdown.trim() || newest.summary,
            MISSION_SUMMARY_LIMITS.newestDeliveryMarkdown
          )
        }
      : null,
    openActions: collectMissionSummaryOpenActions(evidence.runs.latestByObjective)
      .slice(0, MISSION_SUMMARY_LIMITS.openActions)
      .map(({ delivery, action }) => ({
        ref: `${delivery.id}:${action.id}`,
        objectiveKey: keyOf(delivery.objectiveId),
        action: action.action,
        ...(action.reason ? { reason: action.reason } : {}),
        blocking: action.blocking === true,
        category: action.category
      })),
    openQuestions: evidence.openQuestions.map(question => ({
      requestId: question.requestId,
      objectiveKey: keyOf(question.objectiveId),
      prompt: bound(question.prompt, MISSION_SUMMARY_LIMITS.questionPrompt)
    })),
    pendingSuggestions: suggestions.flatMap(ref => {
      if (evidence.resolutionStatus.has(`${ref.deliveryId}:${ref.actionId}`)) return [];
      const item = deliveries
        .get(ref.deliveryId)
        ?.report.presentation.deferredWork.find(candidate => candidate.id === ref.actionId);
      return item ? [{ objectiveKey: keyOf(ref.objectiveId), title: item.title }] : [];
    }),
    knownRisks: collectMissionSummaryRiskCandidates(evidence.runs.currentRun).map(risk => ({
      ref: missionSummaryRiskRef(risk),
      objectiveKey: keyOf(risk.objectiveId),
      text: risk.text
    })),
    counts: evidence.counts
  };
}

type PassOutcome =
  | { kind: 'missing' }
  | { kind: 'stale' }
  | {
      kind: 'published';
      result: MissionSummaryResult;
      inputBytes: number;
    };

/**
 * In-process mission summary compose worker on the shared WorkerJobPoller
 * loop. Each job composes until it publishes the latest requested generation
 * (bounded by MAX_PASSES_PER_JOB) and then completes under the summary row
 * lock, which queues a successor when a trigger is still outstanding. Skips
 * ticks while OVERLORD_MISSION_SUMMARY_COMPOSE_DISABLED=1.
 */
class MissionSummaryComposeWorker extends WorkerJobPoller {
  private generateOverride: MissionSummaryGenerator | null = null;

  constructor() {
    super({
      workerIdPrefix: 'mission-summary-compose',
      jobTypes: [MISSION_SUMMARY_COMPOSE_JOB_TYPE],
      logPrefix: 'mission-summary-compose-worker',
      claimBatchSize: CLAIM_BATCH_SIZE
    });
  }

  /** Test seam: inject a fake Gemini generator. */
  setGenerateOverride(generate: MissionSummaryGenerator | null): void {
    this.generateOverride = generate;
  }

  protected shouldPoll(): boolean {
    return process.env.OVERLORD_MISSION_SUMMARY_COMPOSE_DISABLED !== '1';
  }

  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }

  /** Test seam: process one claimed job directly. */
  async processJobForTest(client: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    await this.processJob(client, job);
  }

  protected async processJob(client: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    const startedAt = Date.now();
    let missionId: string;
    try {
      const payload = JSON.parse(job.payload_json) as { missionId?: unknown };
      if (typeof payload.missionId !== 'string' || !payload.missionId.trim()) {
        throw new Error('Missing missionId in worker payload');
      }
      missionId = payload.missionId.trim();
    } catch (err) {
      await this.finishJob(client, job, 'failed', `Malformed payload: ${String(err)}`);
      return;
    }

    try {
      for (let pass = 1; pass <= MAX_PASSES_PER_JOB; pass++) {
        const outcome = await this.composePass(client, missionId, false);
        if (outcome.kind === 'missing') {
          await completeMissionSummaryComposeJob({
            db: client,
            jobId: job.id,
            missionId,
            status: 'cancelled',
            lastError: 'Mission summary not found'
          });
          logSummaryMetric('mission_summary_cancelled', { jobId: job.id, missionId });
          return;
        }
        if (outcome.kind === 'stale') {
          logSummaryMetric('mission_summary_stale', { jobId: job.id, missionId, pass });
          continue;
        }
        logSummaryMetric(
          outcome.result.status === 'composed'
            ? 'mission_summary_composed'
            : 'mission_summary_fallback',
          {
            jobId: job.id,
            missionId,
            attempt: job.attempt_count,
            pass,
            durationMs: Date.now() - startedAt,
            model: outcome.result.model,
            risks: outcome.result.risks.length,
            suggestions: outcome.result.suggestions.length,
            inputBytes: outcome.inputBytes,
            estimatedInputTokens: Math.ceil(outcome.inputBytes / 4)
          }
        );
        break;
      }
      // Publishes or exhausts its passes; either way an outstanding trigger
      // becomes a successor job inside the completion transaction.
      const { successorJobId } = await completeMissionSummaryComposeJob({
        db: client,
        jobId: job.id,
        missionId,
        status: 'succeeded'
      });
      if (successorJobId) {
        logSummaryMetric('mission_summary_successor_queued', {
          jobId: job.id,
          missionId,
          successorJobId
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mission-summary-compose-worker] job ${job.id} failed:`, message);
      if (job.attempt_count < job.max_attempts) {
        await this.failOrRetry(client, job, err);
        logSummaryMetric('mission_summary_failed', {
          jobId: job.id,
          missionId,
          attempt: job.attempt_count,
          retrying: true,
          durationMs: Date.now() - startedAt
        });
        return;
      }
      // Final failure: publish a deterministic fallback from current evidence
      // under the same generation guard, then complete (queueing a successor
      // if a newer trigger is outstanding).
      await this.composePass(client, missionId, true).catch(fallbackErr => {
        console.warn('[mission-summary-compose-worker] fallback persist failed', fallbackErr);
      });
      await completeMissionSummaryComposeJob({
        db: client,
        jobId: job.id,
        missionId,
        status: 'failed',
        lastError: message
      });
      logSummaryMetric('mission_summary_failed', {
        jobId: job.id,
        missionId,
        attempt: job.attempt_count,
        durationMs: Date.now() - startedAt
      });
    }
  }

  private async composePass(
    client: DatabaseClient,
    missionId: string,
    forceFallback: boolean
  ): Promise<PassOutcome> {
    const evidence = await loadMissionSummaryEvidence(client, missionId);
    if (!evidence) return { kind: 'missing' };

    const suggestions = selectMissionSummarySuggestions({
      currentRun: evidence.runs.currentRun,
      resolutionStatus: evidence.resolutionStatus
    });
    const shared = {
      objectives: evidence.objectives,
      runs: evidence.runs,
      openQuestions: evidence.openQuestions,
      suggestions
    };

    let result: MissionSummaryResult;
    let inputBytes = 0;
    const canGenerate = isGeminiConfigured() || this.generateOverride !== null;
    if (forceFallback || !canGenerate) {
      result = buildDeterministicMissionSummary(shared);
    } else {
      const input = toMissionSummaryInput(evidence, suggestions);
      inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
      const generate = this.generateOverride;
      const draft = await composeMissionSummaryWithGemini({
        input,
        ...(generate
          ? {
              generate: async ({ prompt, systemInstruction }) =>
                generate({ prompt, systemInstruction })
            }
          : {})
      });
      result = reconcileMissionSummaryDraft({
        ...shared,
        draft,
        model: readGeminiConfigFromEnv()?.model ?? null
      });
    }

    const published = await publishMissionSummary({
      db: client,
      missionId,
      generation: evidence.generation,
      publication: {
        status: result.status,
        headline: result.headline,
        summary: result.summary,
        risks: result.risks,
        suggestions: result.suggestions,
        sourceDeliveryId: evidence.sourceDeliveryId,
        generatedBy: result.generatedBy,
        model: result.model
      }
    });
    if (published === 'missing') return { kind: 'missing' };
    if (published === 'stale') return { kind: 'stale' };
    return { kind: 'published', result, inputBytes };
  }
}

export const missionSummaryComposeWorker = new MissionSummaryComposeWorker();
