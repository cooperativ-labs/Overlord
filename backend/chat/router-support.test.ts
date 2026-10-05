import express, { type NextFunction, type Request, type Response } from 'express';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';

import { ChatError } from '../../packages/core/service/chat/store.ts';
import { ServiceError } from '../../packages/core/service/errors.ts';
import { ApiError, apiErrorHandler } from '../errors.ts';

import { chatOwnerGate, chatRoute } from './router-support.ts';

/** Runs one request through `handler` and resolves with what reached `next()`, if anything. */
async function invoke(handler: ReturnType<typeof chatRoute>, req = {} as Request) {
  const headers: Record<string, string> = {};
  let body: unknown;
  const res = {
    set: (name: string, value: string) => {
      headers[name] = value;
      return res;
    },
    json: (value: unknown) => {
      body = value;
      return res;
    }
  } as unknown as Response;
  const forwarded = await new Promise<unknown>(resolve => {
    handler(req, res, resolve as NextFunction);
    setImmediate(() => resolve(undefined));
  });
  return { forwarded, body, headers };
}

it('chatRoute forwards a ChatError to next() unchanged and sends no body', async () => {
  const error = new ChatError('stale_revision');
  const result = await invoke(
    chatRoute(
      async () => {
        throw error;
      },
      { failure: 'Chat request failed' }
    )
  );
  assert.equal(result.forwarded, error);
  assert.equal(result.body, undefined);
});

it('chatRoute forwards other ServiceErrors and ApiErrors unchanged, including synchronous throws', async () => {
  const service = new ServiceError('nope', 'forbidden', 403);
  const api = new ApiError(401, 'Authentication required');
  for (const error of [service, api]) {
    const result = await invoke(
      chatRoute(
        () => {
          throw error;
        },
        { failure: 'Chat request failed' }
      )
    );
    assert.equal(result.forwarded, error);
  }
});

it('chatRoute replaces an unexpected failure with a generic 500 so its message never reaches the body', async () => {
  const result = await invoke(
    chatRoute(
      async () => {
        throw new Error('upstream said secret-token-123');
      },
      { failure: 'Connection request failed' }
    )
  );
  assert.ok(result.forwarded instanceof ApiError);
  assert.equal(result.forwarded.status, 500);
  assert.equal(result.forwarded.message, 'Connection request failed');
});

it('chatRoute sends the resolved value as JSON and sets no-store only when asked', async () => {
  const plain = await invoke(chatRoute(async () => ({ ok: 1 }), { failure: 'x' }));
  assert.deepEqual(plain.body, { ok: 1 });
  assert.equal(plain.forwarded, undefined);
  assert.equal(plain.headers['Cache-Control'], undefined);
  const noStore = await invoke(chatRoute(async () => ({}), { failure: 'x', noStore: true }));
  assert.equal(noStore.headers['Cache-Control'], 'no-store');
});

it('chatOwnerGate rejects off Cloud and without an owner', () => {
  const owner = { profileId: 'p', organizationId: 'o' };
  let cloud = false;
  let current: typeof owner | null = owner;
  const gate = chatOwnerGate({ cloud: () => cloud, owner: () => current });
  assert.throws(gate, (e: unknown) => e instanceof ChatError && e.code === 'chat_unavailable');
  cloud = true;
  assert.equal(gate(), owner);
  current = null;
  assert.throws(gate, (e: unknown) => e instanceof ChatError && e.code === 'not_found');
});

it('the app error handler renders chatRoute failures as { error, code } and a bare generic 500', async () => {
  const app = express();
  app.get(
    '/chat',
    chatRoute(
      async () => {
        throw new ChatError('limit_exceeded', 'internal detail');
      },
      { failure: 'Chat request failed' }
    )
  );
  app.get(
    '/boom',
    chatRoute(
      async () => {
        throw new Error('secret');
      },
      { failure: 'Chat request failed' }
    )
  );
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const chat = await fetch(`${base}/chat`);
    assert.equal(chat.status, 429);
    assert.deepEqual(await chat.json(), { error: 'limit exceeded', code: 'limit_exceeded' });
    const boom = await fetch(`${base}/boom`);
    assert.equal(boom.status, 500);
    assert.deepEqual(await boom.json(), { error: 'Chat request failed' });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
