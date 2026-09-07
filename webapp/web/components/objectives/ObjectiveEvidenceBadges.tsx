import { FileCode2, Package, Timer } from 'lucide-react';
import type { ReactNode } from 'react';

import type { TerminalSessionDto } from '../../../shared/contract.ts';
import { formatObjectiveElapsed, type ObjectiveEvidence } from '../../lib/objective-evidence.ts';
import { cn } from '../../lib/utils.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

const SESSION_DOT_TONE: Record<TerminalSessionDto['lastObservedState'], string> = {
  running: 'bg-emerald-500',
  stopping: 'bg-amber-500',
  exited: 'bg-muted-foreground/60',
  lost: 'bg-destructive'
};

function CountBadge({
  icon,
  count,
  label
}: {
  icon: ReactNode;
  count: number | string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
            aria-label={label}
          />
        }
      >
        {icon}
        <span>{count}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact evidence counts for a collapsed objective row (coo:879 §4.2): how
 * many deliveries and file changes it produced, how long it ran, and the state
 * of its newest Latch session. Zero counts and missing timestamps render
 * nothing, so a row that produced no evidence shows no badges rather than a
 * row of zeros.
 */
export function ObjectiveEvidenceBadges({
  evidence,
  startedAt,
  completedAt,
  className
}: {
  evidence: ObjectiveEvidence;
  startedAt: string | null;
  completedAt: string | null;
  className?: string;
}) {
  const deliveryCount = evidence.deliveries.length;
  const fileCount = evidence.fileChanges.length;
  const elapsed = formatObjectiveElapsed({ startedAt, completedAt });
  const newestSession = evidence.terminalSessions[0] ?? null;
  const items: ReactNode[] = [];

  if (deliveryCount > 0) {
    items.push(
      <CountBadge
        key="deliveries"
        icon={<Package className="h-3 w-3" aria-hidden="true" />}
        count={deliveryCount}
        label={deliveryCount === 1 ? '1 delivery' : `${deliveryCount} deliveries`}
      />
    );
  }
  if (fileCount > 0) {
    items.push(
      <CountBadge
        key="files"
        icon={<FileCode2 className="h-3 w-3" aria-hidden="true" />}
        count={fileCount}
        label={fileCount === 1 ? '1 file changed' : `${fileCount} files changed`}
      />
    );
  }
  if (elapsed) {
    items.push(
      <CountBadge
        key="elapsed"
        icon={<Timer className="h-3 w-3" aria-hidden="true" />}
        count={elapsed}
        label={`Ran for ${elapsed}`}
      />
    );
  }
  if (newestSession) {
    const state = newestSession.lastObservedState;
    items.push(
      <Tooltip key="session">
        <TooltipTrigger
          render={
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
              aria-label={`Terminal session ${state}`}
            />
          }
        >
          <span className={cn('h-2 w-2 rounded-full', SESSION_DOT_TONE[state])} />
        </TooltipTrigger>
        <TooltipContent side="top" className="capitalize">
          Terminal session {state}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (items.length === 0) return null;

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
          ) : null}
          {item}
        </span>
      ))}
    </span>
  );
}
