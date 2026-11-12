import { PERMISSIONS } from '@overlord/auth';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startFakeS3, useS3Bucket, withS3Credentials } from './storage-test-fixture.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-webapp-storage-'));
const { bootstrapIntegrationTestDb, DEFAULT_TEST_ORGANIZATION_ID } =
  await import('./test-helpers.ts');
const harness = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const {
  db,
  getActorWorkspaceUserId,
  setActiveTokenAuth,
  setActiveWorkspace,
  setActiveWorkspaceUser
} = await import('./db.ts');
const { createTestWorkspaceContext } = await import('./test-helpers.ts');
const { getActiveWorkspaceId, WORKSPACE } = createTestWorkspaceContext(await import('./db.ts'));
const { ApiError } = await import('./errors.ts');
const { requirePermission } = await import('./rbac.ts');
const { createMission, createProject } = await import('./repository.ts');
const {
  deleteObjectiveAttachment,
  resolveStoredObject,
  uploadObjectiveAttachment,
  uploadUserImage,
  uploadWorkspaceImage
} = await import('./storage.ts');
const { createWorkspace } = await import('./workspaces.ts');

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('s3 attachment uploads record metadata, reads are gated, and tombstones delete bytes', async () => {
  const { endpoint, objects, close } = await startFakeS3();
  const restoreCredentials = withS3Credentials();

  try {
    useS3Bucket(db, {
      workspaceId: WORKSPACE.id,
      bucketKey: 'attachments',
      endpoint,
      settings: { presignReads: true, presignTtlSeconds: 120 }
    });

    const project = await createProject({ name: 'S3 Attachments' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Upload attachment'
    });
    const objective = mission.objectives[0]!;

    const attachment = await uploadObjectiveAttachment({
      objectiveId: objective.id,
      bytes: Buffer.from('attachment-bytes'),
      filename: 'notes.txt',
      contentType: 'text/plain'
    });

    assert.equal(attachment.filename, 'notes.txt');
    assert.equal(attachment.contentType, 'text/plain');
    assert.equal(attachment.sizeBytes, 'attachment-bytes'.length);
    assert.equal(attachment.uploadStatus, 'available');
    assert.match(
      attachment.storageKey,
      new RegExp(`^workspace-files/${WORKSPACE.id}/attachments/[a-z0-9-]+\\.txt$`)
    );
    const storedPath = `/overlord-storage/hosted/${attachment.storageKey}`;
    assert.deepEqual(objects.get(storedPath), Buffer.from('attachment-bytes'));

    await assert.rejects(
      async () =>
        await resolveStoredObject('attachments', 'missing.txt', PERMISSIONS.ATTACHMENT_READ),
      (error: unknown) => error instanceof ApiError && error.status === 404
    );

    setActiveTokenAuth({
      workspaceUserId: harness.operatorWorkspaceUserId,
      tokenId: 'attachment-only-token',
      scopeGrants: ['attachment:read']
    });
    await assert.rejects(
      async () =>
        await requirePermission(PERMISSIONS.PROJECT_READ, {
          workspaceId: getActiveWorkspaceId(),
          workspaceUserId: getActorWorkspaceUserId()
        }),
      (error: unknown) => error instanceof ApiError && error.status === 403
    );

    setActiveWorkspaceUser(harness.operatorWorkspaceUserId);
    await requirePermission(PERMISSIONS.PROJECT_READ, {
      workspaceId: getActiveWorkspaceId(),
      workspaceUserId: getActorWorkspaceUserId()
    });
    const resolved = await resolveStoredObject(
      'attachments',
      attachment.storageKey,
      PERMISSIONS.ATTACHMENT_READ
    );
    assert.equal(resolved.bodyStream, undefined);
    assert.match(resolved.presignedRedirectUrl ?? '', /X-Amz-Expires=120/);
    assert.match(
      resolved.presignedRedirectUrl ?? '',
      /\/overlord-storage\/hosted\/workspace-files\/local-workspace\/attachments\//
    );

    await deleteObjectiveAttachment(objective.id, attachment.id);
    assert.equal(objects.has(storedPath), false);
  } finally {
    restoreCredentials();
    setActiveWorkspaceUser(harness.operatorWorkspaceUserId);
    await close();
  }
});

test('uploadWorkspaceImage stores the logo under workspace-files, is admin-gated, and is servable back', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  try {
    const workspace = await createWorkspace({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      name: 'Storage Test Workspace'
    });

    const stored = await uploadWorkspaceImage({
      bytes: pngBytes,
      filename: 'logo.png',
      contentType: 'image/png'
    });

    assert.equal(stored.bucketKey, 'workspace-images');
    assert.equal(stored.contentType, 'image/png');
    assert.match(
      stored.storageKey,
      new RegExp(`^workspace-files/${workspace.id}/images/[a-z0-9-]+\\.png$`)
    );
    assert.equal(
      stored.url,
      `/api/storage/workspace-images/${encodeURIComponent(stored.storageKey)}`
    );

    // The bucket row provisioned for this workspace roots bytes at the shared
    // storage directory; storage keys carry the workspace-files path.
    const bucketRow = db
      .prepare(
        `SELECT local_path FROM storage_buckets
           WHERE workspace_id = ? AND bucket_key = 'workspace-images' AND deleted_at IS NULL`
      )
      .get(workspace.id) as { local_path: string };
    assert.equal(bucketRow.local_path, 'database/.local/storage');

    const resolved = await resolveStoredObject(
      'workspace-images',
      stored.storageKey,
      PERMISSIONS.WORKSPACE_IMAGE_READ
    );
    assert.ok(
      resolved.absolutePath?.endsWith(
        `workspace-files/${workspace.id}/images/${path.basename(stored.storageKey)}`
      )
    );

    // A member without the workspace_image:create grant cannot upload a logo.
    setActiveTokenAuth({
      workspaceUserId: harness.operatorWorkspaceUserId,
      tokenId: 'workspace-image-read-only-token',
      scopeGrants: ['workspace_image:read']
    });
    await assert.rejects(
      async () =>
        await requirePermission(PERMISSIONS.WORKSPACE_IMAGE_CREATE, {
          workspaceId: getActiveWorkspaceId(),
          workspaceUserId: getActorWorkspaceUserId()
        }),
      (error: unknown) => error instanceof ApiError && error.status === 403
    );
  } finally {
    await setActiveWorkspace('local-workspace');
    setActiveTokenAuth({
      workspaceUserId: harness.operatorWorkspaceUserId,
      tokenId: null,
      scopeGrants: null
    });
    setActiveWorkspaceUser(harness.operatorWorkspaceUserId);
  }
});

test('uploadUserImage stores profile images under the user-images profile prefix', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const stored = await uploadUserImage({
    bytes: pngBytes,
    filename: 'avatar.png',
    contentType: 'image/png'
  });

  assert.equal(stored.bucketKey, 'user-images');
  assert.match(stored.storageKey, /^user-images\/operator-user\/[a-z0-9-]+\.png$/);
  assert.equal(stored.url, `/api/storage/user-images/${encodeURIComponent(stored.storageKey)}`);
});

test('resolveStoredObject serves legacy one-segment user image URLs by canonical basename', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const stored = await uploadUserImage({
    bytes: pngBytes,
    filename: 'avatar.png',
    contentType: 'image/png'
  });
  const legacyStorageKey = path.basename(stored.storageKey);

  const resolved = await resolveStoredObject(
    'user-images',
    legacyStorageKey,
    PERMISSIONS.USER_IMAGE_READ
  );

  assert.equal(resolved.contentType, 'image/png');
  assert.equal(resolved.filename, 'avatar.png');
  assert.ok(resolved.absolutePath?.endsWith(stored.storageKey));
});

test('organization images are served only for the caller organization image key shape', async () => {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const storageRoot = path.join(tempDir, 'organization-storage');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO storage_buckets (
       id, organization_id, bucket_key, storage_backend, base_url, local_path, settings_json,
       created_at, updated_at, revision
     ) VALUES ('org-images-bucket', ?, 'organization-images', 'local_fs', NULL, ?, '{}', ?, ?, 1)`
  ).run(DEFAULT_TEST_ORGANIZATION_ID, storageRoot, now, now);

  const { uploadOrganizationImage } = await import('./storage.ts');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const stored = await uploadOrganizationImage({
    bytes: pngBytes,
    filename: 'logo.png',
    contentType: 'image/png'
  });
  const resolved = await resolveStoredObject(
    'organization-images',
    stored.storageKey,
    PERMISSIONS.ORGANIZATION_IMAGE_READ
  );
  assert.equal(resolved.contentType, 'image/png');
  assert.ok(resolved.absolutePath?.startsWith(`${storageRoot}${path.sep}`));

  writeFileSync(path.join(tempDir, 'outside.txt'), 'outside');
  const otherKey =
    'organization-files/other-organization/images/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.png';
  mkdirSync(path.dirname(path.join(storageRoot, otherKey)), { recursive: true });
  writeFileSync(path.join(storageRoot, otherKey), pngBytes);

  for (const storageKey of [
    `organization-files/${DEFAULT_TEST_ORGANIZATION_ID}/images/../../../../outside.txt`,
    '../outside.txt',
    `${tempDir}/outside.txt`,
    `organization-files/${DEFAULT_TEST_ORGANIZATION_ID}/images/logo.png`,
    `organization-files/${DEFAULT_TEST_ORGANIZATION_ID}/images/${path.basename(stored.storageKey)}\u0000`,
    otherKey
  ]) {
    await assert.rejects(
      async () =>
        await resolveStoredObject(
          'organization-images',
          storageKey,
          PERMISSIONS.ORGANIZATION_IMAGE_READ
        ),
      (error: unknown) => error instanceof ApiError && error.status === 404,
      storageKey
    );
  }

  const { endpoint, objects, close } = await startFakeS3();
  const restoreCredentials = withS3Credentials();
  try {
    db.prepare(
      `UPDATE storage_buckets
          SET storage_backend = 's3', local_path = NULL, settings_json = ?
        WHERE id = 'org-images-bucket'`
    ).run(JSON.stringify({ bucketName: 'overlord-storage', endpoint, region: 'us-east-1' }));
    objects.set(`/overlord-storage/${otherKey}`, pngBytes);
    await assert.rejects(
      async () =>
        await resolveStoredObject(
          'organization-images',
          otherKey,
          PERMISSIONS.ORGANIZATION_IMAGE_READ
        ),
      (error: unknown) => error instanceof ApiError && error.status === 404
    );
    const own = `organization-files/${DEFAULT_TEST_ORGANIZATION_ID}/images/1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f.png`;
    objects.set(`/overlord-storage/${own}`, pngBytes);
    const fromS3 = await resolveStoredObject(
      'organization-images',
      own,
      PERMISSIONS.ORGANIZATION_IMAGE_READ
    );
    assert.ok(fromS3.bodyStream);
    fromS3.bodyStream?.destroy();
  } finally {
    restoreCredentials();
    db.prepare(`DELETE FROM storage_buckets WHERE id = 'org-images-bucket'`).run();
    await close();
  }
});
