import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessEvent } from './latch-harness/generated.ts';
import { chunkLatchHarnessEventsForIngest } from './latch-harness-ingest.ts';

function delta(index: number, text: string): HarnessEvent {
  return {
    sessionId: 'ses_1',
    at: '2026-08-18T05:00:00Z',
    harnessVersion: '2.1.119',
    connectorEpoch: 1,
    type: 'assistant_delta',
    text: `${index}:${text}`
  };
}

test('keeps a small snapshot as one ingest chunk', () => {
  const events = [delta(0, 'Hel'), delta(1, 'lo')];
  assert.deepEqual(chunkLatchHarnessEventsForIngest({ events, from: 12 }), [{ events, from: 12 }]);
});

test('splits a streaming dump so each POST stays under the byte budget', () => {
  const events = Array.from({ length: 80 }, (_, index) => delta(index, 'x'.repeat(800)));
  const chunks = chunkLatchHarnessEventsForIngest({
    events,
    from: 0,
    maxBytes: 8 * 1024
  });
  assert.ok(chunks.length > 1);
  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.from, cursor);
    const encoded = JSON.stringify(chunk.events);
    assert.ok(
      new TextEncoder().encode(encoded).length <= 8 * 1024 || chunk.events.length === 1,
      'chunk exceeds the budget without being a single oversized event'
    );
    cursor += chunk.events.length;
  }
  assert.equal(cursor, events.length);
  assert.deepEqual(
    chunks.flatMap(chunk => chunk.events),
    events
  );
});

test('does not split a single event that already exceeds the budget', () => {
  const huge = delta(0, 'y'.repeat(2000));
  const chunks = chunkLatchHarnessEventsForIngest({
    events: [huge],
    from: 4,
    maxBytes: 100
  });
  assert.deepEqual(chunks, [{ events: [huge], from: 4 }]);
});
