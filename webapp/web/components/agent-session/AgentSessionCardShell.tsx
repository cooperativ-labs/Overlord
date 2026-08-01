import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '../ui.tsx';

// The gating and ordering rules are pure and unit-tested; they are re-exported here so a card
// imports everything it needs from one place.
export { formatCountdown, isChannelLive, isRequestAnswerable } from '../../lib/mission-feed.ts';

/**
 * Shared chrome for every agent-session action card.
 *
 * The cards differ in what they *ask* — a permission, a question, a choice, a retry — but they
 * must not differ in how they report whether they still own the decision. That part lives here
 * so a new card kind cannot accidentally ship without it.
 */

export type CardTone = 'action' | 'question' | 'neutral' | 'alert';

const TONE_CLASSES: Record<CardTone, { frame: string; icon: string; title: string }> = {
  // Permissions and choices: something is blocked until a human acts.
  action: {
    frame: 'border-sky-400/50 bg-sky-50/60 dark:border-sky-500/40 dark:bg-sky-500/10',
    icon: 'text-sky-600 dark:text-sky-400',
    title: 'text-sky-700 dark:text-sky-300'
  },
  // Blocking questions, matching the amber treatment the feed already uses for `ask`.
  question: {
    frame: 'border-amber-400/50 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10',
    icon: 'text-amber-600 dark:text-amber-400',
    title: 'text-amber-700 dark:text-amber-300'
  },
  neutral: {
    frame: 'border-(--color-ink-dim)/20 bg-(--color-ink-dim)/5',
    icon: 'text-(--color-ink-dim)',
    title: 'text-(--color-ink)'
  },
  alert: {
    frame: 'border-red-400/50 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/10',
    icon: 'text-red-600 dark:text-red-400',
    title: 'text-red-700 dark:text-red-300'
  }
};

export function formatCardTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Live countdown for the remote decision window.
 *
 * Ticks locally rather than waiting for a refetch, because the moment that matters to a human
 * is the moment the buttons stop being honest — not the next poll after it.
 */
export function useWindowCountdown(windowExpiresAt: string | null): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    windowExpiresAt ? new Date(windowExpiresAt).getTime() - Date.now() : null
  );

  useEffect(() => {
    if (!windowExpiresAt) {
      setRemainingMs(null);
      return;
    }
    const expiry = new Date(windowExpiresAt).getTime();
    if (Number.isNaN(expiry)) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(expiry - Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [windowExpiresAt]);

  return remainingMs;
}

export function AgentSessionCardShell({
  icon: Icon,
  title,
  tone = 'neutral',
  timestamp,
  badges,
  children
}: {
  icon: LucideIcon;
  title: string;
  tone?: CardTone;
  timestamp: string;
  /** Short status chips rendered next to the title (window countdown, delivery label, …). */
  badges?: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes = TONE_CLASSES[tone];
  return (
    <article className={`flex min-w-0 gap-3 rounded-md border px-3 py-2 ${classes.frame}`}>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        <Icon className={`h-3.5 w-3.5 ${classes.icon}`} />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${classes.title}`}>{title}</span>
          {badges}
          <span className="text-[11px] text-(--color-ink-dim)">
            {formatCardTimestamp(timestamp)}
          </span>
        </div>
        {children}
      </div>
    </article>
  );
}

/** Small status chip used for window countdowns, delivery labels, and terminal states. */
export function CardBadge({ children }: { children: React.ReactNode }) {
  return <Badge className="px-2 py-0 text-[10px] uppercase tracking-wide">{children}</Badge>;
}

/**
 * The bounded, redacted request card text. Rendered as escaped plain text with preserved
 * whitespace — never as markdown or HTML, because it is derived from native tool payloads.
 */
export function RequestSummaryText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap wrap-anywhere text-sm text-(--color-ink-dim)">{text}</p>;
}
