import { PERMISSIONS } from '@overlord/auth';
import type { StorageBucketKey } from '@overlord/contract';
import assert from 'node:assert/strict';
import test from 'node:test';

import { isStorageBucketKey, STORAGE_BUCKETS, WORKSPACE_BUCKET_KEYS } from './storage-buckets.ts';

const KNOWN_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

// The closed vocabulary from contract/data/README.md
// (`storage_buckets.bucket_key`). `satisfies` fails to compile if the contract
// union gains or loses a key without this list following.
const VOCABULARY = [
  'user-images',
  'workspace-images',
  'organization-images',
  'attachments'
] as const satisfies readonly StorageBucketKey[];

test('every bucket key has a known read permission and every upload permission is known', () => {
  assert.deepEqual(Object.keys(STORAGE_BUCKETS).sort(), [...VOCABULARY].sort());
  for (const [key, descriptor] of Object.entries(STORAGE_BUCKETS)) {
    assert.ok(KNOWN_PERMISSIONS.has(descriptor.readPermission), `${key} read permission`);
    if (descriptor.uploadPermission !== undefined) {
      assert.ok(KNOWN_PERMISSIONS.has(descriptor.uploadPermission), `${key} upload permission`);
    }
  }
});

test('only organization-scoped buckets lack a metadata table, and only attachments download', () => {
  for (const [key, descriptor] of Object.entries(STORAGE_BUCKETS)) {
    assert.equal(descriptor.table === null, descriptor.scope === 'organization', key);
    assert.equal(descriptor.forceDownload, key === 'attachments', key);
  }
});

test('workspace seed keys are the workspace-scoped keys in their existing seed order', () => {
  assert.deepEqual(WORKSPACE_BUCKET_KEYS, ['workspace-images', 'user-images', 'attachments']);
});

test('isStorageBucketKey rejects unknown and prototype keys', () => {
  for (const key of VOCABULARY) assert.equal(isStorageBucketKey(key), true, key);
  for (const key of ['', 'avatars', 'toString', '__proto__', 'constructor']) {
    assert.equal(isStorageBucketKey(key), false, key);
  }
});
