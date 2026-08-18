import assert from 'node:assert/strict';
import test from 'node:test';

import { connectEventStream } from './fetch-sse.ts';

/**
 * The realtime link runs for the whole life of the app and reconnects every two
 * seconds while the backend is unreachable. Each reconnect used to leave an
 * `abort` listener attached to the one signal that never fires (`{ once: true }`
 * detaches only when the event actually happens), so the listener list — and the
 * timers and resolvers it captured — grew for the session's lifetime. The
 * invariant is that live listeners do not track the number of reconnects.
 */
test('reconnect backoff does not accumulate abort listeners on the shared signal', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let liveAbortListeners = 0;
  let peakAbortListeners = 0;
  let instrumented: AbortSignal | null = null;

  const instrument = (signal: AbortSignal): void => {
    if (instrumented === signal) return;
    instrumented = signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'abort') {
        liveAbortListeners += 1;
        peakAbortListeners = Math.max(peakAbortListeners, liveAbortListeners);
      }
      return (add as (...args: unknown[]) => unknown)(type, ...rest);
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'abort') liveAbortListeners -= 1;
      return (remove as (...args: unknown[]) => unknown)(type, ...rest);
    }) as typeof signal.removeEventListener;
  };

  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    attempts += 1;
    if (init?.signal) instrument(init.signal);
    throw new Error('backend unreachable');
  }) as unknown as typeof fetch;

  try {
    const disconnect = connectEventStream({ url: 'http://127.0.0.1:1/realtime', handlers: {} });
    await waitFor(() => attempts >= 3, 15_000);
    disconnect();

    assert.ok(attempts >= 3, `expected repeated reconnects, saw ${attempts}`);
    // One backoff may legitimately be in flight when the assertion runs; what
    // must not happen is one surviving listener per attempt.
    assert.ok(
      peakAbortListeners <= 1,
      `abort listeners grew with reconnect count (peak ${peakAbortListeners} over ${attempts} attempts)`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
