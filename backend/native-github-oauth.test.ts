import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeGitHubOAuth } from './native-github-oauth.ts';

const base = 'https://backend.ovld.ai';
const callback = '/api/auth/callback/github?state=valid-state&code=secret-code';

async function fixture(options: { callback?: (request: Request) => Promise<Response> } = {}) {
  let now = 0;
  let calls = 0;
  const logs: string[] = [];
  const auth = createNativeGitHubOAuth(
    {
      async handler(request) {
        if (request.method === 'POST') {
          assert.equal(request.url, `${base}/api/auth/sign-in/social`);
          assert.equal(
            (await request.json()).errorCallbackURL,
            `${base}/api/auth/desktop/callback`
          );
          return Response.json(
            { url: 'https://github.com/login/oauth/authorize?state=valid-state' },
            {
              headers: {
                'Set-Cookie': '__Secure-better-auth.state=signed-secret; Path=/; Secure; HttpOnly'
              }
            }
          );
        }
        calls++;
        if (options.callback) return options.callback(request);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${base}/api/auth/desktop/callback`,
            'Set-Cookie': '__Secure-better-auth.session_token=private-token; Secure; HttpOnly'
          }
        });
      }
    },
    base,
    { now: () => now, log: (event, correlation) => logs.push(`${event}:${correlation}`) }
  );
  const started = await auth.handler(new Request(`${base}/api/auth/desktop/github`));
  const cookie = started.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ');
  const request = (path = callback, cookies = cookie) =>
    new Request(`${base}${path}`, { headers: { Cookie: cookies } });
  return {
    auth,
    cookie,
    request,
    logs,
    started,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

test('native OAuth starts in the browser with secure, uncached flow cookies', async () => {
  const f = await fixture();
  assert.equal(f.started.status, 302);
  assert.equal(f.started.headers.get('cache-control'), 'no-store');
  assert.match(f.cookie, /__Secure-overlord.native_oauth=/);
  assert.match(
    f.started.headers.getSetCookie()[1],
    /Path=\/api\/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure/
  );
});

test('identical in-flight and completed callbacks share exactly one provider exchange', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => {
    finish = resolve;
  });
  const f = await fixture({ callback: () => pending });
  const a = f.auth.handler(f.request());
  const b = f.auth.handler(f.request());
  assert.equal(f.calls(), 1);
  finish(
    new Response(null, {
      status: 302,
      headers: {
        Location: `${base}/api/auth/desktop/callback`,
        'Set-Cookie': 'session=token; HttpOnly'
      }
    })
  );
  const results = await Promise.all([a, b]);
  results.push(await f.auth.handler(f.request()));
  assert.equal(f.calls(), 1);
  for (const response of results) {
    assert.equal(response.headers.get('location'), `${base}/api/auth/desktop/callback`);
    assert.deepEqual(response.headers.getSetCookie(), ['session=token; HttpOnly']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.logs.filter(line => line.startsWith('callback_recovered')).length, 2);
  assert.doesNotMatch(f.logs.join(' '), /valid-state|secret-code|signed-secret|token/);
});

test('disconnecting the original navigation does not abort the shared exchange', async () => {
  let signal: AbortSignal | undefined;
  const f = await fixture({
    callback: async request => {
      signal = request.signal;
      return Response.redirect(`${base}/api/auth/desktop/callback`);
    }
  });
  const controller = new AbortController();
  const original = new Request(f.request(), { signal: controller.signal });
  const result = f.auth.handler(original);
  controller.abort();
  await result;
  assert.equal(signal?.aborted, false);
  assert.equal((await f.auth.handler(f.request())).status, 302);
  assert.equal(f.calls(), 1);
});

test('changed callback parameters cannot replay the completed response or exchange again', async () => {
  const f = await fixture();
  await f.auth.handler(f.request());
  const result = await f.auth.handler(f.request(callback.replace('secret-code', 'different-code')));
  assert.equal(result.headers.get('location'), 'overlord://auth/callback?error=state_mismatch');
  assert.equal(
    result.headers.getSetCookie().some(value => value.includes('private-token')),
    false
  );
  assert.equal(f.calls(), 1);
});

test('missing, changed or ambiguous browser cookies never get the cached session', async () => {
  const f = await fixture({ callback: async () => new Response('first-exchange') });
  await f.auth.handler(f.request());
  for (const cookies of [
    '',
    f.cookie.replace('signed-secret', 'wrong'),
    f.cookie.replace(
      /__Secure-overlord.native_oauth=[^;]+/,
      '__Secure-overlord.native_oauth=other-browser'
    ),
    `${f.cookie}; __Secure-better-auth.state=other`
  ]) {
    await f.auth.handler(f.request(callback, cookies));
  }
  // Each unbound call reaches Better Auth for its normal validation, never the cache.
  assert.equal(f.calls(), 5);
});

test('expired recovery requires a fresh sign-in and does not exchange the code again', async () => {
  const f = await fixture();
  await f.auth.handler(f.request());
  f.advance(60_001);
  const result = await f.auth.handler(f.request());
  assert.equal(result.headers.get('location'), 'overlord://auth/callback?error=state_mismatch');
  assert.equal(f.calls(), 1);
});

test('native errors return bounded codes; missing or expired flows get a useful page', async () => {
  const f = await fixture();
  for (const [error, code] of [
    ['access_denied', 'access_denied'],
    ['state_mismatch', 'state_mismatch'],
    ['arbitrary<script>', 'sign_in_failed']
  ]) {
    for (const path of ['/api/auth/error', '/api/auth/desktop/callback']) {
      const response = await f.auth.handler(
        f.request(`${path}?error=${encodeURIComponent(error)}`)
      );
      assert.equal(response.headers.get('location'), `overlord://auth/callback?error=${code}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  const missing = await f.auth.handler(f.request('/api/auth/error?error=state_mismatch', ''));
  assert.equal(missing.status, 400);
  assert.equal(missing.headers.get('location'), null);
  assert.match(await missing.text(), /start sign-in again/);
  f.advance(600_001);
  assert.equal(
    (await f.auth.handler(f.request('/api/auth/error?error=state_mismatch'))).status,
    400
  );
});

test('non-native provider callbacks retain Better Auth behavior', async () => {
  const f = await fixture();
  await f.auth.handler(f.request('/api/auth/callback/google?state=valid-state&code=secret-code'));
  assert.equal(f.calls(), 1);
  assert.equal(
    f.logs.some(line => line.startsWith('callback_started')),
    false
  );
});

test('provider exceptions finish the native flow with a bounded error', async () => {
  const f = await fixture({
    callback: async () => {
      throw new Error('private provider failure');
    }
  });
  const result = await f.auth.handler(f.request());
  assert.equal(result.headers.get('location'), 'overlord://auth/callback?error=sign_in_failed');
  assert.doesNotMatch(await result.text(), /private provider/);
  await f.auth.handler(f.request());
  assert.equal(f.calls(), 1);
});

test('local HTTP flow cookies work without Secure and the flow registry is bounded', async () => {
  let now = 0;
  const native = createNativeGitHubOAuth(
    {
      handler: async () =>
        Response.json(
          { url: 'https://github.com/login/oauth/authorize?state=local-state' },
          {
            headers: { 'Set-Cookie': 'better-auth.state=local-signed; Path=/; HttpOnly' }
          }
        )
    },
    'http://127.0.0.1:4310',
    { now: () => now, log: () => {} }
  );
  const request = () => new Request('http://127.0.0.1:4310/api/auth/desktop/github');
  const first = await native.handler(request());
  assert.match(first.headers.getSetCookie()[1], /^overlord.native_oauth=/);
  assert.doesNotMatch(first.headers.getSetCookie()[1], /; Secure/);
  for (let i = 1; i < 256; i++) assert.equal((await native.handler(request())).status, 302);
  assert.equal((await native.handler(request())).status, 503);
  now = 600_001;
  assert.equal((await native.handler(request())).status, 302);
});
