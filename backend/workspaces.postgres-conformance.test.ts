import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase,
  DEFAULT_TEST_ORGANIZATION_ID
} from './test-helpers.ts';

/**
 * Adapter conformance for workspace/organization creation on the hosted-backend
 * Postgres path.
 *
 * The same battery runs against SQLite (always) and PostgreSQL (when
 * `TEST_DATABASE_URL` points at a reachable Postgres). It covers `createWorkspace`'s
 * org-scoped slug uniqueness (`UNIQUE (organization_id, slug) WHERE deleted_at IS
 * NULL`, coo:135) — the same slug is rejected within one organization but allowed
 * across two different ones.
 */

const adapters = conformanceAdapters();

/** A migrated conformance database bound to the webapp modules with an ADMIN operator. */
async function open(adapter: ConformanceAdapter) {
  const handle = await createConformanceDatabase(adapter, 'ovld_ws_test');
  await bindWebappDatabaseClient({ client: handle.db });
  return handle;
}

for (const adapter of adapters) {
  describe(`createWorkspace conformance [${adapter}]`, () => {
    it('creates a workspace with a server-generated UUID id and a derived slug', async () => {
      const { cleanup } = await open(adapter);
      try {
        const { createWorkspace } = await import('./workspaces.ts');
        const created = await createWorkspace({
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          name: 'Conformance Workspace'
        });

        assert.equal(created.name, 'Conformance Workspace');
        assert.equal(created.organizationId, DEFAULT_TEST_ORGANIZATION_ID);
        assert.match(created.id, /^[0-9a-f-]{36}$/i);
        assert.ok(created.slug.length > 0);
        assert.equal(created.isActive, true);
      } finally {
        await cleanup();
      }
    });

    it('rejects a duplicate slug within the same organization but allows it across organizations', async () => {
      const { db: client, cleanup } = await open(adapter);
      try {
        const { createWorkspace } = await import('./workspaces.ts');

        const first = await createWorkspace({
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          name: 'Engineering HQ',
          slug: 'eng'
        });
        assert.equal(first.slug, 'eng');

        // Same organization, same requested slug: uniquified with a numeric suffix
        // rather than colliding (createWorkspace never trips the unique index).
        const second = await createWorkspace({
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          name: 'Duplicate HQ',
          slug: 'eng'
        });
        assert.equal(second.slug, 'eng-2');

        // A second organization may reuse the exact same slug — uniqueness is
        // per-organization (`idx_workspaces_organization_slug`), not instance-wide.
        const now = new Date().toISOString();
        const otherOrganizationId = randomUUID();
        await client.run(
          `INSERT INTO organizations (id, name, settings_json, created_at, updated_at, revision)
           VALUES (?, ?, '{}', ?, ?, 1)`,
          [otherOrganizationId, 'Other Organization', now, now]
        );
        // createWorkspace's org-admin gate requires an existing ADMIN membership;
        // seed one directly for the operator in the new organization.
        const otherWorkspaceId = randomUUID();
        await client.run(
          `INSERT INTO workspaces
             (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
           VALUES (?, ?, 'placeholder', 'Placeholder', 'local', '{}', ?, ?, 1)`,
          [otherWorkspaceId, otherOrganizationId, now, now]
        );
        const bootstrapWorkspaceUserId = randomUUID();
        await client.run(
          `INSERT INTO workspace_users
             (id, workspace_id, profile_id, member_key, status, metadata_json,
              created_at, updated_at, revision)
           VALUES (?, ?, 'operator-user', 'auth:operator-user', 'active', '{}', ?, ?, 1)`,
          [bootstrapWorkspaceUserId, otherWorkspaceId, now, now]
        );
        await client.run(
          `INSERT INTO role_assignments
             (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id,
              assigned_by_workspace_user_id, created_at, updated_at, revision)
           VALUES (?, ?, ?, 'ADMIN', '', '', ?, ?, ?, 1)`,
          [
            randomUUID(),
            otherWorkspaceId,
            bootstrapWorkspaceUserId,
            bootstrapWorkspaceUserId,
            now,
            now
          ]
        );

        const crossOrg = await createWorkspace({
          organizationId: otherOrganizationId,
          name: 'Cross-Org Engineering',
          slug: 'eng'
        });
        assert.equal(
          crossOrg.slug,
          'eng',
          'a different organization may reuse a slug already taken in another organization'
        );
      } finally {
        await cleanup();
      }
    });
  });
}

after(() => {
  if (!process.env.TEST_DATABASE_URL) {
    console.error(
      '[workspaces postgres-conformance] TEST_DATABASE_URL not set — Postgres battery skipped; SQLite battery ran.'
    );
  }
});
