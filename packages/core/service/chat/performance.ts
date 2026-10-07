import { AsyncLocalStorage } from 'node:async_hooks';

/** Private, bounded numeric measurements. Never accepts prompts, sources or tool arguments. */
export type ChatSpan =
  | 'diagnostic.transaction'
  | 'diagnostic.admission'
  | 'diagnostic.serialization'
  | 'diagnostic.insert'
  | 'thread.lock'
  | 'source.authorization'
  | 'source.checker'
  | 'tool.dispatch_receipt'
  | 'tool.join'
  | 'text.commit';
export class ChatPerformance {
  readonly startedAt = new Date().toISOString();
  readonly started = performance.now();
  readonly spans: Partial<
    Record<ChatSpan, { count: number; totalMs: number; minMs: number; maxMs: number }>
  > = {};
  readonly first: Partial<Record<'sdkChunk' | 'nonThoughtText' | 'durableText', number>> = {};
  elapsed() {
    return performance.now() - this.started;
  }
  mark(name: keyof ChatPerformance['first']) {
    this.first[name] ??= this.elapsed();
  }
  add(name: ChatSpan, durationMs: number) {
    const span = (this.spans[name] ??= { count: 0, totalMs: 0, minMs: durationMs, maxMs: 0 });
    span.count++;
    span.totalMs += durationMs;
    span.minMs = Math.min(span.minMs, durationMs);
    span.maxMs = Math.max(span.maxMs, durationMs);
  }
}
const scope = new AsyncLocalStorage<ChatPerformance>();
export function chatSpanElapsed(name: ChatSpan, started: number) {
  scope.getStore()?.add(name, performance.now() - started);
}
export function chatSyncSpan<T>(name: ChatSpan, fn: () => T): T {
  const metrics = scope.getStore();
  if (!metrics) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    metrics.add(name, performance.now() - start);
  }
}
export function withChatPerformance<T>(metrics: ChatPerformance, fn: () => Promise<T>): Promise<T> {
  return scope.run(metrics, fn);
}
export async function chatSpan<T>(name: ChatSpan, fn: () => Promise<T>): Promise<T> {
  const metrics = scope.getStore();
  if (!metrics) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    metrics.add(name, performance.now() - start);
  }
}
