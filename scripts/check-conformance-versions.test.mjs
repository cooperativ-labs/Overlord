import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  checkConformanceVersions,
  manifestVersionError,
  readManifestVersion
} from './check-conformance-versions.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(version, manifests) {
  const root = mkdtempSync(path.join(tmpdir(), 'conformance-versions-'));
  roots.push(root);
  mkdirSync(path.join(root, 'contract'), { recursive: true });
  writeFileSync(path.join(root, 'contract/VERSION'), `${version}\n`);
  for (const [directory, contractVersion] of Object.entries(manifests)) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(
      path.join(root, directory, 'conformance-manifest.yaml'),
      `contractVersion: ${contractVersion}\ncomponentType: connector\n`
    );
  }
  return root;
}

describe('manifest version rule', () => {
  it('accepts the same version and earlier versions of the same major', () => {
    for (const manifestVersion of ['168.0.0', '168.2.0', '168.2.9']) {
      assert.equal(manifestVersionError({ manifestVersion, currentVersion: '168.3.0' }), undefined);
    }
  });

  it('refuses a different major in either direction', () => {
    assert.match(
      manifestVersionError({ manifestVersion: '167.9.9', currentVersion: '168.0.0' }),
      /different major/
    );
    assert.match(
      manifestVersionError({ manifestVersion: '169.0.0', currentVersion: '168.0.0' }),
      /different major/
    );
  });

  it('refuses a newer version of the same major', () => {
    assert.match(
      manifestVersionError({ manifestVersion: '168.1.0', currentVersion: '168.0.5' }),
      /newer than the contract/
    );
  });

  it('requires a quoted strict Semantic Version', () => {
    assert.equal(readManifestVersion('contractVersion: "168.0.0"\n'), '168.0.0');
    for (const text of ['contractVersion: 168\n', 'contractVersion: "168"\n', 'componentType: x\n']) {
      assert.throws(() => readManifestVersion(text), /strict MAJOR\.MINOR\.PATCH/);
    }
    assert.throws(() => readManifestVersion('- a\n'), /YAML object/);
  });
});

describe('checkConformanceVersions', () => {
  it('reports errors and earlier same-major manifests separately', () => {
    const root = repository('168.2.0', {
      'connectors/adapters/a': '"168.2.0"',
      'connectors/adapters/b': '"168.0.0"',
      'backend/ext/c': '"153"',
      'mcp': '"169.0.0"'
    });
    const result = checkConformanceVersions(root);
    assert.equal(result.currentVersion, '168.2.0');
    assert.equal(result.manifestCount, 4);
    assert.deepEqual(result.older, ['connectors/adapters/b/conformance-manifest.yaml: 168.0.0 (current: 168.2.0)']);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /^backend\/ext\/c\/conformance-manifest\.yaml: .*strict/);
    assert.match(result.errors[1], /^mcp\/conformance-manifest\.yaml: .*different major/);
  });

  it('refuses a non-SemVer contract/VERSION', () => {
    const root = repository('168', {});
    assert.throws(() => checkConformanceVersions(root), /contract\/VERSION is not strict/);
  });
});
