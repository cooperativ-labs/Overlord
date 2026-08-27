import type { AgentRequestDto } from '../../../shared/contract.ts';
import { useMissionAgentRequests } from '../../lib/queries.ts';

import { BlockingQuestionCard } from './BlockingQuestionCard.tsx';
import { StructuredChoiceCard } from './StructuredChoiceCard.tsx';

/**
 * The Agent Session Module's contribution to the mission feed.
 *
 * Phase D only remounts Latch-deliverable human answers. The Latch-v1 retirement deliberately
 * removed the old session-input, permission, and retry controls; they stay absent here.
 *
 * Requests route to their own cards here. This intentionally recognizes only `question` and
 * `choice`; permission/retry belong to the retired Latch-v1 controls.
 */

/** Load only question and choice requests for the selected objective. */
type QuestionOrChoiceItem = {
  kind: 'agent_request';
  createdAt: string;
  id: string;
  request: AgentRequestDto;
};

export function useAgentSessionFeed(
  missionId: string,
  objectiveId: string | null
): {
  items: QuestionOrChoiceItem[];
  isLoading: boolean;
} {
  const requestsQ = useMissionAgentRequests(missionId, objectiveId, Boolean(objectiveId));

  const items: QuestionOrChoiceItem[] = [
    ...(requestsQ.data ?? [])
      .filter(request => request.kind === 'question' || request.kind === 'choice')
      .map(request => ({
        kind: 'agent_request' as const,
        createdAt: request.createdAt,
        id: `agent-request-${request.id}`,
        request
      }))
  ];

  return {
    items,
    // A failed agent-session query must not blank the mission's ordinary activity, so callers
    // treat absence as "nothing to show" rather than as an error state of their own.
    isLoading: requestsQ.isLoading
  };
}

export function AgentSessionActivity({
  missionId,
  objectiveId
}: {
  missionId: string;
  objectiveId: string | null;
}) {
  const { items, isLoading } = useAgentSessionFeed(missionId, objectiveId);
  if (isLoading || items.length === 0) return null;
  return (
    <div className="grid gap-3">
      {items.map(item => (
        <AgentSessionFeedCard key={item.id} item={item} />
      ))}
    </div>
  );
}

export function AgentSessionFeedCard({ item }: { item: QuestionOrChoiceItem }) {
  const { request } = item;
  switch (request.kind) {
    case 'question':
      return <BlockingQuestionCard request={request} />;
    case 'choice':
      return <StructuredChoiceCard request={request} />;
    default:
      return null;
  }
}
