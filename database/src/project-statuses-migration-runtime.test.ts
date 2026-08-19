import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { finalizeProjectStatusesSqlite } from './project-statuses-migration-runtime.js';

function legacyDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(path.resolve('sqlite/migrations'))
    .filter(file => file < '20260819090000_project_scoped_mission_statuses.sql')
    .sort()) {
    db.exec(readFileSync(path.resolve('sqlite/migrations', file), 'utf8'));
  }
  return db;
}

function seedLegacyBoard({ projects = 2 }: { projects?: number } = {}) {
  const db = legacyDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('workspace', 'org', 'workspace', 'Workspace', 'local', ?, ?)`
  ).run(now, now);
  for (let index = 1; index <= projects; index += 1) {
    db.prepare(
      `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at) VALUES (?, 'workspace', ?, ?, 'active', ?, ?)`
    ).run(`project-${index}`, `project-${index}`, `Project ${index}`, now, now);
  }
  for (const [id, key, type, isDefault] of [
    ['draft', 'draft', 'draft', 1],
    ['execute', 'execute', 'execute', 0],
    ['review', 'review', 'review', 0]
  ]) {
    db.prepare(
      `INSERT INTO workspace_statuses (id, workspace_id, key, name, type, position, is_default, created_at, updated_at) VALUES (?, 'workspace', ?, ?, ?, 0, ?, ?, ?)`
    ).run(id, key, key, type, isDefault, now, now);
  }
  if (projects > 0) {
    db.prepare(
      `INSERT INTO schedules (id, workspace_id, timezone, next_status_id, created_at, updated_at) VALUES ('schedule', 'workspace', 'UTC', 'review', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at) VALUES ('mission', 'workspace', 'project-1', 'workspace:1', 1, 'Mission', 'draft', 'draft', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO mission_status_seen (mission_id, status_id, seen_at) VALUES ('mission', 'blocking_question', ?)`
    ).run(now);
  }
  return db;
}

test('project-status migration fans out statuses, preserves keys, and repoints missions', () => {
  const db = seedLegacyBoard();
  finalizeProjectStatusesSqlite(db);

  assert.equal(
    (db.prepare(`SELECT count(*) AS count FROM project_statuses`).get() as { count: number }).count,
    6
  );
  assert.equal(
    (
      db.prepare(`SELECT count(*) AS count FROM workspace_statuses_legacy`).get() as {
        count: number;
      }
    ).count,
    3
  );
  assert.equal(
    (
      db
        .prepare(`SELECT status_id FROM mission_status_seen WHERE mission_id = 'mission'`)
        .get() as { status_id: string }
    ).status_id,
    'blocking_question'
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT ps.key FROM missions m JOIN project_statuses ps ON ps.id = m.status_id WHERE m.id = 'mission'`
        )
        .get() as { key: string }
    ).key,
    'draft'
  );
  assert.equal(
    (
      db.prepare(`SELECT next_status_key FROM schedules WHERE id = 'schedule'`).get() as {
        next_status_key: string;
      }
    ).next_status_key,
    'review'
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT count(*) AS count FROM pragma_table_info('schedules') WHERE name = 'next_status_id'`
        )
        .get() as { count: number }
    ).count,
    0
  );
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE missions SET status_id = (SELECT id FROM project_statuses WHERE project_id = 'project-2' AND key = 'draft') WHERE id = 'mission'`
        )
        .run(),
    /FOREIGN KEY/
  );
});

test('project-status migration scopes singleton and name constraints by project', () => {
  const db = seedLegacyBoard();
  finalizeProjectStatusesSqlite(db);
  const now = new Date().toISOString();
  const first = (
    db
      .prepare(`SELECT id FROM project_statuses WHERE project_id = 'project-1' AND key = 'draft'`)
      .get() as { id: string }
  ).id;
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE project_statuses SET is_default = 1 WHERE project_id = 'project-1' AND key = 'execute'`
        )
        .run(),
    /UNIQUE/
  );
  db.prepare(`UPDATE project_statuses SET name = 'In Progress' WHERE id = ?`).run(first);
  db.prepare(
    `UPDATE project_statuses SET name = 'In Progress' WHERE project_id = 'project-2' AND key = 'draft'`
  ).run();
  assert.equal(
    (
      db
        .prepare(`SELECT count(*) AS count FROM project_statuses WHERE name = 'In Progress'`)
        .get() as { count: number }
    ).count,
    2
  );
  assert.ok(now);
});

test('project-status migration accepts a workspace with zero projects', () => {
  const db = seedLegacyBoard({ projects: 0 });
  finalizeProjectStatusesSqlite(db);
  assert.equal(
    (db.prepare(`SELECT count(*) AS count FROM project_statuses`).get() as { count: number }).count,
    0
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_statuses_legacy'`
        )
        .get() as { name: string }
    ).name,
    'workspace_statuses_legacy'
  );
});

test('Phase G drops the legacy rollback table after the retention window', () => {
  const db = seedLegacyBoard();
  finalizeProjectStatusesSqlite(db);

  db.exec(
    readFileSync(
      path.resolve('sqlite/migrations/20260820090000_drop_workspace_statuses_legacy.sql'),
      'utf8'
    )
  );

  assert.equal(
    db
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_statuses_legacy'`
      )
      .get(),
    undefined
  );
});

/**
 * The SQLite path rebuilds `missions` with create-copy-drop-rename, and SQLite
 * drops a table's triggers along with the table. The four mission full-text
 * index maintainers from 002_initial_core.sql must be recreated, or keyword
 * search silently stops indexing missions — no error, just an empty result set.
 */
test('project-status migration keeps the mission full-text search triggers attached', () => {
  const db = seedLegacyBoard();
  const before = db
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'missions'`)
    .all() as Array<{ name: string }>;
  assert.ok(before.length > 0, 'the legacy schema attaches search triggers to missions');

  finalizeProjectStatusesSqlite(db);

  const after = db
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'missions'`)
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    after.map(row => row.name).sort(),
    before.map(row => row.name).sort(),
    'every trigger on missions survives the table rebuild'
  );

  // And they still fire: a mission written after the migration is indexed.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at)
     VALUES ('mission-2', 'workspace', 'project-1', 'workspace:2', 2, 'Zylophonics rewrite', (SELECT id FROM project_statuses WHERE project_id = 'project-1' AND key = 'draft'), 'draft', ?, ?)`
  ).run(now, now);
  const indexed = db
    .prepare(
      `SELECT title FROM search_documents WHERE entity_type = 'mission' AND entity_id = 'mission-2'`
    )
    .get() as { title: string } | undefined;
  assert.equal(indexed?.title, 'Zylophonics rewrite');
});

test('project-status migration remaps missions on soft-deleted projects', () => {
  const db = seedLegacyBoard();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at) VALUES ('project-deleted', 'workspace', 'project-deleted', 'Deleted', 'active', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at, deleted_at) VALUES ('mission-deleted', 'workspace', 'project-deleted', 'workspace:2', 2, 'Gone', 'draft', 'draft', ?, ?, ?)`
  ).run(now, now, now);
  db.prepare(`UPDATE projects SET deleted_at = ? WHERE id = 'project-deleted'`).run(now);

  finalizeProjectStatusesSqlite(db);

  const row = db
    .prepare(
      `SELECT ps.project_id, ps.key FROM missions m JOIN project_statuses ps ON ps.id = m.status_id AND ps.project_id = m.project_id WHERE m.id = 'mission-deleted'`
    )
    .get() as { project_id: string; key: string };
  assert.equal(row.project_id, 'project-deleted');
  assert.equal(row.key, 'draft');
});

/**
 * Postgres UPDATE ... FROM cannot reference the target table in a JOIN ON
 * clause (42P01: "invalid reference to FROM-clause entry for table m"). That
 * is what crashed Railway startup on the first deploy of this migration.
 * Correlate the target in WHERE instead; JOIN ON may only bind FROM tables.
 */
test('postgres remaps correlate the update target in WHERE, not JOIN ON', () => {
  const source = readFileSync(
    new URL('./project-statuses-migration-runtime.ts', import.meta.url),
    'utf8'
  );
  assert.equal(
    source.includes('JOIN project_statuses ps ON ps.project_id=m.project_id AND ps.key=ws.key'),
    false
  );
  assert.equal(
    source.includes('JOIN project_statuses ps ON ps.project_id=mp.project_id AND ps.key=ws.key'),
    false
  );
  assert.match(
    source,
    /UPDATE missions m SET status_id = ps\.id FROM workspace_statuses ws JOIN project_statuses ps ON ps\.key=ws\.key WHERE ws\.id=m\.status_id AND ps\.project_id=m\.project_id/
  );
  assert.match(
    source,
    /UPDATE my_mission_positions mp SET status_id=ps\.id FROM workspace_statuses ws JOIN project_statuses ps ON ps\.key=ws\.key WHERE ws\.id=mp\.status_id AND ps\.project_id=mp\.project_id/
  );
});

test('postgres drops workspace_statuses FKs before remapping status ids', () => {
  const source = readFileSync(
    new URL('./project-statuses-migration-runtime.ts', import.meta.url),
    'utf8'
  );
  const dropMissions = source.indexOf('DROP CONSTRAINT IF EXISTS missions_status_id_fkey');
  const updateMissions = source.indexOf('UPDATE missions m SET status_id');
  const dropPositions = source.indexOf(
    'DROP CONSTRAINT IF EXISTS my_mission_positions_status_id_fkey'
  );
  const updatePositions = source.indexOf('UPDATE my_mission_positions mp SET status_id=ps.id');
  assert.ok(dropMissions >= 0 && updateMissions >= 0);
  assert.ok(dropMissions < updateMissions);
  assert.ok(dropPositions >= 0 && updatePositions >= 0);
  assert.ok(dropPositions < updatePositions);
  const fallback = source.indexOf(
    'UPDATE missions m SET status_id = ps.id FROM project_statuses ps WHERE ps.project_id=m.project_id AND ps.is_default'
  );
  const addFk = source.indexOf(
    'ALTER TABLE missions ADD FOREIGN KEY (project_id,status_id) REFERENCES project_statuses'
  );
  assert.ok(fallback >= 0 && addFk >= 0);
  assert.ok(fallback < addFk);
  assert.match(source, /SELECT id, workspace_id FROM projects`/);
});
