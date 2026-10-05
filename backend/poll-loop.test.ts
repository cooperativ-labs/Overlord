import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { PollLoop, stopOnTermination } from './poll-loop.ts';

class TestLoop extends PollLoop<number> {
  passes = 0;
  enabled = true;
  failWith: Error | null = null;
  errors: unknown[] = [];
  release: (() => void) | null = null;
  holdNext = false;

  constructor(options: { intervalMs?: number; unref?: boolean; runOnStart?: boolean } = {}) {
    super({ intervalMs: 60_000, logPrefix: 'test-loop', ...options });
  }

  pass(): Promise<number | undefined> {
    return this.poll();
  }

  get halted(): boolean {
    return this.isStopped;
  }

  protected override shouldPoll(): boolean {
    return this.enabled;
  }

  protected override onPollError(error: unknown): void {
    this.errors.push(error);
  }

  protected async runOnce(): Promise<number> {
    this.passes++;
    if (this.holdNext) {
      this.holdNext = false;
      await new Promise<void>(resolve => (this.release = resolve));
    }
    if (this.failWith) throw this.failWith;
    return this.passes;
  }
}

test('start() is idempotent and stop() clears the timer', async t => {
  const created: unknown[] = [];
  const cleared: unknown[] = [];
  t.mock.method(globalThis, 'setInterval', (() => {
    const handle = { unref: () => handle };
    created.push(handle);
    return handle;
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, 'clearInterval', ((handle: unknown) => {
    cleared.push(handle);
  }) as typeof clearInterval);
  const loop = new TestLoop();
  loop.start();
  loop.start();
  assert.equal(created.length, 1, 'a second start() does not add a timer');
  await loop.stop();
  assert.deepEqual(cleared, created);
  assert.equal(loop.halted, true);
  loop.start();
  assert.equal(created.length, 2, 'a stopped loop can be started again');
  assert.equal(loop.halted, false);
  await loop.stop();
});

test('unref is opt-in and runOnStart drives one pass immediately', async t => {
  let unrefs = 0;
  t.mock.method(globalThis, 'setInterval', (() => {
    const handle = {
      unref: () => {
        unrefs++;
        return handle;
      }
    };
    return handle;
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, 'clearInterval', (() => undefined) as typeof clearInterval);
  const plain = new TestLoop();
  plain.start();
  assert.equal(unrefs, 0);
  assert.equal(plain.passes, 0, 'no pass until the first interval');
  const eager = new TestLoop({ unref: true, runOnStart: true });
  eager.start();
  assert.equal(unrefs, 1);
  assert.equal(eager.passes, 1);
  await Promise.all([plain.stop(), eager.stop()]);
});

test('a pass in flight blocks a re-entrant pass', async () => {
  const loop = new TestLoop();
  loop.holdNext = true;
  const first = loop.pass();
  assert.equal(await loop.pass(), undefined, 'the overlapping pass is skipped');
  loop.release!();
  assert.equal(await first, 1);
  assert.equal(loop.passes, 1);
  assert.equal(await loop.pass(), 2, 'the guard clears once the pass finishes');
});

test('shouldPoll() false skips the pass', async () => {
  const loop = new TestLoop();
  loop.enabled = false;
  assert.equal(await loop.pass(), undefined);
  assert.equal(loop.passes, 0);
  loop.enabled = true;
  assert.equal(await loop.pass(), 1);
});

test('a failing pass is reported, never rejects, and does not wedge the guard', async () => {
  const loop = new TestLoop();
  loop.failWith = new Error('boom');
  assert.equal(await loop.pass(), undefined);
  await loop.pollNow();
  assert.equal(loop.errors.length, 2);
  loop.failWith = null;
  assert.equal(await loop.pass(), 3);
});

test('stop() refuses further passes and resolves after the pass in flight', async () => {
  const loop = new TestLoop();
  loop.holdNext = true;
  const first = loop.pass();
  let stopped = false;
  const stopping = loop.stop().then(() => (stopped = true));
  await Promise.resolve();
  assert.equal(stopped, false, 'stop waits for the pass in flight');
  loop.release!();
  await Promise.all([first, stopping]);
  assert.equal(stopped, true);
  await loop.pollNow();
  assert.equal(await loop.pass(), undefined);
  assert.equal(loop.passes, 1, 'no pass runs after stop()');
});

class FakeProcess extends EventEmitter {
  readonly pid = 4242;
  readonly kills: Array<[number, NodeJS.Signals]> = [];
  kill(pid: number, signal: NodeJS.Signals): true {
    this.kills.push([pid, signal]);
    return true;
  }
}

test('stopOnTermination stops every loop, then re-raises the signal once', async () => {
  const target = new FakeProcess();
  const order: string[] = [];
  let finishSlow: () => void = () => undefined;
  stopOnTermination(
    [
      { stop: () => void order.push('sync') },
      {
        stop: () =>
          new Promise<void>(resolve => {
            order.push('slow');
            finishSlow = () => {
              order.push('slow-done');
              resolve();
            };
          })
      },
      {
        stop: () => {
          throw new Error('stop failed');
        }
      },
      { stop: () => Promise.reject(new Error('stop rejected')) }
    ],
    { target: target as unknown as NodeJS.Process, drainTimeoutMs: 60_000 }
  );
  target.emit('SIGTERM');
  assert.deepEqual(order, ['sync', 'slow'], 'every loop is asked to stop synchronously');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(target.kills, [], 'the signal waits for the drain');
  finishSlow();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(target.kills, [[4242, 'SIGTERM']]);
  target.emit('SIGTERM');
  assert.equal(target.kills.length, 1, 'the listener is one-shot');
});

test('stopOnTermination re-raises after the drain timeout when a loop never stops', async () => {
  const target = new FakeProcess();
  stopOnTermination([{ stop: () => new Promise<void>(() => undefined) }], {
    target: target as unknown as NodeJS.Process,
    drainTimeoutMs: 10
  });
  target.emit('SIGINT');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(target.kills, [[4242, 'SIGINT']]);
});
