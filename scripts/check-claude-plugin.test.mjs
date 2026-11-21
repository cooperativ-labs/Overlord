import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function exercise({
  validateExit = 0,
  evalExit = 0,
  evaluate = false,
  version = '2.1.329',
  withClaude = true,
  requireClaude = false,
  expectedStatus
}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'claude-plugin-runner-test-'));
  try {
    // Substitute only the external Claude process; materialization uses the production renderer.
    const fake = path.join(dir, 'claude');
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('${version} (Claude Code)\\n');
  process.exit(0);
}
const target = args[2];
if (args[1] === 'validate' && fs.existsSync(path.join(target, '.claude-plugin/marketplace.json'))) {
  // The marketplace the installer would write, pointing at the rendered plugin.
  const market = JSON.parse(fs.readFileSync(path.join(target, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(market.name, 'overlord-local');
  assert.equal(market.plugins[0].source, './plugins/overlord');
  assert.ok(fs.existsSync(path.join(target, 'plugins/overlord/.claude-plugin/plugin.json')));
  fs.appendFileSync(process.env.TEST_CLAUDE_CALLS, JSON.stringify(args) + '\\n');
  process.exit(${validateExit});
}
const plugin = target;
const skill = fs.readFileSync(path.join(plugin, 'skills/overlord-mission/SKILL.md'), 'utf8');
assert.ok(skill.includes('After You Attach'));
assert.ok(!skill.includes('<!-- @connector-core -->'));
assert.ok(fs.existsSync(path.join(plugin, 'skills/overlord-mission/reference/cli.md')));
// Hooks are mcp_tool calls to the bundled hooks server; no shell hook ships.
const shim = fs.readFileSync(path.join(plugin, 'scripts/overlord-mcp.mjs'), 'utf8');
assert.ok(!shim.includes('__OVERLORD_ADAPTER_KEY__'));
assert.ok(shim.includes("const DEFAULT_AGENT = 'claude';"));
const mcp = JSON.parse(fs.readFileSync(path.join(plugin, '.mcp.json'), 'utf8'));
assert.deepEqual(mcp.mcpServers['overlord-hooks'].args.at(-1), '--hooks');
const hooksText = fs.readFileSync(path.join(plugin, 'hooks/hooks.json'), 'utf8');
assert.ok(!hooksText.includes('"command"'));
for (const group of Object.values(JSON.parse(hooksText).hooks))
  for (const entry of group) for (const hook of entry.hooks) assert.equal(hook.type, 'mcp_tool');
assert.equal(fs.existsSync(path.join(plugin, 'scripts/post-tool-use-hook.sh')), false);
assert.equal(process.env.MISSION_ID, undefined);
assert.equal(process.env.OVERLORD_OBJECTIVE_ID, undefined);
assert.equal(process.env.Overlord_USER_TOKEN, undefined);
assert.equal(process.env.CLAUDE_PLUGIN_OPTION_USER_TOKEN, undefined);
assert.equal(process.env.CLAUDECODE, undefined);
assert.ok(fs.existsSync(path.join(plugin, 'evals/inspect-objective/case.yaml')));
fs.appendFileSync(process.env.TEST_CLAUDE_CALLS, JSON.stringify(args) + '\\n');
process.exit(args[1] === 'validate' ? ${validateExit} : ${evalExit});
`
    );
    chmodSync(fake, 0o755);
    const callsPath = path.join(dir, 'calls.jsonl');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-claude-plugin.mts', ...(evaluate ? ['--eval'] : [])],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          // Without Claude, PATH holds only an empty directory; the script runs from execPath.
          PATH: withClaude ? `${dir}${path.delimiter}${process.env.PATH}` : path.join(dir, 'empty'),
          ...(requireClaude ? { OVERLORD_REQUIRE_CLAUDE_VALIDATE: '1' } : {}),
          TEST_CLAUDE_CALLS: callsPath,
          CLAUDE_PLUGIN_REPORT_DIR: path.join(dir, 'reports'),
          MISSION_ID: 'must-not-inherit',
          OVERLORD_OBJECTIVE_ID: 'must-not-inherit',
          Overlord_USER_TOKEN: 'must-not-inherit',
          CLAUDE_PLUGIN_OPTION_USER_TOKEN: 'must-not-inherit',
          CLAUDECODE: 'must-not-inherit'
        }
      }
    );
    assert.ifError(result.error);
    if (expectedStatus !== undefined) {
      assert.equal(result.status, expectedStatus, result.stderr + result.stdout);
      assert.equal(existsSync(callsPath), false, 'no Claude validation may run');
      return result.stdout + result.stderr;
    }
    assert.ok(existsSync(callsPath), result.stderr + result.stdout);
    const calls = readFileSync(callsPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(
      existsSync(calls[0][2]),
      false,
      'temporary plugin must be removed even on failure'
    );
    assert.equal(
      result.status,
      validateExit || (evaluate ? evalExit : 0),
      result.stderr + result.stdout
    );
    return calls;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('validation strict-checks the rendered plugin and its marketplace without running paid evals', () => {
  const calls = exercise({});
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.slice(0, 2), ['plugin', 'validate']);
    assert.equal(call.at(-1), '--strict');
  }
  assert.equal(path.basename(calls[0][2]), 'overlord');
  assert.equal(path.dirname(path.dirname(calls[0][2])), calls[1][2]);
});

test('Claude validation is skipped cleanly when claude is absent or too old', () => {
  for (const options of [{ withClaude: false }, { version: '2.1.300' }]) {
    const output = exercise({ ...options, expectedStatus: 0 });
    assert.match(output, /engines\["claude-code"\] matches versionRange/);
    assert.match(output, /claude plugin validate --strict skipped/);
  }
});

test('OVERLORD_REQUIRE_CLAUDE_VALIDATE turns a skipped validation into a failure', () => {
  const output = exercise({ withClaude: false, requireClaude: true, expectedStatus: 1 });
  assert.match(output, /skipped: the `claude` CLI is not on PATH/);
});

test('validation failure propagates and prevents eval launch', () => {
  const calls = exercise({ validateExit: 7, evaluate: true });
  assert.equal(calls.length, 1);
});

test('eval is bounded, local, and propagates a failed score or provider error', () => {
  const calls = exercise({ evaluate: true, evalExit: 2 });
  assert.equal(calls.length, 3);
  const args = calls[2];
  assert.deepEqual(args.slice(0, 2), ['plugin', 'eval']);
  for (const flag of ['--trust-plugin', '--no-publish', '--no-scaffold'])
    assert.ok(args.includes(flag));
  for (const [flag, value] of [
    ['--max-cost-usd', '2'],
    ['--threshold', '1'],
    ['--runs', '1'],
    ['--ablation', 'none']
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  assert.ok(!args.includes('--allow-tools'));
  assert.ok(!args.includes('--allow-real-servers'));
});
