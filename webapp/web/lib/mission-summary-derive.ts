/**
 * Pure derivations behind the Mission summary section (plan §5.2).
 *
 * Inputs are the queries the mission panel already holds: the mission detail,
 * the summary envelope (`GET /api/missions/:id/summary`), the mission's agent
 * requests, the delivery feed (only to name the objective of the updating
 * strip), the workspace members (to name who closed an item), and the
 * mission-wide file-change page. Actions and sources come from the envelope's
 * evidence, which the server selects before any cap, never from the capped
 * delivery feed.
 *
 * Since contract v173 (ADR 0060) risks, human actions and suggestions are
 * `mission_items` rows. The server returns only open items, already applies
 * supersession and resolution, and lists done and dismissed items in
 * `closedItems`. The client only merges questions, dedupes actions by
 * normalised text, marks new items and names objectives and people.
 *
 * Since contract v175 (ADR 0076) only agents write the headline and summary.
 * The server's `narrative` envelope says whether that prose is absent, current,
 * outdated or legacy; nothing generates it, so no state here waits for prose.
 *
 * The iOS port (`OverlordCore/MissionSummaryDerive.swift`) mirrors these rules
 * and is tested against the same fixture,
 * `contract/mission-summary-derive-fixtures.json`.
 */
import type {
  DeliveryDto,
  FileChangeDto,
  FileChangeSource,
  HumanActionCategory,
  HumanAgentRequestDto,
  MissionItemResolverDto,
  MissionNarrativeDto,
  MissionSummaryClosedItemDto,
  MissionSummaryDto,
  MissionSummaryDuplicateDto,
  MissionSummaryEvidenceDto,
  MissionSummaryResponse,
  ObjectiveState,
  StatusType
} from '@overlord/contract';

/** The objective fields the derivations read. Only live (non-deleted) objectives are passed. */
export interface SummaryObjective {
  id: string;
  displayId: string;
  title: string | null;
  state: ObjectiveState;
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
  requests: readonly HumanAgentRequestDto[],
  missionId: string
): HumanAgentRequestDto[] {
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
  openQuestions: readonly HumanAgentRequestDto[]
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

// ---- Live status ----

export type MissionLiveStatusKind =
  | 'blocked'
  | 'waiting'
  | 'in_progress'
  | 'launching'
  | 'complete'
  | 'idle';

/**
 * The mission's volatile status, derived from live state and never from the agent-written
 * summary prose: that prose is written at delivery and is protected between deliveries
 * (contract: narrative publication guard), so it cannot follow a blocker that a person closes.
 */
export interface MissionLiveStatus {
  kind: MissionLiveStatusKind;
  /** Short label, always shown as text: `Blocked`, `Waiting on you`, `In progress`… */
  label: string;
  /** The reason in one sentence, or null when the label says it all. */
  detail: string | null;
  /** Open blocking human actions, after grouping equal ones. */
  blockingActions: number;
  /** Open questions and choices. */
  openQuestions: number;
  /** Objectives running now. */
  running: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Status from the mission's state type, its objectives, its open questions and choices, and its
 * open items. Most urgent first: a blocking human action (blocked), an open question (waiting on
 * a person), a running objective (in progress), a launching objective, then a completed mission.
 * Closing the last blocking action or answering the last question changes the status on the next
 * refresh without any delivery.
 */
export function missionLiveStatus({
  statusType,
  objectives,
  openQuestions,
  actionRows
}: {
  statusType: StatusType;
  objectives: readonly Pick<SummaryObjective, 'state'>[];
  openQuestions: readonly unknown[];
  actionRows: readonly Pick<SummaryActionRow, 'kind' | 'blocking'>[];
}): MissionLiveStatus {
  const blockingActions = actionRows.filter(row => row.kind === 'action' && row.blocking).length;
  const questions = openQuestions.length;
  const running = objectives.filter(
    objective => objective.state === 'executing' || objective.state === 'pending_delivery'
  ).length;
  const status = (
    kind: MissionLiveStatusKind,
    label: string,
    detail: string | null
  ): MissionLiveStatus => ({
    kind,
    label,
    detail,
    blockingActions,
    openQuestions: questions,
    running
  });

  if (blockingActions > 0) {
    return status(
      'blocked',
      'Blocked',
      `${plural(blockingActions, 'blocking action needs', 'blocking actions need')} you.`
    );
  }
  if (questions > 0) {
    return status(
      'waiting',
      'Waiting on you',
      `${plural(questions, 'open question needs', 'open questions need')} an answer.`
    );
  }
  if (running > 0) {
    return status(
      'in_progress',
      'In progress',
      `${plural(running, 'objective is', 'objectives are')} running.`
    );
  }
  if (objectives.some(objective => objective.state === 'launching')) {
    return status('launching', 'Launching', null);
  }
  if (statusType === 'complete') return status('complete', 'Complete', null);
  return status('idle', 'No work running', null);
}

// ---- Grouped items ----

/** One objective an open item came from. `objectiveKey` is null once the objective is deleted. */
export interface SummaryGroupSource {
  objectiveId: string;
  objectiveKey: string | null;
}

/**
 * What a row stands for when several stored records say the same thing. Every record keeps its
 * own stored identity; closing the row closes each id in `itemIds`, and says so.
 */
export interface SummaryItemGroup {
  /** Every stored record the row stands for, the displayed (newest) one first. */
  itemIds: string[];
  /** Number of stored records: 1 means the row is one record. */
  count: number;
  /** Distinct source objectives, in the order the records are listed. */
  sources: SummaryGroupSource[];
}

function groupOf(
  head: { id: string; objectiveId: string },
  others: readonly Pick<MissionSummaryDuplicateDto, 'id' | 'objectiveId'>[],
  live: Map<string, SummaryObjective>
): SummaryItemGroup {
  const records = [head, ...others];
  const seen = new Set<string>();
  const sources: SummaryGroupSource[] = [];
  for (const record of records) {
    if (seen.has(record.objectiveId)) continue;
    seen.add(record.objectiveId);
    sources.push({
      objectiveId: record.objectiveId,
      objectiveKey: live.get(record.objectiveId)?.displayId ?? null
    });
  }
  return { itemIds: records.map(record => record.id), count: records.length, sources };
}

/** Plain-text note on what resolving a grouped row does; null for a single record. */
export function summaryGroupResolveNote(group: Pick<SummaryItemGroup, 'count'>): string | null {
  return group.count > 1
    ? `Resolving closes all ${group.count} matching records, one per objective report.`
    : null;
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
  /** The member dismissed this question or choice's notification. */
  dismissed: boolean;
  /** The delivery that reported an action; null for a question. */
  deliveryId: string | null;
  /** The `mission_items` id a person closes; null for a question or choice. */
  itemId: string | null;
  /** The stored records the row stands for; one record for a question or choice. */
  group: SummaryItemGroup;
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
 * Open human actions (from the envelope) plus open questions and choices.
 * Blocking actions first, then newest first, then report order. Actions with
 * the same normalised text across objectives are grouped into one row, the
 * newest record shown; the row lists every record, is blocking if any is, and
 * resolving it closes them all. There is no row for reviewing the mission; a
 * closed action moves to `closedItems`.
 */
export function missionSummaryActions({
  evidence,
  openQuestions,
  objectives,
  baseline
}: {
  evidence: MissionSummaryEvidenceDto;
  openQuestions: readonly HumanAgentRequestDto[];
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
  const groupedByText = new Map<string, number>();
  const duplicatesOf = new Map<number, MissionSummaryDuplicateDto[]>();
  const anyBlocking = new Set<number>();
  for (const entry of byRecency) {
    const text = normaliseSummaryText(entry.action.action);
    const head = groupedByText.get(text);
    if (head === undefined) {
      groupedByText.set(text, entry.index);
      kept.add(entry.index);
      duplicatesOf.set(entry.index, []);
      if (entry.action.blocking === true) anyBlocking.add(entry.index);
      continue;
    }
    duplicatesOf.get(head)?.push({
      id: entry.action.id,
      deliveryId: entry.action.deliveryId,
      objectiveId: entry.action.objectiveId,
      deliveredAt: entry.action.deliveredAt
    });
    if (entry.action.blocking === true) anyBlocking.add(head);
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
        blocking: anyBlocking.has(index),
        category: action.category,
        command: action.command ?? null,
        verify: action.verify ?? null,
        link: action.link ?? null,
        objectiveId: action.objectiveId,
        objectiveKey: objective?.displayId ?? null,
        introducedAt: action.deliveredAt,
        isNew: isLater(action.deliveredAt, baseline),
        dismissed: false,
        deliveryId: action.deliveryId,
        itemId: action.id,
        group: groupOf(action, duplicatesOf.get(index) ?? [], live)
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
        isNew: !request.dismissed && isLater(request.createdAt, baseline),
        dismissed: request.dismissed === true,
        deliveryId: null,
        itemId: null,
        group: { itemIds: [], count: 1, sources: [] }
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

export interface SummarySuggestionRow {
  /** The `mission_items` id. */
  id: string;
  deliveryId: string;
  objectiveId: string;
  actionId: string;
  title: string;
  change: string;
  location: string;
  doneWhen: string;
  objectiveKey: string | null;
  /** Introduced after the visit baseline. */
  isNew: boolean;
  /** The stored records the row stands for; the server groups only equal title and scope. */
  group: SummaryItemGroup;
}

/**
 * Open suggestions from the summary DTO, in the server's display order. A
 * closed suggestion is in `closedItems`. No model text reaches this block.
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
  return summary.suggestions.map(suggestion => ({
    id: suggestion.id,
    deliveryId: suggestion.deliveryId,
    objectiveId: suggestion.objectiveId,
    actionId: suggestion.actionId,
    title: suggestion.title,
    change: suggestion.change,
    location: suggestion.location,
    doneWhen: suggestion.doneWhen,
    objectiveKey: live.get(suggestion.objectiveId)?.displayId ?? null,
    isNew: isLater(suggestion.deliveredAt, baseline),
    group: groupOf(suggestion, suggestion.duplicates ?? [], live)
  }));
}

// ---- Risks ----

export interface SummaryRiskRow {
  key: string;
  /** The `mission_items` id a person closes. */
  itemId: string;
  deliveryId: string;
  objectiveId: string;
  objectiveKey: string | null;
  text: string;
  isNew: boolean;
  /** The stored records the row stands for: equal risks reported by several objectives. */
  group: SummaryItemGroup;
}

/** Open risks from the summary DTO: the deterministic open list, grouped by the server. */
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
  return summary.risks.map(risk => ({
    key: `risk:${risk.id}`,
    itemId: risk.id,
    deliveryId: risk.deliveryId,
    objectiveId: risk.objectiveId,
    objectiveKey: live.get(risk.objectiveId)?.displayId ?? null,
    text: risk.text,
    isNew: isLater(risk.deliveredAt, baseline),
    group: groupOf(risk, risk.duplicates ?? [], live)
  }));
}

// ---- Tradeoffs ----

export interface SummaryTradeoffRow {
  key: string;
  deliveryId: string;
  objectiveId: string;
  objectiveKey: string | null;
  decision: string;
  rationale: string;
  alternativesConsidered: string[];
  impact: string | null;
}

/**
 * Tradeoffs the agents reported across the mission's deliveries, newest delivery first.
 * Reporting tradeoffs is optional, so most deliveries contribute none.
 */
export function missionSummaryTradeoffs({
  deliveries,
  objectives
}: {
  deliveries: readonly Pick<DeliveryDto, 'id' | 'objectiveId' | 'report'>[];
  objectives: readonly SummaryObjective[];
}): SummaryTradeoffRow[] {
  const live = liveObjectiveMap(objectives);
  return deliveries.flatMap(delivery =>
    // Older or partial delivery records may carry no report; treat them as no tradeoffs.
    ((delivery.report as DeliveryDto['report'] | undefined)?.presentation.tradeoffsMade ?? [])
      .filter(tradeoff => tradeoff.decision.trim() !== '')
      .map(tradeoff => ({
        key: `tradeoff:${delivery.id}:${tradeoff.id}`,
        deliveryId: delivery.id,
        objectiveId: delivery.objectiveId,
        objectiveKey: live.get(delivery.objectiveId)?.displayId ?? null,
        decision: tradeoff.decision.trim(),
        rationale: tradeoff.rationale.trim(),
        alternativesConsidered: tradeoff.alternativesConsidered.filter(a => a.trim() !== ''),
        impact: tradeoff.impact?.trim() || null
      }))
  );
}

// ---- Provenance and resolved items (contract v173) ----

/** A workspace member, as far as naming a person needs. `isOperator` marks the viewer. */
export interface SummaryMember {
  workspaceUserId: string;
  displayName: string;
  handle: string | null;
  email: string | null;
  isOperator: boolean;
}

/** Who wrote the headline and summary: the recorded author, never inferred from freshness. */
export type SummaryProvenance =
  /** An agent wrote it. `objectiveKey` is null once that objective is deleted or unknown. */
  | { kind: 'agent'; objectiveKey: string | null }
  /** The retired automatic composer (model or deterministic) wrote it. */
  | { kind: 'automatic' };

/** The recorded author of the summary row's prose. */
export function missionSummaryProvenance(
  summary: MissionSummaryDto,
  objectives: readonly SummaryObjective[]
): SummaryProvenance {
  if (summary.author.kind !== 'agent') return { kind: 'automatic' };
  const objectiveId = summary.author.objectiveId;
  const objective = objectiveId ? liveObjectiveMap(objectives).get(objectiveId) : undefined;
  return { kind: 'agent', objectiveKey: objective?.displayId ?? null };
}

// ---- Narrative freshness (contract v175, ADR 0076) ----

/**
 * The server's `narrative.state`, or `unknown` when an older server sent no envelope: then no
 * freshness is claimed either way.
 */
export type SummaryNarrativeFreshness = MissionNarrativeDto['state'] | 'unknown';

/** Shown with existing prose when a later delivery, follow-up or reopen changed the basis. */
export const NARRATIVE_OUTDATED_NOTICE = 'Summary not updated for the latest delivery';
/** Shown when accepted work exists but no prose does. */
export const NARRATIVE_ABSENT_NOTICE = 'Summary not yet provided';
/** Label of retained prose that predates recorded coverage. */
export const NARRATIVE_LEGACY_LABEL = 'Earlier summary';

/** The newest accepted work, for the link beside a missing or outdated summary. */
export interface SummaryLatestWork {
  deliveryId: string;
  objectiveId: string;
  /** Display id of the live objective; null once it is deleted. */
  objectiveKey: string | null;
  deliveredAt: string;
}

export interface SummaryNarrativeView {
  freshness: SummaryNarrativeFreshness;
  /** Trimmed prose; empty strings when there is none. */
  headline: string;
  summary: string;
  hasProse: boolean;
  /** The recorded author of the prose; null without prose. */
  provenance: SummaryProvenance | null;
  /** `Summary not updated…` or `Summary not yet provided`; null when neither applies. */
  notice: string | null;
  /** Retained prose without recorded coverage: labelled `Earlier summary`. */
  legacy: boolean;
  /**
   * When the prose was written: the publication time for prose published through the delivery
   * boundary, otherwise the row's historical `generatedAt`. Null without prose.
   */
  writtenAt: string | null;
  /** The accepted work the notice links to; null when there is no live accepted delivery. */
  latestWork: SummaryLatestWork | null;
}

/** The narrative envelope of an eligible response, or null from an older server. */
export function responseNarrative(
  response: MissionSummaryResponse | undefined
): MissionNarrativeDto | null {
  if (!response?.eligible) return null;
  // Older servers omit the field entirely; never invent an envelope for them.
  return (response as { narrative?: MissionNarrativeDto | null }).narrative ?? null;
}

/** The response's `narrativeWatermark`, or null from an older server. */
export function responseNarrativeWatermark(
  response: MissionSummaryResponse | undefined
): string | null {
  if (!response?.eligible) return null;
  return (response as { narrativeWatermark?: string | null }).narrativeWatermark ?? null;
}

function latestAcceptedWork(
  evidence: MissionSummaryEvidenceDto,
  narrative: MissionNarrativeDto | null,
  live: Map<string, SummaryObjective>
): SummaryLatestWork | null {
  const sources = [...evidence.sources].sort(
    (a, b) => timeOf(b.deliveredAt) - timeOf(a.deliveredAt)
  );
  // The delivery whose publication opportunity is still open is the newest accepted work.
  const outstanding = narrative?.outstandingDeliveryId
    ? sources.find(source => source.deliveryId === narrative.outstandingDeliveryId)
    : undefined;
  const source = outstanding ?? sources[0];
  if (!source) return null;
  return {
    deliveryId: source.deliveryId,
    objectiveId: source.objectiveId,
    objectiveKey: live.get(source.objectiveId)?.displayId ?? null,
    deliveredAt: source.deliveredAt
  };
}

/**
 * What the summary header shows (plan §5.4). Prose keeps its recorded author; `legacy` prose is
 * labelled as earlier text and never called agent-authored on the strength of the envelope;
 * `outdated` prose says a later delivery is not covered; with accepted work and no prose the
 * header says so instead of waiting. Live status, questions and items never depend on this.
 */
export function missionNarrativeView({
  response,
  objectives
}: {
  response: MissionSummaryResponse | undefined;
  objectives: readonly SummaryObjective[];
}): SummaryNarrativeView | null {
  if (!response?.eligible) return null;
  const live = liveObjectiveMap(objectives);
  const narrative = responseNarrative(response);
  const summary = response.summary;
  const headline = summary?.headline.trim() ?? '';
  const body = summary?.summary.trim() ?? '';
  const hasProse = headline.length > 0 || body.length > 0;
  const freshness: SummaryNarrativeFreshness = narrative?.state ?? 'unknown';
  const latestWork = latestAcceptedWork(response.evidence, narrative, live);
  const acceptedWork =
    latestWork !== null ||
    (narrative?.evidenceRevision ?? 0) > 0 ||
    responseNarrativeWatermark(response) !== null;

  let provenance: SummaryProvenance | null = null;
  if (hasProse && summary) {
    if (freshness === 'current' || freshness === 'outdated') {
      // Published through the delivery boundary: always agent prose, named by its delivery.
      const objectiveId = narrative?.objectiveId ?? summary.author.objectiveId;
      provenance = {
        kind: 'agent',
        objectiveKey: (objectiveId ? live.get(objectiveId)?.displayId : undefined) ?? null
      };
    } else {
      provenance = missionSummaryProvenance(summary, objectives);
    }
  }
  const legacy = hasProse && freshness === 'legacy';
  let notice: string | null = null;
  if (hasProse && freshness === 'outdated') notice = NARRATIVE_OUTDATED_NOTICE;
  else if (!hasProse && acceptedWork) notice = NARRATIVE_ABSENT_NOTICE;
  const writtenAt = hasProse
    ? ((freshness === 'current' || freshness === 'outdated' ? narrative?.publishedAt : null) ??
      summary?.generatedAt ??
      null)
    : null;
  return {
    freshness,
    headline,
    summary: hasProse ? (summary?.summary ?? '') : '',
    hasProse,
    provenance,
    notice,
    legacy,
    writtenAt,
    latestWork: notice !== null || legacy ? latestWork : null
  };
}

/** Who closed an item, ready to name. */
export type SummaryResolver =
  /** `name` is `you` for the viewer, the member's name, or `a person` when unknown. */
  | { kind: 'person'; name: string }
  /** `objectiveKey` is null once the closing objective is deleted. */
  | {
      kind: 'agent';
      objectiveKey: string | null;
      missionKey?: string | null;
      crossMission?: boolean;
      notDelivered?: boolean;
    };

function memberName(member: SummaryMember): string {
  if (member.isOperator) return 'you';
  return member.displayName.trim() || member.handle || member.email || 'a person';
}

export function missionItemResolver(
  resolvedBy: MissionItemResolverDto | null | undefined,
  {
    objectives,
    members
  }: { objectives: readonly SummaryObjective[]; members: readonly SummaryMember[] }
): SummaryResolver | null {
  if (!resolvedBy) return null;
  if (resolvedBy.kind === 'agent') {
    const objective = resolvedBy.objectiveId
      ? liveObjectiveMap(objectives).get(resolvedBy.objectiveId)
      : undefined;
    return {
      kind: 'agent',
      objectiveKey: resolvedBy.objectiveDisplayId ?? objective?.displayId ?? null,
      ...(resolvedBy.crossMission
        ? {
            missionKey: resolvedBy.missionDisplayId ?? null,
            crossMission: true,
            notDelivered: resolvedBy.deliveryId === null
          }
        : {})
    };
  }
  const member = resolvedBy.workspaceUserId
    ? members.find(candidate => candidate.workspaceUserId === resolvedBy.workspaceUserId)
    : undefined;
  return { kind: 'person', name: member ? memberName(member) : 'a person' };
}

/** Plain-text name of a resolver: `you`, a person's name, an objective key, or `an agent`. */
export function missionItemResolverText(resolver: SummaryResolver): string {
  if (resolver.kind === 'person') return resolver.name;
  return resolver.objectiveKey ?? 'an agent';
}

/** What a close did: `Done`, `Dismissed`, or the suggestion's promotion. */
export function missionItemOutcomeLabel({
  status,
  outcome,
  outcomeRef
}: {
  status: 'done' | 'dismissed';
  outcome: 'mission_created' | 'objective_added' | null;
  outcomeRef: string | null;
}): string {
  if (status === 'dismissed') return 'Dismissed';
  const ref = outcomeRef ? ` ${outcomeRef}` : '';
  if (outcome === 'mission_created') return `Mission${ref} created`;
  if (outcome === 'objective_added') return `Objective${ref} added`;
  return 'Done';
}

const ITEM_KIND_LABEL: Record<MissionSummaryClosedItemDto['kind'], string> = {
  risk: 'Risk',
  human_action: 'Action',
  suggestion: 'Suggestion'
};

export interface SummaryClosedItemRow {
  id: string;
  kind: MissionSummaryClosedItemDto['kind'];
  /** `Risk`, `Action` or `Suggestion`: the kind as text, never colour alone. */
  kindLabel: string;
  text: string;
  status: 'done' | 'dismissed';
  /** `Done`, `Dismissed`, or the promotion (`Objective coo:1.abcd added`). */
  outcomeLabel: string;
  reason: string | null;
  resolver: SummaryResolver | null;
  resolvedAt: string | null;
  /** The objective that reported the item; null once deleted. */
  objectiveKey: string | null;
}

/** Done and dismissed items in the server's order (newest close first). */
export function missionSummaryClosedItems({
  summary,
  objectives,
  members
}: {
  summary: MissionSummaryDto;
  objectives: readonly SummaryObjective[];
  members: readonly SummaryMember[];
}): SummaryClosedItemRow[] {
  const live = liveObjectiveMap(objectives);
  return summary.closedItems.map(item => ({
    id: item.id,
    kind: item.kind,
    kindLabel: ITEM_KIND_LABEL[item.kind] ?? 'Item',
    text: item.text,
    status: item.status,
    outcomeLabel: missionItemOutcomeLabel(item),
    reason: item.reason?.trim() || null,
    resolver: missionItemResolver(item.resolvedBy, { objectives, members }),
    resolvedAt: item.resolvedAt,
    objectiveKey: live.get(item.objectiveId)?.displayId ?? null
  }));
}

/** Current cross-mission rows, including all provenance and linkage, form one coverage group. */
export function summaryItemsSignature(
  summary: MissionSummaryDto | null,
  watermark: string | null = null
): string | null {
  const rows = summary?.closedItems.filter(item => item.resolvedBy?.crossMission) ?? [];
  if (watermark !== null && !rows.some(row => row.resolvedAt === watermark)) return null;
  return rows.length ? JSON.stringify(rows) : null;
}

export function responseItemsWatermark(
  response: MissionSummaryResponse | undefined
): string | null {
  return response?.eligible ? (response.itemsWatermark ?? null) : null;
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
  /** Eligible, with neither prose nor accepted work yet. `running` holds any running sentences. */
  | { kind: 'awaiting'; running: string[] }
  /**
   * The header has something true to show: prose (current, outdated, legacy or from an older
   * server) or a notice that accepted work has no summary. Never a waiting or updating state:
   * no automatic writer exists (ADR 0076).
   */
  | { kind: 'summary'; summary: MissionSummaryDto | null; narrative: SummaryNarrativeView };

/** Which §5.4 state the section is in. */
export function missionSummarySectionState({
  response,
  isError,
  runningSentences,
  objectives = []
}: {
  response: MissionSummaryResponse | undefined;
  isError: boolean;
  runningSentences: readonly string[];
  objectives?: readonly SummaryObjective[];
}): MissionSummarySectionState {
  if (!response) return isError ? { kind: 'error' } : { kind: 'hidden' };
  if (!response.eligible) return { kind: 'hidden' };
  const narrative = missionNarrativeView({ response, objectives });
  if (!narrative || (!narrative.hasProse && narrative.notice === null)) {
    return { kind: 'awaiting', running: [...runningSentences] };
  }
  return { kind: 'summary', summary: response.summary, narrative };
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
  questions: readonly Pick<HumanAgentRequestDto, 'createdAt'>[]
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

// ---- Displayed-evidence coverage (mission-panel-redesign plan §6.1, ADR 0076) ----

/**
 * The evidence groups of one response whose content carries new-since-last-visit markers.
 * `narrative` is the summary header: prose, its freshness notice, or the missing-summary notice.
 * `items` is reserved for cross-mission item decisions (coo:1278) once the panel renders them.
 */
export type SummaryEvidenceGroup = 'for_you' | 'risks' | 'suggested' | 'narrative' | 'items';

/** Group → signature of the content it shows now. Absent groups have nothing to show. */
export type SummaryCoverageRequirements = Partial<Record<SummaryEvidenceGroup, string>>;

/** A stable signature of a group's rows: changed or added evidence changes it. */
export function summaryEvidenceSignature(parts: readonly string[]): string {
  return [...parts].sort().join('\u0000');
}

/**
 * Signature of the summary header. Freshness, the basis and content revisions and the change time
 * are all part of it, so a basis invalidation or a new publication invalidates earlier coverage
 * even when two changes share a millisecond.
 */
export function summaryNarrativeSignature(
  response: MissionSummaryResponse | undefined,
  view: SummaryNarrativeView | null
): string | null {
  if (!response?.eligible || !view || (!view.hasProse && view.notice === null)) return null;
  const narrative = responseNarrative(response);
  return [
    `state=${view.freshness}`,
    `notice=${view.notice ?? ''}`,
    `content=${response.summary?.contentRevision ?? ''}`,
    `evidence=${narrative?.evidenceRevision ?? ''}`,
    `published=${narrative?.publishedEvidenceRevision ?? ''}`,
    `changed=${narrative?.changedAt ?? response.summary?.generatedAt ?? ''}`
  ].join('|');
}

/**
 * What the current snapshot requires to have been displayed before its watermark may be
 * acknowledged. A nonempty group must be covered with exactly this signature, so new or changed
 * evidence invalidates earlier coverage. Groups without content require nothing.
 */
export function summaryCoverageRequirements({
  actionRows,
  riskRows,
  suggestionRows,
  narrativeSignature = null,
  itemsSignature = null
}: {
  actionRows: readonly Pick<SummaryActionRow, 'key' | 'introducedAt'>[];
  riskRows: readonly Pick<SummaryRiskRow, 'key'>[];
  suggestionRows: readonly Pick<SummarySuggestionRow, 'id'>[];
  /** `summaryNarrativeSignature` of the response; null when the header shows nothing. */
  narrativeSignature?: string | null;
  /** Signature of rendered cross-mission item decisions (coo:1278); null when not rendered. */
  itemsSignature?: string | null;
}): SummaryCoverageRequirements {
  const required: SummaryCoverageRequirements = {};
  if (actionRows.length > 0) {
    required.for_you = summaryEvidenceSignature(
      actionRows.map(row => `${row.key}@${row.introducedAt}`)
    );
  }
  if (riskRows.length > 0) required.risks = summaryEvidenceSignature(riskRows.map(row => row.key));
  if (suggestionRows.length > 0) {
    required.suggested = summaryEvidenceSignature(suggestionRows.map(row => row.id));
  }
  if (narrativeSignature !== null) required.narrative = narrativeSignature;
  if (itemsSignature !== null) required.items = itemsSignature;
  return required;
}

/** Every required group was covered with its current signature. */
export function summaryCoverageComplete(
  required: SummaryCoverageRequirements,
  covered: Readonly<Record<string, string>>
): boolean {
  return (Object.entries(required) as Array<[SummaryEvidenceGroup, string]>).every(
    ([group, signature]) => covered[group] === signature
  );
}

/**
 * The one scalar a fully displayed snapshot acknowledges (ADR 0076, review R2): the latest of the
 * delivery/question `watermark`, the `narrativeWatermark`, and the coo:1278 `itemsWatermark` when
 * its group is rendered. Null when the snapshot has no evidence time.
 */
export function summaryAcknowledgementTarget({
  watermark,
  narrativeWatermark,
  itemsWatermark = null
}: {
  watermark: string | null;
  narrativeWatermark: string | null;
  itemsWatermark?: string | null;
}): string | null {
  return laterWatermark(laterWatermark(watermark, narrativeWatermark), itemsWatermark);
}

/**
 * Whether every watermark that feeds the target is backed by evidence in the displayed snapshot:
 * the delivery/question watermark by a rendered source, action or question at least as new, the
 * narrative watermark by a required narrative group, and the items watermark by a required items
 * group. A newer time that nothing on screen stands for is never acknowledged.
 */
export function summaryAcknowledgementBacked({
  watermark,
  narrativeWatermark,
  itemsWatermark = null,
  evidence,
  questions,
  required
}: {
  watermark: string | null;
  narrativeWatermark: string | null;
  itemsWatermark?: string | null;
  evidence: MissionSummaryEvidenceDto;
  questions: readonly Pick<HumanAgentRequestDto, 'createdAt'>[];
  required: SummaryCoverageRequirements;
}): boolean {
  if (watermark === null && narrativeWatermark === null && itemsWatermark === null) return false;
  if (watermark !== null && !summaryWatermarkIsDisplayed(watermark, evidence, questions)) {
    return false;
  }
  if (narrativeWatermark !== null && required.narrative === undefined) return false;
  if (itemsWatermark !== null && required.items === undefined) return false;
  return true;
}

/**
 * The acknowledgement decision for one response: its combined target, sent only when the snapshot
 * is rendered and loaded, every required group was covered with its current signature, the target
 * is backed by displayed evidence, and it is newer than the stored `seenAt`. Hidden groups keep
 * the whole snapshot unacknowledged, in both directions: a newer visible narrative never clears
 * older hidden risks or actions, and newer visible items never clear an older hidden narrative.
 */
export function summaryAcknowledgement({
  watermark,
  narrativeWatermark,
  itemsWatermark = null,
  seenAt,
  evidence,
  questions,
  required,
  covered,
  loaded
}: {
  watermark: string | null;
  narrativeWatermark: string | null;
  itemsWatermark?: string | null;
  seenAt: string | null;
  evidence: MissionSummaryEvidenceDto;
  questions: readonly Pick<HumanAgentRequestDto, 'createdAt'>[];
  required: SummaryCoverageRequirements;
  covered: Readonly<Record<string, string>>;
  /** The response and the open-request collection loaded completely, without error. */
  loaded: boolean;
}): { target: string | null; due: boolean } {
  const target = summaryAcknowledgementTarget({ watermark, narrativeWatermark, itemsWatermark });
  const due =
    loaded &&
    target !== null &&
    summaryAcknowledgementBacked({
      watermark,
      narrativeWatermark,
      itemsWatermark,
      evidence,
      questions,
      required
    }) &&
    summaryCoverageComplete(required, covered) &&
    watermarkNeedsAck(target, seenAt);
  return { target, due };
}

/** The summary header carries evidence newer than the visit baseline. */
export function summaryNarrativeIsNew(
  narrativeWatermark: string | null,
  baseline: string | null
): boolean {
  return narrativeWatermark !== null && isLater(narrativeWatermark, baseline);
}
