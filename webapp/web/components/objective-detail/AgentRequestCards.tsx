import type { HumanAgentRequestDto } from '@overlord/contract';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { BlockingQuestionCard } from '../agent-session/BlockingQuestionCard.tsx';
import { StructuredChoiceCard } from '../agent-session/StructuredChoiceCard.tsx';

/**
 * The existing answer card for one open request: `BlockingQuestionCard` for a question and
 * `StructuredChoiceCard` for a choice. The answer form is never forked (plan §5).
 */
export function AgentRequestCard({ request }: { request: HumanAgentRequestDto }) {
  if (request.kind === 'question') return <BlockingQuestionCard request={request} />;
  if (request.kind === 'choice') return <StructuredChoiceCard request={request} />;
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
  header
}: {
  request: HumanAgentRequestDto;
  onDismiss: (requestId: string) => void;
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
          onClick={() => onDismiss(request.id)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
