import type { ReactNode } from 'react';

import { cn } from '../../lib/utils.ts';

/**
 * Thin labeled rule — line · LABEL · COUNT · line — that separates the
 * evidence sections inside an expanded objective (coo:879 §4.2). It is a
 * signpost, not an accordion: primary evidence (instruction, deliveries,
 * terminal session, file changes) is never nested behind a collapsible, so the
 * rule has no open/closed state. Same shape as the file-change resource group
 * header so the two read as one system.
 */
export function ObjectiveEvidenceRule({
  label,
  count,
  trailing,
  className
}: {
  label: string;
  /** Rendered after the label as `LABEL · N`; omitted when undefined. */
  count?: number;
  /** Extra inline content after the count — a `live` tag, a state dot. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-3 py-1', className)}
      role="presentation"
      aria-label={count === undefined ? label : `${label} (${count})`}
    >
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-dim)]">
        <span>{label}</span>
        {count !== undefined ? (
          <>
            <span aria-hidden="true" className="text-[var(--color-ink-dim)]/60">
              ·
            </span>
            <span className="font-mono tracking-normal">{count}</span>
          </>
        ) : null}
        {trailing}
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/** One-line muted empty state under a rule, so "ran with no changes" reads distinctly from "loading". */
export function ObjectiveEvidenceEmpty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs italic text-[var(--color-ink-dim)]">{children}</p>;
}

/** Mission-level cap notice so a truncated fetch is never rendered as a complete list. */
export function ObjectiveEvidenceTruncationNotice({ children }: { children: string }) {
  return (
    <p className="py-1 text-xs text-[var(--color-ink-dim)]" role="status">
      {children}
    </p>
  );
}
