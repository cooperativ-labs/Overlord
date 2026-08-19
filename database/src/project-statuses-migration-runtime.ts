import { randomUUID } from 'node:crypto';

import type { BetterSqlite3Database } from './better-sqlite3-loader.js';
import type { DatabaseClient } from './client.js';

export const PROJECT_STATUSES_MIGRATION_VERSION = '20260819090000';

export function isProjectStatusesMigration(migration: {
  version: string;
  component: string;
}): boolean {
  return migration.version === PROJECT_STATUSES_MIGRATION_VERSION && migration.component === 'core';
}

type LegacyStatus = {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  type: string;
  position: number;
  is_default: number | boolean;
  is_terminal: number | boolean;
  metadata_json: string;
};

function sqliteProjectStatusesSql(): string {
  return `
    CREATE TABLE project_statuses (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
      key TEXT NOT NULL CHECK (length(trim(key)) > 0),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND name = trim(name)),
      type TEXT NOT NULL CHECK (type IN ('draft','next','execute','review','complete','blocked','cancelled')),
      position INTEGER NOT NULL CHECK (position >= 0),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
      updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
      deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      UNIQUE (workspace_id, id),
      UNIQUE (project_id, id),
      FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX idx_project_statuses_project_key ON project_statuses (project_id, key);
    CREATE UNIQUE INDEX idx_project_statuses_active_name ON project_statuses (project_id, lower(name)) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX idx_project_statuses_active_default ON project_statuses (project_id) WHERE is_default = 1 AND deleted_at IS NULL;
    CREATE UNIQUE INDEX idx_project_statuses_active_execute ON project_statuses (project_id) WHERE type = 'execute' AND deleted_at IS NULL;
    CREATE UNIQUE INDEX idx_project_statuses_active_review ON project_statuses (project_id) WHERE type = 'review' AND deleted_at IS NULL;
    CREATE UNIQUE INDEX idx_project_statuses_active_next ON project_statuses (project_id) WHERE type = 'next' AND deleted_at IS NULL;
    CREATE INDEX idx_project_statuses_project_position ON project_statuses (project_id, position) WHERE deleted_at IS NULL;
  `;
}

function sqliteRebuildDependentsSql(): string {
  return `
    CREATE TABLE schedules_new (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
      name TEXT, period_type TEXT NOT NULL DEFAULT 'd' CHECK (period_type IN ('d', 'w', 'm')),
      period_interval INTEGER NOT NULL DEFAULT 1 CHECK (period_interval >= 1),
      weeks_of_month_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(weeks_of_month_json)),
      days_of_month_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(days_of_month_json)),
      days_of_week_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(days_of_week_json)),
      start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '????-??-??T??:??:??.???Z'),
      timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0), next_status_key TEXT,
      created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
      updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    );
    INSERT INTO schedules_new (id, workspace_id, name, period_type, period_interval, weeks_of_month_json, days_of_month_json, days_of_week_json, start_date, timezone, next_status_key, created_at, updated_at, revision)
      SELECT id, workspace_id, name, period_type, period_interval, weeks_of_month_json, days_of_month_json, days_of_week_json, start_date, timezone, next_status_key, created_at, updated_at, revision FROM schedules;
    DROP TABLE schedules;
    ALTER TABLE schedules_new RENAME TO schedules;
    CREATE UNIQUE INDEX idx_schedules_workspace_id ON schedules (workspace_id, id);
    CREATE TABLE missions_new (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE RESTRICT, display_id TEXT NOT NULL CHECK (length(trim(display_id)) > 0),
      sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1), title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      status_id TEXT NOT NULL REFERENCES project_statuses (id) ON DELETE RESTRICT,
      status_type TEXT NOT NULL CHECK (status_type IN ('draft','next','execute','review','complete','blocked','cancelled')), board_position INTEGER NOT NULL DEFAULT 0,
      priority TEXT CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent')), constraints_text TEXT, output_format_text TEXT,
      execution_target_intent_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(execution_target_intent_json)), metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      active_branch TEXT, branch_override TEXT, worktree_preference TEXT, schedule_id TEXT REFERENCES schedules (id) ON DELETE SET NULL,
      due_datetime TEXT CHECK (due_datetime IS NULL OR due_datetime GLOB '????-??-??T??:??:??.???Z'), created_by_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL,
      assigned_workspace_user_id TEXT REFERENCES workspace_users (id) ON DELETE SET NULL, created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
      updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'), deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '????-??-??T??:??:??.???Z'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), notes_text TEXT, blocking_question_seen_at TEXT, returned_to_execute_at TEXT,
      created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human','agent','automation')), created_by_agent TEXT, created_by_session_id TEXT,
      allow_parallel_objectives INTEGER NOT NULL DEFAULT 0 CHECK (allow_parallel_objectives IN (0, 1)),
      FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id, status_id) REFERENCES project_statuses (project_id, id) ON DELETE RESTRICT
    );
    INSERT INTO missions_new SELECT * FROM missions;
    DROP TABLE missions;
    ALTER TABLE missions_new RENAME TO missions;
    CREATE UNIQUE INDEX idx_missions_workspace_display_id ON missions (workspace_id, display_id);
    CREATE UNIQUE INDEX idx_missions_workspace_sequence_number ON missions (workspace_id, sequence_number);
    CREATE UNIQUE INDEX idx_missions_workspace_id ON missions (workspace_id, id);
    CREATE UNIQUE INDEX idx_missions_project_id ON missions (project_id, id);
    CREATE INDEX idx_missions_project_status_updated ON missions (project_id, status_type, updated_at);
    CREATE INDEX idx_missions_project_status_board ON missions (project_id, status_id, board_position);
    CREATE INDEX idx_missions_workspace_creator_updated ON missions (workspace_id, created_by_workspace_user_id, updated_at);
    CREATE INDEX idx_missions_schedule_id ON missions (schedule_id) WHERE schedule_id IS NOT NULL;
    CREATE INDEX idx_missions_project_due_datetime ON missions (project_id, due_datetime) WHERE due_datetime IS NOT NULL AND deleted_at IS NULL;
    -- SQLite drops a table's triggers with the table, so the create-copy-drop-rename
    -- above silently detaches the mission full-text index maintainers from
    -- 002_initial_core.sql. Recreating them verbatim is not optional: without them
    -- the missions table stops feeding search_documents and every keyword search
    -- (ovld missions list --query, protocol search-missions, the webapp search box)
    -- goes quiet for newly written rows without erroring anywhere.
    CREATE TRIGGER trg_search_missions_ai AFTER INSERT ON missions
    WHEN new.deleted_at IS NULL
    BEGIN
      INSERT INTO search_documents (
        id, workspace_id, project_id, mission_id, entity_type, entity_id,
        title, body_text, source_revision, indexed_at
      ) VALUES (
        lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.id, 'mission', new.id,
        new.title, new.title || ' ' || new.display_id, new.revision,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        project_id = excluded.project_id,
        mission_id = excluded.mission_id,
        title = excluded.title,
        body_text = excluded.body_text,
        source_revision = excluded.source_revision,
        indexed_at = excluded.indexed_at;
    END;
    CREATE TRIGGER trg_search_missions_au AFTER UPDATE ON missions
    WHEN new.deleted_at IS NULL
    BEGIN
      INSERT INTO search_documents (
        id, workspace_id, project_id, mission_id, entity_type, entity_id,
        title, body_text, source_revision, indexed_at
      ) VALUES (
        lower(hex(randomblob(16))), new.workspace_id, new.project_id, new.id, 'mission', new.id,
        new.title, new.title || ' ' || new.display_id, new.revision,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE SET
        project_id = excluded.project_id,
        mission_id = excluded.mission_id,
        title = excluded.title,
        body_text = excluded.body_text,
        source_revision = excluded.source_revision,
        indexed_at = excluded.indexed_at;
    END;
    CREATE TRIGGER trg_search_missions_soft_delete AFTER UPDATE ON missions
    WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
    BEGIN
      DELETE FROM search_documents WHERE workspace_id = new.workspace_id AND mission_id = new.id;
    END;
    CREATE TRIGGER trg_search_missions_ad AFTER DELETE ON missions BEGIN
      DELETE FROM search_documents WHERE workspace_id = old.workspace_id AND mission_id = old.id;
    END;
    CREATE TABLE my_mission_positions_new (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE, workspace_user_id TEXT NOT NULL REFERENCES workspace_users (id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL REFERENCES missions (id) ON DELETE CASCADE, status_id TEXT NOT NULL REFERENCES project_statuses (id) ON DELETE CASCADE,
      position REAL NOT NULL, created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'), updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), UNIQUE (workspace_id, workspace_user_id, mission_id),
      FOREIGN KEY (workspace_id, mission_id) REFERENCES missions (workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, mission_id) REFERENCES missions (project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, status_id) REFERENCES project_statuses (project_id, id) ON DELETE CASCADE
    );
    INSERT INTO my_mission_positions_new SELECT id, workspace_id, project_id, workspace_user_id, mission_id, status_id, position, created_at, updated_at, revision FROM my_mission_positions;
    DROP TABLE my_mission_positions;
    ALTER TABLE my_mission_positions_new RENAME TO my_mission_positions;
    CREATE INDEX idx_my_mission_positions_user_status ON my_mission_positions (workspace_id, workspace_user_id, status_id, position);
  `;
}

function sqliteVerify(db: BetterSqlite3Database): void {
  const invalidMission = db
    .prepare(
      `SELECT 1 FROM missions m LEFT JOIN project_statuses ps ON ps.project_id = m.project_id AND ps.id = m.status_id WHERE ps.id IS NULL LIMIT 1`
    )
    .get();
  const badSingleton = db
    .prepare(
      `SELECT 1 FROM projects p LEFT JOIN project_statuses ps ON ps.project_id = p.id AND ps.deleted_at IS NULL WHERE p.deleted_at IS NULL GROUP BY p.id HAVING SUM(ps.is_default = 1) != 1 OR SUM(ps.type = 'execute') != 1 OR SUM(ps.type = 'review') != 1 LIMIT 1`
    )
    .get();
  const badFanout = db
    .prepare(
      `SELECT 1 FROM (SELECT p.workspace_id, COUNT(*) projects FROM projects p GROUP BY p.workspace_id) p LEFT JOIN (SELECT workspace_id, COUNT(*) statuses FROM workspace_statuses WHERE deleted_at IS NULL GROUP BY workspace_id) ws ON ws.workspace_id = p.workspace_id LEFT JOIN (SELECT workspace_id, COUNT(*) statuses FROM project_statuses GROUP BY workspace_id) ps ON ps.workspace_id = p.workspace_id WHERE COALESCE(ps.statuses, 0) != p.projects * COALESCE(ws.statuses, 0) LIMIT 1`
    )
    .get();
  if (invalidMission || badSingleton || badFanout)
    throw new Error('Project-status migration verification failed');
}

export function finalizeProjectStatusesSqlite(db: BetterSqlite3Database): void {
  const legacyExists = db
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_statuses'`)
    .get();
  if (!legacyExists) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(sqliteProjectStatusesSql());
    db.exec('ALTER TABLE schedules ADD COLUMN next_status_key TEXT');
    const statuses = db
      .prepare(
        `SELECT id, workspace_id, key, name, type, position, is_default, is_terminal, metadata_json FROM workspace_statuses WHERE deleted_at IS NULL`
      )
      .all() as LegacyStatus[];
    const projects = db
      .prepare(`SELECT id, workspace_id FROM projects`)
      .all() as Array<{ id: string; workspace_id: string }>;
    const insert = db.prepare(
      `INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, metadata_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    const now = new Date().toISOString();
    for (const project of projects)
      for (const status of statuses)
        if (status.workspace_id === project.workspace_id)
          insert.run(
            randomUUID(),
            project.workspace_id,
            project.id,
            status.key,
            status.name,
            status.type,
            status.position,
            status.is_default,
            status.is_terminal,
            status.metadata_json,
            now,
            now
          );
    db.exec(
      `UPDATE missions SET status_id = (SELECT ps.id FROM workspace_statuses ws JOIN project_statuses ps ON ps.project_id = missions.project_id AND ps.key = ws.key WHERE ws.id = missions.status_id)`
    );
    db.exec(
      `UPDATE missions SET status_id = (SELECT ps.id FROM project_statuses ps WHERE ps.project_id = missions.project_id AND ps.is_default = 1 AND ps.deleted_at IS NULL) WHERE NOT EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.project_id = missions.project_id AND ps.id = missions.status_id)`
    );
    db.exec(
      `ALTER TABLE my_mission_positions ADD COLUMN project_id TEXT; UPDATE my_mission_positions SET project_id = (SELECT project_id FROM missions WHERE missions.id = my_mission_positions.mission_id);`
    );
    db.exec(
      `UPDATE my_mission_positions SET status_id = (SELECT ps.id FROM workspace_statuses ws JOIN project_statuses ps ON ps.project_id = my_mission_positions.project_id AND ps.key = ws.key WHERE ws.id = my_mission_positions.status_id);`
    );
    db.exec(
      `UPDATE my_mission_positions SET status_id = (SELECT ps.id FROM project_statuses ps WHERE ps.project_id = my_mission_positions.project_id AND ps.is_default = 1 AND ps.deleted_at IS NULL) WHERE NOT EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.project_id = my_mission_positions.project_id AND ps.id = my_mission_positions.status_id);`
    );
    db.exec(
      `UPDATE schedules SET next_status_key = (SELECT key FROM workspace_statuses WHERE id = schedules.next_status_id)`
    );
    db.exec(sqliteRebuildDependentsSql());
    // mission_status_seen.status_id contains indicator keys, not status ids; leave it untouched.
    sqliteVerify(db);
    db.exec('ALTER TABLE workspace_statuses RENAME TO workspace_statuses_legacy');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export async function finalizeProjectStatusesPostgres(client: DatabaseClient): Promise<void> {
  const legacy = await client.get<{ present: string | null }>(
    `SELECT to_regclass('workspace_statuses') AS present`
  );
  if (!legacy?.present) return;
  await client.transaction(async tx => {
    await tx.exec(
      `CREATE TABLE project_statuses (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT, project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT, key text NOT NULL CHECK (char_length(btrim(key)) > 0), name text NOT NULL CHECK (char_length(btrim(name)) > 0 AND name = btrim(name)), type text NOT NULL CHECK (type IN ('draft','next','execute','review','complete','blocked','cancelled')), position integer NOT NULL CHECK (position >= 0), is_default boolean NOT NULL DEFAULT false, is_terminal boolean NOT NULL DEFAULT false, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz, revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1), UNIQUE (workspace_id,id), UNIQUE (project_id,id), FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE RESTRICT); CREATE UNIQUE INDEX idx_project_statuses_project_key ON project_statuses(project_id,key); CREATE UNIQUE INDEX idx_project_statuses_active_name ON project_statuses(project_id,lower(name)) WHERE deleted_at IS NULL; CREATE UNIQUE INDEX idx_project_statuses_active_default ON project_statuses(project_id) WHERE is_default AND deleted_at IS NULL; CREATE UNIQUE INDEX idx_project_statuses_active_execute ON project_statuses(project_id) WHERE type='execute' AND deleted_at IS NULL; CREATE UNIQUE INDEX idx_project_statuses_active_review ON project_statuses(project_id) WHERE type='review' AND deleted_at IS NULL; CREATE UNIQUE INDEX idx_project_statuses_active_next ON project_statuses(project_id) WHERE type='next' AND deleted_at IS NULL; CREATE INDEX idx_project_statuses_project_position ON project_statuses(project_id,position) WHERE deleted_at IS NULL; ALTER TABLE schedules ADD COLUMN next_status_key text;`
    );
    const statuses = await tx.all<LegacyStatus>(
      `SELECT id, workspace_id, key, name, type, position, is_default, is_terminal, metadata_json::text FROM workspace_statuses WHERE deleted_at IS NULL`
    );
    const projects = await tx.all<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM projects`
    );
    const now = new Date().toISOString();
    for (const project of projects)
      for (const status of statuses)
        if (status.workspace_id === project.workspace_id)
          await tx.run(
            `INSERT INTO project_statuses (id,workspace_id,project_id,key,name,type,position,is_default,is_terminal,metadata_json,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?,?,1)`,
            [
              randomUUID(),
              project.workspace_id,
              project.id,
              status.key,
              status.name,
              status.type,
              status.position,
              status.is_default,
              status.is_terminal,
              status.metadata_json,
              now,
              now
            ]
          );
    // Drop FKs that still point at workspace_statuses before remapping ids.
    // SQLite gets this window from PRAGMA foreign_keys = OFF; Postgres does not.
    await tx.exec(
      `ALTER TABLE missions DROP CONSTRAINT IF EXISTS missions_status_id_fkey, DROP CONSTRAINT IF EXISTS missions_workspace_id_status_id_fkey`
    );
    await tx.exec(
      `ALTER TABLE my_mission_positions DROP CONSTRAINT IF EXISTS my_mission_positions_status_id_fkey, DROP CONSTRAINT IF EXISTS my_mission_positions_workspace_id_status_id_fkey`
    );
    await tx.exec(
      `ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_next_status_id_fkey, DROP CONSTRAINT IF EXISTS schedules_workspace_id_next_status_id_fkey`
    );
    // Postgres UPDATE ... FROM cannot mention the target alias in a JOIN ON
    // clause (42P01: "invalid reference to FROM-clause entry for table m").
    // Correlate the target table in WHERE; JOIN ON may only bind FROM tables.
    await tx.exec(
      `UPDATE missions m SET status_id = ps.id FROM workspace_statuses ws JOIN project_statuses ps ON ps.key=ws.key WHERE ws.id=m.status_id AND ps.project_id=m.project_id`
    );
    // Soft-deleted projects were skipped in the original plan, but ADD FOREIGN KEY
    // validates every row. Fan-out now includes those projects; any remaining
    // unmatched pointer (deleted status, garbage id) falls back to the default.
    await tx.exec(
      `UPDATE missions m SET status_id = ps.id FROM project_statuses ps WHERE ps.project_id=m.project_id AND ps.is_default AND ps.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM project_statuses x WHERE x.project_id=m.project_id AND x.id=m.status_id)`
    );
    await tx.exec(`ALTER TABLE my_mission_positions ADD COLUMN project_id text`);
    await tx.exec(
      `UPDATE my_mission_positions mp SET project_id=m.project_id FROM missions m WHERE m.id=mp.mission_id`
    );
    await tx.exec(
      `UPDATE my_mission_positions mp SET status_id=ps.id FROM workspace_statuses ws JOIN project_statuses ps ON ps.key=ws.key WHERE ws.id=mp.status_id AND ps.project_id=mp.project_id`
    );
    await tx.exec(
      `UPDATE my_mission_positions mp SET status_id=ps.id FROM project_statuses ps WHERE ps.project_id=mp.project_id AND ps.is_default AND ps.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM project_statuses x WHERE x.project_id=mp.project_id AND x.id=mp.status_id)`
    );
    await tx.exec(
      `UPDATE schedules s SET next_status_key=ws.key FROM workspace_statuses ws WHERE ws.id=s.next_status_id`
    );
    const orphan = await tx.get<{ id: string }>(
      `SELECT m.id FROM missions m LEFT JOIN project_statuses ps ON ps.project_id=m.project_id AND ps.id=m.status_id WHERE ps.id IS NULL LIMIT 1`
    );
    if (orphan)
      throw new Error(
        `Project-status migration left mission ${orphan.id} without a project-scoped status`
      );
    await tx.exec(`ALTER TABLE schedules DROP COLUMN next_status_id`);
    await tx.exec(`DROP INDEX IF EXISTS idx_schedules_workspace_next_status`);
    await tx.exec(
      `ALTER TABLE missions ADD FOREIGN KEY (project_id,status_id) REFERENCES project_statuses(project_id,id) ON DELETE RESTRICT`
    );
    await tx.exec(`ALTER TABLE my_mission_positions ALTER COLUMN project_id SET NOT NULL`);
    await tx.exec(
      `ALTER TABLE my_mission_positions ADD FOREIGN KEY (project_id,status_id) REFERENCES project_statuses(project_id,id) ON DELETE CASCADE`
    );
    await tx.exec(
      `ALTER TABLE my_mission_positions ADD FOREIGN KEY (project_id,mission_id) REFERENCES missions(project_id,id) ON DELETE CASCADE`
    );
    const invalid = await tx.get(
      `SELECT 1 FROM missions m LEFT JOIN project_statuses ps ON ps.project_id=m.project_id AND ps.id=m.status_id WHERE ps.id IS NULL LIMIT 1`
    );
    const singleton = await tx.get(
      `SELECT 1 FROM projects p LEFT JOIN project_statuses ps ON ps.project_id=p.id AND ps.deleted_at IS NULL WHERE p.deleted_at IS NULL GROUP BY p.id HAVING COUNT(*) FILTER (WHERE ps.is_default) != 1 OR COUNT(*) FILTER (WHERE ps.type='execute') != 1 OR COUNT(*) FILTER (WHERE ps.type='review') != 1 LIMIT 1`
    );
    const fanout = await tx.get(
      `SELECT 1 FROM (SELECT p.workspace_id,COUNT(*) projects FROM projects p GROUP BY p.workspace_id) p LEFT JOIN (SELECT workspace_id,COUNT(*) statuses FROM workspace_statuses WHERE deleted_at IS NULL GROUP BY workspace_id) ws USING (workspace_id) LEFT JOIN (SELECT workspace_id,COUNT(*) statuses FROM project_statuses GROUP BY workspace_id) ps USING (workspace_id) WHERE COALESCE(ps.statuses,0) != p.projects * COALESCE(ws.statuses,0) LIMIT 1`
    );
    if (invalid || singleton || fanout)
      throw new Error('Project-status migration verification failed');
    // mission_status_seen.status_id contains indicator keys, not status ids; leave it untouched.
    await tx.exec('ALTER TABLE workspace_statuses RENAME TO workspace_statuses_legacy');
  });
}
