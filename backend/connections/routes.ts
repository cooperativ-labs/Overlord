import { type Request, type Response, Router } from 'express';

import { ChatError, type ChatOwner } from '../../packages/core/service/chat/store.ts';

import {
  CALLBACK_PATH,
  CLIENT_METADATA_PATH,
  MOBILE_RETURN_URL,
  WEB_RETURN_PATH
} from './config.ts';
import type { ConnectionsRuntime } from './index.ts';
import type { CallbackOutcome } from './service.ts';

export interface ConnectionsRouterOptions {
  cloud: () => boolean;
  runtime: () => ConnectionsRuntime;
  owner: () => ChatOwner | null;
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ChatError)
    res.status(error.status).json({ error: error.message, code: error.code });
  else res.status(500).json({ error: 'Connection request failed' });
}

/** Authenticated `/api/connections` (contract v152). Mount after session authentication. */
export function createConnectionsRouter(options: ConnectionsRouterOptions): Router {
  const router = Router();
  const owner = (): ChatOwner => {
    if (!options.cloud()) throw new ChatError('chat_unavailable');
    const value = options.owner();
    if (!value) throw new ChatError('not_found');
    return value;
  };
  const route = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    void Promise.resolve()
      .then(() => fn(req))
      .then(value => res.json(value))
      .catch(error => sendError(res, error));
  };
  router.get(
    '/',
    route(() => options.runtime().connections.list(owner()))
  );
  router.post(
    '/',
    route(req => options.runtime().connections.start(owner(), req.body ?? null))
  );
  router.delete(
    '/:id',
    route(req => options.runtime().connections.disconnect(owner(), String(req.params.id)))
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
