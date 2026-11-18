import {
  type DeliveryAgentReportInputV1,
  type DeliveryAgentReportV1,
  type DeliveryReportPayloadV1,
  REPORT_DRAFT_ENTRY_ID_PATTERN,
  REPORT_DRAFT_KINDS,
  REPORT_DRAFT_LIMITS,
  type ReportDraftAttachBaselineV1,
  type ReportDraftContentV1,
  type ReportDraftCountsV1,
  type ReportDraftEntryV1,
  type ReportDraftKind,
  type ReportDraftRefV1,
  type ReportDraftState,
  type ReportDraftV1
} from '@overlord/contract';
import { conciseTextSchema } from '@overlord/contract/delivery-report';
import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { recordChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { resolveMissionId } from './context.js';
import {
  applyDeferredWorkEligibility,
  deriveDeterministicActionCandidates
} from './delivery-compose.js';
import { canonicalJson, parseOperationId } from './delivery-finalization.js';
import {
  buildDeliveryReport,
  deferredWorkId,
  deferredWorkInputSchema,
  humanActionSchema,
  isDisplayableHumanAction,
  tradeoffSchema
} from './delivery-report.js';
import { ServiceError } from './errors.js';
import { listObjectives } from './missions.js';
import { hashSessionKey, newId } from './util.js';

/**
 * Durable draft delivery evidence (coo:1297 phase 4, contract ADR 0078).
 *
 * One draft per live protocol session. `update` applies a batch of stable-id
 * upsert/withdraw/import operations under the mission lock; every accepted
 * batch writes an immutable receipt (caller operation id, canonical digest,
 * result revision, attributable event id) atomically with its entry changes
 * and its update event. A retry of the same batch replays that receipt before
 * the revision check, so a lost response never overwrites later edits or
 * duplicates an event. `deliver` applies optional final operations, merges the
 * active entries with any legacy report arrays, and seals the draft in the
 * finalization transaction.
 *
 * Drafts never create mission_items, obligations or lifecycle meaning; only
 * the sealed, accepted V1 report does.
 */

export const REPORT_DRAFT_CONFLICT = 'report_draft_conflict';
export const REPORT_DRAFT_OPERATION_CONFLICT = 'report_draft_operation_conflict';
export const REPORT_DRAFT_SEALED = 'report_draft_sealed';
export const REPORT_DRAFT_LIMIT_EXCEEDED = 'report_draft_limit_exceeded';
export const REPORT_DRAFT_NOT_FOUND = 'report_draft_not_found';
export const REPORT_DRAFT_FORBIDDEN = 'report_draft_forbidden';

const DIGEST_VERSION = 'v1';

// ---- Input parsing ----------------------------------------------------------

const textContentSchema = z.strictObject({ text: conciseTextSchema });

const CONTENT_SCHEMAS: Record<ReportDraftKind, z.ZodType<Record<string, unknown>>> = {
  human_action: humanActionSchema as z.ZodType<Record<string, unknown>>,
  tradeoff: tradeoffSchema as z.ZodType<Record<string, unknown>>,
  deferred_work: deferredWorkInputSchema as z.ZodType<Record<string, unknown>>,
  known_risk: textContentSchema,
  assumption: textContentSchema
};

export type ParsedDraftOperation =
  | { op: 'upsert'; entryId: string; kind: ReportDraftKind; content: Record<string, unknown> }
  | { op: 'withdraw'; entryId: string; reason: string }
  | { op: 'import'; entryId: string; sourceDraftId: string; sourceEntryId: string };

export type ParsedReportDraftWrite = {
  /** Batch identity (update only). */
  operationId?: string;
  expectedRevision: number;
  operations: ParsedDraftOperation[];
};

function invalid(message: string): ServiceError {
  return new ServiceError(message, 'invalid_input', 400);
}

function parseEntryId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REPORT_DRAFT_ENTRY_ID_PATTERN.test(value)) {
    throw invalid(
      `${field} must be 1-${REPORT_DRAFT_LIMITS.maxEntryIdLength} letters, digits, ".", "_", ":" or "-", starting with a letter or digit`
    );
  }
  return value;
}

function parseOperation(value: unknown, index: number): ParsedDraftOperation {
  const field = `reportDraft.operations[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be an object`);
  }
  const op = value as Record<string, unknown>;
  const allowed = (keys: string[]) => {
    const extra = Object.keys(op).filter(key => !keys.includes(key));
    if (extra.length > 0) throw invalid(`${field} has unsupported fields: ${extra.join(', ')}`);
  };
  switch (op.op) {
    case 'upsert': {
      allowed(['op', 'entryId', 'kind', 'content']);
      const entryId = parseEntryId(op.entryId, `${field}.entryId`);
      if (
        typeof op.kind !== 'string' ||
        !(REPORT_DRAFT_KINDS as readonly string[]).includes(op.kind)
      ) {
        throw invalid(`${field}.kind must be one of: ${REPORT_DRAFT_KINDS.join(', ')}`);
      }
      const kind = op.kind as ReportDraftKind;
      const parsed = CONTENT_SCHEMAS[kind].safeParse(op.content);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.length ? `.${issue.path.join('.')}` : '';
        throw invalid(`${field}.content${path}: ${issue?.message ?? `invalid ${kind} content`}`);
      }
      return { op: 'upsert', entryId, kind, content: parsed.data };
    }
    case 'withdraw': {
      allowed(['op', 'entryId', 'reason']);
      const entryId = parseEntryId(op.entryId, `${field}.entryId`);
      const reason = typeof op.reason === 'string' ? op.reason.trim() : '';
      if (!reason || reason.length > REPORT_DRAFT_LIMITS.maxWithdrawReasonLength) {
        throw invalid(
          `${field}.reason is required, at most ${REPORT_DRAFT_LIMITS.maxWithdrawReasonLength} characters`
        );
      }
      return { op: 'withdraw', entryId, reason };
    }
    case 'import': {
      allowed(['op', 'entryId', 'sourceDraftId', 'sourceEntryId']);
      if (typeof op.sourceDraftId !== 'string' || !op.sourceDraftId.trim()) {
        throw invalid(`${field}.sourceDraftId is required`);
      }
      const sourceEntryId = parseEntryId(op.sourceEntryId, `${field}.sourceEntryId`);
      const entryId =
        op.entryId === undefined ? sourceEntryId : parseEntryId(op.entryId, `${field}.entryId`);
      return { op: 'import', entryId, sourceDraftId: op.sourceDraftId.trim(), sourceEntryId };
    }
    default:
      throw invalid(`${field}.op must be upsert, withdraw or import`);
  }
}

/**
 * Validates `reportDraft` before any read or write. `update` requires a batch
 * operationId, expectedRevision and 1-50 operations; `deliver` requires
 * expectedRevision and accepts 0-50 final operations (its batch identity is
 * the delivery's own operationId).
 */
export function parseReportDraftInput(
  value: unknown,
  mode: 'update' | 'deliver'
): ParsedReportDraftWrite | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('reportDraft must be an object');
  }
  const input = value as Record<string, unknown>;
  const keys =
    mode === 'update'
      ? ['operationId', 'expectedRevision', 'operations']
      : ['expectedRevision', 'operations'];
  const extra = Object.keys(input).filter(key => !keys.includes(key));
  if (extra.length > 0) {
    throw invalid(
      mode === 'deliver' && extra.includes('operationId')
        ? 'reportDraft.operationId is not accepted on deliver; the delivery operationId identifies the final operations'
        : `reportDraft has unsupported fields: ${extra.join(', ')}`
    );
  }
  let operationId: string | undefined;
  if (mode === 'update') {
    if (input.operationId === undefined || input.operationId === null) {
      throw invalid(
        'reportDraft.operationId is required: choose it before sending and reuse it for every retry of this batch'
      );
    }
    operationId = parseOperationId(input.operationId);
  }
  const expectedRevision = input.expectedRevision;
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw invalid(
      'reportDraft.expectedRevision must be a non-negative integer (0 when this session has no draft)'
    );
  }
  const rawOperations = input.operations;
  if (rawOperations !== undefined && !Array.isArray(rawOperations)) {
    throw invalid('reportDraft.operations must be an array');
  }
  const list = (rawOperations ?? []) as unknown[];
  if (mode === 'update' && list.length === 0) {
    throw invalid('reportDraft.operations needs at least one operation');
  }
  if (list.length > REPORT_DRAFT_LIMITS.maxOperationsPerBatch) {
    throw invalid(
      `reportDraft.operations accepts at most ${REPORT_DRAFT_LIMITS.maxOperationsPerBatch} operations`
    );
  }
  const operations = list.map((item, index) => parseOperation(item, index));
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.entryId)) {
      throw invalid(
        `reportDraft.operations names entryId ${operation.entryId} more than once; send one operation per entry`
      );
    }
    seen.add(operation.entryId);
  }
  return { ...(operationId ? { operationId } : {}), expectedRevision, operations };
}

/** Canonical digest of one update batch's semantic request. */
export function reportDraftBatchDigest(semantic: unknown): string {
  const hash = createHash('sha256')
    .update(canonicalJson({ kind: 'report_draft_batch', semantic }))
    .digest('hex');
  return `${DIGEST_VERSION}:${hash}`;
}

// ---- Rows -------------------------------------------------------------------

export type ReportDraftRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
  session_id: string;
  owner_workspace_user_id: string;
  revision: number;
  batch_count: number;
  entry_count: number;
  sealed_at: string | Date | null;
  sealed_delivery_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type EntryRow = {
  id: string;
  draft_id: string;
  entry_id: string;
  kind: ReportDraftKind;
  content_json: string | Record<string, unknown>;
  position: number;
  withdrawn_at: string | Date | null;
  withdrawn_reason: string | null;
  source_event_id: string | null;
  imported_from_draft_id: string | null;
  imported_from_entry_id: string | null;
  sealed_ref: string | null;
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ReportDraftBatchRow = {
  id: string;
  draft_id: string;
  operation_id: string;
  request_digest: string;
  result_revision: number;
  event_id: string;
  accepted_at: string | Date;
};

const DRAFT_COLUMNS = `d.id, d.workspace_id, d.project_id, d.mission_id, d.objective_id, d.session_id,
  d.owner_workspace_user_id, d.revision, d.batch_count, d.entry_count, d.sealed_at,
  d.sealed_delivery_id, d.created_at, d.updated_at`;

const ENTRY_COLUMNS = `id, draft_id, entry_id, kind, content_json, position, withdrawn_at,
  withdrawn_reason, source_event_id, imported_from_draft_id, imported_from_entry_id, sealed_ref,
  revision, created_at, updated_at`;

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function entryContent(row: EntryRow): Record<string, unknown> {
  return (
    typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json
  ) as Record<string, unknown>;
}

export async function loadSessionDraft(
  db: DatabaseClient,
  sessionId: string
): Promise<ReportDraftRow | undefined> {
  return await db.get<ReportDraftRow>(
    `SELECT ${DRAFT_COLUMNS} FROM delivery_report_drafts d WHERE d.session_id = ?`,
    [sessionId]
  );
}

async function loadEntries(db: DatabaseClient, draftId: string): Promise<EntryRow[]> {
  return await db.all<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM delivery_report_draft_entries
      WHERE draft_id = ? ORDER BY position ASC, entry_id ASC`,
    [draftId]
  );
}

export async function findDraftBatch(
  db: DatabaseClient,
  draftId: string,
  operationId: string
): Promise<ReportDraftBatchRow | undefined> {
  return await db.get<ReportDraftBatchRow>(
    `SELECT id, draft_id, operation_id, request_digest, result_revision, event_id, accepted_at
       FROM delivery_report_draft_batches WHERE draft_id = ? AND operation_id = ?`,
    [draftId, operationId]
  );
}

function emptyCounts(): ReportDraftCountsV1 {
  return { human_action: 0, tradeoff: 0, known_risk: 0, deferred_work: 0, assumption: 0 };
}

function toEntryDto(row: EntryRow): ReportDraftEntryV1 {
  return {
    entryId: row.entry_id,
    kind: row.kind,
    content: entryContent(row) as unknown as ReportDraftContentV1,
    position: Number(row.position),
    state: row.withdrawn_at === null ? 'active' : 'withdrawn',
    withdrawnAt: isoOrNull(row.withdrawn_at),
    withdrawnReason: row.withdrawn_reason,
    importedFrom:
      row.imported_from_draft_id && row.imported_from_entry_id
        ? { draftId: row.imported_from_draft_id, entryId: row.imported_from_entry_id }
        : null,
    sealedRef: row.sealed_ref,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

/** Open while its session is live and undelivered; abandoned once it ended unsealed. */
function draftState(
  draft: ReportDraftRow,
  session: { ended_at: string | Date | null } | undefined
): ReportDraftState {
  if (draft.sealed_at !== null) return 'sealed';
  return session && session.ended_at === null ? 'open' : 'abandoned';
}

function toDraftDto(
  draft: ReportDraftRow,
  entries: EntryRow[],
  state: ReportDraftState,
  { includeWithdrawn }: { includeWithdrawn: boolean }
): ReportDraftV1 {
  const activeCounts = emptyCounts();
  const active: ReportDraftEntryV1[] = [];
  const withdrawn: ReportDraftEntryV1[] = [];
  for (const row of entries) {
    if (row.withdrawn_at === null) {
      activeCounts[row.kind] += 1;
      active.push(toEntryDto(row));
    } else {
      withdrawn.push(toEntryDto(row));
    }
  }
  return {
    id: draft.id,
    missionId: draft.mission_id,
    objectiveId: draft.objective_id,
    sessionId: draft.session_id,
    state,
    revision: Number(draft.revision),
    batchCount: Number(draft.batch_count),
    entryCount: Number(draft.entry_count),
    activeCounts,
    withdrawnCount: withdrawn.length,
    sealedAt: isoOrNull(draft.sealed_at),
    sealedDeliveryId: draft.sealed_delivery_id,
    createdAt: iso(draft.created_at),
    updatedAt: iso(draft.updated_at),
    entries: active,
    ...(includeWithdrawn ? { withdrawn } : {})
  };
}

async function sessionEnd(
  db: DatabaseClient,
  sessionId: string
): Promise<{ ended_at: string | Date | null } | undefined> {
  return await db.get<{ ended_at: string | Date | null }>(
    `SELECT ended_at FROM agent_sessions WHERE id = ? AND deleted_at IS NULL`,
    [sessionId]
  );
}

export async function readDraftDto(
  db: DatabaseClient,
  draft: ReportDraftRow,
  options: { includeWithdrawn: boolean }
): Promise<ReportDraftV1> {
  const [entries, session] = await Promise.all([
    loadEntries(db, draft.id),
    sessionEnd(db, draft.session_id)
  ]);
  return toDraftDto(draft, entries, draftState(draft, session), options);
}

// ---- Errors -----------------------------------------------------------------

/** 409 with the current revision and the fresh draft, so the caller can rebase. */
export async function reportDraftConflict(
  db: DatabaseClient,
  draft: ReportDraftRow | undefined,
  message: string
): Promise<ServiceError> {
  return new ServiceError(message, REPORT_DRAFT_CONFLICT, 409, {
    currentRevision: draft ? Number(draft.revision) : 0,
    draft: draft ? await readDraftDto(db, draft, { includeWithdrawn: false }) : null
  });
}

export function reportDraftSealedError(draft: ReportDraftRow): ServiceError {
  return new ServiceError(
    'This report draft was sealed by an accepted delivery and can no longer change.',
    REPORT_DRAFT_SEALED,
    409,
    { draftId: draft.id, sealedDeliveryId: draft.sealed_delivery_id }
  );
}

function limitExceeded(message: string, details: Record<string, unknown>): ServiceError {
  return new ServiceError(message, REPORT_DRAFT_LIMIT_EXCEEDED, 409, {
    ...details,
    limits: REPORT_DRAFT_LIMITS
  });
}

// ---- Batch receipts ------------------------------------------------------------

export type ReportDraftBatchResult = {
  draftId: string;
  operationId: string;
  /** Draft revision this batch produced. */
  revision: number;
  /** True when this response is the stored receipt of an earlier acceptance. */
  replayed?: true;
  /** Current draft revision at replay time (replays only). */
  currentRevision?: number;
  activeCounts?: ReportDraftCountsV1;
};

/** Same id + digest replays the receipt; same id + different input is a 409. */
export function assertBatchReplayMatches(batch: ReportDraftBatchRow, digest: string): void {
  if (batch.request_digest !== digest) {
    throw new ServiceError(
      'This reportDraft.operationId was already accepted with a different request. Retry with the original request, or use a new operationId for a new batch.',
      REPORT_DRAFT_OPERATION_CONFLICT,
      409,
      { operationId: batch.operation_id, revision: Number(batch.result_revision) }
    );
  }
}

export function replayedBatch(
  batch: ReportDraftBatchRow,
  draft: ReportDraftRow
): { eventId: string; reportDraft: ReportDraftBatchResult } {
  return {
    eventId: batch.event_id,
    reportDraft: {
      draftId: batch.draft_id,
      operationId: batch.operation_id,
      revision: Number(batch.result_revision),
      replayed: true,
      currentRevision: Number(draft.revision)
    }
  };
}

// ---- Applying operations --------------------------------------------------------

export type DraftScope = {
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  sessionId: string;
  ownerWorkspaceUserId: string;
};

export type AppliedDraft = {
  draft: ReportDraftRow;
  entries: EntryRow[];
  upserted: string[];
  withdrawn: string[];
  imported: string[];
};

type SourceEntry = { draftId: string; row: EntryRow };

/** Active entry of an abandoned (ended, unsealed) draft of the same objective. */
async function loadImportSource(
  db: DatabaseClient,
  scope: DraftScope,
  ownDraftId: string | null,
  sourceDraftId: string,
  sourceEntryId: string
): Promise<SourceEntry> {
  const notFound = () =>
    new ServiceError(
      `Import source ${sourceDraftId}/${sourceEntryId} is not an active entry of an abandoned draft of this objective`,
      REPORT_DRAFT_NOT_FOUND,
      404
    );
  if (sourceDraftId === ownDraftId) throw notFound();
  const source = await db.get<{ id: string }>(
    `SELECT d.id FROM delivery_report_drafts d
       JOIN agent_sessions s ON s.id = d.session_id
      WHERE d.id = ? AND d.workspace_id = ? AND d.objective_id = ? AND d.sealed_at IS NULL
        AND s.ended_at IS NOT NULL`,
    [sourceDraftId, scope.workspaceId, scope.objectiveId]
  );
  if (!source) throw notFound();
  const row = await db.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM delivery_report_draft_entries
      WHERE draft_id = ? AND entry_id = ? AND withdrawn_at IS NULL`,
    [sourceDraftId, sourceEntryId]
  );
  if (!row) throw notFound();
  return { draftId: sourceDraftId, row };
}

/**
 * Applies operations to a session's draft inside the caller's transaction,
 * creating the draft on its first write. All validation (kinds, unknown
 * ids, import sources, active-per-kind and retained-history bounds) runs
 * before the first write, so a refused batch changes nothing.
 */
export async function applyDraftOperations(
  tx: DatabaseClient,
  {
    ctx,
    scope,
    draft,
    operations,
    eventId,
    countBatch,
    now
  }: {
    ctx: ServiceContext;
    scope: DraftScope;
    draft: ReportDraftRow | undefined;
    operations: ParsedDraftOperation[];
    eventId: string;
    /** True for an update batch (retained in batch_count); false for deliver's final set. */
    countBatch: boolean;
    now: string;
  }
): Promise<AppliedDraft> {
  if (countBatch && draft && Number(draft.batch_count) >= REPORT_DRAFT_LIMITS.maxBatches) {
    throw limitExceeded(
      `This draft already retains ${REPORT_DRAFT_LIMITS.maxBatches} accepted batches; no further batches are accepted. Deliver with final operations instead.`,
      { batchCount: Number(draft.batch_count) }
    );
  }
  const existing = draft ? await loadEntries(tx, draft.id) : [];
  const byId = new Map(existing.map(row => [row.entry_id, row]));
  type Planned =
    | {
        type: 'insert';
        entryId: string;
        kind: ReportDraftKind;
        content: Record<string, unknown>;
        importedFrom: { draftId: string; entryId: string } | null;
      }
    | {
        type: 'update';
        row: EntryRow;
        content: Record<string, unknown>;
        importedFrom: { draftId: string; entryId: string } | null;
      }
    | { type: 'withdraw'; row: EntryRow; reason: string };
  const planned: Planned[] = [];
  const upserted: string[] = [];
  const withdrawn: string[] = [];
  const imported: string[] = [];
  // Projected state for bound checks: entry id -> { kind, active }.
  const projected = new Map(
    existing.map(row => [row.entry_id, { kind: row.kind, active: row.withdrawn_at === null }])
  );

  for (const operation of operations) {
    const current = byId.get(operation.entryId);
    if (operation.op === 'withdraw') {
      if (!current) {
        throw invalid(`reportDraft cannot withdraw unknown entryId ${operation.entryId}`);
      }
      if (current.withdrawn_at === null) {
        planned.push({ type: 'withdraw', row: current, reason: operation.reason });
        projected.set(operation.entryId, { kind: current.kind, active: false });
      }
      withdrawn.push(operation.entryId);
      continue;
    }
    let kind: ReportDraftKind;
    let content: Record<string, unknown>;
    let importedFrom: { draftId: string; entryId: string } | null = null;
    if (operation.op === 'import') {
      const source = await loadImportSource(
        tx,
        scope,
        draft?.id ?? null,
        operation.sourceDraftId,
        operation.sourceEntryId
      );
      kind = source.row.kind;
      content = entryContent(source.row);
      importedFrom = { draftId: source.draftId, entryId: source.row.entry_id };
      imported.push(operation.entryId);
    } else {
      kind = operation.kind;
      content = operation.content;
      upserted.push(operation.entryId);
    }
    if (current) {
      if (current.kind !== kind) {
        throw invalid(
          `reportDraft entryId ${operation.entryId} is a ${current.kind} entry; its kind cannot change (withdraw it and use a new entryId)`
        );
      }
      const unchanged =
        current.withdrawn_at === null &&
        canonicalJson(entryContent(current)) === canonicalJson(content) &&
        importedFrom === null;
      if (!unchanged) planned.push({ type: 'update', row: current, content, importedFrom });
    } else {
      planned.push({ type: 'insert', entryId: operation.entryId, kind, content, importedFrom });
    }
    projected.set(operation.entryId, { kind, active: true });
  }

  if (projected.size > REPORT_DRAFT_LIMITS.maxEntryIds) {
    throw limitExceeded(
      `A draft retains at most ${REPORT_DRAFT_LIMITS.maxEntryIds} distinct entry ids, withdrawn ones included. Reuse an existing entryId instead.`,
      { entryCount: projected.size }
    );
  }
  const activeCounts = emptyCounts();
  for (const value of projected.values()) if (value.active) activeCounts[value.kind] += 1;
  for (const kind of REPORT_DRAFT_KINDS) {
    if (activeCounts[kind] > REPORT_DRAFT_LIMITS.maxActivePerKind) {
      throw limitExceeded(
        `A draft holds at most ${REPORT_DRAFT_LIMITS.maxActivePerKind} active ${kind} entries; withdraw or amend existing entries first.`,
        { kind, active: activeCounts[kind] }
      );
    }
  }

  // Header first: entries reference it.
  let header: ReportDraftRow;
  if (!draft) {
    header = {
      id: newId(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      mission_id: scope.missionId,
      objective_id: scope.objectiveId,
      session_id: scope.sessionId,
      owner_workspace_user_id: scope.ownerWorkspaceUserId,
      revision: 1,
      batch_count: countBatch ? 1 : 0,
      entry_count: projected.size,
      sealed_at: null,
      sealed_delivery_id: null,
      created_at: now,
      updated_at: now
    };
    await tx.run(
      `INSERT INTO delivery_report_drafts
         (id, workspace_id, project_id, mission_id, objective_id, session_id,
          owner_workspace_user_id, revision, batch_count, entry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        header.id,
        header.workspace_id,
        header.project_id,
        header.mission_id,
        header.objective_id,
        header.session_id,
        header.owner_workspace_user_id,
        header.revision,
        header.batch_count,
        header.entry_count,
        now,
        now
      ]
    );
  } else {
    header = {
      ...draft,
      revision: Number(draft.revision) + 1,
      batch_count: Number(draft.batch_count) + (countBatch ? 1 : 0),
      entry_count: projected.size,
      updated_at: now
    };
    await tx.run(
      `UPDATE delivery_report_drafts
          SET revision = ?, batch_count = ?, entry_count = ?, updated_at = ?
        WHERE id = ? AND revision = ?`,
      [
        header.revision,
        header.batch_count,
        header.entry_count,
        now,
        draft.id,
        Number(draft.revision)
      ]
    );
  }

  let nextPosition = existing.reduce((max, row) => Math.max(max, Number(row.position) + 1), 0);
  for (const step of planned) {
    if (step.type === 'insert') {
      await tx.run(
        `INSERT INTO delivery_report_draft_entries
           (id, draft_id, workspace_id, entry_id, kind, content_json, position, source_event_id,
            imported_from_draft_id, imported_from_entry_id, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          newId(),
          header.id,
          scope.workspaceId,
          step.entryId,
          step.kind,
          JSON.stringify(step.content),
          nextPosition,
          eventId,
          step.importedFrom?.draftId ?? null,
          step.importedFrom?.entryId ?? null,
          now,
          now
        ]
      );
      nextPosition += 1;
    } else if (step.type === 'update') {
      await tx.run(
        `UPDATE delivery_report_draft_entries
            SET content_json = ?, withdrawn_at = NULL, withdrawn_reason = NULL,
                source_event_id = ?, imported_from_draft_id = ?, imported_from_entry_id = ?,
                revision = revision + 1, updated_at = ?
          WHERE id = ?`,
        [
          JSON.stringify(step.content),
          eventId,
          step.importedFrom?.draftId ?? step.row.imported_from_draft_id,
          step.importedFrom?.entryId ?? step.row.imported_from_entry_id,
          now,
          step.row.id
        ]
      );
    } else {
      await tx.run(
        `UPDATE delivery_report_draft_entries
            SET withdrawn_at = ?, withdrawn_reason = ?, source_event_id = ?,
                revision = revision + 1, updated_at = ?
          WHERE id = ?`,
        [now, step.reason, eventId, now, step.row.id]
      );
    }
  }

  await recordChange({
    ctx: { ...ctx, db: tx },
    entityType: 'delivery_report_draft',
    entityId: header.id,
    operation: draft ? 'update' : 'insert',
    entityRevision: header.revision,
    projectId: scope.projectId,
    missionId: scope.missionId,
    objectiveId: scope.objectiveId,
    changedFields: ['revision', 'entries']
  });

  return {
    draft: header,
    entries: await loadEntries(tx, header.id),
    upserted,
    withdrawn,
    imported
  };
}

export async function insertDraftBatchReceipt(
  tx: DatabaseClient,
  {
    draft,
    operationId,
    digest,
    eventId,
    operationCount,
    now
  }: {
    draft: ReportDraftRow;
    operationId: string;
    digest: string;
    eventId: string;
    operationCount: number;
    now: string;
  }
): Promise<void> {
  await tx.run(
    `INSERT INTO delivery_report_draft_batches
       (id, draft_id, workspace_id, operation_id, request_digest, result_revision, event_id,
        operation_count, accepted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      draft.id,
      draft.workspace_id,
      operationId,
      digest,
      Number(draft.revision),
      eventId,
      operationCount,
      now,
      now
    ]
  );
}

export function activeCountsOf(entries: EntryRow[]): ReportDraftCountsV1 {
  const counts = emptyCounts();
  for (const row of entries) if (row.withdrawn_at === null) counts[row.kind] += 1;
  return counts;
}

// ---- Final merge and seal ------------------------------------------------------

const AGENT_REPORT_KEYS = new Set([
  'humanActions',
  'tradeoffsMade',
  'knownRisks',
  'deferredWork',
  'assumptions'
]);

const KIND_FIELDS: Array<{ kind: ReportDraftKind; field: keyof DeliveryAgentReportInputV1 }> = [
  { kind: 'human_action', field: 'humanActions' },
  { kind: 'tradeoff', field: 'tradeoffsMade' },
  { kind: 'known_risk', field: 'knownRisks' },
  { kind: 'deferred_work', field: 'deferredWork' },
  { kind: 'assumption', field: 'assumptions' }
];

const TEXT_KINDS = new Set<ReportDraftKind>(['known_risk', 'assumption']);

type MergedItem = { entryId: string | null; content: Record<string, unknown> };

export type DraftEntryRef = {
  entryId: string | null;
  kind: ReportDraftKind;
  /** The accepted V1 item id or array reference; null when excluded. */
  ref: string | null;
  excludedReason?: 'not_a_human_action' | 'not_out_of_mission_work';
};

export type DraftMerge = {
  /** Wire-shaped report built from the merged active set. */
  deliveryReport: { schemaVersion: 1; agentReport: DeliveryAgentReportInputV1 };
  refs: DraftEntryRef[];
  warnings: string[];
};

/** Legacy final arrays, validated item by item without truncation. */
function legacyItems(
  deliveryReport: unknown,
  warnings: string[]
): Record<ReportDraftKind, Array<Record<string, unknown>>> {
  const out: Record<ReportDraftKind, Array<Record<string, unknown>>> = {
    human_action: [],
    tradeoff: [],
    known_risk: [],
    deferred_work: [],
    assumption: []
  };
  if (deliveryReport === undefined || deliveryReport === null) return out;
  if (typeof deliveryReport !== 'object' || Array.isArray(deliveryReport)) {
    warnings.push('Ignored deliveryReport: expected an object.');
    return out;
  }
  const root = deliveryReport as Record<string, unknown>;
  if (root.schemaVersion !== 1) {
    warnings.push('Ignored deliveryReport: schemaVersion must be 1.');
    return out;
  }
  const report = root.agentReport;
  if (report === undefined) return out;
  if (typeof report !== 'object' || report === null || Array.isArray(report)) {
    warnings.push('Ignored deliveryReport.agentReport: expected an object.');
    return out;
  }
  const fields = report as Record<string, unknown>;
  if (Object.keys(fields).some(key => !AGENT_REPORT_KEYS.has(key))) {
    warnings.push('Ignored unsupported deliveryReport.agentReport fields.');
  }
  for (const { kind, field } of KIND_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      warnings.push(`Ignored deliveryReport.agentReport.${field}: expected an array.`);
      continue;
    }
    value.forEach((item, index) => {
      // V1 risks and assumptions are plain strings on the wire.
      const candidate = TEXT_KINDS.has(kind)
        ? typeof item === 'string'
          ? { text: item }
          : null
        : item;
      const parsed = CONTENT_SCHEMAS[kind].safeParse(candidate);
      if (parsed.success) out[kind].push(parsed.data);
      else
        warnings.push(
          `Ignored deliveryReport.agentReport.${field}[${index}]: invalid advisory item.`
        );
    });
  }
  return out;
}

/**
 * Deterministic final evidence for a draft-aware delivery: active draft
 * entries in position order, then legacy final-array items whose canonical
 * kind/content matches no active entry. More than 12 items of a kind is
 * refused before acceptance; nothing is truncated or chosen by a model.
 * Draft entries are amended or removed only through their stable ids.
 */
export function mergeDraftEvidence(
  activeEntries: Array<{
    entry_id: string;
    kind: ReportDraftKind;
    content: Record<string, unknown>;
  }>,
  legacyDeliveryReport: unknown
): DraftMerge {
  const warnings: string[] = [];
  const legacy = legacyItems(legacyDeliveryReport, warnings);
  const merged: Record<ReportDraftKind, MergedItem[]> = {
    human_action: [],
    tradeoff: [],
    known_risk: [],
    deferred_work: [],
    assumption: []
  };
  const keys: Record<ReportDraftKind, Set<string>> = {
    human_action: new Set(),
    tradeoff: new Set(),
    known_risk: new Set(),
    deferred_work: new Set(),
    assumption: new Set()
  };
  for (const entry of activeEntries) {
    merged[entry.kind].push({ entryId: entry.entry_id, content: entry.content });
    keys[entry.kind].add(canonicalJson(entry.content));
  }
  for (const { kind } of KIND_FIELDS) {
    for (const content of legacy[kind]) {
      if (keys[kind].has(canonicalJson(content))) continue;
      merged[kind].push({ entryId: null, content });
    }
    if (merged[kind].length > REPORT_DRAFT_LIMITS.maxActivePerKind) {
      throw limitExceeded(
        `The merged report has ${merged[kind].length} ${kind} items; at most ${REPORT_DRAFT_LIMITS.maxActivePerKind} are accepted. Withdraw draft entries or drop final items; nothing is truncated.`,
        { kind, active: merged[kind].length }
      );
    }
  }

  const refs: DraftEntryRef[] = [];
  let humanIndex = 0;
  for (const item of merged.human_action) {
    const action = String(item.content.action ?? '');
    if (isDisplayableHumanAction(action)) {
      humanIndex += 1;
      refs.push({ entryId: item.entryId, kind: 'human_action', ref: `human-action-${humanIndex}` });
    } else {
      refs.push({
        entryId: item.entryId,
        kind: 'human_action',
        ref: null,
        excludedReason: 'not_a_human_action'
      });
      warnings.push(
        `Excluded human action ${item.entryId ? `draft entry ${item.entryId}` : `"${action.slice(0, 60)}"`}: Git operations and routine review/testing are not human actions.`
      );
    }
  }
  merged.tradeoff.forEach((item, index) =>
    refs.push({ entryId: item.entryId, kind: 'tradeoff', ref: `tradeoff-${index + 1}` })
  );
  merged.deferred_work.forEach((item, index) =>
    refs.push({
      entryId: item.entryId,
      kind: 'deferred_work',
      ref: deferredWorkId(index, item.content as never)
    })
  );
  merged.known_risk.forEach((item, index) =>
    refs.push({ entryId: item.entryId, kind: 'known_risk', ref: `knownRisks[${index}]` })
  );
  merged.assumption.forEach((item, index) =>
    refs.push({ entryId: item.entryId, kind: 'assumption', ref: `assumptions[${index}]` })
  );

  const text = (items: MergedItem[]) => items.map(item => String(item.content.text));
  return {
    deliveryReport: {
      schemaVersion: 1,
      agentReport: {
        humanActions: merged.human_action.map(item => item.content) as never,
        tradeoffsMade: merged.tradeoff.map(item => item.content) as never,
        knownRisks: text(merged.known_risk),
        deferredWork: merged.deferred_work.map(item => item.content) as never,
        assumptions: text(merged.assumption)
      }
    },
    refs,
    warnings
  };
}

/** Marks deferred-work refs the eligibility filter keeps out of presentation. */
export function applyEligibilityToRefs(
  refs: DraftEntryRef[],
  eligible: DeliveryReportPayloadV1,
  warnings: string[]
): DraftEntryRef[] {
  const kept = new Set(eligible.presentation.deferredWork.map(item => item.id));
  return refs.map(ref => {
    if (ref.kind !== 'deferred_work' || ref.ref === null || kept.has(ref.ref)) return ref;
    warnings.push(
      `Deferred work ${ref.entryId ? `draft entry ${ref.entryId}` : ref.ref} is kept in the accepted report but not shown as out-of-mission work: it matches this objective, a planned objective or a human action.`
    );
    return { ...ref, excludedReason: 'not_out_of_mission_work' as const };
  });
}

/**
 * Seals a draft in the finalization transaction: records each active entry's
 * accepted V1 reference, then links the delivery. After this the database
 * refuses any change to the draft or its entries.
 */
export async function sealDraft(
  tx: DatabaseClient,
  {
    ctx,
    draft,
    refs,
    entries,
    deliveryId,
    now
  }: {
    ctx: ServiceContext;
    draft: ReportDraftRow;
    refs: DraftEntryRef[];
    entries: EntryRow[];
    deliveryId: string;
    now: string;
  }
): Promise<{
  draftId: string;
  revision: number;
  activeEntries: number;
  refs: Array<{ entryId: string; ref: string | null }>;
}> {
  const refByEntry = new Map(
    refs.filter(ref => ref.entryId !== null).map(ref => [ref.entryId as string, ref.ref])
  );
  const active = entries.filter(row => row.withdrawn_at === null);
  for (const row of active) {
    const ref = refByEntry.get(row.entry_id) ?? null;
    if (ref === null) continue;
    await tx.run(`UPDATE delivery_report_draft_entries SET sealed_ref = ? WHERE id = ?`, [
      ref,
      row.id
    ]);
  }
  const revision = Number(draft.revision) + 1;
  await tx.run(
    `UPDATE delivery_report_drafts
        SET sealed_at = ?, sealed_delivery_id = ?, revision = ?, updated_at = ?
      WHERE id = ? AND sealed_at IS NULL`,
    [now, deliveryId, revision, now, draft.id]
  );
  await recordChange({
    ctx: { ...ctx, db: tx },
    entityType: 'delivery_report_draft',
    entityId: draft.id,
    operation: 'update',
    entityRevision: revision,
    projectId: draft.project_id,
    missionId: draft.mission_id,
    objectiveId: draft.objective_id,
    changedFields: ['sealed_at', 'sealed_delivery_id']
  });
  return {
    draftId: draft.id,
    revision,
    activeEntries: active.length,
    refs: active.map(row => ({ entryId: row.entry_id, ref: refByEntry.get(row.entry_id) ?? null }))
  };
}

export function activeEntryInputs(
  entries: EntryRow[]
): Array<{ entry_id: string; kind: ReportDraftKind; content: Record<string, unknown> }> {
  return entries
    .filter(row => row.withdrawn_at === null)
    .map(row => ({ entry_id: row.entry_id, kind: row.kind, content: entryContent(row) }));
}

export { loadEntries as loadDraftEntries };
export type { EntryRow as ReportDraftEntryRow };

// ---- Reads ---------------------------------------------------------------------

/** Ended, unsealed drafts of the objective other than `exceptDraftId`, newest first. */
async function abandonedDrafts(
  db: DatabaseClient,
  {
    workspaceId,
    objectiveId,
    exceptDraftId,
    limit = 10
  }: { workspaceId: string; objectiveId: string; exceptDraftId: string | null; limit?: number }
): Promise<ReportDraftRefV1[]> {
  const rows = await db.all<{
    id: string;
    session_id: string;
    revision: number;
    updated_at: string | Date;
    active: number | string;
  }>(
    `SELECT d.id, d.session_id, d.revision, d.updated_at,
            (SELECT COUNT(*) FROM delivery_report_draft_entries e
              WHERE e.draft_id = d.id AND e.withdrawn_at IS NULL) AS active
       FROM delivery_report_drafts d
       JOIN agent_sessions s ON s.id = d.session_id
      WHERE d.workspace_id = ? AND d.objective_id = ? AND d.sealed_at IS NULL
        AND s.ended_at IS NOT NULL AND d.id <> ?
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT ?`,
    [workspaceId, objectiveId, exceptDraftId ?? '', limit]
  );
  return rows.map(row => ({
    draftId: row.id,
    sessionId: row.session_id,
    state: 'abandoned' as const,
    revision: Number(row.revision),
    activeEntryCount: Number(row.active),
    updatedAt: iso(row.updated_at)
  }));
}

/**
 * Compact attach baseline: the attaching execution's own open draft (only on
 * re-attach of the same session) and abandoned drafts it may import from.
 * Undefined when there is neither.
 */
export async function readReportDraftAttachBaseline(
  db: DatabaseClient,
  {
    workspaceId,
    objectiveId,
    sessionId
  }: { workspaceId: string; objectiveId: string; sessionId: string | null }
): Promise<ReportDraftAttachBaselineV1 | undefined> {
  const own = sessionId ? await loadSessionDraft(db, sessionId) : undefined;
  const ownOpen = own && own.sealed_at === null ? own : undefined;
  const abandoned = await abandonedDrafts(db, {
    workspaceId,
    objectiveId,
    exceptDraftId: own?.id ?? null,
    limit: 5
  });
  if (!ownOpen && abandoned.length === 0) return undefined;
  let current: ReportDraftAttachBaselineV1['current'] = null;
  if (ownOpen) {
    const entries = await loadEntries(db, ownOpen.id);
    current = {
      draftId: ownOpen.id,
      revision: Number(ownOpen.revision),
      activeCounts: activeCountsOf(entries),
      withdrawnCount: entries.filter(row => row.withdrawn_at !== null).length
    };
  }
  return { current, abandoned };
}

type SessionLookup = {
  id: string;
  mission_id: string;
  objective_id: string;
  ended_at: string | Date | null;
  delivery_state: string | null;
};

export type ReportDraftInspection = {
  /** The normalized agent report this draft would seal into right now. */
  agentReport: DeliveryAgentReportV1;
  /** Each active entry's V1 item reference, or why it would be excluded. */
  entries: DraftEntryRef[];
  warnings: string[];
};

export type ReportDraftReadResult = {
  draft: ReportDraftV1 | null;
  /** The revision to send as expectedRevision (0 when no draft exists). */
  revision: number;
  /** Final inspection of the caller's own open draft; null otherwise. */
  inspection: ReportDraftInspection | null;
  /** Abandoned drafts of the same objective that may be imported from. */
  abandoned: ReportDraftRefV1[];
  limits: typeof REPORT_DRAFT_LIMITS;
};

/**
 * `report-draft`: the caller's own session draft (live or ended), or, with
 * `draftId`, an abandoned or sealed draft of the same objective. An open
 * draft of another live session is never readable here. The caller's own
 * open draft carries the final inspection: the normalized, eligibility-
 * filtered evidence it would seal into, with exclusion warnings.
 */
export async function readReportDraft({
  ctx,
  missionId,
  sessionKey,
  draftId,
  includeWithdrawn = false
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  draftId?: string | null;
  includeWithdrawn?: boolean;
}): Promise<ReportDraftReadResult> {
  const mission = await resolveMissionId(ctx, missionId);
  const session = await ctx.db.get<SessionLookup>(
    `SELECT id, mission_id, objective_id, ended_at, delivery_state FROM agent_sessions
      WHERE workspace_id = ? AND session_key_hash = ? AND deleted_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [ctx.workspace.id, hashSessionKey(sessionKey)]
  );
  if (!session || session.mission_id !== mission.id) {
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
  const own = await loadSessionDraft(ctx.db, session.id);
  let target = own;
  if (draftId && draftId !== own?.id) {
    const other = await ctx.db.get<ReportDraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM delivery_report_drafts d
        WHERE d.id = ? AND d.workspace_id = ? AND d.objective_id = ?`,
      [draftId, ctx.workspace.id, session.objective_id]
    );
    const otherSession = other ? await sessionEnd(ctx.db, other.session_id) : undefined;
    if (!other || draftState(other, otherSession) === 'open') {
      throw new ServiceError('Report draft not found', REPORT_DRAFT_NOT_FOUND, 404);
    }
    target = other;
  }
  const abandoned = await abandonedDrafts(ctx.db, {
    workspaceId: ctx.workspace.id,
    objectiveId: session.objective_id,
    exceptDraftId: own?.id ?? null
  });
  if (!target) {
    return { draft: null, revision: 0, inspection: null, abandoned, limits: REPORT_DRAFT_LIMITS };
  }
  const dto = await readDraftDto(ctx.db, target, { includeWithdrawn });
  const inspection =
    target === own && dto.state === 'open'
      ? await inspectDraft(ctx, {
          missionId: mission.id,
          objectiveId: session.objective_id,
          entries: await loadEntries(ctx.db, target.id)
        })
      : null;
  return {
    draft: dto,
    revision: dto.revision,
    inspection,
    abandoned,
    limits: REPORT_DRAFT_LIMITS
  };
}

/** Eligibility inputs shared with deliver: sibling objectives and the objective's paths. */
export async function deliveryEligibilityContext(
  ctx: ServiceContext,
  { missionId, objectiveId }: { missionId: string; objectiveId: string }
) {
  const objectives = await listObjectives({ ctx, missionId });
  const current = objectives.find(objective => objective.id === objectiveId);
  const plannedObjectives = objectives
    .filter(
      objective =>
        objective.id !== objectiveId &&
        objective.state !== 'complete' &&
        Boolean(objective.objective?.trim())
    )
    .map(objective => ({ title: objective.title, instruction: objective.objective }));
  const changed = await ctx.db.all<{ file_path: string }>(
    `SELECT file_path FROM changed_files WHERE objective_id = ? AND deleted_at IS NULL`,
    [objectiveId]
  );
  return {
    currentObjective: current ? { title: current.title, instruction: current.objective } : null,
    plannedObjectives,
    candidateActions: deriveDeterministicActionCandidates({
      filePaths: changed.map(row => row.file_path)
    })
  };
}

async function inspectDraft(
  ctx: ServiceContext,
  {
    missionId,
    objectiveId,
    entries
  }: { missionId: string; objectiveId: string; entries: EntryRow[] }
): Promise<ReportDraftInspection> {
  let merge: DraftMerge;
  try {
    merge = mergeDraftEvidence(activeEntryInputs(entries), undefined);
  } catch (error) {
    // Active entries are bounded at write time; report rather than fail the read.
    if (error instanceof ServiceError) {
      return {
        agentReport: {
          humanActions: [],
          tradeoffsMade: [],
          knownRisks: [],
          deferredWork: [],
          assumptions: []
        },
        entries: [],
        warnings: [error.message]
      };
    }
    throw error;
  }
  const report = buildDeliveryReport({ summary: '', deliveryReport: merge.deliveryReport });
  const eligible = applyDeferredWorkEligibility({
    report,
    ...(await deliveryEligibilityContext(ctx, { missionId, objectiveId }))
  });
  const warnings = [...merge.warnings, ...(report.warnings ?? [])];
  const refs = applyEligibilityToRefs(merge.refs, eligible, warnings);
  return { agentReport: eligible.agentReport, entries: refs, warnings };
}

// ---- Operator projection ----------------------------------------------------------

/**
 * Read-only operator projection of an objective's drafts, newest first, with
 * withdrawn entries. Provisional: never mission items, badges, obligations,
 * seen state or completion. The caller has already authorized the objective.
 */
export async function listObjectiveReportDrafts(
  db: DatabaseClient,
  {
    workspaceId,
    objectiveId,
    limit = 20
  }: { workspaceId: string; objectiveId: string; limit?: number }
): Promise<ReportDraftV1[]> {
  const drafts = await db.all<ReportDraftRow>(
    `SELECT ${DRAFT_COLUMNS} FROM delivery_report_drafts d
      WHERE d.workspace_id = ? AND d.objective_id = ?
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ?`,
    [workspaceId, objectiveId, limit]
  );
  const out: ReportDraftV1[] = [];
  for (const draft of drafts) out.push(await readDraftDto(db, draft, { includeWithdrawn: true }));
  return out;
}
