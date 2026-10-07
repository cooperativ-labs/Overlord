import type { ChatProvidersResponse } from '@overlord/contract';
import { type Request, Router } from 'express';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ChatError,
  type ChatOwner,
  Conversations
} from '../packages/core/service/chat/conversations.ts';
import { ChatNotifications } from '../packages/core/service/chat/notifications.ts';

import { chatOwnerGate, chatRoute } from './chat/router-support.ts';

export interface ChatRouterOptions {
  cloud: () => boolean;
  service: () => Conversations;
  owner: () => ChatOwner | null;
  /** `GET /api/chat/providers`: engine readiness plus the caller's account connections. */
  providers?: (owner: ChatOwner) => Promise<ChatProvidersResponse>;
  streamPollMs?: number;
}
export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();
  const owner = chatOwnerGate(options);
  const observe = (req: Request, response: unknown) =>
    options
      .service()
      .observeHttp(owner(), req.method, req.path, { query: req.query, body: req.body }, response);
  const route = (fn: (req: Request) => Promise<unknown>) =>
    chatRoute(
      async req => {
        try {
          const response = await fn(req);
          await observe(req, { status: 200, body: response });
          return response;
        } catch (error) {
          await observe(req, {
            status: error instanceof ChatError ? error.status : 500,
            error
          }).catch(() => {});
          throw error;
        }
      },
      { failure: 'Chat request failed' }
    );
  const body = (req: Request) => {
    if (req.body === undefined) return {};
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      throw new ChatError('invalid_request');
    return req.body;
  };
  router.use((_req, _res, next) => {
    try {
      owner();
    } catch (error) {
      next(error);
      return;
    }
    next();
  });
  router.get(
    '/providers',
    route(async () => {
      if (!options.providers) throw new ChatError('provider_not_ready');
      return options.providers(owner());
    })
  );
  router.get(
    '/threads',
    route(req =>
      options
        .service()
        .list(
          owner(),
          req.query.archived === '1',
          typeof req.query.cursor === 'string' ? req.query.cursor : undefined
        )
    )
  );
  router.post(
    '/threads',
    route(req => options.service().create(owner(), body(req).message))
  );
  router.get(
    '/threads/:id',
    route(req =>
      options
        .service()
        .snapshot(
          owner(),
          req.params.id!,
          typeof req.query.before === 'string' ? req.query.before : undefined
        )
    )
  );
  router.get('/threads/:id/diagnostics', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    route(async () => {
      const value = req.query.after ?? '0';
      if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ChatError('invalid_request');
      return options.service().diagnostics(owner(), req.params.id!, Number(value));
    })(req, res, next);
  });
  router.patch(
    '/threads/:id',
    route(req => options.service().update(owner(), req.params.id!, body(req)))
  );
  router.post(
    '/threads/:id/messages',
    route(req => options.service().submit(owner(), req.params.id!, body(req)))
  );
  // Presence, acknowledgements, and history share the conversation service's database and limits.
  const notifications = () => {
    const service = options.service();
    return new ChatNotifications(service.db, service.options);
  };
  router.put(
    '/threads/:id/presence',
    route(req => notifications().presence(owner(), req.params.id!, body(req)))
  );
  router.post(
    '/threads/:id/ack',
    route(req => notifications().ack(owner(), req.params.id!, body(req)))
  );
  router.get(
    '/notifications',
    route(() => notifications().history(owner()))
  );
  router.post(
    '/notifications/:id/read',
    route(req => notifications().markRead(owner(), req.params.id!, body(req)))
  );
  router.post(
    '/proposals/:id/create',
    route(req => options.service().createProposal(owner(), req.params.id!, body(req)))
  );
  router.post(
    '/questions/:id/answer',
    route(req => options.service().answer(owner(), req.params.id!, body(req)))
  );
  router.post(
    '/runs/:id/cancel',
    route(req => options.service().cancel(owner(), req.params.id!, body(req).clientRequestId))
  );
  router.post(
    '/runs/:id/continue',
    route(req => options.service().continue(owner(), req.params.id!, body(req).clientRequestId))
  );
  router.get('/threads/:id/events', (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    void (async () => {
      const caller = owner(),
        service = options.service(),
        id = req.params.id!;
      if (typeof req.query.after !== 'string' || !/^\d+$/.test(req.query.after))
        throw new ChatError('invalid_request');
      let after = Number(req.query.after);
      let page = await service.events(caller, id, after);
      if (req.query.poll === '1') {
        await observe(req, { status: 200, body: page });
        res.json(page);
        return;
      }
      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      const write = async (frame: unknown) => {
        if (controller.signal.aborted) return;
        if (!res.write(`data: ${JSON.stringify(frame)}\n\n`)) {
          if (controller.signal.aborted) return;
          await new Promise<void>(resolve => {
            const done = () => {
              res.off('drain', done);
              controller.signal.removeEventListener('abort', done);
              resolve();
            };
            res.once('drain', done);
            controller.signal.addEventListener('abort', done, { once: true });
          });
        }
      };
      let heartbeatAt = Date.now();
      while (!controller.signal.aborted) {
        for (const event of page.events) {
          if (controller.signal.aborted) break;
          await write({ type: 'event', event });
          after = event.seq;
        }
        if (Date.now() - heartbeatAt > 15_000) {
          await write({ type: 'heartbeat', at: new Date().toISOString() });
          heartbeatAt = Date.now();
        }
        if (!page.hasMore)
          await delay(options.streamPollMs ?? 500, undefined, { signal: controller.signal });
        // Each iteration rechecks live owner membership and source access, including live publication.
        page = await service.events(caller, id, after);
      }
    })().catch(async error => {
      if (controller.signal.aborted) return;
      await observe(req, { error }).catch(() => {});
      if (!res.headersSent) {
        const e = error instanceof ChatError ? error : null;
        res
          .status(e?.status ?? 500)
          .json({ error: e?.message ?? 'Chat request failed', ...(e ? { code: e.code } : {}) });
      } else {
        if (error instanceof ChatError && error.code === 'snapshot_required') {
          const snapshot = await options
            .service()
            .snapshot(owner(), req.params.id!)
            .catch(() => null);
          res.write(
            `data: ${JSON.stringify({ type: 'snapshot_required', retainedFromSeq: snapshot?.retainedFromSeq ?? 1 })}\n\n`
          );
        }
        res.end();
      }
    });
  });
  return router;
}
