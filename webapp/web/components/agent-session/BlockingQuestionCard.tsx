import { HelpCircle } from 'lucide-react';
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
 * A blocking question (`agent_requests.kind = 'question'`).
 *
 * The agent is stopped until a human writes something back, so the question body is shown in
 * full rather than clamped, and the reply box is part of the card instead of somewhere else in
 * the panel. Structured options are offered alongside the free-text box when the harness
 * supplied them — a question can be both "pick one" and "or say why".
 *
 * Release and expiry behave exactly as they do for a permission: once the native prompt owns
 * the question, this card stops pretending it can answer.
 */
export function BlockingQuestionCard({
  request,
  channel
}: {
  request: AgentRequestDto;
  channel: AgentSessionChannelSnapshotDto | null;
}) {
  const resolve = useResolveAgentRequest(request.missionId ?? '');
  const release = useReleaseAgentRequest(request.missionId ?? '');
  const remainingMs = useWindowCountdown(request.windowExpiresAt);
  const [text, setText] = useState('');
  const [lostRace, setLostRace] = useState(false);

  const answerable = isRequestAnswerable(request, channel);
  const windowClosed = remainingMs !== null && remainingMs <= 0;
  const busy = resolve.isPending || release.isPending;
  // `allowsFreeText` is false only when the harness genuinely cannot accept prose. When a
  // question carries no options at all, prose is the only possible answer.
  const acceptsText = request.allowsFreeText || request.options.length === 0;

  const answer = (resolution: Record<string, unknown>) => {
    resolve.mutate(
      { requestId: request.id, resolution, expectedRevision: request.revision },
      {
        onSuccess: result => {
          setLostRace(!result.resolved);
          if (result.resolved) setText('');
        }
      }
    );
  };

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

      {answerable && !windowClosed ? (
        <div className="grid gap-2">
          {request.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {request.options.map(option => (
                <button
                  key={option.optionId}
                  type="button"
                  disabled={busy}
                  onClick={() => answer({ optionId: option.optionId })}
                  className="rounded border border-(--color-line) px-2 py-1 text-xs font-medium disabled:opacity-40"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {acceptsText ? (
            <form
              className="flex gap-2"
              onSubmit={event => {
                event.preventDefault();
                const trimmed = text.trim();
                if (trimmed) answer({ text: trimmed });
              }}
            >
              <input
                className="min-w-0 flex-1 rounded border border-(--color-line) bg-transparent px-2 py-1.5 text-sm"
                placeholder="Answer the agent…"
                value={text}
                onChange={event => setText(event.target.value)}
              />
              <button
                type="submit"
                disabled={busy || !text.trim()}
                className="rounded bg-(--color-ink) px-3 py-1.5 text-sm text-(--color-paper) disabled:opacity-40"
              >
                Reply
              </button>
            </form>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => release.mutate(request.id)}
            className="justify-self-start text-xs text-(--color-ink-dim) underline-offset-2 hover:underline disabled:opacity-40"
          >
            Respond in terminal
          </button>
        </div>
      ) : null}

      {lostRace ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Someone answered this first. Your reply was not recorded.
        </p>
      ) : null}
      {resolve.isError ? (
        <p className="text-[11px] text-red-600">{(resolve.error as Error).message}</p>
      ) : null}

      <ReleasedElsewhereBanner request={request} channel={channel} />
    </AgentSessionCardShell>
  );
}
