import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findSecretInArgv,
  partitionSecretEnv,
  spawnSyncWithoutSecrets
} from '../src/argv-secrets.ts';
import {
  CLAUDE_MCP_ADD_JSON_STDIN_MIN_VERSION,
  type ClaudeCliResult,
  type ClaudeCliRunner,
  mcpConfigCarriesSecrets,
  parseClaudeVersion,
  registerClaudeMcpServer,
  supportsMcpAddJsonStdin
} from '../src/claude-mcp-registration.ts';
import { buildLaunchPlan } from '../src/launch.ts';
import type { CliRuntime } from '../src/runtime.ts';

/**
 * E5 (coo:1318.m1fw): the Overlord user token never reaches a spawned process's argv.
 * These tests use a recognisable fake token and assert it is absent from every argv the CLI
 * builds or spawns, while still reaching the child through its environment or stdin.
 */

const FAKE_TOKEN = 'out_E5fakeTok_0123456789abcdefghijklmnop';

const SECRET_ENV = {
  OVERLORD_USER_TOKEN: FAKE_TOKEN,
  OVLD_USER_TOKEN: FAKE_TOKEN,
  USER_TOKEN: FAKE_TOKEN,
  CLAUDE_PLUGIN_OPTION_USER_TOKEN: FAKE_TOKEN
};

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---- argv guard -------------------------------------------------------------

test('findSecretInArgv flags a known env token and any out_ token, and nothing else', () => {
  const env = { OVERLORD_USER_TOKEN: 'sekret-value-1234' };
  assert.equal(findSecretInArgv(['mcp', 'add', 'x'], { env }), -1);
  assert.equal(findSecretInArgv(['--header', 'Bearer sekret-value-1234'], { env }), 1);
  assert.equal(findSecretInArgv(['--token', FAKE_TOKEN], { env: {} }), 1);
  assert.equal(findSecretInArgv(['a', 'b'], { env: {}, extraSecrets: ['short'] }), -1);
});

test('spawnSyncWithoutSecrets refuses before spawning and never echoes the token', () => {
  withEnv({ OVERLORD_USER_TOKEN: FAKE_TOKEN }, () => {
    assert.throws(
      () =>
        spawnSyncWithoutSecrets(
          'definitely-not-a-binary-e5',
          ['--header', `Bearer ${FAKE_TOKEN}`],
          {
            encoding: 'utf8'
          }
        ),
      (error: Error) => {
        assert.match(error.message, /argument 3 contains an Overlord credential/);
        assert.ok(!error.message.includes(FAKE_TOKEN));
        return true;
      }
    );
  });
});

test('spawnSyncWithoutSecrets also checks a token present only in the child env', () => {
  assert.throws(() =>
    spawnSyncWithoutSecrets('echo', ['child-only-secret-xyz'], {
      encoding: 'utf8',
      env: { OVLD_USER_TOKEN: 'child-only-secret-xyz' }
    })
  );
});

test('partitionSecretEnv keeps secret-looking keys and token values out of the argv-safe half', () => {
  const { argvSafe, secret } = partitionSecretEnv({
    MISSION_ID: 'coo:1',
    OVERLORD_USER_TOKEN: FAKE_TOKEN,
    GITHUB_PAT_SECRET: 'x',
    INNOCENT_NAME: FAKE_TOKEN,
    PATH_LIKE: '/usr/bin'
  });
  assert.deepEqual(Object.keys(argvSafe).sort(), ['MISSION_ID', 'PATH_LIKE']);
  assert.deepEqual(Object.keys(secret).sort(), [
    'GITHUB_PAT_SECRET',
    'INNOCENT_NAME',
    'OVERLORD_USER_TOKEN'
  ]);
});

// ---- Claude MCP registration -------------------------------------------------

type RecordedCall = { args: string[]; input?: string };

function fakeClaude(respond: (args: string[]) => Partial<ClaudeCliResult> = () => ({})): {
  run: ClaudeCliRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const run: ClaudeCliRunner = (args, options) => {
    calls.push({ args, input: options?.input });
    return { status: 0, stdout: '', stderr: '', ...respond(args) };
  };
  return { run, calls };
}

const SECRET_STDIO_CONFIG = {
  command: 'node',
  args: ['/opt/overlord/overlord-mcp.mjs'],
  env: { OVERLORD_USER_TOKEN: FAKE_TOKEN }
};
const SECRET_HTTP_CONFIG = {
  type: 'http' as const,
  url: 'https://www.ovld.ai/mcp',
  headers: { Authorization: `Bearer ${FAKE_TOKEN}` }
};
const PLAIN_CONFIG = { command: 'node', args: ['/opt/overlord/overlord-mcp.mjs'] };

function assertNoTokenInArgv(calls: RecordedCall[]): void {
  for (const call of calls) {
    assert.ok(
      !call.args.some(arg => arg.includes(FAKE_TOKEN)),
      `token on argv: ${call.args.join(' ')}`
    );
  }
}

test('parseClaudeVersion and the add-json stdin version gate', () => {
  assert.equal(parseClaudeVersion('2.1.327 (Claude Code)\n'), '2.1.327');
  assert.equal(parseClaudeVersion('nonsense'), null);
  assert.equal(CLAUDE_MCP_ADD_JSON_STDIN_MIN_VERSION, '2.1.327');
  assert.equal(supportsMcpAddJsonStdin('2.1.327'), true);
  assert.equal(supportsMcpAddJsonStdin('2.2.0'), true);
  assert.equal(supportsMcpAddJsonStdin('2.1.326'), false);
  assert.equal(supportsMcpAddJsonStdin(null), false);
});

test('mcpConfigCarriesSecrets treats any env or header as sensitive', () => {
  assert.equal(mcpConfigCarriesSecrets(SECRET_STDIO_CONFIG), true);
  assert.equal(mcpConfigCarriesSecrets(SECRET_HTTP_CONFIG), true);
  assert.equal(mcpConfigCarriesSecrets(PLAIN_CONFIG), false);
  assert.equal(mcpConfigCarriesSecrets({ type: 'http', url: 'https://x/mcp?token=abc' }), true);
});

for (const [label, config] of [
  ['stdio env', SECRET_STDIO_CONFIG],
  ['http headers', SECRET_HTTP_CONFIG]
] as const) {
  test(`Claude >= 2.1.327 registers a ${label} credential over stdin, never argv`, () => {
    const { run, calls } = fakeClaude(args =>
      args[0] === '--version' ? { stdout: '2.1.329 (Claude Code)\n' } : {}
    );
    const result = registerClaudeMcpServer({
      name: 'overlord',
      config,
      run,
      env: { ...SECRET_ENV }
    });

    assert.equal(result.registered, true);
    assert.equal(result.method, 'add-json-stdin');
    assert.equal(result.claudeVersion, '2.1.329');
    const add = calls.find(call => call.args[1] === 'add-json');
    assert.deepEqual(add?.args, ['mcp', 'add-json', 'overlord', '-', '--scope', 'user']);
    assert.deepEqual(JSON.parse(add?.input ?? ''), config);
    assertNoTokenInArgv(calls);
  });
}

test('an existing server is removed and re-added over stdin', () => {
  let adds = 0;
  const { run, calls } = fakeClaude(args => {
    if (args[1] === 'add-json' && adds++ === 0) {
      return { status: 1, stderr: 'MCP server overlord already exists in user config' };
    }
    return {};
  });
  const result = registerClaudeMcpServer({
    name: 'overlord',
    config: SECRET_STDIO_CONFIG,
    run,
    env: { ...SECRET_ENV },
    claudeVersion: '2.1.327'
  });
  assert.equal(result.registered, true);
  assert.deepEqual(
    calls.map(call => call.args.slice(0, 2).join(' ')),
    ['mcp add-json', 'mcp remove', 'mcp add-json']
  );
  assertNoTokenInArgv(calls);
});

test('older Claude refuses a credential-bearing definition instead of using argv', () => {
  const { run, calls } = fakeClaude();
  const result = registerClaudeMcpServer({
    name: 'overlord',
    config: SECRET_STDIO_CONFIG,
    run,
    env: { ...SECRET_ENV },
    claudeVersion: '2.1.326'
  });
  assert.equal(result.registered, false);
  assert.equal(calls.length, 0);
  assert.match(result.warnings.join('\n'), /Claude Code 2\.1\.326 cannot read an MCP definition/);
  assert.ok(!result.warnings.join('\n').includes(FAKE_TOKEN));
});

test('inside a Claude Code session the stdin form is skipped and secrets are refused', () => {
  const { run, calls } = fakeClaude();
  const result = registerClaudeMcpServer({
    name: 'overlord',
    config: SECRET_HTTP_CONFIG,
    run,
    env: { ...SECRET_ENV, CLAUDECODE: '1' },
    claudeVersion: '2.1.329'
  });
  assert.equal(result.registered, false);
  assert.equal(calls.length, 0);
  assert.match(result.warnings.join('\n'), /inside a Claude Code session/);
});

test('a failed stdin registration does not fall back to argv for a credential', () => {
  const { run, calls } = fakeClaude(args =>
    args[1] === 'add-json' ? { status: 1, stderr: 'error: unexpected argument' } : {}
  );
  const result = registerClaudeMcpServer({
    name: 'overlord',
    config: SECRET_STDIO_CONFIG,
    run,
    env: { ...SECRET_ENV },
    claudeVersion: '2.1.327'
  });
  assert.equal(result.registered, false);
  assert.equal(calls.length, 1);
  assertNoTokenInArgv(calls);
});

test('older Claude falls back to argv only for a credential-free definition', () => {
  const { run, calls } = fakeClaude();
  const result = registerClaudeMcpServer({
    name: 'overlord',
    config: PLAIN_CONFIG,
    run,
    env: { ...SECRET_ENV },
    claudeVersion: '2.1.300'
  });
  assert.equal(result.registered, true);
  assert.equal(result.method, 'add-json-argv');
  assert.deepEqual(JSON.parse(calls[0]?.args[3] ?? ''), PLAIN_CONFIG);
  assertNoTokenInArgv(calls);
});

test('the argv guard still blocks a token smuggled into a credential-free-looking field', () => {
  const { run, calls } = fakeClaude();
  const result = registerClaudeMcpServer({
    name: 'overlord',
    // A token that is not `out_`-shaped, passed as a plain arg: only the env guard catches it.
    config: { command: 'node', args: ['--auth', 'env-only-secret-value'] },
    run,
    env: { OVERLORD_USER_TOKEN: 'env-only-secret-value' },
    claudeVersion: '2.1.300'
  });
  assert.equal(result.registered, false);
  assert.equal(calls.length, 0);
});

// ---- ovld agent-setup, every agent -------------------------------------------

/**
 * Put recording `claude` and `codex` stand-ins first on PATH. Each appends its argv (as a
 * JSON line) to `argv.log`, so the test sees exactly what setup spawned.
 */
function installRecordingBinaries(dir: string): { binDir: string; logPath: string } {
  const binDir = path.join(dir, 'bin');
  const logPath = path.join(dir, 'argv.log');
  mkdirSync(binDir, { recursive: true });
  for (const name of ['claude', 'codex']) {
    const target = path.join(binDir, name);
    writeFileSync(
      target,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');`,
        "if (process.argv[2] === '--version') console.log('0.171.0');",
        ''
      ].join('\n')
    );
    chmodSync(target, 0o755);
  }
  return { binDir, logPath };
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('ovld agent-setup never puts the user token on argv or in a written file, for every agent', async () => {
  const { listAvailableConnectors, setupConnector } = await import('../dist/connectors.js');
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'ovld-e5-setup-'));
  try {
    const { binDir, logPath } = installRecordingBinaries(scratch);
    const agents = listAvailableConnectors() as string[];
    for (const agent of ['claude', 'codex', 'cursor', 'antigravity', 'pi']) {
      assert.ok(agents.includes(agent), `connector ${agent} is available`);
    }

    withEnv({ ...SECRET_ENV, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` }, () => {
      for (const agentKey of agents) {
        const home = path.join(scratch, `home-${agentKey}`);
        mkdirSync(home, { recursive: true });
        setupConnector({ agentKey, home });
        for (const file of filesUnder(home)) {
          assert.ok(
            !readFileSync(file).includes(FAKE_TOKEN),
            `${agentKey} setup wrote the token into ${path.relative(home, file)}`
          );
        }
      }
    });

    const spawned = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as string[]);
    // Setup really did drive both CLIs, so the assertion below is not vacuous.
    assert.ok(spawned.some(argv => argv[0] === 'claude' && argv[1] === 'plugin'));
    assert.ok(spawned.some(argv => argv[0] === 'codex' && argv[1] === 'plugin'));
    for (const argv of spawned) {
      assert.ok(!argv.some(arg => arg.includes(FAKE_TOKEN)), `token on argv: ${argv.join(' ')}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- launch -----------------------------------------------------------------

function launchRuntime(): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://127.0.0.1:4310',
      health: async () => ({ ok: true }),
      get: async <T>(requestPath: string): Promise<T> => {
        if (/^\/api\/missions\/[^/]+$/.test(requestPath)) {
          return {
            id: 'mission-uuid',
            displayId: 'coo:11',
            title: 'E5',
            objectives: [
              {
                id: 'objective-uuid',
                state: 'executing',
                instructionText: 'Ship it',
                displayId: 'coo:11.k7xm',
                displayKey: 'k7xm',
                title: 'Ship it'
              }
            ]
          } as T;
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      post: async () => {
        throw new Error('Unexpected POST');
      },
      patch: async () => {
        throw new Error('Unexpected PATCH');
      },
      delete: async () => {
        throw new Error('Unexpected DELETE');
      }
    },
    close: () => {}
  };
}

test('launch keeps a project token out of every argv and writes the launch script owner-only', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-e5-launch-'));
  try {
    for (const agent of ['claude', 'codex', 'pi', 'cursor']) {
      const plan = await buildLaunchPlan({
        runtime: launchRuntime(),
        options: {
          agent,
          missionId: 'coo:11',
          workingDirectory,
          terminalLauncher: 'Terminal',
          launchEnvVars: { OVERLORD_USER_TOKEN: FAKE_TOKEN, PLAIN_VALUE: 'visible' },
          executionRequestId: `request-${agent}`
        }
      });

      // The agent still receives the token, through its environment.
      assert.equal(plan.env.OVERLORD_USER_TOKEN, FAKE_TOKEN);

      // Every argv the launch can spawn: the agent itself, the terminal-open, and the
      // `$SHELL -ilc S` Latch command (inline and in the Latch manifest).
      const argvs = [
        [plan.command, ...plan.args],
        [plan.execution.command, ...plan.execution.args],
        ['/bin/zsh', '-ilc', plan.latchCommandString]
      ];
      for (const argv of argvs) {
        assert.ok(!argv.some(arg => arg.includes(FAKE_TOKEN)), `${agent}: ${argv.join(' ')}`);
      }
      assert.ok(plan.latchCommandString.includes(`export PLAIN_VALUE='visible'`));

      // A new terminal window inherits no env, so the script must carry the token: owner-only.
      const scriptPath = path.join(
        workingDirectory,
        '.overlord',
        'tmp',
        `launch-coo-11-request-${agent}.sh`
      );
      assert.ok(readFileSync(scriptPath, 'utf8').includes(FAKE_TOKEN));
      assert.equal(statSync(scriptPath).mode & 0o077, 0, 'launch script is owner-only');
    }
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
