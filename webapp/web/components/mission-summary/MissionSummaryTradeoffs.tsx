import { Scale } from 'lucide-react';
import { useId } from 'react';

import type { SummaryTradeoffRow } from '../../lib/mission-summary-derive.ts';

import { ObjectiveKeyLink, SummaryBlockHeading } from './MissionSummaryParts.tsx';

function TradeoffRow({ row }: { row: SummaryTradeoffRow }) {
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0">
      <Scale className="mt-0.5 size-3.5 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <div className="grid min-w-0 gap-0.5">
        <span className="min-w-0 font-medium text-(--color-ink) wrap-anywhere">{row.decision}</span>
        {row.rationale ? (
          <span className="min-w-0 text-(--color-ink-dim) wrap-anywhere">{row.rationale}</span>
        ) : null}
        {row.impact ? (
          <span className="min-w-0 text-xs text-(--color-ink-dim) wrap-anywhere">
            Impact: {row.impact}
          </span>
        ) : null}
        {row.alternativesConsidered.length > 0 ? (
          <span className="min-w-0 text-xs text-(--color-ink-dim) wrap-anywhere">
            Considered: {row.alternativesConsidered.join(', ')}
          </span>
        ) : null}
      </div>
      <ObjectiveKeyLink
        objectiveKey={row.objectiveKey}
        chevron
        ariaLabel={
          row.objectiveKey ? `Open the delivery in objective ${row.objectiveKey}` : undefined
        }
      />
    </li>
  );
}

/**
 * Tradeoffs: decisions the agents reported making across the mission's deliveries, so a
 * person can review them. Optional at delivery; the section is hidden when there are none.
 */
export function MissionSummaryTradeoffs({ rows }: { rows: readonly SummaryTradeoffRow[] }) {
  const headingId = useId();
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-1.5 border-t border-(--color-border) px-5 pb-2.5 pt-3"
    >
      <SummaryBlockHeading
        id={headingId}
        label="Tradeoffs"
        count={rows.length}
        countClassName="text-amber-700 dark:text-amber-300"
      />
      <ul className="grid">
        {rows.map(row => (
          <TradeoffRow key={row.key} row={row} />
        ))}
      </ul>
    </section>
  );
}
