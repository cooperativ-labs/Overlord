import type { AgentSessionChannelSnapshotDto } from '../../../shared/contract.ts';
import type { AgentSessionFeedItem } from '../../lib/mission-feed.ts';
import { useMissionAgentRequests, useMissionAgentSessionInputs } from '../../lib/queries.ts';

import { BlockingQuestionCard } from './BlockingQuestionCard.tsx';
import { PermissionRequestCard } from './PermissionRequestCard.tsx';
import { RetryIntentCard } from './RetryIntentCard.tsx';
import { SessionInputStatusCard } from './SessionInputStatusCard.tsx';
import { StructuredChoiceCard } from './StructuredChoiceCard.tsx';

/**
 * The Agent Session Module's contribution to the mission feed.
 *
 * Two sources, one timeline: answerable requests the agent raised (`agent_requests`) and
 * instructions Overlord queued back into the session (`agent_session_inputs`). They are
 * deliberately *not* rendered as their own block — they interleave with the mission's ordinary
 * narrative rows by timestamp, because "the agent asked for permission" and "someone posted an
 * update" are the same kind of thing to a person reading down the panel.
 *
 * Request kinds route to their own card here rather than in a switch inside the feed, so adding
 * a kind is a new file plus one line, and no other component needs to know it exists.
 */

/**
 * Load this mission's agent-session activity as feed items plus the live channel snapshot.
 *
 * The snapshot travels with the items because every card gates its controls on it. Handing
 * cards a channel is what keeps that gate in one place instead of five.
 */
export function useAgentSessionFeed(missionId: string): {
  items: AgentSessionFeedItem[];
  channel: AgentSessionChannelSnapshotDto | null;
  isLoading: boolean;
} {
  const requestsQ = useMissionAgentRequests(missionId);
  const inputsQ = useMissionAgentSessionInputs(missionId);

  const items: AgentSessionFeedItem[] = [
    ...(requestsQ.data ?? []).map(request => ({
      kind: 'agent_request' as const,
      createdAt: request.createdAt,
      id: `agent-request-${request.id}`,
      request
    })),
    ...(inputsQ.data?.inputs ?? []).map(input => ({
      kind: 'agent_session_input' as const,
      createdAt: input.createdAt,
      id: `agent-session-input-${input.id}`,
      input
    }))
  ];

  return {
    items,
    channel: inputsQ.data?.liveChannel ?? null,
    // A failed agent-session query must not blank the mission's ordinary activity, so callers
    // treat absence as "nothing to show" rather than as an error state of their own.
    isLoading: requestsQ.isLoading || inputsQ.isLoading
  };
}

export function AgentSessionFeedCard({
  item,
  missionId,
  channel
}: {
  item: AgentSessionFeedItem;
  missionId: string;
  channel: AgentSessionChannelSnapshotDto | null;
}) {
  if (item.kind === 'agent_session_input') {
    return <SessionInputStatusCard missionId={missionId} input={item.input} />;
  }

  const { request } = item;
  switch (request.kind) {
    case 'permission':
      return <PermissionRequestCard request={request} channel={channel} />;
    case 'question':
      return <BlockingQuestionCard request={request} channel={channel} />;
    case 'choice':
      return <StructuredChoiceCard request={request} channel={channel} />;
    case 'retry':
      return <RetryIntentCard request={request} channel={channel} />;
    default:
      // An unknown future kind is still a real blocking request. Render it as a question so it
      // is visible and releasable rather than silently dropped from the feed.
      return <BlockingQuestionCard request={request} channel={channel} />;
  }
}
