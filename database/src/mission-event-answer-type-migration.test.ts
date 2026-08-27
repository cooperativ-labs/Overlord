import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * `mission_events.type` is a CHECK list, so adding the `answer` event
 * (coo:833 Phase A) means rebuilding the table on SQLite. A rebuild is the one
 * migration shape that can silently lose rows or drop the objects hanging off a
 * table, so this pins what must survive it: existing events, the indexes, and
 * the search-document triggers.
 */

const sqliteMigration = readFileSync(
  new URL('../sqlite/migrations/20260827130000_mission_event_answer_type.sql', import.meta.url),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL('../postgres/migrations/20260827130000_mission_event_answer_type.sql', import.meta.url),
  'utf8'
);

function createDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  // A stand-in for the surrounding schema: only the referenced tables, the
  // pre-migration `mission_events` shape, and the search projection matter.
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT, UNIQUE (workspace_id, id));
    CREATE TABLE missions (id TEXT PRIMARY KEY, workspace_id TEXT, UNIQUE (workspace_id, id));
    CREATE TABLE objectives (id TEXT PRIMARY KEY);
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_users (id TEXT PRIMARY KEY);
    CREATE TABLE search_documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      mission_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT,
      body_text TEXT,
      indexed_at TEXT NOT NULL,
      UNIQUE (workspace_id, entity_type, entity_id)
    );

    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
      mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE RESTRICT,
      objective_id TEXT REFERENCES objectives (id) ON DELETE SET NULL,
      session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('update', 'user_follow_up', 'alert', 'discussion_summary', 'decision', 'ask', 'permission_request', 'delivery', 'execution_requested', 'awaiting_approval', 'status_change')),
      phase TEXT,
      summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
      payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
      external_url TEXT,
      source TEXT NOT NULL CHECK (length(trim(source)) > 0),
      actor_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
      actor_token_id TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
      FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, mission_id) REFERENCES missions (workspace_id, id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_mission_events_mission_created ON mission_events (mission_id, created_at);
    CREATE INDEX idx_mission_events_objective_created ON mission_events (objective_id, created_at);
    CREATE UNIQUE INDEX idx_mission_events_idempotency ON mission_events (workspace_id, source, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TRIGGER trg_search_events_ai AFTER INSERT ON mission_events BEGIN
      INSERT INTO search_documents (
        id, workspace_id, project_id, mission_id, entity_type, entity_id,
        title, body_text, indexed_at
      ) VALUES (
        lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.mission_id, 'event', new.id,
        NULL, new.summary, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        project_id = excluded.project_id,
        mission_id = excluded.mission_id,
        body_text = excluded.body_text,
        indexed_at = excluded.indexed_at;
    END;
    CREATE TRIGGER trg_search_events_ad AFTER DELETE ON mission_events BEGIN
      DELETE FROM search_documents
      WHERE workspace_id = old.workspace_id AND entity_type = 'event' AND entity_id = old.id;
    END;

    INSERT INTO workspaces (id) VALUES ('w1');
    INSERT INTO projects (id, workspace_id) VALUES ('p1', 'w1');
    INSERT INTO missions (id, workspace_id) VALUES ('m1', 'w1');
    INSERT INTO mission_events
      (id, workspace_id, project_id, mission_id, type, summary, payload_json, source, created_at)
    VALUES ('e1', 'w1', 'p1', 'm1', 'ask', 'Which database?', '{"a":1}', 'cli',
            '2026-08-27T00:00:00.000Z');
  `);
  return db;
}

function insertAnswer(db: ReturnType<typeof createDatabase>, id: string): void {
  db.exec(`
    INSERT INTO mission_events
      (id, workspace_id, project_id, mission_id, type, summary, payload_json, source, created_at)
    VALUES ('${id}', 'w1', 'p1', 'm1', 'answer', 'Postgres', '{}', 'web',
            '2026-08-27T00:01:00.000Z');
  `);
}

test('SQLite rebuild admits `answer` and preserves rows, indexes, and search triggers', () => {
  const db = createDatabase();
  assert.throws(() => insertAnswer(db, 'before'), /CHECK constraint failed/);

  db.exec(sqliteMigration);

  const kept = db.prepare(`SELECT * FROM mission_events WHERE id = 'e1'`).get() as Record<
    string,
    unknown
  >;
  assert.equal(kept.type, 'ask');
  assert.equal(kept.summary, 'Which database?');
  assert.equal(kept.payload_json, '{"a":1}');

  insertAnswer(db, 'e2');
  assert.equal(
    (db.prepare(`SELECT type FROM mission_events WHERE id = 'e2'`).get() as { type: string }).type,
    'answer'
  );

  // An unknown type is still refused.
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO mission_events
          (id, workspace_id, project_id, mission_id, type, summary, payload_json, source, created_at)
        VALUES ('bad', 'w1', 'p1', 'm1', 'nonsense', 'x', '{}', 'cli',
                '2026-08-27T00:02:00.000Z');
      `),
    /CHECK constraint failed/
  );

  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mission_events' AND name LIKE 'idx_%' ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    indexes.map(row => row.name),
    [
      'idx_mission_events_idempotency',
      'idx_mission_events_mission_created',
      'idx_mission_events_objective_created'
    ]
  );

  const triggers = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'mission_events' ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    triggers.map(row => row.name),
    ['trg_search_events_ad', 'trg_search_events_ai']
  );
  // The projection is still fed by the recreated trigger.
  assert.equal(
    (
      db.prepare(`SELECT body_text FROM search_documents WHERE entity_id = 'e2'`).get() as {
        body_text: string;
      }
    ).body_text,
    'Postgres'
  );

  db.close();
});

test('Postgres swaps the type CHECK rather than rebuilding the table', () => {
  assert.match(postgresMigration, /DROP CONSTRAINT IF EXISTS mission_events_type_check/);
  assert.match(postgresMigration, /ADD CONSTRAINT mission_events_type_check/);
  assert.match(postgresMigration, /'answer'/);
  assert.ok(!/CREATE TABLE/i.test(postgresMigration));
});
