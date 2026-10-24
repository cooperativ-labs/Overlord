import { Check, ChevronDown, ChevronRight, ListChecks, MessageCircleQuestion } from 'lucide-react';
import { useId, useState } from 'react';

import type { SummaryActionRow } from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';
import { HumanActionDetails } from '../HumanActionDetails.tsx';

import {
  NewDot,
  ObjectiveKeyLink,
  SummaryBlockHeading,
  summaryFocusRing
} from './MissionSummaryParts.tsx';

function KindChip({ row }: { row: SummaryActionRow }) {
  if (row.kind === 'action' && !row.blocking) return null;
  const label = row.kind === 'action' ? 'Blocking' : row.kind === 'choice' ? 'Choice' : 'Question';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 text-[10px] font-bold uppercase leading-4 tracking-wide',
        row.kind === 'action'
          ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
      )}
    >
      {label}
    </span>
  );
}

function hasDetails(row: SummaryActionRow): boolean {
  return Boolean(row.command?.trim() || row.verify?.trim() || row.link?.trim());
}

function ActionRow({ row }: { row: SummaryActionRow }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const expandable = row.kind === 'action' && hasDetails(row);
  const meta = [row.kind === 'action' ? row.category : null, row.detail]
    .filter(Boolean)
    .join(' · ');
  const Glyph = row.kind === 'action' ? ListChecks : MessageCircleQuestion;

  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_16px] items-start gap-3 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0">
      <Glyph
        className={cn(
          'mt-0.5 size-4',
          row.kind === 'action'
            ? 'text-sky-700 dark:text-sky-300'
            : 'text-amber-700 dark:text-amber-300'
        )}
        aria-hidden="true"
      />
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {row.isNew ? <NewDot /> : null}
          <span className="min-w-0 font-medium text-(--color-ink) wrap-anywhere">{row.title}</span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-(--color-ink-dim)">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <KindChip row={row} />
            {meta ? <span className="min-w-0 wrap-anywhere">{meta}</span> : null}
          </div>
          <ObjectiveKeyLink
            objectiveKey={row.objectiveKey}
            chevron
            ariaLabel={
              row.objectiveKey
                ? row.kind === 'action'
                  ? `Open the delivery in objective ${row.objectiveKey}`
                  : `Answer in objective ${row.objectiveKey}`
                : undefined
            }
          />
        </div>
        {expandable ? (
          <div
            id={detailsId}
            hidden={!expanded}
            className="border-l-2 border-sky-200 pl-2.5 dark:border-sky-500/40"
          >
            <HumanActionDetails action={row} tone="sky" className="mt-0" />
          </div>
        ) : null}
      </div>
      {expandable ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={expanded ? `Hide details: ${row.title}` : `Show details: ${row.title}`}
          onClick={() => setExpanded(value => !value)}
          className={cn(
            'mt-0.5 inline-flex size-4 items-center justify-center text-(--color-ink-dim) hover:text-(--color-ink)',
            summaryFocusRing
          )}
        >
          {expanded ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3" aria-hidden="true" />
          )}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  );
}

/**
 * Your actions (plan §5.2, §5.3): human actions of each objective's latest
 * current-run delivery plus open questions and choices. Rows show; nothing is
 * ticked off (§4.6). An action row expands to its command, verify and link.
 */
export function MissionSummaryActions({
  rows,
  totalActions,
  truncated
}: {
  rows: readonly SummaryActionRow[];
  /** Pre-cap count of delivery actions, when the evidence list was cut. */
  totalActions: number;
  truncated: boolean;
}) {
  const headingId = useId();
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2.5 border-t border-(--color-border) bg-sky-50/60 px-5 py-3 text-sm text-(--color-ink-dim) dark:bg-sky-500/5">
        <Check className="size-3.5 text-emerald-600" strokeWidth={3} aria-hidden="true" />
        <span>No open actions</span>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-1.5 border-t border-(--color-border) bg-sky-50/60 px-5 pb-2.5 pt-3 dark:bg-sky-500/5"
    >
      <SummaryBlockHeading
        id={headingId}
        label="Your actions"
        count={rows.length}
        countClassName="text-sky-700 dark:text-sky-300"
      />
      <ul className="grid">
        {rows.map(row => (
          <ActionRow key={row.key} row={row} />
        ))}
      </ul>
      {truncated ? (
        <p className="text-xs text-(--color-ink-dim)">
          Showing the newest delivery actions; {totalActions} are open in all. Open the objectives
          for the rest.
        </p>
      ) : null}
    </section>
  );
}
