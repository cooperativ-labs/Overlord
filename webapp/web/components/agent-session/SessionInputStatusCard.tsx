import { SendHorizonal } from 'lucide-react';

import type { AgentSessionInputDto } from '../../../shared/contract.ts';
import { useCancelAgentSessionInput } from '../../lib/queries.ts';

import { AgentSessionCardShell, CardBadge } from './AgentSessionCardShell.tsx';

/**
 * An instruction sent *from* Overlord *into* the session — the inverse of a user prompt.
 *
 * The whole point of this card is the honesty of its label, which the server authors rather
 * than the client. Cursor's inject path schedules the next turn instead of placing text in the
 * agent's current context, so it lands as "Queued (turn boundary)". A UI that rendered that as
 * "Delivered" would be telling a human their message arrived when it has not.
 *
 * Cancelling is offered only while the input is still `queued`. Once a lease was taken and the
 * text emitted, there is nothing left to cancel — the agent already has it — and the button
 * would be a lie in the other direction.
 */

const STATUS_TONE: Record<string, string> = {
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-(--color-ink-dim)',
  acknowledged: 'text-emerald-700 dark:text-emerald-400'
};

export function SessionInputStatusCard({
  missionId,
  input
}: {
  missionId: string;
  input: AgentSessionInputDto;
}) {
  const cancel = useCancelAgentSessionInput(missionId);
  const cancellable = input.status === 'queued';

  return (
    <AgentSessionCardShell
      icon={SendHorizonal}
      title={input.kind === 'instruction' ? 'Instruction sent' : `Sent: ${input.kind}`}
      tone="neutral"
      timestamp={input.createdAt}
      badges={<CardBadge>{input.deliveryLabel}</CardBadge>}
    >
      <p className="whitespace-pre-wrap wrap-anywhere text-sm text-(--color-ink-dim)">
        {input.body}
      </p>

      {input.status === 'failed' && input.lastErrorCode ? (
        <p className={`text-[11px] ${STATUS_TONE.failed}`}>
          Delivery failed: {input.lastErrorCode}
        </p>
      ) : null}
      {input.status === 'cancelled' ? (
        <p className={`text-[11px] ${STATUS_TONE.cancelled}`}>Cancelled before it was sent.</p>
      ) : null}

      {cancellable ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(input.id)}
            className="text-xs text-(--color-ink-dim) underline-offset-2 hover:underline disabled:opacity-40"
          >
            Cancel
          </button>
          {cancel.isError ? (
            <span className="text-[11px] text-red-600">{(cancel.error as Error).message}</span>
          ) : null}
        </div>
      ) : null}
    </AgentSessionCardShell>
  );
}
