import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { run } from './chat-fixtures.ts';
import {
  beginSend,
  cancelEditing,
  type ChatMessageQueue,
  claimNext,
  drainDecision,
  EMPTY_QUEUE,
  enqueue,
  finishSend,
  getQueue,
  pauseForStoppedRun,
  removeQueued,
  resetQueues,
  resume,
  saveEdit,
  startEditing,
  updateQueue
} from './message-queue.ts';

function queued(...texts: string[]): ChatMessageQueue {
  return texts.reduce(
    (queue, text, index) => enqueue(queue, { id: `q${index + 1}`, text, knowledgebaseWrite: null }),
    EMPTY_QUEUE
  );
}

const idle = { mode: 'send' as const, composerSending: false, latestRun: null };

describe('chat message queue', () => {
  afterEach(resetQueues);

  it('keeps messages in order and ignores blank ones', () => {
    const queue = enqueue(queued('first', ' second '), {
      id: 'blank',
      text: '   ',
      knowledgebaseWrite: null
    });
    assert.deepEqual(
      queue.items.map(item => item.text),
      ['first', 'second']
    );
  });

  it('sends the head only while the thread is idle and nothing else is in flight', () => {
    const queue = queued('first', 'second');
    assert.deepEqual(drainDecision(queue, idle), { kind: 'send', item: queue.items[0] });
    assert.equal(drainDecision(queue, { ...idle, mode: 'busy' }).kind, 'wait');
    // A run waiting for an answer must not receive a queued message as its answer.
    assert.equal(drainDecision(queue, { ...idle, mode: 'answer' }).kind, 'wait');
    assert.equal(drainDecision(queue, { ...idle, composerSending: true }).kind, 'wait');
    assert.equal(drainDecision(EMPTY_QUEUE, idle).kind, 'wait');
  });

  it('sends one at a time and removes a message once accepted', () => {
    let queue = queued('first', 'second');
    queue = beginSend(queue, 'q1');
    assert.equal(queue.sendingId, 'q1');
    assert.equal(drainDecision(queue, idle).kind, 'wait');
    // Only the head can be claimed.
    assert.equal(beginSend(finishSend(queue, 'q1', 'busy'), 'q2').sendingId, null);
    queue = finishSend(queue, 'q1', 'accepted');
    assert.deepEqual(
      queue.items.map(item => item.id),
      ['q2']
    );
    assert.equal(queue.sendingId, null);
    assert.deepEqual(drainDecision(queue, idle), { kind: 'send', item: queue.items[0] });
  });

  it('pauses after a failed send and resumes on request', () => {
    let queue = finishSend(beginSend(queued('first'), 'q1'), 'q1', 'failed');
    assert.equal(queue.paused, 'failed');
    assert.equal(queue.items.length, 1);
    assert.equal(drainDecision(queue, idle).kind, 'wait');
    queue = resume(queue);
    assert.equal(drainDecision(queue, idle).kind, 'send');
  });

  it('keeps a message queued without pausing when the server already had a run', () => {
    const queue = finishSend(beginSend(queued('first'), 'q1'), 'q1', 'busy');
    assert.equal(queue.paused, null);
    assert.equal(queue.sendingId, null);
    assert.equal(queue.items.length, 1);
  });

  it('pauses once after a stopped run instead of sending straight after Stop', () => {
    const stopped = run({ id: 'run-9', state: 'cancelled' });
    let queue = queued('follow-up');
    assert.deepEqual(drainDecision(queue, { ...idle, latestRun: stopped }), {
      kind: 'pause',
      runId: 'run-9'
    });
    queue = pauseForStoppedRun(queue, 'run-9');
    assert.equal(drainDecision(queue, { ...idle, latestRun: stopped }).kind, 'wait');
    queue = resume(queue);
    assert.equal(drainDecision(queue, { ...idle, latestRun: stopped }).kind, 'send');
    // Failed and completed runs do not pause the queue.
    assert.equal(
      drainDecision(queued('x'), { ...idle, latestRun: run({ state: 'failed' }) }).kind,
      'send'
    );
  });

  it('holds the head while it is being edited and saves edits in place', () => {
    let queue = startEditing(queued('first', 'second'), 'q1');
    assert.equal(drainDecision(queue, idle).kind, 'wait');
    queue = saveEdit(queue, 'q1', ' changed ');
    assert.equal(queue.editingId, null);
    assert.equal(queue.items[0]!.text, 'changed');
    assert.equal(drainDecision(queue, idle).kind, 'send');
    // Editing a later message does not hold the head.
    assert.equal(drainDecision(startEditing(queue, 'q2'), idle).kind, 'send');
    assert.equal(cancelEditing(startEditing(queue, 'q2')).editingId, null);
  });

  it('removes a message, or one saved empty, but never the one being sent', () => {
    let queue = queued('first', 'second', 'third');
    queue = removeQueued(queue, 'q2');
    queue = saveEdit(startEditing(queue, 'q3'), 'q3', '  ');
    assert.deepEqual(
      queue.items.map(item => item.id),
      ['q1']
    );
    assert.equal(queue.editingId, null);
    const sending = beginSend(queue, 'q1');
    assert.equal(removeQueued(sending, 'q1'), sending);
    assert.equal(startEditing(sending, 'q1'), sending);
  });

  it('claims a queued message exactly once per thread', () => {
    updateQueue('scope|thread-a', () => queued('for a'));
    updateQueue('scope|thread-b', () => queued('for b'));
    const first = claimNext('scope|thread-a', 'q1');
    assert.equal(first?.text, 'for a');
    // A repeated effect (StrictMode, re-render) cannot claim it again.
    assert.equal(claimNext('scope|thread-a', 'q1'), null);
    // Other threads are untouched.
    assert.equal(getQueue('scope|thread-b').sendingId, null);
    assert.equal(getQueue('scope|thread-b').items[0]!.text, 'for b');
    updateQueue('scope|thread-a', queue => finishSend(queue, 'q1', 'accepted'));
    assert.equal(getQueue('scope|thread-a'), EMPTY_QUEUE);
  });
});
