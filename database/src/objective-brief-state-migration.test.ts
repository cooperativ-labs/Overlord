import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { migrateDatabase, type OverlordDatabase } from './connection.js';

/**
 * Objective brief state (coo:1275, ADR 0057), SQLite half. Driven through the
 * real runner on an upgraded database: every existing row keeps its data, new
 * columns default to "no summary, unknown title provenance", and current
 * instruction authorship is backfilled only where creation provenance still
 * describes the current instructions. The Postgres half is
 * `objective-brief-state.postgres-conformance.test.ts`.
 */

const VERSION = '20261114180000';
const now = '2026-11-14T00:00:00.000Z';

function openAt(stopBeforeVersion?: string): OverlordDatabase {
  const db = new (loadBetterSqlite3())(':memory:');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db, stopBeforeVersion ? { stopBeforeVersion } : {});
  return db;
}

/** id, created_by_kind, instruction, deleted, instruction edited later */
const BRIEF_MIGRATION_ROWS: Array<[string, string, string, boolean, boolean]> = [
  ['agent-unedited', 'agent', 'Agent text', false, false],
  ['agent-edited', 'agent', 'Agent text, edited later', false, true],
  ['human-unedited', 'human', 'Human text', false, false],
  ['automation-unedited', 'automation', 'Scheduled text', false, false],
  ['agent-blank', 'agent', '   ', false, false],
  ['agent-deleted', 'agent', 'Deleted text', true, false]
];

function seed(db: OverlordDatabase) {
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
       instruction_text, state, created_by_kind, created_at, updated_at, deleted_at, revision)
     VALUES (?, 'w', 'p', 'm', ?, ?, 'Custom title', ?, 'draft', ?, ?, ?, ?, 2)`
  );
  const change = db.prepare(
    `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, changed_fields_json, source, occurred_at)
     VALUES (?, 'w', 'objective', ?, 'update', ?, 'api', ?)`
  );
  BRIEF_MIGRATION_ROWS.forEach(([id, kind, text, deleted, edited], index) => {
    insert.run(id, `k${index}`, index, text, kind, now, now, deleted ? now : null);
    // A title-only edit never disproves instruction authorship.
    change.run(`c-title-${id}`, id, '["title"]', now);
    if (edited) change.run(`c-text-${id}`, id, '["instruction_text","title"]', now);
  });
}

test('adds brief state with conservative defaults and backfills provable authorship', () => {
  const db = openAt(VERSION);
  seed(db);
  const before = db
    .prepare('SELECT id, title, instruction_text, revision, updated_at FROM objectives ORDER BY id')
    .all();

  migrateDatabase(db);

  assert.deepEqual(
    db
      .prepare(
        'SELECT id, title, instruction_text, revision, updated_at FROM objectives ORDER BY id'
      )
      .all(),
    before,
    'existing data, revisions and activity timestamps are unchanged'
  );
  const rows = db
    .prepare(
      `SELECT id, title_source, title_generation, title_status, description, description_source,
              description_revision, description_suppressed, description_generation, description_status,
              description_request_kind, instruction_author_kind
         FROM objectives ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>;
  const author = Object.fromEntries(rows.map(r => [r.id, r.instruction_author_kind]));
  assert.deepEqual(author, {
    'agent-blank': null,
    'agent-deleted': null,
    'agent-edited': null,
    'agent-unedited': 'agent',
    'automation-unedited': 'automation',
    'human-unedited': 'human'
  });
  for (const row of rows) {
    assert.equal(row.title_source, null, 'legacy title provenance stays unknown (protected)');
    assert.equal(row.description, null);
    assert.equal(row.description_source, null);
    assert.equal(row.description_suppressed, 0);
    assert.equal(row.description_status, null);
    assert.equal(row.description_request_kind, null);
    assert.equal(row.title_generation, 0);
    assert.equal(row.description_generation, 0);
    assert.equal(row.description_revision, 0);
  }
  assert.ok(db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(VERSION));
});

test('enforces the closed brief vocabularies', () => {
  const db = openAt();
  seed(db);
  const bad: Array<[string, unknown]> = [
    ['title_source', 'model'],
    ['title_status', 'running'],
    ['description_source', 'person'],
    ['description_status', 'ready'],
    ['description_request_kind', 'manual'],
    ['instruction_author_kind', 'assistant'],
    ['description_suppressed', 2],
    ['description_generation', -1],
    ['description_updated_at', '2026-11-14']
  ];
  for (const [column, value] of bad) {
    assert.throws(
      () =>
        db.prepare(`UPDATE objectives SET ${column} = ? WHERE id = 'agent-unedited'`).run(value),
      /CHECK constraint failed/,
      column
    );
  }
  db.prepare(
    `UPDATE objectives SET title_source = 'agent', description = 'S', description_source = 'user',
       description_status = 'failed', description_request_kind = 'explicit',
       description_suppressed = 1, description_updated_at = ? WHERE id = 'agent-unedited'`
  ).run(now);
  const fk = db.pragma('foreign_key_check');
  assert.deepEqual(fk, []);
});
