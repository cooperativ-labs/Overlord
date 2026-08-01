import { ShieldQuestion } from 'lucide-react';
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
 * A permission the agent is blocked on (`agent_requests.kind = 'permission'`).
 *
 * Two rules shape this card. First, the summary is the bounded, redacted description the pure
 * formatters produced — a path, a host, an argv0 — never the raw command or file content, so
 * nothing here needs to re-sanitize anything and nothing here may re-expand it.
 *
 * Second, the only decisions offered are the ones the first release can actually apply:
 * allow-once and deny. Standing permissions (`allow_always`, persistent policy, Cursor's
 * universal approval) are deliberately absent — a button that appears to grant a standing
 * allowance and silently grants a single one is a trust problem, not a polish problem.
 */

/** Option kinds this release refuses to render even when an adapter offers them. */
const PERSISTENT_OPTION_KINDS = new Set([
  'allow_always',
  'always',
  'persistent_allow',
  'universal',
  'allow_all'
]);

/** Native decision each rendered option maps to when the request carries no explicit options. */
type PermissionDecision = 'allow' | 'deny';

export function PermissionRequestCard({
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

  const answerable = isRequestAnswerable(
    request,
    channel,
    remainingMs === null ? undefined : Date.now()
  );
  const windowClosed = remainingMs !== null && remainingMs <= 0;
  const busy = resolve.isPending || release.isPending;

  // Adapter-supplied options win when present, minus anything persistent. With no options —
  // which is what every shipped connector produces today — fall back to the two decisions the
  // connector-owned decision codecs are proven to encode.
  const offered = request.options.filter(option => !PERSISTENT_OPTION_KINDS.has(option.kind));

  const answer = (resolution: Record<string, unknown>) => {
    resolve.mutate(
      { requestId: request.id, resolution, expectedRevision: request.revision },
      { onSuccess: result => setLostRace(!result.resolved) }
    );
  };

  const decide = (decision: PermissionDecision) => answer({ decision });

  return (
    <AgentSessionCardShell
      icon={ShieldQuestion}
      title="Permission request"
      tone="action"
      timestamp={request.createdAt}
      badges={
        <>
          {answerable && remainingMs !== null && remainingMs > 0 ? (
            <CardBadge>{formatCountdown(remainingMs)}</CardBadge>
          ) : null}
          {request.status === 'open' && windowClosed ? <CardBadge>window closed</CardBadge> : null}
        </>
      }
    >
      <RequestSummaryText text={request.summary} />

      {answerable && !windowClosed ? (
        <div className="flex flex-wrap items-center gap-2">
          {offered.length > 0 ? (
            offered.map(option => (
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
                onClick={() => decide('allow')}
                className="rounded bg-(--color-ink) px-2.5 py-1 text-xs font-medium text-(--color-paper) disabled:opacity-40"
              >
                Allow once
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide('deny')}
                className="rounded border border-red-400/60 px-2.5 py-1 text-xs font-medium text-red-600 disabled:opacity-40 dark:text-red-400"
              >
                Deny
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
      {release.isError ? (
        <p className="text-[11px] text-red-600">{(release.error as Error).message}</p>
      ) : null}

      <ReleasedElsewhereBanner request={request} channel={channel} />
      {request.status === 'open' && windowClosed ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          The remote window closed. Answer at the terminal instead.
        </p>
      ) : null}
    </AgentSessionCardShell>
  );
}
