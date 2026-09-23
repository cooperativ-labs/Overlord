import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * `human_action_resolutions.outcome` / `outcome_ref` (coo:1045, contract v147)
 * record which promotion a deferred-work item received. Both are additive and
 * nullable: existing resolutions survive with nulls, the outcome set is closed,
 * and a blank reference is refused.
 */

const baseMigration = readFileSync(
  new URL('../sqlite/migrations/20260907150000_human_action_resolutions.sql', import.meta.url),
  'utf8'
);
const sqliteMigration = readFileSync(
  new URL(
    '../sqlite/migrations/20260923090000_human_action_resolution_outcome.sql',
    import.meta.url
  ),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL(
    '../postgres/migrations/20260923090000_human_action_resolution_outcome.sql',
    import.meta.url
  ),
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
    INSERT INTO deliveries (id) VALUES ('d1');
  `);
  db.exec(baseMigration);
  db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status, resolved_at)
     VALUES ('d1', 'existing', 'w1', 'm1', 'o1', 'done', '2026-09-07T10:00:00.000Z')`
  ).run();
  db.exec(sqliteMigration);
  return db;
}

function insert(
  db: ReturnType<typeof createDatabase>,
  actionId: string,
  outcome: string | null,
  outcomeRef: string | null
) {
  db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status,
        outcome, outcome_ref, resolved_at)
     VALUES ('d1', ?, 'w1', 'm1', 'o1', 'done', ?, ?, '2026-09-23T10:00:00.000Z')`
  ).run(actionId, outcome, outcomeRef);
}

test('existing resolutions keep a null outcome', () => {
  const db = createDatabase();
  const row = db
    .prepare(`SELECT outcome, outcome_ref FROM human_action_resolutions WHERE action_id = ?`)
    .get('existing') as { outcome: string | null; outcome_ref: string | null };
  assert.deepEqual({ ...row }, { outcome: null, outcome_ref: null });
});

test('outcome is closed to the two promotions and a reference cannot be blank', () => {
  const db = createDatabase();
  insert(db, 'a', 'mission_created', 'coo:12');
  insert(db, 'b', 'objective_added', null);
  assert.throws(() => insert(db, 'c', 'shipped', null));
  assert.throws(() => insert(db, 'd', 'mission_created', '   '));
});

test('the Postgres migration declares the same columns', () => {
  assert.match(postgresMigration, /ADD COLUMN IF NOT EXISTS outcome text/);
  assert.match(postgresMigration, /outcome IN \('mission_created', 'objective_added'\)/);
  assert.match(postgresMigration, /ADD COLUMN IF NOT EXISTS outcome_ref text/);
});
