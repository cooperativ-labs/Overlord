import { randomUUID } from 'node:crypto';

import type { BetterSqlite3Database } from './better-sqlite3-loader.js';

const MIGRATION_VERSION = '20260819100000';
const OLD_TYPES = "'draft','execute','review','complete','blocked','cancelled'";
const NEW_TYPES = "'draft','next','execute','review','complete','blocked','cancelled'";

export function isNextStatusTypeMigration(migration: { version: string }): boolean {
  return migration.version === MIGRATION_VERSION;
}

function tableSql(db: BetterSqlite3Database, name: string): string {
  const row = db
    .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`)
    .get(name) as { sql: string } | undefined;
  if (!row?.sql) throw new Error(`Missing ${name} while migrating next status type`);
  return row.sql;
}

function tableColumns(db: BetterSqlite3Database, name: string): string {
  return (
    db.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY cid`).all(name) as Array<{
      name: string;
    }>
  )
    .map(row => `"${row.name.replaceAll('"', '""')}"`)
    .join(', ');
}

function indexesAndTriggers(db: BetterSqlite3Database, table: string): string[] {
  return (
    db
      .prepare(
        `SELECT sql FROM sqlite_schema
          WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL
          ORDER BY type, name`
      )
      .all(table) as Array<{ sql: string }>
  ).map(row => row.sql);
}

function replacementTableSql(sql: string, oldName: string): string {
  const renamed = sql.replace(`CREATE TABLE ${oldName}`, `CREATE TABLE ${oldName}_before_next`);
  if (renamed === sql) throw new Error(`Could not rename ${oldName} table DDL`);
  return sql.replace(OLD_TYPES, NEW_TYPES);
}

function rebuildTableWithNextType(db: BetterSqlite3Database, name: string): void {
  const sql = tableSql(db, name);
  if (sql.includes(NEW_TYPES)) return;
  const dependentSql = indexesAndTriggers(db, name);
  const columns = tableColumns(db, name);

  // Keeping legacy ALTER behavior while foreign keys are disabled preserves the
  // child tables' references to the replacement table name.
  db.exec(`ALTER TABLE ${name} RENAME TO ${name}_before_next`);
  db.exec(replacementTableSql(sql, name));
  db.exec(`INSERT INTO ${name} (${columns}) SELECT ${columns} FROM ${name}_before_next`);
  db.exec(`DROP TABLE ${name}_before_next`);
  for (const statement of dependentSql) db.exec(statement);
}

/** Upgrade v93 project-status and mission checks without rewriting applied SQL files. */
export function finalizeNextStatusTypeSqlite(db: BetterSqlite3Database): void {
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'project_statuses'`)
    .get();
  if (!exists) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  try {
    db.exec('BEGIN');
    rebuildTableWithNextType(db, 'project_statuses');
    rebuildTableWithNextType(db, 'missions');

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE project_statuses SET type = 'next', updated_at = ?, revision = revision + 1
        WHERE key = 'next_up' AND type = 'draft' AND deleted_at IS NULL`
    ).run(now);
    for (const project of db
      .prepare(
        `SELECT p.id, p.workspace_id FROM projects p
          WHERE p.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM project_statuses ps
              WHERE ps.project_id = p.id AND ps.type = 'next' AND ps.deleted_at IS NULL
            )`
      )
      .all() as Array<{ id: string; workspace_id: string }>) {
      const position = (
        db
          .prepare(
            `SELECT COALESCE(MAX(position), -1) + 1 AS position
              FROM project_statuses WHERE project_id = ? AND deleted_at IS NULL`
          )
          .get(project.id) as { position: number }
      ).position;
      db.prepare(
        `INSERT INTO project_statuses
           (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, metadata_json, created_at, updated_at, revision)
         VALUES (?, ?, ?, 'next_up', 'Next Up', 'next', ?, 0, 0, '{}', ?, ?, 1)`
      ).run(randomUUID(), project.workspace_id, project.id, position, now, now);
    }
    db.exec(
      `UPDATE missions
          SET status_type = (
            SELECT type FROM project_statuses ps
             WHERE ps.project_id = missions.project_id AND ps.id = missions.status_id
          )
        WHERE status_id IN (SELECT id FROM project_statuses WHERE type = 'next')`
    );
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_statuses_active_next
         ON project_statuses (project_id) WHERE type = 'next' AND deleted_at IS NULL`
    );
    const invalid = db
      .prepare(
        `SELECT 1 FROM projects p
          LEFT JOIN project_statuses ps ON ps.project_id = p.id AND ps.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
         GROUP BY p.id
        HAVING SUM(ps.type = 'next') != 1
         LIMIT 1`
      )
      .get();
    if (invalid)
      throw new Error('Next-status migration could not establish one next status per project');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF');
    db.exec('PRAGMA foreign_keys = ON');
  }
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('Next-status migration foreign-key verification failed');
}
