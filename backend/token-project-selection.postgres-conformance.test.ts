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

import { generateUserTokenSecret } from '../auth/src/index.ts';

import { seedAuthenticatedOperatorClient } from './test-helpers.ts';

/**
 * Contract v151 `user_token_projects` allowlist constraints, on both editions.
 *
 * The migration pair `20260928100000_project_automation_tokens.sql` must give
 * SQLite triggers and Postgres trigger functions identical semantics: a selected
 * project belongs to a `project_automation` token whose consent names the
 * project's workspace inside the token's organization; consent removal drops
 * the selection; and a token cannot leave the preset while selections exist.
 */

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
    return {
      client: createSqliteClient(sqlite),
      teardown: async () => {
        sqlite.close();
      }
    };
  }
};

function postgresFactory(connectionString: string): AdapterFactory {
  return {
    label: 'postgres',
    create: async () => {
      const pg = await import('pg');
      const Pool = (pg.default ?? pg).Pool;
      const schema = `ovld_token_projects_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
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

const now = () => new Date().toISOString();

async function insertToken(
  client: DatabaseClient,
  {
    id,
    organizationId,
    scope = 'project_automation',
    allWorkspaces = false
  }: {
    id: string;
    organizationId: string;
    scope?: 'full' | 'mission_lifecycle' | 'project_automation';
    allWorkspaces?: boolean;
  }
): Promise<void> {
  const minted = generateUserTokenSecret();
  await client.run(
    `INSERT INTO user_tokens (
       id, workspace_id, organization_id, all_workspaces, profile_id, label, scope,
       token_prefix, token_hash, hash_algorithm, status, last_used_context_json,
       metadata_json, created_at, updated_at, revision
     ) VALUES (?, NULL, ?, ${allWorkspaces ? 'TRUE' : 'FALSE'}, 'owner', ?, ?, ?, ?, 'sha256', 'active', '{}', '{}', ?, ?, 1)`,
    [id, organizationId, id, scope, minted.prefix, minted.hash, now(), now()]
  );
}

async function consent(client: DatabaseClient, tokenId: string, workspaceId: string) {
  await client.run(
    `INSERT INTO user_token_workspaces (token_id, workspace_id, created_at) VALUES (?, ?, ?)`,
    [tokenId, workspaceId, now()]
  );
}

async function insertProject(client: DatabaseClient, id: string, workspaceId: string) {
  await client.run(
    `INSERT INTO projects (id, workspace_id, slug, name, description, status, settings_json, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, NULL, 'active', '{}', ?, ?, 1)`,
    [id, workspaceId, id, id, now(), now()]
  );
}

async function select(client: DatabaseClient, tokenId: string, projectId: string) {
  await client.run(
    `INSERT INTO user_token_projects (token_id, project_id, created_at) VALUES (?, ?, ?)`,
    [tokenId, projectId, now()]
  );
}

async function selections(client: DatabaseClient, tokenId: string): Promise<string[]> {
  const rows = await client.all<{ project_id: string }>(
    `SELECT project_id FROM user_token_projects WHERE token_id = ? ORDER BY project_id`,
    [tokenId]
  );
  return rows.map(row => row.project_id);
}

async function seedTwoOrganizations(client: DatabaseClient): Promise<void> {
  for (const [organizationId, workspaceId, workspaceUserId] of [
    ['org-a', 'ws-a', 'member-a'],
    ['org-a', 'ws-a2', 'member-a2'],
    ['org-b', 'ws-b', 'member-b']
  ]) {
    await seedAuthenticatedOperatorClient({
      client,
      organizationId,
      workspaceId,
      profileId: 'owner',
      workspaceUserId
    });
  }
  await insertProject(client, 'project-p', 'ws-a');
  await insertProject(client, 'project-q', 'ws-a');
  await insertProject(client, 'project-a2', 'ws-a2');
  await insertProject(client, 'project-b', 'ws-b');
}

for (const adapter of adapters) {
  describe(`project_automation selection allowlist [${adapter.label}]`, () => {
    it('accepts only projects in a consented workspace of the token organization', async () => {
      const { client, teardown } = await adapter.create();
      try {
        await seedTwoOrganizations(client);
        await insertToken(client, { id: 'auto', organizationId: 'org-a' });
        await consent(client, 'auto', 'ws-a');

        await select(client, 'auto', 'project-p');
        await select(client, 'auto', 'project-q');
        assert.deepEqual(await selections(client, 'auto'), ['project-p', 'project-q']);

        // Same organization, workspace without consent.
        await assert.rejects(select(client, 'auto', 'project-a2'), /consented workspace/);
        // Another organization entirely.
        await assert.rejects(select(client, 'auto', 'project-b'), /consented workspace/);
        // Unknown project id fails on the foreign key or the guard, never silently.
        await assert.rejects(select(client, 'auto', 'missing-project'));
        // Duplicate pairs are rejected by the primary key.
        await assert.rejects(select(client, 'auto', 'project-p'));

        const scope = await client.get<{ scope: string }>(
          `SELECT scope FROM user_tokens WHERE id = ?`,
          ['auto']
        );
        assert.equal(scope?.scope, 'project_automation');
      } finally {
        await teardown();
      }
    });

    it('rejects selections for full, mission_lifecycle and all-workspaces tokens', async () => {
      const { client, teardown } = await adapter.create();
      try {
        await seedTwoOrganizations(client);
        await insertToken(client, { id: 'full', organizationId: 'org-a', scope: 'full' });
        await consent(client, 'full', 'ws-a');
        await assert.rejects(select(client, 'full', 'project-p'), /consented workspace/);

        await insertToken(client, {
          id: 'lifecycle',
          organizationId: 'org-a',
          scope: 'mission_lifecycle'
        });
        await consent(client, 'lifecycle', 'ws-a');
        await assert.rejects(select(client, 'lifecycle', 'project-p'), /consented workspace/);

        await insertToken(client, {
          id: 'broad',
          organizationId: 'org-a',
          allWorkspaces: true
        });
        await consent(client, 'broad', 'ws-a');
        await assert.rejects(select(client, 'broad', 'project-p'), /consented workspace/);
      } finally {
        await teardown();
      }
    });

    it('drops selections when consent is withdrawn and refuses to widen a selecting token', async () => {
      const { client, teardown } = await adapter.create();
      try {
        await seedTwoOrganizations(client);
        await insertToken(client, { id: 'auto', organizationId: 'org-a' });
        await consent(client, 'auto', 'ws-a');
        await consent(client, 'auto', 'ws-a2');
        await select(client, 'auto', 'project-p');
        await select(client, 'auto', 'project-a2');

        await assert.rejects(
          client.run(`UPDATE user_tokens SET scope = 'full' WHERE id = ?`, ['auto']),
          /cannot outlive/
        );
        await assert.rejects(
          client.run(`UPDATE user_tokens SET all_workspaces = TRUE WHERE id = ?`, ['auto']),
          /cannot outlive/
        );
        // Label renames and revocation never touch the allowlist.
        await client.run(`UPDATE user_tokens SET label = 'renamed' WHERE id = ?`, ['auto']);
        await client.run(`UPDATE user_tokens SET status = 'revoked' WHERE id = ?`, ['auto']);
        assert.deepEqual(await selections(client, 'auto'), ['project-a2', 'project-p']);

        await client.run(
          `DELETE FROM user_token_workspaces WHERE token_id = ? AND workspace_id = ?`,
          ['auto', 'ws-a2']
        );
        assert.deepEqual(await selections(client, 'auto'), ['project-p']);

        await client.run(`DELETE FROM projects WHERE id = ?`, ['project-p']);
        assert.deepEqual(await selections(client, 'auto'), []);

        await select(client, 'auto', 'project-q');
        await client.run(`DELETE FROM user_token_scopes WHERE token_id = ?`, ['auto']);
        await client.run(`DELETE FROM user_tokens WHERE id = ?`, ['auto']);
        assert.deepEqual(await selections(client, 'auto'), []);
      } finally {
        await teardown();
      }
    });

    it('stores mission creator attribution as soft references that outlive the token', async () => {
      const { client, teardown } = await adapter.create();
      try {
        await seedTwoOrganizations(client);
        const columns = await client.all<{ name: string }>(
          client.dialect === 'postgres'
            ? `SELECT column_name AS name FROM information_schema.columns
                WHERE table_name = 'missions' AND table_schema = current_schema()
                  AND column_name IN ('created_by_token_id', 'created_by_token_label')`
            : `SELECT name FROM pragma_table_info('missions')
                WHERE name IN ('created_by_token_id', 'created_by_token_label')`
        );
        assert.deepEqual(columns.map(column => column.name).sort(), [
          'created_by_token_id',
          'created_by_token_label'
        ]);
        // A soft reference accepts an id no token row carries.
        await client.run(
          `INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, created_at, updated_at, revision)
           VALUES ('status-p', 'ws-a', 'project-p', 'next', 'Next', 'next', 0, TRUE, FALSE, ?, ?, 1)`,
          [now(), now()]
        );
        await client.run(
          `INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type,
             board_position, priority, execution_target_intent_json, metadata_json, created_by_kind,
             created_by_token_id, created_by_token_label, created_at, updated_at, revision)
           VALUES ('mission-1', 'ws-a', 'project-p', 'ws-a:1', 1, 'Filed by automation', 'status-p', 'next',
             1, 'normal', '{}', '{}', 'human', 'deleted-token', 'Importer v1', ?, ?, 1)`,
          [now(), now()]
        );
        const row = await client.get<{
          created_by_token_id: string;
          created_by_token_label: string;
        }>(
          `SELECT created_by_token_id, created_by_token_label FROM missions WHERE id = 'mission-1'`
        );
        assert.deepEqual(row, {
          created_by_token_id: 'deleted-token',
          created_by_token_label: 'Importer v1'
        });
      } finally {
        await teardown();
      }
    });
  });
}
