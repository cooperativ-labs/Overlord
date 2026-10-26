import type { DeliveryReportPayloadV1, HumanActionV1 } from '@overlord/contract';

/**
 * Pure half of the mission summary compose job (coo:1202, plan §4.4 and §4.5).
 *
 * The worker loads evidence and calls these functions; nothing here touches the
 * database or the model. Supersession follows plan §11 item 14: a delivery is
 * superseded when it was delivered before its objective's `reopenedAt`, or when
 * a newer current-run delivery exists for the same objective. Actions come from
 * the latest current-run delivery per objective; risks and suggestions span
 * every current-run delivery.
 *
 * Operator surface only: the result is stored on `mission_summaries` and never
 * reaches load-context, the mission packet, MCP tools, or CLI protocol commands.
 */

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

export interface MissionSummaryRiskRef {
  deliveryId: string;
  objectiveId: string;
  index: number;
  text: string;
}

export interface MissionSummarySuggestionRef {
  deliveryId: string;
  objectiveId: string;
  actionId: string;
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
  risks: MissionSummaryRiskRef[];
  suggestions: MissionSummarySuggestionRef[];
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

function normaliseText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function bound(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Suggestion references in display order: unresolved and promoted deferred
 * work from every current-run delivery, newest delivery first, deduped by
 * normalised title. Dismissed items are hidden. Item text is never copied; the
 * read route projects it from the delivery at read time.
 */
export function selectMissionSummarySuggestions({
  currentRun,
  resolutionStatus
}: {
  currentRun: MissionSummaryDeliveryEvidence[];
  /** `${deliveryId}:${actionId}` → resolution status (`dismissed`, `promoted`, ...). */
  resolutionStatus: ReadonlyMap<string, string>;
}): MissionSummarySuggestionRef[] {
  const refs: MissionSummarySuggestionRef[] = [];
  const titles = new Set<string>();
  for (const delivery of currentRun) {
    for (const item of delivery.report.presentation.deferredWork) {
      if (resolutionStatus.get(`${delivery.id}:${item.id}`) === 'dismissed') continue;
      const title = normaliseText(item.title);
      if (titles.has(title)) continue;
      titles.add(title);
      refs.push({ deliveryId: delivery.id, objectiveId: delivery.objectiveId, actionId: item.id });
      if (refs.length >= MISSION_SUMMARY_LIMITS.suggestions) return refs;
    }
  }
  return refs;
}

/** Known risks across current-run deliveries, newest kept, deduped by normalised text. */
export function collectMissionSummaryRiskCandidates(
  deliveries: MissionSummaryDeliveryEvidence[]
): MissionSummaryRiskRef[] {
  const candidates: MissionSummaryRiskRef[] = [];
  const texts = new Set<string>();
  for (const delivery of deliveries) {
    delivery.report.presentation.knownRisks.forEach((risk, index) => {
      const normalised = normaliseText(risk);
      if (!normalised || texts.has(normalised)) return;
      texts.add(normalised);
      candidates.push({
        deliveryId: delivery.id,
        objectiveId: delivery.objectiveId,
        index,
        text: bound(risk, MISSION_SUMMARY_LIMITS.riskText)
      });
    });
  }
  return candidates.slice(0, MISSION_SUMMARY_LIMITS.riskCandidates);
}

export function missionSummaryRiskRef(risk: Pick<MissionSummaryRiskRef, 'deliveryId' | 'index'>) {
  return `${risk.deliveryId}:${risk.index}`;
}

/** Open human actions of the latest current-run delivery per objective, blocking first. */
export function collectMissionSummaryOpenActions(
  latestByObjective: MissionSummaryDeliveryEvidence[]
): Array<{ delivery: MissionSummaryDeliveryEvidence; action: HumanActionV1 }> {
  const actions = latestByObjective.flatMap(delivery =>
    delivery.report.presentation.humanActions.map(action => ({ delivery, action }))
  );
  return actions
    .map((entry, order) => ({ entry, order }))
    .sort(
      (left, right) =>
        Number(right.entry.action.blocking === true) -
          Number(left.entry.action.blocking === true) || left.order - right.order
    )
    .map(({ entry }) => entry);
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

/** Deterministic risks: the latest-per-objective known risks, deduped by normalised text. */
export function deterministicMissionSummaryRisks(
  runs: MissionSummaryRuns
): MissionSummaryRiskRef[] {
  return collectMissionSummaryRiskCandidates(runs.latestByObjective).slice(
    0,
    MISSION_SUMMARY_LIMITS.risks
  );
}

function readDraftRisks(
  draft: Record<string, unknown>,
  candidates: MissionSummaryRiskRef[]
): MissionSummaryRiskRef[] {
  if (!Array.isArray(draft.risks)) return [];
  const byRef = new Map(candidates.map(candidate => [missionSummaryRiskRef(candidate), candidate]));
  const kept: MissionSummaryRiskRef[] = [];
  const seen = new Set<string>();
  for (const item of draft.risks) {
    if (!item || typeof item !== 'object') continue;
    const { ref, text } = item as Record<string, unknown>;
    if (typeof ref !== 'string') continue;
    const candidate = byRef.get(ref.trim());
    if (!candidate || seen.has(ref.trim())) continue;
    seen.add(ref.trim());
    const rewritten = typeof text === 'string' && text.trim() ? text : candidate.text;
    kept.push({ ...candidate, text: bound(rewritten, MISSION_SUMMARY_LIMITS.riskText) });
    if (kept.length >= MISSION_SUMMARY_LIMITS.risks) break;
  }
  return kept;
}

/**
 * Reconciles the model draft against the evidence. Risks whose ref is not in
 * the evidence are dropped and text is bounded. A null draft, or one without a
 * usable headline and summary, falls back to deterministic content. Suggestions
 * are never part of the draft.
 */
export function reconcileMissionSummaryDraft({
  draft,
  objectives,
  runs,
  openQuestions,
  suggestions,
  model
}: {
  draft: unknown;
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
  suggestions: MissionSummarySuggestionRef[];
  model: string | null;
}): MissionSummaryResult {
  const record =
    draft && typeof draft === 'object' && !Array.isArray(draft)
      ? (draft as Record<string, unknown>)
      : null;
  const headline = typeof record?.headline === 'string' ? record.headline.trim() : '';
  const summary = typeof record?.summary === 'string' ? record.summary.trim() : '';
  if (!record || !headline || !summary) {
    return buildDeterministicMissionSummary({ objectives, runs, openQuestions, suggestions });
  }
  return {
    status: 'composed',
    headline: bound(headline, MISSION_SUMMARY_LIMITS.headline),
    summary: bound(summary, MISSION_SUMMARY_LIMITS.summary),
    risks: readDraftRisks(record, collectMissionSummaryRiskCandidates(runs.currentRun)),
    suggestions,
    generatedBy: 'gemini',
    model
  };
}

/** The complete deterministic fallback result. */
export function buildDeterministicMissionSummary({
  objectives,
  runs,
  openQuestions,
  suggestions
}: {
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
  suggestions: MissionSummarySuggestionRef[];
}): MissionSummaryResult {
  return {
    status: 'fallback',
    ...deterministicMissionSummaryText({ objectives, runs, openQuestions }),
    risks: deterministicMissionSummaryRisks(runs),
    suggestions,
    generatedBy: 'deterministic',
    model: null
  };
}
