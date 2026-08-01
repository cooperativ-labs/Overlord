import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

import {
  AGENT_SESSION_CAPABILITY_IDS,
  findHarnessDescriptor,
  HARNESS_DESCRIPTORS
} from '../dist/agent-session/catalog.generated.js';
import { inspectInstalledDescriptor } from '../dist/agent-session/descriptor.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const adaptersDir = path.join(repoRoot, 'connectors', 'adapters');
const cliEntry = path.join(repoRoot, 'cli', 'bin', 'ovld.mjs');

function shippedAdapters(): string[] {
  return readdirSync(adaptersDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function readDescriptor(adapter: string): Record<string, any> {
  return parseYaml(
    readFileSync(path.join(adaptersDir, adapter, 'harness-capabilities.yaml'), 'utf8')
  );
}

test('every shipped connector has a descriptor, a generated page, and a catalog entry', () => {
  for (const adapter of shippedAdapters()) {
    assert.ok(
      existsSync(path.join(adaptersDir, adapter, 'harness-capabilities.yaml')),
      `${adapter} is missing harness-capabilities.yaml`
    );
    assert.ok(
      existsSync(path.join(adaptersDir, adapter, 'CAPABILITIES.md')),
      `${adapter} is missing its generated CAPABILITIES.md`
    );
    assert.ok(findHarnessDescriptor(adapter), `${adapter} is missing from the compiled catalog`);
  }
  assert.equal(HARNESS_DESCRIPTORS.length, shippedAdapters().length);
});

test('every adapter appears in the generated cross-adapter matrix', () => {
  const matrix = readFileSync(path.join(repoRoot, 'connectors', 'HARNESS-MATRIX.md'), 'utf8');
  for (const adapter of shippedAdapters()) {
    assert.ok(matrix.includes(`\`${adapter}\``), `${adapter} is missing from HARNESS-MATRIX.md`);
  }
});

test('descriptors declare every capability id — an omission would read as a claim', () => {
  for (const adapter of shippedAdapters()) {
    const descriptor = readDescriptor(adapter);
    for (const id of AGENT_SESSION_CAPABILITY_IDS) {
      assert.ok(descriptor.capabilities?.[id], `${adapter} does not declare ${id}`);
    }
  }
});

test('each status carries the evidence its grade requires', () => {
  for (const adapter of shippedAdapters()) {
    const descriptor = readDescriptor(adapter);
    const nodes: Array<[string, any]> = [
      ['binding', descriptor.binding],
      ['decisionHold', descriptor.decisionHold],
      ...Object.entries(descriptor.capabilities as Record<string, any>)
    ];
    for (const [label, node] of nodes) {
      const where = `${adapter}.${label}`;
      if (node.status === 'unsupported') {
        assert.ok(node.reason, `${where}: unsupported requires a reason`);
        assert.ok(node.evidenceRef, `${where}: unsupported requires an evidenceRef`);
      }
      if (node.status === 'not-implemented' || node.status === 'unverified') {
        assert.ok(node.trackedAs, `${where}: ${node.status} requires trackedAs`);
      }
      if (node.status === 'supported') {
        const fixtures = node.fixtures ?? (node.fixture ? [node.fixture] : []);
        assert.ok(fixtures.length > 0, `${where}: supported requires at least one fixture`);
        assert.ok(
          !node.evidenceRef,
          `${where}: promoting out of unsupported must replace evidenceRef with fixtures`
        );
      }
    }
  }
});

test('every referenced fixture exists on disk', () => {
  for (const adapter of shippedAdapters()) {
    const descriptor = readDescriptor(adapter);
    const refs = new Set<string>();
    if (descriptor.binding?.fixture) refs.add(descriptor.binding.fixture);
    if (descriptor.decisionHold?.fixture) refs.add(descriptor.decisionHold.fixture);
    if (descriptor.unboundSessionFixture) refs.add(descriptor.unboundSessionFixture);
    for (const node of Object.values(descriptor.capabilities as Record<string, any>)) {
      for (const fixture of node.fixtures ?? []) refs.add(fixture);
    }
    for (const hazard of descriptor.hazards ?? []) {
      if (hazard.fixture) refs.add(hazard.fixture);
    }
    for (const ref of refs) {
      assert.ok(
        existsSync(path.join(adaptersDir, adapter, ref)),
        `${adapter}: missing fixture ${ref}`
      );
    }
  }
});

test('every adapter ships the mandatory unbound-session negative fixture', () => {
  for (const adapter of shippedAdapters()) {
    const descriptor = readDescriptor(adapter);
    assert.ok(
      descriptor.unboundSessionFixture,
      `${adapter}: an unbound-session negative fixture is mandatory`
    );
    const fixture = JSON.parse(
      readFileSync(path.join(adaptersDir, adapter, descriptor.unboundSessionFixture), 'utf8')
    );
    const recordsSideEffects =
      (fixture.expect?.sandboxWrites?.length ?? 0) > 0 ||
      (fixture.expect?.cliInvocations?.length ?? 0) > 0;
    if (recordsSideEffects) {
      // Recording the truth is required; claiming a silence the adapter does not have is not.
      const hazard = (descriptor.hazards ?? []).find(
        (entry: any) => entry.id === 'unbound-session-side-effects'
      );
      assert.ok(
        hazard?.trackedAs,
        `${adapter}: the unbound-session fixture records a side effect, so a tracked ` +
          '`unbound-session-side-effects` hazard is required'
      );
    }
  }
});

test('no tier is authored above what the fixtures prove', () => {
  for (const descriptor of HARNESS_DESCRIPTORS) {
    const supported = (id: string) => descriptor.capabilities[id]?.status === 'supported';
    const anySupported = (prefix: string) =>
      AGENT_SESSION_CAPABILITY_IDS.some(id => id.startsWith(prefix) && supported(id));

    if (descriptor.capabilityTier >= 1) {
      assert.equal(
        descriptor.binding.status,
        'supported',
        `${descriptor.adapter}: tier >= 1 needs binding`
      );
      assert.ok(
        anySupported('observe.'),
        `${descriptor.adapter}: tier >= 1 needs an observed event`
      );
    }
    if (descriptor.capabilityTier >= 2) {
      assert.ok(
        descriptor.integrationShape === 'controlPlane' ||
          descriptor.decisionHold.status === 'supported',
        `${descriptor.adapter}: tier >= 2 needs a held or peer decision path`
      );
      assert.ok(
        anySupported('decide.') || supported('answer.structuredQuestion'),
        `${descriptor.adapter}: tier >= 2 needs a decision capability`
      );
    }
    if (descriptor.capabilityTier >= 3) {
      assert.ok(
        anySupported('inject.'),
        `${descriptor.adapter}: tier >= 3 needs an injection capability`
      );
    }
  }
});

test('the deprecated conformance projection never re-declares a capability the harness lacks', () => {
  for (const adapter of shippedAdapters()) {
    const manifest = parseYaml(
      readFileSync(path.join(adaptersDir, adapter, 'conformance-manifest.yaml'), 'utf8')
    );
    const descriptor = readDescriptor(adapter);
    const ridesOnPermissionRequest = Object.values(
      descriptor.capabilities as Record<string, any>
    ).some(node => node.native === 'PermissionRequest' && node.status !== 'unsupported');

    if ((manifest.connector.capabilities ?? []).includes('permissionHook')) {
      assert.ok(
        ridesOnPermissionRequest,
        `${adapter}: permissionHook is projected but no capability rides on PermissionRequest`
      );
    }
    if ((manifest.connector.hookTypes ?? []).includes('PermissionRequest')) {
      assert.ok(
        ridesOnPermissionRequest,
        `${adapter}: PermissionRequest hook type is projected but no capability rides on it`
      );
    }
    assert.equal(manifest.connector.capabilityTier, findHarnessDescriptor(adapter)?.capabilityTier);
    assert.equal(
      manifest.connector.integrationShape,
      findHarnessDescriptor(adapter)?.integrationShape
    );
  }
});

test('Cursor no longer claims a universal PermissionRequest hook it does not have', () => {
  const manifest = parseYaml(
    readFileSync(path.join(adaptersDir, 'cursor', 'conformance-manifest.yaml'), 'utf8')
  );
  assert.ok(!(manifest.connector.capabilities ?? []).includes('permissionHook'));
  assert.ok(!(manifest.connector.hookTypes ?? []).includes('PermissionRequest'));

  const cursor = findHarnessDescriptor('cursor');
  assert.equal(cursor?.capabilities['decide.universal'].status, 'unsupported');
  assert.ok(cursor?.capabilities['decide.universal'].evidenceRef);
});

test('`ovld agent-session capabilities` reads the catalog without touching the network', () => {
  const result = spawnSync(
    process.execPath,
    [cliEntry, 'agent-session', 'capabilities', '--json'],
    {
      encoding: 'utf8',
      // No backend URL and no credential: the command must still succeed, which it can only do
      // if it never makes a request.
      env: {
        ...process.env,
        OVERLORD_BACKEND_URL: 'http://127.0.0.1:1',
        OVERLORD_BACKEND_URL_DEV: 'http://127.0.0.1:1',
        OVERLORD_USER_TOKEN: '',
        OVLD_USER_TOKEN: ''
      },
      timeout: 30_000
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.descriptors.length, shippedAdapters().length);
  assert.deepEqual(payload.capabilityIds, [...AGENT_SESSION_CAPABILITY_IDS]);
});

test('`ovld agent-session capabilities <agent>` reports one harness and rejects unknown ones', () => {
  const ok = spawnSync(
    process.execPath,
    [cliEntry, 'agent-session', 'capabilities', 'claude', '--json'],
    {
      encoding: 'utf8',
      timeout: 30_000
    }
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).descriptor.adapter, 'claude');

  const unknown = spawnSync(
    process.execPath,
    [cliEntry, 'agent-session', 'capabilities', 'not-a-harness'],
    { encoding: 'utf8', timeout: 30_000 }
  );
  assert.notEqual(unknown.status, 0);
});

test('doctor descriptor drift reports a missing or mismatched installed descriptor', () => {
  const uninstalled = inspectInstalledDescriptor({ agentKey: 'claude', installPath: null });
  assert.equal(uninstalled.drift, false);
  assert.match(uninstalled.detail, /not installed/);

  const missing = inspectInstalledDescriptor({
    agentKey: 'claude',
    installPath: path.join(repoRoot, 'cli')
  });
  assert.equal(missing.drift, true);
  assert.match(missing.detail, /agent-setup claude/);

  const current = inspectInstalledDescriptor({
    agentKey: 'claude',
    installPath: path.join(adaptersDir, 'claude')
  });
  assert.equal(current.drift, false);
  assert.equal(current.installedDigest, findHarnessDescriptor('claude')?.descriptorDigest);
});
