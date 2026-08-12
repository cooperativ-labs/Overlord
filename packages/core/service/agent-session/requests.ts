import { recordChange } from '../change-feed.js';
import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';
import { newId, nowIso } from '../util.js';

import { sizeDecisionWindow } from './pure/window.js';
import type { AgentSessionChannelRow } from './channels.js';
import { addSeconds } from './credential.js';

/**
 * Answerable requests — permissions, blocking questions, structured choices, retries.
 *
 * One model, not one table per native hook. A permission is a *kind* of request; giving it its
 * own subsystem would mean writing the release, expiry, CAS, and lease logic twice and having
 * them diverge on the third bug.
 *
 * ## The waiter lease, and why it lands in Phase 0B
 *
 * The dangerous state in this whole feature is a request that is answerable in the web app
 * while the terminal prompt is *already showing*. Both surfaces then accept an answer for the
 * same decision, and whichever loses the race has told a human something false.
 *
 * The adapter is what normally prevents this: it releases the request to the terminal, then
 * draws the native prompt. But the adapter is a local process, and local processes get killed.
 * `kill -9` between "hold the decision" and "release it" leaves an open request with nobody
 * waiting on it, and no amount of adapter-side care fixes that — the code that would do the
 * fixing is the code that just died.
 *
 * So the authority is server-side and time-bounded: a blocking waiter holds a short lease that
 * it renews by long poll. When the lease expires without renewal, the server releases the
 * request itself. That is why this lands *before* any answerable-request UI rather than
 * alongside it. Shipping the card first and the lease later would mean shipping exactly the
 * failure this design is built to prevent, and calling it a follow-up.
 */

/** How long a waiter holds its lease before the server assumes the process is gone. */
export const WAITER_LEASE_SECONDS = 20;

/** §9: 30 seconds when recently active. Any different maximum is a PM decision, not a constant. */
export const REMOTE_WINDOW_ACTIVE_SECONDS = 30;

/** §9: 30 minutes when away or unknown. */
export const REMOTE_WINDOW_AWAY_SECONDS = 30 * 60;

export const MAX_REQUEST_SUMMARY_LENGTH = 2000;
export const MAX_REQUEST_OPTIONS = 12;

export type AgentRequestKind = 'question' | 'permission' | 'choice' | 'retry';

export type AgentRequestStatus =
  | 'open'
  | 'resolved'
  | 'released_to_terminal'
  | 'expired'
  | 'cancelled';

export type AgentRequestRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  mission_id: string | null;
  objective_id: string | null;
  channel_id: string;
  session_id: string | null;
  kind: AgentRequestKind;
  native_request_id: string | null;
  native_call_id: string | null;
  summary: string;
  details_json: string;
  options_json: string;
  allows_free_text: number;
  status: AgentRequestStatus;
  resolution_json: string | null;
  resolved_by_workspace_user_id: string | null;
  resolved_at: string | null;
  expires_at: string | null;
  window_expires_at: string | null;
  window_basis: string | null;
  first_viewed_at: string | null;
  released_reason: string | null;
  waiter_lease_id: string | null;
  waiter_lease_expires_at: string | null;
  application_state: string;
  application_observed_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export type AgentRequestOption = {
  optionId: string;
  label: string;
  kind: string;
};

const REQUEST_COLUMNS = `
  id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
  kind, native_request_id, native_call_id, summary, details_json, options_json,
  allows_free_text, status, resolution_json, resolved_by_workspace_user_id, resolved_at,
  expires_at, window_expires_at, window_basis, first_viewed_at, released_reason,
  waiter_lease_id, waiter_lease_expires_at, application_state, application_observed_at,
  created_at, updated_at, revision
`;

function boundedSummary(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ServiceError('Request summary is required', 'invalid_request', 400);
  return trimmed.length <= MAX_REQUEST_SUMMARY_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_REQUEST_SUMMARY_LENGTH - 1)}…`;
}

/**
 * Options carry stable ids, and a client returns only an id.
 *
 * Never expose an option kind the effective adapter cannot apply. A greyed-out control is a
 * design problem; a control that appears to work and silently does nothing is a trust problem.
 */
function boundedOptions(options: AgentRequestOption[] | null | undefined): string {
  if (!options || options.length === 0) return '[]';
  if (options.length > MAX_REQUEST_OPTIONS) {
    throw new ServiceError(
      `A request may carry at most ${MAX_REQUEST_OPTIONS} options`,
      'invalid_request',
      400
    );
  }
  return JSON.stringify(
    options.map(option => ({
      optionId: String(option.optionId).slice(0, 64),
      label: String(option.label).slice(0, 200),
      kind: String(option.kind).slice(0, 64)
    }))
  );
}

export async function getRequest({
  ctx,
  requestId
}: {
  ctx: ServiceContext;
  requestId: string;
}): Promise<AgentRequestRow> {
  const row = await ctx.db.get<AgentRequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM agent_requests
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [requestId, ctx.workspace.id]
  );
  if (!row) throw new ServiceError('Request not found', 'request_not_found', 404);
  return row;
}

/**
 * Size the remote decision window from presence.
 *
 * A user sitting in the terminal should wait about as long as it takes to notice the agent
 * paused — seconds, not minutes. A user who walked away is the reason this feature exists at
 * all, and for them a longer window is the difference between answering from a phone and
 * coming back to a stalled agent.
 *
 * The window is always clamped below the harness's own hook timeout, so the harness never
 * aborts the hook before Overlord releases it. That ordering is not a tuning preference: if the
 * harness times out first, the adapter's release never runs and the terminal and the web app
 * both believe they own the decision.
 */
export function resolveDecisionWindow({
  now = nowIso(),
  presence,
  harnessTimeoutSeconds,
  projectWindowSeconds
}: {
  now?: string;
  presence: 'active' | 'away' | 'unknown';
  harnessTimeoutSeconds: number | null;
  projectWindowSeconds?: number | null;
}): { windowExpiresAt: string | null; windowBasis: string } {
  const sized = sizeDecisionWindow({ presence, harnessTimeoutSeconds, projectWindowSeconds });
  return { windowExpiresAt: addSeconds(now, sized.seconds), windowBasis: sized.basis };
}

export async function createRequest({
  ctx,
  channel,
  kind,
  summary,
  details = {},
  options = [],
  allowsFreeText = false,
  nativeRequestId = null,
  nativeCallId = null,
  sourceEventId = null,
  windowExpiresAt = null,
  windowBasis = null,
  expiresAt = null
}: {
  ctx: ServiceContext;
  channel: AgentSessionChannelRow;
  kind: AgentRequestKind;
  summary: string;
  details?: Record<string, unknown>;
  options?: AgentRequestOption[];
  allowsFreeText?: boolean;
  nativeRequestId?: string | null;
  nativeCallId?: string | null;
  sourceEventId?: string | null;
  windowExpiresAt?: string | null;
  windowBasis?: string | null;
  expiresAt?: string | null;
}): Promise<AgentRequestRow> {
  // Replaying the same native request must not open a second card for one decision.
  if (nativeRequestId) {
    const existing = await ctx.db.get<AgentRequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM agent_requests
         WHERE channel_id = ? AND native_request_id = ? AND deleted_at IS NULL`,
      [channel.id, nativeRequestId]
    );
    if (existing) return existing;
  }

  const now = nowIso();
  const id = newId();
  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await tx.run(
      `INSERT INTO agent_requests (
           id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
           source_event_id, kind, native_request_id, native_call_id,
           summary, details_json, formatter_version, options_json, allows_free_text,
           status, expires_at, window_expires_at, window_basis, application_state,
           created_at, updated_at, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'open', ?, ?, ?, 'pending', ?, ?, 1)`,
      [
        id,
        channel.workspace_id,
        channel.project_id,
        channel.mission_id,
        channel.objective_id,
        channel.id,
        channel.session_id,
        sourceEventId,
        kind,
        nativeRequestId,
        nativeCallId,
        boundedSummary(summary),
        JSON.stringify(details ?? {}),
        boundedOptions(options),
        allowsFreeText ? 1 : 0,
        expiresAt,
        windowExpiresAt,
        windowBasis,
        now,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_request',
      entityId: id,
      operation: 'insert',
      entityRevision: 1,
      projectId: channel.project_id,
      missionId: channel.mission_id,
      objectiveId: channel.objective_id
    });
  });
  return await getRequest({ ctx, requestId: id });
}

/**
 * Acquire or renew the waiter lease for a blocking adapter call.
 *
 * The lease id is minted by the caller's first acquisition and presented on every renewal, so
 * a second process cannot renew a lease it does not hold. A stale waiter that wakes up after
 * its lease expired and the request was released simply fails to renew and defers, which is
 * exactly the behavior wanted: the terminal already owns the decision.
 *
 * This deliberately does not touch `revision`. That counter is the compare-and-set token a
 * human card presents to `resolveRequest`, and the adapter renews this lease roughly every
 * 750ms for the whole life of the prompt. Bumping it here made the counter advance several
 * times per UI refresh, so every remote Allow/Deny lost the CAS and surfaced as a 409. A
 * renewal by the holder changes nothing a decision-maker is deciding about, so it is not a
 * revision.
 */
export async function acquireWaiterLease({
  ctx,
  requestId,
  leaseId = newId(),
  leaseSeconds = WAITER_LEASE_SECONDS
}: {
  ctx: ServiceContext;
  requestId: string;
  leaseId?: string;
  leaseSeconds?: number;
}): Promise<{ leaseId: string; leaseExpiresAt: string; request: AgentRequestRow }> {
  const now = nowIso();
  const leaseExpiresAt = addSeconds(now, leaseSeconds);
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET waiter_lease_id = ?, waiter_lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND status = 'open' AND deleted_at IS NULL
        AND (
          waiter_lease_id IS NULL
          OR waiter_lease_id = ?
          OR waiter_lease_expires_at IS NULL
          OR waiter_lease_expires_at <= ?
        )`,
    [leaseId, leaseExpiresAt, now, requestId, ctx.workspace.id, leaseId, now]
  );
  if (updated.changes === 0) {
    throw new ServiceError(
      'Request is not open, or another waiter holds its lease',
      'waiter_lease_unavailable',
      409
    );
  }
  return { leaseId, leaseExpiresAt, request: await getRequest({ ctx, requestId }) };
}

/**
 * Release an open request to the terminal.
 *
 * This is the only correct way for a decision to stop being remotely answerable while its
 * session is still alive. It is a compare-and-set on `status = 'open'`: if a human resolved the
 * request a millisecond earlier, the CAS fails, the caller re-reads, and it emits the human's
 * decision instead of a contradictory one. Exactly one of the two outcomes reaches the harness.
 */
export async function releaseRequestToTerminal({
  ctx,
  requestId,
  reason
}: {
  ctx: ServiceContext;
  requestId: string;
  reason: 'timeout' | 'local_activity' | 'policy' | 'interrupt' | 'channel_ended';
}): Promise<{ released: boolean; request: AgentRequestRow }> {
  const now = nowIso();
  const existing = await getRequest({ ctx, requestId });
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET status = 'released_to_terminal', released_reason = ?,
            waiter_lease_id = NULL, waiter_lease_expires_at = NULL,
            updated_at = ?, revision = ?
      WHERE id = ? AND status = 'open' AND revision = ?`,
    [reason, now, existing.revision + 1, requestId, existing.revision]
  );
  if (updated.changes === 0) {
    return { released: false, request: await getRequest({ ctx, requestId }) };
  }
  await recordChange({
    ctx,
    entityType: 'agent_request',
    entityId: requestId,
    operation: 'update',
    entityRevision: existing.revision + 1,
    projectId: existing.project_id,
    missionId: existing.mission_id,
    objectiveId: existing.objective_id,
    changedFields: ['status', 'released_reason']
  });
  return { released: true, request: await getRequest({ ctx, requestId }) };
}

/** A control-plane harness reported that its own TUI resolved the durable native permission. */
export async function markRequestResolvedElsewhere({
  ctx,
  requestId
}: {
  ctx: ServiceContext;
  requestId: string;
}): Promise<{ changed: boolean; request: AgentRequestRow }> {
  return releaseRequestToTerminal({ ctx, requestId, reason: 'local_activity' }).then(
    async result => {
      if (result.released) {
        await ctx.db.run(
          `UPDATE agent_requests SET released_reason = 'resolved_elsewhere' WHERE id = ?`,
          [requestId]
        );
        return { changed: true, request: await getRequest({ ctx, requestId }) };
      }
      return { changed: false, request: result.request };
    }
  );
}

/**
 * Record a human resolution under revision CAS with immutable attribution.
 *
 * The RBAC check, workspace policy ceiling, and project opt-in belong to the caller — this
 * layer will not resolve a request for an actor it cannot name, but it is not where the
 * permission-resolution permission is evaluated. That gate lives on the human REST surface,
 * which lands in Phase 2 along with the UI that needs it.
 */
export async function resolveRequest({
  ctx,
  requestId,
  resolution,
  expectedRevision
}: {
  ctx: ServiceContext;
  requestId: string;
  resolution: Record<string, unknown>;
  expectedRevision?: number;
}): Promise<{ resolved: boolean; request: AgentRequestRow }> {
  const existing = await getRequest({ ctx, requestId });
  if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
    throw new ServiceError('Request changed since it was read', 'agent_request_conflict', 409);
  }
  if (!ctx.actorWorkspaceUserId) {
    throw new ServiceError(
      'A request resolution requires an identified human actor',
      'resolver_required',
      403
    );
  }
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET status = 'resolved', resolution_json = ?, resolved_by_workspace_user_id = ?,
            resolved_at = ?, waiter_lease_id = NULL, waiter_lease_expires_at = NULL,
            updated_at = ?, revision = ?
      WHERE id = ? AND status = 'open' AND revision = ?`,
    [
      JSON.stringify(resolution),
      ctx.actorWorkspaceUserId,
      now,
      now,
      existing.revision + 1,
      requestId,
      existing.revision
    ]
  );
  if (updated.changes === 0) {
    // Lost to a release or another resolver. The caller re-reads and reports the truth rather
    // than telling the human their answer took effect.
    return { resolved: false, request: await getRequest({ ctx, requestId }) };
  }
  await recordChange({
    ctx,
    entityType: 'agent_request',
    entityId: requestId,
    operation: 'update',
    entityRevision: existing.revision + 1,
    projectId: existing.project_id,
    missionId: existing.mission_id,
    objectiveId: existing.objective_id,
    changedFields: ['status', 'resolution_json', 'resolved_by_workspace_user_id']
  });
  return { resolved: true, request: await getRequest({ ctx, requestId }) };
}

/**
 * Record whether a resolution actually took effect in the harness.
 *
 * `emitted` means the adapter wrote the decision; `applied` means a later native event proved
 * it. The UI must never infer execution from emission — Cursor's allowlist precedence hazard is
 * a live example of a harness that can accept a decision and then ignore it.
 */
export async function recordRequestApplication({
  ctx,
  requestId,
  applicationState
}: {
  ctx: ServiceContext;
  requestId: string;
  applicationState: 'emitted' | 'applied' | 'not_applied' | 'unknown';
}): Promise<void> {
  const now = nowIso();
  await ctx.db.run(
    `UPDATE agent_requests
        SET application_state = ?, application_observed_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?`,
    [applicationState, now, now, requestId, ctx.workspace.id]
  );
}

/**
 * Sweep requests whose waiter lease or decision window expired.
 *
 * This is the server-side half of the kill-safety story. A request whose waiter is gone is
 * released to the terminal, not left open, because the harness has almost certainly already
 * drawn its own prompt by the time we notice.
 */
export async function releaseExpiredRequests({
  ctx,
  now = nowIso(),
  limit = 200
}: {
  ctx: ServiceContext;
  now?: string;
  limit?: number;
}): Promise<number> {
  const rows = await ctx.db.all<{ id: string }>(
    `SELECT id FROM agent_requests
       WHERE workspace_id = ? AND status = 'open' AND deleted_at IS NULL
         AND (
           (waiter_lease_expires_at IS NOT NULL AND waiter_lease_expires_at <= ?)
           OR (window_expires_at IS NOT NULL AND window_expires_at <= ?)
         )
       ORDER BY created_at ASC
       LIMIT ?`,
    [ctx.workspace.id, now, now, limit]
  );
  let released = 0;
  for (const row of rows) {
    const result = await releaseRequestToTerminal({
      ctx,
      requestId: row.id,
      reason: 'timeout'
    });
    if (result.released) released += 1;
  }
  return released;
}

export async function cancelRequest({
  ctx,
  requestId,
  reason = 'cancelled'
}: {
  ctx: ServiceContext;
  requestId: string;
  reason?: string;
}): Promise<{ cancelled: boolean }> {
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET status = 'cancelled', released_reason = ?, waiter_lease_id = NULL,
            waiter_lease_expires_at = NULL, updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND status = 'open'`,
    [reason, now, requestId, ctx.workspace.id]
  );
  return { cancelled: updated.changes > 0 };
}
