import type { ObjectiveState } from '@overlord/contract';

import { OBJECTIVE_STATE_LABEL } from '../ui.tsx';

/** "n of m" within the panel's row order; `null` when the objective is not in it. */
export function objectivePosition(
  rowOrder: readonly string[],
  objectiveId: string
): { index: number; total: number } | null {
  const index = rowOrder.indexOf(objectiveId);
  return index === -1 ? null : { index, total: rowOrder.length };
}

/** Previous (-1) or next (+1) objective in row order, wrapping at the ends (plan §9.3). */
export function adjacentObjectiveId(
  rowOrder: readonly string[],
  objectiveId: string,
  delta: -1 | 1
): string | null {
  if (rowOrder.length < 2) return null;
  const index = rowOrder.indexOf(objectiveId);
  if (index === -1) return null;
  const next = (index + delta + rowOrder.length) % rowOrder.length;
  return rowOrder[next] ?? null;
}

/** The header badge: "Waiting on you" when blocked, otherwise the state label. */
export function detailStateBadge(
  state: ObjectiveState,
  blocked: boolean
): { label: string; tone: 'blocked' | 'neutral' | 'active' | 'done' | 'launching' } {
  if (blocked) return { label: 'Waiting on you', tone: 'blocked' };
  if (state === 'complete') return { label: OBJECTIVE_STATE_LABEL[state], tone: 'done' };
  if (state === 'launching') return { label: OBJECTIVE_STATE_LABEL[state], tone: 'launching' };
  if (state === 'executing' || state === 'pending_delivery') {
    return { label: OBJECTIVE_STATE_LABEL[state], tone: 'active' };
  }
  return { label: OBJECTIVE_STATE_LABEL[state], tone: 'neutral' };
}

/** The primary action the detail offers for a state (plan §9.4 right column, item 6). */
export function detailPrimaryAction(state: ObjectiveState): 'run' | 'force-disconnect' | null {
  if (state === 'draft' || state === 'submitted' || state === 'launching') return 'run';
  if (state === 'executing') return 'force-disconnect';
  return null;
}

/** First non-empty line of a request summary, for the collapsed Blocking questions row. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  );
}
