import { AlertTriangle, Check, CircleDot, Loader2 } from 'lucide-react';

import type {
  SummarySource,
  SummaryStatusChip,
  SummaryStatusTone
} from '../../lib/mission-summary-derive.ts';
import { cn } from '../../lib/utils.ts';
import { Markdown } from '../Markdown.tsx';

import { ObjectiveKeyLink } from './MissionSummaryParts.tsx';

const STATUS_TONE_CLASS: Record<SummaryStatusTone, string> = {
  review: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  complete: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  execute: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  blocked: 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  neutral: 'bg-(--color-muted) text-(--color-ink-dim)'
};

function StatusIcon({ tone }: { tone: SummaryStatusTone }) {
  if (tone === 'review' || tone === 'complete') {
    return <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />;
  }
  if (tone === 'execute') return <Loader2 className="size-2.5" aria-hidden="true" />;
  if (tone === 'blocked') return <AlertTriangle className="size-2.5" aria-hidden="true" />;
  return <CircleDot className="size-2.5" aria-hidden="true" />;
}

/** Status chip: colour plus text, never colour alone. */
export function MissionSummaryStatusChip({ chip }: { chip: SummaryStatusChip }) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4',
        STATUS_TONE_CLASS[chip.tone]
      )}
    >
      <StatusIcon tone={chip.tone} />
      {chip.label}
    </span>
  );
}

/**
 * What happened: headline, status chip, the composed summary with the client's
 * running sentences appended, and the sources line. The running sentences keep
 * the post true between composes.
 */
export function MissionSummaryPost({
  headlineId,
  headline,
  summary,
  runningSentences,
  statusChip,
  sources,
  sourcesTruncated,
  dimmed
}: {
  headlineId: string;
  headline: string;
  summary: string;
  runningSentences: readonly string[];
  statusChip: SummaryStatusChip;
  sources: readonly SummarySource[];
  sourcesTruncated: boolean;
  /** Previous content under the updating strip. */
  dimmed: boolean;
}) {
  return (
    <div className={cn('grid min-w-0 gap-2.5 px-5 pb-4 pt-4', dimmed && 'opacity-55')}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <h3
          id={headlineId}
          className="min-w-0 font-display text-lg font-bold leading-snug tracking-tight text-(--color-ink) wrap-anywhere"
        >
          {headline}
        </h3>
        <MissionSummaryStatusChip chip={statusChip} />
      </div>
      {summary.trim() ? <Markdown text={summary} /> : null}
      {runningSentences.length > 0 ? (
        <p className="text-sm leading-relaxed text-(--color-ink)">{runningSentences.join(' ')}</p>
      ) : null}
      {sources.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-(--color-ink-dim)">
          <span>Sources:</span>
          {sources.map(source => (
            <ObjectiveKeyLink
              key={source.deliveryId}
              objectiveKey={source.objectiveKey}
              ariaLabel={
                source.objectiveKey
                  ? `Open objective ${source.objectiveKey}${source.live ? ', running' : ''}`
                  : undefined
              }
            >
              {source.live ? (
                <span className="font-sans text-sky-700 dark:text-sky-300"> · live</span>
              ) : null}
            </ObjectiveKeyLink>
          ))}
          {sourcesTruncated ? <span>and more</span> : null}
        </div>
      ) : null}
    </div>
  );
}
