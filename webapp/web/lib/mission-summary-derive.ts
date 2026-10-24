/**
 * Pure derivations behind the Mission summary section (plan §5.2).
 *
 * Inputs are the queries the mission panel already holds: the mission detail,
 * the summary envelope (`GET /api/missions/:id/summary`), the mission's agent
 * requests, the delivery feed (only to date suggestions and risks for the
 * new-item dot), and the mission-wide file-change page. Actions and sources
 * come from the envelope's evidence, which the server selects before any cap
 * (§4.4a, §11.1 item 3), never from the capped delivery feed.
 *
 * The iOS port (`OverlordCore/MissionSummaryDerive.swift`) mirrors these rules
 * and is tested against the same fixture,
 * `contract/mission-summary-derive-fixtures.json`.
 */
import type {
  AgentRequestDto,
  FileChangeDto,
  FileChangeSource,
  HumanActionCategory,
  HumanActionResolutionDto,
  MissionSummaryDto,
  MissionSummaryEvidenceDto,
  MissionSummaryResponse,
  ObjectiveState,
  StatusType
} from '../../shared/contract.ts';

/** The objective fields the derivations read. Only live (non-deleted) objectives are passed. */
export interface SummaryObjective {
  id: string;
  displayId: string;
  title: string | null;
  state: ObjectiveState;
}

/** The delivery fields used to date suggestions and risks. */
export interface SummaryDeliveryStamp {
  id: string;
  objectiveId: string;
  deliveredAt: string;
}

// ---- Status chip ----

export type SummaryStatusTone = 'review' | 'execute' | 'blocked' | 'complete' | 'neutral';

export interface SummaryStatusChip {
  label: string;
  tone: SummaryStatusTone;
}

/** Status chip from `mission.statusType`. Colour is always paired with this text. */
export function missionSummaryStatusChip(statusType: StatusType): SummaryStatusChip {
  switch (statusType) {
    case 'review':
      return { label: 'In review', tone: 'review' };
    case 'execute':
      return { label: 'Executing', tone: 'execute' };
    case 'blocked':
      return { label: 'Blocked', tone: 'blocked' };
    case 'complete':
      return { label: 'Complete', tone: 'complete' };
    case 'draft':
      return { label: 'Draft', tone: 'neutral' };
    case 'next':
      return { label: 'Next', tone: 'neutral' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
  }
}

// ---- Shared helpers ----

const ANSWERABLE_REQUEST_KINDS = new Set(['question', 'choice']);

/** Open `question` and `choice` requests of this mission: the ones an operator answers. */
export function openSummaryQuestions(
  requests: readonly AgentRequestDto[],
  missionId: string
): AgentRequestDto[] {
  return requests.filter(
    request =>
      request.status === 'open' &&
      ANSWERABLE_REQUEST_KINDS.has(request.kind) &&
      (request.missionId === null || request.missionId === missionId)
  );
}

function objectiveLabel(objective: SummaryObjective): string {
  return objective.title?.trim() || objective.displayId;
}

function liveObjectiveMap(objectives: readonly SummaryObjective[]): Map<string, SummaryObjective> {
  return new Map(objectives.map(objective => [objective.id, objective]));
}

function isLater(iso: string, baseline: string | null): boolean {
  if (baseline === null) return false;
  const at = Date.parse(iso);
  const base = Date.parse(baseline);
  if (Number.isNaN(at) || Number.isNaN(base)) return false;
  return at > base;
}

function timeOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
}

/** Text normalisation for cross-objective dedupe: case, whitespace and trailing punctuation. */
export function normaliseSummaryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:]+$/, '')
    .trim();
}

// ---- Running sentence ----

/**
 * One sentence per `executing` or `pending_delivery` objective, in objective
 * order: `{title} is running.`, or `{title} is waiting on a question.` when it
 * has an open question or choice. Appended after the composed summary so the
 * summary stays true between composes.
 */
export function missionSummaryRunningSentences(
  objectives: readonly SummaryObjective[],
  openQuestions: readonly AgentRequestDto[]
): string[] {
  const waiting = new Set(openQuestions.map(request => request.objectiveId).filter(Boolean));
  return objectives
    .filter(objective => objective.state === 'executing' || objective.state === 'pending_delivery')
    .map(objective =>
      waiting.has(objective.id)
        ? `${objectiveLabel(objective)} is waiting on a question.`
        : `${objectiveLabel(objective)} is running.`
    );
}

// ---- Sources line ----

export interface SummarySource {
  deliveryId: string;
  objectiveId: string;
  /** Display id of the live objective; null for a deleted objective (the `Delivery` row). */
  objectiveKey: string | null;
  label: string;
  /** The objective is executing now. */
  live: boolean;
  deliveredAt: string;
}

/** Objective keys of current-run deliveries, newest first, `live` on executing ones. */
export function missionSummarySources(
  evidence: MissionSummaryEvidenceDto,
  objectives: readonly SummaryObjective[]
): SummarySource[] {
  const live = liveObjectiveMap(objectives);
  return [...evidence.sources]
    .sort((a, b) => timeOf(b.deliveredAt) - timeOf(a.deliveredAt))
    .map(source => {
      const objective = live.get(source.objectiveId);
      return {
        deliveryId: source.deliveryId,
        objectiveId: source.objectiveId,
        objectiveKey: objective?.displayId ?? null,
        label: objective?.displayId ?? 'Delivery',
        live: objective?.state === 'executing',
        deliveredAt: source.deliveredAt
      };
    });
}

// ---- Your actions ----

export interface SummaryActionRow {
  /** Stable row key. */
  key: string;
  kind: 'action' | 'question' | 'choice';
  title: string;
  /** Reason of an action, or the quoted request text of a question. */
  detail: string | null;
  blocking: boolean;
  category: HumanActionCategory | null;
  command: string | null;
  verify: string | null;
  link: string | null;
  objectiveId: string | null;
  /** Display id of the live objective; null for a deleted objective or no objective. */
  objectiveKey: string | null;
  /** Delivery or request time that introduced the row. */
  introducedAt: string;
  /** Introduced after the visit baseline. */
  isNew: boolean;
  /** The delivery that reported an action; null for a question. */
  deliveryId: string | null;
}

function questionTitle(kind: string, objective: SummaryObjective | undefined): string {
  if (kind === 'choice') {
    return objective
      ? `Choose an option for ${objectiveLabel(objective)}`
      : 'Choose an option for the agent';
  }
  return objective
    ? `Answer the agent's question on ${objectiveLabel(objective)}`
    : "Answer the agent's question";
}

/**
 * Human actions of the latest current-run delivery per objective (from the
 * envelope) plus open questions and choices. Blocking actions first, then
 * newest first, then report order. Actions are deduped across objectives by
 * normalised text, newest kept. There is no row for reviewing the mission and
 * no done state (§4.6).
 */
export function missionSummaryActions({
  evidence,
  openQuestions,
  objectives,
  baseline
}: {
  evidence: MissionSummaryEvidenceDto;
  openQuestions: readonly AgentRequestDto[];
  objectives: readonly SummaryObjective[];
  baseline: string | null;
}): SummaryActionRow[] {
  const live = liveObjectiveMap(objectives);
  const ranked = evidence.actions.map((action, index) => ({ action, index }));
  // Newest first decides which duplicate survives, independent of blocking order.
  const byRecency = [...ranked].sort(
    (a, b) => timeOf(b.action.deliveredAt) - timeOf(a.action.deliveredAt) || a.index - b.index
  );
  const kept = new Set<number>();
  const seenText = new Set<string>();
  for (const entry of byRecency) {
    const text = normaliseSummaryText(entry.action.action);
    if (seenText.has(text)) continue;
    seenText.add(text);
    kept.add(entry.index);
  }

  const rows: Array<{ row: SummaryActionRow; order: number }> = [];
  for (const { action, index } of ranked) {
    if (!kept.has(index)) continue;
    const objective = live.get(action.objectiveId);
    rows.push({
      order: index,
      row: {
        key: `action:${action.deliveryId}:${action.actionId}`,
        kind: 'action',
        title: action.action,
        detail: action.reason?.trim() || null,
        blocking: action.blocking === true,
        category: action.category,
        command: action.command ?? null,
        verify: action.verify ?? null,
        link: action.link ?? null,
        objectiveId: action.objectiveId,
        objectiveKey: objective?.displayId ?? null,
        introducedAt: action.deliveredAt,
        isNew: isLater(action.deliveredAt, baseline),
        deliveryId: action.deliveryId
      }
    });
  }
  openQuestions.forEach((request, index) => {
    const objective = request.objectiveId ? live.get(request.objectiveId) : undefined;
    rows.push({
      order: evidence.actions.length + index,
      row: {
        key: `request:${request.id}`,
        kind: request.kind === 'choice' ? 'choice' : 'question',
        title: questionTitle(request.kind, objective),
        detail: request.summary.trim() ? `“${request.summary.trim()}”` : null,
        blocking: false,
        category: null,
        command: null,
        verify: null,
        link: null,
        objectiveId: request.objectiveId,
        objectiveKey: objective?.displayId ?? null,
        introducedAt: request.createdAt,
        isNew: isLater(request.createdAt, baseline),
        deliveryId: null
      }
    });
  });

  return rows
    .sort(
      (a, b) =>
        Number(b.row.blocking) - Number(a.row.blocking) ||
        timeOf(b.row.introducedAt) - timeOf(a.row.introducedAt) ||
        a.order - b.order
    )
    .map(entry => entry.row);
}

// ---- Suggested next ----

export type SummarySuggestionRow = {
  deliveryId: string;
  objectiveId: string;
  actionId: string;
  title: string;
  objectiveKey: string | null;
  /** Introduced after the visit baseline; never set on a resolved row. */
  isNew: boolean;
} & (
  | { state: 'open'; change: string; location: string; doneWhen: string; resolution: null }
  | { state: 'resolved'; resolution: HumanActionResolutionDto }
);

/**
 * Suggestions from the summary DTO, unresolved first, otherwise in the
 * server's display order. Resolved rows carry only title and resolution; the
 * server already omits dismissed ones. No model text reaches this block.
 */
export function missionSummarySuggestions({
  summary,
  objectives,
  baseline
}: {
  summary: MissionSummaryDto;
  objectives: readonly SummaryObjective[];
  baseline: string | null;
}): SummarySuggestionRow[] {
  const live = liveObjectiveMap(objectives);
  const rows = summary.suggestions.map((suggestion): SummarySuggestionRow => {
    const objectiveKey = live.get(suggestion.objectiveId)?.displayId ?? null;
    if (suggestion.state === 'resolved') {
      return { ...suggestion, objectiveKey, isNew: false };
    }
    const deliveredAt = suggestion.deliveredAt;
    return {
      ...suggestion,
      objectiveKey,
      isNew: deliveredAt ? isLater(deliveredAt, baseline) : false
    };
  });
  return [
    ...rows.filter(row => row.state === 'open'),
    ...rows.filter(row => row.state === 'resolved')
  ];
}

// ---- Risks ----

export interface SummaryRiskRow {
  key: string;
  deliveryId: string;
  objectiveId: string;
  objectiveKey: string | null;
  text: string;
  isNew: boolean;
}

/** Risks from the summary DTO (composed, or the deterministic list for `fallback`). */
export function missionSummaryRisks({
  summary,
  objectives,
  baseline
}: {
  summary: MissionSummaryDto;
  objectives: readonly SummaryObjective[];
  baseline: string | null;
}): SummaryRiskRow[] {
  const live = liveObjectiveMap(objectives);
  return summary.risks.map((risk, index) => {
    const deliveredAt = risk.deliveredAt;
    return {
      key: `risk:${risk.deliveryId}:${index}`,
      deliveryId: risk.deliveryId,
      objectiveId: risk.objectiveId,
      objectiveKey: live.get(risk.objectiveId)?.displayId ?? null,
      text: risk.text,
      isNew: deliveredAt ? isLater(deliveredAt, baseline) : false
    };
  });
}

// ---- Files changed ----

/** Provenance badge (coo:1199): `N` native capture, `D` agent declared, `?` unknown. */
export type SummaryFileBadge = 'N' | 'D' | '?';

export function fileProvenanceBadge(source: FileChangeSource | null): SummaryFileBadge {
  if (source === 'declared_edit') return 'N';
  if (source === 'agent_declared') return 'D';
  return '?';
}

export function fileProvenanceLabel(badge: SummaryFileBadge): string {
  if (badge === 'N') return 'native capture';
  if (badge === 'D') return 'declared by the agent';
  return 'provenance unknown';
}

export interface SummaryFileChip {
  key: string;
  resourceKey: string | null;
  filePath: string;
  /** Directory with a trailing slash, or empty for a root path. */
  directory: string;
  basename: string;
  badge: SummaryFileBadge;
  observedAt: string;
}

export interface SummaryFiles {
  /** Distinct paths across the mission, newest observation first. */
  chips: SummaryFileChip[];
  total: number;
  /** The mission page was capped, so `total` is a lower bound. */
  truncated: boolean;
  resourceCount: number;
  /** Show the resource key on chips: the mission spans more than one resource. */
  showResourceKey: boolean;
}

/** Collapsed chip count (plan §5.2). */
export const SUMMARY_FILE_CHIP_LIMIT = 6;

function provenanceRank(badge: SummaryFileBadge): number {
  return badge === 'N' ? 2 : badge === 'D' ? 1 : 0;
}

/**
 * Distinct `FileChangeDto` paths across the mission, ordered by `observedAt`
 * descending. One chip per resource plus path; native evidence is kept over a
 * declaration when objectives disagree. No line counts: the DTO has none.
 */
export function missionSummaryFiles(
  fileChanges: readonly FileChangeDto[],
  { truncated = false }: { truncated?: boolean } = {}
): SummaryFiles {
  const byPath = new Map<string, SummaryFileChip>();
  for (const change of fileChanges) {
    const key = `${change.resourceKey ?? ''}\u0000${change.filePath}`;
    const badge = fileProvenanceBadge(change.source);
    const existing = byPath.get(key);
    if (existing) {
      const observedAt =
        timeOf(change.observedAt) > timeOf(existing.observedAt)
          ? change.observedAt
          : existing.observedAt;
      const strongest =
        provenanceRank(badge) > provenanceRank(existing.badge) ? badge : existing.badge;
      byPath.set(key, { ...existing, observedAt, badge: strongest });
      continue;
    }
    const slash = change.filePath.lastIndexOf('/');
    byPath.set(key, {
      key,
      resourceKey: change.resourceKey,
      filePath: change.filePath,
      directory: slash >= 0 ? change.filePath.slice(0, slash + 1) : '',
      basename: slash >= 0 ? change.filePath.slice(slash + 1) : change.filePath,
      badge,
      observedAt: change.observedAt
    });
  }
  const chips = [...byPath.values()].sort(
    (a, b) => timeOf(b.observedAt) - timeOf(a.observedAt) || a.filePath.localeCompare(b.filePath)
  );
  const resourceCount = new Set(
    chips.map(chip => chip.resourceKey).filter((key): key is string => Boolean(key))
  ).size;
  return {
    chips,
    total: chips.length,
    truncated,
    resourceCount,
    showResourceKey: resourceCount > 1
  };
}

// ---- Section state ----

export type MissionSummarySectionState =
  /** Ineligible mission, or the envelope has not loaded: render nothing. */
  | { kind: 'hidden' }
  | { kind: 'error' }
  /** Eligible, no summary row yet. `running` holds any running sentences. */
  | { kind: 'awaiting'; running: string[] }
  /** First pending shell: updating strip, no generated text. */
  | { kind: 'first_pending'; running: string[] }
  /** `pending` with retained content, or a published summary. */
  | { kind: 'summary'; summary: MissionSummaryDto; updating: boolean };

/** Which §5.4 state the section is in. */
export function missionSummarySectionState({
  response,
  isError,
  runningSentences
}: {
  response: MissionSummaryResponse | undefined;
  isError: boolean;
  runningSentences: readonly string[];
}): MissionSummarySectionState {
  if (!response) return isError ? { kind: 'error' } : { kind: 'hidden' };
  if (!response.eligible) return { kind: 'hidden' };
  const summary = response.summary;
  if (!summary) return { kind: 'awaiting', running: [...runningSentences] };
  const hasContent = summary.headline.trim().length > 0 || summary.summary.trim().length > 0;
  if (summary.status === 'pending' && !hasContent) {
    return { kind: 'first_pending', running: [...runningSentences] };
  }
  return { kind: 'summary', summary, updating: summary.status === 'pending' };
}

/** Objective named by the updating strip: the source delivery's objective, when known. */
export function updatingSourceObjective({
  summary,
  evidence,
  deliveries,
  objectives
}: {
  summary: MissionSummaryDto | null;
  evidence: MissionSummaryEvidenceDto;
  deliveries: readonly SummaryDeliveryStamp[];
  objectives: readonly SummaryObjective[];
}): SummaryObjective | null {
  const sourceId = summary?.sourceDeliveryId;
  if (!sourceId) return null;
  const objectiveId =
    evidence.sources.find(source => source.deliveryId === sourceId)?.objectiveId ??
    deliveries.find(delivery => delivery.id === sourceId)?.objectiveId;
  if (!objectiveId) return null;
  return objectives.find(objective => objective.id === objectiveId) ?? null;
}

// ---- Seen watermark ----

/** The later of two ISO times; either may be null. */
export function laterWatermark(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return timeOf(b) > timeOf(a) ? b : a;
}

/** Requests load separately from the envelope. Do not acknowledge a question
 * watermark until that evidence has actually reached the rendered section. */
export function summaryWatermarkIsDisplayed(
  watermark: string | null,
  evidence: MissionSummaryEvidenceDto,
  questions: readonly Pick<AgentRequestDto, 'createdAt'>[]
): boolean {
  if (watermark === null) return false;
  const stamps = [
    ...evidence.sources.map(source => source.deliveredAt),
    ...evidence.actions.map(action => action.deliveredAt),
    ...questions.map(question => question.createdAt)
  ];
  return stamps.some(stamp => Date.parse(stamp) >= Date.parse(watermark));
}

/** Whether displaying `watermark` should be acknowledged over the stored `seenAt`. */
export function watermarkNeedsAck(watermark: string | null, seenAt: string | null): boolean {
  if (watermark === null) return false;
  if (seenAt === null) return true;
  return timeOf(watermark) > timeOf(seenAt);
}
