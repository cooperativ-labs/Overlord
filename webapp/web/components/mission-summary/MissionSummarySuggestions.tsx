import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import type { HumanActionResolutionDto } from '../../../shared/contract.ts';
import { relativeTime } from '../../lib/format-date.ts';
import type { SummarySuggestionRow } from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';
import { deferredWorkActionButtonClass, useDeferredWorkActions } from '../DeferredWorkItem.tsx';

import {
  NewDot,
  ObjectiveKeyLink,
  SummaryBlockHeading,
  summaryFocusRing
} from './MissionSummaryParts.tsx';

/** A promoted suggestion: title plus where it went, with no detail accordion. */
function ResolvedSuggestionRow({
  title,
  resolution,
  now
}: {
  title: string;
  resolution: HumanActionResolutionDto;
  now: string;
}) {
  const ref = resolution.outcomeRef;
  return (
    <li className="border-t border-(--color-ink)/[0.07] py-2 text-xs text-(--color-ink-dim) first:border-t-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <Check className="size-3 shrink-0 text-emerald-600" strokeWidth={3} aria-hidden="true" />
        {resolution.outcome === 'mission_created' ? (
          <>
            <span className="shrink-0">Created as mission</span>
            {ref ? <span className="shrink-0 font-mono">{ref}</span> : null}
          </>
        ) : (
          <>
            <span className="shrink-0">Added as</span>
            {ref ? <ObjectiveKeyLink objectiveKey={ref} /> : <span>an objective</span>}
          </>
        )}
        <span className="min-w-0 truncate">
          · {title} · {relativeTime(resolution.resolvedAt, now, { immediate: 'just now' })}
        </span>
      </div>
    </li>
  );
}

function OpenSuggestionRow({
  row,
  missionId,
  now
}: {
  row: Extract<SummarySuggestionRow, { state: 'open' }>;
  missionId: string;
  now: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const actions = useDeferredWorkActions({
    deliveryId: row.deliveryId,
    actionId: row.actionId,
    title: row.title,
    change: row.change,
    location: row.location,
    doneWhen: row.doneWhen,
    missionId,
    objectiveId: row.objectiveId,
    resolution: row.resolution
  });

  // The decision is shown at once; the summary refetch then projects it.
  if (actions.resolution?.status === 'dismissed') return null;
  if (actions.resolution) {
    return <ResolvedSuggestionRow title={row.title} resolution={actions.resolution} now={now} />;
  }

  return (
    <li className="grid gap-2 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(value => !value)}
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_16px] items-start gap-3 text-left',
          summaryFocusRing
        )}
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            {row.isNew ? <NewDot /> : null}
            <span className="min-w-0 font-medium text-(--color-ink) wrap-anywhere">
              {row.title}
            </span>
          </span>
          <span className="min-w-0 text-xs text-(--color-ink-dim) wrap-anywhere">
            <span className="font-mono">{row.location}</span> · from{' '}
            <span className="font-mono">{row.objectiveKey ?? 'Delivery'}</span>
          </span>
        </span>
        <span className="mt-0.5 text-(--color-ink-dim)" aria-hidden="true">
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      <div
        id={bodyId}
        hidden={!expanded}
        className="grid gap-2 border-l-2 border-violet-200 pl-3 sm:mr-7 dark:border-violet-500/40"
      >
        <p className="text-sm leading-relaxed text-(--color-ink) wrap-anywhere">{row.change}</p>
        <p className="text-xs leading-normal text-(--color-ink-dim) wrap-anywhere">
          <span className="font-semibold text-(--color-ink)">Done when:</span> {row.doneWhen}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={actions.busy}
              onClick={() => void actions.addObjective()}
              className={cn(deferredWorkActionButtonClass, 'px-2.5 py-1', summaryFocusRing)}
            >
              {actions.pending === 'objective' ? 'Adding…' : '+ Objective on this mission'}
            </button>
            <button
              type="button"
              disabled={actions.busy}
              onClick={() => void actions.createMission()}
              className={cn(deferredWorkActionButtonClass, 'px-2.5 py-1', summaryFocusRing)}
            >
              {actions.pending === 'mission' ? 'Creating…' : '+ New mission'}
            </button>
          </div>
          <button
            type="button"
            disabled={actions.busy}
            onClick={() => void actions.dismiss()}
            aria-label={`Dismiss: ${row.title}`}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium text-(--color-ink-dim) hover:text-(--color-ink) disabled:opacity-50',
              summaryFocusRing
            )}
          >
            {actions.pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
        {actions.error ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">
            {actions.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Suggested next (plan §5.2, §5.3): the agents' deferred-work items, verbatim,
 * open ones first. Promotion and dismissal reuse the delivery card's handlers.
 * No model text appears in this block.
 */
export function MissionSummarySuggestions({
  rows,
  missionId,
  now
}: {
  rows: readonly SummarySuggestionRow[];
  missionId: string;
  now: string;
}) {
  const headingId = useId();
  if (rows.length === 0) return null;
  const openCount = rows.filter(row => row.state === 'open').length;
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-1.5 border-t border-(--color-border) bg-violet-50/60 px-5 pb-2.5 pt-3 dark:bg-violet-500/5"
    >
      <SummaryBlockHeading id={headingId} label="Suggested next" count={openCount} />
      <ul className="grid">
        {rows.map(row =>
          row.state === 'open' ? (
            <OpenSuggestionRow
              key={`${row.deliveryId}:${row.actionId}`}
              row={row}
              missionId={missionId}
              now={now}
            />
          ) : (
            <ResolvedSuggestionRow
              key={`${row.deliveryId}:${row.actionId}`}
              title={row.title}
              resolution={row.resolution}
              now={now}
            />
          )
        )}
      </ul>
    </section>
  );
}
