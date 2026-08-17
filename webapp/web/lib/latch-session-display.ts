import type { TerminalSessionDto } from '../../shared/contract.ts';

export type LatchSessionDisplay = {
  /** The one session the mission panel draws as a full card. */
  current: TerminalSessionDto | null;
  /** Every other session, newest first, shown collapsed in the accordion. */
  others: TerminalSessionDto[];
  /** How many of `others` were last observed running — the accordion's count. */
  runningOtherCount: number;
};

/**
 * Split a mission's Latch sessions into the one worth showing and the rest.
 *
 * A long-running mission accumulates a session per objective, so the panel
 * leads with the newest session launched for the objective that is currently
 * active. A mission with no active objective — or an active objective that
 * launched no Latch session — falls back to the newest session overall, so the
 * card is never empty while sessions exist.
 */
export function selectLatchSessionDisplay(
  sessions: readonly TerminalSessionDto[],
  currentObjectiveId: string | null
): LatchSessionDisplay {
  const newestFirst = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current =
    (currentObjectiveId
      ? newestFirst.find(session => session.objectiveId === currentObjectiveId)
      : undefined) ??
    newestFirst[0] ??
    null;
  const others = newestFirst.filter(session => session !== current);
  return {
    current,
    others,
    runningOtherCount: others.filter(session => session.lastObservedState === 'running').length
  };
}
