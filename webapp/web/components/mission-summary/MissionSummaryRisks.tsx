import { useId } from 'react';

import type { SummaryRiskRow } from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';

import { ObjectiveKeyLink, SummaryBlockHeading } from './MissionSummaryParts.tsx';

/**
 * Risks (plan §5.2): the composer's significant risks, or the deterministic
 * list when the summary is a `fallback`. The heading reads `Risks` either way.
 */
export function MissionSummaryRisks({
  rows,
  dimmed
}: {
  rows: readonly SummaryRiskRow[];
  /** Previous content under the updating strip. */
  dimmed: boolean;
}) {
  const headingId = useId();
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 border-t border-(--color-border) px-5 py-2.5 text-xs text-(--color-ink-dim)',
          dimmed && 'opacity-55'
        )}
      >
        <SummaryBlockHeading id={headingId} label="Risks" />
        <span>None significant</span>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'grid gap-1.5 border-t border-(--color-border) px-5 pb-2.5 pt-3',
        dimmed && 'opacity-55'
      )}
    >
      <SummaryBlockHeading
        id={headingId}
        label="Risks"
        count={rows.length}
        countClassName="text-red-700 dark:text-red-300"
      />
      <ul className="grid">
        {rows.map(row => (
          <li
            key={row.key}
            className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-3 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0"
          >
            {/* An unread risk inverts the glyph (deep red fill, light bang) instead of adding a dot. */}
            <span
              {...(row.isNew
                ? { role: 'img', 'aria-label': 'New since your last visit' }
                : { 'aria-hidden': true })}
              className={cn(
                'mt-0.5 inline-flex size-4 items-center justify-center rounded-full text-[11px] font-bold',
                row.isNew
                  ? 'bg-red-700 text-red-50 dark:bg-red-600 dark:text-white'
                  : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200'
              )}
            >
              !
            </span>
            <span className="min-w-0 text-(--color-ink) wrap-anywhere">{row.text}</span>
            <ObjectiveKeyLink
              objectiveKey={row.objectiveKey}
              chevron
              ariaLabel={
                row.objectiveKey ? `Open the delivery in objective ${row.objectiveKey}` : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
