import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { pruneChangeFeedBatch } from '../packages/core/service/change-feed-retention.ts';
import { seedServiceOperator } from '../packages/core/service/test-helpers.ts';

import { createConformanceDatabase } from './test-helpers.ts';

// ADR 0103: feed writers hold an advisory gate in shared mode from before
// identity allocation through commit; readers, pruning and erasure coordinate
// on it instead of entity_changes table locks that cancel autovacuum.

const WORKSPACE = 'feed-gate-workspace';
const skip = !process.env.TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function loadDb() {
  const scratch = process.env.OVERLORD_TMPDIR ?? path.resolve('.overlord/tmp');
  mkdirSync(scratch, { recursive: true });
  process.env.OVERLORD_SQLITE_PATH ??= path.join(
    scratch,
    `feed-gate-module-${randomUUID()}.sqlite`
  );
  return import('./db.ts');
}

function insertSql(marker: string, rows = 1): string {
  const values = Array.from(
    { length: rows },
    (_, index) =>
      `(gen_random_uuid()::text, '${WORKSPACE}', 'test', '${marker}-${index}', 'insert', 'test', now())`
  ).join(', ');
  return `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
    VALUES ${values} /* ${marker} */`;
}

async function allocated(db: DatabaseClient): Promise<number> {
  const row = await db.get<{ value: string | null }>(
    `SELECT pg_sequence_last_value(pg_get_serial_sequence('entity_changes', 'seq')::regclass) AS value`
  );
  return Number(row?.value ?? 0);
}

/** Wait until another session's statement is observed blocked on an advisory lock. */
async function waitForAdvisoryWait(db: DatabaseClient, marker: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const row = await db.get(
      `SELECT 1 FROM pg_stat_activity
        WHERE state = 'active' AND wait_event_type = 'Lock' AND wait_event = 'advisory'
          AND query LIKE ? AND pid <> pg_backend_pid()`,
      [`%${marker}%`]
    );
    if (row) return;
    await sleep(10);
  }
  assert.fail(`statement ${marker} was not observed waiting on the feed gate`);
}

test(
  'PostgreSQL feed inserts wait for the read gate before allocating an identity',
  { skip },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_alloc');
    try {
      await seedServiceOperator({ db, workspaceId: WORKSPACE });
      const { withCommittedFeed, currentMaxSeq } = await loadDb();
      await db.run(insertSql('baseline'));
      const statements = [
        ['single-row', insertSql('single-row')],
        ['multi-row', insertSql('multi-row', 3)],
        [
          'insert-select',
          `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
           SELECT gen_random_uuid()::text, '${WORKSPACE}', 'test', 'insert-select-' || g, 'insert', 'test', now()
             FROM generate_series(1, 4) g /* insert-select */`
        ]
      ] as const;
      for (const [marker, sql] of statements) {
        const held = deferred();
        const release = deferred();
        const reader = withCommittedFeed(db, async tx => {
          held.resolve();
          await release.promise;
          // Nested reads re-enter the exclusive gate this transaction holds.
          return currentMaxSeq(tx);
        });
        await held.promise;
        const before = await allocated(db);
        const write = db.run(sql);
        await waitForAdvisoryWait(db, marker);
        assert.equal(
          await allocated(db),
          before,
          `${marker}: no identity is allocated while the insert waits for the gate`
        );
        release.resolve();
        const cursor = await reader;
        await write;
        const rows = await db.all<{ seq: number }>(
          `SELECT seq FROM entity_changes WHERE entity_id LIKE ? ORDER BY seq`,
          [`${marker}-%`]
        );
        assert.ok(rows.length > 0);
        assert.ok(
          rows.every(row => Number(row.seq) > cursor),
          `${marker}: every row allocated after the reader released sorts above its cursor`
        );
      }
    } finally {
      await cleanup();
    }
  }
);

test('PostgreSQL rejects feed identities not allocated under the gate', { skip }, async () => {
  const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_ids');
  try {
    await seedServiceOperator({ db, workspaceId: WORKSPACE });
    await db.run(insertSql('a'));
    await db.run(insertSql('b'));
    const first = await db.get<{ seq: number }>(
      `SELECT seq FROM entity_changes WHERE entity_id = 'a-0'`
    );
    assert.ok(first);
    await db.run(`DELETE FROM entity_changes WHERE seq = ?`, [first.seq]);
    const explicit = (seq: number | string, overriding = '') =>
      `INSERT INTO entity_changes (seq, id, workspace_id, entity_type, entity_id, operation, source, occurred_at)
       ${overriding} VALUES (${seq}, gen_random_uuid()::text, '${WORKSPACE}', 'test', 'explicit', 'insert', 'test', now())`;
    const rejected = { code: '55000' };
    await assert.rejects(() => db.run(explicit(Number(first.seq))), rejected, 'reused low seq');
    await assert.rejects(
      () => db.run(explicit(Number(first.seq), 'OVERRIDING SYSTEM VALUE')),
      rejected,
      'overriding system value'
    );
    const beyond = (await allocated(db)) + 1_000;
    await assert.rejects(() => db.run(explicit(beyond)), rejected, 'seq beyond the sequence');
    await assert.rejects(
      () =>
        db.transaction(async tx => {
          const early = await tx.get<{ seq: string }>(
            `SELECT nextval(pg_get_serial_sequence('entity_changes', 'seq')) AS seq`
          );
          await tx.run(explicit(Number(early?.seq)));
        }),
      rejected,
      'a value allocated before the gate'
    );
    // nextval() evaluated by the statement itself runs after the BEFORE
    // statement trigger took the gate, so it is allocated under the gate.
    await db.run(explicit(`nextval(pg_get_serial_sequence('entity_changes', 'seq'))`));
    assert.ok(await db.get(`SELECT 1 FROM entity_changes WHERE entity_id = 'explicit'`));
    await db.run(insertSql('after-rejections'));
    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM entity_changes WHERE entity_id = 'after-rejections-0'`
    );
    assert.equal(Number(count?.n), 1, 'the identity default still works');
  } finally {
    await cleanup();
  }
});

test(
  'PostgreSQL feed reads wait for delayed lower sequences and skip rolled-back ones',
  { skip },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_delay');
    try {
      await seedServiceOperator({ db, workspaceId: WORKSPACE });
      const { currentMaxSeq } = await loadDb();
      for (const outcome of ['commit', 'rollback'] as const) {
        const inserted = deferred();
        const finish = deferred();
        const slow = db
          .transaction(async tx => {
            await tx.run(insertSql(`slow-${outcome}`));
            inserted.resolve();
            await finish.promise;
            if (outcome === 'rollback') throw new Error('rollback slow writer');
          })
          .catch(error => {
            if (outcome !== 'rollback') throw error;
          });
        await inserted.promise;
        await db.run(insertSql(`fast-${outcome}`));
        let done = false;
        const read = currentMaxSeq(db).then(cursor => {
          done = true;
          return cursor;
        });
        await sleep(100);
        assert.equal(done, false, `${outcome}: the cursor cannot pass an open lower sequence`);
        finish.resolve();
        await slow;
        const cursor = await read;
        const fast = await db.get<{ seq: number }>(
          `SELECT seq FROM entity_changes WHERE entity_id = ?`,
          [`fast-${outcome}-0`]
        );
        assert.ok(fast && cursor >= Number(fast.seq));
        const slowRow = await db.get<{ seq: number }>(
          `SELECT seq FROM entity_changes WHERE entity_id = ?`,
          [`slow-${outcome}-0`]
        );
        if (outcome === 'commit') assert.ok(slowRow && Number(slowRow.seq) < Number(fast.seq));
        else assert.equal(slowRow, undefined);
      }
    } finally {
      await cleanup();
    }
  }
);

test('PostgreSQL rejects a feed read inside a feed-writing transaction', { skip }, async () => {
  const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_upgrade');
  try {
    await seedServiceOperator({ db, workspaceId: WORKSPACE });
    const { currentMaxSeq } = await loadDb();
    const started = Date.now();
    await assert.rejects(
      () =>
        db.transaction(async tx => {
          await tx.run(insertSql('writer'));
          await currentMaxSeq(tx);
        }),
      { code: '55000' }
    );
    await assert.rejects(
      () =>
        db.transaction(async tx => {
          await tx.run(insertSql('pruner'));
          await pruneChangeFeedBatch(tx);
        }),
      { code: '55000' }
    );
    assert.ok(Date.now() - started < 1_000, 'the upgrade fails fast instead of waiting');
  } finally {
    await cleanup();
  }
});

test('PostgreSQL feed gate holders do not conflict with VACUUM', { skip }, async () => {
  const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_vacuum');
  const { default: pg } = await import('pg');
  const schema = String((await db.get<{ s: string }>(`SELECT current_schema() AS s`))?.s);
  const vacuumer = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await vacuumer.connect();
  try {
    await seedServiceOperator({ db, workspaceId: WORKSPACE });
    const { withCommittedFeed } = await loadDb();
    await db.run(insertSql('vacuum-seed', 20));
    await db.run(`DELETE FROM entity_changes WHERE entity_id LIKE 'vacuum-seed-1%'`);
    await vacuumer.query(`SET lock_timeout = '1s'`);
    const holders: Record<string, (tx: DatabaseClient) => Promise<unknown>> = {
      reader: tx => tx.get('SELECT entity_changes_feed_read_gate()'),
      pruning: tx => tx.get('SELECT entity_changes_feed_read_gate()'),
      erasure: tx => tx.get('SELECT entity_changes_feed_write_gate()'),
      writer: tx => tx.run(insertSql('vacuum-writer'))
    };
    for (const [name, hold] of Object.entries(holders)) {
      const held = deferred();
      const release = deferred();
      const holder = (
        name === 'reader' ? withCommittedFeed.bind(null, db) : db.transaction.bind(db)
      )(async (tx: DatabaseClient) => {
        await hold(tx);
        const modes = await tx.all<{ mode: string }>(
          `SELECT mode FROM pg_locks
              WHERE pid = pg_backend_pid() AND relation = 'entity_changes'::regclass`
        );
        for (const { mode } of modes) {
          assert.ok(
            ['AccessShareLock', 'RowExclusiveLock'].includes(mode),
            `${name} holds only ${mode}, which autovacuum does not wait for`
          );
        }
        held.resolve();
        await release.promise;
      });
      await held.promise;
      try {
        await vacuumer.query(`VACUUM ${schema}.entity_changes`);
      } finally {
        release.resolve();
      }
      await holder;
    }

    // The previous reader lock is the conflicting mode: VACUUM cannot get its
    // SHARE UPDATE EXCLUSIVE lock while a SHARE table lock is held.
    const held = deferred();
    const release = deferred();
    const legacy = db.transaction(async tx => {
      await tx.exec('LOCK TABLE entity_changes IN SHARE MODE');
      held.resolve();
      await release.promise;
    });
    await held.promise;
    try {
      await assert.rejects(() => vacuumer.query(`VACUUM ${schema}.entity_changes`), {
        code: '55P03'
      });
    } finally {
      release.resolve();
    }
    await legacy;
  } finally {
    await vacuumer.end();
    await cleanup();
  }
});

test(
  'PostgreSQL account erasure and a writer on the same membership resolve behind a waiting reader',
  { skip },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_erase');
    try {
      await seedServiceOperator({ db, workspaceId: WORKSPACE });
      const member = await db.get<{ id: string; profile_id: string }>(
        `SELECT id, profile_id FROM workspace_users WHERE workspace_id = ? LIMIT 1`,
        [WORKSPACE]
      );
      assert.ok(member);
      const { bindDatabaseClient, currentMaxSeq } = await loadDb();
      await bindDatabaseClient(db);
      const { cascadeDeleteAccount } = await import('./account-deletion.ts');

      // The writer locks the membership row the way a feed insert's foreign
      // key check does, then pauses before its own feed insert.
      const rowLocked = deferred();
      const proceed = deferred();
      const writer = db.transaction(async tx => {
        await tx.get(`SELECT id FROM workspace_users WHERE id = ? FOR KEY SHARE`, [member.id]);
        rowLocked.resolve();
        await proceed.promise;
        await tx.run(
          `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, actor_workspace_user_id, source, occurred_at)
           VALUES (?, ?, 'test', 'erasure-writer', 'update', ?, 'test', now())`,
          [randomUUID(), WORKSPACE, member.id]
        );
      });
      await rowLocked.promise;
      // Erasure takes the shared gate, then waits for the membership row.
      const erasure = cascadeDeleteAccount(member.profile_id);
      await sleep(150);
      // A reader queues for the exclusive gate behind erasure's shared hold.
      const reader = currentMaxSeq(db);
      await sleep(100);
      // The writer's shared request queues behind the reader. PostgreSQL's
      // deadlock check reorders that soft wait instead of aborting anyone.
      proceed.resolve();
      const results = await Promise.allSettled([writer, erasure, reader]);
      for (const result of results) {
        assert.equal(
          result.status,
          'fulfilled',
          result.status === 'rejected' ? String(result.reason) : ''
        );
      }
      const writerRow = await db.get<{ seq: number; actor: string | null }>(
        `SELECT seq, actor_workspace_user_id AS actor FROM entity_changes WHERE entity_id = 'erasure-writer'`
      );
      assert.ok(writerRow);
      assert.equal(
        writerRow.actor,
        null,
        'erasure removed the membership after the writer committed'
      );
      assert.equal(
        await db.get(`SELECT 1 FROM workspace_users WHERE id = ?`, [member.id]),
        undefined
      );
    } finally {
      await cleanup();
    }
  }
);

test(
  'PostgreSQL cursors stay gap-free across legacy, mixed and gated readers under live writes',
  { skip },
  async () => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'ovld_feed_gate_mixed');
    try {
      await seedServiceOperator({ db, workspaceId: WORKSPACE });
      await loadDb();
      // Legacy readers are the pre-gate backend: SHARE table lock, no advisory
      // gate. Gated readers are this release. Writers of either release are
      // gated by the database trigger.
      const read = async (kind: 'legacy' | 'gated', cursor: number) =>
        db.transaction(async tx => {
          await tx.exec("SET LOCAL lock_timeout = '2s'");
          if (kind === 'legacy') await tx.exec('LOCK TABLE entity_changes IN SHARE MODE');
          else await tx.get('SELECT entity_changes_feed_read_gate()');
          const high = await tx.get<{ seq: number | null }>(
            `SELECT MAX(seq) AS seq FROM entity_changes`
          );
          const highWater = Math.max(cursor, Number(high?.seq ?? 0));
          const rows = await tx.all<{ seq: number }>(
            `SELECT seq FROM entity_changes WHERE seq > ? AND seq <= ? ORDER BY seq`,
            [cursor, highWater]
          );
          return { highWater, seqs: rows.map(row => Number(row.seq)) };
        });
      const stages: Array<Array<'legacy' | 'gated'>> = [
        ['legacy', 'legacy'], // migration applied, old backends only
        ['legacy', 'gated'], // rolling deploy or reader rollback in progress
        ['gated', 'gated'] // every backend switched
      ];
      for (const readers of stages) {
        let writing = true;
        const writers = Array.from({ length: 4 }, async (_, writerIndex) => {
          let n = 0;
          while (writing) {
            await db
              .transaction(async tx => {
                await tx.run(insertSql(`w${writerIndex}-${n}`, 1 + (n % 3)));
                await sleep(Math.floor(Math.random() * 15));
                if (n % 7 === 3) throw new Error('rollback');
              })
              .catch(() => undefined);
            n++;
          }
        });
        const startCursor = await read('gated', 0).then(result => result.highWater);
        const observed = readers.map(() => new Set<number>());
        const cursors = readers.map(() => startCursor);
        const readLoops = readers.map(async (kind, index) => {
          const deadline = Date.now() + 1_500;
          while (Date.now() < deadline) {
            const result = await read(kind, cursors[index]!);
            for (const seq of result.seqs) observed[index]!.add(seq);
            cursors[index] = result.highWater;
            await sleep(5);
          }
        });
        await Promise.all(readLoops);
        writing = false;
        await Promise.all(writers);
        for (const [index, kind] of readers.entries()) {
          const result = await read(kind, cursors[index]!);
          for (const seq of result.seqs) observed[index]!.add(seq);
        }
        const committed = await db.all<{ seq: number }>(
          `SELECT seq FROM entity_changes WHERE seq > ? ORDER BY seq`,
          [startCursor]
        );
        assert.ok(committed.length > 20, 'the stage ran under live writes');
        for (const [index, kind] of readers.entries()) {
          const missing = committed
            .map(row => Number(row.seq))
            .filter(seq => !observed[index]!.has(seq));
          assert.deepEqual(missing, [], `${readers.join('+')} stage: ${kind} reader skipped none`);
        }
      }
    } finally {
      await cleanup();
    }
  }
);
