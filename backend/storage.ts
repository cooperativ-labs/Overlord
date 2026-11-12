/**
 * Uploaded-object storage (the backend's recorded storage owner; see
 * backend/AGENTS.md).
 *
 * Bytes live in the storage backend (`local_fs` on disk for local installs, or
 * `s3` / `railway_volume` against an S3-compatible endpoint for hosted
 * deployments); the database holds metadata and backend keys only — see
 * contract/data/README.md (`storage_buckets`, `user_images`).
 *
 * This module holds four responsibilities:
 *
 * 1. Buckets and bytes: resolving a workspace or organization `storage_buckets`
 *    row, writing, reading, and removing stored objects.
 * 2. Image uploads: the `user-images`, `workspace-images`, and
 *    `organization-images` writers over the shared `writeImageObject`.
 * 3. Attachments: the shared attachment primitives (`writeAttachmentObject`,
 *    `insertAttachmentRow`, `attachmentStoredObjects`, `tombstoneAttachmentRows`)
 *    and the objective attachment owner. The Inbox attachment owner builds on
 *    the same primitives in backend/inbox-attachments.ts, which imports this
 *    module; this module never imports it.
 * 4. The serve path: `resolveStoredObject` / `serveStoredObject`.
 */

import { type Permission, PERMISSIONS } from '@overlord/auth';
import type { ObjectiveAttachmentDto, StorageBucketKey, StoredImageDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Response } from 'express';
import type { Selectable } from 'kysely';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { StorageBuckets } from '../packages/core/types/db.ts';

import {
  getActiveTokenProjectIds,
  getActorWorkspaceUserId,
  getAuthorizedWorkspacesContext,
  getImplicitWorkspaceIdOrNull,
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
  requireTokenOrganizationGrant,
  requireWorkspacePermission
} from './rbac.ts';
import {
  createStorageBackend,
  isRemoteStorageBackend,
  readStorageReadSettings,
  resolveLocalObjectPath,
  type StorageBackend,
  type StorageBucketRef
} from './storage-backends.ts';
import { STORAGE_BUCKETS } from './storage-buckets.ts';

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
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
};

/** Inverse of `IMAGE_EXTENSIONS`: content type for a stored image key's extension. */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IMAGE_EXTENSIONS).map(([contentType, ext]) => [ext, contentType])
);

type StorageBucketRow = Omit<StorageBucketRef, 'bucket_key'> &
  Pick<Selectable<StorageBuckets>, 'base_url'> & { bucket_key: StorageBucketKey };

/** Resolve a specified workspace's bucket for `bucketKey`, or 404 if absent. */
export async function resolveBucket(
  bucketKey: StorageBucketKey,
  workspaceId: string
): Promise<StorageBucketRow> {
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
  bucketKey: StorageBucketKey
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
function publicUrlFor(bucketKey: StorageBucketKey, storageKey: string): string {
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
  contentType: StoredImageDto['contentType'];
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether `storageKey` is an image key `uploadOrganizationImage` writes for
 * `organizationId`: `organization-files/<organizationId>/images/<uuid><ext>`
 * with a supported image extension. Organization images have no metadata row,
 * so this exact shape is what binds a key to its organization.
 */
export function isOrganizationImageKey(organizationId: string, storageKey: string): boolean {
  const prefix = `organization-files/${organizationId}/images/`;
  if (!storageKey.startsWith(prefix)) return false;
  const name = storageKey.slice(prefix.length);
  const ext = path.extname(name);
  if (!Object.hasOwn(CONTENT_TYPE_BY_EXTENSION, ext)) return false;
  return UUID_PATTERN.test(name.slice(0, name.length - ext.length));
}

export function attachmentObjectKey(
  workspaceId: string,
  attachmentId: string,
  ext: string
): string {
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
    // extensionForImage refused every other content type.
    contentType: contentType as StoredImageDto['contentType'],
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
    publicUrl: publicUrlFor(bucket.bucket_key, storageKey)
  };
}

/**
 * The uploader's `profiles.id`: the authenticated profile, or the one behind
 * the attributed workspace member. Only the loopback local operator with
 * neither (and no authenticated request) falls back to the oldest active
 * human profile.
 */
async function uploaderProfileId(): Promise<string> {
  const client = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(client);
  if (profileId) return profileId;
  if (getAuthorizedWorkspacesContext()) throw new ApiError(401, 'Authentication required');
  const fallback = await client.get<{ id: string }>(
    `SELECT id FROM profiles
      WHERE kind = 'human' AND status = 'active' AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`
  );
  if (!fallback) throw new ApiError(409, 'No local user profile exists');
  return fallback.id;
}

function uploadWorkspaceId(explicitWorkspaceId?: string): string {
  const workspaceId = explicitWorkspaceId?.trim() || getImplicitWorkspaceIdOrNull();
  if (!workspaceId) throw new ApiError(400, 'workspaceId is required');
  return workspaceId;
}

/**
 * Upload an image to the `user-images` bucket and record it against the
 * uploader's profile. Returns the stored-image descriptor including the URL to
 * serve it.
 */
export async function uploadUserImage(
  input: UploadImageInput,
  explicitWorkspaceId?: string
): Promise<StoredImageDto> {
  const workspaceId = uploadWorkspaceId(explicitWorkspaceId);
  const bucket = await resolveBucket('user-images', workspaceId);
  const userId = await uploaderProfileId();
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
  await requireTokenOrganizationGrant({
    organizationId,
    permission: PERMISSIONS.ORGANIZATION_IMAGE_CREATE,
    everyWorkspace: true
  });
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

// ---- Attachments (attachments bucket) --------------------------------------
//
// Attachments reuse the generic bucket plumbing above but, unlike images,
// accept any content type and are recorded in the `attachments` table, scoped
// either to an objective (with its mission and project) or to a profile-owned
// Inbox item (see backend/inbox-attachments.ts). Bytes are served as downloads
// via the same `/api/storage/<bucket>/<key>` route as images. The primitives
// below are the one write, insert, cleanup-select, and tombstone shared by both
// owners.

export const ATTACHMENTS_BUCKET_KEY = 'attachments' satisfies StorageBucketKey;

/** Build the backend for a bucket row, resolving `local_fs` paths against the repo root. */
export function storageBackendFor(bucket: StoredObjectRef['bucket']): StorageBackend {
  return createStorageBackend({ bucket, repoRoot });
}

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

export function assertAttachmentBytes(bytes: Buffer): void {
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

export interface AttachmentRow {
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

export function toObjectiveAttachmentDto(row: AttachmentRow): ObjectiveAttachmentDto {
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

export const ATTACHMENT_COLUMNS = `id, workspace_id, project_id, mission_id, objective_id, inbox_item_id,
  storage_key, filename, content_type, size_bytes, upload_status, created_at`;

/** An attachment's bytes as written to its bucket, ready for {@link insertAttachmentRow}. */
export interface WrittenAttachment {
  id: string;
  workspaceId: string;
  storageBucketId: string;
  storageKey: string;
  /** Normalised media type, or null when the upload carried none. */
  contentType: string | null;
  filename: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Write attachment bytes to `bucket` under `workspaceId`'s canonical attachment
 * key. Callers validate the bytes with {@link assertAttachmentBytes} first.
 */
export async function writeAttachmentObject(
  bucket: StorageBucketRow,
  workspaceId: string,
  input: UploadImageInput
): Promise<WrittenAttachment> {
  const id = newId();
  const storageKey = attachmentObjectKey(workspaceId, id, attachmentExtension(input.filename));
  const contentType = input.contentType.split(';')[0].trim().toLowerCase() || null;
  await storageBackendFor(bucket).put({
    key: storageKey,
    bytes: input.bytes,
    contentType: contentType ?? 'application/octet-stream'
  });
  return {
    id,
    workspaceId,
    storageBucketId: bucket.id,
    storageKey,
    contentType,
    filename: input.filename.trim() || `attachment${path.extname(storageKey)}`,
    sizeBytes: input.bytes.length,
    checksum: createHash('sha256').update(input.bytes).digest('hex')
  };
}

/** Owner columns of an attachment row: an objective's scope, or an Inbox item. */
export interface AttachmentOwnerScope {
  projectId: string | null;
  missionId: string | null;
  objectiveId: string | null;
  inboxItemId: string | null;
}

/** Record a written attachment's metadata row inside the caller's transaction. */
export async function insertAttachmentRow(
  tx: DatabaseClient,
  written: WrittenAttachment,
  scope: AttachmentOwnerScope,
  createdByWorkspaceUserId: string | null
): Promise<AttachmentRow> {
  const now = nowIso();
  await tx.run(
    `INSERT INTO attachments (
       id, workspace_id, project_id, mission_id, objective_id, inbox_item_id, storage_bucket_id,
       storage_key, filename, content_type, size_bytes, checksum_sha256, upload_status,
       metadata_json, created_by_workspace_user_id, created_at, updated_at, revision
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, 'available',
       '{}', ?, ?, ?, 1
     )`,
    [
      written.id,
      written.workspaceId,
      scope.projectId,
      scope.missionId,
      scope.objectiveId,
      scope.inboxItemId,
      written.storageBucketId,
      written.storageKey,
      written.filename,
      written.contentType,
      written.sizeBytes,
      written.checksum,
      createdByWorkspaceUserId,
      now,
      now
    ]
  );
  return {
    id: written.id,
    workspace_id: written.workspaceId,
    project_id: scope.projectId,
    mission_id: scope.missionId,
    objective_id: scope.objectiveId,
    inbox_item_id: scope.inboxItemId,
    storage_key: written.storageKey,
    filename: written.filename,
    content_type: written.contentType,
    size_bytes: written.sizeBytes,
    upload_status: 'available',
    created_at: now
  };
}

/** Tombstone attachment rows (soft delete + revision bump) inside the caller's transaction. */
export async function tombstoneAttachmentRows(tx: DatabaseClient, ids: string[]): Promise<void> {
  const now = nowIso();
  for (const id of ids) {
    await tx.run(
      `UPDATE attachments
          SET deleted_at = ?, upload_status = 'deleted', updated_at = ?,
              revision = revision + 1
        WHERE id = ?`,
      [now, now, id]
    );
  }
}

/** An active attachment row joined to its bucket, for byte cleanup or copy. */
export interface AttachmentStoredObject {
  id: string;
  workspaceId: string;
  revision: number;
  contentType: string | null;
  object: StoredObjectRef;
}

/** Which active attachments {@link attachmentStoredObjects} selects. */
export type AttachmentStoredObjectsWhere =
  | { by: 'objective-attachment'; attachmentId: string; objectiveId: string; workspaceId: string }
  | { by: 'inbox-attachment'; attachmentId: string; inboxItemId: string }
  | { by: 'inbox-item'; inboxItemId: string; outsideWorkspaceId?: string }
  | { by: 'profile-inbox'; profileId: string };

function attachmentStoredObjectsFilter(where: AttachmentStoredObjectsWhere): {
  sql: string;
  params: string[];
} {
  switch (where.by) {
    case 'objective-attachment':
      return {
        sql: `WHERE a.id = ? AND a.objective_id = ? AND a.workspace_id = ?
          AND a.deleted_at IS NULL AND b.deleted_at IS NULL`,
        params: [where.attachmentId, where.objectiveId, where.workspaceId]
      };
    case 'inbox-attachment':
      return {
        sql: `WHERE a.id = ? AND a.inbox_item_id = ? AND a.deleted_at IS NULL`,
        params: [where.attachmentId, where.inboxItemId]
      };
    case 'inbox-item':
      return where.outsideWorkspaceId === undefined
        ? {
            sql: `WHERE a.inbox_item_id = ? AND a.deleted_at IS NULL`,
            params: [where.inboxItemId]
          }
        : {
            sql: `WHERE a.inbox_item_id = ? AND a.deleted_at IS NULL AND a.workspace_id <> ?`,
            params: [where.inboxItemId, where.outsideWorkspaceId]
          };
    case 'profile-inbox':
      return {
        sql: `JOIN inbox_items i ON i.id = a.inbox_item_id
           WHERE i.profile_id = ? AND a.deleted_at IS NULL`,
        params: [where.profileId]
      };
  }
}

/** Select active attachments with their bucket, as references to their stored bytes. */
export async function attachmentStoredObjects(
  client: DatabaseClient,
  where: AttachmentStoredObjectsWhere
): Promise<AttachmentStoredObject[]> {
  const filter = attachmentStoredObjectsFilter(where);
  const rows = await client.all<{
    id: string;
    workspace_id: string;
    revision: number;
    storage_key: string;
    content_type: string | null;
    bucket_id: string;
    bucket_key: string;
    storage_backend: string;
    local_path: string | null;
    settings_json: string;
  }>(
    `SELECT a.id, a.workspace_id, a.revision, a.storage_key, a.content_type,
            b.id AS bucket_id, b.bucket_key, b.storage_backend, b.local_path, b.settings_json
       FROM attachments a
       JOIN storage_buckets b ON b.id = a.storage_bucket_id
     ${filter.sql}`,
    filter.params
  );
  return rows.map(row => ({
    id: row.id,
    workspaceId: row.workspace_id,
    revision: row.revision,
    contentType: row.content_type,
    object: {
      key: row.storage_key,
      bucket: {
        id: row.bucket_id,
        bucket_key: row.bucket_key,
        storage_backend: row.storage_backend,
        local_path: row.local_path,
        settings_json: row.settings_json
      }
    }
  }));
}

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
  const written = await writeAttachmentObject(bucket, scope.workspace_id, input);

  return requireDatabaseClient().transaction(async tx => {
    const row = await insertAttachmentRow(
      tx,
      written,
      {
        projectId: scope.project_id,
        missionId: scope.mission_id,
        objectiveId: scope.id,
        inboxItemId: null
      },
      getActorWorkspaceUserId()
    );

    await recordChange(
      {
        entityType: 'attachment',
        entityId: written.id,
        operation: 'insert',
        entityRevision: 1,
        projectId: scope.project_id,
        missionId: scope.mission_id,
        objectiveId: scope.id,
        workspaceId: scope.workspace_id
      },
      tx
    );

    return toObjectiveAttachmentDto(row);
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
    const [attachment] = await attachmentStoredObjects(tx, {
      by: 'objective-attachment',
      attachmentId,
      objectiveId: scope.id,
      workspaceId: scope.workspace_id
    });
    if (!attachment) throw new ApiError(404, 'Attachment not found');

    await tombstoneAttachmentRows(tx, [attachment.id]);

    await recordChange(
      {
        entityType: 'attachment',
        entityId: attachmentId,
        operation: 'delete',
        entityRevision: attachment.revision + 1,
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
    return { remaining: rows.map(toObjectiveAttachmentDto), cleanup: attachment.object };
  });

  await removeStoredObjects([cleanup]);
  return remaining;
}

/** A stored object's backend key and the bucket row that holds it. */
export interface StoredObjectRef {
  key: string;
  bucket: StorageBucketRef;
}

/**
 * Remove stored bytes after their metadata change has committed. Remote
 * backends delete the object; local buckets keep historical on-disk behavior.
 */
export async function removeStoredObjects(objects: StoredObjectRef[]): Promise<void> {
  for (const object of objects) {
    if (isRemoteStorageBackend(object.bucket.storage_backend)) {
      const backend = storageBackendFor(object.bucket);
      await backend.deleteObject?.({ key: object.key });
    }
  }
}

/** Read a stored object's bytes into memory (used to copy them between buckets). */
export async function readStoredBytes(object: StoredObjectRef): Promise<Buffer> {
  const stream = await storageBackendFor(object.bucket).getStream({ key: object.key });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Resolve an Inbox item the caller owns, or 404. Lives here rather than in
 * backend/inbox-attachments.ts because the serve path's owner check below
 * needs it, and inbox-attachments.ts imports this module (not the reverse).
 */
export async function ownedInboxItemId(
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
    const absolutePath = resolveLocalObjectPath(root, storageKey);
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
 * The bucket's `STORAGE_BUCKETS` descriptor drives the dispatch. An
 * organization-scoped bucket (`organization-images`) has no per-object metadata
 * table (see `uploadOrganizationImage`), so content type is derived from the
 * storage key's extension instead of a database row, the bucket is resolved
 * against the caller's active organization rather than the object's
 * workspace, and only keys of that organization's image shape
 * (`isOrganizationImageKey`) are served. Every backend additionally accepts
 * only well-formed relative keys confined to the bucket. The two attachments-only authorization rules (token project scope
 * and Inbox ownership) stay explicit below.
 */
export async function resolveStoredObject(
  bucketKey: StorageBucketKey,
  storageKey: string,
  permission: Permission
): Promise<ResolvedStoredObject> {
  const descriptor = STORAGE_BUCKETS[bucketKey];

  if (descriptor.scope === 'organization') {
    const organizationId = await requireActiveOrganizationId();
    await requireAnyWorkspacePermission(permission);
    if (!isOrganizationImageKey(organizationId, storageKey)) {
      throw new ApiError(404, 'File not found');
    }
    const bucket = await resolveOrganizationBucket(organizationId, bucketKey);
    const ext = path.extname(storageKey).toLowerCase();
    return finalizeStoredObject({
      bucket,
      storageKey,
      contentType: CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream',
      filename: `logo${ext}`,
      forceDownload: descriptor.forceDownload
    });
  }

  const table = descriptor.table;
  if (!table) throw new ApiError(404, `Serving is not configured for bucket '${bucketKey}'`);

  if (bucketKey === ATTACHMENTS_BUCKET_KEY && getActiveTokenProjectIds() !== null) {
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
    forceDownload: descriptor.forceDownload
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
