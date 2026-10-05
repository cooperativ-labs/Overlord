import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPostgresSessionClient, createSqliteClient, type DatabaseClient } from './client.js';
import { openInMemoryDatabase } from './connection.js';
import { migratePostgres } from './migrate-postgres.js';

/**
 * Contract v152 chat schema invariants (coo:1108), on both editions.
 *
 * The migration pair `20261004120000_chat_conversations.sql` must give SQLite
 * triggers and Postgres trigger functions identical semantics: one unfinished
 * run per thread, one leased attempt per run, fenced checkpoint/tool/event
 * writes, gap-free append-only events, frozen proposal revisions, unique
 * creation receipts, monotonic acknowledgements, deduplicated owner-addressed
 * conversation notifications, and account deletion that removes every chat row
 * while leaving created missions (with their soft thread reference) intact.
 */

interface AdapterHandle {
  client: DatabaseClient;
  teardown: () => Promise<void>;
}

interface AdapterFactory {
  label: 'sqlite' | 'postgres';
  create: () => Promise<AdapterHandle>;
}

const sqliteFactory: AdapterFactory = {
  label: 'sqlite',
  create: async () => {
    const sqlite = openInMemoryDatabase();
    return {
      client: createSqliteClient(sqlite),
      teardown: async () => {
        sqlite.close();
      }
    };
  }
};

function postgresFactory(connectionString: string): AdapterFactory {
  return {
    label: 'postgres',
    create: async () => {
      const pg = await import('pg');
      const Pool = (pg.default ?? pg).Pool;
      const schema = `ovld_chat_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const admin = new Pool({ connectionString });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const pool = new Pool({ connectionString });
      const session = await pool.connect();
      await session.query(`SET search_path TO ${schema}`);
      const client = createPostgresSessionClient(session);
      await migratePostgres(client);
      return {
        client,
        teardown: async () => {
          await client.close();
          session.release();
          await pool.end();
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        }
      };
    }
  };
}

const adapters: AdapterFactory[] = [sqliteFactory];
if (process.env.TEST_DATABASE_URL) adapters.push(postgresFactory(process.env.TEST_DATABASE_URL));

const migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION_FILE = '20261004120000_chat_conversations.sql';

const T0 = '2026-10-04T12:00:00.000Z';

async function withAdapter(
  factory: AdapterFactory,
  fn: (client: DatabaseClient) => Promise<void>
): Promise<void> {
  const handle = await factory.create();
  try {
    await fn(handle.client);
  } finally {
    await handle.teardown();
  }
}

/** The Better Auth `user` insert trigger creates the matching profile on both editions. */
async function seedProfile(client: DatabaseClient, id: string): Promise<void> {
  await client.run(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ${client.dialect === 'sqlite' ? '0' : 'FALSE'}, ?, ?)`,
    [id, id, `${id}@example.test`, T0, T0]
  );
  assert.equal(await count(client, `SELECT COUNT(*) AS n FROM profiles WHERE id = ?`, [id]), 1);
}

async function seedOrganization(client: DatabaseClient, id: string): Promise<void> {
  await client.run(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [id, id, T0, T0]
  );
}

async function seedThread(
  client: DatabaseClient,
  { id, ownerId, organizationId }: { id: string; ownerId: string; organizationId: string }
): Promise<void> {
  await client.run(
    `INSERT INTO chat_threads (id, owner_profile_id, organization_id, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, ownerId, organizationId, T0, T0, T0]
  );
}

async function seedUserMessage(
  client: DatabaseClient,
  {
    id,
    threadId,
    clientRequestId
  }: { id: string; threadId: string; clientRequestId: string | null }
): Promise<void> {
  await client.run(
    `INSERT INTO chat_messages (id, thread_id, role, state, blocks_json, client_request_id, created_at, updated_at)
     VALUES (?, ?, 'user', 'complete', '[]', ?, ?, ?)`,
    [id, threadId, clientRequestId, T0, T0]
  );
}

async function seedRun(
  client: DatabaseClient,
  {
    id,
    threadId,
    triggerMessageId,
    state = 'queued',
    continuedFromRunId = null
  }: {
    id: string;
    threadId: string;
    triggerMessageId: string | null;
    state?: 'queued' | 'running' | 'waiting_user' | 'cancelled';
    continuedFromRunId?: string | null;
  }
): Promise<void> {
  await client.run(
    `INSERT INTO chat_runs (id, thread_id, trigger_message_id, continued_from_run_id, state, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      threadId,
      triggerMessageId,
      continuedFromRunId,
      state,
      state === 'cancelled' ? T0 : null,
      T0,
      T0
    ]
  );
}

async function completeRun(client: DatabaseClient, runId: string): Promise<void> {
  await client.run(
    `UPDATE chat_runs SET state = 'completed', outcome = 'answered', completed_at = ?, active_attempt_id = NULL WHERE id = ?`,
    [T0, runId]
  );
}

async function advanceFence(client: DatabaseClient, runId: string): Promise<number> {
  await client.run(`UPDATE chat_runs SET current_fence = current_fence + 1 WHERE id = ?`, [runId]);
  const row = await client.get<{ current_fence: number }>(
    `SELECT current_fence FROM chat_runs WHERE id = ?`,
    [runId]
  );
  return Number(row?.current_fence);
}

async function insertAttempt(
  client: DatabaseClient,
  { id, runId, number, fence }: { id: string; runId: string; number: number; fence: number }
): Promise<void> {
  await client.run(
    `INSERT INTO chat_run_attempts (id, run_id, attempt_number, fence, state, recovery_mode, provider, model,
                                    lease_owner, lease_expires_at, started_at)
     VALUES (?, ?, ?, ?, 'leased', 'initial', 'gemini', 'gemini-3.8-flash', 'worker-1', ?, ?)`,
    [id, runId, number, fence, T0, T0]
  );
}

async function appendEvent(
  client: DatabaseClient,
  {
    threadId,
    runId = null,
    attemptId = null,
    fence = null
  }: { threadId: string; runId?: string | null; attemptId?: string | null; fence?: number | null }
): Promise<number> {
  return client.transaction(async tx => {
    await tx.run(`UPDATE chat_threads SET last_event_seq = last_event_seq + 1 WHERE id = ?`, [
      threadId
    ]);
    const row = await tx.get<{ last_event_seq: number }>(
      `SELECT last_event_seq FROM chat_threads WHERE id = ?`,
      [threadId]
    );
    const seq = Number(row?.last_event_seq);
    await tx.run(
      `INSERT INTO chat_events (id, thread_id, seq, kind, run_id, attempt_id, fence, payload_json, created_at)
       VALUES (?, ?, ?, 'run.updated', ?, ?, ?, '{}', ?)`,
      [randomUUID(), threadId, seq, runId, attemptId, fence, T0]
    );
    return seq;
  });
}

async function count(client: DatabaseClient, sql: string, params: unknown[] = []): Promise<number> {
  const row = await client.get<{ n: number | string }>(sql, params);
  return Number(row?.n ?? 0);
}

/** Owner A and B in organization O; thread T owned by A with one user message. */
async function seedBaseline(client: DatabaseClient) {
  const ids = {
    ownerA: 'profile-a',
    ownerB: 'profile-b',
    org: 'org-1',
    thread: 'thread-a',
    threadB: 'thread-b',
    message: 'message-1'
  };
  await seedProfile(client, ids.ownerA);
  await seedProfile(client, ids.ownerB);
  await seedOrganization(client, ids.org);
  await seedThread(client, { id: ids.thread, ownerId: ids.ownerA, organizationId: ids.org });
  await seedThread(client, { id: ids.threadB, ownerId: ids.ownerB, organizationId: ids.org });
  await seedUserMessage(client, {
    id: ids.message,
    threadId: ids.thread,
    clientRequestId: 'req-1'
  });
  return ids;
}

for (const factory of adapters) {
  describe(`chat schema invariants [${factory.label}]`, () => {
    it('allows at most one unfinished run per thread and one continuation per run', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await seedRun(client, { id: 'run-1', threadId: ids.thread, triggerMessageId: ids.message });
        await assert.rejects(
          seedRun(client, {
            id: 'run-2',
            threadId: ids.thread,
            triggerMessageId: ids.message,
            state: 'waiting_user'
          })
        );
        await completeRun(client, 'run-1');
        await seedRun(client, {
          id: 'run-2',
          threadId: ids.thread,
          triggerMessageId: null,
          continuedFromRunId: 'run-1'
        });
        await completeRun(client, 'run-2');
        await assert.rejects(
          seedRun(client, {
            id: 'run-3',
            threadId: ids.thread,
            triggerMessageId: null,
            continuedFromRunId: 'run-1'
          }),
          'a run is continued at most once'
        );
        await assert.rejects(
          seedRun(client, { id: 'run-4', threadId: ids.thread, triggerMessageId: null }),
          'a run needs a trigger message or a continued run'
        );
        // Terminal-state consistency.
        await seedRun(client, { id: 'run-5', threadId: ids.thread, triggerMessageId: ids.message });
        await assert.rejects(
          client.run(
            `UPDATE chat_runs SET state = 'completed', completed_at = ? WHERE id = 'run-5'`,
            [T0]
          )
        );
        await assert.rejects(
          client.run(`UPDATE chat_runs SET state = 'failed', completed_at = ? WHERE id = 'run-5'`, [
            T0
          ])
        );
        await assert.rejects(
          client.run(
            `UPDATE chat_runs SET state = 'waiting_user', active_attempt_id = 'x' WHERE id = 'run-5'`
          )
        );
        await client.run(
          `UPDATE chat_runs SET state = 'failed', failure_code = 'provider_error', completed_at = ? WHERE id = 'run-5'`,
          [T0]
        );
        // Another thread is independent.
        await seedUserMessage(client, {
          id: 'message-b',
          threadId: ids.threadB,
          clientRequestId: 'req-1'
        });
        await seedRun(client, {
          id: 'run-b',
          threadId: ids.threadB,
          triggerMessageId: 'message-b'
        });
      });
    });

    it('deduplicates user submissions per thread client request id', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await assert.rejects(
          seedUserMessage(client, {
            id: 'message-dup',
            threadId: ids.thread,
            clientRequestId: 'req-1'
          })
        );
        await seedUserMessage(client, {
          id: 'message-2',
          threadId: ids.thread,
          clientRequestId: 'req-2'
        });
        await assert.rejects(
          client.run(
            `INSERT INTO chat_messages (id, thread_id, role, state, client_request_id, created_at, updated_at)
             VALUES ('assistant-1', ?, 'assistant', 'streaming', 'req-3', ?, ?)`,
            [ids.thread, T0, T0]
          ),
          'assistant messages carry no client request id'
        );
      });
    });

    it('fences attempts, checkpoints, tool calls, and events by the run current fence', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await seedRun(client, { id: 'run-1', threadId: ids.thread, triggerMessageId: ids.message });

        await assert.rejects(
          insertAttempt(client, { id: 'att-1', runId: 'run-1', number: 1, fence: 1 })
        );
        const fence1 = await advanceFence(client, 'run-1');
        await insertAttempt(client, { id: 'att-1', runId: 'run-1', number: 1, fence: fence1 });
        const fence2 = await advanceFence(client, 'run-1');
        await assert.rejects(
          insertAttempt(client, { id: 'att-2', runId: 'run-1', number: 2, fence: fence2 }),
          'one leased attempt per run'
        );
        await client.run(
          `UPDATE chat_run_attempts SET state = 'fenced', ended_at = ? WHERE id = 'att-1'`,
          [T0]
        );
        await insertAttempt(client, { id: 'att-2', runId: 'run-1', number: 2, fence: fence2 });

        // Checkpoints.
        const checkpointSql = `INSERT INTO chat_provider_checkpoints
            (run_id, attempt_id, fence, schema_version, provider, model, config_digest, phase, payload_json, created_at, updated_at)
          VALUES ('run-1', ?, ?, 1, 'gemini', 'gemini-3.8-flash', 'digest', 'tool_requested', '{}', ?, ?)`;
        await assert.rejects(
          client.run(checkpointSql, ['att-1', fence1, T0, T0]),
          'stale checkpoint insert'
        );
        await client.run(checkpointSql, ['att-2', fence2, T0, T0]);

        // Tool calls.
        await assert.rejects(
          client.run(
            `INSERT INTO chat_tool_calls (id, run_id, attempt_id, operation_id, turn_index, call_order, tool_id,
                                          policy_version, state, requested_fence, writer_fence, created_at, updated_at)
             VALUES ('call-0', 'run-1', 'att-1', 'run-1:0:0', 0, 0, 'overlord.search', 1, 'requested', ?, ?, ?, ?)`,
            [fence1, fence1, T0, T0]
          ),
          'stale tool-call insert'
        );
        await client.run(
          `INSERT INTO chat_tool_calls (id, run_id, attempt_id, operation_id, turn_index, call_order, tool_id,
                                        policy_version, state, requested_fence, writer_fence, created_at, updated_at)
           VALUES ('call-1', 'run-1', 'att-2', 'run-1:0:0', 0, 0, 'overlord.search', 1, 'requested', ?, ?, ?, ?)`,
          [fence2, fence2, T0, T0]
        );
        await assert.rejects(
          client.run(
            `INSERT INTO chat_tool_calls (id, run_id, attempt_id, operation_id, turn_index, call_order, tool_id,
                                          policy_version, state, requested_fence, writer_fence, created_at, updated_at)
             VALUES ('call-dup', 'run-1', 'att-2', 'run-1:0:0', 0, 1, 'overlord.search', 1, 'requested', ?, ?, ?, ?)`,
            [fence2, fence2, T0, T0]
          ),
          'operation ids are unique'
        );

        // A new worker claims attempt 3; the attempt-2 worker is now stale.
        await client.run(
          `UPDATE chat_run_attempts SET state = 'fenced', ended_at = ? WHERE id = 'att-2'`,
          [T0]
        );
        const fence3 = await advanceFence(client, 'run-1');
        await insertAttempt(client, { id: 'att-3', runId: 'run-1', number: 3, fence: fence3 });

        await assert.rejects(
          client.run(
            `UPDATE chat_provider_checkpoints SET payload_json = '{"x":1}' WHERE run_id = 'run-1'`
          ),
          'stale checkpoint payload update'
        );
        await client.run(
          `UPDATE chat_provider_checkpoints SET invalidated_at = ? WHERE run_id = 'run-1'`,
          [T0]
        );
        await client.run(
          `UPDATE chat_provider_checkpoints SET attempt_id = 'att-3', fence = ?, payload_json = '{"x":2}' WHERE run_id = 'run-1'`,
          [fence3]
        );

        await assert.rejects(
          client.run(
            `UPDATE chat_tool_calls SET state = 'executing', executions = 1 WHERE id = 'call-1'`
          ),
          'stale tool-call writer'
        );
        await client.run(
          `UPDATE chat_tool_calls SET state = 'completed', executions = 2, writer_fence = ?, result_json = '{}',
                  completed_at = ? WHERE id = 'call-1'`,
          [fence3, T0]
        );

        // Events.
        await assert.rejects(
          client.run(
            `INSERT INTO chat_events (id, thread_id, seq, kind, payload_json, created_at)
             VALUES ('event-x', ?, 1, 'run.updated', '{}', ?)`,
            [ids.thread, T0]
          ),
          'events must take the allocated sequence'
        );
        assert.equal(await appendEvent(client, { threadId: ids.thread }), 1);
        assert.equal(
          await appendEvent(client, {
            threadId: ids.thread,
            runId: 'run-1',
            attemptId: 'att-3',
            fence: fence3
          }),
          2
        );
        await assert.rejects(
          appendEvent(client, {
            threadId: ids.thread,
            runId: 'run-1',
            attemptId: 'att-2',
            fence: fence2
          }),
          'stale event fence'
        );
        assert.equal(
          await count(client, `SELECT last_event_seq AS n FROM chat_threads WHERE id = ?`, [
            ids.thread
          ]),
          2,
          'a rejected event rolls back its sequence allocation'
        );
        await assert.rejects(
          client.run(
            `UPDATE chat_events SET payload_json = '{"edited":true}' WHERE thread_id = ?`,
            [ids.thread]
          ),
          'events are append-only'
        );
        // Retention advances the boundary and deletes whole rows below it.
        await client.run(`DELETE FROM chat_events WHERE thread_id = ? AND seq < 2`, [ids.thread]);
        await client.run(`UPDATE chat_threads SET retained_from_seq = 2 WHERE id = ?`, [
          ids.thread
        ]);
        await assert.rejects(
          client.run(`UPDATE chat_threads SET retained_from_seq = 4 WHERE id = ?`, [ids.thread]),
          'retention cannot pass the last event'
        );
      });
    });

    it('keeps one open question per run and freezes proposal revisions behind unique receipts', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await seedRun(client, {
          id: 'run-1',
          threadId: ids.thread,
          triggerMessageId: ids.message,
          state: 'waiting_user'
        });
        const questionSql = `INSERT INTO chat_questions (id, thread_id, run_id, ordinal, state, prompt, created_at, updated_at)
           VALUES (?, ?, 'run-1', ?, 'open', 'Which project?', ?, ?)`;
        await client.run(questionSql, ['q-1', ids.thread, 1, T0, T0]);
        await assert.rejects(
          client.run(questionSql, ['q-2', ids.thread, 2, T0, T0]),
          'one open question'
        );
        await assert.rejects(
          client.run(`UPDATE chat_questions SET state = 'answered' WHERE id = 'q-1'`),
          'answered requires answered_at'
        );
        await client.run(
          `UPDATE chat_questions SET state = 'answered', answered_at = ? WHERE id = 'q-1'`,
          [T0]
        );
        await client.run(questionSql, ['q-2', ids.thread, 2, T0, T0]);
        await assert.rejects(
          client.run(questionSql, ['q-3', ids.thread, 2, T0, T0]),
          'ordinals are unique'
        );

        await client.run(
          `INSERT INTO chat_work_proposals (id, thread_id, state, current_revision, created_by_run_id, created_at, updated_at)
           VALUES ('p-1', ?, 'open', 1, 'run-1', ?, ?)`,
          [ids.thread, T0, T0]
        );
        await client.run(
          `INSERT INTO chat_work_proposal_revisions (proposal_id, proposal_revision, spec_json, responsible_profile_id, created_at)
           VALUES ('p-1', 1, '{"missions":[]}', ?, ?)`,
          [ids.ownerA, T0]
        );
        await assert.rejects(
          client.run(
            `UPDATE chat_work_proposal_revisions SET spec_json = '{"missions":[1]}' WHERE proposal_id = 'p-1'`
          ),
          'revisions are frozen'
        );
        await client.run(
          `UPDATE chat_work_proposal_revisions SET invalidated_at = ? WHERE proposal_id = 'p-1'`,
          [T0]
        );

        const receiptSql = `INSERT INTO chat_work_receipts
            (id, proposal_id, proposal_revision, owner_profile_id, client_request_id, request_digest, authorization_revision, created_at)
          VALUES (?, ?, ?, ?, ?, 'digest', 1, ?)`;
        await assert.rejects(
          client.run(receiptSql, ['r-0', 'p-1', 2, ids.ownerA, 'create-0', T0]),
          'receipt names an existing revision'
        );
        await client.run(receiptSql, ['r-1', 'p-1', 1, ids.ownerA, 'create-1', T0]);
        await assert.rejects(
          client.run(receiptSql, ['r-2', 'p-1', 1, ids.ownerA, 'create-2', T0]),
          'one receipt per proposal'
        );
        await client.run(
          `INSERT INTO chat_work_proposals (id, thread_id, state, current_revision, created_at, updated_at)
           VALUES ('p-2', ?, 'open', 1, ?, ?)`,
          [ids.thread, T0, T0]
        );
        await client.run(
          `INSERT INTO chat_work_proposal_revisions (proposal_id, proposal_revision, spec_json, responsible_profile_id, created_at)
           VALUES ('p-2', 1, '{"missions":[]}', ?, ?)`,
          [ids.ownerA, T0]
        );
        await assert.rejects(
          client.run(receiptSql, ['r-3', 'p-2', 1, ids.ownerA, 'create-1', T0]),
          'client request ids are unique per owner'
        );
        const linkSql = `INSERT INTO chat_work_receipt_missions (receipt_id, position, mission_id, project_id, workspace_id)
           VALUES ('r-1', ?, ?, 'project-1', 'workspace-1')`;
        await client.run(linkSql, [0, 'mission-1']);
        await assert.rejects(
          client.run(linkSql, [1, 'mission-1']),
          'a mission belongs to one receipt'
        );
      });
    });

    it('keeps acknowledgements monotonic and conversation notifications deduplicated and owner-addressed', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await seedRun(client, {
          id: 'run-1',
          threadId: ids.thread,
          triggerMessageId: ids.message,
          state: 'waiting_user'
        });
        await client.run(
          `INSERT INTO chat_questions (id, thread_id, run_id, ordinal, state, prompt, created_at, updated_at)
           VALUES ('q-1', ?, 'run-1', 1, 'open', 'Which project?', ?, ?)`,
          [ids.thread, T0, T0]
        );

        await client.run(
          `INSERT INTO chat_event_acks (thread_id, client_id, acked_seq, acked_at, created_at) VALUES (?, 'phone', 5, ?, ?)`,
          [ids.thread, T0, T0]
        );
        await client.run(`UPDATE chat_event_acks SET acked_seq = 5 WHERE client_id = 'phone'`);
        await assert.rejects(
          client.run(`UPDATE chat_event_acks SET acked_seq = 4 WHERE client_id = 'phone'`),
          'acknowledgements never move backwards'
        );
        await client.run(
          `INSERT INTO chat_presence (thread_id, client_id, platform, expires_at, created_at, updated_at)
           VALUES (?, 'phone', 'ios', ?, ?, ?)`,
          [ids.thread, T0, T0, T0]
        );
        await assert.rejects(
          client.run(
            `INSERT INTO chat_presence (thread_id, client_id, platform, expires_at, created_at, updated_at)
             VALUES (?, 'phone', 'ios', ?, ?, ?)`,
            [ids.thread, T0, T0, T0]
          ),
          'one presence row per client and thread'
        );

        const notificationSql = `INSERT INTO chat_notifications
            (id, owner_profile_id, organization_id, thread_id, run_id, question_id, type, transition_key, event_seq,
             state, due_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'run-1', ?, ?, ?, 3, 'pending', ?, ?, ?)`;
        await client.run(notificationSql, [
          'n-1',
          ids.ownerA,
          ids.org,
          ids.thread,
          'q-1',
          'chat_needs_answer',
          'question:1',
          T0,
          T0,
          T0
        ]);
        await assert.rejects(
          client.run(notificationSql, [
            'n-2',
            ids.ownerA,
            ids.org,
            ids.thread,
            'q-1',
            'chat_needs_answer',
            'question:1',
            T0,
            T0,
            T0
          ]),
          'one candidate per question transition'
        );
        await assert.rejects(
          client.run(notificationSql, [
            'n-3',
            ids.ownerB,
            ids.org,
            ids.thread,
            'q-1',
            'chat_needs_answer',
            'question:1',
            T0,
            T0,
            T0
          ]),
          'addressed to the thread owner only'
        );
        await assert.rejects(
          client.run(notificationSql, [
            'n-4',
            ids.ownerA,
            ids.org,
            ids.thread,
            null,
            'chat_needs_answer',
            'question:2',
            T0,
            T0,
            T0
          ]),
          'needs-answer names its question'
        );
        await assert.rejects(
          client.run(notificationSql, [
            'n-5',
            ids.ownerA,
            ids.org,
            ids.thread,
            'q-1',
            'chat_finished',
            'terminal:completed',
            T0,
            T0,
            T0
          ]),
          'finished names no question'
        );
        await client.run(notificationSql, [
          'n-6',
          ids.ownerA,
          ids.org,
          ids.thread,
          null,
          'chat_finished',
          'terminal:completed',
          T0,
          T0,
          T0
        ]);
        await assert.rejects(
          client.run(`UPDATE chat_notifications SET state = 'dispatched' WHERE id = 'n-6'`),
          'dispatched requires dispatched_at'
        );
        await assert.rejects(
          client.run(`UPDATE chat_notifications SET read_at = ? WHERE id = 'n-6'`, [T0]),
          'only a dispatched notification can be read'
        );
        await client.run(
          `UPDATE chat_notifications SET state = 'suppressed', suppressed_at = ?, suppressed_by_client_id = 'phone'
            WHERE id = 'n-1'`,
          [T0]
        );
        await client.run(
          `UPDATE chat_notifications SET state = 'dispatched', dispatched_at = ?, thread_title = 'Offline support'
            WHERE id = 'n-6'`,
          [T0]
        );
        await client.run(`UPDATE chat_notifications SET read_at = ? WHERE id = 'n-6'`, [T0]);

        await client.run(
          `INSERT INTO notification_preferences (id, profile_id, type, transport, mode, created_at, updated_at)
           VALUES ('pref-1', ?, 'chat_needs_answer', 'apns', 'alert', ?, ?)`,
          [ids.ownerA, T0, T0]
        );
        await client.run(
          `INSERT INTO notification_preferences (id, profile_id, type, transport, mode, created_at, updated_at)
           VALUES ('pref-2', ?, 'agent_question', 'apns', 'silent', ?, ?)`,
          [ids.ownerA, T0, T0]
        );
        await assert.rejects(
          client.run(
            `INSERT INTO notification_preferences (id, profile_id, type, transport, mode, created_at, updated_at)
             VALUES ('pref-3', ?, 'chat_unknown', 'apns', 'alert', ?, ?)`,
            [ids.ownerA, T0, T0]
          )
        );
      });
    });

    it('stores live account connections with owner-bound credentials only', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        const connectionSql = `INSERT INTO account_connections
            (id, owner_profile_id, organization_id, provider, server_url, state, credential_ciphertext, credential_key_id,
             disconnected_at, created_at, updated_at)
          VALUES (?, ?, ?, 'knowledgebase', ?, ?, ?, ?, ?, ?, ?)`;
        const url = 'https://knowledge.example.test/mcp';
        await assert.rejects(
          client.run(connectionSql, [
            'c-0',
            ids.ownerA,
            ids.org,
            url,
            'connected',
            null,
            null,
            null,
            T0,
            T0
          ]),
          'connected requires a credential envelope'
        );
        await assert.rejects(
          client.run(connectionSql, [
            'c-0',
            ids.ownerA,
            ids.org,
            'http://insecure.test',
            'pending',
            null,
            null,
            null,
            T0,
            T0
          ]),
          'https only'
        );
        await client.run(connectionSql, [
          'c-1',
          ids.ownerA,
          ids.org,
          url,
          'connected',
          'v1.ciphertext',
          'key-1',
          null,
          T0,
          T0
        ]);
        await assert.rejects(
          client.run(connectionSql, [
            'c-2',
            ids.ownerA,
            ids.org,
            url,
            'pending',
            null,
            null,
            null,
            T0,
            T0
          ]),
          'one live connection per owner, organization, provider, and server'
        );
        await client.run(
          `UPDATE account_connections SET state = 'disconnected', credential_ciphertext = NULL, credential_key_id = NULL,
                  disconnected_at = ? WHERE id = 'c-1'`,
          [T0]
        );
        await client.run(connectionSql, [
          'c-2',
          ids.ownerA,
          ids.org,
          url,
          'pending',
          null,
          null,
          null,
          T0,
          T0
        ]);
        await client.run(connectionSql, [
          'c-3',
          ids.ownerB,
          ids.org,
          url,
          'pending',
          null,
          null,
          null,
          T0,
          T0
        ]);
        await client.run(
          `INSERT INTO account_connection_authorizations (id, connection_id, state_hash, pkce_verifier_ciphertext, return_to, expires_at, created_at)
           VALUES ('auth-1', 'c-2', 'hash-1', 'v1.verifier', 'mobile', ?, ?)`,
          [T0, T0]
        );
        await assert.rejects(
          client.run(
            `INSERT INTO account_connection_authorizations (id, connection_id, state_hash, pkce_verifier_ciphertext, return_to, expires_at, created_at)
             VALUES ('auth-2', 'c-3', 'hash-1', 'v1.verifier', 'web', ?, ?)`,
            [T0, T0]
          ),
          'OAuth state hashes are single-use and unique'
        );
      });
    });

    it('removes every chat row with the owner account and leaves created missions intact', async () => {
      await withAdapter(factory, async client => {
        const ids = await seedBaseline(client);
        await client.run(
          `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
           VALUES ('ws-1', ?, 'general', 'General', 'hosted', ?, ?)`,
          [ids.org, T0, T0]
        );
        await client.run(
          `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
           VALUES ('project-1', 'ws-1', 'overlord', 'Overlord', 'active', ?, ?)`,
          [T0, T0]
        );
        await client.run(
          `INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, created_at, updated_at)
           VALUES ('status-1', 'ws-1', 'project-1', 'draft', 'Draft', 'draft', 100, ?, ?)`,
          [T0, T0]
        );
        await client.run(
          `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type,
                                 created_by_kind, created_from_chat_thread_id, created_at, updated_at)
           VALUES ('mission-1', 'ws-1', 'project-1', 'ovl:1', 1, 'Offline support', 'status-1', 'draft', 'agent', ?, ?, ?)`,
          [ids.thread, T0, T0]
        );

        await seedRun(client, { id: 'run-1', threadId: ids.thread, triggerMessageId: ids.message });
        const fence = await advanceFence(client, 'run-1');
        await insertAttempt(client, { id: 'att-1', runId: 'run-1', number: 1, fence });
        await client.run(
          `UPDATE chat_runs SET state = 'running', active_attempt_id = 'att-1' WHERE id = 'run-1'`
        );
        await appendEvent(client, {
          threadId: ids.thread,
          runId: 'run-1',
          attemptId: 'att-1',
          fence
        });
        await client.run(
          `INSERT INTO chat_source_refs (id, thread_id, source_kind, scope_key, locator_json, access_state, access_checked_at,
                                        created_at, updated_at)
           VALUES ('src-1', ?, 'overlord', 'overlord:project:project-1', '{}', 'authorized', ?, ?, ?)`,
          [ids.thread, T0, T0, T0]
        );
        await client.run(
          `INSERT INTO chat_dependency_sets (id, thread_id, digest, created_at) VALUES ('deps-1', ?, 'd1', ?)`,
          [ids.thread, T0]
        );
        await client.run(
          `INSERT INTO chat_dependency_set_members (dependency_set_id, source_ref_id) VALUES ('deps-1', 'src-1')`
        );
        await client.run(
          `INSERT INTO chat_evidence (id, thread_id, run_id, source_ref_id, label, observed_at, created_at)
           VALUES ('ev-1', ?, 'run-1', 'src-1', 'Overlord project', ?, ?)`,
          [ids.thread, T0, T0]
        );
        await client.run(
          `INSERT INTO chat_work_proposals (id, thread_id, state, current_revision, created_at, updated_at)
           VALUES ('p-1', ?, 'created', 1, ?, ?)`,
          [ids.thread, T0, T0]
        );
        await client.run(
          `INSERT INTO chat_work_proposal_revisions (proposal_id, proposal_revision, spec_json, responsible_profile_id, dependency_set_id, created_at)
           VALUES ('p-1', 1, '{}', ?, 'deps-1', ?)`,
          [ids.ownerA, T0]
        );
        await client.run(
          `INSERT INTO chat_work_receipts (id, proposal_id, proposal_revision, owner_profile_id, client_request_id,
                                           request_digest, authorization_revision, created_at)
           VALUES ('r-1', 'p-1', 1, ?, 'create-1', 'digest', 1, ?)`,
          [ids.ownerA, T0]
        );
        await client.run(
          `INSERT INTO chat_work_receipt_missions (receipt_id, position, mission_id, project_id, workspace_id)
           VALUES ('r-1', 0, 'mission-1', 'project-1', 'ws-1')`
        );
        await client.run(
          `INSERT INTO account_connections (id, owner_profile_id, organization_id, provider, server_url, state, created_at, updated_at)
           VALUES ('c-1', ?, ?, 'knowledgebase', 'https://knowledge.example.test/mcp', 'pending', ?, ?)`,
          [ids.ownerA, ids.org, T0, T0]
        );

        await client.run(`DELETE FROM "user" WHERE id = ?`, [ids.ownerA]);

        for (const table of [
          'chat_messages',
          'chat_runs',
          'chat_run_attempts',
          'chat_events',
          'chat_source_refs',
          'chat_dependency_sets',
          'chat_dependency_set_members',
          'chat_evidence',
          'chat_work_proposals',
          'chat_work_proposal_revisions',
          'chat_work_receipts',
          'chat_work_receipt_missions',
          'account_connections'
        ]) {
          assert.equal(
            await count(client, `SELECT COUNT(*) AS n FROM ${table}`),
            0,
            `${table} cascades`
          );
        }
        assert.deepEqual(
          (await client.all<{ id: string }>(`SELECT id FROM chat_threads ORDER BY id`)).map(
            row => row.id
          ),
          [ids.threadB],
          "only the other owner's thread remains"
        );
        const mission = await client.get<{ created_from_chat_thread_id: string | null }>(
          `SELECT created_from_chat_thread_id FROM missions WHERE id = 'mission-1'`
        );
        assert.equal(
          mission?.created_from_chat_thread_id,
          ids.thread,
          'mission history keeps its soft reference'
        );
      });
    });

    it('widens notification preference types without altering existing rows', async () => {
      await withAdapter(factory, async client => {
        await seedProfile(client, 'profile-a');
        const sql = readFileSync(
          path.join(migrationsRoot, factory.label, 'migrations', MIGRATION_FILE),
          'utf8'
        );
        const marker = '-- Notification preferences: admit the two conversation catalog types';
        const section = sql.slice(sql.indexOf(marker), sql.lastIndexOf('COMMIT;'));
        assert.ok(section.length > marker.length, 'migration has a preference section');

        // Restore the contract-v151 preference shape, then replay only that section.
        if (factory.label === 'sqlite') {
          await client.exec(`
            DROP TABLE notification_preferences;
            CREATE TABLE notification_preferences (
              id TEXT PRIMARY KEY,
              profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
              type TEXT NOT NULL CHECK (type IN ('all', 'mission_awaiting_review', 'agent_question',
                'mission_complete', 'mission_failed', 'agent_started', 'returned_to_execute')),
              transport TEXT NOT NULL CHECK (transport IN ('all', 'apns', 'realtime', 'in_app')),
              mode TEXT NOT NULL CHECK (mode IN ('alert', 'silent', 'off')),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE (profile_id, type, transport)
            );
          `);
        } else {
          await client.exec(`
            ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check;
            ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_type_check
              CHECK (type IN ('all', 'mission_awaiting_review', 'agent_question', 'mission_complete',
                'mission_failed', 'agent_started', 'returned_to_execute'));
          `);
        }
        const insert = `INSERT INTO notification_preferences (id, profile_id, type, transport, mode, created_at, updated_at)
           VALUES (?, 'profile-a', ?, ?, ?, ?, ?)`;
        await client.run(insert, ['master', 'all', 'all', 'off', T0, T0]);
        await client.run(insert, ['question', 'agent_question', 'apns', 'silent', T0, T0]);
        await assert.rejects(
          client.run(insert, ['chat', 'chat_finished', 'apns', 'alert', T0, T0])
        );

        await client.exec(section);

        const rows = await client.all<{
          id: string;
          type: string;
          transport: string;
          mode: string;
        }>(`SELECT id, type, transport, mode FROM notification_preferences ORDER BY id`);
        assert.deepEqual(
          rows.map(row => ({ ...row })),
          [
            { id: 'master', type: 'all', transport: 'all', mode: 'off' },
            { id: 'question', type: 'agent_question', transport: 'apns', mode: 'silent' }
          ]
        );
        await client.run(insert, ['chat', 'chat_finished', 'apns', 'alert', T0, T0]);
        await assert.rejects(client.run(insert, ['dup', 'chat_finished', 'apns', 'off', T0, T0]));
      });
    });
  });
}
