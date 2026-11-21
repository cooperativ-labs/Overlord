import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  codexHookEventLabel,
  codexLegacyTrustPath,
  codexPluginContentHash,
  codexPluginHookKeys,
  inspectCodexHookTrust
} from '../dist/codex-hook-trust.js';

const PLUGIN_ID = 'overlord@overlord-local';
const HOOKS_MANIFEST = {
  hooks: {
    UserPromptSubmit: [{ matcher: '.*', hooks: [{ type: 'command', command: 'a' }] }],
    PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'b' }] }]
  }
};

function writeVectorTree(root: string): void {
  mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, '__pycache__'), { recursive: true });
  writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), '{"version":"1.0.0"}\n');
  writeFileSync(path.join(root, 'scripts', 'a.sh'), 'echo a\n');
  writeFileSync(path.join(root, '__pycache__', 'x.pyc'), 'zz');
  writeFileSync(path.join(root, 'B.md'), 'B');
}

/** A temp HOME with the plugin installed and cached the way `codex plugin add` leaves it. */
function installFixture(): { home: string; codexHome: string; installPath: string; cache: string } {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-hook-trust-'));
  const codexHome = path.join(home, '.codex');
  const installPath = path.join(codexHome, 'plugins', 'overlord');
  const cache = path.join(codexHome, 'plugins', 'cache', 'overlord-local', 'overlord', '1.0.0');
  for (const root of [installPath, cache]) {
    mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
    writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), '{"version":"1.0.0"}\n');
    writeFileSync(path.join(root, '.codex-plugin', 'hooks.json'), JSON.stringify(HOOKS_MANIFEST));
  }
  return { home, codexHome, installPath, cache };
}

function inspect(
  fixture: ReturnType<typeof installFixture>,
  codexVersion: string | null = '0.171.0'
) {
  return inspectCodexHookTrust({
    codexHome: fixture.codexHome,
    installPath: fixture.installPath,
    pluginId: PLUGIN_ID,
    marketplaceName: 'overlord-local',
    codexVersion
  });
}

function writeHookState(
  codexHome: string,
  entries: Record<string, Record<string, string | boolean>>
) {
  const lines: string[] = [];
  for (const [key, values] of Object.entries(entries)) {
    lines.push(`[hooks.state."${key}"]`);
    for (const [name, value] of Object.entries(values)) {
      lines.push(`${name} = ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
    }
    lines.push('');
  }
  writeFileSync(path.join(codexHome, 'config.toml'), lines.join('\n'));
}

test('plugin content hash matches the Codex bundle fingerprint and skips bytecode', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'codex-hash-vector-'));
  try {
    writeVectorTree(root);
    // Reference value from an independent port of codex-rs plugin_fingerprint.rs
    // (rust-v0.171.0), which reproduced a live trusted_content_hash written by codex 0.170.0.
    assert.equal(
      codexPluginContentHash(root),
      'sha256:998be8079f9d8a668c3e5094de365f674298ac32cdd8e2c6860850c0d246e5d6'
    );
    rmSync(path.join(root, '__pycache__'), { recursive: true });
    assert.equal(
      codexPluginContentHash(root),
      'sha256:998be8079f9d8a668c3e5094de365f674298ac32cdd8e2c6860850c0d246e5d6'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hook keys follow the Codex <plugin>:<file>:<event>:<group>:<handler> form', () => {
  assert.equal(codexHookEventLabel('UserPromptSubmit'), 'user_prompt_submit');
  assert.equal(codexHookEventLabel('PostToolUse'), 'post_tool_use');
  assert.deepEqual(
    codexPluginHookKeys({
      pluginId: PLUGIN_ID,
      manifestRelativePath: '.codex-plugin/hooks.json',
      manifest: HOOKS_MANIFEST
    }).map(entry => entry.key),
    [
      'overlord@overlord-local:.codex-plugin/hooks.json:user_prompt_submit:0:0',
      'overlord@overlord-local:.codex-plugin/hooks.json:post_tool_use:0:0'
    ]
  );
});

test('legacy trust baseline path matches the Codex derivation', () => {
  const configFile = '/Users/example/.codex/config.toml';
  const legacy = codexLegacyTrustPath(configFile, PLUGIN_ID);
  assert.equal(path.dirname(legacy), '/Users/example/.codex/.hook-trust');
  assert.match(path.basename(legacy), /^[0-9a-f]{64}$/);
});

test('unapproved hooks are reported as untrusted', () => {
  const fixture = installFixture();
  try {
    const report = inspect(fixture);
    assert.equal(report.checked, true);
    assert.equal(report.pluginRoot, fixture.cache);
    assert.deepEqual(
      report.hooks.map(hook => hook.status),
      ['untrusted', 'untrusted']
    );
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0] as string, /UserPromptSubmit, PostToolUse.*`\/hooks`/);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('approval pinned to the current bundle is trusted; a changed bundle is modified', () => {
  const fixture = installFixture();
  try {
    const current = codexPluginContentHash(fixture.cache);
    const prefix = `${PLUGIN_ID}:.codex-plugin/hooks.json`;
    writeHookState(fixture.codexHome, {
      [`${prefix}:user_prompt_submit:0:0`]: {
        trusted_hash: 'sha256:decl',
        trusted_content_hash: current
      },
      [`${prefix}:post_tool_use:0:0`]: {
        trusted_hash: 'sha256:decl',
        trusted_content_hash: current
      }
    });
    assert.deepEqual(inspect(fixture).problems, []);

    // A connector update rewrites the bundle; Codex then holds the hooks for re-approval.
    writeFileSync(
      path.join(fixture.cache, '.codex-plugin', 'plugin.json'),
      '{"version":"1.0.0","x":1}\n'
    );
    const report = inspect(fixture);
    assert.deepEqual(
      report.hooks.map(hook => hook.status),
      ['modified', 'modified']
    );
    assert.match(report.problems[0] as string, /changed since you approved/);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('legacy approvals compare against the .hook-trust baseline, and disabled hooks are reported', () => {
  const fixture = installFixture();
  try {
    const prefix = `${PLUGIN_ID}:.codex-plugin/hooks.json`;
    writeHookState(fixture.codexHome, {
      [`${prefix}:user_prompt_submit:0:0`]: { trusted_hash: 'sha256:decl' },
      [`${prefix}:post_tool_use:0:0`]: { trusted_hash: 'sha256:decl', enabled: false }
    });
    // No baseline yet: Codex adopts the current bundle on first run, so the hook stays trusted.
    assert.deepEqual(
      inspect(fixture).hooks.map(hook => hook.status),
      ['trusted', 'disabled']
    );

    const baseline = codexLegacyTrustPath(path.join(fixture.codexHome, 'config.toml'), PLUGIN_ID);
    mkdirSync(path.dirname(baseline), { recursive: true });
    writeFileSync(baseline, 'sha256:older-bundle');
    assert.deepEqual(
      inspect(fixture).hooks.map(hook => hook.status),
      ['modified', 'disabled']
    );
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test('the check is skipped when Codex is missing or predates hook trust', () => {
  const fixture = installFixture();
  try {
    assert.equal(inspect(fixture, null).checked, false);
    assert.equal(inspect(fixture, '0.146.9').checked, false);
    assert.equal(inspect(fixture, '0.147.0').checked, true);
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});
