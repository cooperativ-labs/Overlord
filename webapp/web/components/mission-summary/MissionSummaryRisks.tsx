import { useId } from 'react';

import type { SummaryRiskRow } from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';

import {
  ResolveItemButton,
  ResolveItemForm,
  useResolveDisclosure
} from './MissionSummaryItemControls.tsx';
import { GroupSources, ObjectiveKeyLink, SummaryBlockHeading } from './MissionSummaryParts.tsx';

function RiskRow({ row, missionId }: { row: SummaryRiskRow; missionId: string }) {
  const disclosure = useResolveDisclosure();
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0">
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
      <span className="grid min-w-0 gap-0.5">
        <span className="min-w-0 text-(--color-ink) wrap-anywhere">{row.text}</span>
        <GroupSources group={row.group} noun="risk" />
      </span>
      <span className="flex items-center gap-2">
        <ResolveItemButton
          disclosure={disclosure}
          noun="risk"
          itemText={row.text}
          count={row.group.count}
        />
        <ObjectiveKeyLink
          objectiveKey={row.objectiveKey}
          chevron
          ariaLabel={
            row.objectiveKey ? `Open the delivery in objective ${row.objectiveKey}` : undefined
          }
        />
      </span>
      {disclosure.open ? (
        <div className="col-span-2 col-start-2">
          <ResolveItemForm
            disclosure={disclosure}
            itemIds={row.group.itemIds}
            missionId={missionId}
            noun="risk"
            itemText={row.text}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Risks: the open risks of the mission's `mission_items` (contract v173). Each
 * row can be resolved as done or dismissed; resolved risks move to Resolved.
 */
export function MissionSummaryRisks({
  rows,
  missionId,
  dimmed,
  headless = false
}: {
  rows: readonly SummaryRiskRow[];
  missionId: string;
  /** Previous content under the updating strip. */
  dimmed: boolean;
  /** Rendered inside a tab that already names it: no top border and no heading. */
  headless?: boolean;
}) {
  const headingId = useId();
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 px-5 py-2.5 text-xs text-(--color-ink-dim)',
          !headless && 'border-t border-(--color-border)',
          dimmed && 'opacity-55'
        )}
      >
        {headless ? null : <SummaryBlockHeading id={headingId} label="Risks" />}
        <span>None significant</span>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={headless ? undefined : headingId}
      aria-label={headless ? 'Risks' : undefined}
      className={cn(
        'grid gap-1.5 px-5 pb-2.5 pt-3',
        !headless && 'border-t border-(--color-border)',
        dimmed && 'opacity-55'
      )}
    >
      {headless ? null : (
        <SummaryBlockHeading
          id={headingId}
          label="Risks"
          count={rows.length}
          countClassName="text-red-700 dark:text-red-300"
        />
      )}
      <ul className="grid">
        {rows.map(row => (
          <RiskRow key={row.key} row={row} missionId={missionId} />
        ))}
      </ul>
    </section>
  );
}
