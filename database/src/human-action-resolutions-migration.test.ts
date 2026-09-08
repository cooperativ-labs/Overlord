import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * `human_action_resolutions` (coo:963, contract v136) layers operator decisions
 * over the human actions in a delivery report. The action text never lives here,
 * so the table's promises are structural: one row per (delivery, action id), a
 * closed status set, canonical UTC timestamps, and rows that disappear with
 * their delivery.
 */

const sqliteMigration = readFileSync(
  new URL('../sqlite/migrations/20260907150000_human_action_resolutions.sql', import.meta.url),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL('../postgres/migrations/20260907150000_human_action_resolutions.sql', import.meta.url),
  'utf8'
);

function createDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE missions (id TEXT PRIMARY KEY);
    CREATE TABLE objectives (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_users (id TEXT PRIMARY KEY);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY);
    INSERT INTO workspaces (id) VALUES ('w1');
    INSERT INTO missions (id) VALUES ('m1');
    INSERT INTO objectives (id) VALUES ('o1');
    INSERT INTO workspace_users (id) VALUES ('wu1');
    INSERT INTO deliveries (id) VALUES ('d1');
  `);
  db.exec(sqliteMigration);
  return db;
}

function insert(
  db: ReturnType<typeof createDatabase>,
  actionId: string,
  status: string,
  at: string
) {
  db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status,
        resolved_by_workspace_user_id, resolved_at)
     VALUES ('d1', ?, 'w1', 'm1', 'o1', ?, 'wu1', ?)`
  ).run(actionId, status, at);
}

test('one resolution per delivery and action id', () => {
  const db = createDatabase();
  insert(db, 'human-action-1', 'done', '2026-09-07T10:00:00.000Z');
  assert.throws(() => insert(db, 'human-action-1', 'dismissed', '2026-09-07T11:00:00.000Z'));
  insert(db, 'human-action-2', 'dismissed', '2026-09-07T11:00:00.000Z');
  const count = db.prepare(`SELECT COUNT(*) AS n FROM human_action_resolutions`).get() as {
    n: number;
  };
  assert.equal(count.n, 2);
});

test('status is closed to done and dismissed, and timestamps must be canonical UTC', () => {
  const db = createDatabase();
  assert.throws(() => insert(db, 'human-action-1', 'open', '2026-09-07T10:00:00.000Z'));
  assert.throws(() => insert(db, 'human-action-1', 'done', '2026-09-07 10:00:00'));
  assert.throws(() => insert(db, '   ', 'done', '2026-09-07T10:00:00.000Z'));
});

test('rows cascade with their delivery', () => {
  const db = createDatabase();
  insert(db, 'human-action-1', 'done', '2026-09-07T10:00:00.000Z');
  db.prepare(`DELETE FROM deliveries WHERE id = 'd1'`).run();
  const count = db.prepare(`SELECT COUNT(*) AS n FROM human_action_resolutions`).get() as {
    n: number;
  };
  assert.equal(count.n, 0);
});

test('the Postgres migration declares the same shape', () => {
  assert.match(postgresMigration, /CREATE TABLE IF NOT EXISTS human_action_resolutions/);
  assert.match(postgresMigration, /PRIMARY KEY \(delivery_id, action_id\)/);
  assert.match(postgresMigration, /status IN \('done', 'dismissed'\)/);
  assert.match(postgresMigration, /REFERENCES deliveries \(id\) ON DELETE CASCADE/);
  assert.match(postgresMigration, /idx_human_action_resolutions_workspace_resolved/);
});
