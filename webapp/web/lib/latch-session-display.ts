import type { TerminalSessionDto } from '@overlord/contract';

export type LatchSessionDisplay = {
  /** The one session the mission panel draws as a full card. */
  current: TerminalSessionDto | null;
  /** Every other session, newest first, shown collapsed in the accordion. */
  others: TerminalSessionDto[];
  /** How many of `others` were last observed running — the accordion's live count. */
  runningOtherCount: number;
};

/**
 * Split a mission's Latch sessions into the one worth showing and the rest.
 *
 * A long-running mission accumulates a session per objective, so the panel
 * leads with the newest session overall. Everything else collapses into the
 * previous-sessions accordion (coo:990).
 */
export function selectLatchSessionDisplay(
  sessions: readonly TerminalSessionDto[]
): LatchSessionDisplay {
  const newestFirst = [...sessions].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    return (
      (Number.isFinite(aTime) && Number.isFinite(bTime)
        ? bTime - aTime
        : b.createdAt.localeCompare(a.createdAt)) ||
      b.executionRequestId.localeCompare(a.executionRequestId) ||
      b.providerSessionId.localeCompare(a.providerSessionId)
    );
  });
  const current = newestFirst[0] ?? null;
  const others = newestFirst.filter(session => session !== current);
  return {
    current,
    others,
    runningOtherCount: others.filter(session => session.lastObservedState === 'running').length
  };
}
