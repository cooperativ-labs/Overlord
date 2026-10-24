import { Loader2 } from 'lucide-react';

import { formatTimestamp, relativeTime } from '../../lib/format-date.ts';

/**
 * The `MISSION SUMMARY` label with its trailer: `as of … · from n deliveries`
 * once a summary has been generated, the running count before the first
 * delivery, or nothing.
 */
export function MissionSummaryHeader({
  generatedAt,
  deliveryCount,
  runningCount = 0,
  now
}: {
  generatedAt: string | null;
  deliveryCount: number | null;
  runningCount?: number;
  now: string;
}) {
  let trailer = null;
  if (generatedAt && deliveryCount !== null) {
    trailer = (
      <span title={formatTimestamp(generatedAt)}>
        as of {relativeTime(generatedAt, now, { immediate: 'just now' })} · from {deliveryCount}{' '}
        {deliveryCount === 1 ? 'delivery' : 'deliveries'}
      </span>
    );
  } else if (runningCount > 0) {
    trailer = (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3 animate-spin text-sky-600" aria-hidden="true" />
        {runningCount} {runningCount === 1 ? 'objective' : 'objectives'} running
      </span>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
        Mission summary
      </h2>
      {trailer ? <span className="text-xs text-(--color-ink-dim)">{trailer}</span> : null}
    </div>
  );
}
