import { RotateCcw } from 'lucide-react';
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
 * A retry / continue intent (`agent_requests.kind = 'retry'`).
 *
 * The agent hit something it can try again — a failed tool call, a timed-out step — and is
 * asking whether to. This is the *answerable* half of retry. The other half, nudging an agent
 * that is not asking anything, is an ordinary instruction and belongs to the inject path, not
 * to a magic backend command; see {@link SessionInputStatusCard}.
 *
 * With no adapter-supplied options the two decisions are the same allow/deny pair every shipped
 * decision codec can encode, labelled for what they mean here.
 */
export function RetryIntentCard({
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

  const answerable = isRequestAnswerable(request, channel);
  const windowClosed = remainingMs !== null && remainingMs <= 0;
  const busy = resolve.isPending || release.isPending;

  const answer = (resolution: Record<string, unknown>) =>
    resolve.mutate(
      { requestId: request.id, resolution, expectedRevision: request.revision },
      { onSuccess: result => setLostRace(!result.resolved) }
    );

  return (
    <AgentSessionCardShell
      icon={RotateCcw}
      title="Try again?"
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
          {request.options.length > 0 ? (
            request.options.map(option => (
              <button
                key={option.optionId}
                type="button"
                disabled={busy}
                onClick={() => answer({ optionId: option.optionId })}
                className="rounded border border-(--color-line) px-2 py-1 text-xs font-medium disabled:opacity-40"
              >
                {option.label}
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => answer({ decision: 'allow' })}
                className="rounded bg-(--color-ink) px-2.5 py-1 text-xs font-medium text-(--color-paper) disabled:opacity-40"
              >
                Try again
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => answer({ decision: 'deny' })}
                className="rounded border border-(--color-line) px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              >
                Stop
              </button>
            </>
          )}
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

      {lostRace ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Someone answered this first. Your response was not recorded.
        </p>
      ) : null}
      {resolve.isError ? (
        <p className="text-[11px] text-red-600">{(resolve.error as Error).message}</p>
      ) : null}

      <ReleasedElsewhereBanner request={request} channel={channel} />
    </AgentSessionCardShell>
  );
}
