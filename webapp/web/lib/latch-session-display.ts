import type { TerminalSessionDto } from '../../shared/contract.ts';

export type LatchSessionDisplay = {
  /** The one session the mission panel draws as a full card. */
  current: TerminalSessionDto | null;
  /** Every other session, newest first, shown collapsed in the accordion. */
  others: TerminalSessionDto[];
  /** How many of `others` were last observed running — the accordion's live count. */
  runningOtherCount: number;
};

function isLive(session: TerminalSessionDto): boolean {
  return session.lastObservedState === 'running' || session.lastObservedState === 'stopping';
}

/**
 * Split a mission's Latch sessions into the one worth showing and the rest.
 *
 * A long-running mission accumulates a session per objective, so the panel
 * leads with the newest session that is still live. When every session has
 * already exited, it falls back to the newest session overall so the card is
 * never empty while sessions exist. Everything else collapses into the
 * previous-sessions accordion (coo:990).
 */
export function selectLatchSessionDisplay(
  sessions: readonly TerminalSessionDto[]
): LatchSessionDisplay {
  const newestFirst = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = newestFirst.find(isLive) ?? newestFirst[0] ?? null;
  const others = newestFirst.filter(session => session !== current);
  return {
    current,
    others,
    runningOtherCount: others.filter(session => session.lastObservedState === 'running').length
  };
}
