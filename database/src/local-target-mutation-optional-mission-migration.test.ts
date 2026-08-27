import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';

/**
 * The SQLite half of coo:833 Phase B rebuilds `execution_requests` to drop NOT
 * NULL from `mission_id` / `objective_id`. A rebuild is the one migration shape
 * that can silently lose data or drop the objects that hang off a table, so this
 * pins the three things that must survive it: existing rows, the run-queue
 * idempotency triggers, and the indexes.
 */

const sqliteMigration = readFileSync(
  new URL(
    '../sqlite/migrations/20260827120000_local_target_mutation_optional_mission.sql',
    import.meta.url
  ),
  'utf8'
);
const postgresMigration = readFileSync(
  new URL(
    '../postgres/migrations/20260827120000_local_target_mutation_optional_mission.sql',
    import.meta.url
  ),
  'utf8'
);

type SqliteDb = ReturnType<typeof createDatabase>;

function createDatabase() {
  const db = new (loadBetterSqlite3())(':memory:');
  // A stand-in for the surrounding schema: only the referenced tables and the
  // pre-migration `execution_requests` shape matter here.
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE missions (id TEXT PRIMARY KEY);
    CREATE TABLE objectives (id TEXT PRIMARY KEY);
    CREATE TABLE execution_targets (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_users (id TEXT PRIMARY KEY);
    CREATE TABLE devices (id TEXT PRIMARY KEY);
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE project_resources (id TEXT PRIMARY KEY);
    CREATE TABLE execution_request_snapshots (id TEXT PRIMARY KEY);
    CREATE TABLE execution_target_runner_registrations (id TEXT PRIMARY KEY);

    CREATE TABLE execution_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
      mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE RESTRICT,
      objective_id TEXT NOT NULL REFERENCES objectives (id) ON DELETE RESTRICT,
      execution_target_id TEXT REFERENCES execution_targets (id) ON DELETE SET NULL,
      requested_agent TEXT,
      requested_model TEXT,
      requested_reasoning_effort TEXT,
      launch_mode TEXT NOT NULL CHECK (launch_mode IN ('run', 'ask')),
      launch_flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(launch_flags_json)),
      requested_source TEXT NOT NULL CHECK (length(trim(requested_source)) > 0),
      idempotency_key TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'launching', 'launched', 'failed', 'cleared', 'cancelled', 'expired')),
      requested_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
      claimed_by_device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
      claimed_by_execution_target_id TEXT REFERENCES execution_targets (id) ON DELETE SET NULL,
      claimed_at TEXT,
      claim_expires_at TEXT,
      launch_started_at TEXT,
      launch_completed_at TEXT,
      launched_session_id TEXT REFERENCES agent_sessions (id) ON DELETE SET NULL,
      resolved_resource_id TEXT REFERENCES project_resources (id) ON DELETE SET NULL,
      resolved_working_directory TEXT,
      last_error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      launch_snapshot_id TEXT REFERENCES execution_request_snapshots (id) ON DELETE SET NULL,
      failure_code TEXT,
      failure_phase TEXT,
      claimed_by_gateway_instance_id TEXT,
      claimed_by_runner_registration_id TEXT REFERENCES execution_target_runner_registrations (id) ON DELETE SET NULL,
      CHECK (requested_source <> 'auto_advance' OR idempotency_key IS NOT NULL)
    );
    CREATE INDEX idx_execution_requests_workspace_status_created ON execution_requests (workspace_id, status, created_at);
    CREATE INDEX idx_execution_requests_project_status_created ON execution_requests (project_id, status, created_at);
    CREATE INDEX idx_execution_requests_objective_status ON execution_requests (objective_id, status);
    CREATE UNIQUE INDEX idx_execution_requests_workspace_idempotency ON execution_requests (workspace_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TRIGGER trg_execution_requests_run_queue_idempotency_insert
    BEFORE INSERT ON execution_requests
    WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
    BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;
    CREATE TRIGGER trg_execution_requests_run_queue_idempotency_update
    BEFORE UPDATE OF requested_source, idempotency_key ON execution_requests
    WHEN new.requested_source = 'run_queue' AND new.idempotency_key IS NULL
    BEGIN SELECT RAISE(ABORT, 'run_queue execution requests require idempotency_key'); END;

    INSERT INTO workspaces (id) VALUES ('w1');
    INSERT INTO projects (id) VALUES ('p1');
    INSERT INTO missions (id) VALUES ('m1');
    INSERT INTO objectives (id) VALUES ('o1');
    INSERT INTO execution_requests
      (id, workspace_id, project_id, mission_id, objective_id, launch_mode, launch_flags_json,
       requested_source, status, metadata_json, created_at, updated_at, revision)
    VALUES ('r1', 'w1', 'p1', 'm1', 'o1', 'run', '{}', 'cli', 'launched', '{"a":1}',
            '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z', 3);
  `);
  return db;
}

function insertCapabilityCall(db: SqliteDb, id: string): void {
  db.exec(`
    INSERT INTO execution_requests
      (id, workspace_id, project_id, mission_id, objective_id, launch_mode, launch_flags_json,
       requested_source, status, metadata_json, created_at, updated_at, revision)
    VALUES ('${id}', 'w1', 'p1', NULL, NULL, 'run', '{}', 'local_target_mutation', 'queued', '{}',
            '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z', 1);
  `);
}

test('SQLite rebuild preserves rows, indexes, and run-queue triggers', () => {
  const db = createDatabase();
  assert.throws(() => insertCapabilityCall(db, 'before'), /NOT NULL/);

  db.exec(sqliteMigration);

  const kept = db.prepare(`SELECT * FROM execution_requests WHERE id = 'r1'`).get() as Record<
    string,
    unknown
  >;
  assert.equal(kept.mission_id, 'm1');
  assert.equal(kept.metadata_json, '{"a":1}');
  assert.equal(kept.revision, 3);
  assert.equal(kept.status, 'launched');

  insertCapabilityCall(db, 'cap-1');
  const capabilityCall = db
    .prepare(`SELECT mission_id, objective_id FROM execution_requests WHERE id = 'cap-1'`)
    .get() as { mission_id: string | null; objective_id: string | null };
  assert.equal(capabilityCall.mission_id, null);
  assert.equal(capabilityCall.objective_id, null);

  // Every other source still requires both ids.
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO execution_requests
          (id, workspace_id, project_id, mission_id, objective_id, launch_mode, launch_flags_json,
           requested_source, status, metadata_json, created_at, updated_at, revision)
        VALUES ('bad', 'w1', 'p1', NULL, NULL, 'run', '{}', 'cli', 'queued', '{}',
                '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z', 1);
      `),
    /CHECK constraint failed/
  );

  const triggers = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'execution_requests' ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    triggers.map(row => row.name),
    [
      'trg_execution_requests_run_queue_idempotency_insert',
      'trg_execution_requests_run_queue_idempotency_update'
    ]
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO execution_requests
          (id, workspace_id, project_id, mission_id, objective_id, launch_mode, launch_flags_json,
           requested_source, status, metadata_json, created_at, updated_at, revision)
        VALUES ('rq', 'w1', 'p1', 'm1', 'o1', 'run', '{}', 'run_queue', 'queued', '{}',
                '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z', 1);
      `),
    /run_queue execution requests require idempotency_key/
  );

  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'execution_requests' AND name LIKE 'idx_%' ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    indexes.map(row => row.name),
    [
      'idx_execution_requests_objective_status',
      'idx_execution_requests_project_status_created',
      'idx_execution_requests_workspace_idempotency',
      'idx_execution_requests_workspace_status_created'
    ]
  );
  db.close();
});

test('Postgres migration drops NOT NULL, guards the source, and arms the completion notify', () => {
  assert.match(postgresMigration, /ALTER COLUMN mission_id DROP NOT NULL/);
  assert.match(postgresMigration, /ALTER COLUMN objective_id DROP NOT NULL/);
  assert.match(postgresMigration, /execution_requests_mission_scope/);
  assert.match(postgresMigration, /requested_source = 'local_target_mutation'/);
  assert.match(postgresMigration, /overlord_execution_request_completed/);
  assert.match(postgresMigration, /execution_requests_completion_notify/);
});
