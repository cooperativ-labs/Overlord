import type {
  AccountConnectionDto,
  AccountConnectionListResponse,
  AccountConnectionProviderStatusDto
} from '@overlord/contract';
import { type Request, type RequestHandler, Router } from 'express';

import { ChatError, type ChatOwner } from '../../packages/core/service/chat/store.ts';
import { chatOwnerGate, chatRoute } from '../chat/router-support.ts';

import {
  CALLBACK_PATH,
  CLIENT_METADATA_PATH,
  MOBILE_RETURN_URL,
  WEB_RETURN_PATH
} from './config.ts';
import type { ConnectionsRuntime } from './index.ts';
import {
  type ProfileCallbackOutcome,
  profileConnectionProvider,
  type ProfileProvider
} from './profile.ts';
import type { CallbackOutcome } from './service.ts';

export interface ConnectionsRouterOptions {
  cloud: () => boolean;
  runtime: () => ConnectionsRuntime;
  /** The organization-scoped owner (profile plus active organization), for Knowledgebase. */
  owner: () => ChatOwner | null;
  /** The caller's profile, for profile-scoped providers (v153). Defaults to `owner().profileId`. */
  profile?: () => string | null | Promise<string | null>;
}

function knowledgebaseStatus(
  cloud: boolean,
  runtime: ConnectionsRuntime
): AccountConnectionProviderStatusDto {
  const reason = !cloud
    ? 'not_offered_on_edition'
    : !runtime.config.knowledgebase
      ? 'not_configured'
      : !runtime.config.encryption
        ? 'encryption_not_configured'
        : null;
  return {
    provider: 'knowledgebase',
    scope: 'organization',
    credentialKind: 'oauth',
    available: reason === null,
    reason
  };
}

/**
 * Authenticated `/api/connections` (contracts v152, v153). Mount after session
 * authentication. Organization-scoped (Knowledgebase) routes are Cloud-only;
 * `?scope=all`, `/api-keys`, and disconnecting a profile-scoped row are served
 * on both editions.
 */
export function createConnectionsRouter(options: ConnectionsRouterOptions): Router {
  const router = Router();
  const owner = chatOwnerGate(options);
  const profile = async (): Promise<string> => {
    const value = options.profile ? await options.profile() : (options.owner()?.profileId ?? null);
    if (!value) throw new ChatError('not_found');
    return value;
  };
  const listAll = async (): Promise<AccountConnectionListResponse> => {
    const runtime = options.runtime();
    const cloud = options.cloud();
    const items: AccountConnectionDto[] = [];
    const organizationOwner = cloud ? options.owner() : null;
    if (organizationOwner) items.push(...(await runtime.connections.list(organizationOwner)).items);
    items.push(...(await runtime.profiles.list(await profile())));
    return {
      items,
      providers: [knowledgebaseStatus(cloud, runtime), ...runtime.profiles.providers()]
    };
  };
  const route = (fn: (req: Request) => Promise<unknown>) =>
    chatRoute(fn, { failure: 'Connection request failed', noStore: true });
  router.get(
    '/',
    route(req =>
      // The default listing stays exactly v152 (organization-scoped, Cloud-only) for older clients.
      req.query.scope === 'all' ? listAll() : options.runtime().connections.list(owner())
    )
  );
  router.post(
    '/api-keys',
    route(async req => options.runtime().profiles.setApiKey(await profile(), req.body ?? null))
  );
  router.post(
    '/',
    route(async req => {
      // Profile-scoped OAuth providers (GitHub, v153) are served on both editions.
      if (profileConnectionProvider(req.body?.provider)?.oauth)
        return options.runtime().profiles.startOAuth(await profile(), req.body);
      return options.runtime().connections.start(owner(), req.body ?? null);
    })
  );
  router.delete(
    '/:id',
    route(async req => {
      const id = String(req.params.id);
      const runtime = options.runtime();
      const profileId = await profile();
      if (await runtime.profiles.row(profileId, id))
        return runtime.profiles.disconnect(profileId, id);
      return runtime.connections.disconnect(owner(), id);
    })
  );
  return router;
}

function completionPage(status: CallbackOutcome['status']): string {
  const text =
    status === 'connected'
      ? 'Knowledgebase is connected. You can return to Overlord.'
      : status === 'denied'
        ? 'Knowledgebase access was not granted. You can return to Overlord.'
        : status === 'expired'
          ? 'This sign-in link has expired or was already used. Start again from Overlord.'
          : 'Knowledgebase could not be connected. Start again from Overlord.';
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>Knowledgebase connection</title><p>${text}</p>`;
}

/**
 * Public routes: the OAuth callback and the Client ID Metadata Document. Mount
 * before session authentication. The callback's response carries only a status;
 * the code, verifier, and state never leave the backend.
 */
export function createConnectionsPublicRouter(
  options: Omit<ConnectionsRouterOptions, 'owner'>
): Router {
  const router = Router();
  router.get(CLIENT_METADATA_PATH, (_req, res) => {
    const document = options.cloud() ? options.runtime().clientMetadata() : null;
    if (!document) {
      res.status(404).json({ error: 'not found', code: 'not_found' });
      return;
    }
    res
      .set('Cache-Control', 'public, max-age=300')
      .type('application/json')
      .send(JSON.stringify(document));
  });
  router.get(CALLBACK_PATH, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    void (async (): Promise<CallbackOutcome> => {
      if (!options.cloud()) return { status: 'failed', returnTo: null };
      return options.runtime().connections.complete({
        code: req.query.code,
        state: req.query.state,
        error: req.query.error
      });
    })()
      .catch((): CallbackOutcome => ({ status: 'failed', returnTo: null }))
      .then(outcome => {
        const webOrigin = options.cloud() ? options.runtime().config.webReturnOrigin : null;
        const target =
          outcome.returnTo === 'mobile'
            ? new URL(MOBILE_RETURN_URL)
            : outcome.returnTo === 'web' && webOrigin
              ? new URL(WEB_RETURN_PATH, webOrigin)
              : null;
        if (target) {
          target.searchParams.set('provider', 'knowledgebase');
          target.searchParams.set('status', outcome.status);
          res.redirect(302, target.toString());
          return;
        }
        res
          .status(outcome.status === 'connected' ? 200 : 400)
          .type('html')
          .send(completionPage(outcome.status));
      });
  });
  return router;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

function profileCompletionPage(label: string, status: ProfileCallbackOutcome['status']): string {
  const name = escapeHtml(label);
  const text =
    status === 'connected'
      ? `${name} is connected. You can return to Overlord.`
      : status === 'denied'
        ? `${name} access was not granted. You can return to Overlord.`
        : status === 'expired'
          ? 'This sign-in link has expired or was already used. Start again from Overlord.'
          : `${name} could not be connected. Start again from Overlord.`;
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>${name} connection</title><p>${text}</p>`;
}

/** Where the browser goes after a profile-scoped callback, or null for the status page. */
export function profileCallbackTarget(
  provider: ProfileProvider,
  outcome: ProfileCallbackOutcome,
  webReturnOrigin: string | null
): URL | null {
  const returnUrl = outcome.returnUrl;
  if (returnUrl && !returnUrl.startsWith('/')) {
    // An absolute target a legacy alias validated when the sign-in started.
    try {
      const target = new URL(returnUrl);
      target.searchParams.set(`${provider}Connection`, outcome.status);
      return target;
    } catch {
      return null;
    }
  }
  const target =
    outcome.returnTo === 'mobile'
      ? new URL(MOBILE_RETURN_URL)
      : outcome.returnTo === 'web' && webReturnOrigin
        ? new URL(returnUrl ?? WEB_RETURN_PATH, webReturnOrigin)
        : null;
  if (!target) return null;
  target.searchParams.set('provider', provider);
  target.searchParams.set('status', outcome.status);
  return target;
}

/**
 * The public OAuth callback of a profile-scoped provider (contract v153). The REST
 * layer mounts it at the provider's registered path; GitHub's,
 * `/api/auth/callback/github/repository`, must be mounted before the Better Auth
 * `/api/auth/*` wildcard. The redirect carries only a status; the code, verifier,
 * and state never leave the backend. Served on both editions.
 */
export function createProfileConnectionCallbackHandler(options: {
  provider: ProfileProvider;
  runtime: () => ConnectionsRuntime;
}): RequestHandler {
  return (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const failed: ProfileCallbackOutcome = {
      status: 'failed',
      returnTo: null,
      returnUrl: null,
      connectionId: null,
      errorCode: null
    };
    void Promise.resolve()
      .then(() =>
        options.runtime().profiles.completeOAuth(options.provider, {
          code: req.query.code,
          state: req.query.state,
          error: req.query.error
        })
      )
      .catch(() => failed)
      .then(outcome => {
        let webOrigin: string | null = null;
        try {
          webOrigin = options.runtime().config.webReturnOrigin;
        } catch {
          webOrigin = null;
        }
        const target = profileCallbackTarget(options.provider, outcome, webOrigin);
        if (target) {
          res.redirect(302, target.toString());
          return;
        }
        const label = profileConnectionProvider(options.provider)?.label ?? options.provider;
        res
          .status(outcome.status === 'connected' ? 200 : 400)
          .type('html')
          .send(profileCompletionPage(label, outcome.status));
      });
  };
}
