import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { createSqliteClient } from './client.js';
import { migrateDatabase, openInMemoryDatabase } from './connection.js';
import {
  compareExpected,
  EXPECTED_MISSION_ITEMS,
  FIXTURE_IDS,
  seedMissionItemsFixture,
  SELECT_FIXTURE_ITEMS_SQL,
  summariseItems
} from './mission-items.test-fixture.js';
import {
  finalizeMissionItemsSqlite,
  MISSION_ITEMS_BACKFILL_BATCH_SIZE,
  MISSION_ITEMS_MIGRATION_VERSION
} from './mission-items-migration-runtime.js';

/**
 * Migration `20261115120000_mission_items` (coo:1260, ADR 0060), SQLite half:
 * the schema, then the backfill runtime step on an upgraded database seeded
 * with the shared fixture. The Postgres half is
 * `mission-items.postgres-conformance.test.ts`.
 */

const FILE = `${MISSION_ITEMS_MIGRATION_VERSION}_mission_items.sql`;
const read = (dialect: 'sqlite' | 'postgres') =>
  readFileSync(new URL(`../${dialect}/migrations/${FILE}`, import.meta.url), 'utf8');

function openBeforeMissionItems() {
  const Database = loadBetterSqlite3();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db, { stopBeforeVersion: MISSION_ITEMS_MIGRATION_VERSION });
  return db;
}

test('both editions ship the migration under the same name', () => {
  assert.match(read('sqlite'), /CREATE TABLE mission_items/);
  assert.match(read('postgres'), /CREATE TABLE IF NOT EXISTS mission_items/);
  for (const dialect of ['sqlite', 'postgres'] as const) {
    const sql = read(dialect);
    assert.match(sql, /'risk', 'human_action', 'suggestion'/);
    assert.match(sql, /'open', 'done', 'dismissed', 'superseded'/);
    assert.match(sql, /'deterministic', 'gemini', 'agent'/);
    assert.match(sql, /content_revision/);
    assert.match(sql, /narrative_delivery_id/);
    assert.match(sql, /narrative_objective_id/);
    assert.doesNotMatch(sql, /DROP TABLE human_action_resolutions/);
  }
});

test('fresh database: summary columns, the agent author and item constraints', () => {
  const db = openInMemoryDatabase();
  const columns = (
    db.prepare(`PRAGMA table_info(mission_summaries)`).all() as Array<{
      name: string;
      dflt_value: string | null;
    }>
  ).map(column => [column.name, column.dflt_value] as const);
  assert.deepEqual(
    columns.filter(([name]) => name.startsWith('narrative_') || name === 'content_revision'),
    [
      ['content_revision', '0'],
      ['narrative_delivery_id', null],
      ['narrative_objective_id', null],
      // Added by 20261118140000_agent_only_mission_narrative (ADR 0076).
      ['narrative_published_at', null],
      ['narrative_changed_at', null]
    ]
  );
  // The later cutover migration runs after the backfill.
  assert.equal(
    db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'human_action_resolutions'`).get(),
    undefined
  );
  assert.equal(
    columns.some(([name]) => name === 'risks_json' || name === 'suggestions_json'),
    false
  );
  const indexes = (
    db.prepare(`PRAGMA index_list(mission_items)`).all() as Array<{
      name: string;
      unique: number;
    }>
  ).map(index => [index.name, index.unique] as const);
  assert.deepEqual(
    new Map(indexes),
    new Map([
      ['idx_mission_items_delivery_kind_ref', 1],
      ['idx_mission_items_mission_status_kind', 0],
      ['idx_mission_items_project_status_kind', 0],
      ['idx_mission_items_objective_status', 0],
      ['idx_mission_items_resolver_session', 0],
      ['idx_mission_items_resolver_delivery', 0],
      ['sqlite_autoindex_mission_items_1', 1]
    ])
  );
});

test('a summary row accepts generated_by agent and rejects unknown authors', async () => {
  const db = openBeforeMissionItems();
  const client = createSqliteClient(db);
  await seedMissionItemsFixture(client);
  const now = '2026-11-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO mission_summaries
       (mission_id, workspace_id, project_id, status, generated_by, headline, created_at, updated_at)
     VALUES (?, ?, ?, 'composed', 'gemini', 'Kept', ?, ?)`
  ).run(FIXTURE_IDS.missionId, FIXTURE_IDS.workspaceId, FIXTURE_IDS.projectId, now, now);
  migrateDatabase(db);

  const kept = db
    .prepare(`SELECT headline, generated_by, content_revision FROM mission_summaries`)
    .get() as Record<string, unknown>;
  assert.deepEqual(kept, { headline: 'Kept', generated_by: 'gemini', content_revision: 0 });
  db.prepare(`UPDATE mission_summaries SET generated_by = 'agent'`).run();
  assert.throws(
    () => db.prepare(`UPDATE mission_summaries SET generated_by = 'robot'`).run(),
    /CHECK constraint failed/
  );
});

test('upgrade backfills exactly the fixture items, with resolutions and supersede rules', async () => {
  const db = openBeforeMissionItems();
  await seedMissionItemsFixture(createSqliteClient(db));
  migrateDatabase(db);

  const rows = db.prepare(SELECT_FIXTURE_ITEMS_SQL).all() as Array<Record<string, unknown>>;
  assert.deepEqual(summariseItems(rows), [...EXPECTED_MISSION_ITEMS].sort(compareExpected));

  for (const row of rows) {
    const closed = row.status === 'done' || row.status === 'dismissed';
    assert.equal(row.resolved_by_kind, closed ? 'person' : null, `${row.text}`);
    assert.equal(row.resolved_at === null, !closed, `${row.text}`);
    assert.equal(row.status_reason, null);
  }
  const reported = new Map(rows.map(row => [row.delivery_id, row.reported_at]));
  assert.equal(reported.get('dA1'), '2026-11-02T00:00:00.000Z');

  // The migration writes no change-feed rows.
  assert.deepEqual(
    db
      .prepare(`SELECT COUNT(*) AS total FROM entity_changes WHERE entity_type = 'mission_item'`)
      .get(),
    { total: 0 }
  );
});

test('running the backfill again changes nothing', async () => {
  const db = openBeforeMissionItems();
  await seedMissionItemsFixture(createSqliteClient(db));
  migrateDatabase(db);
  const before = db.prepare(SELECT_FIXTURE_ITEMS_SQL).all();

  finalizeMissionItemsSqlite(db);
  migrateDatabase(db);
  assert.deepEqual(db.prepare(SELECT_FIXTURE_ITEMS_SQL).all(), before);
});

test('a closed item is never superseded by a later run of the rules', async () => {
  const db = openBeforeMissionItems();
  await seedMissionItemsFixture(createSqliteClient(db));
  migrateDatabase(db);
  // A person dismisses the open human action of dA2; dA2 then gains a newer sibling.
  db.prepare(
    `UPDATE mission_items
        SET status = 'dismissed', resolved_by_kind = 'person',
            resolved_at = '2026-11-07T00:00:00.000Z'
      WHERE delivery_id = 'dA2' AND kind = 'human_action' AND position = 0`
  ).run();
  db.prepare(`UPDATE deliveries SET deleted_at = NULL WHERE id = 'dDel'`).run();
  finalizeMissionItemsSqlite(db);

  const statuses = db
    .prepare(
      `SELECT delivery_id, position, status FROM mission_items
        WHERE kind = 'human_action' AND delivery_id = 'dA2' ORDER BY position`
    )
    .all();
  assert.deepEqual(statuses, [
    { delivery_id: 'dA2', position: 0, status: 'dismissed' },
    { delivery_id: 'dA2', position: 1, status: 'superseded' }
  ]);
});

test('the backfill crosses batch boundaries', async () => {
  const db = openBeforeMissionItems();
  const client = createSqliteClient(db);
  await seedMissionItemsFixture(client);
  const count = MISSION_ITEMS_BACKFILL_BATCH_SIZE + 5;
  for (let index = 0; index < count; index += 1) {
    const id = `dBatch-${String(index).padStart(4, '0')}`;
    const at = new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
    await client.run(
      `INSERT INTO deliveries (id, workspace_id, project_id, mission_id, objective_id, summary,
         payload_json, delivered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'oc', 'Delivered.', ?, ?, ?, ?)`,
      [
        id,
        FIXTURE_IDS.workspaceId,
        FIXTURE_IDS.projectId,
        FIXTURE_IDS.missionId,
        JSON.stringify({
          deliveryReport: {
            schemaVersion: 1,
            agentReport: {
              humanActions: [],
              tradeoffsMade: [],
              knownRisks: [`Risk ${index}.`],
              deferredWork: [],
              assumptions: []
            },
            presentation: {
              status: 'deterministic',
              markdown: 'Delivered.',
              humanActions: [],
              tradeoffsMade: [],
              knownRisks: [`Risk ${index}.`],
              deferredWork: [],
              assumptions: [],
              generatedBy: 'deterministic'
            }
          }
        }),
        at,
        at,
        at
      ]
    );
  }
  migrateDatabase(db);
  assert.deepEqual(
    db
      .prepare(`SELECT COUNT(*) AS total FROM mission_items WHERE delivery_id LIKE 'dBatch-%'`)
      .get(),
    { total: count }
  );
  assert.deepEqual(db.prepare(`SELECT COUNT(*) AS total FROM mission_items`).get(), {
    total: count + EXPECTED_MISSION_ITEMS.length
  });
});

test('the storage drop preserves narrative and item decisions after backfill', async () => {
  const db = openBeforeMissionItems();
  await seedMissionItemsFixture(createSqliteClient(db));
  migrateDatabase(db, { stopBeforeVersion: '20261115160000' });
  const now = '2026-11-05T00:00:00.000Z';
  db.prepare(
    `INSERT INTO mission_summaries (mission_id, workspace_id, project_id, status,
    generated_by, headline, summary_markdown, content_revision, narrative_delivery_id,
    narrative_objective_id, created_at, updated_at) VALUES (?, ?, ?, 'composed', 'agent',
    'Verified headline.', 'Verified narrative.', 7, 'dA2', 'oa', ?, ?)`
  ).run(FIXTURE_IDS.missionId, FIXTURE_IDS.workspaceId, FIXTURE_IDS.projectId, now, now);
  const before = db.prepare('SELECT * FROM mission_summaries').get() as Record<string, unknown>;
  delete before.risks_json;
  delete before.suggestions_json;
  const items = db.prepare(SELECT_FIXTURE_ITEMS_SQL).all();
  migrateDatabase(db);
  // ADR 0076 keeps the prose and provenance verbatim and reads it as legacy: no
  // coverage basis, last changed at its stored time.
  assert.deepEqual(db.prepare('SELECT * FROM mission_summaries').get(), {
    ...before,
    evidence_revision: 0,
    published_evidence_revision: null,
    narrative_published_at: null,
    narrative_changed_at: now
  });
  assert.deepEqual(db.prepare(SELECT_FIXTURE_ITEMS_SQL).all(), items);
  assert.equal(
    db.prepare(`SELECT name FROM sqlite_schema WHERE name = 'human_action_resolutions'`).get(),
    undefined
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('cross-mission provenance migration backfills objective mission and constrains agent-only columns', async () => {
  const Database = loadBetterSqlite3();
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  try {
    migrateDatabase(raw, { stopBeforeVersion: '20261118180000' });
    const db = createSqliteClient(raw);
    await seedMissionItemsFixture(db, { legacyResolutions: false });
    // Backfill current item rows from the fixture's live delivery reports.
    const delivery = raw.prepare('SELECT * FROM deliveries ORDER BY id LIMIT 1').get() as {
      id: string;
      objective_id: string;
    };
    const now = '2026-11-18T00:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO mission_items (id, workspace_id, project_id, mission_id,
      objective_id, delivery_id, kind, item_ref, position, text, detail_json, status,
      status_reason, resolved_by_kind, resolved_by_objective_id, resolved_at,
      reported_at, created_at, updated_at) VALUES ('legacy-close', ?, ?, ?, ?, ?,
      'risk', 'legacy', 0, 'Legacy risk', '{}', 'done', 'Verified', 'agent', ?, ?, ?, ?, ?)`
      )
      .run(
        FIXTURE_IDS.workspaceId,
        FIXTURE_IDS.projectId,
        FIXTURE_IDS.missionId,
        delivery.objective_id,
        delivery.id,
        delivery.objective_id,
        now,
        now,
        now,
        now
      );
    migrateDatabase(raw);
    const expected = raw
      .prepare('SELECT mission_id FROM objectives WHERE id = ?')
      .get(delivery.objective_id) as { mission_id: string };
    assert.deepEqual(
      raw
        .prepare(
          `SELECT resolved_by_mission_id, resolved_by_session_id, restored_at
      FROM mission_items WHERE id = 'legacy-close'`
        )
        .get(),
      {
        resolved_by_mission_id: expected.mission_id,
        resolved_by_session_id: null,
        restored_at: null
      }
    );
    assert.throws(
      () =>
        raw
          .prepare(
            `UPDATE mission_items SET resolved_by_kind = 'person'
      WHERE id = 'legacy-close'`
          )
          .run(),
      /CHECK/
    );
    assert.throws(
      () =>
        raw
          .prepare(
            `UPDATE mission_items SET restored_at = 'invalid'
      WHERE id = 'legacy-close'`
          )
          .run(),
      /CHECK/
    );
    migrateDatabase(raw); // ledger replay does not reapply ALTERs or manufacture sessions.
  } finally {
    raw.close();
  }
});
