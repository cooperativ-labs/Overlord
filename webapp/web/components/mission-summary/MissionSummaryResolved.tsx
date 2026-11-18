import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ApiRequestError } from '../../lib/api.ts';
import { relativeTime } from '../../lib/format-date.ts';
import {
  useEvidenceGroupCoverage,
  useForegroundVisible
} from '../../lib/hooks/use-mission-summary-seen.ts';
import {
  missionItemResolverText,
  type SummaryClosedItemRow,
  type SummaryResolver
} from '../../lib/mission-summary-derive.ts';
import { useRestoreMissionItem } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';

import { ObjectiveKeyLink, summaryFocusRing } from './MissionSummaryParts.tsx';

/** `by coo:1.abcd` (a link to the closing objective), `by you`, `by Dana`, `by an agent`. */
export function ResolverName({ resolver }: { resolver: SummaryResolver }) {
  if (resolver.kind === 'agent' && resolver.crossMission) {
    return (
      <>
        by{' '}
        {resolver.missionKey ? (
          <Link
            to="/feed/missions/$missionId"
            params={{ missionId: resolver.missionKey }}
            search={{ objective: resolver.objectiveKey ?? undefined }}
            className="hover:underline font-mono"
          >
            {resolver.objectiveKey ?? resolver.missionKey}
          </Link>
        ) : (
          missionItemResolverText(resolver)
        )}
        {resolver.objectiveKey && resolver.missionKey ? (
          <span>
            {' '}
            on{' '}
            <Link
              to="/feed/missions/$missionId"
              params={{ missionId: resolver.missionKey }}
              search={{}}
              className="hover:underline font-mono"
            >
              {resolver.missionKey}
            </Link>
          </span>
        ) : null}
        {resolver.notDelivered ? <span> · Not delivered yet</span> : null}
      </>
    );
  }
  if (resolver.kind === 'agent' && resolver.objectiveKey) {
    return (
      <>
        by{' '}
        <ObjectiveKeyLink
          objectiveKey={resolver.objectiveKey}
          ariaLabel={`Open objective ${resolver.objectiveKey}, which resolved this item`}
        />
      </>
    );
  }
  return <>by {missionItemResolverText(resolver)}</>;
}

function restoreError(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.code === 'mission_item_superseded') {
    return 'A later delivery replaced this item, so it cannot be restored.';
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

function ResolvedRow({
  row,
  missionId,
  now,
  coverage
}: {
  row: SummaryClosedItemRow;
  missionId: string;
  now: string;
  coverage?: {
    active: boolean;
    signature: string;
    onCovered: (id: string, signature: string) => void;
  };
}) {
  const ref = useRef<HTMLLIElement>(null);
  const visible = useForegroundVisible(ref, coverage?.active ?? false);
  useEvidenceGroupCoverage({
    group: row.id,
    signature: coverage?.signature ?? null,
    active: visible,
    onCovered: coverage?.onCovered ?? (() => {})
  });
  const restore = useRestoreMissionItem();
  const [error, setError] = useState<string | null>(null);
  const StatusIcon = row.status === 'dismissed' ? X : Check;

  async function onRestore() {
    setError(null);
    try {
      await restore.mutateAsync({ id: row.id, missionId });
    } catch (cause) {
      setError(restoreError(cause));
    }
  }

  return (
    <li
      ref={ref}
      className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-3 border-t border-(--color-ink)/[0.07] py-2 text-sm first:border-t-0"
    >
      <StatusIcon
        className="mt-0.5 size-3.5 text-(--color-ink-dim)"
        strokeWidth={3}
        aria-hidden="true"
      />
      <div className="grid min-w-0 gap-0.5">
        <span className="min-w-0 text-(--color-ink-dim) wrap-anywhere">
          <span className="mr-1.5 inline-flex items-center rounded bg-(--color-muted) px-1.5 align-[1px] text-[10px] font-bold uppercase leading-4 tracking-wide text-(--color-ink-dim)">
            {row.kindLabel}
          </span>
          {row.text}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-(--color-ink-dim)">
          <span className="font-medium text-(--color-ink)">{row.outcomeLabel}</span>
          {row.resolver ? <ResolverName resolver={row.resolver} /> : null}
          {row.resolvedAt ? (
            <span>· {relativeTime(row.resolvedAt, now, { immediate: 'just now' })}</span>
          ) : null}
        </span>
        {row.reason ? (
          <span className="min-w-0 text-xs text-(--color-ink) wrap-anywhere">
            <span className="sr-only">Reason: </span>“{row.reason}”
          </span>
        ) : null}
        {error ? (
          <span className="text-xs text-red-600 dark:text-red-300" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={restore.isPending}
        onClick={() => void onRestore()}
        aria-label={`Restore ${row.kindLabel.toLowerCase()}: ${row.text}`}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap px-1 text-xs font-medium text-(--color-ink-dim) hover:text-(--color-ink) disabled:opacity-50',
          summaryFocusRing
        )}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {restore.isPending ? 'Restoring…' : 'Restore'}
      </button>
    </li>
  );
}

/**
 * Resolved (contract v173): done and dismissed risks, actions and suggestions,
 * newest first, with who resolved each, the reason, and Restore. Collapsed by
 * default; hidden when nothing is resolved.
 */
export function MissionSummaryResolved({
  rows,
  missionId,
  now,
  headless = false,
  isNew = false,
  coverage,
  truncated = false
}: {
  rows: readonly SummaryClosedItemRow[];
  missionId: string;
  now: string;
  /**
   * Rendered inside a tab that already names it: no top border, no collapsing heading, and the
   * list is shown, since selecting the tab is the person's request to see it.
   */
  headless?: boolean;
  isNew?: boolean;
  truncated?: boolean;
  coverage?: {
    active: boolean;
    signature: string;
    onCovered: (id: string, signature: string) => void;
  };
}) {
  const [expanded, setExpanded] = useState(isNew);
  useEffect(() => {
    if (isNew) setExpanded(true);
  }, [isNew, coverage?.signature]);
  const listId = useId();
  if (rows.length === 0) return null;
  if (headless) {
    return (
      <section aria-label="Resolved items" className="grid gap-1.5 px-5 py-2.5">
        <ul id={listId} className="grid">
          {rows.map(row => (
            <ResolvedRow
              key={row.id}
              row={row}
              missionId={missionId}
              now={now}
              coverage={
                coverage
                  ? { ...coverage, active: coverage.active && (headless || expanded) }
                  : undefined
              }
            />
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section
      aria-label="Resolved items"
      className="grid gap-1.5 border-t border-(--color-border) px-5 py-2.5"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(value => !value)}
        className={cn(
          'flex w-fit items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-wide text-(--color-ink-dim) hover:text-(--color-ink)',
          summaryFocusRing
        )}
      >
        {expanded ? (
          <ChevronDown className="size-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3" aria-hidden="true" />
        )}
        <span>Resolved</span>
        <span>
          {rows.length}
          {truncated ? '+' : ''}
        </span>
        {isNew ? <span className="text-sky-500">New</span> : null}
      </button>
      {truncated ? (
        <p className="text-xs text-(--color-ink-dim)">
          Showing the latest 100 resolved items. This partial snapshot will remain unread.
        </p>
      ) : null}
      <ul id={listId} hidden={!expanded} className="grid">
        {rows.map(row => (
          <ResolvedRow
            key={row.id}
            row={row}
            missionId={missionId}
            now={now}
            coverage={
              coverage
                ? { ...coverage, active: coverage.active && (headless || expanded) }
                : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}
