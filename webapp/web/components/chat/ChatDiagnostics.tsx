import type { ChatDiagnosticDto } from '@overlord/contract';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api.ts';
import { ApiRequestError } from '@/lib/api/request.ts';
import { chatErrorMessage } from '@/lib/chat/errors.ts';

/** Collapsed rows have one fixed height so only expanded rows need measuring. */
export const DIAGNOSTIC_ROW_HEIGHT = 26;
const OVERSCAN = 12;
const IDLE_POLL_MS = 1000;
/** Used before the scroller is measured (and under test DOMs without layout); matches max-h-80. */
const FALLBACK_VIEWPORT = 320;

type OpenRow = { index: number; extra: number };

/**
 * Separate from transcript state: observing raw history never applies chat events.
 * Every retained row stays reachable by scrolling; only the visible window is in the DOM.
 */
export function ChatDiagnostics({ threadId }: { threadId: string }) {
  // Append-only and ascending by seq; mutated in place so draining a backlog never copies history.
  const log = useRef<ChatDiagnosticDto[]>([]);
  const [count, setCount] = useState(0);
  // Expanded rows by seq with their measured height; survives rows leaving the window.
  const [opened, setOpened] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });

  useEffect(() => {
    let disposed = false;
    let stopped = false;
    let inFlight = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    log.current = [];
    setCount(0);
    setOpened(new Map());
    setError(null);
    setLoading(true);
    const hidden = () => document.visibilityState === 'hidden';
    const schedule = (ms: number) => {
      if (disposed || stopped) return;
      // A hidden view stops here; the visibility listener resumes from the same cursor.
      if (hidden()) setPaused(true);
      else timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      timer = undefined;
      inFlight = true;
      let more = false;
      try {
        const page = await api.getChatDiagnostics(threadId, cursor);
        if (disposed) return;
        const entries = log.current;
        for (const entry of page.entries) {
          if (!entries.length || entry.seq > entries[entries.length - 1].seq) entries.push(entry);
        }
        setCount(entries.length);
        cursor = page.nextCursor;
        more = page.hasMore;
        setError(null);
      } catch (cause) {
        if (disposed) return;
        setError(chatErrorMessage(cause));
        if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)) {
          stopped = true;
          log.current = [];
          setCount(0);
          setOpened(new Map());
          setLoading(false);
          return;
        }
      } finally {
        inFlight = false;
      }
      setLoading(false);
      schedule(more ? 0 : IDLE_POLL_MS);
    };
    const onVisibility = () => {
      if (disposed || stopped) return;
      if (hidden()) {
        clearTimeout(timer);
        timer = undefined;
        if (!inFlight) setPaused(true);
      } else if (!inFlight && timer === undefined) {
        setPaused(false);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (hidden()) setPaused(true);
    else void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [threadId]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const read = () => setView({ top: element.scrollTop, height: element.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback((seq: number, open: boolean) => {
    setOpened(previous => {
      if (previous.has(seq) === open) return previous;
      const next = new Map(previous);
      if (open) next.set(seq, DIAGNOSTIC_ROW_HEIGHT);
      else next.delete(seq);
      return next;
    });
  }, []);
  const measure = useCallback((seq: number, height: number) => {
    setOpened(previous => {
      const current = previous.get(seq);
      if (current === undefined || Math.abs(current - height) < 1) return previous;
      return new Map(previous).set(seq, height);
    });
  }, []);

  const entries = log.current;
  // Only expanded rows deviate from the fixed height, so layout work is O(expanded), not O(history).
  const openRows: OpenRow[] = [];
  for (const [seq, height] of opened) {
    const index = indexOfSeq(entries, seq);
    if (index >= 0) openRows.push({ index, extra: Math.max(0, height - DIAGNOSTIC_ROW_HEIGHT) });
  }
  openRows.sort((a, b) => a.index - b.index);
  const total = openRows.reduce((sum, row) => sum + row.extra, count * DIAGNOSTIC_ROW_HEIGHT);
  const viewport = view.height || FALLBACK_VIEWPORT;
  const first = Math.max(0, rowAt(view.top, openRows, count) - OVERSCAN);
  const last = Math.min(count, rowAt(view.top + viewport, openRows, count) + OVERSCAN + 1);

  return (
    <section
      aria-label="Chat diagnostics"
      className="flex max-h-80 min-h-24 flex-col border-t bg-(--color-bg-muted)"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
        <strong>Chat diagnostics · {count} entries</strong>
        <span>{paused ? 'Paused while hidden' : 'Live'} · unredacted</span>
      </div>
      <div className="px-4 font-mono text-xs">
        <p className="mb-2 text-(--color-ink-dim)">
          Expand any entry for its full payload. History starts when diagnostics capture was
          installed.
        </p>
        {loading ? <p>Loading diagnostics…</p> : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        {!loading && !error && !count ? <p>No diagnostic activity yet.</p> : null}
      </div>
      <div
        ref={scroller}
        data-testid="chat-diagnostics-rows"
        className="min-h-0 flex-1 overflow-auto px-4 pb-3 font-mono text-xs"
        onScroll={event =>
          setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        }
      >
        <div style={{ height: total, position: 'relative' }}>
          <div style={{ position: 'absolute', top: offsetOf(first, openRows), left: 0, right: 0 }}>
            {entries.slice(first, last).map(entry => (
              <DiagnosticEntry
                key={entry.seq}
                entry={entry}
                open={opened.has(entry.seq)}
                onToggle={toggle}
                onMeasure={measure}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Ascending by seq, so a binary search locates expanded rows without scanning history. */
function indexOfSeq(entries: readonly ChatDiagnosticDto[], seq: number): number {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = entries[middle].seq;
    if (value === seq) return middle;
    if (value < seq) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function offsetOf(index: number, openRows: readonly OpenRow[]): number {
  let offset = index * DIAGNOSTIC_ROW_HEIGHT;
  for (const row of openRows) {
    if (row.index >= index) break;
    offset += row.extra;
  }
  return offset;
}

/** Index of the row covering vertical position y. */
function rowAt(y: number, openRows: readonly OpenRow[], count: number): number {
  if (!count) return 0;
  let extra = 0;
  for (const row of openRows) {
    const top = row.index * DIAGNOSTIC_ROW_HEIGHT + extra;
    if (y < top) break;
    if (y < top + DIAGNOSTIC_ROW_HEIGHT + row.extra) return row.index;
    extra += row.extra;
  }
  return Math.min(count - 1, Math.max(0, Math.floor((y - extra) / DIAGNOSTIC_ROW_HEIGHT)));
}

const DiagnosticEntry = memo(function DiagnosticEntry({
  entry,
  open,
  onToggle,
  onMeasure
}: {
  entry: ChatDiagnosticDto;
  open: boolean;
  onToggle: (seq: number, open: boolean) => void;
  onMeasure: (seq: number, height: number) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const report = () => onMeasure(entry.seq, element.offsetHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, entry.seq, onMeasure]);
  // Serialized only while expanded; collapsed rows hold no rendered copy of the payload.
  const text = useMemo(
    () => (open ? JSON.stringify(entry.payload, null, 2) : null),
    [open, entry.payload]
  );
  const label = `#${entry.seq} ${entry.createdAt} ${entry.kind}${
    entry.runId ? ` · run ${entry.runId}` : ''
  }${entry.attemptId ? ` · attempt ${entry.attemptId}` : ''}`;
  return (
    <details
      ref={ref}
      open={open}
      className="border-t py-1"
      style={
        open
          ? undefined
          : { height: DIAGNOSTIC_ROW_HEIGHT, overflow: 'hidden', boxSizing: 'border-box' }
      }
      onToggle={event => onToggle(entry.seq, event.currentTarget.open)}
    >
      <summary
        className={open ? 'cursor-pointer break-all' : 'cursor-pointer truncate'}
        title={open ? undefined : label}
      >
        {label}
      </summary>
      {open ? <pre className="py-2 whitespace-pre-wrap break-all">{text}</pre> : null}
    </details>
  );
});
