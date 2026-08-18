import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

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

/**
 * The escalation path must survive an otherwise-idle event loop.
 *
 * Inside the test runner there is always other work pending, so an unref'd
 * escalation timer still fires and the bug hides. This runs the supervisor in a
 * clean child process whose *only* pending handle is that timer — exactly the
 * shape of Electron's main process at quit when the backend ignores SIGTERM. If
 * the timer does not hold the loop open, the child exits before `stop()`
 * resolves and prints nothing.
 */
describe('process supervisor escalation on an idle event loop', () => {
  it('resolves stop() even when the escalation timer is the only pending work', async () => {
    const moduleUrl = pathToFileURL(path.join(__dirname, 'backend-process.ts')).href;
    const source = `
      import { createProcessSupervisor } from ${JSON.stringify(moduleUrl)};

      // A child that ignores the graceful kill and only dies when force-killed.
      // It schedules no timers of its own, so the supervisor's escalation timer
      // is the sole thing that can keep this process alive.
      let listener = () => {};
      const child = {
        pid: 4242,
        kill: () => true,
        once: (_event, fn) => { listener = fn; }
      };

      const supervisor = createProcessSupervisor({
        fork: () => child,
        forceKill: () => listener(null),
        graceMs: 20,
        forceMs: 50
      });

      supervisor.start();
      await supervisor.stop();
      console.log('stopped:' + supervisor.isRunning());
    `;

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      resolve => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '--eval', source],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        child.once('close', code => resolve({ code, stdout, stderr }));
      }
    );

    assert.equal(result.code, 0, `child exited non-zero: ${result.stderr}`);
    assert.match(
      result.stdout,
      /stopped:false/,
      'stop() never resolved: the escalation timer did not hold the event loop open'
    );
  });
});
