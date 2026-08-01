import { recordChange } from '../change-feed.js';
import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';
import { newId, nowIso } from '../util.js';

import { DELIVERY_OUTCOMES, type DeliveryOutcome, describeDeliveryOutcome } from './pure/inject.js';
import type { AgentSessionChannelRow } from './channels.js';
import { addSeconds } from './credential.js';

export { type DeliveryOutcome, describeDeliveryOutcome };

/**
 * Inbound session instructions — a durable queue from Overlord to one live session.
 *
 * The state machine is short and the interesting rule is a *refusal*:
 *
 *     queued → leased → emitted → acknowledged
 *                   ↘ failed / expired / cancelled
 *
 * **After `emitted`, automatic retry is forbidden.** Not discouraged — forbidden, and enforced
 * here rather than left to adapter discipline. A retried instruction that did land the first
 * time tells the model to do the thing twice, and an agent that deletes a branch twice because
 * a lease flapped is a worse outcome than a message whose delivery we honestly cannot confirm.
 * Lease expiry therefore permits reclaim only while the input is still `queued` or `leased`.
 *
 * The same honesty applies to what the UI is allowed to say. `emitted` means the adapter wrote
 * the message to the harness. `acknowledged` means the harness confirmed the agent received it,
 * and only harnesses that expose an acknowledgement can ever reach that state. No adapter may
 * report Delivered for a message the agent has not received.
 */

/** How long one adapter consumer holds an unemitted input before another may reclaim it. */
export const INPUT_LEASE_SECONDS = 60;

export const MAX_INPUT_BODY_LENGTH = 16000;

export type AgentSessionInputStatus =
  | 'queued'
  | 'leased'
  | 'emitted'
  | 'acknowledged'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type AgentSessionInputRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  mission_id: string | null;
  objective_id: string | null;
  channel_id: string;
  session_id: string;
  kind: 'instruction' | 'retry' | 'continue';
  body: string;
  idempotency_key: string | null;
  created_by_workspace_user_id: string | null;
  status: AgentSessionInputStatus;
  lease_id: string | null;
  lease_expires_at: string | null;
  emitted_at: string | null;
  acknowledged_at: string | null;
  attempt_count: number;
  last_error_code: string | null;
  /**
   * Written at emit time. Distinguishes Delivered from Queued(turn-boundary) so the UI
   * cannot invent Delivered for a Cursor followup_message that has not reached the agent.
   */
  delivery_outcome: DeliveryOutcome | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

const INPUT_COLUMNS = `
  id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
  kind, body, idempotency_key, created_by_workspace_user_id, status,
  lease_id, lease_expires_at, emitted_at, acknowledged_at, attempt_count, last_error_code,
  delivery_outcome, created_at, updated_at, revision
`;

function normalizeDeliveryOutcome(value: string | null | undefined): DeliveryOutcome | null {
  if (!value) return null;
  return (DELIVERY_OUTCOMES as readonly string[]).includes(value)
    ? (value as DeliveryOutcome)
    : null;
}

export async function getInput({
  ctx,
  inputId
}: {
  ctx: ServiceContext;
  inputId: string;
}): Promise<AgentSessionInputRow> {
  const row = await ctx.db.get<AgentSessionInputRow>(
    `SELECT ${INPUT_COLUMNS} FROM agent_session_inputs
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [inputId, ctx.workspace.id]
  );
  if (!row) throw new ServiceError('Session input not found', 'input_not_found', 404);
  return { ...row, delivery_outcome: normalizeDeliveryOutcome(row.delivery_outcome) };
}

/** List recent inputs for one mission, newest first. */
export async function listSessionInputs({
  ctx,
  missionId,
  limit = 50
}: {
  ctx: ServiceContext;
  missionId: string;
  limit?: number;
}): Promise<AgentSessionInputRow[]> {
  const rows = await ctx.db.all<AgentSessionInputRow>(
    `SELECT ${INPUT_COLUMNS} FROM agent_session_inputs
       WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?`,
    [missionId, ctx.workspace.id, Math.min(200, Math.max(1, limit))]
  );
  return rows.map(row => ({
    ...row,
    delivery_outcome: normalizeDeliveryOutcome(row.delivery_outcome)
  }));
}

/**
 * Enqueue one instruction for a live session.
 *
 * An ended or lost channel *rejects* rather than silently queues. Accepting a message for a
 * dead session and letting it sit forever is the interface equivalent of dropping it, except
 * the sender believes it was sent.
 */
export async function enqueueSessionInput({
  ctx,
  channel,
  kind,
  body,
  idempotencyKey = null
}: {
  ctx: ServiceContext;
  channel: AgentSessionChannelRow;
  kind: 'instruction' | 'retry' | 'continue';
  body: string;
  idempotencyKey?: string | null;
}): Promise<AgentSessionInputRow> {
  if (!channel.session_id) {
    throw new ServiceError(
      'This channel has no attached session to address',
      'input_session_required',
      409
    );
  }
  if (channel.state === 'ended' || channel.state === 'lost') {
    throw new ServiceError(
      'This session channel has ended; queued input would never be delivered',
      'input_channel_not_live',
      409
    );
  }
  const trimmed = body.trim();
  if (!trimmed) throw new ServiceError('Input body is required', 'invalid_input', 400);
  if (trimmed.length > MAX_INPUT_BODY_LENGTH) {
    throw new ServiceError(
      `Input body exceeds ${MAX_INPUT_BODY_LENGTH} characters`,
      'input_too_large',
      413
    );
  }

  if (idempotencyKey) {
    const existing = await ctx.db.get<AgentSessionInputRow>(
      `SELECT ${INPUT_COLUMNS} FROM agent_session_inputs
         WHERE session_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
      [channel.session_id, idempotencyKey]
    );
    if (existing) return existing;
  }

  const now = nowIso();
  const id = newId();
  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await tx.run(
      `INSERT INTO agent_session_inputs (
           id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
           kind, body, idempotency_key, created_by_workspace_user_id, status,
           attempt_count, created_at, updated_at, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, 1)`,
      [
        id,
        channel.workspace_id,
        channel.project_id,
        channel.mission_id,
        channel.objective_id,
        channel.id,
        channel.session_id,
        kind,
        trimmed,
        idempotencyKey,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_input',
      entityId: id,
      operation: 'insert',
      entityRevision: 1,
      projectId: channel.project_id,
      missionId: channel.mission_id,
      objectiveId: channel.objective_id
    });
  });
  return await getInput({ ctx, inputId: id });
}

/**
 * Lease the next deliverable input for one channel.
 *
 * Reclaim of an expired lease is deliberately restricted to `queued`/`leased`. An input that
 * reached `emitted` is never re-leased, no matter how long ago its lease lapsed.
 */
export async function leaseNextInput({
  ctx,
  channelId,
  leaseSeconds = INPUT_LEASE_SECONDS
}: {
  ctx: ServiceContext;
  channelId: string;
  leaseSeconds?: number;
}): Promise<{ input: AgentSessionInputRow; leaseId: string } | null> {
  const now = nowIso();
  const candidate = await ctx.db.get<AgentSessionInputRow>(
    `SELECT ${INPUT_COLUMNS} FROM agent_session_inputs
       WHERE channel_id = ? AND workspace_id = ? AND deleted_at IS NULL
         AND (
           status = 'queued'
           OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
    [channelId, ctx.workspace.id, now]
  );
  if (!candidate) return null;

  const leaseId = newId();
  const leaseExpiresAt = addSeconds(now, leaseSeconds);
  const updated = await ctx.db.run(
    `UPDATE agent_session_inputs
        SET status = 'leased', lease_id = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, updated_at = ?, revision = ?
      WHERE id = ? AND revision = ? AND status IN ('queued', 'leased')`,
    [leaseId, leaseExpiresAt, now, candidate.revision + 1, candidate.id, candidate.revision]
  );
  if (updated.changes === 0) return null;

  await recordChange({
    ctx,
    entityType: 'agent_session_input',
    entityId: candidate.id,
    operation: 'update',
    entityRevision: candidate.revision + 1,
    projectId: candidate.project_id,
    missionId: candidate.mission_id,
    objectiveId: candidate.objective_id,
    changedFields: ['status', 'lease_id', 'lease_expires_at', 'attempt_count']
  });
  return { input: await getInput({ ctx, inputId: candidate.id }), leaseId };
}

/**
 * Mark an input as written to the harness. Terminal for retry purposes.
 *
 * `deliveryOutcome` records what the adapter honestly believes happened. Cursor's
 * turn-boundary path must pass `queued_turn_boundary` and must never call
 * {@link markInputAcknowledged} for the same row.
 */
export async function markInputEmitted({
  ctx,
  inputId,
  leaseId,
  deliveryOutcome = null
}: {
  ctx: ServiceContext;
  inputId: string;
  leaseId: string;
  deliveryOutcome?: DeliveryOutcome | null;
}): Promise<{ emitted: boolean }> {
  const now = nowIso();
  const outcome = normalizeDeliveryOutcome(deliveryOutcome);
  const updated = await ctx.db.run(
    `UPDATE agent_session_inputs
        SET status = 'emitted', emitted_at = ?, lease_expires_at = NULL,
            delivery_outcome = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND status = 'leased' AND lease_id = ?`,
    [now, outcome, now, inputId, ctx.workspace.id, leaseId]
  );
  return { emitted: updated.changes > 0 };
}

/**
 * Record a harness acknowledgement, where the harness exposes one.
 *
 * This is the only state that justifies the word "Delivered" in a user-facing surface.
 * Callers that can only schedule a future turn (Cursor `followup_message`) must not call this.
 */
export async function markInputAcknowledged({
  ctx,
  inputId
}: {
  ctx: ServiceContext;
  inputId: string;
}): Promise<{ acknowledged: boolean }> {
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_session_inputs
        SET status = 'acknowledged', acknowledged_at = ?, delivery_outcome = 'delivered',
            updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND status = 'emitted'`,
    [now, now, inputId, ctx.workspace.id]
  );
  return { acknowledged: updated.changes > 0 };
}

/**
 * Fail an input that was never emitted. An already-emitted input is never re-queued here.
 */
export async function markInputFailed({
  ctx,
  inputId,
  errorCode
}: {
  ctx: ServiceContext;
  inputId: string;
  errorCode: string;
}): Promise<{ failed: boolean }> {
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_session_inputs
        SET status = 'failed', last_error_code = ?, lease_id = NULL, lease_expires_at = NULL,
            updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND status IN ('queued', 'leased')`,
    [errorCode.slice(0, 64), now, inputId, ctx.workspace.id]
  );
  return { failed: updated.changes > 0 };
}

/** Cancellation is allowed only while an input is still queued. */
export async function cancelSessionInput({
  ctx,
  inputId
}: {
  ctx: ServiceContext;
  inputId: string;
}): Promise<{ cancelled: boolean }> {
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_session_inputs
        SET status = 'cancelled', updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND status = 'queued'`,
    [now, inputId, ctx.workspace.id]
  );
  return { cancelled: updated.changes > 0 };
}
