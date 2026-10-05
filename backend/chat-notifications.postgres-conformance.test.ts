import { type DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { type ChatOwner, Conversations } from '../packages/core/service/chat/conversations.ts';
import {
  type ChatNotificationRow,
  ChatNotifications
} from '../packages/core/service/chat/notifications.ts';
import { ChatRuns } from '../packages/core/service/chat/runs.ts';
import type { ChatOptions } from '../packages/core/service/chat/store.ts';

import type {
  ChatNotificationDispatcher as Dispatcher,
  ChatPushSender
} from './chat-notification-dispatcher.ts';
import {
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

// The dispatcher reuses backend preference helpers whose module opens the process
// database on import; point it at a scratch file instead of the developer database.
process.env.OVERLORD_SQLITE_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), 'overlord-chat-notifications-')),
  'process.sqlite'
);
const { ChatNotificationDispatcher } = await import('./chat-notification-dispatcher.ts');

const identity = { provider: 'fake', model: 'fake-1', configDigest: 'c', checkpointVersion: 1 };
const owner: ChatOwner = { profileId: 'owner', organizationId: 'org' };
const adapters = conformanceAdapters();
const PRIVATE_QUESTION = 'Should I read the secret billing repository?';

type Sent = Parameters<ChatPushSender>[0];
interface Harness {
  db: DatabaseClient;
  c: Conversations;
  runs: ChatRuns;
  n: ChatNotifications;
  sent: Sent[];
  failNext: { count: number };
  dispatcher: (id?: string) => Dispatcher;
  advance: (ms: number) => void;
  options: ChatOptions;
}

async function fixture(adapter: ConformanceAdapter, fn: (h: Harness) => Promise<void>) {
  const { db, cleanup } = await createConformanceDatabase(adapter, 'chat_notify');
  try {
    let now = Date.parse('2026-10-04T12:00:00.000Z');
    const options: ChatOptions = { now: () => now };
    const stamp = new Date(now).toISOString();
    const falsy = db.dialect === 'sqlite' ? '0' : 'FALSE';
    for (const [id, email] of [
      ['owner', 'owner@test.invalid'],
      ['other', 'other@test.invalid']
    ])
      await db.run(
        `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, ${falsy}, ?, ?)`,
        [id, id, email, stamp, stamp]
      );
    await db.run(
      "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)",
      [stamp, stamp]
    );
    await db.run(
      "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', ?, ?)",
      [stamp, stamp]
    );
    for (const id of ['owner', 'other'])
      await db.run(
        "INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, created_at, updated_at) VALUES (?, 'ws', ?, ?, 'active', ?, ?)",
        [`member-${id}`, id, id, stamp, stamp]
      );
    const sent: Sent[] = [];
    const failNext = { count: 0 };
    const sender: ChatPushSender = async input => {
      if (failNext.count > 0) {
        failNext.count -= 1;
        throw new Error('APNs 503: ServiceUnavailable');
      }
      sent.push(input);
    };
    await fn({
      db,
      c: new Conversations(db, options),
      runs: new ChatRuns(db, options),
      n: new ChatNotifications(db, options),
      sent,
      failNext,
      dispatcher: () => new ChatNotificationDispatcher(() => db, options, sender),
      advance: ms => {
        now += ms;
      },
      options
    });
  } finally {
    await cleanup();
  }
}

/** A thread whose run is waiting on a question; returns the candidate it wrote. */
async function asked(h: Harness, prompt = PRIVATE_QUESTION) {
  const created = await h.c.create(owner, { clientRequestId: randomUUID(), text: 'Plan billing' });
  const a = await h.runs.claim('worker-1', identity);
  assert.ok(a);
  const q = await h.runs.question(a, prompt);
  const threadId = created.thread.id;
  return { threadId, runId: a.runId, q, candidate: await latest(h.db, threadId) };
}
async function latest(db: DatabaseClient, threadId: string) {
  return (await db.get<ChatNotificationRow>(
    'SELECT * FROM chat_notifications WHERE thread_id = ? ORDER BY event_seq DESC LIMIT 1',
    [threadId]
  ))!;
}
async function state(db: DatabaseClient, id: string) {
  return (await db.get<ChatNotificationRow>('SELECT * FROM chat_notifications WHERE id = ?', [
    id
  ]))!;
}
async function setPreference(db: DatabaseClient, type: string, transport: string, mode: string) {
  const stamp = new Date().toISOString();
  await db.run(
    'INSERT INTO notification_preferences (id, profile_id, type, transport, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), owner.profileId, type, transport, mode, stamp, stamp]
  );
}
const rejectsCode = (code: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === code);

for (const adapter of adapters)
  describe(`conversation notifications [${adapter}]`, () => {
    it('a stale open socket does not suppress: the candidate dispatches after the grace period with no private content', () =>
      fixture(adapter, async h => {
        const { threadId, runId, candidate } = await asked(h);
        assert.equal(candidate.type, 'chat_needs_answer');
        assert.equal(candidate.state, 'pending');
        // Foreground presence and an open stream, but the event was never rendered/acknowledged.
        await h.n.presence(owner, threadId, {
          clientId: 'phone',
          platform: 'ios',
          state: 'foreground'
        });
        await h.c.events(owner, threadId, 0);
        assert.equal(await h.dispatcher().tick(), 0, 'not due inside the grace period');
        h.advance(5_000);
        assert.equal(await h.dispatcher().tick(), 1);
        assert.equal(h.sent.length, 1);
        const push = h.sent[0]!;
        assert.equal(push.profileId, owner.profileId);
        assert.equal(push.mode, 'alert');
        assert.equal(push.collapseId, `chat:${candidate.id}`);
        const body = JSON.parse(push.body);
        assert.deepEqual(body.data, {
          category: 'chat_needs_answer',
          threadId,
          runId,
          deepLink: `overlord://chat/threads/${threadId}`
        });
        assert.equal(body.aps.alert.body, 'The assistant needs your answer.');
        assert.equal(body.aps.badge, 1);
        assert.ok(!push.body.includes('secret billing'), 'question text never reaches APNs');
        // The bounded sanitized thread title is the only user-derived text in the payload.
        const title = (await h.db.get<{ title: string | null }>(
          'SELECT title FROM chat_threads WHERE id = ?',
          [threadId]
        ))!.title;
        assert.equal(body.aps.alert.title, title ?? 'Assistant conversation');
        const row = await state(h.db, candidate.id!);
        assert.equal(row.state, 'dispatched');
        assert.ok(row.thread_title && row.thread_title.length <= 80);
        assert.equal(await h.dispatcher().tick(), 0, 'dispatched once');
        // Mission notification history is untouched.
        const missions = await h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications');
        assert.equal(Number(missions!.n), 0);
      }));

    it('a foreground acknowledgement from any device suppresses; background, expired or released presence does not', () =>
      fixture(adapter, async h => {
        const { threadId, candidate } = await asked(h);
        const seq = Number(candidate.event_seq);
        // The phone was foreground but its presence lapsed (backgrounded without release).
        await h.n.presence(owner, threadId, {
          clientId: 'phone',
          platform: 'ios',
          state: 'foreground'
        });
        h.advance(30_001);
        const lapsed = await h.n.ack(owner, threadId, { clientId: 'phone', seq });
        assert.deepEqual(lapsed.suppressedNotificationIds, []);
        // A released client cannot suppress either.
        await h.n.presence(owner, threadId, {
          clientId: 'tab',
          platform: 'web',
          state: 'foreground'
        });
        const released = await h.n.presence(owner, threadId, {
          clientId: 'tab',
          platform: 'web',
          state: 'released'
        });
        assert.equal(released.expiresAt, null);
        assert.deepEqual(
          (await h.n.ack(owner, threadId, { clientId: 'tab', seq })).suppressedNotificationIds,
          []
        );
        // The desktop is foreground on this thread and renders the event.
        const desk = await h.n.presence(owner, threadId, {
          clientId: 'desktop',
          platform: 'desktop',
          state: 'foreground'
        });
        assert.ok(desk.expiresAt);
        const ack = await h.n.ack(owner, threadId, { clientId: 'desktop', seq });
        assert.deepEqual(ack.suppressedNotificationIds, [candidate.id]);
        const row = await state(h.db, candidate.id!);
        assert.equal(row.state, 'suppressed');
        assert.equal(row.suppressed_by_client_id, 'desktop');
        h.advance(10_000);
        assert.equal(await h.dispatcher().tick(), 0);
        assert.equal(h.sent.length, 0);
        // Repeating the acknowledgement is idempotent.
        assert.deepEqual(
          (await h.n.ack(owner, threadId, { clientId: 'desktop', seq })).suppressedNotificationIds,
          []
        );
      }));

    it('acknowledgements are monotonic, bounded by published events, and owner-scoped', () =>
      fixture(adapter, async h => {
        const { threadId, candidate } = await asked(h);
        const seq = Number(candidate.event_seq);
        assert.equal((await h.n.ack(owner, threadId, { clientId: 'phone', seq })).ackedSeq, seq);
        assert.equal(
          (await h.n.ack(owner, threadId, { clientId: 'phone', seq: 1 })).ackedSeq,
          seq,
          'a lower acknowledgement keeps the stored value'
        );
        await assert.rejects(
          h.n.ack(owner, threadId, { clientId: 'phone', seq: seq + 50 }),
          rejectsCode('invalid_request')
        );
        await assert.rejects(
          h.n.ack(owner, threadId, { clientId: '', seq }),
          rejectsCode('invalid_request')
        );
        await assert.rejects(
          h.n.presence(owner, threadId, {
            clientId: 'x',
            platform: 'watch' as 'ios',
            state: 'foreground'
          }),
          rejectsCode('invalid_request')
        );
        const foreign = { ...owner, profileId: 'other' };
        await assert.rejects(
          h.n.presence(foreign, threadId, { clientId: 'x', platform: 'ios', state: 'foreground' }),
          rejectsCode('not_found')
        );
        await assert.rejects(
          h.n.ack(foreign, threadId, { clientId: 'x', seq: 1 }),
          rejectsCode('not_found')
        );
        // Acknowledgement is not a replay cursor: replay from 0 is still served in full.
        const page = await h.c.events(owner, threadId, 0);
        assert.equal(page.events[0]!.seq, 1);
      }));

    it('each question is independently eligible and an answered question never sends a stale push', () =>
      fixture(adapter, async h => {
        const first = await asked(h, 'First?');
        await h.c.submit(owner, first.threadId, { clientRequestId: 'a1', text: 'yes' });
        const b = await h.runs.claim('worker-2', identity);
        assert.ok(b);
        await h.runs.question(b, 'Second?');
        const second = await latest(h.db, first.threadId);
        assert.notEqual(second.id, first.candidate.id);
        assert.equal(second.transition_key, 'question:2');
        // Acknowledging only the first question's event leaves the second eligible.
        await h.n.presence(owner, first.threadId, {
          clientId: 'phone',
          platform: 'ios',
          state: 'foreground'
        });
        const ack = await h.n.ack(owner, first.threadId, {
          clientId: 'phone',
          seq: Number(first.candidate.event_seq)
        });
        assert.deepEqual(ack.suppressedNotificationIds, [first.candidate.id]);
        await h.n.presence(owner, first.threadId, {
          clientId: 'phone',
          platform: 'ios',
          state: 'released'
        });
        h.advance(5_000);
        await h.dispatcher().tick();
        assert.equal((await state(h.db, second.id!)).state, 'dispatched');
        assert.equal(h.sent.length, 1);
      }));

    it('answering before the grace period cancels the question candidate at dispatch; finishing notifies', () =>
      fixture(adapter, async h => {
        const { threadId, candidate } = await asked(h);
        await h.c.submit(owner, threadId, { clientRequestId: 'answer', text: 'No' });
        const d = await h.runs.claim('worker-2', identity);
        assert.ok(d);
        await h.runs.complete(d);
        h.advance(5_000);
        assert.equal(await h.dispatcher().tick(), 2);
        const q = await state(h.db, candidate.id!);
        assert.equal(q.state, 'cancelled');
        assert.equal(q.last_error, 'question_closed');
        const finished = await latest(h.db, threadId);
        assert.equal(finished.transition_key, 'terminal:completed');
        assert.equal(finished.state, 'dispatched');
        assert.equal(h.sent.length, 1);
        assert.equal(JSON.parse(h.sent[0]!.body).data.category, 'chat_finished');
        // A failed run notifies as finished too; a cancelled run never does.
        const again = await h.c.submit(owner, threadId, { clientRequestId: 'm2', text: 'More' });
        const e = await h.runs.claim('worker-3', identity);
        assert.ok(e);
        await h.runs.fail(e, 'provider_error');
        await h.c.submit(owner, threadId, { clientRequestId: 'm3', text: 'Again' });
        const run3 = (await h.c.snapshot(owner, threadId)).activeRun!;
        await h.c.cancel(owner, run3.id, 'cancel-3');
        const keys = await h.db.all<{ transition_key: string; run_id: string }>(
          'SELECT transition_key, run_id FROM chat_notifications WHERE thread_id = ? ORDER BY created_at, transition_key',
          [threadId]
        );
        assert.deepEqual(
          keys.filter(k => k.run_id !== candidate.run_id).map(k => k.transition_key),
          ['terminal:failed']
        );
        assert.equal(again.run.id, keys.find(k => k.transition_key === 'terminal:failed')!.run_id);
      }));

    it('dispatcher retries transient failures under one collapse id and never double-sends across workers', () =>
      fixture(adapter, async h => {
        const { candidate } = await asked(h);
        h.advance(5_000);
        h.failNext.count = 1;
        await h.dispatcher().tick();
        let row = await state(h.db, candidate.id!);
        assert.equal(row.state, 'pending');
        assert.equal(row.attempt_count, 1);
        assert.match(row.last_error ?? '', /APNs 503/);
        assert.equal(await h.dispatcher().tick(), 0, 'backoff delays the retry');
        h.advance(5_000);
        // Two dispatchers race for the same due candidate: exactly one delivers.
        const results = await Promise.all([h.dispatcher().tick(), h.dispatcher().tick()]);
        assert.equal(
          results.reduce((x, y) => x + y, 0),
          1
        );
        assert.equal(h.sent.length, 1);
        assert.equal(h.sent[0]!.collapseId, `chat:${candidate.id}`);
        row = await state(h.db, candidate.id!);
        assert.equal(row.state, 'dispatched');
        assert.equal(row.attempt_count, 2);
      }));

    it('a crashed dispatcher’s claim is reclaimed after its lease and the stale worker cannot finalize', () =>
      fixture(adapter, async h => {
        const { candidate } = await asked(h);
        h.advance(5_000);
        const [claimed] = await h.n.claimDue('crashed-worker');
        assert.equal(claimed!.id, candidate.id);
        assert.equal(await h.dispatcher().tick(), 0, 'held by the live lease');
        h.advance(60_000);
        assert.equal(await h.dispatcher().tick(), 1);
        assert.equal((await state(h.db, candidate.id!)).state, 'dispatched');
        assert.equal(await h.n.markCancelled(claimed!, 'crashed-worker', 'late'), false);
        assert.equal((await state(h.db, candidate.id!)).state, 'dispatched');
      }));

    it('gives up after max attempts', () =>
      fixture(adapter, async h => {
        const { candidate } = await asked(h);
        h.failNext.count = 100;
        for (let i = 0; i < 6; i += 1) {
          h.advance(700_000);
          await h.dispatcher().tick();
        }
        const row = await state(h.db, candidate.id!);
        assert.equal(row.state, 'failed');
        assert.equal(row.attempt_count, row.max_attempts);
      }));

    it('rechecks preferences and access at dispatch', () =>
      fixture(adapter, async h => {
        // Silent APNs: background push without an alert dictionary.
        await setPreference(h.db, 'chat_needs_answer', 'apns', 'silent');
        const silent = await asked(h);
        h.advance(5_000);
        await h.dispatcher().tick();
        const body = JSON.parse(h.sent[0]!.body);
        assert.equal(h.sent[0]!.mode, 'silent');
        assert.equal(body.aps.alert, undefined);
        assert.equal(body.aps['content-available'], 1);
        await h.c.cancel(owner, silent.runId, 'stop');

        // APNs off but in-app on: history entry, no push.
        await h.db.run(
          "UPDATE notification_preferences SET mode = 'off' WHERE type = 'chat_needs_answer'"
        );
        const inApp = await asked(h);
        h.advance(5_000);
        await h.dispatcher().tick();
        assert.equal(h.sent.length, 1);
        assert.equal((await state(h.db, inApp.candidate.id!)).state, 'dispatched');
        await h.c.cancel(owner, inApp.runId, 'stop2');

        // Both off: cancelled.
        await setPreference(h.db, 'chat_needs_answer', 'in_app', 'off');
        const off = await asked(h);
        h.advance(5_000);
        await h.dispatcher().tick();
        assert.equal((await state(h.db, off.candidate.id!)).last_error, 'preferences_off');
        await h.c.cancel(owner, off.runId, 'stop3');

        // Master switch off cancels every type.
        await setPreference(h.db, 'all', 'all', 'off');
        const d = await h.c.submit(owner, off.threadId, { clientRequestId: 'x', text: 'go' });
        const run = await h.runs.claim('w', identity);
        assert.equal(run!.runId, d.run.id);
        await h.runs.complete(run!);
        h.advance(5_000);
        await h.dispatcher().tick();
        assert.equal((await latest(h.db, off.threadId)).state, 'cancelled');
        assert.equal(h.sent.length, 1);

        // Membership revoked before dispatch: cancelled without a push.
        await h.db.run("DELETE FROM notification_preferences WHERE profile_id = 'owner'");
        const revoked = await asked(h);
        await h.db.run("UPDATE workspace_users SET status = 'disabled' WHERE profile_id = 'owner'");
        h.advance(5_000);
        await h.dispatcher().tick();
        const row = await state(h.db, revoked.candidate.id!);
        assert.equal(row.state, 'cancelled');
        assert.equal(row.last_error, 'access_revoked');
        assert.equal(h.sent.length, 1);
      }));

    it('history, unread count, badge and revision-checked read are owner-scoped', () =>
      fixture(adapter, async h => {
        const one = await asked(h);
        await h.c.cancel(owner, one.runId, 'c1');
        // The cancelled run's question closes, so only a later finished run notifies.
        await h.c.submit(owner, one.threadId, { clientRequestId: 'm', text: 'again' });
        const r = await h.runs.claim('w', identity);
        await h.runs.complete(r!);
        const two = await asked(h);
        h.advance(5_000);
        await h.dispatcher().tick();
        assert.deepEqual(
          h.sent.map(s => JSON.parse(s.body).aps.badge),
          [1, 2],
          'badge counts unread conversation notifications including this one'
        );
        const history = await h.n.history(owner);
        assert.equal(history.items.length, 2);
        assert.equal(history.unreadCount, 2);
        assert.ok(history.items.some(item => item.threadId === two.threadId));
        for (const item of history.items) {
          assert.ok(!JSON.stringify(item).includes('secret billing'));
          assert.ok(item.threadTitle.length > 0 && item.threadTitle.length <= 80);
        }
        const target = history.items[0]!;
        await assert.rejects(
          h.n.markRead(owner, target.id, { expectedRevision: target.revision + 1 }),
          rejectsCode('stale_revision')
        );
        await assert.rejects(
          h.n.markRead({ ...owner, profileId: 'other' }, target.id, {
            expectedRevision: target.revision
          }),
          rejectsCode('not_found')
        );
        const read = await h.n.markRead(owner, target.id, { expectedRevision: target.revision });
        assert.ok(read.readAt);
        assert.equal(read.revision, target.revision + 1);
        assert.deepEqual(
          await h.n.markRead(owner, target.id, { expectedRevision: read.revision }),
          read,
          'idempotent at the current revision'
        );
        assert.equal((await h.n.history(owner)).unreadCount, 1);
        assert.equal((await h.n.history({ ...owner, profileId: 'other' })).items.length, 0);
        await assert.rejects(
          h.n.history({ ...owner, organizationId: 'elsewhere' }),
          rejectsCode('not_found')
        );
      }));
  });
