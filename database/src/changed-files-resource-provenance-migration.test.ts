import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

const MIGRATION = '20261024120000_changed_files_resource_provenance.sql';
const sqliteDir = new URL('../sqlite/migrations/', import.meta.url);
const postgresMigration = readFileSync(
  new URL(`../postgres/migrations/${MIGRATION}`, import.meta.url),
  'utf8'
);

/** Stand-in for the pre-cutover shape: only the tables the migration touches. */
function createPreviousSchemaDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE missions (id TEXT PRIMARY KEY);
    CREATE TABLE objectives (id TEXT PRIMARY KEY);
    CREATE TABLE project_resources (id TEXT PRIMARY KEY);
    CREATE TABLE mission_events (id TEXT PRIMARY KEY);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY);
    CREATE TABLE entity_changes (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL);
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE changed_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces (id),
      project_id TEXT NOT NULL REFERENCES projects (id),
      mission_id TEXT NOT NULL REFERENCES missions (id),
      objective_id TEXT NOT NULL REFERENCES objectives (id),
      session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
      resource_id TEXT REFERENCES project_resources (id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      vcs_status TEXT,
      current_diff_state TEXT NOT NULL CHECK (current_diff_state IN ('present', 'resolved', 'unknown', 'unavailable')),
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      last_observed_event_id TEXT REFERENCES mission_events (id) ON DELETE SET NULL,
      observed_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(observed_metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_changed_files_active_objective_path
      ON changed_files (objective_id, file_path)
      WHERE objective_id IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE change_rationales (
      id TEXT PRIMARY KEY,
      changed_file_id TEXT REFERENCES changed_files (id) ON DELETE SET NULL
    );
    INSERT INTO workspaces VALUES ('w1');
    INSERT INTO projects VALUES ('p1');
    INSERT INTO missions VALUES ('m1');
    INSERT INTO objectives VALUES ('o1');
    INSERT INTO project_resources VALUES ('r1'), ('r2');
    INSERT INTO agent_sessions VALUES ('s1');
    INSERT INTO entity_changes VALUES ('e1', 'change_rationale'), ('e2', 'changed_file');
  `);
  return db;
}

function seedMission() {
  return { workspaceId: 'w1', stamp: '2026-10-01T00:00:00.000Z' };
}

function insertLegacyFile(
  db: ReturnType<typeof createPreviousSchemaDatabase>,
  seed: { workspaceId: string; stamp: string },
  row: { id: string; path: string; sessionId: string | null; metadata: Record<string, unknown> }
) {
  db.prepare(
    `INSERT INTO changed_files
       (id, workspace_id, project_id, mission_id, objective_id, session_id, resource_id, file_path,
        vcs_status, current_diff_state, first_observed_at, last_observed_at,
        observed_metadata_json, created_at, updated_at)
     VALUES (?, ?, 'p1', 'm1', 'o1', ?, NULL, ?, 'M', 'unknown', ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    seed.workspaceId,
    row.sessionId,
    row.path,
    seed.stamp,
    seed.stamp,
    JSON.stringify(row.metadata),
    seed.stamp,
    seed.stamp
  );
}

test('SQLite cutover preserves paths, maps only reliable provenance, and drops retired storage', () => {
  const db = createPreviousSchemaDatabase();
  const seed = seedMission();
  const direct = { source: 'declared_edit', quality: 'direct', overlap: false };
  insertLegacyFile(db, seed, {
    id: 'native',
    path: 'a.ts',
    sessionId: 's1',
    metadata: { ...direct, hookHealth: 'direct_path_observed', syncKeys: ['k1', 'k2'] }
  });
  insertLegacyFile(db, seed, {
    id: 'declared',
    path: 'b.ts',
    sessionId: 's1',
    metadata: { ...direct, hookHealth: 'agent_declared_generator_output', syncKeys: ['k3'] }
  });
  insertLegacyFile(db, seed, {
    id: 'merged',
    path: 'c.ts',
    sessionId: 's1',
    metadata: { ...direct, hookHealth: 'agent_declared_generator_output', syncKeys: ['k4', 'k5'] }
  });
  insertLegacyFile(db, seed, {
    id: 'window',
    path: 'd.ts',
    sessionId: 's1',
    metadata: { source: 'window_observed', quality: 'window', overlap: true, syncKeys: ['k6'] }
  });
  insertLegacyFile(db, seed, { id: 'record', path: 'e.ts', sessionId: null, metadata: {} });

  db.exec(readFileSync(new URL(MIGRATION, sqliteDir), 'utf8'));

  const rows = db
    .prepare(
      `SELECT id, file_path, source, hook_health, sync_keys_json FROM changed_files ORDER BY id`
    )
    .all() as Array<{
    id: string;
    file_path: string;
    source: string | null;
    hook_health: string | null;
    sync_keys_json: string;
  }>;
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  assert.equal(rows.length, 5);
  assert.equal(byId.native?.source, 'declared_edit');
  assert.equal(byId.declared?.source, 'agent_declared');
  assert.equal(byId.merged?.source, null);
  assert.equal(byId.window?.source, null);
  assert.equal(byId.window?.hook_health, null);
  assert.equal(byId.record?.source, 'agent_declared');
  assert.deepEqual(JSON.parse(byId.native?.sync_keys_json ?? '[]'), ['k1', 'k2']);
  assert.equal(byId.native?.hook_health, 'direct_path_observed');

  const columns = (
    db.prepare(`PRAGMA table_info(changed_files)`).all() as Array<{ name: string }>
  ).map(column => column.name);
  for (const retired of ['vcs_status', 'current_diff_state', 'observed_metadata_json']) {
    assert.ok(!columns.includes(retired), `${retired} is removed`);
  }
  assert.equal(
    db.prepare(`SELECT name FROM sqlite_master WHERE name = 'change_rationales'`).get(),
    undefined
  );
  const session = (
    db.prepare(`PRAGMA table_info(agent_sessions)`).all() as Array<{ name: string }>
  ).map(column => column.name);
  for (const added of [
    'capture_binding_state',
    'capture_callback_observed_at',
    'capture_health_json'
  ]) {
    assert.ok(session.includes(added), `${added} exists`);
  }
});

test('resource-aware identity lets the same path coexist across resources only', () => {
  const db = createPreviousSchemaDatabase();
  const seed = seedMission();
  db.exec(readFileSync(new URL(MIGRATION, sqliteDir), 'utf8'));
  const insert = db.prepare(
    `INSERT INTO changed_files
       (id, workspace_id, project_id, mission_id, objective_id, resource_id, file_path,
        first_observed_at, last_observed_at, created_at, updated_at)
     VALUES (?, ?, 'p1', 'm1', 'o1', ?, 'src/x.ts', ?, ?, ?, ?)`
  );
  const add = (id: string, resource: string | null) =>
    insert.run(id, seed.workspaceId, resource, seed.stamp, seed.stamp, seed.stamp, seed.stamp);
  add('one', 'r1');
  add('two', 'r2');
  add('three', null);
  assert.throws(() => add('dupe', 'r1'), /UNIQUE/);
  assert.throws(() => add('dupe-null', null), /UNIQUE/);
});

test('PostgreSQL cutover mirrors the SQLite storage changes', () => {
  assert.match(postgresMigration, /DROP TABLE change_rationales/);
  assert.match(postgresMigration, /DROP COLUMN vcs_status/);
  assert.match(postgresMigration, /\(COALESCE\(resource_id, ''\)\)/);
  assert.match(postgresMigration, /capture_binding_state/);
});
