import type { HumanAgentRequestDto } from '@overlord/contract';
import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { relativeTime } from '../../lib/format-date.ts';
import { cn } from '../../lib/utils.ts';

import { AgentRequestCard } from './AgentRequestCards.tsx';
import { firstLine } from './objective-detail-model.ts';

/**
 * The objective's open blocking requests (mission-panel-redesign plan §9.7), from the shared
 * complete open-request collection grouped by objective. Rendered only when there is at least
 * one; answered, expired and cancelled requests are not listed.
 *
 * Each row is a disclosure button in the blocked-row yellow: relative time, the question's
 * first line and "Answer". Its body is a sibling of the button (never nested in it) holding the
 * existing answer card. A row appears whether or not the request's top notification was
 * dismissed; while the notification still shows, the row starts collapsed so the form is not on
 * screen twice. When every open request's notification was dismissed as the detail opens, the
 * list scrolls into view with its first row expanded.
 */
export function ObjectiveBlockingQuestions({
  requests,
  stale = false,
  onRetry
}: {
  /** Open question/choice requests for this objective, oldest first. */
  requests: readonly HumanAgentRequestDto[];
  /** The shared collection failed to refresh; these rows are from the last successful read. */
  stale?: boolean;
  onRetry?: () => void;
}) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const first = requests[0];
    const allDismissed = requests.length > 0 && requests.every(request => request.dismissed);
    return first && allDismissed ? new Set([first.id]) : new Set();
  });
  const [scrollOnMount] = useState(
    () => requests.length > 0 && requests.every(request => request.dismissed)
  );
  useEffect(() => {
    if (scrollOnMount) sectionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [scrollOnMount]);

  if (requests.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const nowIso = new Date().toISOString();

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="grid min-w-0 gap-1.5">
      <h3
        id={headingId}
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Blocking questions
      </h3>
      {stale ? (
        <p role="status" className="text-xs text-(--color-ink-dim)">
          Could not refresh questions; showing the last known list.{' '}
          {onRetry ? (
            <button type="button" className="underline underline-offset-2" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      <ul className="grid min-w-0 gap-1">
        {requests.map(request => {
          const open = expanded.has(request.id);
          const bodyId = `${headingId}-${request.id}`;
          return (
            <li key={request.id} className="min-w-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => toggle(request.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md bg-yellow-300/60 px-2.5 py-2 text-left text-sm outline-none hover:bg-yellow-300/80 focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-yellow-400/25 dark:hover:bg-yellow-400/35"
              >
                <ChevronRight
                  className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                  aria-hidden="true"
                />
                <span className="shrink-0 text-[11px] text-(--color-ink-dim)">
                  {relativeTime(request.createdAt, nowIso)}
                </span>
                <span className="min-w-0 flex-1 truncate text-(--color-ink)">
                  {firstLine(request.summary) ||
                    (request.kind === 'choice' ? 'Choice' : 'Question')}
                </span>
                <span className="shrink-0 text-xs font-medium text-(--color-ink)">Answer</span>
              </button>
              <div id={bodyId} hidden={!open} className="mt-1.5 min-w-0">
                {open ? <AgentRequestCard request={request} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
