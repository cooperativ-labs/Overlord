import assert from 'node:assert/strict';
import test from 'node:test';

import type { BackendClient } from '../src/backend-client.ts';
import { fetchLaunchSettings, resetLaunchSettingsWorkspaceCache } from '../src/launch-settings.ts';
import { fetchTerminalProfile, saveTerminalProfile } from '../src/terminal-profile.ts';

function backend(
  responses: Record<string, unknown>,
  calls: Array<{ method: string; path: string }>
): BackendClient {
  const respond = async <T>(method: string, requestPath: string): Promise<T> => {
    calls.push({ method, path: requestPath });
    if (!(requestPath in responses)) throw new Error(`Unexpected ${method} ${requestPath}`);
    return responses[requestPath] as T;
  };
  return {
    baseUrl: 'https://backend.example.test',
    health: async () => ({ ok: true }),
    get: path => respond('GET', path),
    post: ({ path }) => respond('POST', path),
    patch: ({ path }) => respond('PATCH', path),
    delete: path => respond('DELETE', path),
    postRaw: ({ path }) => respond('POST', path)
  };
}

test('launch-settings helpers keep mission and claim workspace IDs explicit', async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const client = backend(
    {
      '/api/workspaces/workspace-b/launch-settings': {
        executionTargetId: 'target-b',
        deviceLabel: 'B machine',
        terminalProfile: { launcher: 'iTerm2', placement: 'tab', chord: null, background: true }
      },
      '/api/workspaces/workspace-b/launch-settings/terminal-profile': {
        executionTargetId: 'target-b',
        deviceLabel: 'B machine',
        terminalProfile: { launcher: 'Terminal', placement: 'chord', chord: 'cmd+d' }
      }
    },
    calls
  );

  const read = await fetchTerminalProfile({ backend: client, workspaceId: 'workspace-b' });
  assert.deepEqual(read, {
    executionTargetId: 'target-b',
    deviceLabel: 'B machine',
    launcher: 'iTerm2',
    placement: 'tab',
    chord: null,
    background: true
  });
  const saved = await saveTerminalProfile({
    backend: client,
    workspaceId: 'workspace-b',
    profile: { launcher: 'Terminal', placement: 'chord', chord: 'cmd+d' }
  });
  assert.equal(saved.placement, 'chord');
  assert.deepEqual(calls, [
    { method: 'GET', path: '/api/workspaces/workspace-b/launch-settings' },
    { method: 'PATCH', path: '/api/workspaces/workspace-b/launch-settings/terminal-profile' }
  ]);
});

test('active-workspace fallback caching is isolated by backend client identity', async () => {
  resetLaunchSettingsWorkspaceCache();
  const firstCalls: Array<{ method: string; path: string }> = [];
  const secondCalls: Array<{ method: string; path: string }> = [];
  const first = backend(
    {
      '/api/workspaces': [{ id: 'workspace-a', isActive: true }],
      '/api/workspaces/workspace-a/launch-settings': { value: 'a' }
    },
    firstCalls
  );
  const second = backend(
    {
      '/api/workspaces': [{ id: 'workspace-b', isActive: true }],
      '/api/workspaces/workspace-b/launch-settings': { value: 'b' }
    },
    secondCalls
  );

  assert.deepEqual(await fetchLaunchSettings({ backend: first }), { value: 'a' });
  assert.deepEqual(await fetchLaunchSettings({ backend: first }), { value: 'a' });
  assert.deepEqual(await fetchLaunchSettings({ backend: second }), { value: 'b' });

  assert.equal(firstCalls.filter(call => call.path === '/api/workspaces').length, 1);
  assert.equal(secondCalls.filter(call => call.path === '/api/workspaces').length, 1);
  assert.ok(firstCalls.every(call => call.path !== '/api/launch-settings'));
  assert.ok(secondCalls.every(call => call.path !== '/api/launch-settings'));
});
