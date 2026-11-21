import type { HumanAgentRequestDto } from '@overlord/contract';

/**
 * Which agent requests are still waiting on a human (coo:879, coo:1281).
 *
 * The mission-wide open-request collection is filtered with this predicate for
 * the question slot, the row tints and the objective detail's Blocking
 * questions list. Dismissal lives in `lib/dismissed-agent-requests.ts`.
 */

/** The request shape this module needs — a subset of {@link HumanAgentRequestDto}. */
export type BlockingRequestLike = Pick<HumanAgentRequestDto, 'id' | 'kind' | 'status'>;

/**
 * Only `open` requests block. The other statuses (`resolved`,
 * `released_to_terminal`, `expired`, `cancelled`) are all terminal: the
 * decision is no longer the panel's to make, so a badge that kept counting
 * them would be asking for an answer that can no longer be delivered.
 */
export function isPendingBlockingRequest(request: BlockingRequestLike): boolean {
  if (request.status !== 'open') return false;
  // An open approval exists only on a control-plane session (Codex app-server mode, ADR 0094):
  // hook adapters mint no channel, so they open no cards.
  return request.kind === 'question' || request.kind === 'choice' || request.kind === 'permission';
}
