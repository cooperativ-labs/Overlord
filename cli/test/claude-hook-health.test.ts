import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLAUDE_HOOKS_SERVER,
  type ClaudeCommandResult,
  claudeMinimumVersion,
  compareSemver,
  inspectClaudeHookHealth,
  parseClaudeMcpStatus
} from '../src/claude-hook-health.ts';
import { inspectConnector, setupConnector } from '../src/connectors.ts';

const CONNECTED = `${CLAUDE_HOOKS_SERVER}:\n  Scope: Dynamic config\n  Status: ✔ Connected\n  Type: stdio\n`;
const FAILED = `${CLAUDE_HOOKS_SERVER}:\n  Status: ✘ Failed to connect\n`;
const MISSING = `No MCP server named "${CLAUDE_HOOKS_SERVER}". Configured servers: none`;

function fakeClaude({
  version = '2.1.329',
  mcpGet = CONNECTED,
  calls = []
}: {
  version?: string;
  mcpGet?: string;
  calls?: string[][];
}) {
  return (args: string[]): ClaudeCommandResult => {
    calls.push(args);
    if (args[0] === '--version')
      return { status: 0, stdout: `${version} (Claude Code)\n`, stderr: '' };
    if (args[0] === 'mcp' && args[1] === 'get') {
      return mcpGet === MISSING
        ? { status: 1, stdout: '', stderr: mcpGet }
        : { status: 0, stdout: mcpGet, stderr: '' };
    }
    // plugin marketplace add / install succeed.
    return { status: 0, stdout: '', stderr: '' };
  };
}

function configDirWithPlugin(enabled: boolean): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-claude-config-'));
  writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'overlord@overlord-local': enabled } })
  );
  return dir;
}

test('the version floor comes from the descriptor and is 2.1.328', () => {
  assert.equal(claudeMinimumVersion(), '2.1.328');
  assert.equal(compareSemver('2.1.327', '2.1.328'), -1);
  assert.equal(compareSemver('2.1.328', '2.1.328'), 0);
  assert.equal(compareSemver('2.2.0', '2.1.999'), 1);
});

test('claude mcp get output is read as connected, not connected, or missing', () => {
  assert.equal(parseClaudeMcpStatus(CONNECTED), 'connected');
  assert.equal(parseClaudeMcpStatus(FAILED), 'not-connected');
  assert.equal(
    parseClaudeMcpStatus(`${CLAUDE_HOOKS_SERVER}:\n  Status: ⏸ Pending approval\n`),
    'not-connected'
  );
  assert.equal(parseClaudeMcpStatus(MISSING), 'missing');
  assert.equal(parseClaudeMcpStatus(''), 'missing');
});

test('a Claude Code older than 2.1.328 is an error that names the update and the CLI fallback', () => {
  const configDir = configDirWithPlugin(true);
  try {
    const health = inspectClaudeHookHealth({ configDir, run: fakeClaude({ version: '2.1.327' }) });
    assert.equal(health.version, '2.1.327');
    assert.equal(health.problems.length, 1);
    assert.match(health.problems[0] as string, /older than 2\.1\.328/);
    assert.match(health.problems[0] as string, /ovld protocol/);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a disabled plugin is an error, and the server check is skipped', () => {
  const configDir = configDirWithPlugin(false);
  const calls: string[][] = [];
  try {
    const health = inspectClaudeHookHealth({ configDir, run: fakeClaude({ calls }) });
    assert.equal(health.problems.length, 1);
    assert.match(health.problems[0] as string, /not installed and enabled/);
    assert.equal(
      calls.some(args => args[0] === 'mcp'),
      false
    );
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a missing or disconnected hooks server is an error that points to the fix and the CLI', () => {
  const configDir = configDirWithPlugin(true);
  try {
    for (const [mcpGet, word] of [
      [FAILED, 'not connected'],
      [MISSING, 'not registered']
    ] as const) {
      const health = inspectClaudeHookHealth({ configDir, run: fakeClaude({ mcpGet }) });
      assert.equal(health.problems.length, 1, word);
      const problem = health.problems[0] as string;
      assert.ok(problem.includes(CLAUDE_HOOKS_SERVER));
      assert.ok(problem.includes(word));
      assert.match(problem, /ovld agent-setup claude/);
      assert.match(problem, /`node` is on PATH/);
      assert.match(problem, /The `ovld protocol` CLI still works/);
      assert.match(problem, /--paths/);
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('a healthy install newer than the verified version only warns', () => {
  const configDir = configDirWithPlugin(true);
  try {
    const health = inspectClaudeHookHealth({
      configDir,
      run: fakeClaude({ version: '9.9.9' })
    });
    assert.deepEqual(health.problems, []);
    assert.equal(health.warnings.length, 1);
    assert.match(health.warnings[0] as string, /newer than/);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('setup removes the obsolete Claude hook scripts it installed, keeps modified ones, and reports hook health', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ovld-claude-migrate-'));
  try {
    const installPath = path.join(home, '.ovld', 'claude', 'marketplace', 'plugins', 'overlord');
    const scripts = path.join(installPath, 'scripts');
    mkdirSync(scripts, { recursive: true });
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const managed = {
      'scripts/stop-hook.sh': '#!/bin/bash\n# old stop hook\n',
      'scripts/user-prompt-submit-hook.sh': '#!/bin/bash\n# old prompt hook\n',
      'scripts/permission-hook.sh': '#!/bin/bash\n# old permission hook\n',
      'scripts/post-tool-use-hook.sh': '#!/bin/bash\n# old capture hook\n'
    };
    for (const [relative, text] of Object.entries(managed)) {
      writeFileSync(path.join(installPath, relative), text);
    }
    // The user edited one script after install; setup must not delete their edit.
    writeFileSync(
      path.join(installPath, 'scripts/permission-hook.sh'),
      `${managed['scripts/permission-hook.sh']}# local edit\n`
    );
    mkdirSync(path.join(home, '.ovld', 'connectors'), { recursive: true });
    writeFileSync(
      path.join(home, '.ovld', 'connectors', 'claude.json'),
      JSON.stringify({
        agentKey: 'claude',
        agentIdentifier: 'claude',
        contractVersion: '179.0.0',
        installPath,
        installedAt: '2026-11-01T00:00:00.000Z',
        files: Object.entries(managed).map(([relative, text]) => ({
          path: relative,
          sha256: sha(text)
        }))
      })
    );
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    writeFileSync(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'overlord@overlord-local': true } })
    );

    const result = setupConnector({
      agentKey: 'claude',
      home,
      claudeRunner: fakeClaude({ mcpGet: FAILED })
    });

    const removed = result.files.filter(file => file.action === 'removed').map(file => file.path);
    assert.deepEqual(removed.sort(), [
      'scripts/post-tool-use-hook.sh',
      'scripts/stop-hook.sh',
      'scripts/user-prompt-submit-hook.sh'
    ]);
    assert.equal(existsSync(path.join(installPath, 'scripts/stop-hook.sh')), false);
    assert.ok(existsSync(path.join(installPath, 'scripts/permission-hook.sh')));
    assert.ok(
      result.warnings.some(warning =>
        warning.includes('Preserved modified obsolete managed file: scripts/permission-hook.sh')
      )
    );
    // The new hooks server ships in its place.
    assert.ok(existsSync(path.join(installPath, '.mcp.json')));
    assert.match(
      readFileSync(path.join(installPath, 'scripts/overlord-mcp.mjs'), 'utf8'),
      /const DEFAULT_AGENT = 'claude';/
    );
    // Setup ends with the hook health check.
    assert.ok(result.warnings.some(warning => warning.includes('not connected')));

    const report = inspectConnector({
      agentKey: 'claude',
      home,
      claudeRunner: fakeClaude({ mcpGet: FAILED })
    });
    assert.equal(report.healthy, false);
    assert.ok(report.problems.some(problem => problem.includes(CLAUDE_HOOKS_SERVER)));

    const healthy = inspectConnector({ agentKey: 'claude', home, claudeRunner: fakeClaude({}) });
    assert.deepEqual(healthy.problems, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
