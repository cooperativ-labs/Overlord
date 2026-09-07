import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * `objectives.reopened_at` (coo:879, contract v133) is the run boundary the
 * mission panel splits evidence on. The column is additive and nullable, so
 * this pins the two things the migration promises: existing rows survive with
 * a null boundary, and the SQLite CHECK only admits the canonical UTC shape
 * every other objective timestamp uses.
 */

const sqliteMigration = readFileSync(
  new URL('../sqlite/migrations/20260907120000_objective_reopened_at.sql', import.meta.url),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL('../postgres/migrations/20260907120000_objective_reopened_at.sql', import.meta.url),
  'utf8'
);

function createDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`
    CREATE TABLE objectives (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO objectives (id, state, completed_at, updated_at)
      VALUES ('o1', 'complete', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  `);
  return db;
}

test('adds a nullable reopened_at column and leaves existing rows null', () => {
  const db = createDatabase();
  db.exec(sqliteMigration);

  const columns = db.prepare(`PRAGMA table_info(objectives)`).all() as Array<{
    name: string;
    notnull: number;
  }>;
  const column = columns.find(entry => entry.name === 'reopened_at');
  assert.ok(column, 'reopened_at column exists');
  assert.equal(column!.notnull, 0);

  const row = db
    .prepare(`SELECT reopened_at, completed_at FROM objectives WHERE id = 'o1'`)
    .get() as {
    reopened_at: string | null;
    completed_at: string | null;
  };
  assert.equal(row.reopened_at, null);
  assert.equal(row.completed_at, '2026-09-01T10:00:00.000Z');
});

test('accepts canonical UTC timestamps and rejects anything else', () => {
  const db = createDatabase();
  db.exec(sqliteMigration);

  db.prepare(`UPDATE objectives SET reopened_at = ? WHERE id = 'o1'`).run(
    '2026-09-07T12:00:00.000Z'
  );
  assert.throws(
    () => db.prepare(`UPDATE objectives SET reopened_at = ? WHERE id = 'o1'`).run('2026-09-07'),
    /CHECK constraint failed/
  );
  db.prepare(`UPDATE objectives SET reopened_at = NULL WHERE id = 'o1'`).run();
});

test('the Postgres dialect adds the same nullable column idempotently', () => {
  assert.match(
    postgresMigration,
    /ALTER TABLE objectives ADD COLUMN IF NOT EXISTS reopened_at timestamptz;/
  );
  assert.doesNotMatch(postgresMigration, /NOT NULL/);
});
