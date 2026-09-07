import type { AgentRequestDto } from '../../shared/contract.ts';

/**
 * Which of an objective's agent requests are still waiting on a human, and
 * which of those the user has already waved away (coo:879).
 *
 * A blocking question or a structured choice now renders inside the executing
 * objective's own accordion body rather than in the mission-wide Activity
 * section, so a collapsed row could hide a request the agent is stopped on.
 * The header therefore needs to say "something here is waiting for you" while
 * the row is closed, and the row needs to be able to stop saying it once the
 * user has decided to deal with it later.
 *
 * Everything here is pure: the row component owns the query and the dismissal
 * set, this module owns what those two facts mean.
 */

/** The request shape this module needs — a subset of {@link AgentRequestDto}. */
export type BlockingRequestLike = Pick<AgentRequestDto, 'id' | 'kind' | 'status'>;

export type ObjectiveBlockingRequests = {
  /** Ids of every open question/choice request, in the order given. */
  pendingIds: string[];
  /** The pending ids the user has not dismissed — what the header actually shows. */
  activeIds: string[];
  /** `activeIds.length`, for the badge. */
  count: number;
  /** Whether the row should carry the blocking tint and badge. */
  isBlocking: boolean;
  /** Tooltip text for the badge, or `null` when nothing is blocking. */
  label: string | null;
};

/**
 * Only `open` requests block. The other statuses (`resolved`,
 * `released_to_terminal`, `expired`, `cancelled`) are all terminal: the
 * decision is no longer the panel's to make, so a badge that kept counting
 * them would be asking for an answer that can no longer be delivered.
 */
export function isPendingBlockingRequest(request: BlockingRequestLike): boolean {
  if (request.status !== 'open') return false;
  return request.kind === 'question' || request.kind === 'choice';
}

/**
 * Tooltip copy. Question and choice are named separately when a row carries
 * only one kind, because "answer a question" and "pick an option" are
 * different actions; a mixed set falls back to the neutral wording.
 */
export function blockingRequestLabel(requests: readonly BlockingRequestLike[]): string | null {
  const count = requests.length;
  if (count === 0) return null;
  const kinds = new Set(requests.map(request => request.kind));
  const onlyKind = kinds.size === 1 ? [...kinds][0] : null;
  if (onlyKind === 'question') {
    return count === 1
      ? 'The agent asked a blocking question — open this objective to answer'
      : `The agent asked ${count} blocking questions — open this objective to answer`;
  }
  if (onlyKind === 'choice') {
    return count === 1
      ? 'The agent is waiting on a choice — open this objective to decide'
      : `The agent is waiting on ${count} choices — open this objective to decide`;
  }
  return `${count} agent requests are waiting for you — open this objective to answer`;
}

/**
 * Fold the objective's requests and the user's dismissals into what the header
 * should render.
 *
 * Dismissal is per request id rather than per objective on purpose: waving away
 * the question you already read must not silence the *next* one the agent asks,
 * which is why a fresh id re-arms the badge without any extra bookkeeping.
 */
export function selectObjectiveBlockingRequests({
  requests,
  dismissedIds
}: {
  requests: readonly BlockingRequestLike[];
  dismissedIds: ReadonlySet<string>;
}): ObjectiveBlockingRequests {
  const pending = requests.filter(isPendingBlockingRequest);
  const active = pending.filter(request => !dismissedIds.has(request.id));
  return {
    pendingIds: pending.map(request => request.id),
    activeIds: active.map(request => request.id),
    count: active.length,
    isBlocking: active.length > 0,
    label: blockingRequestLabel(active)
  };
}
