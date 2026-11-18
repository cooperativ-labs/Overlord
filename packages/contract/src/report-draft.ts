import type { DeferredWorkInputV1, HumanActionInputV1, TradeoffMadeInputV1 } from './index.js';

/**
 * Durable draft delivery evidence (coo:1297 phase 4, contract ADR 0078).
 *
 * An executing agent records provisional report evidence through `update`
 * (`reportDraft`), inspects it with `report-draft`, and seals it with
 * `deliver`. A draft is provisional: it never creates mission items, human
 * obligations, badges or lifecycle meaning. Only the sealed, accepted V1
 * delivery report does.
 */

/** Closed vocabulary of draft entry kinds; one per V1 agent-report array. */
export const REPORT_DRAFT_KINDS = [
  'human_action',
  'tradeoff',
  'known_risk',
  'deferred_work',
  'assumption'
] as const;
export type ReportDraftKind = (typeof REPORT_DRAFT_KINDS)[number];

/** Explicit write bounds; nothing is pruned to stay inside them. */
export const REPORT_DRAFT_LIMITS = {
  /** Active (not withdrawn) entries per kind; the V1 per-array item limit. */
  maxActivePerKind: 12,
  /** Accepted batches retained per draft (their receipts always replay). */
  maxBatches: 1000,
  /** Distinct entry ids per draft, withdrawn ones included. */
  maxEntryIds: 1000,
  /** Operations in one update batch or one final deliver set. */
  maxOperationsPerBatch: 50,
  maxEntryIdLength: 100,
  maxWithdrawReasonLength: 280
} as const;

/** Stable client entry id: 1-100 letters, digits, ".", "_", ":" or "-", starting alphanumeric. */
export const REPORT_DRAFT_ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

/** Content of a `known_risk` or `assumption` entry. */
export interface ReportDraftTextContentV1 {
  text: string;
}

export type ReportDraftContentV1 =
  | HumanActionInputV1
  | TradeoffMadeInputV1
  | DeferredWorkInputV1
  | ReportDraftTextContentV1;

/** Create or replace one entry. The kind of an existing entry never changes. */
export type ReportDraftUpsertOperationV1 =
  | { op: 'upsert'; entryId: string; kind: 'human_action'; content: HumanActionInputV1 }
  | { op: 'upsert'; entryId: string; kind: 'tradeoff'; content: TradeoffMadeInputV1 }
  | { op: 'upsert'; entryId: string; kind: 'deferred_work'; content: DeferredWorkInputV1 }
  | { op: 'upsert'; entryId: string; kind: 'known_risk'; content: ReportDraftTextContentV1 }
  | { op: 'upsert'; entryId: string; kind: 'assumption'; content: ReportDraftTextContentV1 };

/** Withdraw a resolved or mistaken observation; it stays readable as audit data. */
export interface ReportDraftWithdrawOperationV1 {
  op: 'withdraw';
  entryId: string;
  reason: string;
}

/**
 * Copy one active entry of an abandoned draft of the same objective into this
 * draft. `entryId` defaults to the source entry id.
 */
export interface ReportDraftImportOperationV1 {
  op: 'import';
  sourceDraftId: string;
  sourceEntryId: string;
  entryId?: string;
}

export type ReportDraftOperationV1 =
  | ReportDraftUpsertOperationV1
  | ReportDraftWithdrawOperationV1
  | ReportDraftImportOperationV1;

/**
 * `update` input. `operationId` is the caller-retained batch identity: choose
 * it before sending and reuse it for every retry of this batch.
 * `expectedRevision` is the draft revision the batch was prepared against
 * (0 when the session has no draft yet).
 */
export interface ReportDraftUpdateInputV1 {
  operationId: string;
  expectedRevision: number;
  operations: ReportDraftOperationV1[];
}

/** `deliver` input: the revision last inspected plus optional final operations. */
export interface ReportDraftDeliverInputV1 {
  expectedRevision: number;
  operations?: ReportDraftOperationV1[];
}

/**
 * - `open`: the owning session is live and has not delivered.
 * - `sealed`: delivery accepted it; immutable.
 * - `abandoned`: the owning session ended without delivering it.
 */
export type ReportDraftState = 'open' | 'sealed' | 'abandoned';

export interface ReportDraftEntryV1 {
  entryId: string;
  kind: ReportDraftKind;
  content: ReportDraftContentV1;
  position: number;
  state: 'active' | 'withdrawn';
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  importedFrom: { draftId: string; entryId: string } | null;
  /** The accepted V1 item this entry became at seal (`human-action-2`, `knownRisks[0]`, ...). */
  sealedRef: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ReportDraftCountsV1 = Record<ReportDraftKind, number>;

export interface ReportDraftV1 {
  id: string;
  missionId: string;
  objectiveId: string;
  sessionId: string;
  state: ReportDraftState;
  revision: number;
  batchCount: number;
  entryCount: number;
  activeCounts: ReportDraftCountsV1;
  withdrawnCount: number;
  sealedAt: string | null;
  sealedDeliveryId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Active entries in position order. */
  entries: ReportDraftEntryV1[];
  /** Withdrawn entries; present only when requested. */
  withdrawn?: ReportDraftEntryV1[];
}

/** Compact reference to another draft of the same objective. */
export interface ReportDraftRefV1 {
  draftId: string;
  sessionId: string;
  state: ReportDraftState;
  revision: number;
  activeEntryCount: number;
  updatedAt: string;
}

/** Compact attach baseline: this execution's open draft and abandoned drafts to import from. */
export interface ReportDraftAttachBaselineV1 {
  current: {
    draftId: string;
    revision: number;
    activeCounts: ReportDraftCountsV1;
    withdrawnCount: number;
  } | null;
  abandoned: ReportDraftRefV1[];
}
