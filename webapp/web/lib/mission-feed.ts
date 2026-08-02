import type {
  AgentRequestDto,
  AgentSessionChannelSnapshotDto,
  AgentSessionInputDto,
  MissionEventDto
} from '../../shared/contract.ts';

/**
 * Pure shaping and gating rules for the mission activity feed.
 *
 * These live here rather than inside the components because they are the parts that can be
 * quietly wrong: an ordering that drifts, or a control that stays enabled after the decision it
 * belongs to left for the terminal. Both are testable without a DOM, so they are.
 */

/**
 * Launch/lifecycle events. Every one of them collapses into the single Execution status section
 * anchored at the bottom of the feed, so runner churn never separates two narrative rows.
 *
 * Both types share the `MissionEventDto` fields `type`, `objectiveId`, `phase`, `summary`, and
 * `createdAt`. Runner/queue writers also stash `executionRequestId` in `payload_json`, which
 * would be the stronger correlation key, but it is not on the feed DTO.
 */
export const EXECUTION_STATUS_EVENT_TYPES: ReadonlySet<string> = new Set([
  'status_change',
  'execution_requested'
]);

/** Delivery events render in the Artifacts section instead of the activity feed. */
export const ACTIVITY_FEED_EXCLUDED_TYPES: ReadonlySet<string> = new Set(['delivery']);

/**
 * A user follow-up reaches the feed by two routes. The `UserPromptSubmit` hook posts it as a
 * `user_follow_up` event, but an agent that relays the message itself posts an ordinary `update`
 * whose summary opens with a `Follow-up:` marker. Both are the user speaking, so both must read
 * as the user speaking — an agent-relayed follow-up rendered as "Update / EXECUTE" hides who
 * actually asked for the work.
 */
const RELAYED_FOLLOW_UP_MARKER = /^follow[\s-]?up\s*:\s*/i;

export interface FollowUpPresentation {
  /** Render with the actor's avatar and name instead of an event-type icon and label. */
  isFollowUp: boolean;
  /** Summary with any relay marker removed, so the header is not repeated in the body. */
  summary: string;
}

/**
 * Decide whether an event should present as a user follow-up, and strip the relay marker.
 *
 * Marker detection is deliberately limited to `update` events: every other type has its own
 * meaning in the feed, and a `decision` or `alert` that happens to start with "Follow-up:" is
 * still that type of event.
 */
export function resolveFollowUpPresentation(
  event: Pick<MissionEventDto, 'type' | 'summary'>
): FollowUpPresentation {
  const summary = event.summary ?? '';
  if (event.type === 'user_follow_up') {
    return { isFollowUp: true, summary: summary.replace(RELAYED_FOLLOW_UP_MARKER, '') };
  }
  if (event.type === 'update' && RELAYED_FOLLOW_UP_MARKER.test(summary)) {
    const stripped = summary.replace(RELAYED_FOLLOW_UP_MARKER, '');
    // A bare "Follow-up:" with nothing after it carries no user message; leave it as an update.
    return stripped.trim()
      ? { isFollowUp: true, summary: stripped }
      : { isFollowUp: false, summary };
  }
  return { isFollowUp: false, summary };
}

/** One Agent Session Module row: an answerable request, or an instruction sent into the session. */
export type AgentSessionFeedItem =
  | { kind: 'agent_request'; createdAt: string; id: string; request: AgentRequestDto }
  | { kind: 'agent_session_input'; createdAt: string; id: string; input: AgentSessionInputDto };

/**
 * One mid-feed row. Mission narrative rows and agent-session cards are the same kind of thing to
 * someone reading down the panel, so they share a timeline instead of living in separate blocks.
 */
export type MissionFeedItem =
  | { kind: 'event'; id: string; createdAt: string; event: MissionEventDto }
  | { kind: 'agent_session'; id: string; createdAt: string; item: AgentSessionFeedItem };

function timestampValue(iso: string): number {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Split the feed into the mid-feed timeline and the execution-status history.
 *
 * The panel reads Artifacts → Deliveries → updates and interactive requests → status changes,
 * so status events come back as their own list rather than interleaved. Both lists are
 * newest-first.
 */
export function groupMissionFeedItems(
  events: MissionEventDto[],
  agentSessionItems: AgentSessionFeedItem[]
): { midFeed: MissionFeedItem[]; executionStatus: MissionEventDto[] } {
  const executionStatus: MissionEventDto[] = [];
  const midFeed: MissionFeedItem[] = [];

  for (const event of events) {
    if (ACTIVITY_FEED_EXCLUDED_TYPES.has(event.type)) continue;
    if (EXECUTION_STATUS_EVENT_TYPES.has(event.type)) {
      executionStatus.push(event);
      continue;
    }
    midFeed.push({ kind: 'event', id: event.id, createdAt: event.createdAt, event });
  }

  for (const item of agentSessionItems) {
    midFeed.push({ kind: 'agent_session', id: item.id, createdAt: item.createdAt, item });
  }

  midFeed.sort((left, right) => timestampValue(right.createdAt) - timestampValue(left.createdAt));
  executionStatus.sort(
    (left, right) => timestampValue(right.createdAt) - timestampValue(left.createdAt)
  );
  return { midFeed, executionStatus };
}

/**
 * A channel that can still carry a decision back to the harness.
 *
 * Gating is on the live channel snapshot, never on the agent identifier: two sessions of the
 * same agent can have different effective capabilities, and one of them may already be gone.
 */
export function isChannelLive(channel: AgentSessionChannelSnapshotDto | null): boolean {
  return channel !== null && ['preparing', 'online', 'degraded'].includes(channel.state);
}

/**
 * Whether remote controls may be offered at all.
 *
 * Three things must hold: the request is still open, its presence-sized remote window has not
 * closed, and the channel is still live. A control that appears to work and silently does
 * nothing is worse than no control.
 */
export function isRequestAnswerable(
  request: Pick<AgentRequestDto, 'status' | 'windowExpiresAt'>,
  channel: AgentSessionChannelSnapshotDto | null,
  now: number = Date.now()
): boolean {
  if (request.status !== 'open') return false;
  if (!isChannelLive(channel)) return false;
  if (!request.windowExpiresAt) return true;
  const expiry = new Date(request.windowExpiresAt).getTime();
  return Number.isNaN(expiry) || expiry > now;
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds >= 60) return `${Math.floor(totalSeconds / 60)}m left`;
  return `${totalSeconds}s left`;
}
