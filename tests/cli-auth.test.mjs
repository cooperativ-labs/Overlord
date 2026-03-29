/* global Response, global, process */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function importFresh(relativePath) {
  const fileUrl = pathToFileURL(path.join(ROOT, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}-${Math.random()}`);
}

async function withTempHome(callback) {
  const previousOverlordUrl = process.env.OVERLORD_URL;

  try {
    delete process.env.OVERLORD_URL;
    return await callback();
  } finally {
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
  }
}

for (const modulePath of [
  'bin/_cli/auth.mjs',
  'packages/overlord-cli/bin/_cli/auth.mjs'
]) {
  test(`${modulePath} authLoginViaDeviceFlow opens the verification URL and polls until authorized`, async () => {
    const { authLoginViaDeviceFlow } = await importFresh(modulePath);
    const originalFetch = global.fetch;
    const fetchCalls = [];
    const sleepCalls = [];
    const logLines = [];
    const stdoutChunks = [];
    let openedUrl = null;

    const responses = [
      new Response(
        JSON.stringify({
          device_code: 'device-123',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://ovld.test/auth/device?code=ABCD-EFGH',
          interval: 5
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
      new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      new Response(JSON.stringify({ status: 'slow_down', interval: 7 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      }),
      new Response(
        JSON.stringify({
          status: 'authorized',
          access_token: 'agent-token-123',
          platform_url: 'https://ovld.test'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ];

    global.fetch = async (url, init = {}) => {
      fetchCalls.push({
        url: String(url),
        method: init.method ?? 'GET',
        body: init.body ?? null
      });

      const next = responses.shift();
      if (!next) {
        throw new Error(`Unexpected fetch: ${String(url)}`);
      }
      return next;
    };

    try {
      const credentials = await authLoginViaDeviceFlow('https://ovld.test', 'local-secret', {
        browserOpener: url => {
          openedUrl = url;
        },
        logger: {
          log: (...args) => {
            logLines.push(args.join(' '));
          }
        },
        sleepFn: async ms => {
          sleepCalls.push(ms);
        },
        stdout: {
          write: chunk => {
            stdoutChunks.push(String(chunk));
          }
        }
      });

      assert.deepEqual(credentials, {
        access_token: 'agent-token-123',
        platform_url: 'https://ovld.test'
      });
      assert.equal(openedUrl, 'https://ovld.test/auth/device?code=ABCD-EFGH');
      assert.deepEqual(
        fetchCalls.map(call => [call.method, call.url]),
        [
          ['POST', 'https://ovld.test/api/auth/device/request'],
          ['POST', 'https://ovld.test/api/auth/device/poll'],
          ['POST', 'https://ovld.test/api/auth/device/poll'],
          ['POST', 'https://ovld.test/api/auth/device/poll']
        ]
      );
      assert.deepEqual(sleepCalls, [5000, 5000, 7000]);
      assert.match(logLines.join('\n'), /Verification URL:/);
      assert.match(logLines.join('\n'), /Authorization code: ABCD-EFGH/);
      assert.equal(stdoutChunks.join(''), 'Waiting for browser authorization..');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test(`${modulePath} authLoginViaDeviceFlow surfaces expired authorization requests`, async () => {
    const { authLoginViaDeviceFlow } = await importFresh(modulePath);
    const originalFetch = global.fetch;

    global.fetch = async url => {
      if (String(url).endsWith('/api/auth/device/request')) {
        return new Response(
          JSON.stringify({
            device_code: 'device-123',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://ovld.test/auth/device?code=ABCD-EFGH',
            interval: 5
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      await assert.rejects(
        () =>
          authLoginViaDeviceFlow('https://ovld.test', 'local-secret', {
            browserOpener: () => {},
            logger: { log: () => {} },
            sleepFn: async () => {},
            stdout: { write: () => {} }
          }),
        /Authorization request expired/
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test(`${modulePath} resolveLoginPlatformUrl defaults to the hosted platform when no local runtime exists`, async () => {
    await withTempHome(async () => {
      const { resolveLoginPlatformUrl } = await importFresh(modulePath);
      assert.match(resolveLoginPlatformUrl(null), /^https:\/\/(?:www\.)?ovld\.ai$/);
    });
  });
}
