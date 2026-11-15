import type { DeliveryReportPayloadV1 } from '@overlord/contract';

/** Pure prose composition. Live item lists are owned by mission_items. */

export const MISSION_SUMMARY_LIMITS = {
  headline: 140,
  summary: 1_200,
  riskText: 400,
  risks: 8,
  riskCandidates: 40,
  suggestions: 50,
  fallbackSummarySentences: 3,
  firstParagraph: 600,
  newestDeliveryMarkdown: 3_000,
  questionPrompt: 400,
  openActions: 40,
  objectives: 60
} as const;

export interface MissionSummaryObjectiveEvidence {
  id: string;
  /** Display key such as `coo:1202.62s0`; empty for an objective without one. */
  key: string;
  title: string;
  state: string;
  reopenedAt: string | null;
  /** Deleted objectives keep their run boundary; clients render them as unassigned. */
  deleted: boolean;
}

export interface MissionSummaryDeliveryEvidence {
  id: string;
  objectiveId: string;
  deliveredAt: string;
  summary: string;
  report: DeliveryReportPayloadV1;
}

export interface MissionSummaryQuestionEvidence {
  requestId: string;
  objectiveId: string | null;
  prompt: string;
  createdAt: string;
}

export interface MissionSummaryRuns {
  /** Every current-run delivery, newest first. */
  currentRun: MissionSummaryDeliveryEvidence[];
  /** The latest current-run delivery of each objective, newest first. */
  latestByObjective: MissionSummaryDeliveryEvidence[];
  /** Deliveries that contribute nothing: before a reopen, or replaced by a newer one. */
  superseded: MissionSummaryDeliveryEvidence[];
}

export interface MissionSummaryResult {
  status: 'composed' | 'fallback';
  headline: string;
  summary: string;
  generatedBy: 'deterministic' | 'gemini';
  model: string | null;
}

const RUNNING_OBJECTIVE_STATES = new Set(['launching', 'executing', 'pending_delivery']);

function newestFirst(
  left: MissionSummaryDeliveryEvidence,
  right: MissionSummaryDeliveryEvidence
): number {
  const byTime = Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt);
  if (byTime !== 0) return byTime;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/**
 * SQL form of the reopenedAt rule, for selecting current-run deliveries in the
 * database before any limit. `delivery` and `objective` are the aliases of
 * `deliveries` and its LEFT JOINed objective; they are interpolated verbatim
 * and must be trusted identifiers. A delivery whose objective row is gone has
 * no boundary. {@link splitMissionSummaryRuns} applies the same rule in memory.
 */
export function currentRunDeliveryPredicateSql(delivery = 'd', objective = 'o'): string {
  return `(${objective}.reopened_at IS NULL OR ${delivery}.delivered_at >= ${objective}.reopened_at)`;
}

/** Splits deliveries into current-run and superseded per the reopenedAt rule. */
export function splitMissionSummaryRuns({
  objectives,
  deliveries
}: {
  objectives: Array<Pick<MissionSummaryObjectiveEvidence, 'id' | 'reopenedAt'>>;
  deliveries: MissionSummaryDeliveryEvidence[];
}): MissionSummaryRuns {
  const reopenedAt = new Map(objectives.map(objective => [objective.id, objective.reopenedAt]));
  const sorted = [...deliveries].sort(newestFirst);
  const currentRun: MissionSummaryDeliveryEvidence[] = [];
  const latestByObjective: MissionSummaryDeliveryEvidence[] = [];
  const superseded: MissionSummaryDeliveryEvidence[] = [];
  const seenObjectives = new Set<string>();
  for (const delivery of sorted) {
    const boundary = reopenedAt.get(delivery.objectiveId) ?? null;
    if (boundary !== null && Date.parse(delivery.deliveredAt) < Date.parse(boundary)) {
      superseded.push(delivery);
      continue;
    }
    currentRun.push(delivery);
    if (seenObjectives.has(delivery.objectiveId)) {
      superseded.push(delivery);
    } else {
      seenObjectives.add(delivery.objectiveId);
      latestByObjective.push(delivery);
    }
  }
  return { currentRun, latestByObjective, superseded };
}

function bound(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * First sentence of the composed presentation, falling back to the raw
 * delivery summary. Ported from `deliveryOneSentenceSummary` in the web client.
 */
export function deliveryOneSentence(
  delivery: Pick<MissionSummaryDeliveryEvidence, 'summary' | 'report'>
): string {
  const source = delivery.report.presentation.markdown.trim() || delivery.summary.trim();
  const plain = stripMarkdownInline(source);
  const match = plain.match(/^[^.!?]+[.!?]?/);
  return match?.[0]?.trim() || plain.slice(0, 200);
}

/** First paragraph of the composed presentation, bounded for the model input. */
export function deliveryFirstParagraph(
  delivery: Pick<MissionSummaryDeliveryEvidence, 'summary' | 'report'>
): string {
  const source = delivery.report.presentation.markdown.trim() || delivery.summary.trim();
  const paragraph = source.split(/\n\s*\n/).find(part => part.trim()) ?? '';
  return bound(paragraph, MISSION_SUMMARY_LIMITS.firstParagraph);
}

function objectiveLabel(
  objectives: MissionSummaryObjectiveEvidence[],
  objectiveId: string | null
): string {
  const objective = objectives.find(candidate => candidate.id === objectiveId);
  if (!objective || objective.deleted) return 'An objective';
  return objective.key ? `Objective ${objective.key}` : `Objective "${objective.title}"`;
}

function withPeriod(sentence: string): string {
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Deterministic headline and summary. With deliveries: the newest one-sentence
 * summary, and up to three latest-per-objective sentences. Before the first
 * delivery: the open question, the running objective, or an awaiting message.
 */
export function deterministicMissionSummaryText({
  objectives,
  runs,
  openQuestions
}: {
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
}): { headline: string; summary: string } {
  const newest = runs.latestByObjective[0];
  if (newest) {
    const sentences = runs.latestByObjective
      .slice(0, MISSION_SUMMARY_LIMITS.fallbackSummarySentences)
      .map(delivery => withPeriod(deliveryOneSentence(delivery)))
      .filter(sentence => sentence !== '.');
    return {
      headline: bound(deliveryOneSentence(newest), MISSION_SUMMARY_LIMITS.headline),
      summary: bound(sentences.join(' '), MISSION_SUMMARY_LIMITS.summary)
    };
  }

  const question = [...openQuestions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  )[0];
  if (question) {
    return {
      headline: 'An agent is waiting for your answer.',
      summary: bound(
        `${objectiveLabel(objectives, question.objectiveId)} asks: ${question.prompt.trim()}`,
        MISSION_SUMMARY_LIMITS.summary
      )
    };
  }

  const running = objectives.find(
    objective => !objective.deleted && RUNNING_OBJECTIVE_STATES.has(objective.state)
  );
  if (running) {
    const label = objectiveLabel(objectives, running.id);
    return {
      headline: bound(`${label} is running.`, MISSION_SUMMARY_LIMITS.headline),
      summary: `${label} is running. No objective has delivered yet.`
    };
  }

  return {
    headline: 'No objective has delivered yet.',
    summary: 'The mission is waiting for its first delivery.'
  };
}

/** Reconciles fallback prose only; item lists are never model-authored. */
export function reconcileMissionSummaryDraft({
  draft,
  objectives,
  runs,
  openQuestions,
  model
}: {
  draft: unknown;
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
  model: string | null;
}): MissionSummaryResult {
  const record =
    draft && typeof draft === 'object' && !Array.isArray(draft)
      ? (draft as Record<string, unknown>)
      : null;
  const headline = typeof record?.headline === 'string' ? record.headline.trim() : '';
  const summary = typeof record?.summary === 'string' ? record.summary.trim() : '';
  if (!record || !headline || !summary) {
    return buildDeterministicMissionSummary({ objectives, runs, openQuestions });
  }
  return {
    status: 'composed',
    headline: bound(headline, MISSION_SUMMARY_LIMITS.headline),
    summary: bound(summary, MISSION_SUMMARY_LIMITS.summary),
    generatedBy: 'gemini',
    model
  };
}

/** The complete deterministic fallback result. */
export function buildDeterministicMissionSummary({
  objectives,
  runs,
  openQuestions
}: {
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
}): MissionSummaryResult {
  return {
    status: 'fallback',
    ...deterministicMissionSummaryText({ objectives, runs, openQuestions }),
    generatedBy: 'deterministic',
    model: null
  };
}
