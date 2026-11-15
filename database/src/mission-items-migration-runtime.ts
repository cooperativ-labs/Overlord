import { readDeliveryReportFromPayload } from '@overlord/contract/delivery-report';
import { randomUUID } from 'node:crypto';

import type { BetterSqlite3Database } from './better-sqlite3-loader.js';
import type { DatabaseClient } from './client.js';
import {
  COPY_HUMAN_ACTION_RESOLUTIONS_SQL,
  deriveMissionItems,
  insertMissionItemParams,
  insertMissionItemsSql,
  type MissionItemDeliveryScope,
  SUPERSEDED_ITEM_PREDICATE_SQL,
  supersedeMissionItemsSql
} from './mission-items.js';

/**
 * Backfill of `mission_items` (coo:1260, ADR 0060), run once by both migration
 * runners right after `<version>_mission_items.sql`:
 *
 * 1. every live delivery, in id order and in batches: derive its items from the
 *    stored report with the same reader and derivation the live write path
 *    uses, and insert them as `open` rows (existing rows are left alone);
 * 2. copy each `human_action_resolutions` row onto its suggestion row, so every
 *    decision a person made survives;
 * 3. apply the supersede rules to the rows that are still `open`.
 *
 * Resolutions are copied before superseding so a decided suggestion on a
 * delivery made before its objective reopened keeps the decision instead of
 * becoming `superseded`. Every step only touches rows that are absent or still
 * `open`, so running the step again changes nothing.
 */

export const MISSION_ITEMS_MIGRATION_VERSION = '20261115120000';

/** Deliveries read per batch; each batch inserts its items in one transaction. */
export const MISSION_ITEMS_BACKFILL_BATCH_SIZE = 200;

/** Rows per multi-row INSERT; well under SQLite's bind-parameter limit. */
const INSERT_CHUNK_ROWS = 200;

export function isMissionItemsMigration(migration: {
  version: string;
  component: string;
}): boolean {
  return migration.version === MISSION_ITEMS_MIGRATION_VERSION && migration.component === 'core';
}

interface DeliveryRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
  delivered_at: string;
  summary: string;
  payload_json: unknown;
}

/**
 * Keyset over the delivery id. Item order does not depend on delivery order
 * (supersede rules run afterwards, in SQL), and an id cursor is exact in both
 * editions, unlike a timestamp that Postgres stores more precisely than the
 * ISO strings the client returns.
 */
const SELECT_DELIVERY_BATCH_SQL = `SELECT id, workspace_id, project_id, mission_id, objective_id,
         delivered_at, summary, payload_json
    FROM deliveries
   WHERE deleted_at IS NULL AND id > ?
   ORDER BY id ASC
   LIMIT ?`;

function batchParams(cursor: string): unknown[] {
  return [cursor, MISSION_ITEMS_BACKFILL_BATCH_SIZE];
}

/** Insert statements (SQL and flat params) for one batch of deliveries. */
function insertStatements(
  rows: DeliveryRow[],
  now: string
): Array<{ sql: string; params: unknown[] }> {
  const values: unknown[][] = [];
  for (const row of rows) {
    const delivery: MissionItemDeliveryScope = {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      deliveredAt: row.delivered_at
    };
    const report = readDeliveryReportFromPayload(row.payload_json, row.summary);
    for (const item of deriveMissionItems(report)) {
      values.push(insertMissionItemParams({ id: randomUUID(), delivery, item, now }));
    }
  }
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  for (let start = 0; start < values.length; start += INSERT_CHUNK_ROWS) {
    const chunk = values.slice(start, start + INSERT_CHUNK_ROWS);
    statements.push({ sql: insertMissionItemsSql(chunk.length), params: chunk.flat() });
  }
  return statements;
}

function nextCursor(rows: DeliveryRow[], previous: string): string {
  return rows[rows.length - 1]?.id ?? previous;
}

function sqliteTableExists(db: BetterSqlite3Database, table: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(table)
  );
}

export function finalizeMissionItemsSqlite(db: BetterSqlite3Database): void {
  if (!sqliteTableExists(db, 'mission_items')) return;
  const now = new Date().toISOString();
  const selectBatch = db.prepare(SELECT_DELIVERY_BATCH_SQL);

  const insertBatch = db.transaction((rows: DeliveryRow[]) => {
    for (const statement of insertStatements(rows, now)) {
      db.prepare(statement.sql).run(...statement.params);
    }
  });

  let cursor = '';
  for (;;) {
    const rows = selectBatch.all(...batchParams(cursor)) as DeliveryRow[];
    if (rows.length === 0) break;
    insertBatch(rows);
    cursor = nextCursor(rows, cursor);
    if (rows.length < MISSION_ITEMS_BACKFILL_BATCH_SIZE) break;
  }

  db.transaction(() => {
    if (sqliteTableExists(db, 'human_action_resolutions')) {
      db.prepare(COPY_HUMAN_ACTION_RESOLUTIONS_SQL).run(now);
    }
    db.prepare(supersedeMissionItemsSql(SUPERSEDED_ITEM_PREDICATE_SQL)).run(now);
  })();
}

async function postgresTableExists(client: DatabaseClient, table: string): Promise<boolean> {
  const row = await client.get<{ present: string | null }>(`SELECT to_regclass(?) AS present`, [
    table
  ]);
  return Boolean(row?.present);
}

export async function finalizeMissionItemsPostgres(client: DatabaseClient): Promise<void> {
  if (!(await postgresTableExists(client, 'mission_items'))) return;
  const now = new Date().toISOString();

  let cursor = '';
  for (;;) {
    const rows = await client.all<DeliveryRow>(SELECT_DELIVERY_BATCH_SQL, batchParams(cursor));
    if (rows.length === 0) break;
    await client.transaction(async tx => {
      for (const statement of insertStatements(rows, now)) {
        await tx.run(statement.sql, statement.params);
      }
    });
    cursor = nextCursor(rows, cursor);
    if (rows.length < MISSION_ITEMS_BACKFILL_BATCH_SIZE) break;
  }

  const hasResolutions = await postgresTableExists(client, 'human_action_resolutions');
  await client.transaction(async tx => {
    if (hasResolutions) await tx.run(COPY_HUMAN_ACTION_RESOLUTIONS_SQL, [now]);
    await tx.run(supersedeMissionItemsSql(SUPERSEDED_ITEM_PREDICATE_SQL), [now]);
  });
}
