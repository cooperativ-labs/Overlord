/**
 * The closed `storage_buckets.bucket_key` vocabulary and what each key means to
 * the backend: where its bucket row lives, which metadata table records its
 * objects, and which permissions gate its upload and serve routes.
 *
 * This is the one registry over the four keys. The upload route and the serve
 * route in backend/index.ts, the serve path in backend/storage.ts, and the
 * workspace bucket seeds (backend/workspaces.ts, backend/test-helpers.ts) all
 * read it instead of keeping their own key lists. It is a leaf module (no
 * runtime imports from the backend) so the test helpers can use it without
 * loading the database module.
 */

import { type Permission, PERMISSIONS } from '@overlord/auth';
import type { StorageBucketKey } from '@overlord/contract';

export type { StorageBucketKey } from '@overlord/contract';

export interface StorageBucketDescriptor {
  /**
   * Where the bucket row lives: one per workspace (`storage_buckets.workspace_id`)
   * or one per organization (`storage_buckets.organization_id`).
   */
  scope: 'workspace' | 'organization';
  /**
   * Metadata table that records each served object, looked up by exact
   * `storage_key`. `null` when the bucket has no per-object table: the object's
   * content type is then derived from its key's extension.
   */
  table: 'user_images' | 'workspace_images' | 'attachments' | null;
  /** Permission the serve route (`GET /api/storage/:bucketKey/:storageKey`) checks. */
  readPermission: Permission;
  /**
   * Permission the generic upload route (`POST /api/uploads/:bucketKey`) checks.
   * Absent when the bucket is not uploadable there (attachments have their own
   * objective- and Inbox-scoped routes).
   */
  uploadPermission?: Permission;
  /** Serve objects as downloads with `nosniff`: the bytes are arbitrary and untrusted. */
  forceDownload: boolean;
}

export const STORAGE_BUCKETS: Readonly<Record<StorageBucketKey, StorageBucketDescriptor>> = {
  'workspace-images': {
    scope: 'workspace',
    table: 'workspace_images',
    readPermission: PERMISSIONS.WORKSPACE_IMAGE_READ,
    uploadPermission: PERMISSIONS.WORKSPACE_IMAGE_CREATE,
    forceDownload: false
  },
  'user-images': {
    scope: 'workspace',
    table: 'user_images',
    readPermission: PERMISSIONS.USER_IMAGE_READ,
    uploadPermission: PERMISSIONS.USER_IMAGE_SELF_CREATE,
    forceDownload: false
  },
  'organization-images': {
    scope: 'organization',
    table: null,
    readPermission: PERMISSIONS.ORGANIZATION_IMAGE_READ,
    uploadPermission: PERMISSIONS.ORGANIZATION_IMAGE_CREATE,
    forceDownload: false
  },
  attachments: {
    scope: 'workspace',
    table: 'attachments',
    readPermission: PERMISSIONS.ATTACHMENT_READ,
    forceDownload: true
  }
};

/** Narrow a route parameter to a known bucket key. */
export function isStorageBucketKey(value: string): value is StorageBucketKey {
  return Object.hasOwn(STORAGE_BUCKETS, value);
}

/** Bucket keys seeded once per workspace, in seed order. */
export const WORKSPACE_BUCKET_KEYS: readonly StorageBucketKey[] = (
  Object.keys(STORAGE_BUCKETS) as StorageBucketKey[]
).filter(key => STORAGE_BUCKETS[key].scope === 'workspace');
