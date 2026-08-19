import { createSqliteClient, type DatabaseClient, openInMemoryDatabase } from '@overlord/database';

import { createServiceContext, type ServiceContext } from './context.js';

// Re-exported so the common `test-helpers` import also covers resource-directory
// isolation; see ./test-checkout.ts for why linking an in-repo path is unsafe.
export { createIsolatedCheckout } from './test-checkout.js';

/**
 * Seeds the minimal operator chain service tests need. Fresh in-memory
 * databases no longer contain an implicit `local-workspace` row (the
 * organization migration dropped that seed), so this creates the full chain —
 * organization -> workspace -> mission sequence ->
 * user (whose trigger creates the matching profile) -> workspace_user ->
 * ADMIN role — using stable ids and INSERT OR IGNORE so re-seeding is a no-op.
 */
export async function seedServiceOperator({
  db,
  workspaceId = 'local-workspace',
  profileId = 'operator-user',
  workspaceUserId = 'operator-workspace-user'
}: {
  db: DatabaseClient;
  workspaceId?: string;
  profileId?: string;
  workspaceUserId?: string;
}): Promise<string> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [`${workspaceId}-org`, 'Test Organization', now, now]
  );

  await db.run(
    `INSERT OR IGNORE INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', ?, ?)`,
    [workspaceId, `${workspaceId}-org`, workspaceId, 'Test Workspace', now, now]
  );

  await db.run(
    `INSERT OR IGNORE INTO mission_sequences
       (id, workspace_id, scope_type, scope_id, counter_name, next_value, updated_at)
     VALUES (?, ?, 'workspace', ?, 'mission', 1, ?)`,
    [`${workspaceId}-mission-seq`, workspaceId, workspaceId, now]
  );

  await db.run(
    `INSERT OR IGNORE INTO "user" (
       "id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"
     ) VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    [profileId, profileId, `${profileId}@overlord.local`, now, now]
  );

  await db.run(
    `INSERT OR IGNORE INTO workspace_users (
       id, workspace_id, profile_id, member_key, status, metadata_json,
       created_at, updated_at, revision
     ) VALUES (?, ?, ?, ?, 'active', '{}', ?, ?, 1)`,
    [workspaceUserId, workspaceId, profileId, `auth:${profileId}`, now, now]
  );

  await db.run(
    `INSERT OR IGNORE INTO role_assignments (
       id, workspace_id, workspace_user_id, role_key, resource_type, resource_id,
       assigned_by_workspace_user_id, created_at, updated_at, revision
     ) VALUES (?, ?, ?, 'ADMIN', '', '', ?, ?, ?, 1)`,
    [`${workspaceUserId}-admin-role`, workspaceId, workspaceUserId, workspaceUserId, now, now]
  );

  // Mirrors createWorkspace's seedWorkspaceStorageBuckets/seedOrganizationStorageBucket.
  for (const bucketKey of ['workspace-images', 'user-images', 'attachments']) {
    await db.run(
      `INSERT OR IGNORE INTO storage_buckets (
         id, workspace_id, bucket_key, storage_backend, base_url, local_path, settings_json,
         created_by_workspace_user_id, created_at, updated_at, revision
       ) VALUES (?, ?, ?, 'local_fs', NULL, 'database/.local/storage', '{}', ?, ?, ?, 1)`,
      [`${workspaceId}-bucket-${bucketKey}`, workspaceId, bucketKey, workspaceUserId, now, now]
    );
  }
  await db.run(
    `INSERT OR IGNORE INTO storage_buckets (
       id, organization_id, bucket_key, storage_backend, base_url, local_path, settings_json,
       created_by_workspace_user_id, created_at, updated_at, revision
     ) VALUES (?, ?, 'organization-images', 'local_fs', NULL, 'database/.local/storage', '{}', ?, ?, ?, 1)`,
    [`${workspaceId}-org-bucket`, `${workspaceId}-org`, workspaceUserId, now, now]
  );

  return workspaceUserId;
}

/**
 * One-call setup for service tests: an in-memory SQLite database with the
 * operator chain seeded and a ready ServiceContext.
 */
export async function createSeededServiceContext({
  source = 'protocol'
}: {
  source?: ServiceContext['source'];
} = {}): Promise<{ db: DatabaseClient; ctx: ServiceContext; workspaceUserId: string }> {
  const db = createSqliteClient(openInMemoryDatabase());
  const workspaceUserId = await seedServiceOperator({ db });
  const ctx = await createServiceContext({ db, source });
  return { db, ctx, workspaceUserId };
}
