import { PERMISSIONS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-request-workspace-context-'));
process.env.OVERLORD_SQLITE_PATH = path.join(tempDir, 'webapp.sqlite');

const dbModule = await import('./db.ts');
const {
  db,
  getActiveWorkspace,
  getActiveWorkspaceIdOrNull,
  getBootstrapWorkspaceIdOrNull,
  getImplicitWorkspaceIdOrNull,
  initDatabase,
  setActiveProfileId,
  setActiveWorkspace,
  setActiveWorkspaceContext,
  setActiveWorkspaceUser,
  setAuthorizedWorkspacesContext,
  withRequestContextAsync
} = dbModule;
await initDatabase();

const { resolveAuthorizedWorkspaces } = await import('./auth.ts');
const { getAgentCatalog } = await import('./execution/launch.ts');
const { buildMeta } = await import('./http/meta.ts');
const { getActiveOrganizationIdOrNull } = await import('./organizations.ts');
const { requireAnyWorkspacePermission } = await import('./rbac.ts');
const { createProject, createUserToken, getProfile, updateProfile } =
  await import('./repository.ts');
const { uploadUserImage } = await import('./storage.ts');
const { DEFAULT_TEST_ORGANIZATION_ID, seedAuthenticatedOperator } =
  await import('./test-helpers.ts');
const { createWebhookSubscription, listWebhookSubscriptions } = await import('./webhooks.ts');
const {
  createOrganizationOnboarding,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace
} = await import('./workspaces.ts');

const operatorWorkspaceUserId = seedAuthenticatedOperator({ db });
setActiveWorkspaceUser(operatorWorkspaceUserId);
await setActiveWorkspace('local-workspace');

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

let workspaceSeq = 0;

/**
 * Create a second workspace inside `withRequestContextAsync` so the request's
 * `activeWorkspace` diverges from the process bootstrap default (`local-workspace`).
 * `setActiveWorkspace` in a request store does not rewrite that process default.
 */
async function withDivergedActiveWorkspace<T>(
  fn: (workspace: { id: string; organizationId: string }) => Promise<T>
): Promise<T> {
  workspaceSeq += 1;
  return withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    setActiveWorkspaceUser(operatorWorkspaceUserId);
    const created = await createWorkspace({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      name: `Diverged Active ${workspaceSeq}`
    });
    assert.equal(getBootstrapWorkspaceIdOrNull(), 'local-workspace');
    assert.equal(getActiveWorkspaceIdOrNull(), created.id);
    assert.equal(getImplicitWorkspaceIdOrNull(), created.id);
    return fn(created);
  });
}

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('createProject without workspaceId uses the request-active workspace, not process bootstrap', async () => {
  await withDivergedActiveWorkspace(async created => {
    const project = await createProject({ name: 'Scoped Project' });
    assert.equal(project.workspaceId, created.id);
  });
});

test('listWebhookSubscriptions and webhook create without workspaceId follow the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async created => {
    const { subscription } = await createWebhookSubscription({
      name: 'Scoped hook',
      endpointUrl: 'https://example.com/overlord-hook',
      eventTypes: ['mission.delivered']
    });
    const listed = await listWebhookSubscriptions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, subscription.id);
    const row = db
      .prepare(`SELECT workspace_id FROM webhook_subscriptions WHERE id = ?`)
      .get(subscription.id) as { workspace_id: string };
    assert.equal(row.workspace_id, created.id);
  });
});

test('getActiveOrganizationIdOrNull follows the request-active workspace after onboarding a new org', async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`
  ).run('scoped-org-user', 'scoped-org-user', 'scoped-org@overlord.local', now, now);

  await withRequestContextAsync(async () => {
    setActiveProfileId('scoped-org-user');
    setActiveWorkspaceContext(null);
    setActiveWorkspaceUser(null);

    const created = await createOrganizationOnboarding({
      organizationName: 'Scoped Org',
      workspaceName: 'Scoped Org Workspace'
    });
    assert.equal(getBootstrapWorkspaceIdOrNull(), 'local-workspace');
    assert.equal(await getActiveOrganizationIdOrNull(), created.organizationId);
    assert.notEqual(created.organizationId, DEFAULT_TEST_ORGANIZATION_ID);
  });
});

test('requireAnyWorkspacePermission uses the request-active workspace, not process bootstrap', async () => {
  await withDivergedActiveWorkspace(async created => {
    const scope = await requireAnyWorkspacePermission(PERMISSIONS.PROJECT_CREATE);
    assert.equal(scope.workspaceId, created.id);
  });
});

test('requireAnyWorkspacePermission succeeds for a brand-new onboarded user with no bootstrap membership', async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
     VALUES (?, ?, ?, 1, NULL, ?, ?)`
  ).run('scoped-rbac-user', 'scoped-rbac-user', 'scoped-rbac@overlord.local', now, now);

  await withRequestContextAsync(async () => {
    setActiveProfileId('scoped-rbac-user');
    setActiveWorkspaceContext(null);
    setActiveWorkspaceUser(null);

    const created = await createOrganizationOnboarding({
      organizationName: 'Rbac Org',
      workspaceName: 'Rbac Workspace'
    });
    const scope = await requireAnyWorkspacePermission(PERMISSIONS.PROJECT_CREATE);
    assert.equal(scope.workspaceId, created.id);
  });
});

test('getProfile roles resolve against the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async () => {
    const profile = await getProfile();
    assert.ok(profile.roles.includes('ADMIN'));
  });
});

test('updateProfile change feed is attributed to the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async created => {
    await updateProfile({ agentInstructions: 'scoped-instructions' });
    const change = db
      .prepare(
        `SELECT workspace_id FROM entity_changes
          WHERE entity_type = 'profile' AND entity_id = 'operator-user'
          ORDER BY seq DESC LIMIT 1`
      )
      .get() as { workspace_id: string };
    assert.equal(change.workspace_id, created.id);
  });
});

test('self-issued token consent attributes issuance to the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async created => {
    const { token } = await createUserToken({ label: 'scoped-token' });
    const row = db.prepare(`SELECT workspace_id FROM user_tokens WHERE id = ?`).get(token.id) as {
      workspace_id: string;
    };
    assert.equal(row.workspace_id, created.id);
  });
});

test('uploadUserImage without an explicit workspaceId stores in the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async created => {
    const stored = await uploadUserImage({
      bytes: PNG_BYTES,
      filename: 'avatar.png',
      contentType: 'image/png'
    });
    const row = db
      .prepare(`SELECT workspace_id FROM user_images WHERE storage_key = ?`)
      .get(stored.storageKey) as { workspace_id: string };
    assert.equal(row.workspace_id, created.id);
  });
});

test('listWorkspaces isActive and buildMeta follow the request-active workspace', async () => {
  await withDivergedActiveWorkspace(async created => {
    const listed = await listWorkspaces();
    const active = listed.filter(workspace => workspace.isActive);
    assert.deepEqual(
      active.map(workspace => workspace.id),
      [created.id]
    );
    const meta = await buildMeta();
    assert.equal(meta.workspace?.id, created.id);
  });
});

test('getAgentCatalog without workspaceId seeds the request-active workspace catalog', async () => {
  await withDivergedActiveWorkspace(async created => {
    await getAgentCatalog();
    const row = db.prepare(`SELECT settings_json FROM workspaces WHERE id = ?`).get(created.id) as {
      settings_json: string;
    };
    const settings = JSON.parse(row.settings_json) as { agentCatalog?: unknown };
    assert.ok(settings.agentCatalog, 'catalog must be persisted on the request-active workspace');
  });
});

test('renaming the request-active workspace refreshes the live binding when it is not process bootstrap', async () => {
  await withDivergedActiveWorkspace(async created => {
    const updated = await updateWorkspace(created.id, { name: 'Renamed Diverged' });
    assert.equal(updated.name, 'Renamed Diverged');
    assert.equal(getActiveWorkspace().name, 'Renamed Diverged');
  });
});

test('deleting the request-active workspace re-points even when it is not process bootstrap', async () => {
  await withDivergedActiveWorkspace(async created => {
    await deleteWorkspace(created.id);
    assert.notEqual(getActiveWorkspaceIdOrNull(), created.id);
    assert.equal(getActiveWorkspaceIdOrNull(), 'local-workspace');
    assert.equal(getBootstrapWorkspaceIdOrNull(), 'local-workspace');
  });
});

test('an authorized snapshot still requires an explicit workspaceId to create a project', async () => {
  const snapshot = await resolveAuthorizedWorkspaces('operator-user', null);
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    setAuthorizedWorkspacesContext(snapshot);
    setActiveWorkspaceContext(null);
    setActiveWorkspaceUser(null);
    await assert.rejects(
      createProject({ name: 'Needs Explicit Workspace' }),
      /workspaceId is required/
    );
    assert.equal(getImplicitWorkspaceIdOrNull(), null);
    assert.equal(getBootstrapWorkspaceIdOrNull(), 'local-workspace');
  });
});
