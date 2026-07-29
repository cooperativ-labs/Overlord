import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Contract v38: the `x-overlord-device-*` headers are a machine-local lookup
 * hint. A browser profile is not a machine, so an ordinary browser tab resolves
 * no identity and no longer invents a `localStorage` pseudo-fingerprint. Only
 * the desktop shell bridge, which can report a real machine identity, does.
 */

type StoredRecord = Record<string, string>;

function installBrowserGlobals({
  bridge,
  store
}: {
  bridge?: { getDeviceIdentity: () => Promise<Record<string, string>> };
  store: StoredRecord;
}): void {
  const localStorageStub = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    }
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
  (globalThis as Record<string, unknown>).window = {
    localStorage: localStorageStub,
    ...(bridge ? { overlord: bridge } : {})
  };
}

/** The module caches the resolved identity, so each case needs a fresh instance. */
async function loadFreshModule(): Promise<typeof import('./device-identity.ts')> {
  return (await import(
    `./device-identity.ts?t=${Math.random()}`
  )) as typeof import('./device-identity.ts');
}

describe('client device identity headers', () => {
  it('resolves no identity in an ordinary browser and clears the legacy fingerprint', async () => {
    const store: StoredRecord = { 'overlord.deviceFingerprint': 'legacy-pseudo-fingerprint' };
    installBrowserGlobals({ store });
    const mod = await loadFreshModule();

    assert.equal(await mod.resolveClientDeviceIdentity(), null);
    assert.equal(
      store['overlord.deviceFingerprint'],
      undefined,
      'the legacy browser pseudo-fingerprint is cleared rather than reused'
    );
    // With no identity there is nothing to send, on any backend.
    assert.deepEqual(await mod.remoteBackendDeviceHeaders(), {});
  });

  it('resolves the real machine identity through the desktop shell bridge', async () => {
    const store: StoredRecord = {};
    installBrowserGlobals({
      store,
      bridge: {
        getDeviceIdentity: async () => ({
          deviceFingerprint: 'real-machine-fingerprint',
          deviceLabel: 'Jake MBP',
          devicePlatform: 'darwin'
        })
      }
    });
    const mod = await loadFreshModule();

    const identity = await mod.resolveClientDeviceIdentity();
    assert.ok(identity);
    assert.equal(identity.deviceFingerprint, 'real-machine-fingerprint');
    assert.deepEqual(mod.clientDeviceHeaders(identity), {
      'x-overlord-device-fingerprint': 'real-machine-fingerprint',
      'x-overlord-device-label': 'Jake MBP',
      'x-overlord-device-platform': 'darwin'
    });
  });
});
