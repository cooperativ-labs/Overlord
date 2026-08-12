import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  discoverLatchForExecutionTarget,
  evaluateLatchCapabilities,
  isLatchDiscoveryCacheFresh,
  LATCH_STANDALONE_INSTALL_COMMAND,
  type LatchCapabilitiesReport,
  type LatchCommandRunner,
  type LatchDiscoveryCacheEntry,
  parseLatchCapabilitiesReport,
  probeLatchCapabilities,
  resolveLatchExecutablePathFromEnvironment,
  SUPPORTED_LATCH_PROTOCOL_VERSION
} from './latch-discovery.ts';

const sampleReport = (
  overrides: Partial<LatchCapabilitiesReport> = {}
): LatchCapabilitiesReport => ({
  protocolVersion: SUPPORTED_LATCH_PROTOCOL_VERSION,
  productVersion: '0.1.0',
  ...overrides,
  capabilities: {
    create: true,
    openViewer: true,
    localAttach: true,
    cloudAttach: false,
    selfUpdate: true,
    extensions: [],
    ...(overrides.capabilities ?? {})
  }
});

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempCachePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'latch-discovery-'));
  tempDirs.push(dir);
  return path.join(dir, 'latch-discovery.json');
}

describe('parseLatchCapabilitiesReport', () => {
  test('parses the Overlord discovery schema', () => {
    const report = parseLatchCapabilitiesReport(
      JSON.stringify({
        protocolVersion: 1,
        productVersion: '0.1.0',
        capabilities: {
          create: true,
          openViewer: false,
          localAttach: true,
          cloudAttach: false,
          selfUpdate: false,
          extensions: ['widgets']
        }
      })
    );
    assert.deepEqual(report, {
      protocolVersion: 1,
      productVersion: '0.1.0',
      capabilities: {
        create: true,
        openViewer: false,
        localAttach: true,
        cloudAttach: false,
        selfUpdate: false,
        extensions: ['widgets']
      }
    });
  });

  test('rejects non-JSON and incomplete documents', () => {
    assert.equal(parseLatchCapabilitiesReport(''), null);
    assert.equal(parseLatchCapabilitiesReport('not-json'), null);
    assert.equal(parseLatchCapabilitiesReport('{"protocolVersion":1}'), null);
    assert.equal(
      parseLatchCapabilitiesReport(
        JSON.stringify({ protocolVersion: 1, productVersion: '1.0.0', capabilities: null })
      ),
      null
    );
  });
});

describe('evaluateLatchCapabilities', () => {
  test('found when protocol and create are present', () => {
    const result = evaluateLatchCapabilities({
      report: sampleReport(),
      executable: 'latch',
      resolvedPath: '/usr/local/bin/latch',
      checkedAt: '2026-08-12T00:00:00.000Z'
    });
    assert.equal(result.state, 'found');
    if (result.state !== 'found') return;
    assert.equal(result.latchSelectable, true);
    assert.equal(result.directSelectable, true);
    assert.equal(result.productVersion, '0.1.0');
    assert.equal(result.resolvedPath, '/usr/local/bin/latch');
  });

  test('incompatible names protocolVersion when unsupported', () => {
    const result = evaluateLatchCapabilities({
      report: sampleReport({ protocolVersion: 99 }),
      executable: 'latch',
      resolvedPath: '/opt/latch'
    });
    assert.equal(result.state, 'incompatible');
    if (result.state !== 'incompatible') return;
    assert.equal(result.missingCapability, 'protocolVersion');
    assert.equal(result.latchSelectable, false);
    assert.equal(result.directSelectable, true);
  });

  test('incompatible names create when the required capability is false', () => {
    const result = evaluateLatchCapabilities({
      report: sampleReport({
        capabilities: {
          create: false,
          openViewer: true,
          localAttach: true,
          cloudAttach: false,
          selfUpdate: true,
          extensions: []
        }
      }),
      executable: 'latch',
      resolvedPath: '/opt/latch'
    });
    assert.equal(result.state, 'incompatible');
    if (result.state !== 'incompatible') return;
    assert.equal(result.missingCapability, 'create');
  });

  test('missing openViewer alone does not make Latch incompatible', () => {
    const result = evaluateLatchCapabilities({
      report: sampleReport({
        capabilities: {
          create: true,
          openViewer: false,
          localAttach: true,
          cloudAttach: false,
          selfUpdate: true,
          extensions: []
        }
      }),
      executable: 'latch',
      resolvedPath: '/opt/latch'
    });
    assert.equal(result.state, 'found');
  });
});

describe('probeLatchCapabilities', () => {
  test('not_installed when the executable cannot be resolved', () => {
    const result = probeLatchCapabilities({
      executable: 'latch',
      resolvePath: () => null,
      now: () => 't0'
    });
    assert.equal(result.state, 'not_installed');
    if (result.state !== 'not_installed') return;
    assert.equal(result.installCommand, LATCH_STANDALONE_INSTALL_COMMAND);
    assert.equal(result.latchSelectable, false);
    assert.equal(result.directSelectable, true);
  });

  test('found when capabilities JSON is healthy', () => {
    const runCommand: LatchCommandRunner = () => ({
      status: 0,
      stdout: JSON.stringify(sampleReport()),
      stderr: ''
    });
    const result = probeLatchCapabilities({
      executable: 'latch',
      resolvePath: () => '/bin/latch',
      runCommand,
      now: () => 't1'
    });
    assert.equal(result.state, 'found');
    if (result.state !== 'found') return;
    assert.equal(result.resolvedPath, '/bin/latch');
    assert.equal(result.capabilities.create, true);
  });

  test('incompatible when stdout is not a capabilities report', () => {
    const result = probeLatchCapabilities({
      resolvePath: () => '/bin/latch',
      runCommand: () => ({ status: 0, stdout: 'hello', stderr: '' }),
      now: () => 't2'
    });
    assert.equal(result.state, 'incompatible');
    if (result.state !== 'incompatible') return;
    assert.equal(result.missingCapability, 'capabilities');
  });
});

describe('resolveLatchExecutablePathFromEnvironment', () => {
  test('uses the documented standalone install location when PATH cannot resolve Latch', () => {
    const executable = '/Users/jane/.local/bin/latch';
    const result = resolveLatchExecutablePathFromEnvironment({
      executable: 'latch',
      homeDirectory: '/Users/jane',
      platform: 'darwin',
      resolveOnPath: () => null,
      fileExists: filePath => filePath === executable
    });

    assert.equal(result, executable);
  });

  test('uses macOS Homebrew locations when the GUI or service PATH omits them', () => {
    const executable = '/opt/homebrew/bin/latch';
    const result = resolveLatchExecutablePathFromEnvironment({
      executable: 'latch',
      homeDirectory: '/Users/jane',
      platform: 'darwin',
      resolveOnPath: () => null,
      fileExists: filePath => filePath === executable
    });

    assert.equal(result, executable);
  });

  test('does not replace an executable explicitly configured by absolute path', () => {
    const executable = '/custom/bin/latch';
    const result = resolveLatchExecutablePathFromEnvironment({
      executable,
      resolveOnPath: () => null,
      fileExists: filePath => filePath === executable
    });

    assert.equal(result, executable);
  });
});

describe('discoverLatchForExecutionTarget cache', () => {
  test('reuses a fresh cache entry without re-probing', () => {
    const cacheFilePath = tempCachePath();
    let probes = 0;
    const runCommand: LatchCommandRunner = () => {
      probes += 1;
      return { status: 0, stdout: JSON.stringify(sampleReport()), stderr: '' };
    };
    const binary = path.join(path.dirname(cacheFilePath), 'fake-latch');
    writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });

    const first = discoverLatchForExecutionTarget({
      executionTargetId: 'target-1',
      executable: 'latch',
      cacheFilePath,
      resolvePath: () => binary,
      runCommand,
      now: () => 't-a'
    });
    assert.equal(first.state, 'found');
    assert.equal(probes, 1);

    const second = discoverLatchForExecutionTarget({
      executionTargetId: 'target-1',
      executable: 'latch',
      cacheFilePath,
      resolvePath: () => binary,
      runCommand,
      now: () => 't-b'
    });
    assert.equal(second.state, 'found');
    assert.equal(probes, 1, 'cheap revalidation must not re-run latch capabilities');
  });

  test('force refreshes even when the cache is fresh', () => {
    const cacheFilePath = tempCachePath();
    let probes = 0;
    const runCommand: LatchCommandRunner = () => {
      probes += 1;
      return { status: 0, stdout: JSON.stringify(sampleReport()), stderr: '' };
    };
    const binary = path.join(path.dirname(cacheFilePath), 'fake-latch');
    writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });

    discoverLatchForExecutionTarget({
      executionTargetId: 'target-1',
      cacheFilePath,
      resolvePath: () => binary,
      runCommand
    });
    discoverLatchForExecutionTarget({
      executionTargetId: 'target-1',
      cacheFilePath,
      force: true,
      resolvePath: () => binary,
      runCommand
    });
    assert.equal(probes, 2);
  });

  test('not_installed cache stays fresh only while which still finds nothing', () => {
    const entry: LatchDiscoveryCacheEntry = {
      result: {
        state: 'not_installed',
        executable: 'latch',
        installCommand: LATCH_STANDALONE_INSTALL_COMMAND,
        checkedAt: 't0',
        latchSelectable: false,
        directSelectable: true
      },
      binaryMtimeMs: null,
      cachedAt: 't0'
    };
    assert.equal(isLatchDiscoveryCacheFresh({ entry, resolvePath: () => null }), true);
    assert.equal(isLatchDiscoveryCacheFresh({ entry, resolvePath: () => '/bin/latch' }), false);
  });

  test('caches are scoped per execution target', () => {
    const cacheFilePath = tempCachePath();
    let probes = 0;
    const runCommand: LatchCommandRunner = () => {
      probes += 1;
      return { status: 0, stdout: JSON.stringify(sampleReport()), stderr: '' };
    };
    const binary = path.join(path.dirname(cacheFilePath), 'fake-latch');
    writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 });

    discoverLatchForExecutionTarget({
      executionTargetId: 'target-a',
      cacheFilePath,
      resolvePath: () => binary,
      runCommand
    });
    discoverLatchForExecutionTarget({
      executionTargetId: 'target-b',
      cacheFilePath,
      resolvePath: () => binary,
      runCommand
    });
    assert.equal(probes, 2);
  });
});
