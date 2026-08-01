import { CheckCircle2, Terminal, TimerOff, XCircle } from 'lucide-react';

import type { AgentRequestDto, AgentSessionChannelSnapshotDto } from '../../../shared/contract.ts';

import { isChannelLive } from '../../lib/mission-feed.ts';

/**
 * Why a card no longer owns its decision.
 *
 * This is state on a request card rather than a feed row of its own. The dangerous UI is the
 * one that still shows live buttons after the native prompt took over, so every request card
 * renders this banner and hides its controls whenever it returns something.
 */

const RELEASE_REASON_TEXT: Record<string, string> = {
  timeout: 'The remote decision window closed. Answer at the terminal.',
  local_activity: 'Someone was active at the terminal. The native prompt owns this decision.',
  resolved_elsewhere: 'Answered at the terminal.',
  policy: 'Released to the terminal. Answer at the native prompt.',
  interrupt: 'The agent interrupted this request. Answer at the terminal if it reappears.',
  channel_ended: 'The session ended before this was answered.'
};

function resolutionLabel(resolution: Record<string, unknown> | null): string | null {
  if (!resolution) return null;
  const optionId = resolution.optionId;
  const text = resolution.text;
  if (typeof optionId === 'string' && optionId.trim()) return optionId;
  if (typeof text === 'string' && text.trim()) {
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  return null;
}

export function ReleasedElsewhereBanner({
  request,
  channel
}: {
  request: AgentRequestDto;
  channel: AgentSessionChannelSnapshotDto | null;
}) {
  if (request.status === 'resolved') {
    const answer = resolutionLabel(request.resolution);
    return (
      <Banner
        icon={CheckCircle2}
        className="text-emerald-700 dark:text-emerald-400"
        text={answer ? `Answered: ${answer}` : 'Answered.'}
        // `emitted` only means the adapter wrote the decision; a harness can still ignore it.
        note={
          request.applicationState === 'applied'
            ? 'Applied by the harness.'
            : request.applicationState === 'not_applied'
              ? 'The harness did not apply this decision.'
              : request.applicationState === 'emitted'
                ? 'Sent to the agent; not yet confirmed applied.'
                : null
        }
      />
    );
  }

  if (request.status === 'released_to_terminal') {
    const reason = request.releasedReason ?? '';
    return (
      <Banner
        icon={Terminal}
        className="text-(--color-ink-dim)"
        text={RELEASE_REASON_TEXT[reason] ?? 'This decision moved to the terminal.'}
      />
    );
  }

  if (request.status === 'expired') {
    return (
      <Banner
        icon={TimerOff}
        className="text-(--color-ink-dim)"
        text="This request expired before it was answered."
      />
    );
  }

  if (request.status === 'cancelled') {
    return (
      <Banner
        icon={XCircle}
        className="text-(--color-ink-dim)"
        text="The agent withdrew this request."
      />
    );
  }

  // Still open, but nothing here can carry an answer back to the agent.
  if (!isChannelLive(channel)) {
    return (
      <Banner
        icon={Terminal}
        className="text-(--color-ink-dim)"
        text="The session is no longer live, so this cannot be answered from here."
      />
    );
  }

  return null;
}

function Banner({
  icon: Icon,
  text,
  note,
  className
}: {
  icon: typeof Terminal;
  text: string;
  note?: string | null;
  className: string;
}) {
  return (
    <div className={`flex items-start gap-1.5 text-[11px] ${className}`}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {text}
        {note ? <span className="block text-(--color-ink-dim)">{note}</span> : null}
      </span>
    </div>
  );
}
