import type { Response } from 'express';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

import { seedServiceOperator } from '../packages/core/service/test-helpers.ts';

import { createConformanceDatabase } from './test-helpers.ts';

const connectionString = process.env.TEST_DATABASE_URL;

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs: number): Promise<NonNullable<T>> {
  const deadline = performance.now() + timeoutMs;
  do {
    const value = await probe();
    if (value) return value;
    await delay(15);
  } while (performance.now() < deadline);
  throw new Error(`Condition was not met within ${timeoutMs} ms`);
}

function stream() {
  const chunks: string[] = [];
  let ended = false;
  const response = {
    writeHead() {},
    write(chunk: string) {
      chunks.push(chunk);
    },
    end() {
      ended = true;
    }
  } as unknown as Response;
  return {
    response,
    text: () => chunks.join(''),
    ended: () => ended
  };
}

test(
  'PostgreSQL wakeups deliver committed rows on two hubs and recover from missed hints',
  {
    skip: !connectionString,
    timeout: 25_000
  },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_wake');
    const admin = new pg.Client({ connectionString });
    const listenerTag = `overlord-feed-test-${randomUUID()}`;
    const url = new URL(connectionString!);
    url.searchParams.set('application_name', listenerTag);
    const workspaceId = 'wake-visible';
    const hiddenWorkspaceId = 'wake-hidden';
    process.env.OVERLORD_SQLITE_PATH = path.join(
      process.env.OVERLORD_TMPDIR ?? path.resolve('.overlord/tmp'),
      `wake-module-${randomUUID()}.sqlite`
    );
    const { bindDatabaseClient, currentMaxSeq } = await import('./db.ts');
    const { RealtimeHub } = await import('./realtime.ts');
    const hubs = [new RealtimeHub(url.toString()), new RealtimeHub(url.toString())];
    const peers = hubs.map(() => stream());
    try {
      await admin.connect();
      await seedServiceOperator({ db, workspaceId });
      await seedServiceOperator({
        db,
        workspaceId: hiddenWorkspaceId,
        profileId: 'wake-other-profile',
        workspaceUserId: 'wake-other-user'
      });
      await bindDatabaseClient(db);
      const listenerPids = async () => {
        const { rows } = await admin.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE application_name = $1
         AND state = 'idle' AND query = 'LISTEN overlord_entity_changes'`,
          [listenerTag]
        );
        return rows.map(row => row.pid);
      };
      const append = (id: string, scope = workspaceId, type = 'test', client = db) =>
        client.run(
          `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
         VALUES (?, ?, ?, ?, 'insert', 'test', ?)`,
          [randomUUID(), scope, type, id, new Date().toISOString()]
        );
      const bothSaw = (id: string) => peers.every(peer => peer.text().includes(`"${id}"`));

      const beforeStartup = await currentMaxSeq(db);
      await append('startup-replay');
      await Promise.all(hubs.map(hub => hub.start()));
      // One commit exceeds a live-feed page and arrives after startup, while
      // neither hub has subscribers. Replay and live draining can overlap.
      await db.run(
        `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
         SELECT 'idle-batch-' || n, ?, 'test', 'idle-batch-' || n, 'insert', 'test', now()
           FROM generate_series(1, 501) AS n`,
        [workspaceId]
      );
      hubs.forEach((hub, index) =>
        hub.addClient(peers[index]!.response, {
          workspaceIds: [workspaceId],
          afterSeq: beforeStartup
        })
      );
      await waitFor(() => bothSaw('startup-replay'), 2_000);
      await waitFor(() => bothSaw('idle-batch-501'), 2_000);
      const armed = await waitFor(async () => {
        const pids = await listenerPids();
        return pids.length === hubs.length ? pids : null;
      }, 3_000);

      await assert.rejects(
        db.transaction(async tx => {
          await append('rolled-back', workspaceId, 'test', tx);
          throw new Error('rollback');
        }),
        /rollback/
      );
      await db.transaction(async tx => {
        await append('hidden-commit', hiddenWorkspaceId, 'test', tx);
        await append('visible-commit', workspaceId, 'test', tx);
      });
      await waitFor(() => bothSaw('visible-commit'), 2_000);
      for (const peer of peers) {
        assert.doesNotMatch(peer.text(), /hidden-commit|rolled-back/);
        assert.equal(peer.text().match(/"idle-batch-501"/g)?.length, 1);
      }

      await admin.query('SELECT pg_terminate_backend($1)', [armed[0]]);
      await append('after-disconnect');
      await waitFor(() => bothSaw('after-disconnect'), 2_000);
      await waitFor(async () => {
        const pids = await listenerPids();
        return pids.length === hubs.length && !pids.includes(armed[0]!);
      }, 8_000);
      await append('after-rearm');
      await waitFor(() => bothSaw('after-rearm'), 2_000);

      await db.exec('ALTER TABLE entity_changes DISABLE TRIGGER entity_changes_insert_notify');
      await append('silent-loss');
      await waitFor(() => bothSaw('silent-loss'), 6_500);
      await db.exec('ALTER TABLE entity_changes ENABLE TRIGGER entity_changes_insert_notify');
      await append('role-change', workspaceId, 'role_assignment');
      await waitFor(() => peers.every(peer => peer.ended()), 2_000);

      const retainedThrough = await currentMaxSeq(db);
      await db.run('UPDATE entity_change_retention SET retained_through = ? WHERE id = 1', [
        retainedThrough
      ]);
      const expired = stream();
      hubs[0]!.addClient(expired.response, {
        workspaceIds: [workspaceId],
        afterSeq: beforeStartup
      });
      await waitFor(expired.ended, 2_000);
      assert.match(expired.text(), /event: snapshot_required/);
    } finally {
      await Promise.all(hubs.map(hub => hub.stop()));
      await admin.end();
      await cleanup();
    }
  }
);
