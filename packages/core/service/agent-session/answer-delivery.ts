import { recordChange } from '../change-feed.js';
import type { ServiceContext } from '../context.js';
import { ServiceError } from '../errors.js';
import type { CapabilityResult, SendLatchMessageResult } from '../local-target/types.js';
import { parseMetadataJson } from '../records.js';
import { nowIso } from '../util.js';

import { type AgentRequestRow, type ApplicationState, getRequest } from './requests.js';

/**
 * What became of a recorded answer on its way to the waiting agent (ADR 0065).
 *
 * Resolving a question records the answer; it does not prove the agent received it. These are
 * four different facts and a client must be able to tell them apart:
 *
 * - **recorded**: the answer is saved on the request (`status = resolved`). Nothing has left yet.
 * - **queued / dispatched**: a delivery job exists for the execution target's runner, and the
 *   runner has (dispatched) or has not yet (queued) taken it.
 * - **confirmed**: Latch's Conversation Hub accepted the message as a user turn.
 * - **unconfirmed**: the message left for Latch and no receipt came back. It may have landed.
 * - **failed**: the message definitely did not reach the agent.
 *
 * `agent_requests.application_state` carries the closed part of that (`emitted`, `applied`,
 * `not_applied`, `unknown`). The delivery record in `details_json.delivery` adds the attempt
 * counter and the reason for a failure. One request has at most one live attempt: an attempt is
 * started only by the resolve CAS or the redelivery CAS, so two submissions can never both send.
 */

/** Stages a client renders. Derived per read; never stored. */
export const ANSWER_DELIVERY_STAGES = [
  'recorded',
  'queued',
  'dispatched',
  'confirmed',
  'unconfirmed',
  'failed'
] as const;
export type AnswerDeliveryStage = (typeof ANSWER_DELIVERY_STAGES)[number];

/**
 * Why a delivery failed or could not be confirmed. Open vocabulary: clients show
 * `failureMessage` and fall back to a generic message for a code they do not know.
 */
export const ANSWER_DELIVERY_FAILURE_CODES = [
  /** Latch reached the session and declined the message (busy agent, pending native prompt). */
  'latch_refused',
  /** The runner could not reach a Latch gateway that carries conversations. */
  'gateway_unavailable',
  /** Latch has no such session any more. */
  'session_absent',
  /** The terminal session ended before the answer was delivered. */
  'session_ended',
  /** The runner never picked the job up; nothing was sent. */
  'not_dispatched',
  /** The message was sent and Latch did not confirm it. */
  'unconfirmed',
  /** The runner took the job and never reported back. */
  'runner_lost',
  /** The delivery deadline passed before the runner could send. */
  'deadline_passed',
  'delivery_failed'
] as const;
export type AnswerDeliveryFailureCode = (typeof ANSWER_DELIVERY_FAILURE_CODES)[number];

export const MAX_DELIVERY_FAILURE_MESSAGE_LENGTH = 300;

/** An answer older than this is not sent: the agent has almost certainly moved on. */
export const ANSWER_DELIVERY_DEADLINE_MS = 5 * 60_000;

export type AnswerDeliveryRecord = {
  /** 1 for the delivery started by the resolve; each redelivery adds one. */
  attempt: number;
  failureCode: string | null;
  failureMessage: string | null;
};

export type AnswerDeliveryOutcome = {
  state: ApplicationState;
  failureCode: AnswerDeliveryFailureCode | null;
  failureMessage: string | null;
};

function boundedMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= MAX_DELIVERY_FAILURE_MESSAGE_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_DELIVERY_FAILURE_MESSAGE_LENGTH - 1)}…`;
}

/** The delivery record of a request. A row written before ADR 0065 reads as attempt 1. */
export function readAnswerDelivery(request: { details_json: string }): AnswerDeliveryRecord {
  const raw = parseMetadataJson(request.details_json).delivery;
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const attempt =
    typeof record.attempt === 'number' && Number.isInteger(record.attempt) && record.attempt >= 1
      ? record.attempt
      : 1;
  return {
    attempt,
    failureCode: typeof record.failureCode === 'string' ? record.failureCode : null,
    failureMessage: boundedMessage(record.failureMessage)
  };
}

function detailsWithDelivery(request: { details_json: string }, record: AnswerDeliveryRecord) {
  return JSON.stringify({ ...parseMetadataJson(request.details_json), delivery: record });
}

const OPERATION_ATTEMPT_SEPARATOR = '.';

/**
 * The idempotency key of one delivery attempt, on the runner queue and in Latch alike.
 *
 * The first attempt is the request id itself, which is what every runner and stored job already
 * uses. A redelivery needs a fresh key because both the queue and Latch answer a reused key with
 * the first attempt's outcome instead of sending again.
 */
export function answerOperationId(requestId: string, attempt: number): string {
  return attempt <= 1 ? requestId : `${requestId}${OPERATION_ATTEMPT_SEPARATOR}${attempt}`;
}

export function parseAnswerOperationId(
  operationId: string
): { requestId: string; attempt: number } | null {
  const value = operationId.trim();
  if (!value) return null;
  const separator = value.lastIndexOf(OPERATION_ATTEMPT_SEPARATOR);
  if (separator === -1) return { requestId: value, attempt: 1 };
  const suffix = value.slice(separator + 1);
  if (!/^[1-9]\d{0,3}$/.test(suffix)) return null;
  return { requestId: value.slice(0, separator), attempt: Number(suffix) };
}

function failureCodeFromMessage(code: string, message: string): AnswerDeliveryFailureCode {
  if (code === 'LATCH_SESSION_ABSENT') return 'session_absent';
  if (/gateway|latch serve|not reachable|token/i.test(message)) return 'gateway_unavailable';
  if (/deadline/i.test(message)) return 'deadline_passed';
  return 'delivery_failed';
}

/**
 * Map a completed `sendLatchMessage` envelope onto a delivery outcome.
 *
 * Returns null while the job is still outstanding (`LOCAL_TARGET_TIMEOUT` means "still running
 * there", never "failed"). A job that reached a terminal status without a result is the one case
 * that needs care: a `cancelled` job was withdrawn before any runner took it, so nothing was
 * sent; any other terminal status means a runner held the job and went quiet, so the message
 * may have been sent and the outcome is `unknown`, never a failure that invites a resend.
 */
export function answerDeliveryOutcomeFromResult(
  result: CapabilityResult<SendLatchMessageResult>
): AnswerDeliveryOutcome | null {
  if (result.ok) {
    const status = result.value?.status;
    const reason = boundedMessage(result.value?.reason);
    if (status === 'accepted') return { state: 'applied', failureCode: null, failureMessage: null };
    if (status === 'refused') {
      return {
        state: 'not_applied',
        failureCode: /exited|unknown conversation|no such session/i.test(reason ?? '')
          ? 'session_ended'
          : /deadline/i.test(reason ?? '')
            ? 'deadline_passed'
            : 'latch_refused',
        failureMessage: reason ?? 'Latch did not accept the answer for this session.'
      };
    }
    return {
      state: 'unknown',
      failureCode: 'unconfirmed',
      failureMessage: reason ?? 'Latch did not confirm that the answer was delivered.'
    };
  }
  if (result.code === 'LOCAL_TARGET_TIMEOUT') return null;
  const details =
    result.details && typeof result.details === 'object' && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  if (typeof details.status === 'string') {
    if (details.status === 'cancelled') {
      return {
        state: 'not_applied',
        failureCode: 'not_dispatched',
        failureMessage:
          'The execution machine did not pick up the answer. Check that its runner is online.'
      };
    }
    return {
      state: 'unknown',
      failureCode: 'runner_lost',
      failureMessage:
        'The execution machine took the answer and did not report back. It may have been delivered.'
    };
  }
  return {
    state: 'not_applied',
    failureCode: failureCodeFromMessage(result.code, result.message),
    failureMessage: boundedMessage(result.message) ?? 'The answer could not be delivered.'
  };
}

/**
 * Record the outcome of one delivery attempt and tell open clients.
 *
 * Guarded on the attempt and on `emitted`: a late report for a superseded attempt, or a second
 * report for one already decided (the resolve call and the queue's completion hook both see the
 * same result), changes nothing. The write is a compare-and-set on `revision`, which every new
 * attempt increments, so a report can never land on a later attempt's record. Every real change
 * appends one `agent_request` entity change so a card that showed "sending" updates without a
 * reload; an outcome itself does not bump `revision`.
 */
export async function recordAnswerDeliveryOutcome({
  ctx,
  requestId,
  attempt,
  outcome
}: {
  ctx: ServiceContext;
  requestId: string;
  attempt: number;
  outcome: AnswerDeliveryOutcome;
}): Promise<{ changed: boolean }> {
  if (outcome.state === 'emitted') return { changed: false };
  const row = await ctx.db.get<AgentRequestRow>(
    `SELECT id, workspace_id, project_id, mission_id, objective_id, details_json, revision,
            application_state, status
       FROM agent_requests WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [requestId, ctx.workspace.id]
  );
  if (!row || row.status !== 'resolved' || row.application_state !== 'emitted') {
    return { changed: false };
  }
  const current = readAnswerDelivery(row);
  if (current.attempt !== attempt) return { changed: false };
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET application_state = ?, application_observed_at = ?, details_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND status = 'resolved'
        AND application_state = 'emitted' AND revision = ?`,
    [
      outcome.state,
      now,
      detailsWithDelivery(row, {
        attempt,
        failureCode: outcome.failureCode,
        failureMessage: outcome.failureMessage
      }),
      now,
      requestId,
      ctx.workspace.id,
      row.revision
    ]
  );
  if (updated.changes === 0) return { changed: false };
  await recordChange({
    ctx,
    entityType: 'agent_request',
    entityId: requestId,
    operation: 'update',
    entityRevision: row.revision,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    changedFields: ['application_state']
  });
  return { changed: true };
}

/** Record the outcome a queue job reported, addressed by its operation id. */
export async function recordAnswerDeliveryResult({
  ctx,
  operationId,
  result
}: {
  ctx: ServiceContext;
  operationId: string;
  result: CapabilityResult<SendLatchMessageResult>;
}): Promise<{ changed: boolean }> {
  const parsed = parseAnswerOperationId(operationId);
  const outcome = answerDeliveryOutcomeFromResult(result);
  if (!parsed || !outcome) return { changed: false };
  return await recordAnswerDeliveryOutcome({
    ctx,
    requestId: parsed.requestId,
    attempt: parsed.attempt,
    outcome
  });
}

/**
 * Start another delivery attempt for an answer that did not arrive.
 *
 * A definitive failure (`not_applied`) may always be retried: nothing reached the agent. An
 * unconfirmed delivery (`unknown`) may have reached it, so a retry needs the person's explicit
 * confirmation that they checked the session, and the runner then asks Latch for the previous
 * attempt's receipt before it sends anything. Starting an attempt increments `revision` under
 * compare-and-set, so a double click or two devices start exactly one attempt.
 */
export async function beginAnswerRedelivery({
  ctx,
  requestId,
  expectedAttempt,
  confirmUnconfirmed = false
}: {
  ctx: ServiceContext;
  requestId: string;
  expectedAttempt: number;
  confirmUnconfirmed?: boolean;
}): Promise<{ request: AgentRequestRow; attempt: number; previousAttempt: number }> {
  const request = await getRequest({ ctx, requestId });
  if (request.kind !== 'question' && request.kind !== 'choice') {
    throw new ServiceError('Only an answer can be redelivered', 'request_not_deliverable', 409);
  }
  const current = readAnswerDelivery(request);
  if (current.attempt !== expectedAttempt) {
    throw new ServiceError(
      'Delivery changed since it was read',
      'agent_request_delivery_conflict',
      409
    );
  }
  if (request.status !== 'resolved') {
    throw new ServiceError('The request has no recorded answer', 'request_not_deliverable', 409);
  }
  if (request.application_state === 'unknown') {
    if (!confirmUnconfirmed) {
      throw new ServiceError(
        'The previous delivery may have reached the agent. Check the session, then confirm.',
        'delivery_confirmation_required',
        409
      );
    }
  } else if (request.application_state !== 'not_applied') {
    throw new ServiceError(
      request.application_state === 'applied'
        ? 'The answer was already delivered'
        : 'A delivery is already in progress',
      'agent_request_delivery_conflict',
      409
    );
  }
  const attempt = current.attempt + 1;
  if (attempt > 9999) {
    throw new ServiceError('Too many delivery attempts', 'request_not_deliverable', 409);
  }
  const now = nowIso();
  const updated = await ctx.db.run(
    `UPDATE agent_requests
        SET application_state = 'emitted', application_observed_at = NULL, details_json = ?,
            updated_at = ?, revision = ?
      WHERE id = ? AND workspace_id = ? AND status = 'resolved'
        AND application_state = ? AND revision = ?`,
    [
      detailsWithDelivery(request, { attempt, failureCode: null, failureMessage: null }),
      now,
      request.revision + 1,
      requestId,
      ctx.workspace.id,
      request.application_state,
      request.revision
    ]
  );
  if (updated.changes === 0) {
    throw new ServiceError(
      'Delivery changed since it was read',
      'agent_request_delivery_conflict',
      409
    );
  }
  await recordChange({
    ctx,
    entityType: 'agent_request',
    entityId: requestId,
    operation: 'update',
    entityRevision: request.revision + 1,
    projectId: request.project_id,
    missionId: request.mission_id,
    objectiveId: request.objective_id,
    changedFields: ['application_state']
  });
  return {
    request: await getRequest({ ctx, requestId }),
    attempt,
    previousAttempt: current.attempt
  };
}

/** The message text a recorded resolution delivers. One mapping for resolve and redelivery. */
export function answerTextFromResolution(request: {
  resolution_json: string | null;
  options_json: string;
}): string {
  const resolution = request.resolution_json ? parseMetadataJson(request.resolution_json) : {};
  const text = typeof resolution.text === 'string' ? resolution.text.trim() : '';
  if (text) return text;
  const optionId = typeof resolution.optionId === 'string' ? resolution.optionId.trim() : '';
  if (optionId) {
    try {
      const options = JSON.parse(request.options_json) as unknown;
      if (Array.isArray(options)) {
        const match = options.find(
          option =>
            option !== null &&
            typeof option === 'object' &&
            (option as { optionId?: unknown }).optionId === optionId
        ) as { label?: unknown } | undefined;
        if (typeof match?.label === 'string' && match.label.trim()) return match.label.trim();
      }
    } catch {
      // Fall through to the generic text below.
    }
  }
  return 'Answer received';
}
