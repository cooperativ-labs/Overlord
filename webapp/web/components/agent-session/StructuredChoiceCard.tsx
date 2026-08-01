import { ListChecks } from 'lucide-react';
import { useState } from 'react';

import type { AgentRequestDto, AgentSessionChannelSnapshotDto } from '../../../shared/contract.ts';
import { useReleaseAgentRequest, useResolveAgentRequest } from '../../lib/queries.ts';

import {
  AgentSessionCardShell,
  CardBadge,
  formatCountdown,
  isRequestAnswerable,
  RequestSummaryText,
  useWindowCountdown
} from './AgentSessionCardShell.tsx';
import { ReleasedElsewhereBanner } from './ReleasedElsewhereBanner.tsx';

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
export function StructuredChoiceCard({
  request,
  channel
}: {
  request: AgentRequestDto;
  channel: AgentSessionChannelSnapshotDto | null;
}) {
  const resolve = useResolveAgentRequest(request.missionId ?? '');
  const release = useReleaseAgentRequest(request.missionId ?? '');
  const remainingMs = useWindowCountdown(request.windowExpiresAt);
  const [lostRace, setLostRace] = useState(false);

  const answerable = isRequestAnswerable(request, channel) && request.options.length > 0;
  const windowClosed = remainingMs !== null && remainingMs <= 0;
  const busy = resolve.isPending || release.isPending;

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

      {answerable && !windowClosed ? (
        <div className="flex flex-wrap items-center gap-2">
          {request.options.map(option => (
            <button
              key={option.optionId}
              type="button"
              disabled={busy}
              onClick={() =>
                resolve.mutate(
                  {
                    requestId: request.id,
                    resolution: { optionId: option.optionId },
                    expectedRevision: request.revision
                  },
                  { onSuccess: result => setLostRace(!result.resolved) }
                )
              }
              className="rounded border border-(--color-line) px-2 py-1 text-xs font-medium disabled:opacity-40"
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => release.mutate(request.id)}
            className="text-xs text-(--color-ink-dim) underline-offset-2 hover:underline disabled:opacity-40"
          >
            Respond in terminal
          </button>
        </div>
      ) : null}

      {request.status === 'open' && request.options.length === 0 ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          This choice arrived without any options, so it can only be answered at the terminal.
        </p>
      ) : null}
      {lostRace ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Someone answered this first. Your choice was not recorded.
        </p>
      ) : null}
      {resolve.isError ? (
        <p className="text-[11px] text-red-600">{(resolve.error as Error).message}</p>
      ) : null}

      <ReleasedElsewhereBanner request={request} channel={channel} />
    </AgentSessionCardShell>
  );
}
