import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createPostgresClient } from './client.js';
import { migratePostgres } from './migrate-postgres.js';
import {
  compareExpected,
  EXPECTED_MISSION_ITEMS,
  FIXTURE_IDS,
  seedMissionItemsFixture,
  SELECT_FIXTURE_ITEMS_SQL,
  summariseItems
} from './mission-items.test-fixture.js';
import {
  finalizeMissionItemsPostgres,
  MISSION_ITEMS_MIGRATION_VERSION
} from './mission-items-migration-runtime.js';

/**
 * Migration `20261115120000_mission_items` (coo:1260, ADR 0060), Postgres half,
 * driven through the real runner on an upgraded database. Mirrors
 * `mission-items-migration.test.ts`. Runs only with TEST_DATABASE_URL.
 */

const connectionString = process.env.TEST_DATABASE_URL;

async function freshDatabase(url: string) {
  const pg = await import('pg');
  const Pool = (pg.default ?? pg).Pool;
  const name = `ovld_items_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE DATABASE ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.toString() });
  const client = createPostgresClient(pool, { ownsPool: true });
  return {
    client,
    teardown: async () => {
      await client.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  };
}

describe('mission items migration [postgres]', { skip: !connectionString }, () => {
  it('backfills exactly the fixture items, and a second run changes nothing', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client, { stopBeforeVersion: MISSION_ITEMS_MIGRATION_VERSION });
      await seedMissionItemsFixture(client);
      await client.run(
        `INSERT INTO mission_summaries
           (mission_id, workspace_id, project_id, status, generated_by, headline, created_at, updated_at)
         VALUES (?, ?, ?, 'composed', 'gemini', 'Kept', now(), now())`,
        [FIXTURE_IDS.missionId, FIXTURE_IDS.workspaceId, FIXTURE_IDS.projectId]
      );
      await migratePostgres(client);

      const rows = await client.all<Record<string, unknown>>(SELECT_FIXTURE_ITEMS_SQL);
      assert.deepEqual(summariseItems(rows), [...EXPECTED_MISSION_ITEMS].sort(compareExpected));
      for (const row of rows) {
        const closed = row.status === 'done' || row.status === 'dismissed';
        assert.equal(row.resolved_by_kind, closed ? 'person' : null, `${row.text}`);
        assert.equal(row.resolved_at === null, !closed, `${row.text}`);
      }

      const summary = await client.get<Record<string, unknown>>(
        `SELECT headline, generated_by, content_revision, narrative_delivery_id
           FROM mission_summaries`
      );
      assert.deepEqual(summary, {
        headline: 'Kept',
        generated_by: 'gemini',
        content_revision: 0,
        narrative_delivery_id: null
      });
      await client.run(`UPDATE mission_summaries SET generated_by = 'agent'`);
      await assert.rejects(client.run(`UPDATE mission_summaries SET generated_by = 'robot'`));
      assert.equal(
        (
          await client.get<{ present: string | null }>(
            `SELECT to_regclass('human_action_resolutions') AS present`
          )
        )?.present,
        null
      );
      const columns = await client.all<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'mission_summaries' AND column_name IN ('risks_json', 'suggestions_json')`
      );
      assert.deepEqual(columns, []);

      await finalizeMissionItemsPostgres(client);
      await migratePostgres(client);
      await finalizeMissionItemsPostgres(client);
      assert.deepEqual(await client.all(SELECT_FIXTURE_ITEMS_SQL), rows);
    } finally {
      await teardown();
    }
  });

  it('enforces the closed vocabularies and resolver invariants', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client, { stopBeforeVersion: MISSION_ITEMS_MIGRATION_VERSION });
      await seedMissionItemsFixture(client);
      await migratePostgres(client);
      const [row] = await client.all<{ id: string }>(
        `SELECT id FROM mission_items WHERE status = 'open' ORDER BY id LIMIT 1`
      );
      const id = row!.id;
      await assert.rejects(
        client.run(`UPDATE mission_items SET status = 'resolved' WHERE id = ?`, [id])
      );
      await assert.rejects(client.run(`UPDATE mission_items SET kind = 'note' WHERE id = ?`, [id]));
      // Closing needs a resolver and a time; an agent close needs a reason.
      await assert.rejects(
        client.run(`UPDATE mission_items SET status = 'done' WHERE id = ?`, [id])
      );
      await assert.rejects(
        client.run(
          `UPDATE mission_items SET status = 'done', resolved_by_kind = 'agent', resolved_at = now()
            WHERE id = ?`,
          [id]
        )
      );
      await client.run(
        `UPDATE mission_items
            SET status = 'done', resolved_by_kind = 'agent', resolved_at = now(),
                status_reason = 'Fixed by the retry guard.'
          WHERE id = ?`,
        [id]
      );
      await assert.rejects(
        client.run(`UPDATE mission_items SET status_reason = ? WHERE id = ?`, ['x'.repeat(281), id])
      );
    } finally {
      await teardown();
    }
  });
});
