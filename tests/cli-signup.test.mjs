/* global Response, global */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function importFresh(relativePath) {
  const fileUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}-${Math.random()}`);
}

const MODULE = 'packages/overlord-cli/bin/_cli/signup.mjs';

async function withMockedFetch(responses, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ?? null, headers: init.headers ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch: ${String(url)}`);
    return next;
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test(`${MODULE} parseSignupFlags parses values, equals form, and booleans`, async () => {
  const { parseSignupFlags } = await importFresh(MODULE);
  const flags = parseSignupFlags([
    '--email',
    'a@b.com',
    '--name=Build Agent',
    '--no-agent-token',
    '--password',
    'hunter2hunter2'
  ]);
  assert.equal(flags.email, 'a@b.com');
  assert.equal(flags.name, 'Build Agent');
  assert.equal(flags['no-agent-token'], true);
  assert.equal(flags.password, 'hunter2hunter2');
});

test(`${MODULE} requestCliSignup posts email/name/password to the request endpoint`, async () => {
  const { requestCliSignup } = await importFresh(MODULE);
  await withMockedFetch([jsonResponse({ email: 'a@b.com', status: 'confirmation_required', passwordless: false })], async calls => {
    const result = await requestCliSignup('https://ovld.test', 'secret', {
      email: 'a@b.com',
      name: 'Build Agent',
      password: 'hunter2hunter2'
    });
    assert.equal(result.status, 'confirmation_required');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ovld.test/api/auth/cli-signup/request');
    assert.equal(calls[0].method, 'POST');
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(body, { email: 'a@b.com', name: 'Build Agent', password: 'hunter2hunter2' });
    assert.equal(calls[0].headers['X-Overlord-Local-Secret'], 'secret');
  });
});

test(`${MODULE} requestCliSignup omits an unset password`, async () => {
  const { requestCliSignup } = await importFresh(MODULE);
  await withMockedFetch([jsonResponse({ email: 'a@b.com', status: 'confirmation_required', passwordless: true })], async calls => {
    await requestCliSignup('https://ovld.test', '', { email: 'a@b.com', name: 'A' });
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(body, { email: 'a@b.com', name: 'A' });
  });
});

test(`${MODULE} verifyCliSignup posts the code to the verify endpoint`, async () => {
  const { verifyCliSignup } = await importFresh(MODULE);
  await withMockedFetch(
    [jsonResponse({ access_token: 'a', refresh_token: 'r', access_token_expires_at: null, platform_url: 'https://ovld.test' })],
    async calls => {
      const session = await verifyCliSignup('https://ovld.test', '', { email: 'a@b.com', token: '12345678' });
      assert.equal(session.access_token, 'a');
      assert.equal(calls[0].url, 'https://ovld.test/api/auth/cli-signup/verify');
      assert.deepEqual(JSON.parse(calls[0].body), { email: 'a@b.com', token: '12345678' });
    }
  );
});

test(`${MODULE} requestCliLogin / verifyCliLogin hit the login endpoints`, async () => {
  const { requestCliLogin, verifyCliLogin } = await importFresh(MODULE);
  await withMockedFetch([jsonResponse({ email: 'a@b.com', status: 'confirmation_required' })], async calls => {
    await requestCliLogin('https://ovld.test', '', { email: 'a@b.com' });
    assert.equal(calls[0].url, 'https://ovld.test/api/auth/cli-login/request');
  });
  await withMockedFetch([jsonResponse({ access_token: 'a', refresh_token: 'r', platform_url: 'https://ovld.test' })], async calls => {
    const session = await verifyCliLogin('https://ovld.test', '', { email: 'a@b.com', token: '12345678' });
    assert.equal(session.refresh_token, 'r');
    assert.equal(calls[0].url, 'https://ovld.test/api/auth/cli-login/verify');
  });
});

test(`${MODULE} mintAgentToken sends a bearer token and label`, async () => {
  const { mintAgentToken } = await importFresh(MODULE);
  await withMockedFetch([jsonResponse({ token: 'oat_abc', info: { id: 't1' } })], async calls => {
    const result = await mintAgentToken('https://ovld.test', '', 'access-jwt', 'CLI: host');
    assert.equal(result.token, 'oat_abc');
    assert.equal(calls[0].url, 'https://ovld.test/api/auth/agent-token');
    assert.equal(calls[0].headers.Authorization, 'Bearer access-jwt');
    assert.deepEqual(JSON.parse(calls[0].body), { label: 'CLI: host' });
  });
});

test(`${MODULE} network helpers surface server errors with status and code`, async () => {
  const { verifyCliSignup } = await importFresh(MODULE);
  await withMockedFetch([jsonResponse({ error: 'Token has expired', code: 'otp_expired' }, 400)], async () => {
    await assert.rejects(
      () => verifyCliSignup('https://ovld.test', '', { email: 'a@b.com', token: '00000000' }),
      err => {
        assert.equal(err.message, 'Token has expired');
        assert.equal(err.status, 400);
        assert.equal(err.code, 'otp_expired');
        return true;
      }
    );
  });
});
