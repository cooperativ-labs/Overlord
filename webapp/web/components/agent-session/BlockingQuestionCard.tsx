import { HelpCircle } from 'lucide-react';

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
 * A blocking question (`agent_requests.kind = 'question'`).
 *
 * The agent is stopped until a human writes something back, so the question body is shown in
 * full rather than clamped, and the reply box is part of the card instead of somewhere else in
 * the panel. Structured options are offered alongside the free-text box when the harness
 * supplied them — a question can be both "pick one" and "or say why".
 *
 * `delivery.mode` is authoritative: non-Latch sessions are rendered read-only, and this card
 * never offers the retired terminal-release action for a question.
 */
export function BlockingQuestionCard({ request }: { request: AgentRequestDto }) {
  const remainingMs = useWindowCountdown(request.windowExpiresAt);
  const answerable = isQuestionDeliveryAnswerable(request);
  const windowClosed = remainingMs !== null && remainingMs <= 0;

  return (
    <AgentSessionCardShell
      icon={HelpCircle}
      title="Blocking question"
      tone="question"
      timestamp={request.createdAt}
      badges={
        answerable && remainingMs !== null && remainingMs > 0 ? (
          <CardBadge>{formatCountdown(remainingMs)}</CardBadge>
        ) : null
      }
    >
      <RequestSummaryText text={request.summary} />

      {windowClosed ? (
        <p className="text-[11px] text-(--color-ink-dim)">This question has expired.</p>
      ) : (
        <QuestionAnswerForm request={request} />
      )}
    </AgentSessionCardShell>
  );
}
