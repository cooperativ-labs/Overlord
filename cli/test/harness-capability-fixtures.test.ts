import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

// @ts-expect-error — plain ESM build script, intentionally untyped.
import {
  validateAgainstSchema,
  validateCodec
} from '../../scripts/generate-harness-capabilities.mjs';
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

function withMutationFixture(
  fixture: unknown,
  referenced: Record<string, unknown>,
  run: (fixturePath: string) => void,
  adapterFiles: Record<string, string> = {}
): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-mutation-fixture-test-'));
  try {
    const fixturesDir = path.join(dir, 'adapter', 'fixtures');
    mkdirSync(fixturesDir, { recursive: true });
    for (const [name, payloadFixture] of Object.entries(referenced)) {
      writeFileSync(path.join(fixturesDir, name), JSON.stringify(payloadFixture));
    }
    for (const [relativePath, contents] of Object.entries(adapterFiles)) {
      const filePath = path.join(dir, 'adapter', relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, contents);
    }
    const fixturePath = path.join(fixturesDir, 'mutation-window.json');
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

test('the PostToolUse capture hook is silent when no objective is explicitly bound', () => {
  withFixture(
    {
      fixtureVersion: 1,
      kind: 'script-io',
      script: 'connectors/core/scripts/capture-change-hook.sh',
      adapterKey: 'claude',
      stdin: { session_id: 'probe' },
      env: { MISSION_ID: null, OVERLORD_OBJECTIVE_ID: null },
      expect: { cliInvocations: [], sandboxWrites: [] }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, true, result.failures.join('\n'));
      assert.deepEqual(result.observed.cliInvocations, []);
    }
  );
});

test('a script-io adapter render requires an explicit core substitution point', () => {
  withFixture(
    {
      fixtureVersion: 1,
      kind: 'script-io',
      script: 'CONTRACT.md',
      adapterKey: 'claude'
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((failure: string) => failure.includes('does not contain')));
    }
  );
});

test('mutation-window classification is derived instead of echoed from fixture JSON', () => {
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'A completion payload cannot self-promote to a pair.',
      classification: 'paired',
      postFixture: 'fixtures/post.json',
      proof: {
        post: {
          session: 'session',
          workspace: 'cwd',
          tool: 'tool',
          completion: { path: 'event', equals: 'post' }
        }
      }
    },
    {
      'post.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: { session: 's1', cwd: '/repo', tool: 'write', event: 'post' }
      }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.deepEqual(result.observed, {
        classification: 'post-only',
        directPathEvidence: 'unavailable'
      });
      assert.ok(result.failures.some(failure => failure.includes('does not match derived')));
    }
  );
});

test('a referenced mutation payload requires an explicit semantic proof', () => {
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'A payload reference without semantic paths proves nothing.',
      classification: 'post-only',
      postFixture: 'fixtures/post.json',
      proof: {}
    },
    {
      'post.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: { session: 's1', cwd: '/repo', tool: 'write', event: 'post' }
      }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(
        result.failures.some(failure => failure.includes('requires a post semantic proof'))
      );
    }
  );
});

test('direct-path mutation evidence must be proved by codec-normalized file.edited output', () => {
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'A raw input path cannot bypass the connector codec.',
      classification: 'post-only',
      postFixture: 'fixtures/post.json',
      proof: {
        post: {
          session: 'session',
          workspace: 'cwd',
          tool: 'tool',
          directPath: 'input.file_path',
          completion: { path: 'event', equals: 'post' }
        }
      }
    },
    {
      'post.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: {
          session: 's1',
          cwd: '/repo',
          tool: 'read',
          input: { file_path: '/repo/a.ts' },
          event: 'post'
        }
      }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(
        result.failures.some(failure => failure.includes('expected file.edited payload has paths'))
      );
    }
  );
});

test('direct-path proof must name the exact raw field that produced the normalized edit path', () => {
  const claudeFixture = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'connectors/adapters/claude/fixtures/normalize-post-tool-use-write.json'),
      'utf8'
    )
  );
  const claudeCodec = readFileSync(
    path.join(repoRoot, 'connectors/adapters/claude/codec/claude.codec.yaml'),
    'utf8'
  );
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'An unrelated raw field cannot be presented as the direct edit path.',
      classification: 'post-only',
      postFixture: 'fixtures/post.json',
      proof: {
        post: {
          session: 'session_id',
          workspace: 'cwd',
          tool: 'tool_name',
          directPath: 'tool_name',
          completion: { path: 'hook_event_name', equals: 'PostToolUse' }
        }
      }
    },
    { 'post.json': claudeFixture },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(
        result.failures.some(failure =>
          failure.includes('exactly match the sole codec-normalized file.edited path')
        )
      );
      assert.equal(result.observed.directPathEvidence, 'unavailable');
    },
    { 'codec/claude.codec.yaml': claudeCodec }
  );
});

test('post-only pre/post evidence must execute a real mismatch assertion', () => {
  const payload = {
    session: 's1',
    call: 'c1',
    cwd: '/repo',
    tool: 'write',
    event: 'post'
  };
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'Two payloads without a proved mismatch are not honest post-only evidence.',
      classification: 'post-only',
      preFixture: 'fixtures/pre.json',
      postFixture: 'fixtures/post.json',
      proof: {
        pre: { session: 'session', call: 'call', workspace: 'cwd', tool: 'tool' },
        post: {
          session: 'session',
          call: 'call',
          workspace: 'cwd',
          tool: 'tool',
          completion: { path: 'event', equals: 'post' }
        }
      }
    },
    {
      'pre.json': { fixtureVersion: 1, kind: 'native-payload', payload },
      'post.json': { fixtureVersion: 1, kind: 'native-payload', payload }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some(failure => failure.includes('prove at least one mismatch')));
    }
  );
});

test('a mismatch assertion must use the semantic paths declared for its field', () => {
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'A session mismatch cannot be mislabeled as call evidence.',
      classification: 'post-only',
      preFixture: 'fixtures/pre.json',
      postFixture: 'fixtures/post.json',
      proof: {
        pre: { session: 'session', call: 'call', workspace: 'cwd', tool: 'tool' },
        post: {
          session: 'session',
          call: 'call',
          workspace: 'cwd',
          tool: 'tool',
          completion: { path: 'event', equals: 'post' }
        },
        mismatches: [{ field: 'call', pre: 'session', post: 'session' }]
      }
    },
    {
      'pre.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: { session: 's1', call: 'c1', cwd: '/repo', tool: 'write', event: 'pre' }
      },
      'post.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: { session: 's2', call: 'c1', cwd: '/repo', tool: 'write', event: 'post' }
      }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(
        result.failures.some(failure =>
          failure.includes('paths must equal the declared call semantic paths')
        )
      );
    }
  );
});

test('paired mutation evidence rejects a mismatched native call', () => {
  const proof = {
    pre: {
      session: 'session',
      call: 'call',
      workspace: 'cwd',
      tool: 'tool',
      directPath: 'path'
    },
    post: {
      session: 'session',
      call: 'call',
      workspace: 'cwd',
      tool: 'tool',
      directPath: 'path',
      outcome: 'outcome',
      completion: { path: 'event', equals: 'post' }
    }
  };
  withMutationFixture(
    {
      fixtureVersion: 1,
      kind: 'mutation-window',
      description: 'Every paired semantic must match.',
      classification: 'paired',
      preFixture: 'fixtures/pre.json',
      postFixture: 'fixtures/post.json',
      proof
    },
    {
      'pre.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: { session: 's1', call: 'c1', cwd: '/repo', tool: 'write', path: '/repo/a.ts' }
      },
      'post.json': {
        fixtureVersion: 1,
        kind: 'native-payload',
        payload: {
          session: 's1',
          call: 'c2',
          cwd: '/repo',
          tool: 'write',
          path: '/repo/a.ts',
          outcome: 'ok',
          event: 'post'
        }
      }
    },
    fixturePath => {
      const result = runFixture({ fixturePath, repoRoot });
      assert.equal(result.ok, false);
      assert.ok(result.failures.some(failure => failure.includes('call pair mismatch')));
    }
  );
});

test('the descriptor schema requires mutationHooks and rejects the removed projection', () => {
  const schema = parseYaml(
    readFileSync(path.join(repoRoot, 'contract/harness-capabilities.schema.yaml'), 'utf8')
  );
  const descriptor = parseYaml(
    readFileSync(
      path.join(repoRoot, 'connectors/adapters/claude/harness-capabilities.yaml'),
      'utf8'
    )
  );
  delete descriptor.mutationHooks;
  descriptor.legacy = {};

  const failures = validateAgainstSchema(descriptor, schema);
  assert.ok(failures.some((failure: string) => failure.includes('mutationHooks')));
  assert.ok(failures.some((failure: string) => failure.includes('unexpected field legacy')));
});

test('codec validation rejects incoherent or undeclared file-edit path rules', () => {
  const errors: string[] = [];
  validateCodec({
    adapter: 'fixture',
    integrationShape: 'callback',
    errors,
    codec: {
      codecVersion: 1,
      adapter: 'fixture',
      eventNamePath: 'event',
      events: [
        {
          native: 'wrong-kind',
          kind: 'tool.completed',
          origin: 'agent',
          toolPath: 'tool',
          inputPath: 'input',
          fileEditKind: 'tool.completed',
          filePathPaths: ['file_path']
        },
        {
          native: 'missing-paths',
          kind: 'tool.completed',
          origin: 'agent',
          toolPath: 'tool',
          inputPath: 'input',
          fileEditKind: 'file.edited'
        }
      ]
    }
  });

  assert.ok(errors.some(error => error.includes('literal "file.edited"')));
  assert.ok(errors.some(error => error.includes('filePathPaths must contain 1-8')));
  assert.ok(errors.some(error => error.includes('filePathPaths is only valid')));
});

test('the generated harness capability artifacts are in sync with the descriptors', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'generate-harness-capabilities.mjs'), '--check'],
    { encoding: 'utf8', cwd: repoRoot, timeout: 120_000 }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
