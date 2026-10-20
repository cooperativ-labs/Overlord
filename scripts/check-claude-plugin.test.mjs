import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function exercise({ validateExit = 0, evalExit = 0, evaluate = false }) {
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
const plugin = args[2];
const skill = fs.readFileSync(path.join(plugin, 'skills/overlord-mission/SKILL.md'), 'utf8');
assert.ok(skill.includes('Attach first'));
assert.ok(!skill.includes('<!-- @connector-core -->'));
assert.ok(fs.existsSync(path.join(plugin, 'skills/overlord-mission/reference/cli.md')));
const hook = path.join(plugin, 'scripts/post-tool-use-hook.sh');
assert.ok(fs.statSync(hook).mode & 0o111);
assert.ok(!fs.readFileSync(hook, 'utf8').includes('__OVERLORD_ADAPTER_KEY__'));
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
          PATH: `${dir}${path.delimiter}${process.env.PATH}`,
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

test('validation checks rendered managed files without running paid evals', () => {
  const calls = exercise({});
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['plugin', 'validate']);
  assert.equal(calls[0].at(-1), '--strict');
});

test('validation failure propagates and prevents eval launch', () => {
  const calls = exercise({ validateExit: 7, evaluate: true });
  assert.equal(calls.length, 1);
});

test('eval is bounded, local, and propagates a failed score or provider error', () => {
  const calls = exercise({ evaluate: true, evalExit: 2 });
  assert.equal(calls.length, 2);
  const args = calls[1];
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
