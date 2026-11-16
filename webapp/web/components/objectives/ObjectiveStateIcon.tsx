import type { ObjectiveState } from '@overlord/contract';
import { CheckCircle2, Circle, HelpCircle, RefreshCw, Rocket } from 'lucide-react';

import { cn } from '../../lib/utils.ts';
import { StatusSpinner } from '../StatusMotion.tsx';

/** The accessible name for each mark. "Waiting on an answer" outranks the state. */
export const OBJECTIVE_STATE_ICON_LABEL: Record<ObjectiveState, string> = {
  draft: 'Not started',
  submitted: 'Not started',
  launching: 'Launching',
  executing: 'Executing',
  pending_delivery: 'Pending delivery',
  complete: 'Complete'
};

export const OBJECTIVE_BLOCKED_ICON_LABEL = 'Waiting on an answer';

/**
 * The state mark for one objective, shared by the activity feed's mission card and the mission
 * panel's objective rows so the two surfaces never disagree about what an objective is doing.
 *
 * `pending_delivery` is a refresh mark, not a warning: the agent re-attached after finishing a
 * turn and nothing has gone wrong. `blocked` (an in-flight objective with an open question or
 * choice) replaces the state mark with an amber question mark.
 */
export function ObjectiveStateIcon({
  state,
  blocked = false,
  className
}: {
  state: ObjectiveState;
  blocked?: boolean;
  className?: string;
}) {
  const label = blocked ? OBJECTIVE_BLOCKED_ICON_LABEL : OBJECTIVE_STATE_ICON_LABEL[state];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex shrink-0', className)}
      data-objective-state-icon={blocked ? 'blocked' : state}
    >
      {blocked ? (
        <HelpCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : state === 'executing' ? (
        <StatusSpinner className="text-(--color-ink-dim)" />
      ) : state === 'pending_delivery' ? (
        <StatusSpinner icon={RefreshCw} slow className="text-(--color-ink-dim)" />
      ) : state === 'complete' ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
      ) : state === 'launching' ? (
        <Rocket className="size-3.5 shrink-0 text-sky-500" />
      ) : (
        <Circle className="size-3.5 shrink-0 text-(--color-ink-dim)/50" />
      )}
    </span>
  );
}
