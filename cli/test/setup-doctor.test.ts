import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { managedFileSourceExists } from '../dist/connector-core-render.js';
import {
  contractMajorVersion,
  inspectConnector,
  isStaleContractVersion,
  listAvailableConnectors,
  mergeCodexConfig,
  parseConnectorManifestYaml,
  readConnectorManifest,
  setupConnector
} from '../dist/connectors.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'ovld-setup-'));
}

test('parseConnectorManifestYaml reads the constrained manifest subset', () => {
  const parsed = parseConnectorManifestYaml(
    [
      'contractVersion: "0"',
      'componentKey: demo',
      'connector:',
      '  agentIdentifier: demo',
      '  installPath: "~/.demo/plugin"',
      '  managedFiles:',
      '    - "README.md"'
    ].join('\n')
  ) as Record<string, any>;

  assert.equal(parsed.contractVersion, '0');
  assert.equal(parsed.connector.agentIdentifier, 'demo');
  assert.equal(parsed.connector.installPath, '~/.demo/plugin');
  assert.deepEqual(parsed.connector.managedFiles, ['README.md']);
});

test('claude connector is available and every managed file exists on disk', () => {
  assert.ok(listAvailableConnectors().includes('claude'));
  const manifest = readConnectorManifest('claude');
  assert.ok(manifest.connector.managedFiles.length > 0);
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'claude');
  for (const relativePath of manifest.connector.managedFiles) {
    assert.ok(
      managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'claude' }),
      `missing managed source: ${relativePath}`
    );
  }
});

test('cursor connector is available and every managed file exists on disk', () => {
  assert.ok(listAvailableConnectors().includes('cursor'));
  const manifest = readConnectorManifest('cursor');
  assert.ok(manifest.connector.managedFiles.length > 0);
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'cursor');
  for (const relativePath of manifest.connector.managedFiles) {
    assert.ok(
      managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'cursor' }),
      `missing managed source: ${relativePath}`
    );
  }
});

test('codex connector is available and every managed file exists on disk', () => {
  assert.ok(listAvailableConnectors().includes('codex'));
  const manifest = readConnectorManifest('codex');
  assert.ok(manifest.connector.managedFiles.length > 0);
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'codex');
  for (const relativePath of manifest.connector.managedFiles) {
    assert.ok(
      managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'codex' }),
      `missing managed source: ${relativePath}`
    );
  }
});

test('PI connector is available and every managed file exists on disk', () => {
  assert.ok(listAvailableConnectors().includes('pi'));
  const manifest = readConnectorManifest('pi');
  assert.ok(manifest.connector.managedFiles.length > 0);
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'pi');
  for (const relativePath of manifest.connector.managedFiles) {
    assert.ok(
      managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'pi' }),
      `missing managed source: ${relativePath}`
    );
  }
});

test('setup installs exactly the managed files and is idempotent', () => {
  const home = tempHome();
  try {
    const manifest = readConnectorManifest('claude');
    const first = setupConnector({ agentKey: 'claude', home });
    assert.equal(first.files.length, manifest.connector.managedFiles.length);
    assert.ok(first.files.every(file => file.action === 'written'));

    for (const relativePath of manifest.connector.managedFiles) {
      assert.ok(existsSync(path.join(first.installPath, relativePath)), relativePath);
    }
    assert.ok(existsSync(path.join(home, '.ovld', 'connectors', 'claude.json')));

    const second = setupConnector({ agentKey: 'claude', home });
    assert.ok(second.files.every(file => file.action === 'unchanged'));

    inspectAndAssertHealthy(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('setup removes unchanged obsolete managed files and preserves modified ones', () => {
  const home = tempHome();
  try {
    const first = setupConnector({ agentKey: 'claude', home });
    const statePath = path.join(home, '.ovld', 'connectors', 'claude.json');
    const obsoletePath = 'scripts/obsolete-hook.sh';
    const obsoleteTarget = path.join(first.installPath, obsoletePath);
    const original = '#!/bin/sh\nexit 0\n';
    mkdirSync(path.dirname(obsoleteTarget), { recursive: true });
    writeFileSync(obsoleteTarget, original);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.files.push({
      path: obsoletePath,
      sha256: createHash('sha256').update(original).digest('hex')
    });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const cleaned = setupConnector({ agentKey: 'claude', home });
    assert.ok(cleaned.files.some(file => file.path === obsoletePath && file.action === 'removed'));
    assert.equal(existsSync(obsoleteTarget), false);

    writeFileSync(obsoleteTarget, `${original}# user edit\n`);
    state.files[state.files.length - 1].sha256 = createHash('sha256')
      .update(original)
      .digest('hex');
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const preserved = setupConnector({ agentKey: 'claude', home });
    assert.ok(existsSync(obsoleteTarget));
    assert.ok(
      preserved.warnings.some(warning =>
        warning.includes('Preserved modified obsolete managed file')
      )
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cursor setup merges lifecycle hooks and permission rules', () => {
  const home = tempHome();
  try {
    const cursorDir = path.join(home, '.cursor');
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      path.join(cursorDir, 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: { beforeShellExecution: [{ command: 'user-owned-shell-hook.sh' }] }
      })
    );
    const result = setupConnector({ agentKey: 'cursor', home });
    assert.equal(result.binaryName, 'agent');
    assert.ok(result.files.every(file => file.action === 'written'));

    const hooks = JSON.parse(readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
    assert.ok(
      hooks.hooks.beforeSubmitPrompt.some((entry: { command: string }) =>
        entry.command.includes('overlord-user-prompt-submit')
      )
    );
    assert.ok(
      hooks.hooks.beforeShellExecution.some(
        (entry: { command: string }) => entry.command === 'user-owned-shell-hook.sh'
      )
    );
    assert.equal(
      hooks.hooks.beforeShellExecution.some((entry: { command: string }) =>
        entry.command.includes('overlord-permission-request')
      ),
      false
    );
    assert.equal(hooks.hooks.beforeMCPExecution, undefined);
    assert.ok(
      hooks.hooks.postToolUse.some(
        (entry: { command: string; matcher: string }) =>
          entry.command.includes('overlord-post-tool-use') &&
          entry.matcher.includes('Shell') &&
          entry.matcher.includes('StrReplace')
      )
    );
    assert.ok(
      hooks.hooks.stop.some(
        (entry: { command: string; loop_limit: number }) =>
          entry.command.includes('overlord-stop') && entry.loop_limit === 1
      )
    );

    for (const event of ['beforeSubmitPrompt', 'preToolUse', 'postToolUse']) {
      const entries = hooks.hooks[event] ?? [];
      assert.equal(
        entries.some((entry: { command: string }) =>
          entry.command.endsWith('/scripts/agent-session-event.sh')
        ),
        false,
        `${event} must not register agent-session observation`
      );
    }
    assert.equal(hooks.hooks.sessionStart, undefined);

    const settings = JSON.parse(readFileSync(path.join(home, '.cursor', 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.allow.includes('Shell(ovld protocol:*)'));

    setupConnector({ agentKey: 'cursor', home });
    const hooksAfterSecondSetup = JSON.parse(
      readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8')
    );
    for (const event of ['beforeSubmitPrompt', 'beforeShellExecution', 'postToolUse', 'stop']) {
      assert.equal(hooksAfterSecondSetup.hooks[event].length, hooks.hooks[event].length, event);
    }

    inspectAndAssertHealthy(home, 'cursor');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('PI setup installs its extension and rendered skill without modifying other settings', () => {
  const home = tempHome();
  try {
    const result = setupConnector({ agentKey: 'pi', home });
    assert.equal(result.binaryName, 'pi');
    assert.equal(result.installPath, path.join(home, '.pi', 'agent'));
    assert.ok(result.files.every(file => file.action === 'written'));
    assert.ok(existsSync(path.join(result.installPath, 'extensions', 'overlord.ts')));
    assert.ok(
      readFileSync(
        path.join(result.installPath, 'skills', 'overlord-mission', 'SKILL.md'),
        'utf8'
      ).includes('PI Adapter Notes')
    );

    const second = setupConnector({ agentKey: 'pi', home });
    assert.ok(second.files.every(file => file.action === 'unchanged'));
    inspectAndAssertHealthy(home, 'pi');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codex setup merges marketplace and rules without corrupting managed hook commands', () => {
  const home = tempHome();
  try {
    const result = setupConnector({ agentKey: 'codex', home });
    assert.ok(result.files.every(file => file.action === 'written'));

    const marketplace = JSON.parse(
      readFileSync(path.join(home, '.agents', 'plugins', 'marketplace.json'), 'utf8')
    );
    assert.ok(marketplace.plugins.some((plugin: { name: string }) => plugin.name === 'overlord'));

    const rules = readFileSync(path.join(home, '.codex', 'rules', 'default.rules'), 'utf8');
    assert.ok(rules.includes('pattern = ["ovld", "protocol"]'));

    const config = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(config.startsWith('default_permissions = "overlord"'));
    assert.ok(config.includes('[permissions.overlord]'));
    assert.ok(config.includes('"**.ovld.ai" = "allow"'));

    const hooks = JSON.parse(
      readFileSync(path.join(result.installPath, '.codex-plugin', 'hooks.json'), 'utf8')
    );
    const commandsFor = (event: string): string[] =>
      (hooks.hooks[event] ?? []).flatMap((group: { hooks: { command: string }[] }) =>
        group.hooks.map(hook => hook.command)
      );
    assert.ok(
      commandsFor('UserPromptSubmit').some(command =>
        command.includes('user-prompt-submit-hook.sh')
      )
    );
    assert.equal(
      commandsFor('UserPromptSubmit').some(command => command.includes('agent-session-event.sh')),
      false
    );
    assert.equal(commandsFor('PermissionRequest').length, 0);

    // A fresh temp home has never approved the Overlord hooks. When a hook-trust-aware Codex is
    // on PATH, doctor must say so (`/hooks`); every other check must still pass.
    const report = inspectConnector({ agentKey: 'codex', home });
    assert.ok(report.installed);
    assert.deepEqual(
      report.problems.filter(problem => !problem.includes('`/hooks`')),
      []
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex permission config merge preserves unrelated settings and is idempotent', () => {
  const existing = [
    '# User configuration',
    'model = "gpt-5"',
    '',
    '[features]',
    'js_repl = true',
    'experimental_feature = true',
    '',
    '[permissions.personal]',
    'extends = ":workspace"',
    ''
  ].join('\n');
  const merged = mergeCodexConfig(existing);

  assert.ok(merged.includes('model = "gpt-5"'));
  assert.ok(merged.includes('experimental_feature = true'));
  assert.ok(merged.includes('[permissions.personal]'));
  assert.ok(merged.includes('js_repl = false'));
  assert.ok(merged.includes('network_proxy = true'));
  assert.equal(mergeCodexConfig(merged), merged);
});

test('claude setup writes a local marketplace pointing at the installed plugin', () => {
  const home = tempHome();
  try {
    const result = setupConnector({ agentKey: 'claude', home });
    assert.ok(result.files.every(file => file.action === 'written'));

    const marketplacePath = path.join(
      home,
      '.ovld',
      'claude',
      'marketplace',
      '.claude-plugin',
      'marketplace.json'
    );
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    assert.equal(marketplace.name, 'overlord-local');
    const plugin = marketplace.plugins.find((entry: { name: string }) => entry.name === 'overlord');
    assert.ok(plugin, 'overlord plugin entry present');

    // The plugin source must be relative to the marketplace root and resolve to
    // the directory where the managed files were installed.
    assert.ok(plugin.source.startsWith('./'), `relative source, got ${plugin.source}`);
    const resolved = path.resolve(path.dirname(path.dirname(marketplacePath)), plugin.source);
    assert.equal(resolved, result.installPath);
    assert.ok(existsSync(path.join(resolved, '.claude-plugin', 'plugin.json')));

    inspectAndAssertHealthy(home, 'claude');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function inspectAndAssertHealthy(home: string, agentKey = 'claude'): void {
  const report = inspectConnector({ agentKey, home });
  assert.ok(report.installed);
  assert.ok(report.healthy, report.problems.join('; '));
}

test('doctor detects a modified managed file', () => {
  const home = tempHome();
  try {
    const result = setupConnector({ agentKey: 'claude', home });
    const target = path.join(result.installPath, 'commands', 'attach.md');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n<!-- tampered -->`);

    const report = inspectConnector({ agentKey: 'claude', home });
    assert.equal(report.healthy, false);
    assert.ok(report.problems.some(problem => problem.includes('commands/attach.md')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor detects a missing managed file', () => {
  const home = tempHome();
  try {
    const result = setupConnector({ agentKey: 'claude', home });
    rmSync(path.join(result.installPath, 'prompt-wrapper.md'));

    const report = inspectConnector({ agentKey: 'claude', home });
    assert.equal(report.healthy, false);
    assert.ok(report.problems.some(problem => problem.includes('Missing managed file')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor detects a stale contract version', () => {
  const home = tempHome();
  try {
    setupConnector({ agentKey: 'claude', home });
    const statePath = path.join(home, '.ovld', 'connectors', 'claude.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.contractVersion = '0.0-ancient';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const report = inspectConnector({ agentKey: 'claude', home });
    assert.ok(report.staleContractVersion);
    assert.equal(report.healthy, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor does not report an install stale within the same contract major', () => {
  const home = tempHome();
  try {
    setupConnector({ agentKey: 'claude', home });
    const statePath = path.join(home, '.ovld', 'connectors', 'claude.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const declaredMajor = contractMajorVersion(state.contractVersion);
    assert.ok(declaredMajor, `unexpected manifest contractVersion ${state.contractVersion}`);
    // An install recorded before Semantic Versioning stored the bare major.
    state.contractVersion = declaredMajor;
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const report = inspectConnector({ agentKey: 'claude', home });
    assert.equal(report.staleContractVersion, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('contract version staleness compares the major version', () => {
  assert.equal(contractMajorVersion('168.2.1'), '168');
  assert.equal(contractMajorVersion('168'), '168');
  assert.equal(contractMajorVersion('0.0-ancient'), undefined);
  assert.equal(isStaleContractVersion({ installed: '168', declared: '168.0.0' }), false);
  assert.equal(isStaleContractVersion({ installed: '168.0.0', declared: '168.4.2' }), false);
  assert.equal(isStaleContractVersion({ installed: '168.4.2', declared: '169.0.0' }), true);
  assert.equal(isStaleContractVersion({ installed: '167', declared: '168.0.0' }), true);
  assert.equal(isStaleContractVersion({ installed: '0.0-ancient', declared: '168.0.0' }), true);
  assert.equal(isStaleContractVersion({ installed: 'custom', declared: 'custom' }), false);
});

test('antigravity connector installs to the Antigravity global plugin directory', () => {
  assert.ok(listAvailableConnectors().includes('antigravity'));
  const manifest = readConnectorManifest('antigravity');
  assert.equal(manifest.connector.installPath, '~/.gemini/config/plugins/overlord');
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'antigravity');
  for (const relativePath of manifest.connector.managedFiles) {
    assert.ok(
      managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'antigravity' }),
      `missing managed source: ${relativePath}`
    );
  }
  const pluginJson = JSON.parse(readFileSync(path.join(sourceDir, 'plugin.json'), 'utf8'));
  assert.equal(pluginJson.displayName, 'Overlord');
  assert.ok(manifest.connector.managedFiles.includes(pluginJson.logo));
});

/** Simulate an install an earlier connector version made at the old Antigravity CLI path. */
function seedLegacyAntigravityInstall(home: string): {
  legacyRoot: string;
  statePath: string;
  state: { installPath: string; files: Array<{ path: string; sha256: string }> };
} {
  const first = setupConnector({ agentKey: 'antigravity', home });
  const legacyRoot = path.join(home, '.gemini', 'antigravity-cli', 'plugins', 'overlord');
  const statePath = path.join(home, '.ovld', 'connectors', 'antigravity.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const file of state.files as Array<{ path: string }>) {
    const target = path.join(legacyRoot, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(first.installPath, file.path)));
  }
  rmSync(first.installPath, { recursive: true, force: true });
  state.installPath = legacyRoot;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return { legacyRoot, statePath, state };
}

test('antigravity setup migrates an install from the legacy path and keeps edited files', () => {
  const home = tempHome();
  try {
    const { legacyRoot } = seedLegacyAntigravityInstall(home);
    const editedPath = 'skills/attach.md';
    writeFileSync(
      path.join(legacyRoot, editedPath),
      `${readFileSync(path.join(legacyRoot, editedPath), 'utf8')}\n<!-- user edit -->\n`
    );

    const legacyReport = inspectConnector({ agentKey: 'antigravity', home });
    assert.equal(legacyReport.healthy, false);
    assert.ok(
      legacyReport.problems.some(problem => problem.includes('.gemini/config/plugins/overlord')),
      legacyReport.problems.join('; ')
    );

    const dryRun = setupConnector({ agentKey: 'antigravity', home, dryRun: true });
    assert.ok(
      dryRun.files.some(file => file.action === 'would-remove' && file.root === legacyRoot)
    );
    assert.ok(existsSync(path.join(legacyRoot, 'plugin.json')), 'dry run must not remove files');

    const migrated = setupConnector({ agentKey: 'antigravity', home });
    assert.equal(migrated.installPath, path.join(home, '.gemini', 'config', 'plugins', 'overlord'));
    const removed = migrated.files.filter(file => file.action === 'removed');
    assert.ok(removed.length > 0);
    assert.ok(removed.every(file => file.root === legacyRoot));
    assert.equal(existsSync(path.join(legacyRoot, 'plugin.json')), false);
    assert.equal(existsSync(path.join(legacyRoot, 'scripts')), false, 'emptied dirs are pruned');
    assert.ok(existsSync(path.join(legacyRoot, editedPath)), 'edited file is preserved');
    assert.ok(
      migrated.warnings.some(warning => warning.includes(editedPath)),
      migrated.warnings.join('; ')
    );
    assert.ok(existsSync(path.join(migrated.installPath, 'plugin.json')));
    assert.ok(existsSync(path.join(migrated.installPath, 'assets', 'logo.png')));

    const report = inspectConnector({ agentKey: 'antigravity', home });
    assert.ok(report.healthy, report.problems.join('; '));
    assert.equal(report.installPath, migrated.installPath);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('antigravity setup removes an unedited legacy install entirely', () => {
  const home = tempHome();
  try {
    const { legacyRoot } = seedLegacyAntigravityInstall(home);
    setupConnector({ agentKey: 'antigravity', home });
    assert.equal(existsSync(legacyRoot), false);
    assert.ok(existsSync(path.join(home, '.gemini', 'antigravity-cli', 'plugins')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('antigravity setup and doctor name unmanaged files in the plugin directory', () => {
  const home = tempHome();
  try {
    const installPath = path.join(home, '.gemini', 'config', 'plugins', 'overlord');
    const stray = path.join(installPath, 'skills', 'overlord-ticket', 'SKILL.md');
    mkdirSync(path.dirname(stray), { recursive: true });
    writeFileSync(stray, '---\nname: overlord-ticket\n---\n');

    const result = setupConnector({ agentKey: 'antigravity', home });
    assert.ok(existsSync(stray), 'setup must not delete files it does not manage');
    assert.ok(
      result.warnings.some(warning => warning.includes('skills/overlord-ticket/SKILL.md')),
      result.warnings.join('; ')
    );

    const report = inspectConnector({ agentKey: 'antigravity', home });
    assert.equal(report.healthy, false);
    assert.ok(report.problems.some(problem => problem.includes('skills/overlord-ticket/SKILL.md')));

    rmSync(path.join(installPath, 'skills', 'overlord-ticket'), { recursive: true });
    const cleanReport = inspectConnector({ agentKey: 'antigravity', home });
    assert.ok(cleanReport.healthy, cleanReport.problems.join('; '));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('inspect reports not-installed connectors', () => {
  const home = tempHome();
  try {
    const report = inspectConnector({ agentKey: 'claude', home });
    assert.equal(report.installed, false);
    assert.equal(report.healthy, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
