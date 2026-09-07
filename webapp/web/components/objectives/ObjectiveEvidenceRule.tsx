import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { cn } from '../../lib/utils.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

/** The centred `LABEL · COUNT · trailing` cluster shared by the static and collapsible rules. */
function RuleLabel({
  label,
  count,
  trailing,
  leading,
  className
}: {
  label: string;
  count?: number;
  trailing?: ReactNode;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-dim)]',
        className
      )}
    >
      {leading}
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
  );
}

/**
 * Thin labeled rule — line · LABEL · COUNT · line — that separates the
 * evidence sections inside an expanded objective (coo:879 §4.2). It is a
 * signpost, not an accordion: this variant has no open/closed state and always
 * shows the body that follows it. Same shape as the file-change resource group
 * header so the two read as one system. Sections whose bodies can be long
 * (instruction text, file changes) use {@link ObjectiveEvidenceSection}
 * instead, which is the same rule turned into a disclosure trigger.
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
      <RuleLabel label={label} count={count} trailing={trailing} />
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/**
 * An {@link ObjectiveEvidenceRule} that is also the disclosure control for the
 * body beneath it: a chevron sits to the left of the label, and the section is
 * closed until the user opens it. Used for the two sections whose bodies are
 * unbounded — the instruction text and the file-change list — so an expanded
 * objective opens on its header lines rather than on a wall of text.
 *
 * Everything else in the evidence stack keeps the static rule: nesting the
 * primary narrative behind a second click is exactly what coo:879 §4.2 rules
 * out, and only these two sections earn the exception by length.
 */
export function ObjectiveEvidenceSection({
  label,
  count,
  trailing,
  defaultOpen = false,
  children
}: {
  label: string;
  count?: number;
  trailing?: ReactNode;
  /** Sections start closed; pass `true` only where the body is the point of the view. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible className="min-w-0" open={open} onOpenChange={setOpen}>
      {/*
        The trigger is a <button>, so its children stay phrasing content:
        the two rule halves are spans, not divs.
      */}
      <CollapsibleTrigger
        className="group flex w-full cursor-pointer items-center gap-3 py-1 text-left outline-none"
        aria-label={count === undefined ? label : `${label} (${count})`}
      >
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <RuleLabel
          label={label}
          count={count}
          trailing={trailing}
          className="transition-colors group-hover:text-[var(--color-ink)]"
          leading={
            <ChevronRight
              className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
              aria-hidden="true"
            />
          }
        />
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid min-w-0 gap-2 pt-1">{children}</CollapsibleContent>
    </Collapsible>
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
