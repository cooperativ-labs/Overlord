import { ListChecks } from 'lucide-react';

import type { AgentRequestDto } from '../../../shared/contract.ts';

import {
  AgentSessionCardShell,
  CardBadge,
  formatCountdown,
  RequestSummaryText,
  useWindowCountdown
} from './AgentSessionCardShell.tsx';
import { isQuestionDeliveryAnswerable, QuestionAnswerForm } from './QuestionAnswerForm.tsx';

/**
 * A structured choice (`agent_requests.kind = 'choice'`).
 *
 * Distinct from a blocking question on purpose: a choice has a closed set of answers, each with
 * a stable `optionId`, and the client returns only that id. There is no free-text box, because
 * prose is not one of the answers the harness declared it can accept.
 *
 * A choice that arrives with no options is a broken request, not an empty one — it is shown as
 * unanswerable here rather than rendered as a card with nothing to click.
 */
export function StructuredChoiceCard({ request }: { request: AgentRequestDto }) {
  const remainingMs = useWindowCountdown(request.windowExpiresAt);
  const answerable = isQuestionDeliveryAnswerable(request) && request.options.length > 0;
  const windowClosed = remainingMs !== null && remainingMs <= 0;

  return (
    <AgentSessionCardShell
      icon={ListChecks}
      title="Choose an option"
      tone="action"
      timestamp={request.createdAt}
      badges={
        answerable && remainingMs !== null && remainingMs > 0 ? (
          <CardBadge>{formatCountdown(remainingMs)}</CardBadge>
        ) : null
      }
    >
      <RequestSummaryText text={request.summary} />

      {windowClosed ? (
        <p className="text-[11px] text-(--color-ink-dim)">This choice has expired.</p>
      ) : request.options.length > 0 ? (
        <QuestionAnswerForm request={request} allowText={false} />
      ) : null}

      {request.status === 'open' && request.options.length === 0 ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          This choice arrived without any options.
        </p>
      ) : null}
    </AgentSessionCardShell>
  );
}
