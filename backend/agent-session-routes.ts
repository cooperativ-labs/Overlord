import { PERMISSIONS } from '@overlord/auth';
import { type AgentRequestDeliveryDto, missionDisplayIdFromObjectiveRef } from '@overlord/contract';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  Router
} from 'express';

import {
  acquireWaiterLease,
  AGENT_REQUEST_KINDS,
  type AgentSessionChannelRow,
  ANSWER_DELIVERY_DEADLINE_MS,
  answerDeliveryOutcomeFromResult,
  type AnswerDeliveryStage,
  answerOperationId,
  answerTextFromResolution,
  appendSessionEvent,
  APPLICATION_STATES,
  authenticateChannelCredential,
  beginAnswerRedelivery,
  createRequest,
  DELIVERY_OUTCOMES,
  describeDeliveryOutcome,
  endChannel,
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
  readAnswerDelivery,
  readRequestDismissals,
  recordAnswerDeliveryOutcome,
  recordRequestApplication,
  RELEASE_REASONS,
  type ReleaseReason,
  releaseRequestToTerminal,
  resolveRequest,
  setRequestDismissal
} from '../packages/core/service/agent-session/index.ts';
import { resolveObjectiveRef, type ServiceContext } from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';
import { asRecord } from '../packages/core/service/execution-requests.ts';
import { resolveLatchSessionForAgentSession } from '../packages/core/service/latch-provider-session.ts';
import { resolveDefaultLocalTargetProvider } from '../packages/core/service/local-target/default-registry.ts';
import { cancelQueuedLocalTargetMutation } from '../packages/core/service/local-target-mutations.ts';
import { getProjectExecutionTargetSelection } from '../packages/core/service/project-execution-target.ts';

import { optionalString, queryString } from './http/query.ts';
import { deferMalformedBody } from './http/request-validation.ts';
import { asyncRoute } from './http/route-handler.ts';
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

/**
 * Every error, `ServiceError` included, is forwarded to the app's error handler
 * so this surface renders the same envelope (including `details`) as every other
 * route.
 */
function handle(fn: (req: ChannelRequest, res: Response) => Promise<unknown>): RequestHandler {
  return asyncRoute(async (req, res) => {
    const payload = await fn(req as ChannelRequest, res);
    if (!res.headersSent) res.json(payload ?? { ok: true });
  });
}

function isAllowedValue<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Adapters may not send `channel_ended`; that reason is produced internally when a channel ends. */
const ADAPTER_RELEASE_REASONS = RELEASE_REASONS.filter(
  (reason): reason is Exclude<ReleaseReason, 'channel_ended'> => reason !== 'channel_ended'
);

export function createAgentSessionChannelRouter(): Router {
  const router = Router();
  router.use(deferMalformedBody(express.json({ limit: MAX_ADAPTER_BODY_BYTES })));
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
      if (!isAllowedValue(kind, AGENT_REQUEST_KINDS)) {
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
      const result = await releaseRequestToTerminal({
        ctx,
        requestId: req.params.id,
        reason: isAllowedValue(reason, ADAPTER_RELEASE_REASONS) ? reason : 'timeout'
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
      await recordRequestApplication({
        ctx,
        requestId: req.params.id,
        applicationState: isAllowedValue(state, APPLICATION_STATES) ? state : 'unknown'
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
          deliveryOutcome && isAllowedValue(deliveryOutcome, DELIVERY_OUTCOMES)
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
    resolvedAt: request.resolved_at,
    createdAt: request.created_at
  };
}

type RequestRow = Awaited<ReturnType<typeof getRequest>>;

/**
 * How long a resolve or redelivery call waits for the runner before answering "still sending".
 * An object so a test can shorten the wait; production never writes it.
 */
export const answerDeliveryTiming = { waitMs: 25_000 };

type AnswerRoute =
  | {
      ok: true;
      latch: NonNullable<Awaited<ReturnType<typeof resolveLatchSessionForAgentSession>>>;
      target: Awaited<
        ReturnType<typeof getProjectExecutionTargetSelection>
      >['eligibleTargets'][number];
    }
  | {
      ok: false;
      reason: 'no_latch_session' | 'latch_session_exited' | 'target_offline';
      sessionState: string | null;
    };

/**
 * Where an answer for this request would go right now: the Latch session recorded for the
 * agent session that asked, on a reachable execution target. `exited` is a confirmed end
 * (ADR 0064) and never receives an answer. `lost` is only missing contact, so it is still
 * routable when its target is reachable: Latch then gives the definitive answer.
 */
async function answerRoute(ctx: ServiceContext, request: RequestRow): Promise<AnswerRoute> {
  if (!request.session_id || !request.project_id) {
    return { ok: false, reason: 'no_latch_session', sessionState: null };
  }
  const latch = await resolveLatchSessionForAgentSession({ ctx, sessionId: request.session_id });
  if (!latch) return { ok: false, reason: 'no_latch_session', sessionState: null };
  if (['exited', 'unavailable'].includes(latch.lastObservedState)) {
    return { ok: false, reason: 'latch_session_exited', sessionState: latch.lastObservedState };
  }
  const selection = await getProjectExecutionTargetSelection({
    ctx,
    projectId: request.project_id
  });
  const target = selection.eligibleTargets.find(
    candidate => candidate.executionTargetId === latch.targetId
  );
  if (!target?.reachable) {
    return { ok: false, reason: 'target_offline', sessionState: latch.lastObservedState };
  }
  return { ok: true, latch, target };
}

const ROUTE_FAILURE_MESSAGES: Record<Exclude<AnswerRoute, { ok: true }>['reason'], string> = {
  no_latch_session: 'This question has no terminal session that can receive an answer.',
  latch_session_exited:
    'The terminal session has ended, so it cannot receive an answer. Restart the objective to continue.',
  target_offline:
    'The execution machine is offline. Bring its runner back online, then send the answer again.'
};

/** The stage of a recorded answer's delivery (ADR 0065). Null when no answer is recorded. */
async function answerDeliveryStage(
  ctx: ServiceContext,
  request: RequestRow,
  attempt: number
): Promise<AnswerDeliveryStage | null> {
  if (request.status !== 'resolved') return null;
  if (request.kind !== 'question' && request.kind !== 'choice') return null;
  switch (request.application_state) {
    case 'applied':
      return 'confirmed';
    case 'unknown':
      return 'unconfirmed';
    case 'not_applied':
      return 'failed';
    case 'emitted': {
      const job = await ctx.db.get<{ status: string }>(
        `SELECT status FROM execution_requests
          WHERE workspace_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
        [ctx.workspace.id, answerOperationId(request.id, attempt)]
      );
      if (!job) return 'recorded';
      return job.status === 'queued' ? 'queued' : 'dispatched';
    }
    default:
      return null;
  }
}

async function requestDelivery(
  ctx: ServiceContext,
  request: RequestRow
): Promise<AgentRequestDeliveryDto> {
  const state = APPLICATION_STATES.includes(request.application_state as never)
    ? (request.application_state as AgentRequestDeliveryDto['state'])
    : null;
  const record = readAnswerDelivery(request);
  const stage = await answerDeliveryStage(ctx, request, record.attempt);
  const base = {
    state,
    observedAt: request.application_observed_at,
    stage,
    attempt: stage === null ? null : record.attempt,
    failureCode: stage === 'failed' || stage === 'unconfirmed' ? record.failureCode : null,
    failureMessage: stage === 'failed' || stage === 'unconfirmed' ? record.failureMessage : null,
    canRedeliver: false,
    confirmationRequired: stage === 'unconfirmed',
    sessionState: null as string | null
  };
  if (request.status !== 'open') {
    if (stage !== 'failed' && stage !== 'unconfirmed') {
      return { mode: 'read_only', reason: 'request_closed', ...base };
    }
    // A failed or unconfirmed answer can be sent again only while its session can still
    // receive one; otherwise the client is told why not instead of offering a dead button.
    const route = await answerRoute(ctx, request);
    return {
      mode: 'read_only',
      reason: 'request_closed',
      ...base,
      canRedeliver: route.ok,
      sessionState: route.ok ? route.latch.lastObservedState : route.sessionState,
      ...(route.ok || stage !== 'failed'
        ? {}
        : {
            failureCode:
              route.reason === 'latch_session_exited' ? 'session_ended' : base.failureCode,
            failureMessage:
              route.reason === 'latch_session_exited'
                ? ROUTE_FAILURE_MESSAGES.latch_session_exited
                : base.failureMessage
          })
    };
  }
  const route = await answerRoute(ctx, request);
  if (!route.ok) {
    return { mode: 'read_only', reason: route.reason, ...base, sessionState: route.sessionState };
  }
  return { mode: 'latch', reason: null, ...base, sessionState: route.latch.lastObservedState };
}

type RequestDismissals = Awaited<ReturnType<typeof readRequestDismissals>>;

/**
 * The calling member's dismissal of the request's current revision (ADR 0063). Always present on
 * human reads: `dismissed` false with null fields when the caller has not dismissed it.
 */
function dismissalDto(
  request: Awaited<ReturnType<typeof getRequest>>,
  dismissals: RequestDismissals
): Record<string, unknown> {
  const dismissal = dismissals.get(request.id);
  return {
    dismissed: dismissal !== undefined,
    dismissedAt: dismissal?.dismissedAt ?? null
  };
}

async function humanRequestDto(
  ctx: ServiceContext,
  request: Awaited<ReturnType<typeof getRequest>>,
  dismissals?: RequestDismissals
): Promise<Record<string, unknown>> {
  const callerDismissals =
    dismissals ??
    (await readRequestDismissals({
      db: ctx.db,
      workspaceUserIds: ctx.actorWorkspaceUserId ? [ctx.actorWorkspaceUserId] : [],
      requests: [request]
    }));
  return {
    ...requestDto(request),
    ...dismissalDto(request, callerDismissals),
    delivery: await requestDelivery(ctx, request)
  };
}

async function humanRequestDtos(
  ctx: ServiceContext,
  requests: Array<Awaited<ReturnType<typeof getRequest>>>
): Promise<Record<string, unknown>[]> {
  const dismissals = await readRequestDismissals({
    db: ctx.db,
    workspaceUserIds: ctx.actorWorkspaceUserId ? [ctx.actorWorkspaceUserId] : [],
    requests
  });
  return await Promise.all(requests.map(request => humanRequestDto(ctx, request, dismissals)));
}

function requestOptions(request: Awaited<ReturnType<typeof getRequest>>): Array<{
  optionId: string;
  label: string;
  kind: string;
}> {
  try {
    const parsed = JSON.parse(request.options_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (option): option is { optionId: string; label: string; kind: string } =>
            option !== null &&
            typeof option === 'object' &&
            typeof (option as { optionId?: unknown }).optionId === 'string' &&
            typeof (option as { label?: unknown }).label === 'string' &&
            typeof (option as { kind?: unknown }).kind === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

function validateQuestionResolution({
  request,
  resolution
}: {
  request: Awaited<ReturnType<typeof getRequest>>;
  resolution: Record<string, unknown>;
}): { text: string; optionId: string | null } {
  const text = typeof resolution.text === 'string' ? resolution.text.trim() : '';
  const optionId = typeof resolution.optionId === 'string' ? resolution.optionId.trim() : '';
  if (text && request.allows_free_text !== 1) {
    throw new ServiceError(
      'This request does not allow free-text answers',
      'invalid_resolution',
      400
    );
  }
  if (optionId && !requestOptions(request).some(option => option.optionId === optionId)) {
    throw new ServiceError('Unknown request option', 'invalid_resolution', 400);
  }
  if (!text && !optionId) {
    throw new ServiceError('An answer text or optionId is required', 'invalid_resolution', 400);
  }
  return { text, optionId: optionId || null };
}

/**
 * Send one delivery attempt of a recorded answer through the execution target's runner and
 * record what became of it (ADR 0065).
 *
 * The call waits a bounded time. A job no runner has taken by then is withdrawn, which makes
 * "the machine did not pick it up" a definitive failure instead of an answer that arrives
 * whenever the runner next wakes. A job a runner already holds is left alone: its report
 * arrives through the queue's completion hook and reaches open clients as an entity change.
 */
async function deliverQuestionAnswer({
  ctx,
  request,
  attempt,
  previousAttempt = null
}: {
  ctx: ServiceContext;
  request: RequestRow;
  attempt: number;
  /** An earlier attempt left unconfirmed; the runner checks its Latch receipt before sending. */
  previousAttempt?: number | null;
}): Promise<void> {
  const route = await answerRoute(ctx, request);
  if (!route.ok || !request.project_id) {
    const reason = route.ok ? 'no_latch_session' : route.reason;
    await recordAnswerDeliveryOutcome({
      ctx,
      requestId: request.id,
      attempt,
      outcome: {
        state: 'not_applied',
        failureCode: reason === 'latch_session_exited' ? 'session_ended' : 'not_dispatched',
        failureMessage: ROUTE_FAILURE_MESSAGES[reason]
      }
    });
    return;
  }
  const provider = resolveDefaultLocalTargetProvider({
    target: {
      executionTargetId: route.target.executionTargetId,
      type: route.target.type,
      deviceLabel: route.target.deviceLabel,
      reachable: route.target.reachable
    },
    options: {
      callerExecutionTargetId: null,
      runnerQueue: {
        ctx,
        projectId: request.project_id,
        missionId: request.mission_id,
        writeTimeoutMs: answerDeliveryTiming.waitMs
      }
    }
  });
  const result = await provider.sendLatchMessage({
    providerSessionId: route.latch.providerSessionId,
    operationId: answerOperationId(request.id, attempt),
    text: answerTextFromResolution(request),
    notAfter: new Date(Date.now() + ANSWER_DELIVERY_DEADLINE_MS).toISOString(),
    ...(previousAttempt === null
      ? {}
      : { previousOperationId: answerOperationId(request.id, previousAttempt) })
  });
  const outcome = answerDeliveryOutcomeFromResult(result);
  if (outcome) {
    await recordAnswerDeliveryOutcome({ ctx, requestId: request.id, attempt, outcome });
    return;
  }
  const details =
    !result.ok && result.details && typeof result.details === 'object'
      ? (result.details as Record<string, unknown>)
      : {};
  if (typeof details.executionRequestId === 'string') {
    await cancelQueuedLocalTargetMutation({ ctx, requestId: details.executionRequestId });
  }
}

/**
 * Resolve a mission the caller can actually see, then return that mission's requests.
 *
 * The mission is looked up across the caller's memberships rather than their currently-active
 * workspace: a mission can live in a secondary workspace, and authorizing against the active
 * one would check the wrong tenant. `session:read` is then required in the mission's own
 * workspace before a single row is read.
 */
/** The only status filter a paged read accepts today. */
const PAGED_REQUEST_STATUSES = ['open'] as const;
type PagedRequestStatus = (typeof PAGED_REQUEST_STATUSES)[number];
const DEFAULT_REQUEST_PAGE_LIMIT = 100;
const MAX_REQUEST_PAGE_LIMIT = 200;
const MAX_REQUEST_CURSOR_LENGTH = 512;
const ISO_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;

/**
 * A paged read of a mission's requests (`status`, `limit` or `cursor` supplied).
 *
 * Absent (`null`) means the legacy read: newest first, at most 200, no `page` member.
 */
export type AgentRequestPageQuery = {
  status: PagedRequestStatus | null;
  limit: number;
  cursor: string | null;
};

type AgentRequestCursor = {
  v: 1;
  /** Resolved mission UUID the cursor was issued for. */
  m: string;
  /** Resolved objective UUID, or null for the whole mission. */
  o: string | null;
  s: PagedRequestStatus | null;
  /** `created_at` of the last row returned (ISO-8601, native database precision, UTC). */
  t: string;
  /** `id` of the last row returned, the tie-breaker for identical timestamps. */
  i: string;
};

function invalidPageInput(message: string): ServiceError {
  return new ServiceError(message, 'invalid_input', 400);
}

/** Parse the opt-in paging parameters. Returns null for the legacy unpaged read. */
export function parseAgentRequestPageQuery(input: {
  status: string | null;
  limit: string | null;
  cursor: string | null;
}): AgentRequestPageQuery | null {
  if (input.status === null && input.limit === null && input.cursor === null) return null;
  let status: PagedRequestStatus | null = null;
  if (input.status !== null) {
    if (!PAGED_REQUEST_STATUSES.includes(input.status as PagedRequestStatus)) {
      throw invalidPageInput('status must be "open"');
    }
    status = input.status as PagedRequestStatus;
  }
  let limit = DEFAULT_REQUEST_PAGE_LIMIT;
  if (input.limit !== null) {
    if (!/^[1-9]\d{0,2}$/.test(input.limit) || Number(input.limit) > MAX_REQUEST_PAGE_LIMIT) {
      throw invalidPageInput(`limit must be an integer from 1 to ${MAX_REQUEST_PAGE_LIMIT}`);
    }
    limit = Number(input.limit);
  }
  if (
    input.cursor !== null &&
    (input.cursor === '' || input.cursor.length > MAX_REQUEST_CURSOR_LENGTH)
  ) {
    throw invalidPageInput('cursor is not a valid agent-request cursor');
  }
  return { status, limit, cursor: input.cursor };
}

function timestampIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (ISO_CURSOR_TIMESTAMP.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

export function encodeAgentRequestCursor(cursor: AgentRequestCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode a cursor and require it to name exactly the scope of the current read. */
export function decodeAgentRequestCursor(
  raw: string,
  scope: { missionId: string; objectiveId: string | null; status: PagedRequestStatus | null }
): AgentRequestCursor {
  const invalid = invalidPageInput('cursor is not a valid agent-request cursor');
  let parsed: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid;
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  const value = asRecord(parsed);
  if (
    value.v !== 1 ||
    typeof value.m !== 'string' ||
    !(value.o === null || typeof value.o === 'string') ||
    !(value.s === null || PAGED_REQUEST_STATUSES.includes(value.s as PagedRequestStatus)) ||
    typeof value.t !== 'string' ||
    !ISO_CURSOR_TIMESTAMP.test(value.t) ||
    typeof value.i !== 'string' ||
    value.i.length === 0
  ) {
    throw invalid;
  }
  if (value.m !== scope.missionId || value.o !== scope.objectiveId || value.s !== scope.status) {
    throw invalidPageInput('cursor was issued for a different mission, objective or status');
  }
  return value as AgentRequestCursor;
}

type AgentRequestPageDto = {
  complete: boolean;
  nextCursor: string | null;
  limit: number;
  status: PagedRequestStatus | null;
};

async function missionScopedRequests(
  client: ReturnType<typeof requireDatabaseClient>,
  missionRef: string,
  objectiveRef: string | null = null,
  page: AgentRequestPageQuery | null = null
): Promise<{ requests: Record<string, unknown>[]; page?: AgentRequestPageDto }> {
  const memberships = await callerWorkspaceMemberships(client);
  if (memberships.length === 0)
    throw new ServiceError('Mission not found', 'mission_not_found', 404);
  const placeholders = memberships.map(() => '?').join(', ');
  const mission = await client.get<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id FROM missions
       WHERE (id = ? OR display_id = ?) AND deleted_at IS NULL
         AND workspace_id IN (${placeholders})`,
    [missionRef, missionRef, ...memberships.map(entry => entry.workspaceId)]
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
  const objective = objectiveRef
    ? await resolveObjectiveRef({ ctx, ref: objectiveRef, missionId: mission.id })
    : null;
  const scopeParams = [mission.id, mission.workspace_id, ...(objective ? [objective.id] : [])];
  if (!page) {
    // Legacy read: unchanged for existing CLI, mobile and web consumers.
    const rows = await client.all<Awaited<ReturnType<typeof getRequest>>>(
      `SELECT ${REQUEST_COLUMNS_FOR_ROUTE} FROM agent_requests
        WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
          ${objective ? 'AND objective_id = ?' : ''}
        ORDER BY created_at DESC LIMIT 200`,
      scopeParams
    );
    return { requests: await humanRequestDtos(ctx, rows) };
  }
  const scope = { missionId: mission.id, objectiveId: objective?.id ?? null, status: page.status };
  const after = page.cursor ? decodeAgentRequestCursor(page.cursor, scope) : null;
  // Filter before the limit, then keyset-page oldest first on (created_at, id): a request created
  // while a client pages sorts after the cursor and is reached on a later page, not skipped.
  // A JS Date drops PostgreSQL microseconds. Select a separate text key for the opaque
  // cursor so its comparison uses the same precision as the database ordering.
  const cursorTimestamp =
    client.dialect === 'postgres'
      ? `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : 'created_at';
  const rows = await client.all<
    Awaited<ReturnType<typeof getRequest>> & { cursor_created_at: string }
  >(
    `SELECT ${REQUEST_COLUMNS_FOR_ROUTE}, ${cursorTimestamp} AS cursor_created_at FROM agent_requests
      WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ${objective ? 'AND objective_id = ?' : ''}
        ${page.status ? 'AND status = ?' : ''}
        ${after ? 'AND (created_at > ? OR (created_at = ? AND id > ?))' : ''}
      ORDER BY created_at ASC, id ASC LIMIT ?`,
    [
      ...scopeParams,
      ...(page.status ? [page.status] : []),
      ...(after ? [after.t, after.t, after.i] : []),
      page.limit + 1
    ]
  );
  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeAgentRequestCursor({
          v: 1,
          m: scope.missionId,
          o: scope.objectiveId,
          s: scope.status,
          t: timestampIso(last.cursor_created_at),
          i: last.id
        })
      : null;
  return {
    requests: await humanRequestDtos(ctx, pageRows),
    page: { complete: !hasMore, nextCursor, limit: page.limit, status: page.status }
  };
}

/**
 * Dismiss (`dismissed` true) or restore the caller's notification for a request (ADR 0063).
 *
 * A per-member view preference: it requires only `session:read`, the permission that lets the
 * caller see the card, and never changes the request, its delivery or who may answer it.
 */
export async function setAgentRequestDismissal(
  requestId: string,
  rawBody: unknown,
  dismissed: boolean
): Promise<{ changed: boolean; request: Record<string, unknown> }> {
  const client = requireDatabaseClient();
  const row = await client.get<{ workspace_id: string }>(
    `SELECT workspace_id FROM agent_requests WHERE id = ? AND deleted_at IS NULL`,
    [requestId]
  );
  if (!row) throw new ServiceError('Request not found', 'request_not_found', 404);
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission: PERMISSIONS.SESSION_READ,
    db: client,
    notFoundMessage: 'Request not found'
  });
  const ctx = await buildWebappServiceContextForWorkspace(
    row.workspace_id,
    client,
    workspaceUserId
  );
  const body = asRecord(rawBody);
  if (body.expectedRevision !== undefined && typeof body.expectedRevision !== 'number') {
    throw new ServiceError('expectedRevision must be a number', 'invalid_input', 400);
  }
  const result = await setRequestDismissal({
    ctx,
    requestId,
    dismissed,
    expectedRevision: body.expectedRevision as number | undefined
  });
  return {
    changed: result.changed,
    request: await humanRequestDto(ctx, await getRequest({ ctx, requestId }))
  };
}

/** Ordinary-human request inbox. This router is mounted behind normal API authentication. */
export function createAgentRequestHumanRouter(): Router {
  const router = Router();
  router.use(deferMalformedBody(express.json({ limit: '32kb' })));

  router.get(
    '/',
    handle(async req => {
      const client = requireDatabaseClient();
      const objectiveRef = queryString(req, 'objectiveId', { trim: false, first: false });
      const missionRef =
        queryString(req, 'missionId', { trim: false, first: false }) ??
        missionDisplayIdFromObjectiveRef(objectiveRef);
      // A mission-scoped read resolves the mission inside the caller's own memberships and
      // authorizes against the mission's *own* workspace, the same way every other
      // resource-scoped mission route does. The unfiltered inbox below is a different query
      // with a different authorization shape, so the two do not share a code path.
      const page = parseAgentRequestPageQuery({
        status: queryString(req, 'status', { trim: false, first: false }),
        limit: queryString(req, 'limit', { trim: false, first: false }),
        cursor: queryString(req, 'cursor', { trim: false, first: false })
      });
      if (missionRef) {
        return await missionScopedRequests(client, missionRef, objectiveRef, page);
      }
      if (page) {
        throw new ServiceError(
          'status, limit and cursor require missionId or an objective display id',
          'invalid_input',
          400
        );
      }
      if (objectiveRef) {
        throw new ServiceError(
          'missionId is required when objectiveId is an objective UUID',
          'invalid_input',
          400
        );
      }
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
      const dismissals = await readRequestDismissals({
        db: client,
        workspaceUserIds: authorized.map(entry => entry.workspaceUserId),
        requests: rows
      });
      const ctxByWorkspace = new Map<string, ServiceContext>();
      for (const entry of authorized) {
        ctxByWorkspace.set(
          entry.workspaceId,
          await buildWebappServiceContextForWorkspace(
            entry.workspaceId,
            client,
            entry.workspaceUserId
          )
        );
      }
      return {
        requests: await Promise.all(
          rows.map(async request => {
            const ctx = ctxByWorkspace.get(request.workspace_id);
            return ctx
              ? await humanRequestDto(ctx, request, dismissals)
              : { ...requestDto(request), ...dismissalDto(request, dismissals) };
          })
        )
      };
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
      const request = await getRequest({ ctx, requestId: req.params.id });
      if (request.kind !== 'question' && request.kind !== 'choice') sessionControlsGone();
      const delivery = await requestDelivery(ctx, request);
      if (delivery.mode !== 'latch') {
        throw new ServiceError(
          'This request cannot be delivered to its agent session',
          'request_not_deliverable',
          409
        );
      }
      const body = asRecord(req.body);
      if (typeof body.expectedRevision !== 'number') {
        throw new ServiceError('expectedRevision is required', 'agent_request_conflict', 409);
      }
      const resolution = body.resolution ? asRecord(body.resolution) : {};
      validateQuestionResolution({ request, resolution });
      const result = await resolveRequest({
        ctx,
        requestId: request.id,
        resolution,
        expectedRevision: body.expectedRevision
      });
      if (result.resolved) {
        await deliverQuestionAnswer({ ctx, request: result.request, attempt: 1 });
      }
      return {
        resolved: result.resolved,
        request: await humanRequestDto(ctx, await getRequest({ ctx, requestId: request.id }))
      };
    })
  );

  /**
   * Send a recorded answer again after it failed, or after an unconfirmed delivery the person
   * has checked (ADR 0065). Same permission as resolve. The attempt counter is the
   * compare-and-set token, so two clients pressing "send again" start one attempt.
   */
  router.post(
    '/:id/redeliver',
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
      if (
        typeof body.expectedAttempt !== 'number' ||
        !Number.isInteger(body.expectedAttempt) ||
        body.expectedAttempt < 1
      ) {
        throw new ServiceError(
          'expectedAttempt is required',
          'agent_request_delivery_conflict',
          409
        );
      }
      const request = await getRequest({ ctx, requestId: req.params.id });
      if (request.kind !== 'question' && request.kind !== 'choice') sessionControlsGone();
      const wasUnconfirmed = request.application_state === 'unknown';
      // Checked before the attempt starts: an answer that cannot be routed is refused with the
      // reason, and the delivery record keeps the failure the person already saw.
      const route = await answerRoute(ctx, request);
      if (request.status === 'resolved' && !route.ok) {
        throw new ServiceError(
          ROUTE_FAILURE_MESSAGES[route.reason],
          'request_not_deliverable',
          409
        );
      }
      const begun = await beginAnswerRedelivery({
        ctx,
        requestId: request.id,
        expectedAttempt: body.expectedAttempt,
        confirmUnconfirmed: body.confirmUnconfirmed === true
      });
      await deliverQuestionAnswer({
        ctx,
        request: begun.request,
        attempt: begun.attempt,
        previousAttempt: wasUnconfirmed ? begun.previousAttempt : null
      });
      return {
        redelivered: true,
        request: await humanRequestDto(ctx, await getRequest({ ctx, requestId: request.id }))
      };
    })
  );

  router.post(
    '/:id/dismissal',
    handle(req => setAgentRequestDismissal(req.params.id, req.body, true))
  );
  router.delete(
    '/:id/dismissal',
    handle(req => setAgentRequestDismissal(req.params.id, req.body, false))
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
  router.use(deferMalformedBody(express.json({ limit: '64kb' })));

  router.get(
    '/',
    handle(async req => {
      const objectiveRef = queryString(req, 'objectiveId', { trim: false, first: false });
      const missionId =
        queryString(req, 'missionId', { trim: false, first: false }) ??
        missionDisplayIdFromObjectiveRef(objectiveRef);
      if (!missionId) {
        throw new ServiceError(
          objectiveRef
            ? 'missionId is required when objectiveId is an objective UUID'
            : 'missionId or an objective display id is required',
          'invalid_input',
          400
        );
      }
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
      const objective = objectiveRef
        ? await resolveObjectiveRef({ ctx, ref: objectiveRef, missionId: mission.id })
        : null;
      const inputs = (
        await listSessionInputs({
          ctx,
          missionId: mission.id,
          objectiveId: objective?.id ?? null
        })
      ).filter(input => input.status !== 'queued' && input.status !== 'leased');
      // The most recent channel, live or not. A client gates its controls on this snapshot,
      // so it needs to see an `ended`/`lost` channel too — a UI that only ever hears about
      // live channels has no way to stop offering controls once the session is gone.
      const channel = await client.get<{
        id: string;
        state: string;
        agent_identifier: string | null;
        adapter_key: string | null;
        capabilities_json: string;
        last_heartbeat_at: string | null;
        ended_at: string | null;
        end_reason: string | null;
      }>(
        `SELECT id, state, agent_identifier, adapter_key, capabilities_json,
                last_heartbeat_at, ended_at, end_reason
           FROM agent_session_channels
           WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
             ${objective ? 'AND objective_id = ?' : ''}
           ORDER BY created_at DESC LIMIT 1`,
        [mission.id, mission.workspace_id, ...(objective ? [objective.id] : [])]
      );
      const isLive =
        channel !== undefined &&
        channel !== null &&
        ['preparing', 'online', 'degraded'].includes(channel.state);
      return {
        // Retained for existing callers: the id only when the channel can still be addressed.
        liveChannelId: isLive ? channel!.id : null,
        // The effective capability snapshot clients must gate on. No credential, credential
        // prefix, lease, or native session id is projected here.
        liveChannel: channel
          ? {
              id: channel.id,
              state: channel.state,
              agentIdentifier: channel.agent_identifier,
              adapterKey: channel.adapter_key,
              capabilities: JSON.parse(channel.capabilities_json) as unknown,
              lastHeartbeatAt: channel.last_heartbeat_at,
              endedAt: channel.ended_at,
              endReason: channel.end_reason
            }
          : null,
        inputs: inputs.map(inputDto)
      };
    })
  );

  router.post(
    '/',
    handle(async () => sessionControlsGone())
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
export const AGENT_REQUEST_HUMAN_ROUTE_PREFIX = '/api/agent-requests';
export const AGENT_SESSION_INPUT_HUMAN_ROUTE_PREFIX = '/api/agent-session-inputs';

const OWN_JSON_BODY_PREFIXES = [
  AGENT_SESSION_CHANNEL_ROUTE_PREFIX,
  AGENT_REQUEST_HUMAN_ROUTE_PREFIX,
  AGENT_SESSION_INPUT_HUMAN_ROUTE_PREFIX
] as const;

/**
 * Whether a path belongs to an agent-session router. Those routers parse their own JSON bodies
 * under tighter limits (32–64 KiB) than the app-level 100 KB parser, so the app-level parser
 * must skip them: body-parser never re-parses a body, so parsing it first makes those limits
 * dead code.
 */
export function agentSessionRoutesOwnJsonBody(path: string): boolean {
  return OWN_JSON_BODY_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Prepare a session channel for a manual `ovld launch`.
 *
 * Launch no longer mints Agent Session Exchange credentials. The route stays so
 * older CLIs receive 410 instead of creating a live control surface.
 */
export async function prepareMissionSessionChannel(
  _missionRef: string,
  _body: unknown
): Promise<Record<string, unknown>> {
  sessionControlsGone();
}

function sessionControlsGone(): never {
  throw new ServiceError(
    'There are no active session-input controls. Permission and question prompts remain with the native agent harness.',
    'session_controls_gone',
    410
  );
}
