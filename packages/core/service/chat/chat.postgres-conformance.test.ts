import {
  createPostgresClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { type ChatOwner, Conversations } from './conversations.js';
import { ChatRuns, StaleChatAttempt } from './runs.js';
import type { ChatOptions } from './store.js';

const identity = {
  provider: 'fake',
  model: 'fake-1',
  configDigest: 'config-1',
  checkpointVersion: 1
};
const owner: ChatOwner = { profileId: 'owner', organizationId: 'org' };
const adapters = ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])];
async function fixture(
  adapter: string,
  fn: (
    db: DatabaseClient,
    c: Conversations,
    runs: ChatRuns,
    advance: (ms: number) => void
  ) => Promise<void>,
  options: ChatOptions = {}
) {
  let db: DatabaseClient, cleanup: () => Promise<void>;
  if (adapter === 'sqlite') {
    const raw = openInMemoryDatabase();
    db = createSqliteClient(raw);
    cleanup = async () => {
      raw.close();
    };
  } else {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const session = await pool.connect(),
      schema = `chat_service_${randomUUID().replaceAll('-', '')}`;
    await session.query(`CREATE SCHEMA ${schema}`);
    await session.query(`SET search_path TO ${schema}`);
    const scoped = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 5
    });
    db = createPostgresClient(scoped, { ownsPool: true });
    await migratePostgres(db);
    cleanup = async () => {
      await db.close();
      await session.query(`DROP SCHEMA ${schema} CASCADE`);
      session.release();
      await pool.end();
    };
  }
  try {
    let now = Date.parse('2026-10-04T12:00:00.000Z');
    const config = { ...options, now: () => now };
    const stamp = new Date(now).toISOString();
    await db.run(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('owner', 'Owner', 'owner@test.invalid', ${db.dialect === 'sqlite' ? '0' : 'FALSE'}, ?, ?)`,
      [stamp, stamp]
    );
    await db.run(
      "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)",
      [stamp, stamp]
    );
    await db.run(
      "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', ?, ?)",
      [stamp, stamp]
    );
    await db.run(
      "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES ('member', 'ws', 'owner', 'owner', 'active', ?, ?)",
      [stamp, stamp]
    );
    await fn(db, new Conversations(db, config), new ChatRuns(db, config), ms => {
      now += ms;
    });
  } finally {
    await cleanup();
  }
}
async function started(c: Conversations, runs: ChatRuns) {
  const created = await c.create(owner, {
    clientRequestId: randomUUID(),
    text: 'Research my feature'
  });
  const a = await runs.claim('worker-1', identity);
  assert.ok(a);
  assert.equal(a.runId, created.run!.id);
  return { created, a };
}
const rejectsCode = (code: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === code);
for (const adapter of adapters)
  describe(`durable conversations [${adapter}]`, () => {
    it('atomic first message, concurrent duplicate submissions, active rejection and privacy', () =>
      fixture(adapter, async (db, c) => {
        const t = await c.create(owner);
        const body = { clientRequestId: 'one', text: 'Feature' };
        const [first, second] = await Promise.all([
          c.submit(owner, t.thread.id, body),
          c.submit(owner, t.thread.id, body)
        ]);
        assert.equal(first.message.id, second.message.id);
        assert.equal(first.run.id, second.run.id);
        assert.equal(Number(first.replayed) + Number(second.replayed), 1);
        await assert.rejects(
          c.submit(owner, t.thread.id, { clientRequestId: 'two', text: 'Another' }),
          rejectsCode('run_in_progress')
        );
        for (const foreign of [
          { ...owner, profileId: 'other' },
          { ...owner, organizationId: 'other' }
        ]) {
          await assert.rejects(c.snapshot(foreign, t.thread.id), rejectsCode('not_found'));
          await assert.rejects(c.cancel(foreign, first.run.id, 'cancel'), rejectsCode('not_found'));
        }
        const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_messages');
        assert.equal(Number(count!.n), 1);
        await assert.rejects(
          c.create(owner, { clientRequestId: 'bad', text: '' }),
          rejectsCode('invalid_request')
        );
        const threads = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_threads');
        assert.equal(Number(threads!.n), 1);
      }));
    it('rename/archive revision checks and newest-first owner list', () =>
      fixture(adapter, async (_db, c, _runs, advance) => {
        const t = await c.create(owner);
        advance(1);
        const newer = await c.create(owner);
        assert.equal((await c.list(owner)).items[0]!.id, newer.thread.id);
        const updated = await c.update(owner, t.thread.id, {
          expectedRevision: 1,
          title: 'Renamed',
          archived: true
        });
        assert.equal(updated.title, 'Renamed');
        await assert.rejects(
          c.update(owner, t.thread.id, { expectedRevision: 1, title: 'Lost update' }),
          rejectsCode('stale_revision')
        );
        assert.equal((await c.list(owner)).items.length, 1);
        assert.equal((await c.list(owner, true)).items.length, 2);
      }));
    it('snapshot/live handoff, replay ordering and retention gaps', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { created, a } = await started(c, runs);
        const snapshot = await c.snapshot(owner, created.thread.id);
        const id = await runs.text(a, 'first');
        await runs.text(a, ' second', null, id);
        await runs.complete(a);
        const events = await c.events(owner, created.thread.id, snapshot.eventCursor);
        assert.ok(events.events.length >= 4);
        assert.deepEqual(
          events.events.map(e => e.seq),
          events.events.map((_, i) => snapshot.eventCursor + i + 1)
        );
        const resumed = await c.events(owner, created.thread.id, events.cursor);
        assert.equal(resumed.events.length, 0);
        const bounded = new Conversations(c.db, {
          ...c.options,
          limits: { eventRetentionCount: 2 }
        });
        await assert.rejects(
          bounded.events(owner, created.thread.id, 0),
          rejectsCode('snapshot_required')
        );
        const fresh = await c.snapshot(owner, created.thread.id);
        assert.ok(fresh.retainedFromSeq > 1);
      }));
    it('simultaneous snapshot and worker publication never misses events', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { created, a } = await started(c, runs);
        const [snap] = await Promise.all([
          c.snapshot(owner, created.thread.id),
          runs.text(a, 'Race')
        ]);
        const page = await c.events(owner, created.thread.id, snap.eventCursor);
        const inSnapshot = snap.messages.some(m => m.role === 'assistant');
        assert.equal(
          Number(inSnapshot) +
            Number(
              page.events.some(e => e.kind === 'message.created' && e.message.role === 'assistant')
            ),
          1
        );
      }));
    it('question card race, message-as-answer and released lease', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { created, a } = await started(c, runs);
        const q = await runs.question(a, 'Which project?', [{ id: 'one', label: 'One' }], false);
        await assert.rejects(runs.text(a, 'stale'), StaleChatAttempt);
        const [left, right] = await Promise.allSettled([
          c.answer(owner, q.id, { clientRequestId: 'left', expectedRevision: 1, optionId: 'one' }),
          c.answer(owner, q.id, { clientRequestId: 'right', expectedRevision: 1, optionId: 'one' })
        ]);
        assert.equal([left, right].filter(r => r.status === 'fulfilled').length, 1);
        assert.equal((await c.snapshot(owner, created.thread.id)).activeRun!.id, a.runId);
        const next = await runs.claim('worker-2', identity);
        assert.ok(next);
        const q2 = await runs.question(next, 'More?');
        const answer = await c.submit(owner, created.thread.id, {
          clientRequestId: 'free',
          text: 'Yes'
        });
        assert.equal(answer.message.answersQuestionId, q2.id);
        assert.equal(answer.run.id, a.runId);
        const replay = await c.submit(owner, created.thread.id, {
          clientRequestId: 'free',
          text: 'Yes'
        });
        assert.equal(replay.replayed, true);
      }));
    it('cancel is idempotent and fences events, tools and checkpoints', () =>
      fixture(adapter, async (db, c, runs) => {
        const { created, a } = await started(c, runs);
        await runs.requestTools(
          a,
          0,
          [
            {
              operationId: 'read-1',
              providerCallId: 'call-1',
              toolId: 'read',
              arguments: {},
              order: 0
            }
          ],
          { phase: 'tool_requested', payload: { opaque: 'private' }, dependencySetId: null }
        );
        const result = await c.cancel(owner, a.runId, 'cancel');
        assert.equal(result.state, 'cancelled');
        assert.equal((await c.cancel(owner, a.runId, 'cancel')).state, 'cancelled');
        await assert.rejects(runs.text(a, 'late'), StaleChatAttempt);
        await assert.rejects(runs.toolResult(a, 'read-1', 'late'), StaleChatAttempt);
        assert.equal(
          (await db.get<{ state: string }>(
            "SELECT state FROM chat_tool_calls WHERE operation_id = 'read-1'"
          ))!.state,
          'cancelled'
        );
        const snap = await c.snapshot(owner, created.thread.id);
        assert.equal(snap.activeRun, null);
      }));
    it('restart at request and result boundaries preserves opaque state, operation IDs and ordered calls', () =>
      fixture(adapter, async (_db, c, runs, advance) => {
        const { created, a } = await started(c, runs);
        const requests = [0, 1].map(i => ({
          operationId: `operation-${i}`,
          providerCallId: `call-${i}`,
          toolId: 'read',
          arguments: { i },
          order: i
        }));
        const checkpoint = {
          phase: 'tool_requested' as const,
          payload: { responseParts: [{ thoughtSignature: 'opaque-private' }] },
          dependencySetId: null
        };
        await runs.requestTools(a, 0, requests, checkpoint);
        advance(30_001);
        const resumed = await runs.claim('worker-2', identity);
        assert.ok(resumed);
        assert.equal(resumed.recoveryMode, 'checkpoint');
        await assert.rejects(runs.text(a, 'old'), StaleChatAttempt);
        await assert.rejects(runs.providerInput(resumed), rejectsCode('invalid_request'));
        const input = await runs.input(resumed);
        assert.deepEqual(input.checkpoint!.payload, checkpoint.payload);
        assert.deepEqual(
          input.receipts.map(r => r.operationId),
          requests.map(r => r.operationId)
        );
        await runs.toolResult(resumed, 'operation-1', { second: true });
        await assert.rejects(
          runs.joinTools(resumed, 0, { ...checkpoint, phase: 'tool_results_joined' }, [
            'call-0',
            'call-1'
          ]),
          rejectsCode('invalid_request')
        );
        await runs.executeTool(resumed, 'operation-0', async receipt => {
          assert.equal(receipt.operationId, 'operation-0');
          return { first: true };
        });
        advance(30_001);
        const again = await runs.claim('worker-3', identity);
        assert.ok(again);
        await runs.executeTool(again, 'operation-0', async () => {
          throw new Error('completed reads must not execute again');
        });
        await assert.rejects(
          runs.joinTools(again, 0, { ...checkpoint, phase: 'tool_results_joined' }, [
            'call-1',
            'call-0'
          ]),
          rejectsCode('invalid_request')
        );
        await runs.joinTools(
          again,
          0,
          { ...checkpoint, phase: 'tool_results_joined', payload: { joined: true } },
          ['call-0', 'call-1']
        );
        assert.equal((await runs.input(again)).checkpoint!.phase, 'tool_results_joined');
        assert.equal((await runs.providerInput(again)).receipts.length, 2);
        await runs.requestTools(
          again,
          1,
          [
            {
              operationId: 'sequential',
              providerCallId: 'call-next',
              toolId: 'read',
              arguments: {},
              order: 0
            }
          ],
          { ...checkpoint, payload: { nextTurn: true } }
        );
        await assert.rejects(runs.complete(again), rejectsCode('invalid_request'));
        await runs.executeTool(again, 'sequential', async () => ({ nextResult: true }));
        await runs.joinTools(
          again,
          1,
          { ...checkpoint, phase: 'tool_results_joined', payload: { nextJoined: true } },
          ['call-next']
        );
        assert.deepEqual(
          (await runs.providerInput(again)).receipts.map(c => c.turnIndex),
          [0, 0, 1]
        );

        const snapshot = await c.snapshot(owner, created.thread.id);
        assert.ok(!JSON.stringify(snapshot).includes('opaque-private'));
        assert.ok(
          !JSON.stringify(await c.events(owner, created.thread.id, 0)).includes('opaque-private')
        );
      }));
    it('incompatible checkpoint recovers fresh and marks partial text interrupted', () =>
      fixture(adapter, async (_db, c, runs, advance) => {
        const { created, a } = await started(c, runs);
        await runs.text(a, 'Partial');
        await runs.requestTools(
          a,
          0,
          [{ operationId: 'op', providerCallId: 'call', toolId: 'read', arguments: {}, order: 0 }],
          { phase: 'tool_requested', payload: 'private', dependencySetId: null }
        );
        advance(30_001);
        const next = await runs.claim('new', { ...identity, configDigest: 'changed' });
        assert.ok(next);
        assert.equal(next.recoveryMode, 'fresh_generation');
        assert.equal((await runs.input(next)).checkpoint, null);
        assert.equal(
          (await c.snapshot(owner, created.thread.id)).messages.find(m => m.role === 'assistant')!
            .state,
          'interrupted'
        );
      }));
    it('lease expiry without a new claim still rejects worker writes', () =>
      fixture(adapter, async (_db, c, runs, advance) => {
        const { a } = await started(c, runs);
        advance(30_000);
        await assert.rejects(runs.text(a, 'expired'), StaleChatAttempt);
        await assert.rejects(runs.heartbeat(a), StaleChatAttempt);
      }));
    it('tool allowance and concurrent Continue retries produce one fresh run', () =>
      fixture(adapter, async (_db, c, runs, advance) => {
        const { a, created } = await started(c, runs);
        advance(1);
        await runs.complete(a, 'allowance_exhausted');
        const [one, two] = await Promise.all([
          c.continue(owner, a.runId, 'continue'),
          c.continue(owner, a.runId, 'continue')
        ]);
        assert.equal(one.run.id, two.run.id);
        assert.equal(one.run.usage.toolCalls, 0);
        const next = await runs.claim('new', identity);
        assert.ok(next);
        const short = new ChatRuns(runs.db, { ...runs.options, limits: { toolCallsPerRun: 0 } });
        // The stored per-run allowance is authoritative, not a changed worker default.
        await short.complete(next, 'answered');
        await assert.rejects(
          c.continue(owner, next.runId, 'no'),
          rejectsCode('continue_not_available')
        );
        assert.equal(
          (await c.snapshot(owner, created.thread.id)).latestRun!.continueAvailable,
          false
        );
      }));
    it('tool and active-time limits end cleanly with Continue available', () =>
      fixture(
        adapter,
        async (_db, c, runs, advance) => {
          const { a } = await started(c, runs);
          const request = {
            operationId: 'one',
            providerCallId: 'one',
            toolId: 'read',
            arguments: {},
            order: 0
          };
          assert.equal(
            await runs.requestTools(a, 0, [request], {
              phase: 'tool_requested',
              payload: {},
              dependencySetId: null
            }),
            false
          );
          assert.equal(
            (await c.snapshot(owner, a.threadId)).latestRun!.outcome,
            'allowance_exhausted'
          );
          advance(1);
          const next = await c.continue(owner, a.runId, 'continue');
          const b = await runs.claim('worker', identity);
          assert.ok(b);
          advance(11);
          assert.equal(await runs.heartbeat(b), false);
          assert.equal((await runs.run(next.run.id)).outcome, 'allowance_exhausted');
        },
        { limits: { toolCallsPerRun: 0, activeProcessingMsPerRun: 10 } }
      ));
    it('owner concurrent-run allowance serializes across threads', () =>
      fixture(
        adapter,
        async (_db, c) => {
          const [one, two] = await Promise.allSettled([
            c.create(owner, { clientRequestId: 'one', text: 'one' }),
            c.create(owner, { clientRequestId: 'two', text: 'two' })
          ]);
          assert.equal([one, two].filter(r => r.status === 'fulfilled').length, 1);
        },
        { limits: { concurrentRunsPerOwner: 1 } }
      ));
    it('revocation invalidates inherited content and replay and fences the live worker', async () => {
      let authorized = true;
      await fixture(
        adapter,
        async (db, c, runs) => {
          const { a, created } = await started(c, runs);
          const deps = await c.sources(owner, a.threadId, [
            {
              scopeKey: 'project:p',
              locator: { kind: 'overlord', entityType: 'project', entityId: 'p', projectId: 'p' }
            }
          ]);
          const messageId = await runs.text(a, 'private-source-answer', deps);
          await runs.requestTools(
            a,
            0,
            [
              { operationId: 'op', providerCallId: 'call', toolId: 'read', arguments: {}, order: 0 }
            ],
            { phase: 'tool_requested', payload: 'signature-private', dependencySetId: deps }
          );
          authorized = false;
          await assert.rejects(runs.text(a, 'late'), StaleChatAttempt);
          const snapshot = await c.snapshot(owner, created.thread.id);
          assert.equal(
            snapshot.messages.find(m => m.id === messageId)!.blocks[0]!.kind,
            'unavailable'
          );
          assert.equal(snapshot.latestRun!.failureCode, 'source_access_lost');
          const events = await c.events(owner, created.thread.id, 0);
          assert.ok(!JSON.stringify(events).includes('private-source-answer'));
          assert.ok(events.events.some(e => e.kind === 'content.invalidated'));
          assert.equal(
            Number(
              (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_provider_checkpoints'))!
                .n
            ),
            0
          );
        },
        { checkSource: async () => (authorized ? 'authorized' : 'revoked') }
      );
    });
    it('unknown/missing source checker fails closed, and foreign dependency sets are rejected', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { a } = await started(c, runs);
        await assert.rejects(
          c.sources(owner, a.threadId, [
            {
              scopeKey: 'p',
              locator: { kind: 'overlord', entityType: 'project', entityId: 'p', projectId: 'p' }
            }
          ]),
          rejectsCode('source_access_lost')
        );
        await assert.rejects(runs.text(a, 'bad', 'nonexistent'), rejectsCode('source_access_lost'));
      }));
    it('durable notification candidates dedupe transitions and do not use mission change channels', () =>
      fixture(adapter, async (db, c, runs) => {
        const { a } = await started(c, runs);
        await runs.question(a, 'First?');
        await c.submit(owner, a.threadId, { clientRequestId: 'answer', text: 'yes' });
        const b = await runs.claim('new', identity);
        assert.ok(b);
        await runs.question(b, 'Second?');
        await c.submit(owner, a.threadId, { clientRequestId: 'answer2', text: 'yes' });
        const d = await runs.claim('new', identity);
        assert.ok(d);
        await runs.complete(d);
        const rows = await db.all<{ transition_key: string; owner_profile_id: string }>(
          'SELECT transition_key, owner_profile_id FROM chat_notifications ORDER BY transition_key'
        );
        assert.deepEqual(
          rows.map(r => r.transition_key),
          ['question:1', 'question:2', 'terminal:completed']
        );
        assert.ok(rows.every(r => r.owner_profile_id === owner.profileId));
        assert.equal(
          Number(
            (await db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type LIKE 'chat%'"
            ))!.n
          ),
          0
        );
      }));
    it('membership revocation ends replay access without revealing the thread', () =>
      fixture(adapter, async (db, c) => {
        const t = await c.create(owner);
        await db.run("UPDATE workspace_users SET status = 'disabled' WHERE id = 'member'");
        await assert.rejects(c.snapshot(owner, t.thread.id), rejectsCode('not_found'));
        await assert.rejects(c.events(owner, t.thread.id, 0), rejectsCode('not_found'));
      }));

    it('two workers cannot claim the same live lease', () =>
      fixture(adapter, async (_db, c, runs) => {
        await c.create(owner, { clientRequestId: 'initial', text: 'Work' });
        const claims = await Promise.all([
          runs.claim('left', identity),
          runs.claim('right', identity)
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
      }));
    it('Cancel during an executing read rejects its late result', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { a } = await started(c, runs);
        await runs.requestTools(
          a,
          0,
          [{ operationId: 'op', providerCallId: 'call', toolId: 'read', arguments: {}, order: 0 }],
          { phase: 'tool_requested', payload: {}, dependencySetId: null }
        );
        let release!: () => void, invoked!: () => void;
        const pending = new Promise<void>(resolve => {
          release = resolve;
        });
        const startedRead = new Promise<void>(resolve => {
          invoked = resolve;
        });
        const executing = runs.executeTool(a, 'op', async () => {
          invoked();
          await pending;
          return { private: true };
        });
        await startedRead;
        await c.cancel(owner, a.runId, 'cancel');
        release();
        await assert.rejects(executing, StaleChatAttempt);
        const row = await runs.db.get<{ state: string; result_json: string | null }>(
          "SELECT state, result_json FROM chat_tool_calls WHERE operation_id = 'op'"
        );
        assert.equal(row!.state, 'cancelled');
        assert.equal(row!.result_json, null);
      }));
    it('bounds parallel target reads and rejects duplicate in-flight invocation', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { a } = await started(c, runs);
        const requests = Array.from({ length: 5 }, (_, i) => ({
          operationId: `op${i}`,
          providerCallId: `call${i}`,
          toolId: 'read',
          arguments: {},
          order: i
        }));
        await runs.requestTools(a, 0, requests, {
          phase: 'tool_requested',
          payload: {},
          dependencySetId: null
        });
        const releases: (() => void)[] = [],
          executing: Promise<unknown>[] = [];
        for (let i = 0; i < 4; i++) {
          let invoked!: () => void;
          const startedRead = new Promise<void>(resolve => {
            invoked = resolve;
          });
          const pending = new Promise<void>(resolve => {
            releases.push(resolve);
          });
          executing.push(
            runs.executeTool(a, `op${i}`, async () => {
              invoked();
              await pending;
              return {};
            })
          );
          await startedRead;
        }
        await assert.rejects(
          runs.executeTool(a, 'op4', async () => ({})),
          rejectsCode('limit_exceeded')
        );
        await assert.rejects(
          runs.executeTool(a, 'op0', async () => ({})),
          rejectsCode('limit_exceeded')
        );
        for (const release of releases) release();
        await Promise.all(executing);
        await runs.executeTool(a, 'op4', async () => ({}));
      }));
    it('waiting for an answer does not consume the active allowance', () =>
      fixture(
        adapter,
        async (_db, c, runs, advance) => {
          const { a } = await started(c, runs);
          advance(5);
          await runs.question(a, 'Answer?');
          advance(60_000);
          await c.submit(owner, a.threadId, { clientRequestId: 'answer', text: 'Yes' });
          const resumed = await runs.claim('new', identity);
          assert.ok(resumed);
          advance(4);
          assert.equal(await runs.heartbeat(resumed), true);
          assert.equal((await runs.run(a.runId)).active_processing_ms, 9);
        },
        { limits: { activeProcessingMsPerRun: 10 } }
      ));
    it('reauthorization permits fresh content without resurrecting invalidated history', async () => {
      let allowed = true;
      await fixture(
        adapter,
        async (_db, c, runs) => {
          const { a } = await started(c, runs);
          const sources = [
            {
              scopeKey: 'project:p',
              locator: {
                kind: 'overlord' as const,
                entityType: 'project' as const,
                entityId: 'p',
                projectId: 'p'
              }
            }
          ];
          const original = await c.sources(owner, a.threadId, sources);
          await runs.text(a, 'Old secret', original);
          allowed = false;
          await c.snapshot(owner, a.threadId);
          allowed = true;
          const fresh = await c.sources(owner, a.threadId, sources);
          assert.notEqual(fresh, original);
          await c.submit(owner, a.threadId, { clientRequestId: 'again', text: 'Try again' });
          const next = await runs.claim('new', identity);
          assert.ok(next);
          await runs.text(next, 'Fresh answer', fresh);
          await runs.complete(next);
          const snapshot = await c.snapshot(owner, a.threadId);
          assert.ok(!JSON.stringify(snapshot).includes('Old secret'));
          assert.ok(JSON.stringify(snapshot).includes('Fresh answer'));
          assert.ok(!JSON.stringify(await c.events(owner, a.threadId, 0)).includes('Old secret'));
        },
        { checkSource: async () => (allowed ? 'authorized' : 'revoked') }
      );
    });
    it('Continue selects the latest run when runs share a clock millisecond', () =>
      fixture(adapter, async (_db, c, runs) => {
        const { a } = await started(c, runs);
        await runs.complete(a, 'allowance_exhausted');
        const next = await c.continue(owner, a.runId, 'one');
        const b = await runs.claim('next', identity);
        assert.ok(b);
        await runs.complete(b, 'allowance_exhausted');
        const again = await c.continue(owner, next.run.id, 'two');
        assert.equal(again.run.continuedFromRunId, next.run.id);
      }));

    it('the periodic sweep expires replay for an idle thread without a connected client', () =>
      fixture(adapter, async (db, c, runs, advance) => {
        const { a } = await started(c, runs);
        await runs.text(a, 'Done');
        await runs.complete(a);
        advance(8 * 24 * 60 * 60 * 1000);
        await runs.retainExpired();
        assert.equal(
          Number(
            (await db.get<{ n: number }>(
              'SELECT COUNT(*) AS n FROM chat_events WHERE thread_id = ?',
              [a.threadId]
            ))!.n
          ),
          0
        );
        await assert.rejects(c.events(owner, a.threadId, 0), rejectsCode('snapshot_required'));
        assert.equal((await c.snapshot(owner, a.threadId)).messages.length, 2);
      }));
  });
