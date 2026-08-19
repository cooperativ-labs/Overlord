import {
  createPostgresSessionClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createServiceContext, type ServiceContext } from './context.js';
import { allocateWorkspaceSearchLimits } from './mission-search.js';
import { createMissionWithObjectives, searchMissions, searchMissionsV2 } from './missions.js';
import { createProject } from './projects.js';
import { seedServiceOperator } from './test-helpers.js';
import { newId, nowIso } from './util.js';

interface AdapterHandle {
  client: DatabaseClient;
  teardown: () => Promise<void>;
}

interface AdapterFactory {
  label: string;
  create: () => Promise<AdapterHandle>;
}

const sqliteFactory: AdapterFactory = {
  label: 'sqlite',
  create: async () => {
    const sqlite = openInMemoryDatabase();
    return { client: createSqliteClient(sqlite), teardown: async () => sqlite.close() };
  }
};

function postgresFactory(connectionString: string): AdapterFactory {
  return {
    label: 'postgres',
    create: async () => {
      const pg = await import('pg');
      const Pool = (pg.default ?? pg).Pool;
      const schema = `ovld_search_quality_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const admin = new Pool({ connectionString });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const pool = new Pool({ connectionString });
      const session = await pool.connect();
      await session.query(`SET search_path TO ${schema}`);
      const client = createPostgresSessionClient(session);
      await migratePostgres(client);
      return {
        client,
        teardown: async () => {
          await client.close();
          session.release();
          await pool.end();
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        }
      };
    }
  };
}

const adapters: AdapterFactory[] = [sqliteFactory];
if (process.env.TEST_DATABASE_URL) adapters.push(postgresFactory(process.env.TEST_DATABASE_URL));

async function recordEvent(
  ctx: ServiceContext,
  missionId: string,
  projectId: string,
  summary: string
): Promise<void> {
  await ctx.db.run(
    `INSERT INTO mission_events (
         id, workspace_id, project_id, mission_id, type, summary, source, created_at
       ) VALUES (?, ?, ?, ?, 'update', ?, 'cli', ?)`,
    [newId(), ctx.workspace.id, projectId, missionId, summary, nowIso()]
  );
}

async function seedOperator(client: DatabaseClient): Promise<void> {
  if (client.dialect === 'postgres') {
    const now = new Date().toISOString();
    await client.run(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['local-workspace-org', 'Test Organization', now, now]
    );
    await client.run(
      `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'local', ?, ?)`,
      ['local-workspace', 'local-workspace-org', 'local-workspace', 'Test Workspace', now, now]
    );
    await client.run(
      `INSERT INTO mission_sequences
         (id, workspace_id, scope_type, scope_id, counter_name, next_value, updated_at)
       VALUES (?, ?, 'workspace', ?, 'mission', 1, ?)`,
      ['local-workspace-mission-seq', 'local-workspace', 'local-workspace', now]
    );
    await client.run(
      `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      ['operator-user', 'operator-user', 'operator-user@overlord.local', true, now, now]
    );
    await client.run(
      `INSERT INTO workspace_users (
         id, workspace_id, profile_id, member_key, status, metadata_json,
         created_at, updated_at, revision
       ) VALUES (?, ?, ?, ?, 'active', '{}', ?, ?, 1)`,
      [
        'operator-workspace-user',
        'local-workspace',
        'operator-user',
        'auth:operator-user',
        now,
        now
      ]
    );
    await client.run(
      `INSERT INTO role_assignments (
         id, workspace_id, workspace_user_id, role_key, resource_type, resource_id,
         assigned_by_workspace_user_id, created_at, updated_at, revision
       ) VALUES (?, ?, ?, 'ADMIN', '', '', ?, ?, ?, 1)`,
      [
        'operator-workspace-user-admin-role',
        'local-workspace',
        'operator-workspace-user',
        'operator-workspace-user',
        now,
        now
      ]
    );
    return;
  }
  await seedServiceOperator({ db: client });
}

async function setup(client: DatabaseClient): Promise<{
  ctx: ServiceContext;
  projectId: string;
}> {
  await seedOperator(client);
  const ctx = await createServiceContext({ db: client, source: 'cli' });
  const project = await createProject({ ctx, name: 'Search Quality Project' });
  return { ctx, projectId: project.id };
}

for (const adapter of adapters) {
  describe(`portable mission search quality (${adapter.label})`, () => {
    it('does not return the whole workspace for a vague conversational query', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const target = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Stop the webhooks from firing too fast',
          objectives: [{ objective: 'Tune the webhook delivery backoff' }]
        });
        const decoys: Array<{ mission: { id: string } }> = [];
        for (const title of [
          'Alpha parser rewrite',
          'Board layout polish',
          'Neon branch diagnostics',
          'Latch card spacing',
          'Invoice CSV export'
        ]) {
          decoys.push(
            await createMissionWithObjectives({
              ctx,
              projectId,
              title,
              objectives: [{ objective: `Unrelated work for ${title}` }]
            })
          );
        }

        const v2 = await searchMissionsV2({
          ctx,
          query: 'that thing where we were going to stop the webhooks from firing too fast'
        });
        const ids = v2.results.map(result => result.id);
        assert.equal(v2.version, 2);
        assert.equal(v2.appliedFilters.mode, 'any');
        assert.ok((v2.appliedFilters.coverageFloor ?? 0) >= 2);
        assert.ok(ids.includes(target.mission.id));
        assert.equal(v2.results[0]?.id, target.mission.id);
        assert.ok(ids.length < 1 + decoys.length, 'relevance floor must hide unrelated missions');
        assert.ok(v2.totalMatchedBeforeLimit >= ids.length);
        assert.ok(v2.totalMatchedBeforeLimit < 1 + decoys.length);
        assert.ok(v2.results[0]?.matchedTerms.includes('webhooks'));
        assert.ok(v2.results[0]?.snippet);
        assert.equal(v2.results[0]?.projectName, 'Search Quality Project');
        assert.equal(v2.workspaceCounts[0]?.workspaceId, ctx.workspace.id);
      } finally {
        await handle.teardown();
      }
    });

    it('filters by due date and excludes missions that were never scheduled', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const dueTomorrow = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Ship the investor portal login',
          dueDatetime: '2026-08-20T09:00:00.000Z',
          objectives: [{ objective: 'Wire up the SSO handshake' }]
        });
        await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Quarterly compliance filing',
          dueDatetime: '2026-08-28T09:00:00.000Z',
          objectives: [{ objective: 'Collate the filings' }]
        });
        await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Unscheduled backlog item',
          objectives: [{ objective: 'Someday' }]
        });

        const tomorrow = await searchMissionsV2({
          ctx,
          query: '',
          dateField: 'dueDatetime',
          from: '2026-08-20T00:00:00.000Z',
          to: '2026-08-21T00:00:00.000Z'
        });
        assert.equal(tomorrow.appliedFilters.dateField, 'dueDatetime');
        assert.deepEqual(
          tomorrow.results.map(result => result.id),
          [dueTomorrow.mission.id]
        );
        // A due-date window is a question about scheduled work, so a mission with
        // no due date is absent rather than sorted last.
        assert.equal(tomorrow.totalMatchedBeforeLimit, 1);

        // The column is on every result regardless of filtering, so a caller can
        // report the date it just filtered on.
        const unfiltered = await searchMissionsV2({ ctx, query: '' });
        assert.equal(unfiltered.results.length, 3);
        assert.equal(unfiltered.results.filter(result => result.dueDatetime !== null).length, 2);
      } finally {
        await handle.teardown();
      }
    });

    it('ranks an exact title above a 25-event chatter mission', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const titled = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Moonbeam telemetry overhaul',
          objectives: [{ objective: 'baseline one' }]
        });
        const chatty = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Unrelated logging cleanup',
          objectives: [{ objective: 'baseline two' }]
        });
        for (let index = 0; index < 25; index += 1) {
          await recordEvent(
            ctx,
            chatty.mission.id,
            projectId,
            `Progress note ${index}: discussed moonbeam edge cases with the team`
          );
        }

        const ranked = await searchMissions({ ctx, query: 'moonbeam' });
        assert.equal(ranked[0]?.id, titled.mission.id);
        assert.ok(ranked.some(mission => mission.id === chatty.mission.id));
      } finally {
        await handle.teardown();
      }
    });

    it('short-circuits an exact display id instead of prefix-matching the workspace', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const first = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'First mission',
          objectives: [{ objective: 'baseline' }]
        });
        await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Second mission',
          objectives: [{ objective: 'baseline' }]
        });
        await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Third mission',
          objectives: [{ objective: 'baseline' }]
        });

        const v2 = await searchMissionsV2({ ctx, query: first.mission.displayId });
        assert.equal(v2.appliedFilters.mode, 'display_id');
        assert.deepEqual(
          v2.results.map(result => result.id),
          [first.mission.id]
        );
        assert.equal(v2.totalMatchedBeforeLimit, 1);
        assert.ok(v2.results[0]?.matchedIn.includes('displayId'));
      } finally {
        await handle.teardown();
      }
    });

    it('keeps an old exact title ahead of a recent weak match', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const exact = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Redis decision log',
          objectives: [{ objective: 'Decide whether to use Redis' }]
        });
        const recent = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Cache layer notes',
          objectives: [{ objective: 'Mention redis only in passing' }]
        });
        await ctx.db.run(`UPDATE missions SET updated_at = ? WHERE id = ?`, [
          '2020-01-01T00:00:00.000Z',
          exact.mission.id
        ]);
        await ctx.db.run(`UPDATE missions SET updated_at = ? WHERE id = ?`, [
          '2999-01-01T00:00:00.000Z',
          recent.mission.id
        ]);

        const v2 = await searchMissionsV2({ ctx, query: 'Redis decision log' });
        assert.equal(v2.results[0]?.id, exact.mission.id);
        assert.ok(v2.results[0]?.relevance !== undefined);
      } finally {
        await handle.teardown();
      }
    });

    it('keeps complete and cancelled missions eligible by default', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const complete = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Krypton storage migration',
          objectives: [{ objective: 'baseline' }]
        });
        await ctx.db.run(`UPDATE missions SET status_type = 'complete' WHERE id = ?`, [
          complete.mission.id
        ]);
        const found = await searchMissions({ ctx, query: 'krypton' });
        assert.ok(found.some(mission => mission.id === complete.mission.id));
      } finally {
        await handle.teardown();
      }
    });

    it('flags recency fallback instead of pretending punctuation is a match set', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Fallback mission',
          objectives: [{ objective: 'baseline' }]
        });
        const v2 = await searchMissionsV2({ ctx, query: '???' });
        assert.equal(v2.appliedFilters.mode, 'fallback');
        assert.equal(v2.appliedFilters.coverageFloor, null);
        assert.ok(v2.totalMatchedBeforeLimit >= 1);
        assert.equal(v2.results[0]?.matchedTerms.length, 0);
      } finally {
        await handle.teardown();
      }
    });

    it('applies explicit date bounds and reports the filter without a hidden window', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const old = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Old date-filter mission',
          objectives: [{ objective: 'baseline' }]
        });
        const fresh = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Fresh date-filter mission',
          objectives: [{ objective: 'baseline' }]
        });
        await ctx.db.run(`UPDATE missions SET updated_at = ? WHERE id = ?`, [
          '2020-01-01T00:00:00.000Z',
          old.mission.id
        ]);
        await ctx.db.run(`UPDATE missions SET updated_at = ? WHERE id = ?`, [
          '2026-01-01T00:00:00.000Z',
          fresh.mission.id
        ]);
        const v2 = await searchMissionsV2({
          ctx,
          query: 'date-filter',
          from: '2025-01-01T00:00:00.000Z',
          to: '2027-01-01T00:00:00.000Z'
        });
        assert.deepEqual(
          v2.results.map(result => result.id),
          [fresh.mission.id]
        );
        assert.equal(v2.appliedFilters.dateField, 'updatedAt');
        assert.equal(v2.appliedFilters.from, '2025-01-01T00:00:00.000Z');
        assert.equal(v2.appliedFilters.to, '2027-01-01T00:00:00.000Z');
      } finally {
        await handle.teardown();
      }
    });

    it('filters by a live objective resource key without denormalizing it into search documents', async () => {
      const handle = await adapter.create();
      try {
        const { ctx, projectId } = await setup(handle.client);
        const matching = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Resource-filter matching mission',
          objectives: [{ objective: 'baseline' }]
        });
        const other = await createMissionWithObjectives({
          ctx,
          projectId,
          title: 'Resource-filter other mission',
          objectives: [{ objective: 'baseline' }]
        });
        await ctx.db.run(`UPDATE objectives SET resource_key = 'mobile' WHERE mission_id = ?`, [
          matching.mission.id
        ]);
        const v2 = await searchMissionsV2({
          ctx,
          query: 'resource-filter',
          resourceKeys: ['mobile']
        });
        assert.deepEqual(
          v2.results.map(result => result.id),
          [matching.mission.id]
        );
        assert.deepEqual(v2.appliedFilters.resourceKeys, ['mobile']);
        assert.notEqual(other.mission.id, matching.mission.id);
      } finally {
        await handle.teardown();
      }
    });
  });
}

describe('workspace search quotas', () => {
  it('splits cap deterministically and never redistributes unused slots', () => {
    assert.deepEqual(
      [...allocateWorkspaceSearchLimits({ workspaceIds: ['z', 'a', 'm'], limit: 8 })],
      [
        ['a', 3],
        ['m', 3],
        ['z', 2]
      ]
    );
  });
});

if (!process.env.TEST_DATABASE_URL) {
  describe('portable mission search quality (postgres)', () => {
    it('skips when TEST_DATABASE_URL is unset', () => {
      assert.ok(true, 'Postgres battery skipped; SQLite battery ran.');
    });
  });
}
