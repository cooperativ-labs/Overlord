import assert from 'node:assert/strict';
import test from 'node:test';

import { createCompletionListenerFactory } from './local-target-completion-notify.ts';

function fakeClient({ connect = async () => undefined, listen = async () => undefined } = {}) {
  const listeners = new Map<string, (value: unknown) => void>();
  const queries: string[] = [];
  let ended = false;
  return {
    client: {
      connect,
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('LISTEN')) await listen();
      },
      end: async () => {
        ended = true;
      },
      on: (event: 'notification' | 'error', listener: (value: unknown) => void) => {
        listeners.set(event, listener);
      }
    },
    queries,
    emit: (event: 'notification' | 'error') => listeners.get(event)?.({}),
    get ended() {
      return ended;
    }
  };
}

test('completion listener wakes promptly on a Postgres notification and closes', async () => {
  const fake = fakeClient();
  const createListener = createCompletionListenerFactory({
    connectionString: 'postgres://example.invalid/overlord',
    createClient: async () => fake.client
  });
  assert.ok(createListener);
  const listener = await createListener({ requestId: 'request-1', timeoutMs: 1000 });
  assert.ok(listener);
  assert.deepEqual(fake.queries, ['LISTEN overlord_execution_request_completed']);

  const waiting = listener.wait();
  fake.emit('notification');
  await waiting;
  await listener.close();
  assert.equal(fake.ended, true);
});

test('completion listener returns null and closes the client when LISTEN fails', async () => {
  const fake = fakeClient({ listen: async () => Promise.reject(new Error('listen failed')) });
  const createListener = createCompletionListenerFactory({
    connectionString: 'postgres://example.invalid/overlord',
    createClient: async () => fake.client
  });
  assert.ok(createListener);
  assert.equal(await createListener({ requestId: 'request-1', timeoutMs: 1000 }), null);
  assert.equal(fake.ended, true);
});

test('completion listener bounds a hung handshake and closes after a late rejection', async () => {
  let rejectConnect: ((error: Error) => void) | undefined;
  const fake = fakeClient({
    connect: () =>
      new Promise<undefined>((_resolve, reject) => {
        rejectConnect = reject;
      })
  });
  const createListener = createCompletionListenerFactory({
    connectionString: 'postgres://example.invalid/overlord',
    connectTimeoutMs: 1,
    createClient: async () => fake.client
  });
  assert.ok(createListener);
  assert.equal(await createListener({ requestId: 'request-1', timeoutMs: 1000 }), null);
  assert.equal(fake.ended, true);
  assert.deepEqual(fake.queries, []);
  rejectConnect!(new Error('late connect failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('completion listener remembers notifications and errors received before waiting', async () => {
  for (const event of ['notification', 'error'] as const) {
    const fake = fakeClient();
    const createListener = createCompletionListenerFactory({
      connectionString: 'postgres://example.invalid/overlord',
      createClient: async () => fake.client
    });
    assert.ok(createListener);
    const listener = await createListener({ requestId: 'request-1', timeoutMs: 1000 });
    assert.ok(listener);
    fake.emit(event);
    await listener.wait();
    await listener.close();
    assert.equal(fake.ended, true);
  }
});

test('completion listener bounds the wait by maxWaitMs', async () => {
  const fake = fakeClient();
  const createListener = createCompletionListenerFactory({
    connectionString: 'postgres://example.invalid/overlord',
    maxWaitMs: 1,
    createClient: async () => fake.client
  });
  assert.ok(createListener);
  const listener = await createListener({ requestId: 'request-1', timeoutMs: 1000 });
  assert.ok(listener);
  await listener.wait();
  await listener.close();
  assert.equal(fake.ended, true);
});
