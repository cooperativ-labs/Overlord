/**
 * Split a collected Latch event snapshot into ingest POSTs that stay under the
 * backend JSON body limit.
 *
 * The mission-panel widget (and the runner's post-launch ingest) dump every
 * event since the stored cursor in one request. Express's default JSON limit is
 * 100 KiB, and a session with streaming `assistant_delta` lines exceeds that
 * quickly. Observation ingest is presentation-only — the Latch session itself
 * keeps running — but the widget surfaces the 413 as a session error.
 */

/** Stay under Express's historical 100 KiB default after wrapping JSON. */
export const HARNESS_EVENT_INGEST_MAX_BYTES = 64 * 1024;

export type LatchHarnessEventIngestChunk = {
  events: unknown[];
  from: number;
};

function encodedEventSize(event: unknown): number {
  return new TextEncoder().encode(JSON.stringify(event)).length;
}

export function chunkLatchHarnessEventsForIngest({
  events,
  from,
  maxBytes = HARNESS_EVENT_INGEST_MAX_BYTES
}: {
  events: readonly unknown[];
  from: number;
  maxBytes?: number;
}): LatchHarnessEventIngestChunk[] {
  if (events.length === 0) return [];

  const chunks: LatchHarnessEventIngestChunk[] = [];
  let chunk: unknown[] = [];
  let chunkFrom = from;
  let used = 2;

  for (const event of events) {
    const size = encodedEventSize(event);
    const extra = (chunk.length === 0 ? 0 : 1) + size;
    if (chunk.length > 0 && used + extra > maxBytes) {
      chunks.push({ events: chunk, from: chunkFrom });
      chunkFrom += chunk.length;
      chunk = [event];
      used = 2 + size;
      continue;
    }
    chunk.push(event);
    used += extra;
  }
  chunks.push({ events: chunk, from: chunkFrom });
  return chunks;
}
