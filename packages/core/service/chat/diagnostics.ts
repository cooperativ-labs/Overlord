import type { ChatDiagnosticPageDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

/** Preserve Error's non-enumerable details as well as provider-specific fields. */
export function diagnosticJson(value: unknown): string {
  const ancestors: { source: object; serialized: object }[] = [];
  return (
    JSON.stringify(value, function (_key, item: unknown) {
      if (typeof item === 'bigint') return item.toString();
      if (item && typeof item === 'object') {
        while (ancestors.length && ancestors.at(-1)?.serialized !== this) ancestors.pop();
        if (ancestors.some(ancestor => ancestor.source === item)) return '[Circular reference]';
        const serialized =
          item instanceof Error
            ? Object.fromEntries(
                Object.getOwnPropertyNames(item).map(key => [
                  key,
                  (item as unknown as Record<string, unknown>)[key]
                ])
              )
            : item;
        ancestors.push({ source: item, serialized });
        return serialized;
      }
      return item;
    }) ?? 'null'
  );
}

/** Caller holds the thread row lock. Observations do not mutate run/lease state. */
export async function appendDiagnostic(
  db: DatabaseClient,
  threadId: string,
  kind: string,
  payload: unknown,
  createdAt: string,
  runId: string | null = null,
  attemptId: string | null = null
): Promise<void> {
  await db.run(
    `INSERT INTO chat_diagnostics (thread_id, seq, kind, payload_json, created_at, run_id, attempt_id)
     SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ? FROM chat_diagnostics WHERE thread_id = ?`,
    [threadId, kind, diagnosticJson(payload), createdAt, runId, attemptId, threadId]
  );
}

export async function diagnosticPage(
  db: DatabaseClient,
  threadId: string,
  after: number
): Promise<ChatDiagnosticPageDto> {
  const rows = await db.all<{
    thread_id: string;
    seq: number;
    run_id: string | null;
    attempt_id: string | null;
    kind: string;
    payload_json: string;
    created_at: string;
  }>('SELECT * FROM chat_diagnostics WHERE thread_id = ? AND seq > ? ORDER BY seq LIMIT 101', [
    threadId,
    after
  ]);
  const entries = rows.slice(0, 100).map(row => ({
    threadId: row.thread_id,
    seq: row.seq,
    runId: row.run_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at
  }));
  return { entries, nextCursor: entries.at(-1)?.seq ?? after, hasMore: rows.length > 100 };
}
