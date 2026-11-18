import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import type { ServiceContext } from './context.js';
import { resolveMissionId } from './context.js';
import { ServiceError } from './errors.js';
import { newId } from './util.js';

/**
 * Durable, replay-safe finalization receipts (coo:1297 phase 1, contract ADR 0075).
 *
 * A `delivery_finalizations` row commits in the same transaction as the
 * delivery it accepts. It records the canonical digest of the validated
 * semantic request and the immutable accepted result, keyed by the caller's
 * own operation id. A logical retry with the same id and digest gets the
 * stored result back with no writes; the same id with a different request is
 * a conflict. Nothing here is a short-lived request cache.
 */

export type FinalizationKind = 'deliver' | 'record_work';

/** Client operation ids are opaque, non-secret references chosen by the caller. */
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const DELIVERY_OPERATION_CONFLICT = 'delivery_operation_conflict';
export const DELIVERY_ALREADY_ACCEPTED = 'delivery_already_accepted';
export const DELIVERY_RECEIPT_NOT_FOUND = 'delivery_receipt_not_found';

const DIGEST_VERSION = 'v1';

/** Validates an optional caller operation id; absent stays undefined (legacy clients). */
export function parseOperationId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) {
    throw new ServiceError(
      'operationId must be 8-128 characters of letters, digits, ".", "_", ":" or "-", starting with a letter or digit',
      'invalid_input',
      400
    );
  }
  return value;
}

/**
 * Canonical JSON: object keys sorted, `undefined` members dropped, array order
 * preserved (order is meaningful in reports and artifacts).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalize(item ?? null));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined) continue;
      out[key] = canonicalize(member);
    }
    return out;
  }
  return value;
}

/**
 * Digest of the validated semantic request. Callers pass only semantic input:
 * scope ids, authored text, artifacts, declared paths, report and summary
 * input. Never bearer/session secrets, diagnostics, timestamps or
 * server-derived presentation.
 */
export function finalizationRequestDigest(kind: FinalizationKind, semantic: unknown): string {
  const hash = createHash('sha256').update(canonicalJson({ kind, semantic })).digest('hex');
  return `${DIGEST_VERSION}:${hash}`;
}

export type FinalizationReceiptRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
  delivery_id: string;
  actor_workspace_user_id: string;
  session_id: string | null;
  operation_kind: FinalizationKind;
  operation_id: string | null;
  request_digest: string;
  result_json: string | Record<string, unknown>;
  accepted_at: string;
};

const RECEIPT_COLUMNS = `id, workspace_id, project_id, mission_id, objective_id, delivery_id,
  actor_workspace_user_id, session_id, operation_kind, operation_id, request_digest,
  result_json, accepted_at`;

export function receiptResult<T>(row: FinalizationReceiptRow): T {
  return (typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json) as T;
}

/** The caller's own receipt for one operation id, or undefined. */
export async function findReceiptByOperation(
  db: DatabaseClient,
  {
    workspaceId,
    actorWorkspaceUserId,
    kind,
    operationId
  }: {
    workspaceId: string;
    actorWorkspaceUserId: string;
    kind: FinalizationKind;
    operationId: string;
  }
): Promise<FinalizationReceiptRow | undefined> {
  return await db.get<FinalizationReceiptRow>(
    `SELECT ${RECEIPT_COLUMNS} FROM delivery_finalizations
      WHERE workspace_id = ? AND actor_workspace_user_id = ? AND operation_kind = ?
        AND operation_id = ?`,
    [workspaceId, actorWorkspaceUserId, kind, operationId]
  );
}

export async function findReceiptBySession(
  db: DatabaseClient,
  sessionId: string
): Promise<FinalizationReceiptRow | undefined> {
  return await db.get<FinalizationReceiptRow>(
    `SELECT ${RECEIPT_COLUMNS} FROM delivery_finalizations WHERE session_id = ?`,
    [sessionId]
  );
}

/**
 * Same id + digest replays; same id + different digest is a 409. The receipt
 * must also address the same mission/session the caller named now, so an
 * operation id reused across scopes cannot read another finalization.
 */
export function assertReplayMatches(
  receipt: FinalizationReceiptRow,
  {
    digest,
    missionId,
    sessionId
  }: { digest: string; missionId?: string; sessionId?: string | null }
): void {
  const sameScope =
    (missionId === undefined || receipt.mission_id === missionId) &&
    (sessionId === undefined || receipt.session_id === sessionId);
  if (!sameScope || receipt.request_digest !== digest) {
    throw new ServiceError(
      'This operationId was already accepted with a different request. Retry with the original request, or use a new operationId for separate work.',
      DELIVERY_OPERATION_CONFLICT,
      409,
      {
        operationId: receipt.operation_id,
        operationKind: receipt.operation_kind,
        deliveryId: receipt.delivery_id
      }
    );
  }
}

export async function insertFinalizationReceipt(
  db: DatabaseClient,
  receipt: {
    workspaceId: string;
    projectId: string;
    missionId: string;
    objectiveId: string;
    deliveryId: string;
    actorWorkspaceUserId: string;
    sessionId: string | null;
    kind: FinalizationKind;
    operationId: string | null;
    digest: string;
    result: Record<string, unknown>;
    acceptedAt: string;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO delivery_finalizations
       (id, workspace_id, project_id, mission_id, objective_id, delivery_id,
        actor_workspace_user_id, session_id, operation_kind, operation_id, request_digest,
        result_json, accepted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      receipt.workspaceId,
      receipt.projectId,
      receipt.missionId,
      receipt.objectiveId,
      receipt.deliveryId,
      receipt.actorWorkspaceUserId,
      receipt.sessionId,
      receipt.kind,
      receipt.operationId,
      receipt.digest,
      JSON.stringify(receipt.result),
      receipt.acceptedAt,
      receipt.acceptedAt
    ]
  );
}

/** True for a unique-constraint violation on either adapter. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '23505') return true;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error ? isUniqueViolation(cause) : false;
}

/** 409 for a session that already finalized, naming the existing delivery. */
export function deliveryAlreadyAcceptedError(deliveryId: string | null): ServiceError {
  return new ServiceError(
    'This session already delivered. Do not deliver again; use resume-follow-up for new work.',
    DELIVERY_ALREADY_ACCEPTED,
    409,
    { deliveryId }
  );
}

/** The accepted delivery for a session that finalized before receipts existed. */
export async function historicalSessionDeliveryId(
  db: DatabaseClient,
  sessionId: string
): Promise<string | null> {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM deliveries WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY delivered_at DESC, id DESC LIMIT 1`,
    [sessionId]
  );
  return row?.id ?? null;
}

export type DeliveryReceipt = {
  operationKind: FinalizationKind;
  operationId: string | null;
  missionId: string;
  missionDisplayId: string;
  objectiveId: string;
  deliveryId: string;
  acceptedAt: string;
  /** The immutable result returned when the operation was accepted. */
  result: Record<string, unknown>;
};

/**
 * Scoped receipt read (`delivery-receipt`): by delivery id or by the caller's
 * own operation id. Only the originating member can read a receipt, the
 * mission must still be in the caller's current scope, and an unknown,
 * foreign or out-of-scope receipt is the same not-found.
 */
export async function readDeliveryReceipt({
  ctx,
  missionId,
  deliveryId,
  operationId,
  operationKind
}: {
  ctx: ServiceContext;
  missionId?: string | null;
  deliveryId?: string | null;
  operationId?: string | null;
  operationKind?: string | null;
}): Promise<{ receipt: DeliveryReceipt }> {
  const notFound = () =>
    new ServiceError('Delivery receipt not found', DELIVERY_RECEIPT_NOT_FOUND, 404);
  if (!deliveryId === !operationId) {
    throw new ServiceError(
      'delivery-receipt requires exactly one of deliveryId or operationId',
      'invalid_input',
      400
    );
  }
  const kind = operationKind ?? 'deliver';
  if (kind !== 'deliver' && kind !== 'record_work' && kind !== 'record-work') {
    throw new ServiceError('operationKind must be deliver or record_work', 'invalid_input', 400);
  }
  const actor = ctx.actorWorkspaceUserId;
  if (!actor) throw notFound();

  let row: FinalizationReceiptRow | undefined;
  if (operationId) {
    row = await findReceiptByOperation(ctx.db, {
      workspaceId: ctx.workspace.id,
      actorWorkspaceUserId: actor,
      kind: kind === 'deliver' ? 'deliver' : 'record_work',
      operationId: parseOperationId(operationId) as string
    });
  } else {
    row = await ctx.db.get<FinalizationReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS} FROM delivery_finalizations
        WHERE workspace_id = ? AND actor_workspace_user_id = ? AND delivery_id = ?`,
      [ctx.workspace.id, actor, deliveryId]
    );
  }
  if (!row) throw notFound();

  let mission: { id: string; displayId: string };
  try {
    mission = await resolveMissionId(ctx, row.mission_id);
  } catch {
    throw notFound();
  }
  if (missionId) {
    let named: { id: string };
    try {
      named = await resolveMissionId(ctx, missionId);
    } catch {
      throw notFound();
    }
    if (named.id !== mission.id) throw notFound();
  }
  const delivery = await ctx.db.get<{ id: string }>(
    `SELECT id FROM deliveries WHERE id = ? AND deleted_at IS NULL`,
    [row.delivery_id]
  );
  if (!delivery) throw notFound();

  return {
    receipt: {
      operationKind: row.operation_kind,
      operationId: row.operation_id,
      missionId: mission.id,
      missionDisplayId: mission.displayId,
      objectiveId: row.objective_id,
      deliveryId: row.delivery_id,
      acceptedAt: new Date(row.accepted_at).toISOString(),
      result: receiptResult(row)
    }
  };
}
