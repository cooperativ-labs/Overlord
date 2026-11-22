import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { pruneChangeFeedBatch } from '../packages/core/service/change-feed-retention.ts';
import { createServiceContext } from '../packages/core/service/context.ts';
import { recordRunnerHeartbeat } from '../packages/core/service/execution-target-runners.ts';
import { seedServiceOperator } from '../packages/core/service/test-helpers.ts';

import { createConformanceDatabase } from './test-helpers.ts';

test(
  'PostgreSQL serializes feed reads, pruning, and concurrent heartbeat changes',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_order');
    try {
      await seedServiceOperator({ db, workspaceId: 'feed-order-workspace' });
      const scratch = process.env.OVERLORD_TMPDIR ?? path.resolve('.overlord/tmp');
      mkdirSync(scratch, { recursive: true });
      process.env.OVERLORD_SQLITE_PATH = path.join(
        scratch,
        `feed-order-module-${randomUUID()}.sqlite`
      );
      const { currentMaxSeq, withCommittedFeed, bindDatabaseClient } = await import('./db.ts');
      let inserted!: () => void;
      let commit!: () => void;
      const ready = new Promise<void>(resolve => {
        inserted = resolve;
      });
      const release = new Promise<void>(resolve => {
        commit = resolve;
      });
      const writer = db.transaction(async tx => {
        await tx.run(
          `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
        VALUES (?, ?, 'test', 'uncommitted', 'insert', 'test', ?)`,
          [randomUUID(), 'feed-order-workspace', new Date().toISOString()]
        );
        inserted();
        await release;
      });
      await ready;
      // A later sequence can commit while the earlier allocation is still open.
      await db.run(
        `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
         VALUES (?, ?, 'test', 'committed-later-sequence', 'insert', 'test', ?)`,
        [
          randomUUID(),
          'feed-order-workspace',
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        ]
      );
      let finished = false;
      const read = currentMaxSeq(db).then(value => {
        finished = true;
        return value;
      });
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(finished, false, 'the cursor cannot pass an uncommitted insert');
      } finally {
        commit();
      }
      await writer;
      const cursor = await read;
      const row = await db.get<{ seq: number }>(
        `SELECT seq FROM entity_changes WHERE entity_id = 'uncommitted'`
      );
      assert.ok(row);
      assert.ok(cursor >= row.seq);
      const later = await db.get<{ seq: number }>(
        `SELECT seq FROM entity_changes WHERE entity_id = 'committed-later-sequence'`
      );
      assert.ok(later && later.seq > row.seq && cursor >= later.seq);

      await db.run(`UPDATE entity_changes SET occurred_at = ? WHERE seq = ?`, [
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        row.seq
      ]);
      let readerReady!: () => void;
      let releaseReader!: () => void;
      const locked = new Promise<void>(resolve => {
        readerReady = resolve;
      });
      const readerGate = new Promise<void>(resolve => {
        releaseReader = resolve;
      });
      const reader = withCommittedFeed(db, async tx => {
        const state = await tx.get<{ retained_through: number }>(
          `SELECT retained_through FROM entity_change_retention WHERE id = 1`
        );
        readerReady();
        await readerGate;
        const stillVisible = await tx.get<{ seq: number }>(
          `SELECT seq FROM entity_changes WHERE seq = ?`,
          [row.seq]
        );
        assert.equal(Number(state?.retained_through), 0);
        assert.ok(stillVisible);
      });
      await locked;
      let pruned = false;
      const pruning = pruneChangeFeedBatch(db).then(result => {
        pruned = true;
        return result;
      });
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(pruned, false, 'pruning cannot cross an in-flight feed read');
      } finally {
        releaseReader();
      }
      await reader;
      assert.equal((await pruning).deleted, 2);

      await db.run(
        `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
        VALUES (?, ?, 'test', 'worker-gate', 'insert', 'test', ?)`,
        [
          randomUUID(),
          'feed-order-workspace',
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        ]
      );
      await bindDatabaseClient(db);
      const { ChangeFeedRetentionWorker } = await import('./change-feed-retention-worker.ts');
      const worker = new ChangeFeedRetentionWorker();
      const previous = process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED;
      try {
        delete process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED;
        await worker.pollNow();
        assert.ok(await db.get(`SELECT seq FROM entity_changes WHERE entity_id = 'worker-gate'`));
        process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED = 'true';
        await worker.pollNow();
        assert.equal(
          await db.get(`SELECT seq FROM entity_changes WHERE entity_id = 'worker-gate'`),
          undefined
        );
      } finally {
        if (previous === undefined) delete process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED;
        else process.env.OVERLORD_CHANGE_FEED_PRUNING_ENABLED = previous;
        await worker.stop();
      }

      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO devices (id, workspace_id, fingerprint, label, status, created_at, updated_at)
        VALUES ('heartbeat-device', ?, 'heartbeat-fingerprint', 'Host', 'active', ?, ?)`,
        ['feed-order-workspace', now, now]
      );
      await db.run(
        `INSERT INTO execution_targets (id, workspace_id, device_id, type, label, status, created_at, updated_at)
        VALUES ('heartbeat-target', ?, 'heartbeat-device', 'local', 'Host', 'active', ?, ?)`,
        ['feed-order-workspace', now, now]
      );
      const ctx = await createServiceContext({ db, source: 'runner' });
      const input = {
        ctx,
        executionTargetId: 'heartbeat-target',
        runnerInstanceId: 'heartbeat-runner',
        relation: 'native' as const
      };
      const registration = await recordRunnerHeartbeat(input);
      let rowLocked!: () => void;
      let releaseRow!: () => void;
      const lockReady = new Promise<void>(resolve => {
        rowLocked = resolve;
      });
      const rowGate = new Promise<void>(resolve => {
        releaseRow = resolve;
      });
      const degraded = db.transaction(async tx => {
        await tx.get(
          `SELECT id FROM execution_target_runner_registrations WHERE id = ? FOR UPDATE`,
          [registration.id]
        );
        rowLocked();
        await rowGate;
        await recordRunnerHeartbeat({ ...input, ctx: { ...ctx, db: tx }, health: 'degraded' });
      });
      await lockReady;
      let healthyDone = false;
      const healthy = recordRunnerHeartbeat(input).then(() => {
        healthyDone = true;
      });
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(healthyDone, false);
      } finally {
        releaseRow();
      }
      await degraded;
      await healthy;
      const changes = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM entity_changes WHERE entity_type = 'execution_target_runner_registration' AND entity_id = ?`,
        [registration.id]
      );
      assert.equal(
        Number(changes?.n),
        3,
        'both changes are emitted after serializing competing heartbeats'
      );

      const member = await db.get<{ id: string; profile_id: string }>(
        `SELECT id, profile_id FROM workspace_users WHERE workspace_id = ? LIMIT 1`,
        ['feed-order-workspace']
      );
      assert.ok(member);
      await db.run(`UPDATE entity_changes SET occurred_at = ?`, [
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ]);
      await db.run(
        `INSERT INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id) VALUES (?, ?)`,
        ['erase-race', member.id]
      );
      await db.run(
        `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, actor_workspace_user_id, source, occurred_at)
        VALUES (?, ?, 'everhour:workspace_connection', 'erase-race', 'insert', ?, 'test', ?)`,
        [
          randomUUID(),
          'feed-order-workspace',
          member.id,
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        ]
      );
      const { cascadeDeleteAccount } = await import('./account-deletion.ts');
      let erasureReady!: () => void;
      let releaseErasure!: () => void;
      const erasureLocked = new Promise<void>(resolve => {
        erasureReady = resolve;
      });
      const erasureGate = new Promise<void>(resolve => {
        releaseErasure = resolve;
      });
      const erasure = db.transaction(async tx => {
        await tx.get('SELECT entity_changes_feed_write_gate()');
        erasureReady();
        await erasureGate;
        await cascadeDeleteAccount(member.profile_id);
      });
      await erasureLocked;
      const concurrentPrune = pruneChangeFeedBatch(db);
      releaseErasure();
      await erasure;
      await concurrentPrune;
      const preserved = await db.all<{ actor_workspace_user_id: string }>(
        `SELECT actor_workspace_user_id FROM ext_everhour_connection_attribution WHERE connection_id = 'erase-race'`
      );
      assert.deepEqual(
        preserved.map(row => row.actor_workspace_user_id),
        ['!overlord:erased-actor']
      );
    } finally {
      await cleanup();
    }
  }
);
