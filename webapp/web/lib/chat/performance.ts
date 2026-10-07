/** Numeric-only, tab-local observations. No message content or network telemetry. */
const MARK = 'overlord.chat.firstTextPaint';
let activeScope: string | null = null;
const submissions = new Map<string, { started: number; runId: string | null; painted: boolean }>();

export function setChatPerformanceScope(scope: string | null) {
  if (scope === activeScope) return;
  activeScope = scope;
  submissions.clear();
  performance.clearMarks(MARK);
}
export function beginChatPaint(threadId: string) {
  if (!activeScope) return;
  submissions.set(threadId, { started: performance.now(), runId: null, painted: false });
  if (submissions.size > 100) submissions.delete(submissions.keys().next().value!);
}
export function bindChatPaint(threadId: string, runId: string) {
  const entry = submissions.get(threadId);
  if (entry && !entry.runId) entry.runId = runId;
}
/** Double rAF brackets a foreground paint opportunity, not a physical display timestamp. */
export function observeChatTextPaint(threadId: string, runId: string): () => void {
  const entry = submissions.get(threadId);
  if (!entry || entry.painted || (entry.runId && entry.runId !== runId)) return () => {};
  entry.runId = runId;
  const scope = activeScope;
  const domCommitMs = performance.now() - entry.started;
  let frame = 0;
  let stopped = false;
  const schedule = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (
          stopped ||
          scope !== activeScope ||
          submissions.get(threadId) !== entry ||
          entry.painted ||
          document.visibilityState !== 'visible'
        )
          return;
        entry.painted = true;
        const rows = performance
          .getEntriesByName(MARK)
          .slice(-99)
          .map(row => (row as PerformanceMark).detail);
        performance.clearMarks(MARK);
        for (const detail of rows) performance.mark(MARK, { detail });
        performance.mark(MARK, {
          detail: {
            version: 1,
            threadId,
            runId,
            domCommitMs,
            paintOpportunityMs: performance.now() - entry.started,
            observedAt: Date.now()
          }
        });
        document.removeEventListener('visibilitychange', schedule);
      });
    });
  };
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', schedule);
  };
}
