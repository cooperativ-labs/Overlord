import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

const sqliteMigration = readFileSync(
  new URL('../sqlite/migrations/20260822120000_changed_files_objective_path.sql', import.meta.url),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL(
    '../postgres/migrations/20260822120000_changed_files_objective_path.sql',
    import.meta.url
  ),
  'utf8'
);

test('SQLite objective/path migration deduplicates rows and repoints rationales', () => {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE changed_files (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      session_id TEXT,
      resource_id TEXT,
      file_path TEXT NOT NULL,
      vcs_status TEXT,
      current_diff_state TEXT NOT NULL,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      last_observed_event_id TEXT,
      observed_metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_changed_files_active_session_objective_path
      ON changed_files (session_id, objective_id, file_path)
      WHERE session_id IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE change_rationales (
      id TEXT PRIMARY KEY,
      changed_file_id TEXT REFERENCES changed_files (id) ON DELETE SET NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO changed_files
       (id, objective_id, session_id, resource_id, file_path, vcs_status, current_diff_state,
        first_observed_at, last_observed_at, last_observed_event_id, observed_metadata_json,
        created_at, updated_at, deleted_at, revision)
     VALUES (?, 'objective-1', ?, ?, 'src/a.ts', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  insert.run(
    'older',
    'session-1',
    'resource-1',
    'M',
    'present',
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T01:00:00.000Z',
    'event-1',
    JSON.stringify({ source: 'declared_edit', quality: 'direct', syncKeys: ['direct-key'] }),
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T01:00:00.000Z',
    2
  );
  insert.run(
    'newer',
    'session-2',
    'resource-2',
    null,
    'unknown',
    '2026-08-21T00:00:00.000Z',
    '2026-08-21T01:00:00.000Z',
    'event-2',
    JSON.stringify({ source: 'retired_source', syncKeys: ['retired-key'] }),
    '2026-08-21T00:00:00.000Z',
    '2026-08-21T01:00:00.000Z',
    4
  );
  db.prepare(
    `INSERT INTO change_rationales (id, changed_file_id) VALUES ('rationale', 'newer')`
  ).run();

  db.exec(sqliteMigration);

  const rows = db.prepare(`SELECT * FROM changed_files`).all() as Array<{
    id: string;
    session_id: string | null;
    resource_id: string | null;
    current_diff_state: string;
    first_observed_at: string;
    last_observed_at: string;
    observed_metadata_json: string;
    revision: number;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 'older');
  assert.equal(rows[0]?.session_id, 'session-2');
  assert.equal(rows[0]?.resource_id, 'resource-2');
  assert.equal(rows[0]?.current_diff_state, 'unknown');
  assert.equal(rows[0]?.first_observed_at, '2026-08-20T00:00:00.000Z');
  assert.equal(rows[0]?.last_observed_at, '2026-08-21T01:00:00.000Z');
  assert.equal(JSON.parse(rows[0]?.observed_metadata_json ?? '{}').source, 'declared_edit');
  assert.equal(rows[0]?.revision, 5);
  assert.equal(
    (
      db.prepare(`SELECT changed_file_id FROM change_rationales`).get() as {
        changed_file_id: string;
      }
    ).changed_file_id,
    'older'
  );
  assert.throws(() =>
    insert.run(
      'duplicate',
      'session-3',
      'resource-3',
      'M',
      'present',
      '2026-08-22T00:00:00.000Z',
      '2026-08-22T00:00:00.000Z',
      'event-3',
      '{}',
      '2026-08-22T00:00:00.000Z',
      '2026-08-22T00:00:00.000Z',
      1
    )
  );
  db.close();
});

test('Postgres migration performs the same ordered repoint/delete/index sequence', () => {
  assert.match(postgresMigration, /BEGIN;/);
  assert.match(postgresMigration, /observed_metadata_json ->> 'source' = 'declared_edit'/);
  assert.match(
    postgresMigration,
    /ORDER BY evidence_strength DESC, last_observed_at DESC, updated_at DESC, id DESC/
  );
  assert.match(postgresMigration, /session_id = latest\.session_id/);
  assert.match(postgresMigration, /UPDATE change_rationales[\s\S]+SET changed_file_id/);
  assert.match(postgresMigration, /DELETE FROM changed_files/);
  assert.match(
    postgresMigration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_changed_files_active_objective_path/
  );
  assert.ok(
    postgresMigration.indexOf('UPDATE change_rationales') <
      postgresMigration.indexOf('DELETE FROM changed_files')
  );
});
