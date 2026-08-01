import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// @ts-expect-error — plain ESM build script, intentionally untyped.
import { runFixture } from '../../scripts/harness-capability-fixtures.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function withFixture(fixture: unknown, run: (fixturePath: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-fixture-test-'));
  try {
    const fixturePath = path.join(dir, 'fixture.json');
    writeFileSync(fixturePath, JSON.stringify(fixture));
    run(fixturePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a source-guard fixture fails when a forbidden marker is present', () => {
  withFixture(
    {
      fixtureVersion: 1,
      kind: 'source-guard',
      path: 'CONTRACT.md',
      assert: { mustNotContain: ['Component Registry'] }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((failure: string) => failure.includes('must NOT contain')));
    }
  );
});

test('a native-payload fixture fails when a declared binding field is missing', () => {
  withFixture(
    {
      fixtureVersion: 1,
      kind: 'native-payload',
      payload: { tool_name: 'Bash' },
      assert: { bindingField: 'session_id' }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((failure: string) => failure.includes('session_id')));
    }
  );
});

test('an unknown fixture kind is rejected rather than silently passing', () => {
  withFixture({ fixtureVersion: 1, kind: 'trust-me' }, fixturePath => {
    const result = runFixture({ fixturePath, repoRoot });
    assert.equal(result.ok, false);
  });
});

test('a script-io fixture reports every CLI invocation the script attempts', () => {
  // The sandbox `ovld` is a recording spy on a PATH with no real CLI, so a script that reaches
  // for the network is caught here rather than in production.
  withFixture(
    {
      fixtureVersion: 1,
      kind: 'script-io',
      script: 'connectors/adapters/claude/scripts/post-tool-use-hook.sh',
      stdin: { session_id: 'probe' },
      env: { MISSION_ID: null },
      expect: { cliInvocations: [] }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false, 'the shipped hook does spawn the CLI from an unbound session');
      assert.deepEqual(result.observed.cliInvocations, ['protocol record-touched']);
    }
  );
});

test('the generated harness capability artifacts are in sync with the descriptors', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'generate-harness-capabilities.mjs'), '--check'],
    { encoding: 'utf8', cwd: repoRoot, timeout: 120_000 }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
