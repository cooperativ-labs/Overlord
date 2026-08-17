import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activateBackendProfile,
  type BackendActivation,
  type BackendLifecycleEffects,
  shouldRunEmbeddedBackend,
  shutdownBackendProfile
} from './backend-lifecycle.js';
import { createProcessSupervisor, type SupervisedChild } from './backend-process.js';

/**
 * Regression coverage for the Desktop backend-profile process lifecycle.
 *
 * The rule under test is the contract's: a **Remote** profile must never start
 * or retain the embedded local Node/REST backend. The harness wires the real
 * lifecycle policy to the real process supervisor over a fake process table, so
 * the assertions are about how many backend processes actually exist at each
 * point — not about which functions were called.
 */

const REMOTE_URL = 'https://overlord.example.com';
const SHELL_ORIGIN = 'http://127.0.0.1:4310';

class FakeBackendProcess implements SupervisedChild {
  readonly pid: number;
  exited = false;
  private readonly listeners: Array<(code: number | null) => void> = [];

  constructor(
    pid: number,
    readonly port: number
  ) {
    this.pid = pid;
  }

  kill(): boolean {
    setTimeout(() => this.exit(0), 0);
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

interface Harness {
  effects: BackendLifecycleEffects;
  /** Every backend process the shell has ever forked. */
  forked: FakeBackendProcess[];
  liveBackends: () => FakeBackendProcess[];
  staticServerRunning: () => boolean;
  configSyncs: () => number;
  setLocalHealthy: (healthy: boolean) => void;
  setRemoteHealthy: (healthy: boolean) => void;
}

function createHarness(): Harness {
  const forked: FakeBackendProcess[] = [];
  let nextPid = 5000;
  let staticRunning = false;
  let configSyncs = 0;
  let localHealthy = true;
  let remoteHealthy = true;
  let pendingPort = 0;

  const supervisor = createProcessSupervisor<FakeBackendProcess>({
    fork: () => {
      const child = new FakeBackendProcess((nextPid += 1), pendingPort);
      forked.push(child);
      return child;
    }
  });

  const effects: BackendLifecycleEffects = {
    startBackend: ({ port }) => {
      pendingPort = port;
      supervisor.start();
    },
    stopBackend: () => supervisor.stop(),
    isBackendRunning: () => supervisor.isRunning(),
    startShellStaticServer: () => {
      staticRunning = true;
    },
    stopShellStaticServer: () => {
      staticRunning = false;
    },
    waitForLocalHealth: () => Promise.resolve(localHealthy),
    waitForRemoteHealth: () => Promise.resolve(remoteHealthy),
    syncProfileConfig: () => {
      configSyncs += 1;
    }
  };

  return {
    effects,
    forked,
    liveBackends: () => forked.filter(child => !child.exited),
    staticServerRunning: () => staticRunning,
    configSyncs: () => configSyncs,
    setLocalHealthy: healthy => {
      localHealthy = healthy;
    },
    setRemoteHealthy: healthy => {
      remoteHealthy = healthy;
    }
  };
}

function localActivation(overrides: Partial<BackendActivation> = {}): BackendActivation {
  return {
    mode: 'local',
    shellOrigin: SHELL_ORIGIN,
    apiBaseUrl: SHELL_ORIGIN,
    host: '127.0.0.1',
    devConnect: false,
    ...overrides
  };
}

function remoteActivation(overrides: Partial<BackendActivation> = {}): BackendActivation {
  return {
    mode: 'remote',
    shellOrigin: SHELL_ORIGIN,
    apiBaseUrl: REMOTE_URL,
    host: '127.0.0.1',
    devConnect: false,
    ...overrides
  };
}

describe('backend profile lifecycle', () => {
  it('cold Remote startup runs only the SPA shell — no embedded backend', async () => {
    const harness = createHarness();

    const result = await activateBackendProfile(remoteActivation(), harness.effects);

    assert.equal(result.healthy, true);
    assert.equal(result.backendRunning, false);
    assert.equal(harness.forked.length, 0, 'Remote must never fork the embedded backend');
    assert.equal(harness.liveBackends().length, 0);
    assert.equal(harness.staticServerRunning(), true, 'the SPA shell is still served locally');
    assert.equal(harness.configSyncs(), 1);
  });

  it('cold Local startup forks exactly one embedded backend on the shell port', async () => {
    const harness = createHarness();

    const result = await activateBackendProfile(localActivation(), harness.effects);

    assert.equal(result.healthy, true);
    assert.equal(result.backendRunning, true);
    assert.equal(harness.forked.length, 1);
    assert.equal(harness.forked[0].port, 4310);
    assert.equal(harness.staticServerRunning(), false);
  });

  it('Local → Remote terminates and reaps the embedded backend', async () => {
    const harness = createHarness();
    await activateBackendProfile(localActivation(), harness.effects);
    const localBackend = harness.forked[0];

    await activateBackendProfile(remoteActivation(), harness.effects);

    assert.equal(localBackend.exited, true, 'the local backend is reaped, not merely signalled');
    assert.equal(harness.liveBackends().length, 0);
    assert.equal(harness.effects.isBackendRunning(), false);
    assert.equal(harness.forked.length, 1, 'no backend is forked for the Remote profile');
  });

  it('refuses to activate Remote while an embedded backend is still running', async () => {
    const harness = createHarness();
    // A supervisor that reports a stop as done while the process survives is
    // exactly the failure this guard exists to catch.
    const effects: BackendLifecycleEffects = {
      ...harness.effects,
      stopBackend: () => Promise.resolve(),
      isBackendRunning: () => true
    };

    await assert.rejects(
      () => activateBackendProfile(remoteActivation(), effects),
      /embedded local backend is still running/
    );
  });

  it('Remote → Local starts exactly one backend', async () => {
    const harness = createHarness();
    await activateBackendProfile(remoteActivation(), harness.effects);

    const result = await activateBackendProfile(localActivation(), harness.effects);

    assert.equal(result.backendRunning, true);
    assert.equal(harness.forked.length, 1);
    assert.equal(harness.liveBackends().length, 1);
    assert.equal(harness.staticServerRunning(), false, 'the static shell yields to the backend');
  });

  it('repeated Local/Remote switches never accumulate backend processes', async () => {
    const harness = createHarness();

    for (let round = 0; round < 5; round += 1) {
      await activateBackendProfile(localActivation(), harness.effects);
      assert.equal(harness.liveBackends().length, 1, `round ${round}: exactly one in Local`);

      await activateBackendProfile(remoteActivation(), harness.effects);
      assert.equal(harness.liveBackends().length, 0, `round ${round}: none in Remote`);
    }

    assert.equal(harness.forked.length, 5, 'one fork per Local activation, never more');
    assert.equal(harness.liveBackends().length, 0);
  });

  it('a failed Remote start leaves no local backend behind', async () => {
    const harness = createHarness();
    await activateBackendProfile(localActivation(), harness.effects);
    harness.setRemoteHealthy(false);

    const result = await activateBackendProfile(remoteActivation(), harness.effects);

    assert.equal(result.healthy, false);
    assert.equal(result.backendRunning, false);
    assert.equal(harness.liveBackends().length, 0, 'the reap happens before health is evaluated');
  });

  it('a failed Local start still leaves a single reapable backend', async () => {
    const harness = createHarness();
    harness.setLocalHealthy(false);

    const result = await activateBackendProfile(localActivation(), harness.effects);
    assert.equal(result.healthy, false);
    assert.equal(harness.liveBackends().length, 1);

    // Retrying the same profile must not stack a second backend on top.
    const retry = await activateBackendProfile(localActivation(), harness.effects);
    assert.equal(retry.healthy, false);
    assert.equal(harness.liveBackends().length, 1);
    assert.equal(harness.forked.length, 2, 'the first process is replaced, not duplicated');

    await shutdownBackendProfile(harness.effects);
    assert.equal(harness.liveBackends().length, 0);
  });

  it('shutdown reaps the backend and stops the shell server', async () => {
    const harness = createHarness();
    await activateBackendProfile(localActivation(), harness.effects);

    await shutdownBackendProfile(harness.effects);

    assert.equal(harness.liveBackends().length, 0);
    assert.equal(harness.staticServerRunning(), false);
    assert.equal(harness.effects.isBackendRunning(), false);
  });

  it('shutdown from Remote is a no-op for the backend', async () => {
    const harness = createHarness();
    await activateBackendProfile(remoteActivation(), harness.effects);

    await shutdownBackendProfile(harness.effects);

    assert.equal(harness.forked.length, 0);
    assert.equal(harness.staticServerRunning(), false);
  });

  it('dev-connect mode supervises no local process in either profile', async () => {
    const harness = createHarness();

    const local = await activateBackendProfile(
      localActivation({ devConnect: true }),
      harness.effects
    );
    const remote = await activateBackendProfile(
      remoteActivation({ devConnect: true }),
      harness.effects
    );

    assert.equal(local.backendRunning, false);
    assert.equal(remote.backendRunning, false);
    assert.equal(harness.forked.length, 0);
    assert.equal(harness.staticServerRunning(), false);
  });

  it('only a non-dev Local profile is allowed to run the embedded backend', () => {
    assert.equal(shouldRunEmbeddedBackend({ mode: 'local', devConnect: false }), true);
    assert.equal(shouldRunEmbeddedBackend({ mode: 'local', devConnect: true }), false);
    assert.equal(shouldRunEmbeddedBackend({ mode: 'remote', devConnect: false }), false);
    assert.equal(shouldRunEmbeddedBackend({ mode: 'remote', devConnect: true }), false);
  });
});
