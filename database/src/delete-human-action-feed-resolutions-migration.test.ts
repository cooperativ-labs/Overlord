import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * Removing the Human Actions feed (coo:1098, contract v150) deletes the stored
 * resolutions of reported human actions, which no surface can show or change
 * any more, while keeping deferred-work resolutions for the delivery card.
 */

const baseMigration = readFileSync(
  new URL('../sqlite/migrations/20260907150000_human_action_resolutions.sql', import.meta.url),
  'utf8'
);
const sqliteMigration = readFileSync(
  new URL(
    '../sqlite/migrations/20260928090000_delete_human_action_feed_resolutions.sql',
    import.meta.url
  ),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL(
    '../postgres/migrations/20260928090000_delete_human_action_feed_resolutions.sql',
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
  const insert = db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status, resolved_at)
     VALUES ('d1', ?, 'w1', 'm1', 'o1', 'done', '2026-09-07T10:00:00.000Z')`
  );
  insert.run('human-action-1');
  insert.run('deterministic-rule-2');
  insert.run('deferred-work-0-0123456789abcdef');
  insert.run('deferred-work-1-composed');
  insert.run('deferred-work-0123456789abcdef-1');
  db.exec(sqliteMigration);
  return db;
}

test('human-action resolutions are deleted and deferred-work resolutions survive', () => {
  const db = createDatabase();
  const rows = db
    .prepare(`SELECT action_id FROM human_action_resolutions ORDER BY action_id`)
    .all() as Array<{ action_id: string }>;
  assert.deepEqual(
    rows.map(row => row.action_id),
    [
      'deferred-work-0-0123456789abcdef',
      'deferred-work-0123456789abcdef-1',
      'deferred-work-1-composed'
    ]
  );
});

test('the Postgres migration deletes the same rows', () => {
  assert.match(
    postgresMigration,
    /DELETE FROM human_action_resolutions WHERE action_id NOT LIKE 'deferred-work-%'/
  );
});
