import type { HumanAgentRequestDto } from '@overlord/contract';
import { MessageSquareReply, X } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  AgentSessionCardShell,
  RequestSummaryText
} from '../agent-session/AgentSessionCardShell.tsx';
import { BlockingQuestionCard } from '../agent-session/BlockingQuestionCard.tsx';
import { PermissionRequestCard } from '../agent-session/PermissionRequestCard.tsx';
import { AnswerDeliveryStatus, answerOutcome } from '../agent-session/QuestionAnswerForm.tsx';
import { StructuredChoiceCard } from '../agent-session/StructuredChoiceCard.tsx';

/**
 * The existing answer card for one open request: `BlockingQuestionCard` for a question,
 * `StructuredChoiceCard` for a choice and `PermissionRequestCard` for an approval. The answer form
 * is never forked (plan §5).
 */
export function AgentRequestCard({ request }: { request: HumanAgentRequestDto }) {
  if (request.kind === 'question') return <BlockingQuestionCard request={request} />;
  if (request.kind === 'choice') return <StructuredChoiceCard request={request} />;
  if (request.kind === 'permission') return <PermissionRequestCard request={request} />;
  return null;
}

/**
 * A blocking-request notification with a dismiss button (plan §5, §9.4). Dismissing hides only
 * this notification, in the mission panel and the objective detail alike; the request stays open
 * and answerable in the detail's Blocking questions list. `header` adds content above the card
 * (the mission-level slot puts the objective's id there).
 */
export function DismissibleAgentRequestCard({
  request,
  onDismiss,
  dismissPending = false,
  header
}: {
  request: HumanAgentRequestDto;
  onDismiss: (request: HumanAgentRequestDto) => void;
  dismissPending?: boolean;
  header?: ReactNode;
}) {
  return (
    <div className="relative min-w-0" data-request-id={request.id}>
      {header}
      <div className="relative min-w-0">
        <AgentRequestCard request={request} />
        <button
          type="button"
          aria-label="Dismiss this notification"
          title="Dismiss this notification"
          className="absolute right-1.5 top-1.5 z-10 inline-flex size-7 items-center justify-center rounded-md text-(--color-ink-dim) outline-none hover:bg-black/5 hover:text-(--color-ink) focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/10"
          disabled={dismissPending}
          onClick={() => onDismiss(request)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * A question or choice a person already answered, kept where it was answered until its delivery
 * is settled (ADR 0065). It shows the recorded answer, where delivery stands, and the recovery
 * the server allows. Closing it hides this card for the page session; it never changes the
 * request.
 */
export function AnsweredAgentRequestCard({
  request,
  onClose,
  header
}: {
  request: HumanAgentRequestDto;
  onClose: (requestId: string) => void;
  header?: ReactNode;
}) {
  const tone = answerOutcome(request)?.tone;
  return (
    <div className="relative min-w-0" data-request-id={request.id} data-answered="true">
      {header}
      <div className="relative min-w-0">
        <AgentSessionCardShell
          icon={MessageSquareReply}
          title={
            request.kind === 'choice'
              ? 'Choice answered'
              : request.kind === 'permission'
                ? 'Approval answered'
                : 'Question answered'
          }
          tone={tone === 'failed' ? 'alert' : tone === 'unconfirmed' ? 'question' : 'neutral'}
          timestamp={request.resolvedAt ?? request.createdAt}
        >
          <RequestSummaryText text={request.summary} />
          <AnswerDeliveryStatus request={request} />
        </AgentSessionCardShell>
        <button
          type="button"
          aria-label="Close this answer"
          title="Close this answer"
          className="absolute right-1.5 top-1.5 z-10 inline-flex size-7 items-center justify-center rounded-md text-(--color-ink-dim) outline-none hover:bg-black/5 hover:text-(--color-ink) focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/10"
          onClick={() => onClose(request.id)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
