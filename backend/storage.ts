/**
 * Core upload service.
 *
 * A small, reusable storage layer that other components (avatars, workspace
 * images, attachments, …) can build on. It owns the mechanics shared by every
 * upload: resolving a workspace `storage_buckets` row, validating image bytes,
 * writing them to the bucket's backend, recording provider-neutral metadata in
 * the matching object table, and producing a server-relative URL the SPA can
 * load.
 *
 * Bytes live in the storage backend (`local_fs` on disk for local installs, or
 * `s3` / `railway_volume` against an S3-compatible endpoint for hosted
 * deployments); the database holds metadata and backend keys only — see
 * database/docs/09-database-schema-contract.md (`storage_buckets`, `user_images`).
 *
 * `user-images`, `workspace-images`, and `attachments` are each wired through
 * their own metadata writer; the bucket lookup, byte I/O, and serve path are
 * generic and shared across all three.
 */

import { type Permission, PERMISSIONS } from '@overlord/auth';
import type { ObjectiveAttachmentDto, StoredImageDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  getActiveTokenProjectIds,
  getActorWorkspaceUserId,
  getImplicitWorkspaceIdOrNull,
  getResourceLookupWorkspaceIds,
  newId,
  nowIso,
  projectInTokenScope,
  recordChange,
  requireDatabaseClient,
  resolveActiveProfileId
} from './db.ts';
import { ApiError } from './errors.ts';
import { resolveObjectiveIdForRest } from './objective-ref.ts';
import { getActiveOrganizationIdOrNull } from './organizations.ts';
import {
  isOrganizationAdmin,
  requireAnyWorkspacePermission,
  requireWorkspacePermission
} from './rbac.ts';
import { createStorageBackend, readStorageReadSettings } from './storage-backends.ts';

// backend/storage.ts -> repo root is one level up from backend/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Hard ceiling on a single uploaded image, mirrored by the route body limit. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Hard ceiling on a single objective attachment, mirrored by the route body
 * limit. Larger than images because attachments include documents and archives.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_LABEL = '25 MB';

/**
 * Raster image media types we accept. SVG is intentionally excluded: it can
 * carry script and would be served same-origin. Each maps to the file extension
 * used for the stored object's backend key.
 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

interface StorageBucketRow {
  id: string;
  bucket_key: string;
  storage_backend: string;
  base_url: string | null;
  local_path: string | null;
  settings_json: string;
}

/** Resolve a specified workspace's bucket for `bucketKey`, or 404 if absent. */
async function resolveBucket(bucketKey: string, workspaceId: string): Promise<StorageBucketRow> {
  const row = await requireDatabaseClient().get<StorageBucketRow>(
    `SELECT id, bucket_key, storage_backend, base_url, local_path, settings_json
       FROM storage_buckets
      WHERE workspace_id = ? AND bucket_key = ? AND deleted_at IS NULL`,
    [workspaceId, bucketKey]
  );
  if (!row) throw new ApiError(404, `Unknown storage bucket '${bucketKey}'`);
  return row;
}

async function requireActiveOrganizationId(): Promise<string> {
  const organizationId = await getActiveOrganizationIdOrNull();
  if (!organizationId) throw new ApiError(404, 'No active organization');
  return organizationId;
}

/** Resolve the active organization's bucket for `bucketKey`, or 404 if absent. */
async function resolveOrganizationBucket(
  organizationId: string,
  bucketKey: string
): Promise<StorageBucketRow> {
  const row = await requireDatabaseClient().get<StorageBucketRow>(
    `SELECT id, bucket_key, storage_backend, base_url, local_path, settings_json
       FROM storage_buckets
      WHERE organization_id = ? AND bucket_key = ? AND deleted_at IS NULL`,
    [organizationId, bucketKey]
  );
  if (!row) throw new ApiError(404, `Unknown storage bucket '${bucketKey}'`);
  return row;
}

/** Pick a safe extension and normalise the content type, or reject the upload. */
function extensionForImage(contentType: string): string {
  const ext = IMAGE_EXTENSIONS[contentType.toLowerCase()];
  if (!ext) {
    throw new ApiError(415, 'Unsupported image type. Upload a PNG, JPEG, GIF, or WebP image.');
  }
  return ext;
}

/** Server-relative URL the SPA uses to fetch a stored object's bytes. */
function publicUrlFor(bucketKey: string, storageKey: string): string {
  return `/api/storage/${encodeURIComponent(bucketKey)}/${encodeURIComponent(storageKey)}`;
}

export interface UploadImageInput {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

interface WrittenObject {
  id: string;
  storageKey: string;
  sizeBytes: number;
  contentType: string;
  checksum: string;
  publicUrl: string;
}

function userImageObjectKey(userId: string, imageId: string, ext: string): string {
  return `user-images/${userId}/${imageId}${ext}`;
}

function workspaceImageObjectKey(workspaceId: string, imageId: string, ext: string): string {
  return `workspace-files/${workspaceId}/images/${imageId}${ext}`;
}

function organizationImageObjectKey(organizationId: string, imageId: string, ext: string): string {
  return `organization-files/${organizationId}/images/${imageId}${ext}`;
}

function attachmentObjectKey(workspaceId: string, attachmentId: string, ext: string): string {
  return `workspace-files/${workspaceId}/attachments/${attachmentId}${ext}`;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** Validate image bytes, write them to the bucket backend, return metadata. */
async function writeImageObject(
  bucket: StorageBucketRow,
  input: UploadImageInput,
  storageKeyFor: (id: string, ext: string) => string
): Promise<WrittenObject> {
  if (!input.bytes || input.bytes.length === 0) {
    throw new ApiError(400, 'No image data received');
  }
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    throw new ApiError(413, 'Image is too large. The maximum size is 8 MB.');
  }
  const contentType = input.contentType.split(';')[0].trim().toLowerCase();
  const ext = extensionForImage(contentType);

  const id = newId();
  const storageKey = storageKeyFor(id, ext);
  const backend = createStorageBackend({ bucket, repoRoot });
  await backend.put({ key: storageKey, bytes: input.bytes, contentType });

  return {
    id,
    storageKey,
    sizeBytes: input.bytes.length,
    contentType,
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
    publicUrl: publicUrlFor(bucket.bucket_key, storageKey)
  };
}

/** Resolve the operator's `profiles.id` for the active workspace actor. */
async function operatorUserId(): Promise<string> {
  const client = requireDatabaseClient();
  if (getActorWorkspaceUserId()) {
    const row = await client.get<{ profile_id: string }>(
      `SELECT profile_id FROM workspace_users WHERE id = ?`,
      [getActorWorkspaceUserId()]
    );
    if (row) return row.profile_id;
  }
  const fallback = await client.get<{ id: string }>(
    `SELECT id FROM profiles
      WHERE kind = 'human' AND status = 'active' AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`
  );
  if (!fallback) throw new ApiError(409, 'No local user profile exists');
  return fallback.id;
}

/**
 * Upload an image to the `user-images` bucket and record it against the local
 * operator. Returns the stored-image descriptor including the URL to serve it.
 */
function uploadWorkspaceId(explicitWorkspaceId?: string): string {
  const workspaceId = explicitWorkspaceId?.trim() || getImplicitWorkspaceIdOrNull();
  if (!workspaceId) throw new ApiError(400, 'workspaceId is required');
  return workspaceId;
}

export async function uploadUserImage(
  input: UploadImageInput,
  explicitWorkspaceId?: string
): Promise<StoredImageDto> {
  const workspaceId = uploadWorkspaceId(explicitWorkspaceId);
  const bucket = await resolveBucket('user-images', workspaceId);
  const userId = await operatorUserId();
  const written = await writeImageObject(bucket, input, (id, ext) =>
    userImageObjectKey(userId, id, ext)
  );
  const now = nowIso();
  const filename = input.filename.trim() || `image${path.extname(written.storageKey)}`;

  return requireDatabaseClient().transaction(async tx => {
    await tx.run(
      `INSERT INTO user_images (
         id, workspace_id, profile_id, storage_bucket_id, storage_key,
         filename, content_type, size_bytes, checksum_sha256, public_url, metadata_json,
         created_by_workspace_user_id, created_at, updated_at, revision
       ) VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, '{}',
         ?, ?, ?, 1
       )`,
      [
        written.id,
        workspaceId,
        userId,
        bucket.id,
        written.storageKey,
        filename,
        written.contentType,
        written.sizeBytes,
        written.checksum,
        written.publicUrl,
        getActorWorkspaceUserId(),
        now,
        now
      ]
    );

    await recordChange(
      {
        entityType: 'user_image',
        entityId: written.id,
        operation: 'insert',
        entityRevision: 1,
        workspaceId
      },
      tx
    );

    return {
      id: written.id,
      bucketKey: bucket.bucket_key,
      storageKey: written.storageKey,
      filename,
      contentType: written.contentType,
      sizeBytes: written.sizeBytes,
      url: written.publicUrl,
      createdAt: now
    };
  });
}

/**
 * Upload an image to the workspace's `workspace-images` bucket and record it
 * as a workspace-owned image (e.g. a workspace logo). The bucket is resolved
 * per active workspace (`resolveBucket` scopes by `WORKSPACE.id`), so each
 * workspace's bytes live under their own `storage_buckets` row/folder —
 * callers gate this to workspace admins (`PERMISSIONS.WORKSPACE_IMAGE_CREATE`).
 */
export async function uploadWorkspaceImage(
  input: UploadImageInput,
  explicitWorkspaceId?: string
): Promise<StoredImageDto> {
  const workspaceId = uploadWorkspaceId(explicitWorkspaceId);
  const bucket = await resolveBucket('workspace-images', workspaceId);
  const written = await writeImageObject(bucket, input, (id, ext) =>
    workspaceImageObjectKey(workspaceId, id, ext)
  );
  const now = nowIso();
  const filename = input.filename.trim() || `image${path.extname(written.storageKey)}`;

  return requireDatabaseClient().transaction(async tx => {
    await tx.run(
      `INSERT INTO workspace_images (
         id, workspace_id, storage_bucket_id, storage_key,
         filename, content_type, size_bytes, checksum_sha256, public_url, metadata_json,
         created_by_workspace_user_id, created_at, updated_at, revision
       ) VALUES (
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?, '{}',
         ?, ?, ?, 1
       )`,
      [
        written.id,
        workspaceId,
        bucket.id,
        written.storageKey,
        filename,
        written.contentType,
        written.sizeBytes,
        written.checksum,
        written.publicUrl,
        getActorWorkspaceUserId(),
        now,
        now
      ]
    );

    await recordChange(
      {
        entityType: 'workspace_image',
        entityId: written.id,
        operation: 'insert',
        entityRevision: 1,
        workspaceId
      },
      tx
    );

    return {
      id: written.id,
      bucketKey: bucket.bucket_key,
      storageKey: written.storageKey,
      filename,
      contentType: written.contentType,
      sizeBytes: written.sizeBytes,
      url: written.publicUrl,
      createdAt: now
    };
  });
}

/**
 * Upload an image to the active organization's `organization-images` bucket
 * (the organization logo). Unlike `user-images`/`workspace-images` there is no
 * per-object metadata table (an organization has exactly one current logo,
 * tracked as a URL string in `organizations.settings_json` — see
 * `resolveStoredObject`'s dedicated branch below, which derives content type
 * from the storage key's extension instead of a metadata row). The route-level
 * `PERMISSIONS.ORGANIZATION_IMAGE_CREATE` gate only checks the active
 * workspace's role grants, so this additionally enforces the real org-admin
 * invariant (Q2) itself, mirroring `updateOrganization`.
 */
export async function uploadOrganizationImage(input: UploadImageInput): Promise<StoredImageDto> {
  const organizationId = await requireActiveOrganizationId();
  const profileId = await resolveActiveProfileId();
  if (!profileId || !(await isOrganizationAdmin(profileId, organizationId))) {
    throw new ApiError(403, 'Organization admin required');
  }

  const bucket = await resolveOrganizationBucket(organizationId, 'organization-images');
  const written = await writeImageObject(bucket, input, (id, ext) =>
    organizationImageObjectKey(organizationId, id, ext)
  );
  const filename = input.filename.trim() || `image${path.extname(written.storageKey)}`;

  return {
    id: written.id,
    bucketKey: bucket.bucket_key,
    storageKey: written.storageKey,
    filename,
    contentType: written.contentType,
    sizeBytes: written.sizeBytes,
    url: written.publicUrl,
    createdAt: nowIso()
  };
}

// ---- Objective attachments (attachments bucket) --------------------------
//
// Attachments reuse the generic bucket plumbing above but, unlike images,
// accept any content type and are recorded in the `attachments` table scoped to
// an objective (with its mission and project). Bytes are served as downloads via
// the same `/api/storage/<bucket>/<key>` route as images.

const ATTACHMENTS_BUCKET_KEY = 'attachments';

interface ObjectiveScopeRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
}

/**
 * Resolve the objective's workspace/project/mission scope, or 404 if absent.
 * Accepts an explicit client so callers inside a transaction can pass the
 * transaction-scoped client instead of `requireDatabaseClient()`'s top-level
 * one — reusing the top-level client here would re-enter the same mutex the
 * enclosing `transaction()` call already holds and deadlock.
 */
async function resolveObjectiveScope(
  objectiveRef: string,
  client: DatabaseClient = requireDatabaseClient(),
  permission: Permission = PERMISSIONS.ATTACHMENT_READ
): Promise<ObjectiveScopeRow> {
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveRef, db: client });
  const row = await client.get<ObjectiveScopeRow>(
    `SELECT id, workspace_id, project_id, mission_id FROM objectives
      WHERE id = ? AND deleted_at IS NULL`,
    [resolved.id]
  );
  if (!row) throw new ApiError(404, 'Objective not found');
  await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission,
    db: client,
    notFoundMessage: 'Objective not found'
  });
  return row;
}

function assertAttachmentBytes(bytes: Buffer): void {
  if (!bytes || bytes.length === 0) {
    throw new ApiError(400, 'No file data received');
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(
      413,
      `File too large. Attachments can be no longer than ${MAX_ATTACHMENT_LABEL}.`
    );
  }
}

/** Preserve the uploaded file's extension for the stored object's backend key. */
function attachmentExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  // Guard against pathological extensions; keep only a short alnum suffix.
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

interface AttachmentRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  mission_id: string | null;
  objective_id: string | null;
  inbox_item_id: string | null;
  storage_key: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  upload_status: string;
  created_at: string;
}

function toObjectiveAttachmentDto(row: AttachmentRow): ObjectiveAttachmentDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    inboxItemId: row.inbox_item_id,
    bucketKey: ATTACHMENTS_BUCKET_KEY,
    storageKey: row.storage_key,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadStatus: row.upload_status as ObjectiveAttachmentDto['uploadStatus'],
    url: publicUrlFor(ATTACHMENTS_BUCKET_KEY, row.storage_key),
    createdAt: row.created_at
  };
}

const ATTACHMENT_COLUMNS = `id, workspace_id, project_id, mission_id, objective_id, inbox_item_id,
  storage_key, filename, content_type, size_bytes, upload_status, created_at`;

export interface UploadAttachmentInput {
  objectiveId: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Store an uploaded file in the `attachments` bucket and record it against an
 * objective (carrying its mission and project). Returns the attachment
 * descriptor including the URL that serves the bytes back.
 */
export async function uploadObjectiveAttachment(
  input: UploadAttachmentInput
): Promise<ObjectiveAttachmentDto> {
  assertAttachmentBytes(input.bytes);

  const scope = await resolveObjectiveScope(
    input.objectiveId,
    undefined,
    PERMISSIONS.ATTACHMENT_CREATE
  );
  const bucket = await resolveBucket(ATTACHMENTS_BUCKET_KEY, scope.workspace_id);

  const id = newId();
  const storageKey = attachmentObjectKey(
    scope.workspace_id,
    id,
    attachmentExtension(input.filename)
  );
  const now = nowIso();
  const contentType = input.contentType.split(';')[0].trim().toLowerCase() || null;
  const backend = createStorageBackend({ bucket, repoRoot });
  await backend.put({
    key: storageKey,
    bytes: input.bytes,
    contentType: contentType ?? 'application/octet-stream'
  });
  const filename = input.filename.trim() || `attachment${path.extname(storageKey)}`;
  const checksum = createHash('sha256').update(input.bytes).digest('hex');

  return requireDatabaseClient().transaction(async tx => {
    await tx.run(
      `INSERT INTO attachments (
         id, workspace_id, project_id, mission_id, objective_id, storage_bucket_id,
         storage_key, filename, content_type, size_bytes, checksum_sha256, upload_status,
         metadata_json, created_by_workspace_user_id, created_at, updated_at, revision
       ) VALUES (
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, 'available',
         '{}', ?, ?, ?, 1
       )`,
      [
        id,
        scope.workspace_id,
        scope.project_id,
        scope.mission_id,
        scope.id,
        bucket.id,
        storageKey,
        filename,
        contentType,
        input.bytes.length,
        checksum,
        getActorWorkspaceUserId(),
        now,
        now
      ]
    );

    await recordChange(
      {
        entityType: 'attachment',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        projectId: scope.project_id,
        missionId: scope.mission_id,
        objectiveId: scope.id,
        workspaceId: scope.workspace_id
      },
      tx
    );

    return toObjectiveAttachmentDto({
      id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      mission_id: scope.mission_id,
      objective_id: scope.id,
      inbox_item_id: null,
      storage_key: storageKey,
      filename,
      content_type: contentType,
      size_bytes: input.bytes.length,
      upload_status: 'available',
      created_at: now
    });
  });
}

/** List an objective's active attachments, oldest first. */
export async function listObjectiveAttachments(
  objectiveId: string
): Promise<ObjectiveAttachmentDto[]> {
  const scope = await resolveObjectiveScope(objectiveId);
  const rows = await requireDatabaseClient().all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
      WHERE objective_id = ? AND workspace_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [scope.id, scope.workspace_id]
  );
  return rows.map(toObjectiveAttachmentDto);
}

/**
 * Soft-delete an objective attachment (tombstone + revision bump). Remote
 * backends delete their object after the metadata transaction commits; local
 * buckets keep historical on-disk behavior. Returns the objective's remaining
 * attachments.
 */
export async function deleteObjectiveAttachment(
  objectiveId: string,
  attachmentId: string
): Promise<ObjectiveAttachmentDto[]> {
  const { remaining, cleanup } = await requireDatabaseClient().transaction(async tx => {
    const scope = await resolveObjectiveScope(objectiveId, tx, PERMISSIONS.ATTACHMENT_DELETE);
    const row = await tx.get<{
      id: string;
      revision: number;
      storage_key: string;
      bucket_id: string;
      bucket_key: string;
      storage_backend: string;
      local_path: string | null;
      settings_json: string;
    }>(
      `SELECT a.id, a.revision, a.storage_key,
              b.id AS bucket_id, b.bucket_key, b.storage_backend, b.local_path, b.settings_json
         FROM attachments a
         JOIN storage_buckets b ON b.id = a.storage_bucket_id
        WHERE a.id = ? AND a.objective_id = ? AND a.workspace_id = ?
          AND a.deleted_at IS NULL AND b.deleted_at IS NULL`,
      [attachmentId, scope.id, scope.workspace_id]
    );
    if (!row) throw new ApiError(404, 'Attachment not found');

    const now = nowIso();
    await tx.run(
      `UPDATE attachments
          SET deleted_at = ?, upload_status = 'deleted', updated_at = ?,
              revision = revision + 1
        WHERE id = ?`,
      [now, now, attachmentId]
    );

    await recordChange(
      {
        entityType: 'attachment',
        entityId: attachmentId,
        operation: 'delete',
        entityRevision: row.revision + 1,
        projectId: scope.project_id,
        missionId: scope.mission_id,
        objectiveId: scope.id,
        workspaceId: scope.workspace_id
      },
      tx
    );

    const rows = await tx.all<AttachmentRow>(
      `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
        WHERE objective_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [scope.id, scope.workspace_id]
    );
    return {
      remaining: rows.map(toObjectiveAttachmentDto),
      cleanup: {
        key: row.storage_key,
        bucket: {
          id: row.bucket_id,
          bucket_key: row.bucket_key,
          storage_backend: row.storage_backend,
          local_path: row.local_path,
          settings_json: row.settings_json
        }
      }
    };
  });

  await removeStoredObjects([cleanup]);
  return remaining;
}

interface StoredObjectRef {
  key: string;
  bucket: {
    id: string;
    bucket_key: string;
    storage_backend: string;
    local_path: string | null;
    settings_json: string;
  };
}

/**
 * Remove stored bytes after their metadata change has committed. Remote
 * backends delete the object; local buckets keep historical on-disk behavior.
 */
async function removeStoredObjects(objects: StoredObjectRef[]): Promise<void> {
  for (const object of objects) {
    if (
      object.bucket.storage_backend === 's3' ||
      object.bucket.storage_backend === 'railway_volume'
    ) {
      const backend = createStorageBackend({ bucket: object.bucket, repoRoot });
      await backend.deleteObject?.({ key: object.key });
    }
  }
}

// ---- Inbox item attachments ------------------------------------------------
//
// A profile-owned inbox item has no workspace, so its files are stored in the
// owner's storage workspace: the workspace of the item's earlier attachments,
// else the request's active workspace, else the owner's oldest membership that
// grants `attachment:create`. Rows carry `inbox_item_id` with no project,
// mission, or objective, and are authorized by item ownership. Like inbox
// items themselves they stay outside workspace realtime: no entity change is
// recorded until promotion re-points them at the created mission's first
// objective.

async function ownedInboxItemId(
  inboxItemId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<string> {
  const profileId = await resolveActiveProfileId(client);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  const row = await client.get<{ id: string }>(
    `SELECT id FROM inbox_items WHERE id = ? AND profile_id = ?`,
    [inboxItemId, profileId]
  );
  if (!row) throw new ApiError(404, 'Inbox item not found');
  return row.id;
}

async function inboxAttachmentWorkspace(
  inboxItemId: string
): Promise<{ workspaceId: string; workspaceUserId: string }> {
  const client = requireDatabaseClient();
  const existing = await client.get<{ workspace_id: string }>(
    `SELECT workspace_id FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [inboxItemId]
  );
  const memberships = await getResourceLookupWorkspaceIds(client);
  const implicit = getImplicitWorkspaceIdOrNull();
  const candidates = [
    ...(existing ? [existing.workspace_id] : []),
    ...(implicit && memberships.includes(implicit) ? [implicit] : []),
    ...memberships
  ];
  let denied: unknown = null;
  for (const workspaceId of new Set(candidates)) {
    try {
      const workspaceUserId = await requireWorkspacePermission({
        workspaceId,
        permission: PERMISSIONS.ATTACHMENT_CREATE,
        db: client
      });
      return { workspaceId, workspaceUserId };
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404)) {
        throw error;
      }
      denied ??= error;
    }
  }
  if (denied) throw denied;
  throw new ApiError(409, 'Join a workspace before attaching files to Inbox items');
}

async function listInboxAttachmentRows(
  inboxItemId: string,
  client: DatabaseClient
): Promise<AttachmentRow[]> {
  return client.all<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [inboxItemId]
  );
}

export interface UploadInboxAttachmentInput {
  inboxItemId: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
}

/** Store an uploaded file against one of the caller's inbox items. */
export async function uploadInboxItemAttachment(
  input: UploadInboxAttachmentInput
): Promise<ObjectiveAttachmentDto> {
  assertAttachmentBytes(input.bytes);
  const inboxItemId = await ownedInboxItemId(input.inboxItemId);
  const { workspaceId, workspaceUserId } = await inboxAttachmentWorkspace(inboxItemId);
  const bucket = await resolveBucket(ATTACHMENTS_BUCKET_KEY, workspaceId);

  const id = newId();
  const storageKey = attachmentObjectKey(workspaceId, id, attachmentExtension(input.filename));
  const now = nowIso();
  const contentType = input.contentType.split(';')[0].trim().toLowerCase() || null;
  const backend = createStorageBackend({ bucket, repoRoot });
  await backend.put({
    key: storageKey,
    bytes: input.bytes,
    contentType: contentType ?? 'application/octet-stream'
  });
  const filename = input.filename.trim() || `attachment${path.extname(storageKey)}`;
  const checksum = createHash('sha256').update(input.bytes).digest('hex');

  try {
    await requireDatabaseClient().transaction(async tx => {
      // Re-check inside the write so a concurrent delete/promotion of the item
      // cannot leave a row pointing at a consumed capture.
      await ownedInboxItemId(inboxItemId, tx);
      await tx.run(
        `INSERT INTO attachments (
           id, workspace_id, inbox_item_id, storage_bucket_id,
           storage_key, filename, content_type, size_bytes, checksum_sha256, upload_status,
           metadata_json, created_by_workspace_user_id, created_at, updated_at, revision
         ) VALUES (
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?, 'available',
           '{}', ?, ?, ?, 1
         )`,
        [
          id,
          workspaceId,
          inboxItemId,
          bucket.id,
          storageKey,
          filename,
          contentType,
          input.bytes.length,
          checksum,
          workspaceUserId,
          now,
          now
        ]
      );
    });
  } catch (error) {
    await removeStoredObjects([{ key: storageKey, bucket }]);
    throw error;
  }

  return toObjectiveAttachmentDto({
    id,
    workspace_id: workspaceId,
    project_id: null,
    mission_id: null,
    objective_id: null,
    inbox_item_id: inboxItemId,
    storage_key: storageKey,
    filename,
    content_type: contentType,
    size_bytes: input.bytes.length,
    upload_status: 'available',
    created_at: now
  });
}

/** List an owned inbox item's active attachments, oldest first. */
export async function listInboxItemAttachments(
  inboxItemId: string
): Promise<ObjectiveAttachmentDto[]> {
  const client = requireDatabaseClient();
  const id = await ownedInboxItemId(inboxItemId, client);
  return (await listInboxAttachmentRows(id, client)).map(toObjectiveAttachmentDto);
}

interface InboxAttachmentStorageRow {
  id: string;
  workspace_id: string;
  storage_key: string;
  bucket_id: string;
  bucket_key: string;
  storage_backend: string;
  local_path: string | null;
  settings_json: string;
}

const INBOX_ATTACHMENT_STORAGE_SELECT = `SELECT a.id, a.workspace_id, a.storage_key,
         b.id AS bucket_id, b.bucket_key, b.storage_backend, b.local_path, b.settings_json
    FROM attachments a
    JOIN storage_buckets b ON b.id = a.storage_bucket_id`;

function storedObjectRef(row: InboxAttachmentStorageRow): StoredObjectRef {
  return {
    key: row.storage_key,
    bucket: {
      id: row.bucket_id,
      bucket_key: row.bucket_key,
      storage_backend: row.storage_backend,
      local_path: row.local_path,
      settings_json: row.settings_json
    }
  };
}

/**
 * Tombstone attachment rows that never entered a workspace feed. Returns the
 * stored objects to remove once the caller's transaction commits.
 */
async function tombstoneInboxAttachmentRows(
  rows: InboxAttachmentStorageRow[],
  tx: DatabaseClient
): Promise<StoredObjectRef[]> {
  const now = nowIso();
  for (const row of rows) {
    await tx.run(
      `UPDATE attachments
          SET deleted_at = ?, upload_status = 'deleted', updated_at = ?,
              revision = revision + 1
        WHERE id = ?`,
      [now, now, row.id]
    );
  }
  return rows.map(storedObjectRef);
}

/** Soft-delete one inbox attachment and return the item's remaining attachments. */
export async function deleteInboxItemAttachment(
  inboxItemId: string,
  attachmentId: string
): Promise<ObjectiveAttachmentDto[]> {
  const { remaining, cleanup } = await requireDatabaseClient().transaction(async tx => {
    const id = await ownedInboxItemId(inboxItemId, tx);
    const rows = await tx.all<InboxAttachmentStorageRow>(
      `${INBOX_ATTACHMENT_STORAGE_SELECT}
        WHERE a.id = ? AND a.inbox_item_id = ? AND a.deleted_at IS NULL`,
      [attachmentId, id]
    );
    if (rows.length === 0) throw new ApiError(404, 'Attachment not found');
    const cleanup = await tombstoneInboxAttachmentRows(rows, tx);
    const remaining = (await listInboxAttachmentRows(id, tx)).map(toObjectiveAttachmentDto);
    return { remaining, cleanup };
  });
  await removeStoredObjects(cleanup);
  return remaining;
}

/**
 * Tombstone every active attachment of an inbox item inside the caller's
 * transaction (item deletion, account deletion). The caller passes the
 * returned objects to {@link removeInboxAttachmentObjects} after commit.
 */
export async function tombstoneInboxItemAttachmentsTx(
  tx: DatabaseClient,
  where: { inboxItemId: string } | { profileId: string }
): Promise<StoredObjectRef[]> {
  const rows =
    'inboxItemId' in where
      ? await tx.all<InboxAttachmentStorageRow>(
          `${INBOX_ATTACHMENT_STORAGE_SELECT}
            WHERE a.inbox_item_id = ? AND a.deleted_at IS NULL`,
          [where.inboxItemId]
        )
      : await tx.all<InboxAttachmentStorageRow>(
          `${INBOX_ATTACHMENT_STORAGE_SELECT}
            JOIN inbox_items i ON i.id = a.inbox_item_id
           WHERE i.profile_id = ? AND a.deleted_at IS NULL`,
          [where.profileId]
        );
  return tombstoneInboxAttachmentRows(rows, tx);
}

export const removeInboxAttachmentObjects = removeStoredObjects;

/** Bytes copied into the destination workspace ahead of a cross-workspace promotion. */
export interface InboxAttachmentCopy {
  attachmentId: string;
  storageBucketId: string;
  storageKey: string;
  source: StoredObjectRef;
  target: StoredObjectRef;
}

async function readStoredBytes(object: StoredObjectRef): Promise<Buffer> {
  const stream = await createStorageBackend({ bucket: object.bucket, repoRoot }).getStream({
    key: object.key
  });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Copy an inbox item's attachments that live outside `targetWorkspaceId` into
 * that workspace's `attachments` bucket, before the promotion transaction. The
 * copies keep their attachment ids under the target workspace's canonical key.
 * If promotion then fails, discard them with {@link removeInboxAttachmentObjects}.
 */
export async function copyInboxAttachmentsToWorkspace(
  inboxItemId: string,
  targetWorkspaceId: string
): Promise<InboxAttachmentCopy[]> {
  const client = requireDatabaseClient();
  const rows = await client.all<InboxAttachmentStorageRow & { content_type: string | null }>(
    `SELECT a.id, a.workspace_id, a.storage_key, a.content_type,
            b.id AS bucket_id, b.bucket_key, b.storage_backend, b.local_path, b.settings_json
       FROM attachments a
       JOIN storage_buckets b ON b.id = a.storage_bucket_id
      WHERE a.inbox_item_id = ? AND a.deleted_at IS NULL AND a.workspace_id <> ?`,
    [inboxItemId, targetWorkspaceId]
  );
  if (rows.length === 0) return [];
  const bucket = await resolveBucket(ATTACHMENTS_BUCKET_KEY, targetWorkspaceId);
  const backend = createStorageBackend({ bucket, repoRoot });
  const copies: InboxAttachmentCopy[] = [];
  try {
    for (const row of rows) {
      const source = storedObjectRef(row);
      const storageKey = attachmentObjectKey(
        targetWorkspaceId,
        row.id,
        path.extname(row.storage_key)
      );
      await backend.put({
        key: storageKey,
        bytes: await readStoredBytes(source),
        contentType: row.content_type ?? 'application/octet-stream'
      });
      copies.push({
        attachmentId: row.id,
        storageBucketId: bucket.id,
        storageKey,
        source,
        target: { key: storageKey, bucket }
      });
    }
  } catch (error) {
    await removeStoredObjects(copies.map(copy => copy.target));
    throw error;
  }
  return copies;
}

/**
 * Inside the promotion transaction, re-point every active attachment of the
 * inbox item at the created mission's first objective and clear
 * `inbox_item_id`. Rows outside the destination workspace must have a copy from
 * {@link copyInboxAttachmentsToWorkspace}; one added after the copy step makes
 * the promotion retryable (409) rather than leave bytes in a foreign bucket.
 */
export async function repointInboxAttachmentsTx(
  tx: DatabaseClient,
  input: {
    inboxItemId: string;
    workspaceId: string;
    projectId: string;
    missionId: string;
    objectiveId: string;
    copies: InboxAttachmentCopy[];
  }
): Promise<void> {
  const rows = await tx.all<{ id: string; workspace_id: string; revision: number }>(
    `SELECT id, workspace_id, revision FROM attachments
      WHERE inbox_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [input.inboxItemId]
  );
  const copies = new Map(input.copies.map(copy => [copy.attachmentId, copy]));
  const now = nowIso();
  for (const row of rows) {
    const changedFields = ['project_id', 'mission_id', 'objective_id', 'inbox_item_id'];
    if (row.workspace_id === input.workspaceId) {
      await tx.run(
        `UPDATE attachments
            SET project_id = ?, mission_id = ?, objective_id = ?, inbox_item_id = NULL,
                updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [input.projectId, input.missionId, input.objectiveId, now, row.id]
      );
    } else {
      const copy = copies.get(row.id);
      if (!copy) {
        throw new ApiError(409, 'Inbox attachments changed during promotion. Try again.');
      }
      await tx.run(
        `UPDATE attachments
            SET workspace_id = ?, storage_bucket_id = ?, storage_key = ?,
                project_id = ?, mission_id = ?, objective_id = ?, inbox_item_id = NULL,
                updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [
          input.workspaceId,
          copy.storageBucketId,
          copy.storageKey,
          input.projectId,
          input.missionId,
          input.objectiveId,
          now,
          row.id
        ]
      );
      changedFields.unshift('workspace_id', 'storage_bucket_id', 'storage_key');
    }
    await recordChange(
      {
        entityType: 'attachment',
        entityId: row.id,
        operation: 'update',
        entityRevision: row.revision + 1,
        projectId: input.projectId,
        missionId: input.missionId,
        objectiveId: input.objectiveId,
        workspaceId: input.workspaceId,
        changedFields
      },
      tx
    );
  }
}

export interface ResolvedStoredObject {
  contentType: string;
  filename: string;
  /** Whether the bytes should be served as a download rather than rendered inline. */
  forceDownload: boolean;
  /** Populated for `local_fs` buckets; the serve route streams from disk. */
  absolutePath?: string;
  /** Populated for remote backends such as `s3`; the serve route proxies the stream. */
  bodyStream?: Readable;
  /**
   * Populated when the bucket opts into presigned reads (`settings_json.presignReads`);
   * the serve route 302-redirects after RBAC and metadata resolution.
   */
  presignedRedirectUrl?: string;
}

/** Bucket → metadata table for buckets whose objects can be served back. */
const SERVABLE_OBJECT_TABLES: Record<string, string> = {
  'user-images': 'user_images',
  'workspace-images': 'workspace_images',
  attachments: 'attachments'
};

/** Reverse of `IMAGE_EXTENSIONS`, used to derive `organization-images` content type from its key. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

/** Dispatch a resolved bucket + metadata to the bucket's storage backend. */
async function finalizeStoredObject({
  bucket,
  storageKey,
  contentType,
  filename,
  forceDownload
}: {
  bucket: StorageBucketRow;
  storageKey: string;
  contentType: string;
  filename: string;
  forceDownload: boolean;
}): Promise<ResolvedStoredObject> {
  const backend = createStorageBackend({ bucket, repoRoot });
  const readSettings = readStorageReadSettings(bucket.settings_json);

  if (readSettings.presignReads && backend.presignGet) {
    const responseContentDisposition = forceDownload
      ? `attachment; filename="${filename.replace(/"/g, '\\"')}"`
      : undefined;
    return {
      contentType,
      filename,
      forceDownload,
      presignedRedirectUrl: await backend.presignGet({
        key: storageKey,
        ttlSeconds: readSettings.presignTtlSeconds,
        responseContentDisposition
      })
    };
  }

  if (bucket.storage_backend === 'local_fs') {
    if (!bucket.local_path) {
      throw new ApiError(500, `Bucket '${bucket.bucket_key}' is missing a local_path`);
    }
    const root = path.isAbsolute(bucket.local_path)
      ? bucket.local_path
      : path.resolve(repoRoot, bucket.local_path);
    const absolutePath = path.join(root, storageKey);
    if (!existsSync(absolutePath)) throw new ApiError(404, 'File not found');
    return { absolutePath, contentType, filename, forceDownload };
  }

  return {
    bodyStream: await backend.getStream({ key: storageKey }),
    contentType,
    filename,
    forceDownload
  };
}

/**
 * Resolve a stored object's bytes for serving. Looks the object up by its exact
 * backend key so only recorded, non-deleted objects are served and path
 * traversal via `storageKey` is impossible. Attachments (arbitrary types) are
 * flagged for download so untrusted bytes are never rendered inline.
 *
 * `organization-images` is a dedicated branch: it has no per-object metadata
 * table (see `uploadOrganizationImage`), so content type is derived from the
 * storage key's extension instead of a database row, and the bucket is
 * resolved against the caller's active organization rather than `WORKSPACE.id`.
 */
export async function resolveStoredObject(
  bucketKey: string,
  storageKey: string,
  permission: Permission
): Promise<ResolvedStoredObject> {
  if (bucketKey === 'organization-images') {
    const organizationId = await requireActiveOrganizationId();
    await requireAnyWorkspacePermission(permission);
    const bucket = await resolveOrganizationBucket(organizationId, bucketKey);
    const ext = path.extname(storageKey).toLowerCase();
    return finalizeStoredObject({
      bucket,
      storageKey,
      contentType: CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream',
      filename: `logo${ext}`,
      forceDownload: false
    });
  }

  const table = SERVABLE_OBJECT_TABLES[bucketKey];
  if (!table) throw new ApiError(404, `Serving is not configured for bucket '${bucketKey}'`);

  if (bucketKey === 'attachments' && getActiveTokenProjectIds() !== null) {
    const attachment = await requireDatabaseClient().get<{ project_id: string | null }>(
      `SELECT project_id FROM attachments WHERE storage_key = ? AND deleted_at IS NULL`,
      [storageKey]
    );
    if (!attachment?.project_id || !projectInTokenScope(attachment.project_id)) {
      throw new ApiError(404, 'File not found');
    }
  }

  if (bucketKey === ATTACHMENTS_BUCKET_KEY) {
    // An unpromoted Inbox capture's files are private to the item's owner, not
    // readable by every member of the workspace that stores their bytes.
    const attachment = await requireDatabaseClient().get<{ inbox_item_id: string | null }>(
      `SELECT inbox_item_id FROM attachments WHERE storage_key = ? AND deleted_at IS NULL`,
      [storageKey]
    );
    if (attachment?.inbox_item_id) {
      await ownedInboxItemId(attachment.inbox_item_id).catch(() => {
        throw new ApiError(404, 'File not found');
      });
    }
  }

  let row = await requireDatabaseClient().get<{
    workspace_id: string;
    storage_bucket_id: string;
    storage_key: string;
    content_type: string | null;
    filename: string;
  }>(
    `SELECT workspace_id, storage_bucket_id, storage_key, content_type, filename FROM ${table}
      WHERE storage_key = ? AND deleted_at IS NULL`,
    [storageKey]
  );

  if (!row && bucketKey === 'user-images' && !storageKey.includes('/')) {
    const legacyStorageKeyLike = `%/${escapeSqlLike(storageKey)}`;
    row = await requireDatabaseClient().get<{
      workspace_id: string;
      storage_bucket_id: string;
      storage_key: string;
      content_type: string | null;
      filename: string;
    }>(
      `SELECT workspace_id, storage_bucket_id, storage_key, content_type, filename FROM user_images
        WHERE deleted_at IS NULL
          AND (
            public_url = ?
            OR storage_key = ?
            OR storage_key LIKE ? ESCAPE '\\'
          )
        ORDER BY created_at DESC
        LIMIT 1`,
      [publicUrlFor(bucketKey, storageKey), storageKey, legacyStorageKeyLike]
    );
  }
  if (!row) throw new ApiError(404, 'File not found');

  await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission,
    notFoundMessage: 'File not found'
  });
  const bucket = await resolveBucket(bucketKey, row.workspace_id);
  if (bucket.id !== row.storage_bucket_id) throw new ApiError(404, 'File not found');

  return finalizeStoredObject({
    bucket,
    storageKey: row.storage_key,
    contentType: row.content_type ?? 'application/octet-stream',
    filename: row.filename,
    forceDownload: bucketKey === ATTACHMENTS_BUCKET_KEY
  });
}

/** Stream, send, or redirect a resolved stored object through an Express response. */
export function serveStoredObject(res: Response, resolved: ResolvedStoredObject): void {
  if (resolved.presignedRedirectUrl) {
    res.redirect(302, resolved.presignedRedirectUrl);
    return;
  }
  if (resolved.absolutePath) {
    res.sendFile(resolved.absolutePath);
    return;
  }
  if (resolved.bodyStream) {
    resolved.bodyStream.pipe(res);
    return;
  }
  throw new ApiError(500, 'Stored object has no byte source');
}
