import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETAIN_VERSION_COUNT,
  getStoredVersions,
  getVersionRetentionPlan
} from '../scripts/upload-electron-release.mjs';

test('getStoredVersions only returns semver directory entries', () => {
  const versions = getStoredVersions([
    { name: '3.18.0', id: null, metadata: null },
    { name: '3.17.0', id: null, metadata: null },
    { name: 'latest-mac.yml', id: 'file-id', metadata: { size: 123 } },
    { name: 'not-a-version', id: null, metadata: null }
  ]);

  assert.deepEqual(versions, ['3.18.0', '3.17.0']);
});

test('getVersionRetentionPlan keeps only the newest three versions', () => {
  const { sortedVersions, versionsToKeep, versionsToDelete } = getVersionRetentionPlan([
    '3.15.0',
    '3.18.0',
    '3.17.0',
    '3.16.0',
    '3.14.0'
  ]);

  assert.equal(RETAIN_VERSION_COUNT, 3);
  assert.deepEqual(sortedVersions, ['3.18.0', '3.17.0', '3.16.0', '3.15.0', '3.14.0']);
  assert.deepEqual(versionsToKeep, ['3.18.0', '3.17.0', '3.16.0']);
  assert.deepEqual(versionsToDelete, ['3.15.0', '3.14.0']);
});
