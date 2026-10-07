import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  beginChatPaint,
  bindChatPaint,
  observeChatTextPaint,
  setChatPerformanceScope
} from './performance.ts';

const MARK = 'overlord.chat.firstTextPaint';
const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
let next = 0;
let frames = new Map<number, FrameRequestCallback>();
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(fn => fn(performance.now()));
};
beforeEach(() => {
  frames = new Map();
  globalThis.requestAnimationFrame = fn => {
    frames.set(++next, fn);
    return next;
  };
  globalThis.cancelAnimationFrame = id => {
    frames.delete(id);
  };
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  setChatPerformanceScope('test-owner');
});
afterEach(() => {
  setChatPerformanceScope(null);
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancel;
});
test('records the first foreground opportunity once, after DOM commit and two frames', () => {
  beginChatPaint('thread');
  bindChatPaint('thread', 'run');
  const stop = observeChatTextPaint('thread', 'run');
  assert.equal(performance.getEntriesByName(MARK).length, 0);
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 0);
  flush();
  const [mark] = performance.getEntriesByName(MARK) as PerformanceMark[];
  assert.equal(mark!.detail.runId, 'run');
  assert.ok(mark!.detail.paintOpportunityMs >= mark!.detail.domCommitMs);
  observeChatTextPaint('thread', 'run');
  flush();
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 1);
  stop();
});
test('unmount and account change cancel callbacks and clear private markers', () => {
  beginChatPaint('thread');
  bindChatPaint('thread', 'run');
  const stop = observeChatTextPaint('thread', 'run');
  flush();
  stop();
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 0);
  observeChatTextPaint('thread', 'run');
  setChatPerformanceScope('another-owner');
  flush();
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 0);
});
test('hidden tabs wait for visibility and mismatched runs never claim a paint', () => {
  beginChatPaint('thread');
  bindChatPaint('thread', 'run');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const stop = observeChatTextPaint('thread', 'run');
  observeChatTextPaint('thread', 'old-run');
  flush();
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 0);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  flush();
  flush();
  assert.equal(performance.getEntriesByName(MARK).length, 1);
  stop();
});
