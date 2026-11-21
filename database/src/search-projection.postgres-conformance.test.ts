import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { createPostgresClient, createSqliteClient, type DatabaseClient } from './client.js';
import { migrateDatabase } from './connection.js';
import { migratePostgres } from './migrate-postgres.js';

const version = '20261121170000';
const timestamp = '2026-11-01T00:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;

async function verifyUpgrade(db: DatabaseClient, upgrade: () => Promise<void>) {
  await db.exec(`
    INSERT INTO organizations (id, name, created_at, updated_at)
      VALUES ('org', 'Org', '${timestamp}', '${timestamp}');
    INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
      VALUES ('w1', 'org', 'w1', 'W1', 'local', '${timestamp}', '${timestamp}'),
             ('w2', 'org', 'w2', 'W2', 'local', '${timestamp}', '${timestamp}');
    INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
      VALUES ('p1', 'w1', 'p1', 'P1', 'active', '${timestamp}', '${timestamp}'),
             ('p2', 'w2', 'p2', 'P2', 'active', '${timestamp}', '${timestamp}');
    INSERT INTO project_statuses
      (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, created_at, updated_at)
      VALUES ('s1', 'w1', 'p1', 'draft', 'Draft', 'draft', 0, true, false, '${timestamp}', '${timestamp}'),
             ('s2', 'w2', 'p2', 'draft', 'Draft', 'draft', 0, true, false, '${timestamp}', '${timestamp}');
    INSERT INTO missions
      (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at)
      VALUES ('m1', 'w1', 'p1', 'sample:1', 1, 'Harbor', 's1', 'draft', '${timestamp}', '${timestamp}'),
             ('m2', 'w2', 'p2', 'sample:2', 2, 'Sample', 's2', 'draft', '${timestamp}', '${timestamp}');
    INSERT INTO objectives
      (id, workspace_id, project_id, mission_id, display_key, position, instruction_text, state, created_at, updated_at)
      VALUES ('o', 'w1', 'p1', 'm1', 'brief', 0, 'Beacon', 'draft', '${timestamp}', '${timestamp}');
    INSERT INTO deliveries
      (id, workspace_id, project_id, mission_id, objective_id, summary, delivered_at, created_at, updated_at)
      VALUES ('d', 'w1', 'p1', 'm1', 'o', 'Mooring', '${timestamp}', '${timestamp}', '${timestamp}');
    INSERT INTO mission_events (id, workspace_id, project_id, mission_id, type, summary, source, created_at)
      VALUES ('e', 'w1', 'p1', 'm1', 'ask', 'Tide', 'agent', '${timestamp}');
  `);
  if (db.dialect === 'sqlite') {
    // Simulate the search document left behind by a pre-migration event project move.
    await db.run("UPDATE search_documents SET project_id = 'p2' WHERE entity_id = 'e'");
  }
  await upgrade();
  assert.equal(
    (
      await db.get<{ project_id: string }>(
        "SELECT project_id FROM search_documents WHERE entity_id = 'e'"
      )
    )?.project_id,
    'p1'
  );
  // The migration transaction can commit before the runner records its checksum.
  await db.run('DELETE FROM schema_migrations WHERE version = ?', [version]);
  await upgrade();

  await db.run('UPDATE search_documents SET indexed_at = ?', [timestamp]);
  const documents = () =>
    db.all<{ entity_id: string; source_revision: number | null; indexed_at: string | Date }>(
      'SELECT entity_id, source_revision, indexed_at FROM search_documents ORDER BY entity_id'
    );
  const original = await documents();
  await db.exec(`
    UPDATE missions SET board_position = 3 WHERE id = 'm1';
    UPDATE objectives SET auto_advance = true WHERE id = 'o';
    UPDATE deliveries SET payload_json = '{"deliveryReport":{"presentation":{"title":"Ignored"}}}' WHERE id = 'd';
    UPDATE mission_events SET payload_json = '{"answer":"Yes"}' WHERE id = 'e';
  `);
  assert.deepEqual(await documents(), original, 'identical projections keep their timestamps');

  const sqliteChanges = async () =>
    (await db.get<{ count: number }>('SELECT total_changes() AS count'))!.count;
  const before = db.dialect === 'sqlite' ? await sqliteChanges() : 0;
  await db.exec(`
    UPDATE missions SET revision = revision + 1 WHERE id = 'm1';
    UPDATE objectives SET revision = revision + 1 WHERE id = 'o';
    UPDATE deliveries SET revision = revision + 1 WHERE id = 'd';
  `);
  if (db.dialect === 'sqlite') {
    assert.equal(
      (await sqliteChanges()) - before,
      6,
      'three source writes and three content writes'
    );
  }
  const changed = (await documents()).filter(row => ['m1', 'o', 'd'].includes(row.entity_id));
  assert.equal(changed.length, 3);
  for (const doc of changed) {
    assert.equal(doc.source_revision, 2);
    assert.notEqual(new Date(doc.indexed_at).toISOString(), timestamp);
  }

  const match = async (term: string, workspace: string, project: string) => {
    const sql =
      db.dialect === 'sqlite'
        ? `SELECT doc.entity_id FROM search_documents_fts
           JOIN search_documents AS doc ON doc.rowid = search_documents_fts.rowid
          WHERE search_documents_fts MATCH ?`
        : `SELECT doc.entity_id FROM search_documents AS doc
          WHERE doc.search_tsv @@ plainto_tsquery('english', ?)`;
    return (
      await db.all<{ entity_id: string }>(
        sql + ' AND doc.workspace_id = ? AND doc.project_id = ? ORDER BY doc.entity_id',
        [term, workspace, project]
      )
    ).map(row => row.entity_id);
  };
  for (const [term, id] of [
    ['harbor', 'm1'],
    ['beacon', 'o'],
    ['mooring', 'd'],
    ['tide', 'e']
  ] as const) {
    assert.deepEqual(await match(term, 'w1', 'p1'), [id]);
    assert.deepEqual(await match(term, 'w2', 'p2'), []);
  }
  await db.exec(`
    UPDATE missions SET title = 'Lighthouse' WHERE id = 'm1';
    UPDATE objectives SET title = 'Compass', instruction_text = NULL WHERE id = 'o';
    UPDATE deliveries SET payload_json =
      '{"deliveryReport":{"agentReport":{"knownRisks":["Breakwater"]}}}' WHERE id = 'd';
    UPDATE mission_events SET summary = 'Estuary' WHERE id = 'e';
  `);
  for (const [term, id] of [
    ['lighthouse', 'm1'],
    ['compass', 'o'],
    ['breakwater', 'd'],
    ['estuary', 'e']
  ] as const) {
    assert.deepEqual(await match(term, 'w1', 'p1'), [id]);
  }
  for (const term of ['harbor', 'beacon', 'tide', 'ignored']) {
    assert.deepEqual(await match(term, 'w1', 'p1'), []);
  }

  await db.exec(`
    UPDATE objectives SET workspace_id = 'w2', project_id = 'p2', mission_id = 'm2' WHERE id = 'o';
    UPDATE deliveries SET workspace_id = 'w2', project_id = 'p2', mission_id = 'm2' WHERE id = 'd';
    UPDATE mission_events SET workspace_id = 'w2', project_id = 'p2', mission_id = 'm2' WHERE id = 'e';
  `);
  for (const [term, id] of [
    ['compass', 'o'],
    ['breakwater', 'd'],
    ['estuary', 'e']
  ] as const) {
    assert.deepEqual(await match(term, 'w1', 'p1'), []);
    assert.deepEqual(await match(term, 'w2', 'p2'), [id]);
  }
  for (const [table, id, term] of [
    ['objectives', 'o', 'compass'],
    ['deliveries', 'd', 'breakwater']
  ] as const) {
    await db.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [timestamp, id]);
    assert.deepEqual(await match(term, 'w2', 'p2'), []);
    await db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, [id]);
    assert.deepEqual(await match(term, 'w2', 'p2'), [id]);
  }
  await db.run("UPDATE missions SET deleted_at = ? WHERE id = 'm2'", [timestamp]);
  assert.deepEqual(
    (await documents()).map(row => row.entity_id),
    ['m1']
  );
  await db.run("UPDATE missions SET deleted_at = NULL WHERE id = 'm2'");
  assert.deepEqual(await match('sample', 'w2', 'p2'), ['m2']);
  await db.run("UPDATE mission_events SET summary = 'Estuary returns' WHERE id = 'e'");
  assert.deepEqual(await match('estuary', 'w2', 'p2'), ['e']);
  await db.run("DELETE FROM mission_events WHERE id = 'e'");
  assert.deepEqual(await match('estuary', 'w2', 'p2'), []);
}

test('search projection upgrade skips redundant writes and preserves search [sqlite]', async () => {
  const Database = loadBetterSqlite3();
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = createSqliteClient(sqlite);
  try {
    migrateDatabase(sqlite, { stopBeforeVersion: version });
    await verifyUpgrade(db, async () => migrateDatabase(sqlite));
  } finally {
    await db.close();
  }
});

test(
  'search projection upgrade skips redundant writes and preserves search [postgres]',
  {
    skip: !connectionString
  },
  async () => {
    const { default: pg } = await import('pg');
    const name = `ovld_search_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(connectionString!);
    url.pathname = `/${name}`;
    const db = createPostgresClient(new pg.Pool({ connectionString: url.toString() }), {
      ownsPool: true
    });
    try {
      await migratePostgres(db, { stopBeforeVersion: version });
      await verifyUpgrade(db, () => migratePostgres(db));
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  }
);
