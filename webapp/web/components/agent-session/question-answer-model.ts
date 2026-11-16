import type { HumanAgentRequestDto } from '@overlord/contract';

import { ApiRequestError } from '../../lib/api.ts';

const READ_ONLY_REASON_TEXT: Record<
  NonNullable<HumanAgentRequestDto['delivery']['reason']>,
  string
> = {
  no_latch_session: "This session isn't running in Latch — answer in the agent's terminal.",
  latch_session_exited:
    'The Latch session has ended, so this question can no longer be answered here.',
  target_offline:
    'The computer running this session is offline. Bring its runner back online to answer here.',
  request_closed: 'This question has already been closed.'
};

const DELIVERY_STATE_TEXT: Record<
  NonNullable<HumanAgentRequestDto['delivery']['state']>,
  string
> = {
  emitted: 'Sending to the agent…',
  applied: 'Delivered',
  not_applied: 'The agent could not receive this answer.',
  unknown: 'Delivery status is unknown. Do not send the answer again.'
};

export function questionReadOnlyReason(request: HumanAgentRequestDto): string {
  const reason = request.delivery.reason;
  return reason
    ? READ_ONLY_REASON_TEXT[reason]
    : "This session isn't running in Latch — answer in the agent's terminal.";
}

/** Legacy text for a server that predates `delivery.stage` (contract < 173.6). */
export function deliveryStateText(state: HumanAgentRequestDto['delivery']['state']): string | null {
  return state ? DELIVERY_STATE_TEXT[state] : null;
}

export function isQuestionDeliveryAnswerable(request: HumanAgentRequestDto): boolean {
  return request.delivery.mode === 'latch' && request.status === 'open';
}

export function questionAllowsFreeText(request: HumanAgentRequestDto): boolean {
  return request.allowsFreeText || request.options.length === 0;
}

/**
 * Where a recorded answer stands (ADR 0065), in the four facts the server reports separately:
 * recorded, waiting for the runner, sent with a receipt, or not. `pending` never claims
 * delivery; `confirmed` is the only success.
 */
export type AnswerOutcomeTone = 'pending' | 'confirmed' | 'unconfirmed' | 'failed';

export type AnswerOutcome = {
  tone: AnswerOutcomeTone;
  /** One short sentence for the card. */
  text: string;
  /** The server's message for a failed or unconfirmed delivery, when it sent one. */
  detail: string | null;
  /** `POST /redeliver` may start another attempt now. */
  canRedeliver: boolean;
  /** A redelivery must carry `confirmUnconfirmed: true` after the person checked the session. */
  confirmationRequired: boolean;
  /** The attempt the outcome describes; the redelivery compare-and-set token. */
  attempt: number | null;
};

const PENDING_STAGE_TEXT: Record<string, string> = {
  recorded: 'Answer saved. Sending it to the agent…',
  queued: 'Answer saved. Waiting for the execution machine to pick it up…',
  dispatched: 'Answer sent to the execution machine. Waiting for the agent to confirm…'
};

/**
 * The outcome of a resolved question or choice, or null when the request holds no answer
 * (open, expired, cancelled) or is not a question/choice.
 *
 * Prefers `delivery.stage`; falls back to the legacy closed `state` vocabulary for an older
 * server. An unrecognised stage is shown as pending, never as delivered.
 */
export function answerOutcome(request: HumanAgentRequestDto): AnswerOutcome | null {
  if (request.status !== 'resolved') return null;
  if (request.kind !== 'question' && request.kind !== 'choice') return null;
  const delivery = request.delivery;
  const stage = delivery.stage ?? legacyStage(delivery.state);
  if (!stage) return null;
  const detail = delivery.failureMessage?.trim() || null;
  const base = {
    detail: null as string | null,
    canRedeliver: delivery.canRedeliver === true,
    confirmationRequired: delivery.confirmationRequired === true,
    attempt: delivery.attempt ?? null
  };
  switch (stage) {
    case 'confirmed':
      return { ...base, tone: 'confirmed', text: 'Delivered to the agent.' };
    case 'unconfirmed':
      return {
        ...base,
        tone: 'unconfirmed',
        detail,
        text: 'Sent, but the agent did not confirm it. It may have arrived — check the session before sending it again.'
      };
    case 'failed':
      return {
        ...base,
        tone: 'failed',
        detail,
        text: 'Your answer is saved but did not reach the agent.'
      };
    default:
      return {
        ...base,
        tone: 'pending',
        canRedeliver: false,
        confirmationRequired: false,
        text: PENDING_STAGE_TEXT[stage] ?? 'Answer saved. Sending it to the agent…'
      };
  }
}

function legacyStage(state: HumanAgentRequestDto['delivery']['state']): string | null {
  switch (state) {
    case 'applied':
      return 'confirmed';
    case 'not_applied':
      return 'failed';
    case 'unknown':
      return 'unconfirmed';
    case 'emitted':
      return 'recorded';
    default:
      return null;
  }
}

/**
 * The more recent of two copies of one request: this device's copy from a resolve/redeliver
 * response and the server read. Higher revision wins, then higher delivery attempt, then a
 * settled outcome over a pending one (a read that started before the outcome landed). On a tie
 * the server copy wins.
 */
export function newerAnswerSnapshot(
  local: HumanAgentRequestDto | null | undefined,
  server: HumanAgentRequestDto
): HumanAgentRequestDto {
  if (!local) return server;
  if (!answerOutcome(server)) return answerOutcome(local) ? local : server;
  if (server.revision !== local.revision) return server.revision > local.revision ? server : local;
  const serverAttempt = server.delivery.attempt ?? 0;
  const localAttempt = local.delivery.attempt ?? 0;
  if (serverAttempt !== localAttempt) return serverAttempt > localAttempt ? server : local;
  const serverPending = answerOutcome(server)?.tone === 'pending';
  const localPending = answerOutcome(local)?.tone === 'pending';
  return serverPending && !localPending ? local : server;
}

/**
 * A resolved question/choice whose answer still needs a person's attention or is still on its
 * way: anything except a confirmed delivery.
 */
export function answerNeedsFollowUp(request: HumanAgentRequestDto): boolean {
  const outcome = answerOutcome(request);
  return outcome !== null && outcome.tone !== 'confirmed';
}

/**
 * How a refused resolve or redeliver call should be shown.
 *
 * - `lost_race`: someone else answered first, or the card was stale. Nothing was recorded.
 * - `not_deliverable`: the session ended or the machine is offline. Nothing was recorded (for
 *   resolve), so the draft is kept and the server's message is actionable.
 * - `delivery_conflict`: another redelivery started, or delivery already succeeded.
 * - `confirmation_required`: an unconfirmed delivery needs an explicit confirmation.
 * - `error`: anything else; the server's message is shown.
 */
export type AnswerErrorKind =
  | 'lost_race'
  | 'not_deliverable'
  | 'delivery_conflict'
  | 'confirmation_required'
  | 'error';

export function classifyAnswerError(error: unknown): AnswerErrorKind {
  if (!(error instanceof ApiRequestError)) return 'error';
  switch (error.code) {
    case 'agent_request_conflict':
      return 'lost_race';
    case 'request_not_deliverable':
      return 'not_deliverable';
    case 'agent_request_delivery_conflict':
      return 'delivery_conflict';
    case 'delivery_confirmation_required':
      return 'confirmation_required';
    default:
      // A 409 without a code is an older server's revision conflict.
      return error.status === 409 && !error.code ? 'lost_race' : 'error';
  }
}

/** @deprecated use {@link classifyAnswerError}; kept for existing callers. */
export function isQuestionAnswerConflict(error: unknown): boolean {
  return classifyAnswerError(error) === 'lost_race';
}

export function answerErrorText(error: unknown): string {
  switch (classifyAnswerError(error)) {
    case 'lost_race':
      return 'Someone answered this first. Your response was not recorded.';
    case 'delivery_conflict':
      return 'This answer is already being sent, or was delivered. Refreshing its status…';
    case 'confirmation_required':
      return 'The earlier attempt may have reached the agent. Check the session, then confirm to send again.';
    default:
      return error instanceof Error && error.message
        ? error.message
        : 'The answer could not be sent.';
  }
}
