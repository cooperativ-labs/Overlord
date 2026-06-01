import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RELEASE_TARGETS,
  RETAIN_VERSION_COUNT,
  getManifestUploadNames,
  getTargetLabel,
  getStoredVersions,
  getVersionRetentionPlan,
  parseReleaseTargets
} from '../scripts/upload-electron-release.mjs';

test('getStoredVersions only returns semver directory entries', () => {
  const versions = getStoredVersions([
    { name: '0.2606010900.0', id: null, metadata: null },
    { name: '0.2605311700.0', id: null, metadata: null },
    { name: 'latest-mac.yml', id: 'file-id', metadata: { size: 123 } },
    { name: 'not-a-version', id: null, metadata: null }
  ]);

  assert.deepEqual(versions, ['0.2606010900.0', '0.2605311700.0']);
});

test('getVersionRetentionPlan keeps only the newest three versions', () => {
  const { sortedVersions, versionsToKeep, versionsToDelete } = getVersionRetentionPlan([
    '0.2605291200.0',
    '0.2606010900.0',
    '0.2605311700.0',
    '0.2605301200.0',
    '0.2605281200.0'
  ]);

  assert.equal(RETAIN_VERSION_COUNT, 3);
  assert.deepEqual(sortedVersions, [
    '0.2606010900.0',
    '0.2605311700.0',
    '0.2605301200.0',
    '0.2605291200.0',
    '0.2605281200.0'
  ]);
  assert.deepEqual(versionsToKeep, [
    '0.2606010900.0',
    '0.2605311700.0',
    '0.2605301200.0'
  ]);
  assert.deepEqual(versionsToDelete, ['0.2605291200.0', '0.2605281200.0']);
});

test('parseReleaseTargets preserves the existing mac arm64 default', () => {
  assert.deepEqual(parseReleaseTargets([]), DEFAULT_RELEASE_TARGETS);
});

test('parseReleaseTargets accepts linux amd64 as the x64 electron-builder target', () => {
  assert.deepEqual(parseReleaseTargets(['--target', 'linux:amd64']), [
    { platform: 'linux', arch: 'x64', publishRootManifest: true }
  ]);
});

test('parseReleaseTargets accepts platform and linux arch flags', () => {
  assert.deepEqual(parseReleaseTargets(['--platform', 'linux', '--linux-arch', 'amd64']), [
    { platform: 'linux', arch: 'x64', publishRootManifest: true }
  ]);
});

test('getManifestUploadNames publishes amd64 and legacy x64 linux manifest aliases', () => {
  assert.deepEqual(getManifestUploadNames('linux', 'x64'), [
    'latest-linux-amd64.yml',
    'latest-linux-x64.yml'
  ]);
});

test('getTargetLabel displays linux x64 as amd64 for release logs', () => {
  assert.equal(getTargetLabel({ platform: 'linux', arch: 'x64' }), 'linux/amd64');
});
