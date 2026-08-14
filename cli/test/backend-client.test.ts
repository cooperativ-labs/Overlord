import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authCredentialsPath,
  clearStoredAuthCredentials,
  writeStoredAuthCredentials
} from '../src/auth-credentials.ts';
import { createBackendClient } from '../src/backend-client.ts';
import { clientDeviceIdentity } from '../src/device-identity.ts';
import { resetExplicitRuntimeEnvForTests } from '../src/env.ts';
import { CliError } from '../src/errors.ts';

const ISOLATED_ENV_KEYS = [
  'OVERLORD_BACKEND_URL',
  'OVERLORD_BACKEND_URL_DEV',
  'OVERLORD_USER_TOKEN',
  'OVLD_USER_TOKEN',
  'USER_TOKEN'
] as const;

/**
 * The backend URL these tests resolve against.
 *
 * It has to be pinned through the explicit runtime override, not through a
 * `$OVLD_HOME/overlord.toml`: `findEffectiveConfigPath` walks up from the cwd
 * first, so a test running inside the repo always resolves the repo's own
 * (per-instance, uncommitted) `overlord.toml` and never the temp one. Relying on
 * that file made stored-credential matching depend on whichever backend the
 * developer happened to be pointed at.
 */
const TEST_BACKEND_URL = 'http://127.0.0.1:4310';

function isolateBackendClientEnv(): Record<(typeof ISOLATED_ENV_KEYS)[number], string | undefined> {
  const previous = {} as Record<(typeof ISOLATED_ENV_KEYS)[number], string | undefined>;
  for (const key of ISOLATED_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  process.env.OVERLORD_BACKEND_URL = TEST_BACKEND_URL;
  // `isExplicitRuntimeEnv` is snapshotted at import time, so the override only
  // outranks config once the baseline is re-established.
  resetExplicitRuntimeEnvForTests();
  return previous;
}

function restoreBackendClientEnv(
  previous: Record<(typeof ISOLATED_ENV_KEYS)[number], string | undefined>
): void {
  for (const key of ISOLATED_ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  resetExplicitRuntimeEnvForTests();
}

test('clearStoredAuthCredentials removes auth.json', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overlord-auth-clear-'));
  const previousHome = process.env.OVLD_HOME;
  process.env.OVLD_HOME = home;

  try {
    writeStoredAuthCredentials({
      type: 'session_bearer',
      token: 'session-token',
      backendUrl: 'http://127.0.0.1:4310'
    });
    assert.ok(existsSync(authCredentialsPath()));
    clearStoredAuthCredentials();
    assert.equal(existsSync(authCredentialsPath()), false);
  } finally {
    if (previousHome === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previousHome;
  }
});

test('createBackendClient preserves stored credentials and guides re-login on 401', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overlord-backend-client-'));
  const previousHome = process.env.OVLD_HOME;
  const previousEnv = isolateBackendClientEnv();
  process.env.OVLD_HOME = home;

  // The stored credential only carries an Authorization header when its
  // backendUrl matches the resolved one, which is what puts the request on the
  // "saved credentials were rejected" branch under test.
  writeStoredAuthCredentials({
    type: 'session_bearer',
    token: 'stale-session-token',
    backendUrl: TEST_BACKEND_URL
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch;

  try {
    const backend = createBackendClient();
    await assert.rejects(
      () => backend.get('/api/meta'),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.match(error.message, /ovld auth login/i);
        assert.match(error.message, /credentials were rejected/i);
        return true;
      }
    );
    // A 401 must NOT delete the stored credential — it may be transient, and
    // wiping it forced an avoidable full re-login.
    assert.equal(existsSync(authCredentialsPath()), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBackendClientEnv(previousEnv);
    if (previousHome === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previousHome;
  }
});

test('createBackendClient explains when stored credentials target a different backend URL', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overlord-backend-client-url-mismatch-'));
  const previousHome = process.env.OVLD_HOME;
  const previousEnv = isolateBackendClientEnv();
  process.env.OVLD_HOME = home;
  writeStoredAuthCredentials({
    type: 'session_bearer',
    token: 'session-token',
    backendUrl: 'http://127.0.0.1:4311'
  });

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response();
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => createBackendClient().get('/api/runner/claim'),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.match(error.message, /Saved credentials are for http:\/\/127\.0\.0\.1:4311/i);
        assert.match(error.message, /configured for http:\/\/127\.0\.0\.1:4310/i);
        assert.match(error.message, /ovld auth login/i);
        return true;
      }
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBackendClientEnv(previousEnv);
    if (previousHome === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previousHome;
  }
});

test('createBackendClient sends local device identity headers', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overlord-backend-client-device-'));
  const previousHome = process.env.OVLD_HOME;
  const previousEnv = isolateBackendClientEnv();
  process.env.OVLD_HOME = home;

  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | null = null;
  globalThis.fetch = (async (_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const backend = createBackendClient();
    await backend.get('/api/launch-settings');

    const identity = clientDeviceIdentity();
    assert.equal(capturedHeaders?.get('x-overlord-device-fingerprint'), identity.deviceFingerprint);
    assert.equal(capturedHeaders?.get('x-overlord-device-label'), identity.deviceLabel);
    assert.equal(capturedHeaders?.get('x-overlord-device-platform'), identity.devicePlatform);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBackendClientEnv(previousEnv);
    if (previousHome === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previousHome;
  }
});

test('backend requests do not send workspace-selection headers', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'overlord-backend-client-workspace-'));
  const previousHome = process.env.OVLD_HOME;
  const previousEnv = isolateBackendClientEnv();
  process.env.OVLD_HOME = home;

  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | null = null;
  globalThis.fetch = (async (_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    await createBackendClient().get('/api/meta');
    assert.equal(capturedHeaders?.has('x-overlord-active-workspace'), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreBackendClientEnv(previousEnv);
    if (previousHome === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previousHome;
  }
});
