import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { migrateDatabase, type OverlordDatabase } from './connection.js';

/**
 * `future` is retired from `objectives.state` (coo:1274, ADR 0056). The SQLite
 * migration rebuilds `objectives`; these tests drive it through the real
 * runner on an upgraded database and pin that every row and its evidence
 * survives, only the state CHECK changes, and foreign keys stay enforced.
 */

const VERSION = '20261114120000';
const FILE = `${VERSION}_unify_draft_future_objectives.sql`;
const now = '2026-11-14T00:00:00.000Z';

type Db = OverlordDatabase;

function openAt(stopBeforeVersion?: string): Db {
  const db = new (loadBetterSqlite3())(':memory:');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db, stopBeforeVersion ? { stopBeforeVersion } : {});
  return db;
}

function seed(db: Db) {
  db.exec(`
    INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', '${now}', '${now}');
    INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
      VALUES ('w', 'org', 'w', 'W', 'local', '${now}', '${now}');
    INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
      VALUES ('p', 'w', 'p', 'P', 'active', '${now}', '${now}');
    INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, created_at, updated_at)
      VALUES ('s', 'w', 'p', 'draft', 'Draft', 'draft', 0, 1, 0, '${now}', '${now}');
    INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at)
      VALUES ('m', 'w', 'p', 'w:1', 1, 'M', 's', 'draft', '${now}', '${now}');
  `);
  const insert = db.prepare(
    `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position, title,
       instruction_text, state, assigned_agent, launch_config_json, resource_key, created_at, updated_at, deleted_at, revision)
     VALUES (?, 'w', 'p', 'm', ?, ?, ?, ?, ?, 'claude', ?, ?, ?, ?, ?, ?)`
  );
  insert.run('done', 'aaaa', 0, 'Done', 'did it', 'complete', null, null, now, now, null, 3);
  insert.run('draft', 'bbbb', 1, 'Draft', 'next', 'draft', null, null, now, now, null, 1);
  insert.run(
    'future',
    'cccc',
    2,
    'Future',
    'later',
    'future',
    '{"x":1}',
    'mobile',
    now,
    now,
    null,
    2
  );
  insert.run('blank', 'dddd', 3, null, '', 'future', null, null, now, now, null, 1);
  insert.run('gone', 'eeee', 4, 'Gone', 'deleted', 'future', null, null, now, now, now, 5);
  db.exec(`
    INSERT INTO run_queues (id, project_id, workspace_id, name, position, created_at, updated_at)
      VALUES ('q', 'p', 'w', 'Q', 0, '${now}', '${now}');
    INSERT INTO run_queue_entries (id, queue_id, project_id, workspace_id, mission_id, objective_id, position, state, enqueued_at, created_at, updated_at)
      VALUES ('e', 'q', 'p', 'w', 'm', 'future', 1, 'waiting', '${now}', '${now}', '${now}');
    INSERT INTO objective_attachments (id, workspace_id, mission_id, objective_id, storage_backend, storage_key, filename, upload_status, metadata_json, created_at, updated_at)
      VALUES ('file', 'w', 'm', 'blank', 'local_fs', 'synthetic/file', 'evidence.txt', 'available', '{}', '${now}', '${now}');
    INSERT INTO mission_events (id, workspace_id, project_id, mission_id, objective_id, type, summary, payload_json, source, created_at)
      VALUES ('event', 'w', 'p', 'm', 'blank', 'update', 'Historical evidence', '{"state":"future"}', 'test', '${now}');
  `);
}

function objectivesSchema(db: Db) {
  return db
    .prepare(
      `SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = 'objectives' AND sql IS NOT NULL ORDER BY type, name`
    )
    .all() as Array<{ type: string; name: string; sql: string }>;
}

test('upgrade converts every future row to draft and preserves rows, evidence and queue entries', () => {
  const db = openAt(VERSION);
  seed(db);
  const before = objectivesSchema(db);
  const childCountsBefore = db.prepare(`SELECT COUNT(*) AS n FROM run_queue_entries`).get();
  const evidence = () =>
    ['objective_attachments', 'mission_events'].map(table =>
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    );
  const evidenceBefore = evidence();

  migrateDatabase(db);

  assert.deepEqual(evidence(), evidenceBefore);

  const rows = db
    .prepare(
      `SELECT id, position, state, instruction_text, launch_config_json, resource_key, deleted_at, revision
         FROM objectives ORDER BY position`
    )
    .all();
  assert.deepEqual(rows, [
    {
      id: 'done',
      position: 0,
      state: 'complete',
      instruction_text: 'did it',
      launch_config_json: null,
      resource_key: null,
      deleted_at: null,
      revision: 3
    },
    {
      id: 'draft',
      position: 1,
      state: 'draft',
      instruction_text: 'next',
      launch_config_json: null,
      resource_key: null,
      deleted_at: null,
      revision: 1
    },
    {
      id: 'future',
      position: 2,
      state: 'draft',
      instruction_text: 'later',
      launch_config_json: '{"x":1}',
      resource_key: 'mobile',
      deleted_at: null,
      revision: 3
    },
    {
      id: 'blank',
      position: 3,
      state: 'draft',
      instruction_text: '',
      launch_config_json: null,
      resource_key: null,
      deleted_at: null,
      revision: 2
    },
    {
      id: 'gone',
      position: 4,
      state: 'draft',
      instruction_text: 'deleted',
      launch_config_json: null,
      resource_key: null,
      deleted_at: now,
      revision: 6
    }
  ]);
  const updatedAt = db.prepare(`SELECT updated_at FROM objectives WHERE id = 'future'`).get() as {
    updated_at: string;
  };
  assert.notEqual(updatedAt.updated_at, now);
  assert.match(updatedAt.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  assert.deepEqual(
    db.prepare(`SELECT COUNT(*) AS n FROM run_queue_entries`).get(),
    childCountsBefore
  );
  assert.deepEqual(
    db.prepare(`SELECT objective_id, position, state FROM run_queue_entries`).get(),
    { objective_id: 'future', position: 1, state: 'waiting' }
  );

  // Only the state CHECK differs between the before and after schema.
  const after = objectivesSchema(db);
  const normalize = (entries: typeof before) =>
    entries.map(entry => ({
      ...entry,
      sql: entry.sql
        .replace(/'future', /g, '')
        .replace(/\s+/g, ' ')
        .replace(/"?objectives_v172"?/g, 'objectives')
        .trim()
    }));
  assert.deepEqual(
    normalize(after).map(entry => [entry.type, entry.name]),
    normalize(before).map(entry => [entry.type, entry.name])
  );
  const tableSql = (entries: typeof before) =>
    normalize(entries)
      .find(entry => entry.type === 'table')!
      .sql.replace(/^CREATE TABLE "?objectives"? /, '');
  assert.equal(tableSql(after), tableSql(before));

  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(
    (
      db.prepare(`SELECT checksum FROM schema_migrations WHERE version = ?`).get(VERSION) as
        | {
            checksum: string;
          }
        | undefined
    )?.checksum.length !== undefined,
    true
  );
});

test('the new CHECK rejects future and foreign keys stay enforced on the rebuilt table', () => {
  const db = openAt(VERSION);
  seed(db);
  migrateDatabase(db);
  assert.throws(
    () => db.prepare(`UPDATE objectives SET state = 'future' WHERE id = 'draft'`).run(),
    /CHECK constraint failed/
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position, state, created_at, updated_at)
           VALUES ('orphan', 'w', 'p', 'missing', 'zzzz', 9, 'draft', ?, ?)`
        )
        .run(now, now),
    /FOREIGN KEY constraint failed/
  );
  // Child foreign keys resolve to the rebuilt table: the Run Queue entry's
  // ON DELETE CASCADE fires against it.
  db.prepare(`DELETE FROM objectives WHERE id = 'future'`).run();
  assert.deepEqual(db.prepare(`SELECT COUNT(*) AS n FROM run_queue_entries`).get(), { n: 0 });
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('a fresh database closes the vocabulary too', () => {
  // The seed writes `future` rows, so it only succeeds before this migration.
  const db = openAt();
  assert.throws(() => seed(db), /CHECK constraint failed/);
});

test('a failed rebuild rolls back and restores foreign-key enforcement before retry', () => {
  const db = openAt(VERSION);
  try {
    seed(db);
    const before = db.prepare('SELECT * FROM objectives ORDER BY id').all();
    db.exec('CREATE TABLE objectives_v172 (id TEXT)');
    assert.throws(() => migrateDatabase(db), /already exists/);
    assert.equal(db.inTransaction, false);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.prepare('SELECT * FROM objectives ORDER BY id').all(), before);
    assert.equal(
      db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(VERSION),
      undefined
    );
    db.exec('DROP TABLE objectives_v172');
    migrateDatabase(db);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('the Postgres dialect flips future rows before replacing the named state CHECK', () => {
  const sql = readFileSync(new URL(`../postgres/migrations/${FILE}`, import.meta.url), 'utf8');
  const flip = sql.indexOf(`WHERE state = 'future'`);
  const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS objectives_state_check');
  const add = sql.indexOf('ADD CONSTRAINT objectives_state_check');
  assert.ok(flip > 0 && drop > flip && add > drop);
  assert.match(sql, /revision = revision \+ 1/);
  assert.doesNotMatch(sql, /deleted_at IS NULL/, 'soft-deleted rows convert too');
  assert.doesNotMatch(sql.slice(add), /'future'/);
  assert.doesNotMatch(sql, /DELETE FROM/);
});
