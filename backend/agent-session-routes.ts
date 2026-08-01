import { PERMISSIONS } from '@overlord/auth';
import express, { type NextFunction, type Request, type Response, Router } from 'express';

import {
  acquireWaiterLease,
  type AgentSessionChannelRow,
  appendSessionEvent,
  authenticateChannelCredential,
  cancelSessionInput,
  createRequest,
  createSessionChannel,
  describeDeliveryOutcome,
  endChannel,
  enqueueSessionInput,
  getChannel,
  getInput,
  getRequest,
  heartbeatChannel,
  leaseNextInput,
  listSessionInputs,
  markInputAcknowledged,
  markInputEmitted,
  markInputFailed,
  markRequestResolvedElsewhere,
  recordRequestApplication,
  releaseRequestToTerminal,
  resolveRequest
} from '../packages/core/service/agent-session/index.ts';
import type { ServiceContext } from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';

import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from './db.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { callerWorkspaceMemberships } from './repository.ts';

/**
 * `/api/agent-session-channels/v1/*` — the adapter route family.
 *
 * This router exists as its own file, with its own authentication, for one reason: it is a
 * **different auth family** from every other `/api` route in this process. Everything else
 * under `/api` runs behind `requireAuthenticatedSession`, which resolves a human — a Better
 * Auth session, a USER_TOKEN, or a loopback-trusted local operator. None of those may reach
 * these endpoints, and the credential these endpoints accept may not reach any of those.
 *
 * That is enforced structurally rather than by a check inside a shared handler:
 *
 *  - This router is mounted **before** `app.use('/api', requireAuthenticatedSession)`, so a
 *    request that authenticates here never runs the human middleware, and the loopback-operator
 *    fallback in particular can never grant an adapter route to an unauthenticated caller.
 *  - {@link requireChannelCredential} accepts *only* an `osc_…` channel credential. A session
 *    cookie, a `Bearer out_…` USER_TOKEN, and a `sess_…` protocol session key are all rejected
 *    with the same opaque 401 — the point is not that a user token is *insufficient*, it is
 *    that it is not a member of this credential family at all.
 *  - Every handler operates on `req.channel`, resolved from the credential. There is no
 *    channel id in any request body or path, so a compromised adapter cannot address another
 *    channel by naming one: it can only affect the channel it authenticated as.
 *
 * The inverse guard — a channel credential attempting a human route — is handled by the human
 * middleware, which does not recognize `osc_…` at all and falls through to 401.
 *
 * What a channel credential may do here is the complete list of operations below: append
 * events, create requests on its own channel, hold and release a waiter lease, claim and
 * acknowledge inputs, heartbeat, and end the channel. Notably absent: reading mission context,
 * resolving a request (that is a *human* decision — see §9 and the resolve route that lands
 * with Phase 2's RBAC), and every ordinary mission mutation.
 */

type ChannelRequest = Request & {
  channel?: AgentSessionChannelRow;
  channelContext?: ServiceContext;
};

/** Adapter payloads are small and structured; a body this size is already a bug or an attack. */
const MAX_ADAPTER_BODY_BYTES = 64 * 1024;

function extractChannelCredential(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  return null;
}

/**
 * Resolve the caller's channel, or reject.
 *
 * Every rejection is the same opaque 401 with no detail. Distinguishing "unknown credential"
 * from "revoked" from "expired" from "channel ended" would turn this endpoint into an oracle
 * for probing credentials, and the adapter's behavior is identical in all four cases anyway:
 * stop, emit nothing, and let the harness do what it would have done without Overlord.
 */
async function requireChannelCredential(
  req: ChannelRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawToken = extractChannelCredential(req);
    if (!rawToken) {
      res.status(401).json({ error: 'Session channel credential required' });
      return;
    }
    const channel = await authenticateChannelCredential({
      db: requireDatabaseClient(),
      rawToken
    });
    if (!channel) {
      res.status(401).json({ error: 'Session channel credential required' });
      return;
    }
    const workspace = await requireDatabaseClient().get<{
      id: string;
      slug: string;
      name: string;
    }>(`SELECT id, slug, name FROM workspaces WHERE id = ? AND deleted_at IS NULL`, [
      channel.workspace_id
    ]);
    if (!workspace) {
      res.status(401).json({ error: 'Session channel credential required' });
      return;
    }
    req.channel = channel;
    // There is no human actor on this surface. `actorWorkspaceUserId` stays null, which is what
    // makes `resolveRequest` refuse an adapter-originated resolution outright rather than
    // attributing a human decision to nobody.
    req.channelContext = {
      db: requireDatabaseClient(),
      workspace,
      actorWorkspaceUserId: null,
      source: 'protocol'
    };
    next();
  } catch (err) {
    next(err);
  }
}

function channelScope(req: ChannelRequest): {
  ctx: ServiceContext;
  channel: AgentSessionChannelRow;
} {
  if (!req.channelContext || !req.channel) {
    throw new ServiceError('Channel scope missing', 'channel_scope_missing', 401);
  }
  return { ctx: req.channelContext, channel: req.channel };
}

function handle(
  fn: (req: ChannelRequest, res: Response) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void (async () => {
      try {
        const payload = await fn(req as ChannelRequest, res);
        if (!res.headersSent) res.json(payload ?? { ok: true });
      } catch (err) {
        if (err instanceof ServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        next(err);
      }
    })();
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function createAgentSessionChannelRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: MAX_ADAPTER_BODY_BYTES }));
  router.use((req, res, next) => {
    void requireChannelCredential(req as ChannelRequest, res, next);
  });

  /**
   * Who am I, and is my credential still good?
   *
   * The adapter calls this once at startup so a stale environment credential fails fast and
   * visibly, instead of failing silently on the first event an hour later.
   */
  router.get(
    '/self',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const current = await getChannel({ ctx, channelId: channel.id });
      return {
        channelId: current.id,
        state: current.state,
        bound: current.session_id !== null,
        missionId: current.mission_id,
        adapterKey: current.adapter_key,
        capabilities: JSON.parse(current.capabilities_json) as unknown,
        leaseExpiresAt: current.lease_expires_at
      };
    })
  );

  router.post(
    '/heartbeat',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const state = body.state === 'degraded' ? 'degraded' : 'online';
      const lease = await heartbeatChannel({
        ctx,
        channelId: channel.id,
        state,
        capabilities: body.capabilities ? asRecord(body.capabilities) : undefined,
        nativeSessionId: optionalString(body.nativeSessionId),
        adapterVersion: optionalString(body.adapterVersion)
      });
      return { ok: true, ...lease };
    })
  );

  /**
   * Append one or more normalized events.
   *
   * Batched because a reconnecting control-plane sidecar replays a burst, and because a
   * per-event round trip on the hook path would cost more than the events are worth. The
   * response reports which producer ids were duplicates so a producer can distinguish "you
   * already had this" from "this was rejected".
   */
  router.post(
    '/events',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const rawEvents = Array.isArray(body.events) ? body.events : [body];
      if (rawEvents.length === 0) return { accepted: [] };
      if (rawEvents.length > 100) {
        throw new ServiceError('At most 100 events per batch', 'event_batch_too_large', 413);
      }
      const accepted = [];
      for (const raw of rawEvents) {
        const event = asRecord(raw);
        accepted.push(
          await appendSessionEvent({
            ctx,
            channel,
            event: {
              producerEventId: String(event.eventId ?? ''),
              producerSequence:
                typeof event.producerSequence === 'number' ? event.producerSequence : null,
              occurredAt: optionalString(event.occurredAt),
              kind: String(event.kind ?? ''),
              severity: optionalString(event.severity),
              actionability: optionalString(event.actionability),
              nativeEvent: optionalString(event.nativeEvent),
              nativeTurnId: optionalString(event.nativeTurnId),
              nativeCallId: optionalString(event.nativeCallId),
              subagentId: optionalString(event.subagentId),
              correlationId: optionalString(event.correlationId),
              origin: optionalString(event.origin),
              summary: optionalString(event.summary),
              payload: event.payload ? asRecord(event.payload) : null
            }
          })
        );
      }
      return { accepted };
    })
  );

  router.post(
    '/requests',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const kind = String(body.kind ?? 'question');
      if (kind !== 'question' && kind !== 'permission' && kind !== 'choice' && kind !== 'retry') {
        throw new ServiceError('Unknown request kind', 'invalid_request', 400);
      }
      const request = await createRequest({
        ctx,
        channel,
        kind,
        summary: String(body.summary ?? ''),
        details: body.details ? asRecord(body.details) : {},
        options: Array.isArray(body.options)
          ? (body.options as { optionId: string; label: string; kind: string }[])
          : [],
        allowsFreeText: body.allowsFreeText === true,
        nativeRequestId: optionalString(body.nativeRequestId),
        nativeCallId: optionalString(body.nativeCallId),
        windowExpiresAt: optionalString(body.windowExpiresAt),
        windowBasis: optionalString(body.windowBasis)
      });
      return {
        requestId: request.id,
        status: request.status,
        revision: request.revision,
        windowExpiresAt: request.window_expires_at
      };
    })
  );

  router.get(
    '/requests/:id',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const request = await getRequest({ ctx, requestId: req.params.id });
      if (request.channel_id !== channel.id) {
        throw new ServiceError('Request not found', 'request_not_found', 404);
      }
      return requestDto(request);
    })
  );

  /**
   * Acquire or renew the waiter lease while blocking on a decision.
   *
   * The adapter renews on every long-poll turn. If it stops — because it was interrupted,
   * killed, or lost the network — the lease lapses and the server releases the request to the
   * terminal on its own. That is the whole safety property: the code that guarantees a released
   * decision is not the code that can be killed.
   */
  router.post(
    '/requests/:id/lease',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const request = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_requests WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!request || request.channel_id !== channel.id) {
        throw new ServiceError('Request not found', 'request_not_found', 404);
      }
      const lease = await acquireWaiterLease({
        ctx,
        requestId: req.params.id,
        ...(optionalString(body.leaseId) ? { leaseId: optionalString(body.leaseId) as string } : {})
      });
      return {
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.leaseExpiresAt,
        status: lease.request.status,
        revision: lease.request.revision,
        resolution: lease.request.resolution_json
          ? (JSON.parse(lease.request.resolution_json) as unknown)
          : null
      };
    })
  );

  router.post(
    '/requests/:id/release',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const request = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_requests WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!request || request.channel_id !== channel.id) {
        throw new ServiceError('Request not found', 'request_not_found', 404);
      }
      const reason = String(body.reason ?? 'timeout');
      const allowed = ['timeout', 'local_activity', 'policy', 'interrupt'] as const;
      const result = await releaseRequestToTerminal({
        ctx,
        requestId: req.params.id,
        reason: (allowed as readonly string[]).includes(reason)
          ? (reason as (typeof allowed)[number])
          : 'timeout'
      });
      // A failed release means a human resolved first. The adapter re-reads and emits their
      // decision instead — never a contradictory one.
      return {
        released: result.released,
        status: result.request.status,
        resolution: result.request.resolution_json
          ? (JSON.parse(result.request.resolution_json) as unknown)
          : null
      };
    })
  );

  router.post(
    '/requests/:id/application',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const request = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_requests WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!request || request.channel_id !== channel.id) {
        throw new ServiceError('Request not found', 'request_not_found', 404);
      }
      const state = String(body.applicationState ?? 'unknown');
      const allowed = ['emitted', 'applied', 'not_applied', 'unknown'] as const;
      await recordRequestApplication({
        ctx,
        requestId: req.params.id,
        applicationState: (allowed as readonly string[]).includes(state)
          ? (state as (typeof allowed)[number])
          : 'unknown'
      });
      return { ok: true };
    })
  );

  router.post(
    '/requests/:id/resolved-elsewhere',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const request = await getRequest({ ctx, requestId: req.params.id });
      if (request.channel_id !== channel.id) {
        throw new ServiceError('Request not found', 'request_not_found', 404);
      }
      const result = await markRequestResolvedElsewhere({ ctx, requestId: request.id });
      return {
        changed: result.changed,
        status: result.request.status,
        releasedReason: result.request.released_reason
      };
    })
  );

  router.post(
    '/inputs/claim',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const leased = await leaseNextInput({ ctx, channelId: channel.id });
      if (!leased) return { input: null };
      return {
        input: {
          id: leased.input.id,
          kind: leased.input.kind,
          body: leased.input.body,
          leaseId: leased.leaseId,
          leaseExpiresAt: leased.input.lease_expires_at
        }
      };
    })
  );

  router.post(
    '/inputs/:id/emitted',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const row = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_session_inputs WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!row || row.channel_id !== channel.id) {
        throw new ServiceError('Session input not found', 'input_not_found', 404);
      }
      const leaseId = optionalString(body.leaseId);
      if (!leaseId) throw new ServiceError('leaseId is required', 'invalid_input', 400);
      const deliveryOutcome = optionalString(body.deliveryOutcome);
      return await markInputEmitted({
        ctx,
        inputId: req.params.id,
        leaseId,
        deliveryOutcome:
          deliveryOutcome === 'delivered' ||
          deliveryOutcome === 'queued_turn_boundary' ||
          deliveryOutcome === 'queued_next_turn' ||
          deliveryOutcome === 'unsupported'
            ? deliveryOutcome
            : null
      });
    })
  );

  router.post(
    '/inputs/:id/acknowledged',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const row = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_session_inputs WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!row || row.channel_id !== channel.id) {
        throw new ServiceError('Session input not found', 'input_not_found', 404);
      }
      return await markInputAcknowledged({ ctx, inputId: req.params.id });
    })
  );

  router.post(
    '/inputs/:id/failed',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      const row = await ctx.db.get<{ channel_id: string }>(
        `SELECT channel_id FROM agent_session_inputs WHERE id = ? AND workspace_id = ?`,
        [req.params.id, ctx.workspace.id]
      );
      if (!row || row.channel_id !== channel.id) {
        throw new ServiceError('Session input not found', 'input_not_found', 404);
      }
      return await markInputFailed({
        ctx,
        inputId: req.params.id,
        errorCode: optionalString(body.errorCode) ?? 'adapter_error'
      });
    })
  );

  /**
   * Clean process exit.
   *
   * Ending revokes the credential in the same transaction and releases every open request, so
   * a terminated session cannot leave a card answerable. The lease sweep covers the case where
   * this never arrives.
   */
  router.post(
    '/end',
    handle(async req => {
      const { ctx, channel } = channelScope(req);
      const body = asRecord(req.body);
      await endChannel({
        ctx,
        channelId: channel.id,
        reason: optionalString(body.reason) ?? 'session_ended',
        exitCode: typeof body.exitCode === 'number' ? body.exitCode : null
      });
      return { ok: true };
    })
  );

  return router;
}

function requestDto(request: Awaited<ReturnType<typeof getRequest>>): Record<string, unknown> {
  return {
    id: request.id,
    channelId: request.channel_id,
    missionId: request.mission_id,
    objectiveId: request.objective_id,
    kind: request.kind,
    summary: request.summary,
    options: JSON.parse(request.options_json) as unknown,
    allowsFreeText: request.allows_free_text === 1,
    status: request.status,
    resolution: request.resolution_json ? (JSON.parse(request.resolution_json) as unknown) : null,
    revision: request.revision,
    windowExpiresAt: request.window_expires_at,
    releasedReason: request.released_reason,
    applicationState: request.application_state,
    createdAt: request.created_at
  };
}

/** Ordinary-human request inbox. This router is mounted behind normal API authentication. */
export function createAgentRequestHumanRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '32kb' }));

  router.get(
    '/',
    handle(async () => {
      const client = requireDatabaseClient();
      const memberships = await callerWorkspaceMemberships(client);
      const authorized: { workspaceId: string; workspaceUserId: string }[] = [];
      for (const membership of memberships) {
        try {
          const workspaceUserId = await requireWorkspacePermission({
            workspaceId: membership.workspaceId,
            permission: PERMISSIONS.SESSION_READ,
            db: client,
            notFoundMessage: 'Request not found'
          });
          authorized.push({ workspaceId: membership.workspaceId, workspaceUserId });
        } catch {
          // A membership without request-read permission must not make another workspace fail.
        }
      }
      if (authorized.length === 0) return { requests: [] };
      const placeholders = authorized.map(() => '?').join(', ');
      const rows = await client.all<Awaited<ReturnType<typeof getRequest>>>(
        `SELECT ${REQUEST_COLUMNS_FOR_ROUTE} FROM agent_requests
          WHERE workspace_id IN (${placeholders}) AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 200`,
        authorized.map(entry => entry.workspaceId)
      );
      return { requests: rows.map(requestDto) };
    })
  );

  router.post(
    '/:id/resolve',
    handle(async req => {
      const client = requireDatabaseClient();
      const row = await client.get<{ workspace_id: string }>(
        `SELECT workspace_id FROM agent_requests WHERE id = ? AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!row) throw new ServiceError('Request not found', 'request_not_found', 404);
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId: row.workspace_id,
        permission: PERMISSIONS.SESSION_ATTACH,
        db: client,
        notFoundMessage: 'Request not found'
      });
      const ctx = await buildWebappServiceContextForWorkspace(
        row.workspace_id,
        client,
        workspaceUserId
      );
      const body = asRecord(req.body);
      if (typeof body.expectedRevision !== 'number') {
        throw new ServiceError('expectedRevision is required', 'agent_request_conflict', 409);
      }
      const result = await resolveRequest({
        ctx,
        requestId: req.params.id,
        resolution: body.resolution ? asRecord(body.resolution) : {},
        expectedRevision: body.expectedRevision
      });
      return { resolved: result.resolved, request: requestDto(result.request) };
    })
  );
  return router;
}

function inputDto(input: Awaited<ReturnType<typeof getInput>>): Record<string, unknown> {
  return {
    id: input.id,
    channelId: input.channel_id,
    missionId: input.mission_id,
    objectiveId: input.objective_id,
    sessionId: input.session_id,
    kind: input.kind,
    body: input.body,
    status: input.status,
    deliveryOutcome: input.delivery_outcome,
    /** Honest UI label — Cursor turn-boundary must read "Queued (turn boundary)". */
    deliveryLabel: describeDeliveryOutcome({
      status: input.status,
      deliveryOutcome: input.delivery_outcome
    }),
    attemptCount: input.attempt_count,
    lastErrorCode: input.last_error_code,
    emittedAt: input.emitted_at,
    acknowledgedAt: input.acknowledged_at,
    createdAt: input.created_at,
    revision: input.revision
  };
}

/**
 * Human session-input surface: enqueue, list, and cancel follow-up instructions.
 *
 * Mounted behind ordinary API authentication. A channel credential cannot reach these
 * routes, and a human token cannot claim or emit on the adapter family — the same
 * separation Phase 2 established for requests.
 */
export function createAgentSessionInputHumanRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '64kb' }));

  router.get(
    '/',
    handle(async req => {
      const missionId = typeof req.query.missionId === 'string' ? req.query.missionId : null;
      if (!missionId) throw new ServiceError('missionId is required', 'invalid_input', 400);
      const client = requireDatabaseClient();
      const memberships = await callerWorkspaceMemberships(client);
      if (memberships.length === 0) return { inputs: [] };
      const placeholders = memberships.map(() => '?').join(', ');
      const mission = await client.get<{ id: string; workspace_id: string }>(
        `SELECT id, workspace_id FROM missions
           WHERE (id = ? OR display_id = ?) AND deleted_at IS NULL
             AND workspace_id IN (${placeholders})`,
        [missionId, missionId, ...memberships.map(entry => entry.workspaceId)]
      );
      if (!mission) throw new ServiceError('Mission not found', 'mission_not_found', 404);
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId: mission.workspace_id,
        permission: PERMISSIONS.SESSION_READ,
        db: client,
        notFoundMessage: 'Mission not found'
      });
      const ctx = await buildWebappServiceContextForWorkspace(
        mission.workspace_id,
        client,
        workspaceUserId
      );
      const inputs = await listSessionInputs({ ctx, missionId: mission.id });
      const liveChannel = await client.get<{ id: string }>(
        `SELECT id FROM agent_session_channels
           WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
             AND state IN ('preparing', 'online', 'degraded')
           ORDER BY created_at DESC LIMIT 1`,
        [mission.id, mission.workspace_id]
      );
      return {
        liveChannelId: liveChannel?.id ?? null,
        inputs: inputs.map(inputDto)
      };
    })
  );

  router.post(
    '/',
    handle(async req => {
      const body = asRecord(req.body);
      const channelId = optionalString(body.channelId);
      const text = optionalString(body.body);
      const kind =
        body.kind === 'retry' || body.kind === 'continue' || body.kind === 'instruction'
          ? body.kind
          : 'instruction';
      if (!channelId || !text) {
        throw new ServiceError('channelId and body are required', 'invalid_input', 400);
      }
      const client = requireDatabaseClient();
      const channelRow = await client.get<{ workspace_id: string }>(
        `SELECT workspace_id FROM agent_session_channels WHERE id = ? AND deleted_at IS NULL`,
        [channelId]
      );
      if (!channelRow)
        throw new ServiceError('Session channel not found', 'channel_not_found', 404);
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId: channelRow.workspace_id,
        permission: PERMISSIONS.SESSION_ATTACH,
        db: client,
        notFoundMessage: 'Session channel not found'
      });
      const ctx = await buildWebappServiceContextForWorkspace(
        channelRow.workspace_id,
        client,
        workspaceUserId
      );
      const channel = await getChannel({ ctx, channelId });
      const input = await enqueueSessionInput({
        ctx,
        channel,
        kind,
        body: text,
        idempotencyKey: optionalString(body.idempotencyKey)
      });
      return { input: inputDto(input) };
    })
  );

  router.post(
    '/:id/cancel',
    handle(async req => {
      const client = requireDatabaseClient();
      const row = await client.get<{ workspace_id: string }>(
        `SELECT workspace_id FROM agent_session_inputs WHERE id = ? AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!row) throw new ServiceError('Session input not found', 'input_not_found', 404);
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId: row.workspace_id,
        permission: PERMISSIONS.SESSION_ATTACH,
        db: client,
        notFoundMessage: 'Session input not found'
      });
      const ctx = await buildWebappServiceContextForWorkspace(
        row.workspace_id,
        client,
        workspaceUserId
      );
      const result = await cancelSessionInput({ ctx, inputId: req.params.id });
      const input = await getInput({ ctx, inputId: req.params.id });
      return { cancelled: result.cancelled, input: inputDto(input) };
    })
  );

  return router;
}

const REQUEST_COLUMNS_FOR_ROUTE = `
  id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
  kind, native_request_id, native_call_id, summary, details_json, options_json,
  allows_free_text, status, resolution_json, resolved_by_workspace_user_id, resolved_at,
  expires_at, window_expires_at, window_basis, first_viewed_at, released_reason,
  waiter_lease_id, waiter_lease_expires_at, application_state, application_observed_at,
  created_at, updated_at, revision
`;

export const AGENT_SESSION_CHANNEL_ROUTE_PREFIX = '/api/agent-session-channels/v1';

/**
 * Prepare a session channel for a manual `ovld launch`.
 *
 * The queued path gets its channel at the `launching` transition, where the backend already
 * has the request in hand. A manual launch has no equivalent moment, so the CLI asks for one
 * explicitly — and it asks over ordinary human authentication, because the thing being
 * authorized is the *person* starting an agent for this mission, not the agent itself.
 *
 * The raw credential is returned exactly once, in this response. It is not readable back
 * afterwards: the channel row stores only its hash.
 */
export async function prepareMissionSessionChannel(
  missionRef: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const payload = asRecord(body);
  const client = requireDatabaseClient();

  // Resolve the mission inside the caller's *own* memberships rather than whichever workspace
  // they currently have active. A mission can live in a secondary workspace, and preparing its
  // channel under the active workspace's actor would attribute the channel — and every
  // `entity_changes` row it writes — to the wrong tenant.
  const memberships = await callerWorkspaceMemberships(client);
  if (memberships.length === 0) {
    throw new ServiceError('Mission not found', 'mission_not_found', 404);
  }
  const placeholders = memberships.map(() => '?').join(', ');
  const mission = await client.get<{ id: string; project_id: string; workspace_id: string }>(
    `SELECT id, project_id, workspace_id FROM missions
       WHERE (id = ? OR display_id = ?) AND deleted_at IS NULL
         AND workspace_id IN (${placeholders})`,
    [missionRef, missionRef, ...memberships.map(entry => entry.workspaceId)]
  );
  if (!mission) throw new ServiceError('Mission not found', 'mission_not_found', 404);

  // Authorize against the mission's *own* workspace. The route-level `requires` gate evaluates
  // the caller's active workspace, which is the wrong tenant whenever the mission lives in a
  // secondary one — so the real check is here, where the owning workspace is known.
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: mission.workspace_id,
    permission: PERMISSIONS.SESSION_ATTACH,
    db: client,
    notFoundMessage: 'Mission not found'
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    mission.workspace_id,
    client,
    workspaceUserId
  );
  const { bootstrap } = await createSessionChannel({
    ctx,
    missionId: mission.id,
    projectId: mission.project_id,
    objectiveId: optionalString(payload.objectiveId),
    executionTargetId: optionalString(payload.executionTargetId),
    agentIdentifier: optionalString(payload.agent),
    adapterKey: optionalString(payload.agent),
    launchKind: 'manual'
  });
  return {
    channelId: bootstrap.channelId,
    token: bootstrap.token,
    expiresAt: bootstrap.expiresAt,
    launchKind: bootstrap.launchKind
  };
}
