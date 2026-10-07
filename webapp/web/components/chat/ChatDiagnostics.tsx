import type { ChatDiagnosticDto } from '@overlord/contract';
import { memo, useEffect, useState } from 'react';

import { api } from '@/lib/api.ts';
import { ApiRequestError } from '@/lib/api/request.ts';
import { chatErrorMessage } from '@/lib/chat/errors.ts';

/** Separate from transcript state: observing raw history never applies chat events. */
export function ChatDiagnostics({ threadId }: { threadId: string }) {
  const [entries, setEntries] = useState<ChatDiagnosticDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    setEntries([]);
    setError(null);
    setLoading(true);
    const poll = async () => {
      let more = false;
      try {
        const page = await api.getChatDiagnostics(threadId, cursor);
        if (disposed) return;
        if (page.entries.length) setEntries(previous => [...previous, ...page.entries]);
        cursor = page.nextCursor;
        more = page.hasMore;
        setError(null);
      } catch (cause) {
        if (disposed) return;
        setError(chatErrorMessage(cause));
        if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)) {
          setEntries([]);
          setLoading(false);
          return;
        }
      }
      if (!disposed) {
        setLoading(false);
        timer = setTimeout(() => void poll(), more ? 0 : 1000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [threadId]);
  return (
    <section
      aria-label="Chat diagnostics"
      className="flex max-h-80 min-h-24 flex-col border-t bg-(--color-bg-muted)"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
        <strong>Chat diagnostics · {entries.length} entries</strong>
        <span>Live · unredacted</span>
      </div>
      <div className="min-h-0 overflow-auto px-4 pb-3 font-mono text-xs">
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
        {!loading && !error && !entries.length ? <p>No diagnostic activity yet.</p> : null}
        {entries.map(entry => (
          <DiagnosticEntry key={entry.seq} entry={entry} />
        ))}
      </div>
    </section>
  );
}

const DiagnosticEntry = memo(function DiagnosticEntry({ entry }: { entry: ChatDiagnosticDto }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="border-t py-1" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer break-all">
        #{entry.seq} {entry.createdAt} {entry.kind}
        {entry.runId ? ` · run ${entry.runId}` : ''}
        {entry.attemptId ? ` · attempt ${entry.attemptId}` : ''}
      </summary>
      {open ? (
        <pre className="py-2 whitespace-pre-wrap break-all">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      ) : null}
    </details>
  );
});
