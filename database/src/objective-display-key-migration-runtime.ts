import type { BetterSqlite3Database } from './better-sqlite3-loader.js';
import type { DatabaseClient } from './client.js';
import { generateObjectiveDisplayKey } from './objective-display-key.js';

export const OBJECTIVES_DISPLAY_KEY_MIGRATION_VERSION = '20260817104735';

export function isObjectivesDisplayKeyMigration(migration: {
  version: string;
  component: string;
}): boolean {
  return (
    migration.version === OBJECTIVES_DISPLAY_KEY_MIGRATION_VERSION && migration.component === 'core'
  );
}

function isBlankKey(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function allocateKey(used: Set<string>): string {
  for (const length of [4, 5] as const) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const key = generateObjectiveDisplayKey({ length });
      if (!used.has(key)) {
        used.add(key);
        return key;
      }
    }
  }
  throw new Error('Could not allocate an objective display key during backfill');
}

function objectivesHasDisplayKeyColumn(db: BetterSqlite3Database): boolean {
  const columns = db.prepare(`PRAGMA table_info(objectives)`).all() as Array<{ name: string }>;
  return columns.some(column => column.name === 'display_key');
}

export function finalizeObjectivesDisplayKeySqlite(db: BetterSqlite3Database): void {
  if (!objectivesHasDisplayKeyColumn(db)) return;

  const rows = db
    .prepare(
      `SELECT id, mission_id, display_key
         FROM objectives
        ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{ id: string; mission_id: string; display_key: string | null }>;

  const usedByMission = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = row.display_key?.trim().toLowerCase();
    if (!key) continue;
    const used = usedByMission.get(row.mission_id) ?? new Set<string>();
    used.add(key);
    usedByMission.set(row.mission_id, used);
  }

  const update = db.prepare(`UPDATE objectives SET display_key = ? WHERE id = ?`);
  for (const row of rows) {
    if (!isBlankKey(row.display_key)) continue;
    const used = usedByMission.get(row.mission_id) ?? new Set<string>();
    const key = allocateKey(used);
    usedByMission.set(row.mission_id, used);
    update.run(key, row.id);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_objectives_mission_display_key
      ON objectives (mission_id, display_key)
      WHERE deleted_at IS NULL
  `);
}

export async function finalizeObjectivesDisplayKeyPostgres(client: DatabaseClient): Promise<void> {
  const column = await client.get<{ present: string | null }>(
    `SELECT column_name AS present
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'objectives'
        AND column_name = 'display_key'`
  );
  if (!column?.present) return;

  const rows = await client.all<{ id: string; mission_id: string; display_key: string | null }>(
    `SELECT id, mission_id, display_key
       FROM objectives
      ORDER BY created_at ASC, id ASC`
  );

  const usedByMission = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = row.display_key?.trim().toLowerCase();
    if (!key) continue;
    const used = usedByMission.get(row.mission_id) ?? new Set<string>();
    used.add(key);
    usedByMission.set(row.mission_id, used);
  }

  for (const row of rows) {
    if (!isBlankKey(row.display_key)) continue;
    const used = usedByMission.get(row.mission_id) ?? new Set<string>();
    const key = allocateKey(used);
    usedByMission.set(row.mission_id, used);
    await client.run(`UPDATE objectives SET display_key = ? WHERE id = ?`, [key, row.id]);
  }

  await client.exec(`ALTER TABLE objectives ALTER COLUMN display_key SET NOT NULL`);
  await client.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_objectives_mission_display_key
      ON objectives (mission_id, display_key)
      WHERE deleted_at IS NULL
  `);
}
