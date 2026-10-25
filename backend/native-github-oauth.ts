import { createHash, randomBytes } from 'node:crypto';

import { beginDesktopGitHubOAuth, type DesktopOAuthAuthHandler } from './desktop-oauth-handoff.ts';

const FLOW_TTL_MS = 10 * 60_000;
const RECOVERY_TTL_MS = 60_000;
const MAX_FLOWS = 256;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function cookieValue(request: Request, name: string): string | undefined {
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  // Ambiguous cookies must never authorize a recovered response.
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}

export function nativeOAuthErrorCode(value: string | null): string {
  switch (value) {
    case 'access_denied':
      return 'access_denied';
    case 'state_mismatch':
    case 'state_not_found':
    case 'state_invalid':
      return 'state_mismatch';
    default:
      return 'sign_in_failed';
  }
}

interface Flow {
  expiresAt: number;
  stateHash: string;
  stateCookieName?: string;
  stateCookieHash?: string;
  callbackHash?: string;
  response?: Promise<Response>;
  recoveryExpiresAt?: number;
}

/**
 * Browser-bound recovery for native GitHub navigation retries. Better Auth still
 * validates the first callback. Only an identical callback with BOTH original
 * cookies can share its in-flight/completed response, for at most 60 seconds.
 * No raw state, code, cookie, or token is written to logs or used as a map key.
 * Process-local by design, like the existing native one-time ticket store.
 */
export function createNativeGitHubOAuth(
  auth: DesktopOAuthAuthHandler,
  baseUrl: string,
  options: {
    now?: () => number;
    log?: (event: string, correlation: string, durationMs?: number) => void;
  } = {}
): DesktopOAuthAuthHandler {
  const now = options.now ?? Date.now;
  const log =
    options.log ??
    ((event, correlation, durationMs) =>
      // eslint-disable-next-line no-console -- Bounded OAuth lifecycle diagnostics without credentials.
      console.info('[native-github-oauth]', { event, correlation, durationMs }));
  const secure = new URL(baseUrl).protocol === 'https:';
  const cookieName = `${secure ? '__Secure-' : ''}overlord.native_oauth`;
  const flows = new Map<string, Flow>();
  const prune = () => {
    for (const [key, flow] of flows) {
      if (flow.expiresAt <= now()) flows.delete(key);
      else if (flow.recoveryExpiresAt !== undefined && flow.recoveryExpiresAt <= now()) {
        flow.response = undefined;
        // Keep callbackHash: once started, an expired recovery must never start
        // another provider exchange through this wrapper.
      }
    }
  };
  const errorResponse = (request: Request, error: string | null) => {
    const marker = cookieValue(request, cookieName);
    const flow = marker ? flows.get(digest(marker)) : undefined;
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (flow) {
      headers.set('Location', `overlord://auth/callback?error=${nativeOAuthErrorCode(error)}`);
      headers.append(
        'Set-Cookie',
        `${cookieName}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
      );
      return new Response(null, { status: 302, headers });
    }
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(
      'GitHub sign-in could not be completed. Return to Overlord and start sign-in again.',
      { status: 400, headers }
    );
  };

  return {
    async handler(request) {
      prune();
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/auth/desktop/github') {
        if (flows.size >= MAX_FLOWS) {
          return new Response('Too many sign-ins are open. Wait a few minutes and try again.', {
            status: 503,
            headers: { 'Cache-Control': 'no-store' }
          });
        }
        const response = await beginDesktopGitHubOAuth(auth, baseUrl);
        if (!response.ok) return response;
        const payload = (await response.json()) as { url?: unknown };
        if (typeof payload.url !== 'string') throw new Error('Missing GitHub authorization URL');
        const state = new URL(payload.url).searchParams.get('state');
        if (!state) throw new Error('Missing GitHub OAuth state');
        const marker = randomBytes(32).toString('base64url');
        const stateCookie = response.headers
          .getSetCookie()
          .map(value => /^((?:__Secure-)?better-auth\.state)=([^;]+)/.exec(value))
          .find(Boolean);
        const flow: Flow = {
          expiresAt: now() + FLOW_TTL_MS,
          stateHash: digest(state),
          stateCookieName: stateCookie?.[1],
          stateCookieHash: stateCookie ? digest(stateCookie[2]) : undefined
        };
        if (flows.size >= MAX_FLOWS)
          return new Response('Too many sign-ins are open. Try again shortly.', {
            status: 503,
            headers: { 'Cache-Control': 'no-store' }
          });
        flows.set(digest(marker), flow);
        const headers = new Headers({
          Location: payload.url,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer'
        });
        for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
        headers.append(
          'Set-Cookie',
          `${cookieName}=${marker}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`
        );
        log('started', flow.stateHash.slice(0, 12));
        return new Response(null, { status: 302, headers });
      }
      if (
        request.method === 'GET' &&
        (url.pathname === '/api/auth/error' ||
          (url.pathname === '/api/auth/desktop/callback' && url.searchParams.has('error')))
      ) {
        return errorResponse(request, url.searchParams.get('error'));
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/callback/github') {
        const marker = cookieValue(request, cookieName);
        const flow = marker ? flows.get(digest(marker)) : undefined;
        const state = url.searchParams.get('state');
        const stateCookie = flow?.stateCookieName
          ? cookieValue(request, flow.stateCookieName)
          : undefined;
        if (
          flow &&
          state &&
          digest(state) === flow.stateHash &&
          stateCookie &&
          digest(stateCookie) === flow.stateCookieHash
        ) {
          // Include every parameter, including the code/error, and bind to the
          // original cookie. A changed callback can never receive cached auth.
          const callbackHash = digest(url.search);
          if (flow.callbackHash !== undefined && flow.callbackHash !== callbackHash)
            return errorResponse(request, 'state_mismatch');
          if (flow.callbackHash !== undefined && !flow.response)
            return errorResponse(request, 'state_mismatch');
          if (flow.response) {
            log('callback_recovered', flow.stateHash.slice(0, 12));
          } else {
            flow.callbackHash = callbackHash;
            flow.recoveryExpiresAt = now() + RECOVERY_TTL_MS;
            const startedAt = now();
            const navigationAborted = () =>
              log('navigation_aborted', flow.stateHash.slice(0, 12), now() - startedAt);
            request.signal.addEventListener('abort', navigationAborted, { once: true });
            log('callback_started', flow.stateHash.slice(0, 12));
            // A disconnected Safari navigation must not abort the shared exchange.
            flow.response = auth
              .handler(new Request(request, { signal: new AbortController().signal }))
              .then(response => {
                log('callback_completed', flow.stateHash.slice(0, 12), now() - startedAt);
                const headers = new Headers(response.headers);
                headers.set('Cache-Control', 'no-store');
                headers.set('Referrer-Policy', 'no-referrer');
                return new Response(response.body, {
                  status: response.status,
                  statusText: response.statusText,
                  headers
                });
              })
              .catch(() => {
                log('callback_failed', flow.stateHash.slice(0, 12), now() - startedAt);
                return errorResponse(request, 'sign_in_failed');
              })
              .finally(() => request.signal.removeEventListener('abort', navigationAborted));
          }
          return (await flow.response).clone();
        }
      }
      return auth.handler(request);
    }
  };
}
