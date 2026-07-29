import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONNECTOR_ADAPTER_KEY_PLACEHOLDER,
  CONNECTOR_CORE_MARKER,
  CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH,
  connectorCoreRoot,
  connectorCoreScriptsRoot,
  managedFileSourceExists,
  renderConnectorMcpShim,
  renderConnectorSkill,
  resolveManagedFileContents
} from '../dist/connector-core-render.js';
import { readConnectorManifest, setupConnector } from '../dist/connectors.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('renderConnectorSkill interpolates connector core into adapter template', () => {
  const template = [
    '---',
    'name: demo',
    'description: demo adapter',
    '---',
    '',
    CONNECTOR_CORE_MARKER,
    '',
    '## Demo Adapter Notes',
    '- demo note'
  ].join('\n');

  const rendered = renderConnectorSkill({ adapterTemplate: template });
  assert.ok(rendered.startsWith('---\nname: demo'));
  assert.ok(!rendered.includes(CONNECTOR_CORE_MARKER));
  assert.ok(rendered.includes('# Overlord Mission'));
  assert.ok(rendered.includes('## Mode 1: Launched From Overlord Desktop Or CLI'));
  assert.ok(rendered.includes('## Demo Adapter Notes'));
});

test('resolveManagedFileContents reads core reference files from connector core', () => {
  const contents = resolveManagedFileContents({
    sourceDir: path.join(repoRoot, 'connectors', 'adapters', 'cursor'),
    relativePath: 'skills/overlord-mission/reference/cli.md'
  }).toString('utf8');

  const coreReference = readFileSync(path.join(connectorCoreRoot(), 'reference', 'cli.md'), 'utf8');
  assert.equal(contents, coreReference);
});

test('setup installs rendered skill with core content and core references', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ovld-core-render-'));
  try {
    const result = setupConnector({ agentKey: 'cursor', home });
    const skillPath = path.join(result.installPath, 'skills', 'overlord-mission', 'SKILL.md');
    const skill = readFileSync(skillPath, 'utf8');

    assert.ok(!skill.includes(CONNECTOR_CORE_MARKER));
    assert.ok(skill.includes('# Overlord Mission'));
    assert.ok(skill.includes('## Cursor Adapter Notes'));
    assert.ok(!skill.includes('connectors/core/overlord-mission/SKILL.md'));

    const cliReference = readFileSync(
      path.join(result.installPath, 'skills', 'overlord-mission', 'reference', 'cli.md'),
      'utf8'
    );
    const coreCliReference = readFileSync(
      path.join(connectorCoreRoot(), 'reference', 'cli.md'),
      'utf8'
    );
    assert.equal(cliReference, coreCliReference);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const MCP_SHIM_ADAPTERS = ['codex', 'cursor', 'antigravity'] as const;

test('rendered MCP shims differ from the core source only by the adapter key', () => {
  const coreSource = readFileSync(
    path.join(connectorCoreScriptsRoot(), 'overlord-mcp.mjs'),
    'utf8'
  );
  assert.ok(coreSource.includes(CONNECTOR_ADAPTER_KEY_PLACEHOLDER));

  for (const adapterKey of MCP_SHIM_ADAPTERS) {
    const rendered = renderConnectorMcpShim({ adapterKey });

    // The substitution is the whole contract: byte-for-byte the core file with
    // the placeholder replaced, so the three harnesses cannot drift apart.
    assert.equal(rendered, coreSource.replaceAll(CONNECTOR_ADAPTER_KEY_PLACEHOLDER, adapterKey));
    assert.ok(!rendered.includes(CONNECTOR_ADAPTER_KEY_PLACEHOLDER));
    assert.ok(rendered.startsWith('#!/usr/bin/env node\n'));
    assert.ok(rendered.includes(`const DEFAULT_AGENT = '${adapterKey}';`));
    assert.ok(rendered.includes(`serverInfo: { name: 'overlord-${adapterKey}',`));
    assert.ok(!rendered.includes("from '../"), 'shim must stay standalone (no repo-local imports)');
  }
});

test('shim adapters install a rendered shim that parses as a standalone module', () => {
  for (const adapterKey of MCP_SHIM_ADAPTERS) {
    const manifest = readConnectorManifest(adapterKey);
    assert.ok(
      manifest.connector.managedFiles.includes(CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH),
      `${adapterKey}: manifest should manage ${CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH}`
    );

    const home = mkdtempSync(path.join(os.tmpdir(), `ovld-mcp-shim-${adapterKey}-`));
    try {
      const result = setupConnector({ agentKey: adapterKey, home });
      const shimPath = path.join(result.installPath, CONNECTOR_CORE_MCP_SHIM_RELATIVE_PATH);
      assert.ok(existsSync(shimPath), `${adapterKey}: shim not installed`);
      assert.equal(readFileSync(shimPath, 'utf8'), renderConnectorMcpShim({ adapterKey }));

      const check = spawnSync(process.execPath, ['--check', shimPath], { encoding: 'utf8' });
      assert.equal(check.status, 0, `${adapterKey}: shim failed node --check: ${check.stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test('managed core reference paths do not require adapter-local copies', () => {
  for (const agentKey of ['claude', 'cursor', 'codex'] as const) {
    const manifest = readConnectorManifest(agentKey);
    const sourceDir = path.join(repoRoot, 'connectors', 'adapters', agentKey);
    for (const relativePath of manifest.connector.managedFiles) {
      assert.ok(
        managedFileSourceExists({ sourceDir, relativePath }),
        `${agentKey}: missing managed source ${relativePath}`
      );
    }
  }
});
