import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatPerformance, chatSpan, chatSyncSpan, withChatPerformance } from './performance.js';

test('overlapping attempts keep numeric spans isolated across async branches and failures', async () => {
  const first = new ChatPerformance(),
    second = new ChatPerformance();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const pending = withChatPerformance(first, () =>
    chatSpan('tool.join', async () => {
      await gate;
      chatSyncSpan('diagnostic.serialization', () => 1);
    })
  );
  await assert.rejects(
    withChatPerformance(second, () =>
      chatSpan('text.commit', async () => {
        release();
        throw new Error('fixture failure');
      })
    )
  );
  await pending;
  assert.equal(first.spans['tool.join']!.count, 1);
  assert.equal(first.spans['diagnostic.serialization']!.count, 1);
  assert.equal(first.spans['text.commit'], undefined);
  assert.equal(second.spans['text.commit']!.count, 1);
  assert.equal(second.spans['tool.join'], undefined);
  assert.ok(second.spans['text.commit']!.totalMs >= 0);
});
