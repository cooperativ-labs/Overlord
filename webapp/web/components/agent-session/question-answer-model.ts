import type { AgentRequestDto } from '../../../shared/contract.ts';
import { ApiRequestError } from '../../lib/api.ts';

const READ_ONLY_REASON_TEXT: Record<NonNullable<AgentRequestDto['delivery']['reason']>, string> = {
  no_latch_session: "This session isn't running in Latch — answer in the agent's terminal.",
  latch_session_exited:
    'The Latch session has ended, so this question can no longer be answered here.',
  target_offline: 'The computer running this session is offline.',
  request_closed: 'This question has already been closed.'
};

const DELIVERY_STATE_TEXT: Record<NonNullable<AgentRequestDto['delivery']['state']>, string> = {
  emitted: 'Sending to the agent…',
  applied: 'Delivered',
  not_applied: 'The agent could not receive this answer.',
  unknown: 'Delivery status is unknown. Do not send the answer again.'
};

export function questionReadOnlyReason(request: AgentRequestDto): string {
  const reason = request.delivery.reason;
  return reason
    ? READ_ONLY_REASON_TEXT[reason]
    : "This session isn't running in Latch — answer in the agent's terminal.";
}

export function deliveryStateText(state: AgentRequestDto['delivery']['state']): string | null {
  return state ? DELIVERY_STATE_TEXT[state] : null;
}

export function isQuestionDeliveryAnswerable(request: AgentRequestDto): boolean {
  return request.delivery.mode === 'latch' && request.status === 'open';
}

export function questionAllowsFreeText(request: AgentRequestDto): boolean {
  return request.allowsFreeText || request.options.length === 0;
}

export function isQuestionAnswerConflict(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.code === 'agent_request_conflict' || error.status === 409)
  );
}
