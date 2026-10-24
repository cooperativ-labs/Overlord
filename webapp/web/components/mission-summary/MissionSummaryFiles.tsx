import { useId, useState } from 'react';

import {
  fileProvenanceLabel,
  SUMMARY_FILE_CHIP_LIMIT,
  type SummaryFileBadge,
  type SummaryFileChip,
  type SummaryFiles
} from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';

import { SummaryBlockHeading, summaryFocusRing } from './MissionSummaryParts.tsx';

const BADGE_CLASS: Record<SummaryFileBadge, string> = {
  N: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200',
  D: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  '?': 'bg-stone-200/70 text-stone-600 dark:bg-stone-500/25 dark:text-stone-300'
};

const CUMULATIVE_CAVEAT =
  "Cumulative paths observed during this mission's objectives, including edits later reverted. Not a diff.";

function Badge({ badge, small = false }: { badge: SummaryFileBadge; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded font-bold',
        small ? 'size-3.5 text-[9px]' : 'size-4 text-[10px]',
        BADGE_CLASS[badge]
      )}
    >
      {badge}
    </span>
  );
}

function FileChip({ chip, showResourceKey }: { chip: SummaryFileChip; showResourceKey: boolean }) {
  const resource = showResourceKey && chip.resourceKey ? `${chip.resourceKey}, ` : '';
  return (
    <li
      className="inline-flex min-h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-surface-1) px-2 py-0.5 font-mono text-xs text-(--color-ink)"
      title={chip.filePath}
    >
      <span className="sr-only">{`${resource}${chip.filePath}, ${fileProvenanceLabel(chip.badge)}`}</span>
      <Badge badge={chip.badge} />
      {showResourceKey && chip.resourceKey ? (
        <span
          aria-hidden="true"
          className="shrink-0 rounded-sm bg-(--color-muted) px-1 font-sans text-[10px] font-semibold uppercase leading-4 tracking-wide text-(--color-ink-dim)"
        >
          {chip.resourceKey}
        </span>
      ) : null}
      {chip.directory ? (
        <span
          aria-hidden="true"
          className="min-w-0 max-w-[160px] shrink truncate text-[11px] text-(--color-ink-dim)"
        >
          {chip.directory}
        </span>
      ) : null}
      <span aria-hidden="true" className="min-w-0 truncate">
        {chip.basename}
      </span>
    </li>
  );
}

/**
 * Files changed (plan §5.2): distinct paths across the mission with a
 * provenance badge, directory, basename, and the resource key when the mission
 * spans resources. Cumulative evidence, not a diff; no line counts (coo:1199).
 */
export function MissionSummaryFiles({ files }: { files: SummaryFiles }) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listId = useId();
  if (files.total === 0) return null;
  const visible = expanded ? files.chips : files.chips.slice(0, SUMMARY_FILE_CHIP_LIMIT);
  const hidden = files.total - SUMMARY_FILE_CHIP_LIMIT;
  const countLabel = `${files.total}${files.truncated ? '+' : ''}`;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-1.5 border-t border-(--color-border) px-5 pb-2.5 pt-3"
    >
      <div className="flex items-center justify-between gap-3">
        <SummaryBlockHeading id={headingId} label="Files changed" count={countLabel} />
        <span className="text-xs text-(--color-ink-dim)" title={CUMULATIVE_CAVEAT}>
          <span className="sr-only">{CUMULATIVE_CAVEAT} </span>
          cumulative
          {files.resourceCount > 1 ? ` · ${files.resourceCount} resources` : ''}
        </span>
      </div>
      <ul id={listId} className="flex min-w-0 flex-wrap gap-1.5 pb-1 pt-0.5">
        {visible.map(chip => (
          <FileChip key={chip.key} chip={chip} showResourceKey={files.showResourceKey} />
        ))}
        {hidden > 0 ? (
          <li className="inline-flex">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(value => !value)}
              className={cn(
                'inline-flex min-h-[26px] items-center rounded-md border border-dashed border-(--color-border) px-2 text-xs text-(--color-ink-dim) hover:text-(--color-ink)',
                summaryFocusRing
              )}
            >
              {expanded ? 'Show fewer' : `+${hidden} more`}
            </button>
          </li>
        ) : null}
      </ul>
      {files.truncated ? (
        <p className="text-xs text-(--color-ink-dim)">
          Only the newest file evidence loaded; the mission has more.
        </p>
      ) : null}
      <div className="flex gap-3 text-[11px] text-(--color-ink-dim)" aria-hidden="true">
        <span className="inline-flex items-center gap-1">
          <Badge badge="N" small />
          native
        </span>
        <span className="inline-flex items-center gap-1">
          <Badge badge="D" small />
          declared
        </span>
        <span className="inline-flex items-center gap-1">
          <Badge badge="?" small />
          unknown
        </span>
      </div>
    </section>
  );
}
