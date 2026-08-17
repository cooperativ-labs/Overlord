import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProcessSupervisor, type SupervisedChild } from './backend-process.js';

/**
 * A fake child process. `exitDelayMs` models how long the real process takes to
 * go away after a graceful kill; `ignoreGraceful` models one that never does,
 * which is what the escalation path exists for.
 */
class FakeChild implements SupervisedChild {
  readonly pid: number;
  killed = false;
  exited = false;
  private readonly listeners: Array<(code: number | null) => void> = [];

  constructor(
    pid: number,
    private readonly options: { exitDelayMs?: number; ignoreGraceful?: boolean } = {}
  ) {
    this.pid = pid;
  }

  kill(): boolean {
    this.killed = true;
    if (!this.options.ignoreGraceful) {
      setTimeout(() => this.exit(0), this.options.exitDelayMs ?? 0);
    }
    return true;
  }

  once(_event: 'exit', listener: (code: number | null) => void): void {
    if (this.exited) {
      setTimeout(() => listener(0), 0);
      return;
    }
    this.listeners.push(listener);
  }

  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.listeners.splice(0)) listener(code);
  }
}

function createFakeTable() {
  const forked: FakeChild[] = [];
  let nextPid = 1000;
  const forceKilled: number[] = [];
  return {
    forked,
    forceKilled,
    live: () => forked.filter(child => !child.exited),
    fork: (options?: { exitDelayMs?: number; ignoreGraceful?: boolean }) => {
      const child = new FakeChild((nextPid += 1), options);
      forked.push(child);
      return child;
    },
    forceKill: (pid: number) => {
      forceKilled.push(pid);
      forked.find(child => child.pid === pid)?.exit(null);
    }
  };
}

describe('process supervisor', () => {
  it('never forks a second process while one is running', () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({ fork: () => table.fork() });

    const first = supervisor.start();
    const second = supervisor.start();

    assert.equal(table.forked.length, 1);
    assert.equal(first, second);
    assert.equal(supervisor.isRunning(), true);
  });

  it('resolves stop() only after the process has actually exited', async () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({ fork: () => table.fork({ exitDelayMs: 25 }) });

    const child = supervisor.start();
    const stopped = supervisor.stop();
    assert.equal(child.exited, false, 'kill is asynchronous; the process is still alive');

    await stopped;
    assert.equal(child.exited, true);
    assert.equal(supervisor.isRunning(), false);
    assert.equal(table.live().length, 0);
  });

  it('escalates to a force kill when the process ignores the graceful stop', async () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({
      fork: () => table.fork({ ignoreGraceful: true }),
      forceKill: table.forceKill,
      graceMs: 20,
      forceMs: 50
    });

    const child = supervisor.start();
    await supervisor.stop();

    assert.deepEqual(table.forceKilled, [child.pid]);
    assert.equal(child.exited, true);
    assert.equal(supervisor.isRunning(), false);
  });

  it('does not let a stale exit event orphan a newly started process', async () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({ fork: () => table.fork({ exitDelayMs: 30 }) });

    const first = supervisor.start();
    // Simulate the pre-fix ordering: the replacement is started before the old
    // process's exit event is delivered.
    const stopped = supervisor.stop();
    await stopped;
    const second = supervisor.start();
    first.exit(0); // late duplicate delivery

    assert.equal(supervisor.isRunning(), true, 'the live process must still be tracked');
    assert.equal(supervisor.pid(), second.pid);

    await supervisor.stop();
    assert.equal(table.live().length, 0, 'no process is left behind');
  });

  it('is a no-op when nothing is running', async () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({ fork: () => table.fork() });
    await supervisor.stop();
    assert.equal(table.forked.length, 0);
    assert.equal(supervisor.pid(), null);
  });

  it('coalesces concurrent stop() calls into one reap', async () => {
    const table = createFakeTable();
    const supervisor = createProcessSupervisor({ fork: () => table.fork({ exitDelayMs: 10 }) });

    const child = supervisor.start();
    await Promise.all([supervisor.stop(), supervisor.stop(), supervisor.stop()]);

    assert.equal(child.exited, true);
    assert.equal(table.live().length, 0);
  });
});
