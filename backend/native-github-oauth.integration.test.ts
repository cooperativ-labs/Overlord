import { loadBetterSqlite3 } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAuth } from '../auth/src/auth/config.ts';

import { createNativeGitHubOAuth } from './native-github-oauth.ts';

const base = 'https://native-oauth.test';
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ');

test(
  'real Better Auth completes one exchange despite navigation abort and duplicate callbacks',
  { timeout: 15_000 },
  async t => {
    const dir = mkdtempSync(join(tmpdir(), 'native-github-oauth-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'auth.sqlite');
    const Database = loadBetterSqlite3();
    const db = new Database(path);
    db.exec(
      readFileSync(
        new URL('../database/sqlite/migrations/001_better_auth.sql', import.meta.url),
        'utf8'
      )
    );
    db.close();
    const auth = createAuth({
      database: { type: 'sqlite', path },
      baseURL: base,
      github: { clientId: 'test-client', clientSecret: 'test-secret' }
    });
    const native = createNativeGitHubOAuth(auth, base, { log: () => {} });
    let tokenCalls = 0;
    let release!: () => void;
    let started!: () => void;
    const tokenStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    const tokenReleased = new Promise<void>(resolve => {
      release = resolve;
    });
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        tokenCalls++;
        started();
        await tokenReleased;
        return Response.json({
          access_token: 'test-provider-token',
          token_type: 'bearer',
          scope: 'read:user,user:email'
        });
      }
      if (url === 'https://api.github.com/user')
        return Response.json({
          id: 12345,
          login: 'native-test',
          email: 'native@example.test',
          name: 'Native Test',
          avatar_url: 'https://example.test/avatar'
        });
      if (url === 'https://api.github.com/user/emails')
        return Response.json([{ email: 'native@example.test', primary: true, verified: true }]);
      throw new Error(`Unexpected test fetch: ${new URL(url).origin}`);
    });
    const start = await native.handler(new Request(`${base}/api/auth/desktop/github`));
    assert.equal(start.status, 302);
    const browserCookies = cookies(start);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    assert.ok(state);
    const callback = `${base}/api/auth/callback/github?state=${state}&code=test-code`;
    const controller = new AbortController();
    const first = native.handler(
      new Request(callback, { headers: { Cookie: browserCookies }, signal: controller.signal })
    );
    await tokenStarted;
    controller.abort();
    const retry = native.handler(new Request(callback, { headers: { Cookie: browserCookies } }));
    release();
    const responses = await Promise.all([first, retry]);
    responses.push(
      await native.handler(new Request(callback, { headers: { Cookie: browserCookies } }))
    );
    assert.equal(tokenCalls, 1);
    for (const response of responses) {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), `${base}/api/auth/desktop/callback`);
      assert.ok(
        response.headers
          .getSetCookie()
          .some(value => value.startsWith('__Secure-better-auth.session_token='))
      );
      const session = await auth.api.getSession({
        headers: new Headers({ Cookie: cookies(response) })
      });
      assert.equal(session?.user.email, 'native@example.test');
    }
    // A missing native browser cookie cannot recover the session response.
    const foreign = await native.handler(
      new Request(callback, { headers: { Cookie: '__Secure-better-auth.state=wrong-browser' } })
    );
    assert.equal(
      foreign.headers.getSetCookie().some(value => value.includes('session_token=')),
      false
    );
    assert.equal(tokenCalls, 1);
    const deniedStart = await native.handler(new Request(`${base}/api/auth/desktop/github`));
    const deniedCookies = cookies(deniedStart);
    const deniedState = new URL(deniedStart.headers.get('location')!).searchParams.get('state');
    const denied = await native.handler(
      new Request(`${base}/api/auth/callback/github?state=${deniedState}&error=access_denied`, {
        headers: { Cookie: deniedCookies }
      })
    );
    assert.equal(
      denied.headers.get('location'),
      `${base}/api/auth/desktop/callback?error=access_denied`
    );
    const error = await native.handler(
      new Request(denied.headers.get('location')!, { headers: { Cookie: deniedCookies } })
    );
    assert.equal(error.headers.get('location'), 'overlord://auth/callback?error=access_denied');
  }
);
