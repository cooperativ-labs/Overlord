import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';

import { objectiveSearchFromLocation } from '../../lib/mission-panel-search.ts';
import { cn } from '../../lib/utils.ts';

/** Shared focus ring for every control in the section (plan §11 item 14). */
export const summaryFocusRing =
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';

/** Sub-block heading: uppercase label plus an optional count. */
export function SummaryBlockHeading({
  id,
  label,
  count,
  countClassName
}: {
  id: string;
  label: string;
  count?: number | string;
  countClassName?: string;
}) {
  return (
    <h3
      id={id}
      className="flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-wide text-(--color-ink-dim)"
    >
      <span>{label}</span>
      {count !== undefined ? <span className={countClassName}>{count}</span> : null}
    </h3>
  );
}

/** The new-since-last-visit dot. */
export function NewDot() {
  return (
    <span
      role="img"
      aria-label="New since your last visit"
      className="inline-block size-1.5 shrink-0 rounded-full bg-sky-400"
    />
  );
}

/**
 * Scrolls to, rings, and opens an objective row through the mission panel's
 * `?objective=` logic. Selecting the objective that is already focused only
 * scrolls, because the search value does not change.
 */
export function useFocusObjective(): (objectiveKey: string) => void {
  const navigate = useNavigate();
  const current = useRouterState({
    select: state => objectiveSearchFromLocation(state.location.search)
  });
  return useCallback(
    (objectiveKey: string) => {
      if (current === objectiveKey) {
        const node = document.querySelector(`[data-objective-ref="${CSS.escape(objectiveKey)}"]`);
        node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      void navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => ({ ...previous, objective: objectiveKey }),
        replace: true
      });
    },
    [current, navigate]
  );
}

/**
 * An objective key that scrolls to its row. A null key is a delivery whose
 * objective was deleted (plan §5.5): it renders as plain `Delivery` text.
 */
export function ObjectiveKeyLink({
  objectiveKey,
  ariaLabel,
  chevron = false,
  children,
  className
}: {
  objectiveKey: string | null;
  ariaLabel?: string;
  chevron?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const focusObjective = useFocusObjective();
  if (!objectiveKey) {
    return (
      <span className={cn('whitespace-nowrap text-xs text-(--color-ink-dim)', className)}>
        Delivery
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => focusObjective(objectiveKey)}
      aria-label={ariaLabel ?? `Open objective ${objectiveKey}`}
      className={cn(
        'inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-xs text-(--color-ink-dim) hover:text-(--color-ink) hover:underline',
        summaryFocusRing,
        className
      )}
    >
      {objectiveKey}
      {children}
      {chevron ? <ChevronRight className="size-3" aria-hidden="true" /> : null}
    </button>
  );
}
