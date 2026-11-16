import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';

import { useObjectiveDetailNavigation } from '../../lib/hooks/use-objective-detail-navigation.ts';
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
 * Opens an objective's detail through the shared objective navigation helper (plan §9.1), so a
 * summary link behaves exactly like a row: from the mission it pushes one detail entry, with a
 * detail already open it replaces it.
 */
export function useFocusObjective(): (objectiveKey: string) => void {
  return useObjectiveDetailNavigation().open;
}

/**
 * An objective key that opens its detail. A null key is a delivery whose
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
