import type { DatabaseClient } from '@overlord/database';

import { recordChange } from '../change-feed.js';
import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';
import { newId, nowIso } from '../util.js';

import {
  generateSessionChannelToken,
  hashSessionChannelToken,
  renewedExpiry,
  SESSION_CHANNEL_LEASE_SECONDS
} from './credential.js';

/**
 * Session channels — the durable identity that carries agent-session traffic.
 *
 * A channel is created *before* the agent process starts, which is the whole reason it exists
 * as its own row rather than as columns on `agent_sessions`. At launch time there is no session
 * yet: nothing has attached, no session key has been minted, and the agent may take a minute to
 * boot. Anything the harness emits in that window has to land somewhere durable and correctly
 * authorized, and it cannot land on a row that does not exist.
 *
 * So the ordering is: create channel (with its scoped credential) → launch the agent with the
 * bootstrap in its environment → the agent attaches → attach binds `session_id` and backfills
 * the pre-attach rows. The working directory participates in none of this. Cwd answers "which
 * project is this checkout?", which is not the same question as "which session is this?", and
 * treating the two as interchangeable is how an unrelated session in a shared checkout ends up
 * publishing into someone else's mission.
 */

export type AgentSessionChannelState = 'preparing' | 'online' | 'degraded' | 'ended' | 'lost';

export type AgentSessionChannelRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  mission_id: string | null;
  objective_id: string | null;
  session_id: string | null;
  execution_request_id: string | null;
  execution_target_id: string | null;
  runner_registration_id: string | null;
  launch_kind: string;
  launch_prompt_id: string | null;
  agent_identifier: string | null;
  adapter_key: string | null;
  adapter_version: string | null;
  native_session_id: string | null;
  capabilities_json: string;
  state: AgentSessionChannelState;
  credential_prefix: string | null;
  credential_hash: string | null;
  credential_expires_at: string | null;
  credential_revoked_at: string | null;
  last_heartbeat_at: string | null;
  lease_expires_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

/**
 * What the runner exports into the launch environment. The raw token appears here exactly
 * once — it is not readable back out of the channel row, because only its hash is stored.
 */
export type AgentSessionChannelBootstrap = {
  channelId: string;
  token: string;
  expiresAt: string;
  launchKind: string;
  launchPromptId: string | null;
};

const CHANNEL_COLUMNS = `
  id, workspace_id, project_id, mission_id, objective_id, session_id,
  execution_request_id, execution_target_id, runner_registration_id,
  launch_kind, launch_prompt_id, agent_identifier, adapter_key, adapter_version,
  native_session_id, capabilities_json, state,
  credential_prefix, credential_hash, credential_expires_at, credential_revoked_at,
  last_heartbeat_at, lease_expires_at, ended_at, end_reason, exit_code,
  created_at, updated_at, revision
`;

/** States in which a channel may still accept adapter traffic. */
const LIVE_STATES: readonly AgentSessionChannelState[] = ['preparing', 'online', 'degraded'];

export async function getChannel({
  ctx,
  channelId
}: {
  ctx: ServiceContext;
  channelId: string;
}): Promise<AgentSessionChannelRow> {
  const row = await ctx.db.get<AgentSessionChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM agent_session_channels
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [channelId, ctx.workspace.id]
  );
  if (!row) throw new ServiceError('Session channel not found', 'channel_not_found', 404);
  return row;
}

export async function createSessionChannel({
  ctx,
  missionId,
  objectiveId = null,
  projectId = null,
  sessionId = null,
  executionRequestId = null,
  executionTargetId = null,
  runnerRegistrationId = null,
  agentIdentifier = null,
  adapterKey = null,
  adapterVersion = null,
  launchKind = 'unknown',
  launchPromptId = null,
  capabilities = {}
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  executionRequestId?: string | null;
  executionTargetId?: string | null;
  runnerRegistrationId?: string | null;
  agentIdentifier?: string | null;
  adapterKey?: string | null;
  adapterVersion?: string | null;
  launchKind?: string;
  launchPromptId?: string | null;
  capabilities?: Record<string, unknown>;
}): Promise<{ channel: AgentSessionChannelRow; bootstrap: AgentSessionChannelBootstrap }> {
  const now = nowIso();
  const channelId = newId();
  const { secret, prefix, hash } = generateSessionChannelToken();
  const expiresAt = renewedExpiry({ now, createdAt: now });

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await tx.run(
      `INSERT INTO agent_session_channels (
           id, workspace_id, project_id, mission_id, objective_id, session_id,
           execution_request_id, execution_target_id, runner_registration_id,
           launch_kind, launch_prompt_id, agent_identifier, adapter_key, adapter_version,
           capabilities_json, state,
           credential_prefix, credential_hash, credential_algorithm, credential_expires_at,
           lease_expires_at, created_by_workspace_user_id, created_at, updated_at, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?, 'sha256', ?, ?, ?, ?, ?, 1)`,
      [
        channelId,
        ctx.workspace.id,
        projectId,
        missionId,
        objectiveId,
        sessionId,
        executionRequestId,
        executionTargetId,
        runnerRegistrationId,
        launchKind,
        launchPromptId,
        agentIdentifier,
        adapterKey,
        adapterVersion,
        JSON.stringify(capabilities),
        prefix,
        hash,
        expiresAt,
        expiresAt,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_channel',
      entityId: channelId,
      operation: 'insert',
      entityRevision: 1,
      projectId,
      missionId,
      objectiveId
    });
  });

  return {
    channel: await getChannel({ ctx, channelId }),
    bootstrap: { channelId, token: secret, expiresAt, launchKind, launchPromptId }
  };
}

/**
 * Resolve a raw channel credential to its channel, or `null`.
 *
 * This runs before any `ServiceContext` exists, so it takes a bare `DatabaseClient`: the
 * credential is what establishes scope, not the other way round. It deliberately performs no
 * workspace-membership, RBAC, or actor resolution — there is no human actor here, and a
 * channel credential that could resolve to one would be exactly the impersonation this
 * separation exists to prevent.
 *
 * Returns `null` for unknown, revoked, expired, soft-deleted, and terminal-state channels
 * alike. The caller cannot distinguish them, and should not: a 401 that explains *why* is a
 * probing oracle for a credential-bearing endpoint.
 */
export async function authenticateChannelCredential({
  db,
  rawToken,
  now = nowIso()
}: {
  db: DatabaseClient;
  rawToken: string;
  now?: string;
}): Promise<AgentSessionChannelRow | null> {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const row = await db.get<AgentSessionChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM agent_session_channels
       WHERE credential_hash = ? AND deleted_at IS NULL`,
    [hashSessionChannelToken(trimmed)]
  );
  if (!row) return null;
  if (row.credential_revoked_at !== null) return null;
  if (row.credential_expires_at !== null && row.credential_expires_at <= now) return null;
  if (!LIVE_STATES.includes(row.state)) return null;
  return row;
}

/**
 * Bind a prepared channel to the session that protocol attach just created.
 *
 * The backfill is the point. Events and requests published before attach carry a channel id and
 * no session id, because no session existed yet; this is where they acquire one. Doing it in
 * the same transaction as the binding means there is never a moment where the channel claims a
 * session its own rows do not agree with.
 *
 * `nativeSessionId` is recorded here as a correlation alias and copied onto
 * `agent_sessions.external_session_id`. It authorizes nothing: a caller holding only a native
 * id can neither bind nor rebind, which is why this function takes an already-authorized
 * context rather than a native id.
 */
export async function bindChannelToSession({
  ctx,
  channelId,
  sessionId,
  missionId,
  objectiveId,
  projectId,
  nativeSessionId = null,
  agentIdentifier = null,
  adapterKey = null,
  adapterVersion = null
}: {
  ctx: ServiceContext;
  channelId: string;
  sessionId: string;
  missionId: string;
  objectiveId: string;
  projectId: string | null;
  nativeSessionId?: string | null;
  agentIdentifier?: string | null;
  adapterKey?: string | null;
  adapterVersion?: string | null;
}): Promise<void> {
  const now = nowIso();
  const existing = await ctx.db.get<AgentSessionChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM agent_session_channels
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [channelId, ctx.workspace.id]
  );
  if (!existing) {
    // A launch bootstrap that names a channel this workspace does not own is not an error worth
    // failing attach over — the session is still perfectly valid, it simply has no channel.
    return;
  }
  if (existing.session_id !== null && existing.session_id !== sessionId) {
    throw new ServiceError(
      'Session channel is already bound to a different session',
      'channel_already_bound',
      409
    );
  }
  if (existing.mission_id !== null && existing.mission_id !== missionId) {
    throw new ServiceError(
      'Session channel belongs to a different mission',
      'channel_mission_mismatch',
      409
    );
  }

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const revision = existing.revision + 1;
    const updated = await tx.run(
      `UPDATE agent_session_channels
          SET session_id = ?,
              mission_id = COALESCE(mission_id, ?),
              objective_id = ?,
              project_id = COALESCE(project_id, ?),
              native_session_id = COALESCE(?, native_session_id),
              agent_identifier = COALESCE(?, agent_identifier),
              adapter_key = COALESCE(?, adapter_key),
              adapter_version = COALESCE(?, adapter_version),
              state = CASE WHEN state = 'preparing' THEN 'online' ELSE state END,
              updated_at = ?,
              revision = ?
        WHERE id = ? AND revision = ?`,
      [
        sessionId,
        missionId,
        objectiveId,
        projectId,
        nativeSessionId,
        agentIdentifier,
        adapterKey,
        adapterVersion,
        now,
        revision,
        channelId,
        existing.revision
      ]
    );
    if (updated.changes === 0) {
      throw new ServiceError('Session channel changed while binding', 'channel_bind_conflict', 409);
    }

    // Pre-attach rows acquire their session. Scoped by channel id, so this can never reach
    // another channel's rows even if the same session were somehow named twice.
    await tx.run(
      `UPDATE agent_session_events
          SET session_id = ?, objective_id = COALESCE(objective_id, ?), updated_at = ?
        WHERE channel_id = ? AND session_id IS NULL`,
      [sessionId, objectiveId, now, channelId]
    );
    await tx.run(
      `UPDATE agent_requests
          SET session_id = ?, objective_id = COALESCE(objective_id, ?), updated_at = ?
        WHERE channel_id = ? AND session_id IS NULL`,
      [sessionId, objectiveId, now, channelId]
    );

    if (nativeSessionId) {
      await tx.run(
        `UPDATE agent_sessions
            SET external_session_id = COALESCE(external_session_id, ?),
                updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [nativeSessionId, now, sessionId]
      );
    }

    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_channel',
      entityId: channelId,
      operation: 'update',
      entityRevision: revision,
      projectId,
      missionId,
      objectiveId,
      changedFields: ['session_id', 'state', 'native_session_id']
    });
  });
}

/**
 * Renew the channel lease and, with it, the credential's bounded expiry.
 *
 * `online` means a lease is being renewed. It does not mean the model is generating, and no
 * surface should read it that way.
 */
export async function heartbeatChannel({
  ctx,
  channelId,
  state = 'online',
  capabilities,
  nativeSessionId = null,
  adapterVersion = null
}: {
  ctx: ServiceContext;
  channelId: string;
  state?: Extract<AgentSessionChannelState, 'online' | 'degraded'>;
  capabilities?: Record<string, unknown>;
  nativeSessionId?: string | null;
  adapterVersion?: string | null;
}): Promise<{ leaseExpiresAt: string; credentialExpiresAt: string }> {
  const existing = await getChannel({ ctx, channelId });
  if (!LIVE_STATES.includes(existing.state)) {
    throw new ServiceError('Session channel is no longer live', 'channel_not_live', 409);
  }
  const now = nowIso();
  const expiresAt = renewedExpiry({ now, createdAt: existing.created_at });

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE agent_session_channels
          SET state = ?,
              last_heartbeat_at = ?,
              lease_expires_at = ?,
              credential_expires_at = ?,
              capabilities_json = COALESCE(?, capabilities_json),
              native_session_id = COALESCE(?, native_session_id),
              adapter_version = COALESCE(?, adapter_version),
              updated_at = ?,
              revision = ?
        WHERE id = ?`,
      [
        state,
        now,
        expiresAt,
        expiresAt,
        capabilities ? JSON.stringify(capabilities) : null,
        nativeSessionId,
        adapterVersion,
        now,
        revision,
        channelId
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_channel',
      entityId: channelId,
      operation: 'update',
      entityRevision: revision,
      projectId: existing.project_id,
      missionId: existing.mission_id,
      objectiveId: existing.objective_id,
      changedFields: ['state', 'last_heartbeat_at', 'lease_expires_at']
    });
  });

  return { leaseExpiresAt: expiresAt, credentialExpiresAt: expiresAt };
}

/**
 * End a channel cleanly, or record that it was lost.
 *
 * Ending revokes the credential in the same transaction, which is what makes the local cache
 * removal on the CLI side a cleanup rather than a security control: even if a cached credential
 * survives on disk, the server has already stopped honoring it.
 *
 * Open requests are released to the terminal rather than left answerable. A card that stays
 * clickable after its session is gone is worse than no card — it promises an effect that can
 * no longer happen. Queued inputs expire for the same reason.
 */
export async function endChannel({
  ctx,
  channelId,
  reason = 'session_ended',
  exitCode = null,
  state = 'ended'
}: {
  ctx: ServiceContext;
  channelId: string;
  reason?: string;
  exitCode?: number | null;
  state?: Extract<AgentSessionChannelState, 'ended' | 'lost'>;
}): Promise<void> {
  const existing = await getChannel({ ctx, channelId });
  if (!LIVE_STATES.includes(existing.state)) return;
  const now = nowIso();

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE agent_session_channels
          SET state = ?,
              ended_at = ?,
              end_reason = ?,
              exit_code = ?,
              credential_revoked_at = ?,
              lease_expires_at = NULL,
              updated_at = ?,
              revision = ?
        WHERE id = ? AND revision = ?`,
      [state, now, reason, exitCode, now, now, revision, channelId, existing.revision]
    );
    await tx.run(
      `UPDATE agent_requests
          SET status = 'released_to_terminal',
              released_reason = ?,
              waiter_lease_id = NULL,
              waiter_lease_expires_at = NULL,
              updated_at = ?,
              revision = revision + 1
        WHERE channel_id = ? AND status = 'open'`,
      [state === 'lost' ? 'channel_lost' : 'channel_ended', now, channelId]
    );
    await tx.run(
      `UPDATE agent_session_inputs
          SET status = 'expired', last_error_code = ?, updated_at = ?, revision = revision + 1
        WHERE channel_id = ? AND status IN ('queued', 'leased')`,
      [state === 'lost' ? 'channel_lost' : 'channel_ended', now, channelId]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session_channel',
      entityId: channelId,
      operation: 'update',
      entityRevision: revision,
      projectId: existing.project_id,
      missionId: existing.mission_id,
      objectiveId: existing.objective_id,
      changedFields: ['state', 'ended_at', 'end_reason', 'credential_revoked_at']
    });
  });
}

/**
 * Find a prepared channel that attach should bind when the launch bootstrap did not reach
 * the agent process (common for agent-pod / `agp` launches that strip `OVERLORD_SESSION_*`).
 *
 * Preference order: matching execution request, then matching objective, then the newest
 * unbound live channel for the mission. Only unbound rows are considered — a channel already
 * bound to another session must not be stolen by a later attach.
 */
export async function findBindableChannelForMission({
  ctx,
  missionId,
  objectiveId = null,
  executionRequestId = null
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
  executionRequestId?: string | null;
}): Promise<string | null> {
  if (executionRequestId) {
    const byRequest = await ctx.db.get<{ id: string }>(
      `SELECT id FROM agent_session_channels
         WHERE workspace_id = ? AND mission_id = ? AND execution_request_id = ?
           AND session_id IS NULL AND deleted_at IS NULL
           AND state IN ('preparing', 'online', 'degraded')
         ORDER BY created_at DESC LIMIT 1`,
      [ctx.workspace.id, missionId, executionRequestId]
    );
    if (byRequest?.id) return byRequest.id;
  }

  if (objectiveId) {
    const byObjective = await ctx.db.get<{ id: string }>(
      `SELECT id FROM agent_session_channels
         WHERE workspace_id = ? AND mission_id = ? AND objective_id = ?
           AND session_id IS NULL AND deleted_at IS NULL
           AND state IN ('preparing', 'online', 'degraded')
         ORDER BY created_at DESC LIMIT 1`,
      [ctx.workspace.id, missionId, objectiveId]
    );
    if (byObjective?.id) return byObjective.id;
  }

  const byMission = await ctx.db.get<{ id: string }>(
    `SELECT id FROM agent_session_channels
       WHERE workspace_id = ? AND mission_id = ?
         AND session_id IS NULL AND deleted_at IS NULL
         AND state IN ('preparing', 'online', 'degraded')
       ORDER BY created_at DESC LIMIT 1`,
    [ctx.workspace.id, missionId]
  );
  return byMission?.id ?? null;
}

/**
 * Sweep channels whose lease expired without a clean end.
 *
 * This is the backstop for the case the process-exit path cannot cover: a killed VM, a severed
 * network, a `kill -9` between the last heartbeat and the exit handler. Without it a channel
 * stays `online` forever and its open requests stay answerable forever.
 */
export async function expireLostChannels({
  ctx,
  now = nowIso(),
  limit = 100
}: {
  ctx: ServiceContext;
  now?: string;
  limit?: number;
}): Promise<number> {
  const rows = await ctx.db.all<{ id: string }>(
    `SELECT id FROM agent_session_channels
       WHERE workspace_id = ? AND deleted_at IS NULL
         AND state IN ('preparing', 'online', 'degraded')
         AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
       ORDER BY lease_expires_at ASC
       LIMIT ?`,
    [ctx.workspace.id, now, limit]
  );
  for (const row of rows) {
    await endChannel({ ctx, channelId: row.id, reason: 'lease_expired', state: 'lost' });
  }
  return rows.length;
}

export const AGENT_SESSION_LEASE_SECONDS = SESSION_CHANNEL_LEASE_SECONDS;
