import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { invokeLocalTargetCapability } from './desktop-bridge.ts';
import { FakeLocalTargetProvider } from './fake-provider.ts';
import { UnavailableProvider } from './registry.ts';
import { ok } from './result.ts';

describe('discoverLatch capability', () => {
  it('dispatches over the bridge to the provider that runs on the target device', async () => {
    const provider = new FakeLocalTargetProvider({
      handlers: {
        discoverLatch: async () =>
          ok(
            { executionTargetId: 'et-1', deviceLabel: 'Mac', transport: 'fake' },
            {
              state: 'found',
              executable: 'latch',
              resolvedPath: '/usr/local/bin/latch',
              protocolVersion: 1,
              productVersion: '0.1.0',
              capabilities: {
                create: true,
                openViewer: true,
                localAttach: true,
                cloudAttach: false,
                selfUpdate: false,
                extensions: []
              },
              checkedAt: '2026-08-12T00:00:00.000Z',
              latchSelectable: true,
              directSelectable: true
            }
          )
      }
    });

    const result = await invokeLocalTargetCapability({
      provider,
      call: { capability: 'discoverLatch', input: { executable: 'latch', force: true } }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(provider.calls.at(-1), {
      capability: 'discoverLatch',
      args: [{ executable: 'latch', force: true }]
    });
  });

  it('fails typed rather than guessing when no transport can reach the target', async () => {
    const provider = new UnavailableProvider(
      { executionTargetId: 'et-2', deviceLabel: 'Remote', transport: 'runner_queue' },
      'LOCAL_TARGET_UNREACHABLE',
      'not co-located'
    );

    const result = await provider.discoverLatch({});
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_UNREACHABLE');
  });
});

describe('Latch terminal-session lifecycle capabilities', () => {
  it('dispatches inspect, open, and stop through the same target provider', async () => {
    const provider = new FakeLocalTargetProvider();
    const calls = [
      {
        capability: 'inspectLatchSession' as const,
        input: { providerSessionId: 'ses_1', executable: 'latch' }
      },
      {
        capability: 'openLatchSession' as const,
        input: { providerSessionId: 'ses_1', executable: 'latch', viewerKind: 'iterm' }
      },
      {
        capability: 'stopLatchSession' as const,
        input: { providerSessionId: 'ses_1', executable: 'latch' }
      }
    ];

    for (const call of calls) {
      const result = await invokeLocalTargetCapability({ provider, call });
      assert.equal(result.ok, true);
    }
    assert.deepEqual(
      provider.calls.slice(-3).map(call => call.capability),
      ['inspectLatchSession', 'openLatchSession', 'stopLatchSession']
    );
  });

  it('keeps target reachability separate from the retained session state', async () => {
    const provider = new UnavailableProvider(
      { executionTargetId: 'et-2', deviceLabel: 'Remote', transport: 'runner_queue' },
      'LOCAL_TARGET_UNREACHABLE',
      'not co-located'
    );
    const result = await provider.inspectLatchSession({ providerSessionId: 'ses_1' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, 'LOCAL_TARGET_UNREACHABLE');
  });
});
