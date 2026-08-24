import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunnerQueueListener, longPollRunnerClaim } from './runner-queue-notify.ts';

function fakeClient() {
  const listeners = new Map<string, (value: unknown) => void>();
  const queries: string[] = [];
  let ended = false;
  return {
    client: {
      connect: async () => undefined,
      query: async (sql: string) => {
        queries.push(sql);
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

test('runner queue listener wakes promptly on a Postgres notification', async () => {
  const fake = fakeClient();
  const listener = await createRunnerQueueListener({
    connectionString: 'postgres://example.invalid/overlord',
    createClient: async () => fake.client,
    timeoutMs: 1000
  });
  assert.ok(listener);
  assert.deepEqual(fake.queries, ['LISTEN overlord_execution_request_queue']);

  const waiting = listener.wait();
  fake.emit('notification');
  await waiting;
  await listener.close();
  assert.equal(fake.ended, true);
});

test('runner queue listener wakes on timeout so the runner can reconnect', async () => {
  const fake = fakeClient();
  const listener = await createRunnerQueueListener({
    connectionString: 'postgres://example.invalid/overlord',
    createClient: async () => fake.client,
    timeoutMs: 1
  });
  assert.ok(listener);
  await listener.wait();
  await listener.close();
  assert.equal(fake.ended, true);
});

test('LISTEN connect timeout returns null so claim can fall back', async () => {
  let ended = false;
  let rejectConnect: ((error: Error) => void) | undefined;
  const started = Date.now();
  const listener = await createRunnerQueueListener({
    connectionString: 'postgres://example.invalid/overlord',
    connectTimeoutMs: 30,
    createClient: async () => ({
      connect: () =>
        new Promise((_resolve, reject) => {
          rejectConnect = reject;
        }),
      query: async () => undefined,
      end: async () => {
        ended = true;
        rejectConnect?.(new Error('ended'));
      },
      on() {}
    })
  });
  assert.equal(listener, null);
  assert.equal(ended, true);
  assert.ok(Date.now() - started < 1000);
});

test('LISTEN connect timeout yields longPoll false so the runner uses jittered fallback', async () => {
  const result = await longPollRunnerClaim({
    claimNow: async () => null,
    createListener: async () =>
      createRunnerQueueListener({
        connectionString: 'postgres://example.invalid/overlord',
        connectTimeoutMs: 20,
        createClient: async () => ({
          connect: () => new Promise(() => {}),
          query: async () => undefined,
          end: async () => undefined,
          on() {}
        })
      })
  });
  assert.deepEqual(result, { request: null, longPoll: false });
});

test('notification still claims promptly after LISTEN is armed', async () => {
  const fake = fakeClient();
  let claims = 0;
  let armed = false;
  const result = await longPollRunnerClaim({
    claimNow: async () => {
      claims += 1;
      return claims >= 2 ? { id: 'req-1' } : null;
    },
    createListener: async () =>
      createRunnerQueueListener({
        connectionString: 'postgres://example.invalid/overlord',
        createClient: async () => fake.client,
        timeoutMs: 1000
      }),
    onListenArmed: () => {
      armed = true;
      fake.emit('notification');
    }
  });
  assert.equal(armed, true);
  assert.deepEqual(result, { request: { id: 'req-1' }, longPoll: true });
  assert.equal(fake.ended, true);
});
