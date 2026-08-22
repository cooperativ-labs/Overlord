import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { createPostgresClient } from './client.js';

class FakePgPool extends EventEmitter {
  endCalls = 0;

  async query(): Promise<{ rows: never[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<never> {
    throw new Error('not used by this test');
  }

  async end(): Promise<void> {
    this.endCalls++;
  }
}

test('an idle Postgres pool error is logged without becoming an uncaught process error', async () => {
  const pool = new FakePgPool();
  const client = createPostgresClient(
    pool as unknown as Parameters<typeof createPostgresClient>[0],
    { ownsPool: true }
  );
  const originalConsoleError = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => messages.push(args.map(String).join(' '));

  try {
    assert.equal(pool.listenerCount('error'), 1);
    assert.doesNotThrow(() => {
      pool.emit(
        'error',
        Object.assign(new Error('Connection terminated unexpectedly'), {
          client: { connectionParameters: { password: 'must-not-be-logged' } }
        })
      );
    });
    assert.deepEqual(messages, [
      '[database] PostgreSQL idle connection failed; the pool discarded it and will reconnect on demand: Connection terminated unexpectedly'
    ]);
    assert.doesNotMatch(messages[0]!, /must-not-be-logged/);
  } finally {
    console.error = originalConsoleError;
    await client.close();
  }

  assert.equal(pool.listenerCount('error'), 0);
  assert.equal(pool.endCalls, 1);
});
