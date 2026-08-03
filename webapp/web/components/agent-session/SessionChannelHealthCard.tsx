import { PlugZap, Radio, TriangleAlert } from 'lucide-react';

import type { AgentSessionChannelSnapshotDto } from '../../../shared/contract.ts';

import { AgentSessionCardShell, CardBadge, formatCardTimestamp } from './AgentSessionCardShell.tsx';

/**
 * Session channel health — degraded heartbeat, lost channel, provider or auth failure.
 *
 * This is *state*, not history, so it renders once at the top of the section instead of adding
 * a row every time a heartbeat slips. A healthy `online` channel renders nothing at all: the
 * mission panel does not need a green light telling it that nothing is wrong.
 *
 * `preparing` means the Agent Session *channel* has not bound yet — not that the agent process
 * is idle. Protocol attach/update/deliver can proceed independently; this card only speaks to
 * the interactive pipe that carries permission prompts and session inputs.
 *
 * It matters because every action card in this section is gated on this channel. When it goes
 * `lost` or `ended`, the buttons above disappear, and a human deserves to be told why rather
 * than watching controls silently vanish.
 */

const STATE_COPY: Record<
  string,
  { title: string; tone: 'neutral' | 'alert'; icon: typeof Radio; body: string }
> = {
  preparing: {
    title: 'Agent Session channel starting',
    tone: 'neutral',
    icon: PlugZap,
    body: 'The interactive Agent Session channel is not connected yet. The agent may already be running this mission via protocol; permission prompts and session inputs appear here only after this channel connects.'
  },
  degraded: {
    title: 'Session degraded',
    tone: 'alert',
    icon: TriangleAlert,
    body: 'Heartbeats are late. Answers sent from here may not reach the agent in time — prefer the terminal.'
  },
  lost: {
    title: 'Session lost',
    tone: 'alert',
    icon: TriangleAlert,
    body: 'The channel stopped responding. Open requests were released to the terminal and queued instructions expired.'
  },
  ended: {
    title: 'Session ended',
    tone: 'neutral',
    icon: PlugZap,
    body: 'This session is finished. Nothing here can be answered or sent any more.'
  }
};

export function SessionChannelHealthCard({
  channel
}: {
  channel: AgentSessionChannelSnapshotDto | null;
}) {
  // No channel at all, or a healthy one: say nothing.
  if (!channel || channel.state === 'online') return null;
  const copy = STATE_COPY[channel.state];
  if (!copy) return null;

  const timestamp = channel.endedAt ?? channel.lastHeartbeatAt;

  return (
    <AgentSessionCardShell
      icon={copy.icon}
      title={copy.title}
      tone={copy.tone}
      timestamp={timestamp ?? new Date().toISOString()}
      badges={channel.agentIdentifier ? <CardBadge>{channel.agentIdentifier}</CardBadge> : null}
    >
      <p className="text-sm text-(--color-ink-dim)">{copy.body}</p>
      {channel.endReason ? (
        <p className="text-[11px] text-(--color-ink-dim)">Reason: {channel.endReason}</p>
      ) : null}
      {channel.state === 'degraded' && channel.lastHeartbeatAt ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Last heartbeat {formatCardTimestamp(channel.lastHeartbeatAt)}
        </p>
      ) : null}
    </AgentSessionCardShell>
  );
}
