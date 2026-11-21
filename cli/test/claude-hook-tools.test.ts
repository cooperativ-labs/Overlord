/**
 * Claude `mcp_tool` hook tools (coo:1323.9hkq).
 *
 * The local hooks server (`overlord-mcp.mjs --hooks`) answers four unlisted tools that Claude Code
 * hooks call. Each one spawns the same `ovld` command the CLI fallback uses. These tests drive the
 * real rendered server over NDJSON stdio and the real built CLI against a stub backend, and prove:
 *
 * - each tool answers with the exact Claude hook output shape, using the Claude fixtures;
 * - the MCP tool and the CLI command give the same answer and the same side effects for the same
 *   native payload (parity);
 * - unbound sessions and mismatched events spawn nothing and answer `{}`.
 */
import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { writeActiveSession } from '../src/active-objective-sessions.ts';
import { CLAUDE_HEADLESS_STOP_WAIT_MS } from '../src/agent-session/inbox.ts';
import { readUnsyncedChangeEvidence } from '../src/change-ledger.ts';
import { renderConnectorMcpShim } from '../src/connector-core-render.ts';
import { writeNativeSessionIndex } from '../src/hook-binding.ts';
import { writeCachedSessionKey } from '../src/session-key.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const cliEntry = path.join(repoRoot, 'cli', 'bin', 'ovld.mjs');
const fixturesDir = path.join(repoRoot, 'connectors', 'adapters', 'claude', 'fixtures');

const MISSION_ID = 'coo:900';
const OBJECTIVE_ID = 'coo:900.abcd';
const SESSION_KEY = 'sess_hook_tools';
const CHANNEL_ID = 'chan_hook_tools';
const CHANNEL_TOKEN = 'osc_hook_tools_token';

type Payload = Record<string, unknown>;

function fixturePayload(name: string): Payload {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')).payload as Payload;
}

// ---------------------------------------------------------------- stub backend

type Recorded = { path: string; body: Record<string, unknown> };

const backend = {
  server: null as Server | null,
  url: '',
  requests: [] as Recorded[],
  stopStatus: { needed: false, reason: null as string | null },
  decision: 'allow' as 'allow' | 'deny' | 'ask',
  input: null as null | { id: string; leaseId: string; body: string }
};

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function respond(pathname: string, body: Record<string, unknown>): unknown {
  if (pathname === '/api/protocol/hook-event') {
    const flags = (body.flags ?? {}) as Record<string, string>;
    if (flags['--hook-type'] === 'Stop') {
      return {
        eventId: null,
        objectiveId: 'objective-uuid',
        sessionId: 'session-uuid',
        deliveryStatus: backend.stopStatus
      };
    }
    return { eventId: 'event-uuid', objectiveId: 'objective-uuid', sessionId: 'session-uuid' };
  }
  const channel = '/api/agent-session-channels/v1';
  if (pathname === `${channel}/requests`) return { requestId: 'req-1', status: 'open' };
  if (pathname === `${channel}/requests/req-1/lease`) {
    return { leaseId: 'lease-1', status: 'resolved', resolution: { decision: backend.decision } };
  }
  if (pathname === `${channel}/inputs/claim`) {
    const input = backend.input;
    backend.input = null;
    return { input };
  }
  if (pathname.endsWith('/emitted')) return { emitted: true };
  return {};
}

before(async () => {
  backend.server = createServer(async (request, response) => {
    const body = await readBody(request);
    const pathname = new URL(request.url ?? '/', 'http://stub').pathname;
    backend.requests.push({ path: pathname, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(respond(pathname, body)));
  });
  await new Promise<void>(resolve => backend.server?.listen(0, '127.0.0.1', resolve));
  backend.url = `http://127.0.0.1:${(backend.server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>(resolve => backend.server?.close(() => resolve()));
});

function resetBackend(): void {
  backend.requests = [];
  backend.stopStatus = { needed: false, reason: null };
  backend.decision = 'allow';
  backend.input = null;
}

/** Recorded protocol bodies without the per-process device headers (they are not in the body). */
function protocolBodies(): Array<Record<string, unknown>> {
  return backend.requests.filter(r => r.path === '/api/protocol/hook-event').map(r => r.body);
}

// ---------------------------------------------------------------- environment

type Scope = { home: string; workspace: string; spawnMarker: string; ovldBin: string };

function makeScope(): Scope {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-hooktools-home-')));
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-hooktools-ws-')));
  const binDir = mkdtempSync(path.join(tmpdir(), 'ovld-hooktools-bin-'));
  const spawnMarker = path.join(binDir, 'spawned');
  const ovldBin = path.join(binDir, 'ovld');
  writeFileSync(
    ovldBin,
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(spawnMarker)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliEntry)} "$@"\n`
  );
  chmodSync(ovldBin, 0o755);
  return { home, workspace, spawnMarker, ovldBin };
}

/** Seed the binding attach would have written: session-key cache and active objective. */
function seedAttach(scope: Scope): void {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = scope.home;
  try {
    writeCachedSessionKey({
      missionId: MISSION_ID,
      workingDirectory: scope.workspace,
      sessionKey: SESSION_KEY,
      objectiveId: OBJECTIVE_ID
    });
    writeActiveSession({
      workingDirectory: scope.workspace,
      missionId: MISSION_ID,
      objectiveId: OBJECTIVE_ID,
      objectiveAliases: [OBJECTIVE_ID],
      sessionKey: SESSION_KEY
    });
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

// `CLAUDE_PID` and `CLAUDE_CODE_ENTRYPOINT` leak in when the suite runs inside Claude Code: the
// first would make every hooks server look nested, the second would make Stop wait.
const STRIPPED_ENV =
  /^(OVERLORD_|OVLD_|MISSION_ID$|SESSION_KEY$|CLAUDE_CODE_SESSION_ID$|USER_TOKEN$|CLAUDE_PID$|CLAUDE_CODE_ENTRYPOINT$)/;

function baseEnv(scope: Scope, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return {
    ...env,
    OVLD_HOME: scope.home,
    OVLD_BIN: scope.ovldBin,
    OVERLORD_BACKEND_URL: backend.url,
    OVERLORD_BACKEND_URL_DEV: backend.url,
    OVERLORD_USER_TOKEN: 'ovld_test_user_token',
    ...extra
  };
}

const launchEnv = { MISSION_ID, OVERLORD_OBJECTIVE_ID: OBJECTIVE_ID };
const channelEnv = {
  OVERLORD_SESSION_CHANNEL_ID: CHANNEL_ID,
  OVERLORD_SESSION_CHANNEL_TOKEN: CHANNEL_TOKEN
};

// ---------------------------------------------------------------- CLI and MCP drivers

async function runCli(
  args: string[],
  { stdin, env, cwd }: { stdin: string; env: NodeJS.ProcessEnv; cwd: string }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => (stdout += data));
  child.stderr.on('data', data => (stderr += data));
  child.stdin.end(stdin);
  const code = await new Promise<number | null>(resolve => child.on('close', resolve));
  return { code, stdout, stderr };
}

let shimPath = '';

before(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-hooktools-shim-'));
  shimPath = path.join(dir, 'overlord-mcp.mjs');
  writeFileSync(shimPath, renderConnectorMcpShim({ adapterKey: 'claude' }));
});

type McpSession = {
  request: (method: string, params?: unknown) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
};

function openMcp({
  env,
  hooks = true,
  framing = 'ndjson'
}: {
  env: NodeJS.ProcessEnv;
  hooks?: boolean;
  framing?: 'ndjson' | 'content-length';
}): McpSession {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [shimPath, ...(hooks ? ['--hooks'] : [])],
    { env, cwd: repoRoot }
  );
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let buffered = Buffer.alloc(0);
  child.stdout.on('data', (data: Buffer) => {
    buffered = Buffer.concat([buffered, data]);
    const messages: string[] = [];
    if (framing === 'ndjson') {
      let newline = buffered.indexOf(0x0a);
      while (newline !== -1) {
        messages.push(buffered.subarray(0, newline).toString('utf8'));
        buffered = buffered.subarray(newline + 1);
        newline = buffered.indexOf(0x0a);
      }
    } else {
      // Content-Length counts bytes, so frame on the raw buffer.
      while (true) {
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffered.subarray(0, headerEnd).toString('utf8');
        const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
        if (buffered.length < headerEnd + 4 + length) break;
        messages.push(buffered.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'));
        buffered = buffered.subarray(headerEnd + 4 + length);
      }
    }
    for (const line of messages) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      pending.get(message.id as number)?.(message);
    }
  });
  let nextId = 1;
  return {
    request: (method, params) =>
      new Promise(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        const json = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        child.stdin.write(
          framing === 'ndjson'
            ? `${json}\n`
            : `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
        );
      }),
    close: async () => {
      child.stdin.end();
      child.kill();
      await new Promise(resolve => child.on('close', resolve));
    }
  };
}

/**
 * What Claude Code passes as `arguments`: only the templated hook `input`. `${path}` strings
 * substitute as-is, objects arrive JSON-encoded, booleans as "true"/"false", missing paths as "".
 */
function templated(payload: Payload, fields: string[], literals: Payload = {}): Payload {
  const args: Payload = {};
  for (const field of fields) {
    const value = payload[field];
    args[field] =
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  }
  return { ...args, ...literals };
}

async function callHookTool(env: NodeJS.ProcessEnv, name: string, args: Payload): Promise<unknown> {
  const mcp = openMcp({ env });
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const response = await mcp.request('tools/call', { name, arguments: args });
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    assert.equal(result.isError, undefined, 'hook tools never answer with isError');
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]?.type, 'text');
    return JSON.parse(result.content[0]?.text ?? '');
  } finally {
    await mcp.close();
  }
}

const PROMPT_FIELDS = ['hook_event_name', 'session_id', 'cwd', 'prompt'];
const POST_TOOL_FIELDS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'tool_name',
  'tool_use_id',
  'tool_input'
];
const STOP_FIELDS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'stop_hook_active',
  'background_tasks'
];
const PERMISSION_FIELDS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'permission_mode',
  'tool_name',
  'tool_input'
];

function withCwd(payload: Payload, cwd: string): Payload {
  return { ...payload, cwd };
}

// ---------------------------------------------------------------- server surface

test('hooks mode lists no tools over NDJSON; the model-facing mode keeps Content-Length', async () => {
  const scope = makeScope();
  const hooks = openMcp({ env: baseEnv(scope) });
  try {
    const init = await hooks.request('initialize', { protocolVersion: '2025-06-18' });
    assert.ok((init.result as Record<string, unknown>).serverInfo);
    const listed = await hooks.request('tools/list');
    assert.deepEqual((listed.result as { tools: unknown[] }).tools, []);
    const unknown = await hooks.request('tools/call', {
      name: 'overlord_attach_session',
      arguments: {}
    });
    assert.match(String((unknown.error as { message: string }).message), /Unknown tool/);
  } finally {
    await hooks.close();
  }

  const model = openMcp({ env: baseEnv(scope), hooks: false, framing: 'content-length' });
  try {
    await model.request('initialize', { protocolVersion: '2025-06-18' });
    const listed = await model.request('tools/list');
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map(t => t.name);
    assert.ok(names.length > 0);
    assert.ok(!names.some(name => name.startsWith('overlord_hook_')));
    const hidden = await model.request('tools/call', { name: 'overlord_hook_stop', arguments: {} });
    assert.match(String((hidden.error as { message: string }).message), /Unknown tool/);
  } finally {
    await model.close();
  }
  assert.equal(existsSync(scope.spawnMarker), false);
});

test('an unbound session answers {} from every hook tool and spawns nothing', async () => {
  resetBackend();
  const scope = makeScope();
  const env = baseEnv(scope);
  const cases: Array<[string, Payload]> = [
    [
      'overlord_hook_user_prompt_submit',
      templated(fixturePayload('normalize-user-prompt-submit.json'), PROMPT_FIELDS)
    ],
    [
      'overlord_hook_post_tool_use',
      templated(fixturePayload('normalize-post-tool-use-write.json'), POST_TOOL_FIELDS)
    ],
    [
      'overlord_hook_stop',
      templated(
        { hook_event_name: 'Stop', session_id: 's', cwd: '/repo', stop_hook_active: false },
        STOP_FIELDS
      )
    ],
    [
      'overlord_hook_permission_request',
      templated(fixturePayload('permission-request.json'), PERMISSION_FIELDS, {
        hookTimeoutSeconds: 30
      })
    ]
  ];
  for (const [name, args] of cases) {
    assert.deepEqual(await callHookTool(env, name, args), {}, name);
  }
  assert.equal(existsSync(scope.spawnMarker), false, 'no ovld process for an unbound session');
  assert.equal(backend.requests.length, 0);
});

test('a hook tool ignores a payload for another event', async () => {
  resetBackend();
  const scope = makeScope();
  const env = baseEnv(scope, { ...launchEnv, ...channelEnv });
  const prompt = templated(fixturePayload('normalize-user-prompt-submit.json'), PROMPT_FIELDS);
  assert.deepEqual(await callHookTool(env, 'overlord_hook_stop', prompt), {});
  assert.deepEqual(await callHookTool(env, 'overlord_hook_permission_request', prompt), {});
  assert.equal(existsSync(scope.spawnMarker), false);
});

// ---------------------------------------------------------------- UserPromptSubmit

test('UserPromptSubmit: MCP tool and CLI record the same follow-up and answer {}', async () => {
  const payload = fixturePayload('normalize-user-prompt-submit.json');

  resetBackend();
  const mcpScope = makeScope();
  seedAttach(mcpScope);
  const mcpAnswer = await callHookTool(
    baseEnv(mcpScope, launchEnv),
    'overlord_hook_user_prompt_submit',
    templated(withCwd(payload, mcpScope.workspace), PROMPT_FIELDS)
  );
  const mcpBodies = protocolBodies();

  resetBackend();
  const cliScope = makeScope();
  seedAttach(cliScope);
  const cli = await runCli(
    [
      'protocol',
      'hook-event',
      '--agent',
      'claude',
      '--hook-type',
      'UserPromptSubmit',
      '--payload-file',
      '-'
    ],
    {
      stdin: JSON.stringify(withCwd(payload, cliScope.workspace)),
      env: baseEnv(cliScope, launchEnv),
      cwd: cliScope.workspace
    }
  );
  assert.equal(cli.code, 0, cli.stderr);
  const cliResult = JSON.parse(cli.stdout) as Record<string, unknown>;
  const cliBodies = protocolBodies();

  assert.deepEqual(mcpAnswer, {});
  assert.deepEqual(cliResult.hookOutput, mcpAnswer);
  assert.equal(cliResult.recorded, true);
  assert.equal(mcpBodies.length, 1);
  assert.deepEqual(mcpBodies, cliBodies, 'identical backend side effect');
  const body = mcpBodies[0] as {
    flags: Record<string, string>;
    fileInputs: Record<string, string>;
  };
  assert.deepEqual(body.flags, {
    '--hook-type': 'UserPromptSubmit',
    '--mission-id': MISSION_ID,
    '--session-key': SESSION_KEY,
    '--external-session-id': payload.session_id,
    '--turn-index': '0'
  });
  // The prompt travels as a file input, never as a flag.
  assert.equal(body.fileInputs['--prompt-file'], payload.prompt);
});

test('UserPromptSubmit binds through the native-session index without a launch environment', async () => {
  resetBackend();
  const payload = fixturePayload('normalize-user-prompt-submit.json');
  const scope = makeScope();
  seedAttach(scope);
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = scope.home;
  try {
    writeNativeSessionIndex({
      agent: 'claude',
      nativeSessionId: String(payload.session_id),
      workingDirectory: scope.workspace,
      missionId: MISSION_ID,
      objectiveId: OBJECTIVE_ID
    });
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
  const answer = await callHookTool(
    baseEnv(scope),
    'overlord_hook_user_prompt_submit',
    templated(withCwd(payload, scope.workspace), PROMPT_FIELDS)
  );
  assert.deepEqual(answer, {});
  const [body] = protocolBodies() as Array<{ flags: Record<string, string> }>;
  assert.equal(body?.flags['--mission-id'], MISSION_ID);
  assert.equal(body?.flags['--session-key'], SESSION_KEY);

  // Another conversation in the same checkout is not bound by the index.
  resetBackend();
  const other = await callHookTool(
    baseEnv(scope),
    'overlord_hook_user_prompt_submit',
    templated(
      withCwd({ ...payload, session_id: 'another-conversation' }, scope.workspace),
      PROMPT_FIELDS
    )
  );
  assert.deepEqual(other, {});
  assert.equal(backend.requests.length, 0);
});

// ---------------------------------------------------------------- PostToolUse

test('PostToolUse: MCP tool and CLI capture the same ledger evidence and answer {}', async () => {
  const fixture = fixturePayload('normalize-post-tool-use-write.json');
  const capture = async (via: 'mcp' | 'cli') => {
    const scope = makeScope();
    seedAttach(scope);
    const payload = {
      ...fixture,
      cwd: scope.workspace,
      tool_input: {
        ...(fixture.tool_input as Payload),
        file_path: path.join(scope.workspace, 'config', 'secrets.ts')
      }
    };
    const env = baseEnv(scope, launchEnv);
    let answer: unknown;
    if (via === 'mcp') {
      answer = await callHookTool(
        env,
        'overlord_hook_post_tool_use',
        templated(payload, POST_TOOL_FIELDS)
      );
    } else {
      const cli = await runCli(['protocol', 'capture-change', '--agent', 'claude'], {
        stdin: JSON.stringify(payload),
        env,
        cwd: scope.workspace
      });
      assert.equal(cli.code, 0, cli.stderr);
      answer = JSON.parse(cli.stdout);
    }
    const previous = process.env.OVLD_HOME;
    process.env.OVLD_HOME = scope.home;
    try {
      const evidence = readUnsyncedChangeEvidence({
        workingDirectory: scope.workspace,
        objectiveId: OBJECTIVE_ID,
        sessionKey: SESSION_KEY
      }).map(entry => ({ filePath: entry.filePath, source: entry.source }));
      return { answer, evidence };
    } finally {
      if (previous === undefined) delete process.env.OVLD_HOME;
      else process.env.OVLD_HOME = previous;
    }
  };
  const mcp = await capture('mcp');
  const cli = await capture('cli');
  assert.deepEqual(mcp.answer, {});
  assert.deepEqual(mcp.evidence, [{ filePath: 'config/secrets.ts', source: 'declared_edit' }]);
  assert.deepEqual(mcp.evidence, cli.evidence, 'identical ledger side effect');
});

// ---------------------------------------------------------------- Stop

test('Stop delivery reminder: block with reason only when needed, once, never on stop_hook_active', async () => {
  const reason = 'Objective coo:900.abcd is still executing and has not been delivered.';
  const stopPayload = (cwd: string, active = false): Payload => ({
    hook_event_name: 'Stop',
    session_id: '9f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    cwd,
    stop_hook_active: active
  });

  // Nothing to inject: {}.
  resetBackend();
  const quiet = makeScope();
  seedAttach(quiet);
  assert.deepEqual(
    await callHookTool(
      baseEnv(quiet, launchEnv),
      'overlord_hook_stop',
      templated(stopPayload(quiet.workspace), STOP_FIELDS)
    ),
    {}
  );
  assert.equal(protocolBodies().length, 1);

  // Needed: MCP and CLI give the same block.
  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const mcpScope = makeScope();
  seedAttach(mcpScope);
  const env = baseEnv(mcpScope, launchEnv);
  const mcpAnswer = await callHookTool(
    env,
    'overlord_hook_stop',
    templated(stopPayload(mcpScope.workspace), STOP_FIELDS)
  );
  assert.deepEqual(mcpAnswer, { decision: 'block', reason: `[Overlord] ${reason}` });
  const mcpBodies = protocolBodies();

  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const cliScope = makeScope();
  seedAttach(cliScope);
  const cli = await runCli(
    ['protocol', 'hook-event', '--agent', 'claude', '--hook-type', 'Stop', '--payload-file', '-'],
    {
      stdin: JSON.stringify(stopPayload(cliScope.workspace)),
      env: baseEnv(cliScope, launchEnv),
      cwd: cliScope.workspace
    }
  );
  assert.equal(cli.code, 0, cli.stderr);
  const cliResult = JSON.parse(cli.stdout) as Record<string, unknown>;
  assert.deepEqual(cliResult.hookOutput, mcpAnswer);
  assert.deepEqual(cliResult.deliveryStatus, { needed: true, reason });
  assert.deepEqual(protocolBodies(), mcpBodies, 'identical backend request');
  assert.deepEqual((mcpBodies[0] as { flags: Record<string, string> }).flags, {
    '--hook-type': 'Stop',
    '--mission-id': MISSION_ID,
    '--session-key': SESSION_KEY,
    '--external-session-id': '9f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
  });

  // Once per session and objective: the second stop answers {} without asking the backend.
  resetBackend();
  backend.stopStatus = { needed: true, reason };
  assert.deepEqual(
    await callHookTool(
      env,
      'overlord_hook_stop',
      templated(stopPayload(mcpScope.workspace), STOP_FIELDS)
    ),
    {}
  );
  assert.equal(backend.requests.length, 0);

  // stop_hook_active (templated as the string "true") never blocks again.
  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const loopScope = makeScope();
  seedAttach(loopScope);
  assert.deepEqual(
    await callHookTool(
      baseEnv(loopScope, launchEnv),
      'overlord_hook_stop',
      templated(stopPayload(loopScope.workspace, true), STOP_FIELDS)
    ),
    {}
  );
  assert.equal(backend.requests.length, 0);
});

test('Stop inject: a pending channel instruction becomes the exact Claude Stop block (MCP = CLI)', async () => {
  const stop = (cwd: string): Payload => ({
    hook_event_name: 'Stop',
    session_id: 'session-inject',
    cwd,
    stop_hook_active: false
  });
  const input = { id: 'input-1', leaseId: 'lease-in', body: 'Also update the changelog' };

  resetBackend();
  backend.input = { ...input };
  const mcpScope = makeScope();
  const mcpAnswer = await callHookTool(
    baseEnv(mcpScope, channelEnv),
    'overlord_hook_stop',
    templated(stop(mcpScope.workspace), STOP_FIELDS)
  );

  resetBackend();
  backend.input = { ...input };
  const cliScope = makeScope();
  const cli = await runCli(['agent-session', 'inbox', '--agent', 'claude', '--payload-file', '-'], {
    stdin: JSON.stringify(stop(cliScope.workspace)),
    env: baseEnv(cliScope, channelEnv),
    cwd: cliScope.workspace
  });
  assert.equal(cli.code, 0, cli.stderr);
  assert.equal(cli.stdout, '{"decision":"block","reason":"Also update the changelog"}\n');
  assert.deepEqual(mcpAnswer, JSON.parse(cli.stdout));
});

// ---------------------------------------------------------------- PermissionRequest

test('PermissionRequest: allow, deny and ask map to the Claude decision shape (MCP = CLI)', async () => {
  const fixture = fixturePayload('permission-request.json');
  const expected = JSON.parse(readFileSync(path.join(fixturesDir, 'decision-codec.json'), 'utf8'))
    .expect.responses as Record<'allow' | 'deny' | 'ask', string | null>;

  for (const decision of ['allow', 'deny', 'ask'] as const) {
    resetBackend();
    backend.decision = decision;
    const mcpScope = makeScope();
    const mcpAnswer = await callHookTool(
      baseEnv(mcpScope, channelEnv),
      'overlord_hook_permission_request',
      templated(withCwd(fixture, mcpScope.workspace), PERMISSION_FIELDS, { hookTimeoutSeconds: 30 })
    );
    const created = backend.requests.find(r => r.path.endsWith('/requests'));
    assert.ok(created, `${decision}: the request reached the channel`);

    resetBackend();
    backend.decision = decision;
    const cliScope = makeScope();
    const cli = await runCli(
      ['agent-session', 'request', '--agent', 'claude', '--payload-file', '-'],
      {
        stdin: JSON.stringify({ ...withCwd(fixture, cliScope.workspace), hookTimeoutSeconds: 30 }),
        env: baseEnv(cliScope, channelEnv),
        cwd: cliScope.workspace
      }
    );
    assert.equal(cli.code, 0, cli.stderr);

    assert.equal(
      cli.stdout || null,
      expected[decision],
      `${decision}: CLI matches the codec fixture`
    );
    assert.deepEqual(mcpAnswer, cli.stdout ? JSON.parse(cli.stdout) : {}, `${decision}: MCP = CLI`);
  }
});

// ---------------------------------------------------------------- n938: subagents, nesting, wait

function writeIndex(
  scope: Scope,
  entry: { nativeSessionId: string; missionId: string; objectiveId: string }
): void {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = scope.home;
  try {
    writeNativeSessionIndex({ agent: 'claude', workingDirectory: scope.workspace, ...entry });
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

test('UserPromptSubmit: a harness <task-notification> is never recorded as a follow-up (MCP = CLI)', async () => {
  const recorded = fixturePayload('subagent-stop-background.json')
    .taskNotificationPrompt as Payload;

  resetBackend();
  const mcpScope = makeScope();
  seedAttach(mcpScope);
  const answer = await callHookTool(
    baseEnv(mcpScope, launchEnv),
    'overlord_hook_user_prompt_submit',
    templated(withCwd(recorded, mcpScope.workspace), PROMPT_FIELDS)
  );
  assert.deepEqual(answer, {});
  assert.equal(protocolBodies().length, 0);

  resetBackend();
  const cliScope = makeScope();
  seedAttach(cliScope);
  const cli = await runCli(
    [
      'protocol',
      'hook-event',
      '--agent',
      'claude',
      '--hook-type',
      'UserPromptSubmit',
      '--payload-file',
      '-'
    ],
    {
      stdin: JSON.stringify(withCwd(recorded, cliScope.workspace)),
      env: baseEnv(cliScope, launchEnv),
      cwd: cliScope.workspace
    }
  );
  assert.equal(cli.code, 0, cli.stderr);
  const result = JSON.parse(cli.stdout) as Record<string, unknown>;
  assert.equal(result.skipped, 'harness_notification');
  assert.deepEqual(result.hookOutput, {});
  assert.equal(protocolBodies().length, 0);
});

test('Stop: the delivery reminder waits until background subagents finish (MCP = CLI)', async () => {
  const reason = 'Objective coo:900.abcd is still executing and has not been delivered.';
  const recorded = fixturePayload('subagent-stop-background.json');
  const first = recorded.firstStop as Payload;
  const final = recorded.finalStop as Payload;

  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const scope = makeScope();
  seedAttach(scope);
  const env = baseEnv(scope, launchEnv);
  assert.deepEqual(
    await callHookTool(
      env,
      'overlord_hook_stop',
      templated(withCwd(first, scope.workspace), STOP_FIELDS)
    ),
    {}
  );
  assert.equal(backend.requests.length, 0, 'no reminder while a subagent runs');

  const cli = await runCli(
    ['protocol', 'hook-event', '--agent', 'claude', '--hook-type', 'Stop', '--payload-file', '-'],
    { stdin: JSON.stringify(withCwd(first, scope.workspace)), env, cwd: scope.workspace }
  );
  assert.equal(cli.code, 0, cli.stderr);
  assert.equal(
    (JSON.parse(cli.stdout) as Record<string, unknown>).skipped,
    'background_tasks_running'
  );
  assert.equal(backend.requests.length, 0);

  // The later Stop, after the task notification, reminds.
  assert.deepEqual(
    await callHookTool(
      env,
      'overlord_hook_stop',
      templated(withCwd(final, scope.workspace), STOP_FIELDS)
    ),
    { decision: 'block', reason: `[Overlord] ${reason}` }
  );
});

test('nested session: the inherited launch binding is ignored; its own index entry still binds', async () => {
  const nested = { CLAUDE_PID: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };
  const stop = (cwd: string): Payload => ({
    hook_event_name: 'Stop',
    session_id: 'nested-session',
    cwd,
    stop_hook_active: false,
    background_tasks: []
  });
  const prompt = (cwd: string): Payload => ({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'nested-session',
    cwd,
    prompt: 'Summarize the diff'
  });

  resetBackend();
  backend.stopStatus = { needed: true, reason: 'deliver' };
  backend.input = { id: 'input-1', leaseId: 'lease-in', body: 'meant for the parent' };
  const scope = makeScope();
  seedAttach(scope);
  const env = baseEnv(scope, { ...launchEnv, ...channelEnv, ...nested });
  assert.deepEqual(
    await callHookTool(env, 'overlord_hook_stop', templated(stop(scope.workspace), STOP_FIELDS)),
    {}
  );
  assert.deepEqual(
    await callHookTool(
      env,
      'overlord_hook_user_prompt_submit',
      templated(prompt(scope.workspace), PROMPT_FIELDS)
    ),
    {}
  );
  assert.equal(existsSync(scope.spawnMarker), false, 'nothing spawned for the nested session');
  assert.equal(backend.requests.length, 0);
  assert.notEqual(backend.input, null, "the parent's instruction stays unclaimed");

  // The nested agent attached itself (its own id, its own objective): the index binds it, and the
  // CLI never sees the outer launch mission.
  resetBackend();
  writeIndex(scope, {
    nativeSessionId: 'nested-session',
    missionId: 'coo:901',
    objectiveId: 'coo:901.efgh'
  });
  assert.deepEqual(
    await callHookTool(
      env,
      'overlord_hook_user_prompt_submit',
      templated(prompt(scope.workspace), PROMPT_FIELDS)
    ),
    {}
  );
  const [body] = protocolBodies() as Array<{ flags: Record<string, string> }>;
  assert.equal(body?.flags['--mission-id'], 'coo:901');
});

test('Stop inbox: a headless final Stop polls for a late instruction; interactive does not wait', async () => {
  const stop = (cwd: string): Payload => ({
    hook_event_name: 'Stop',
    session_id: 'session-wait',
    cwd,
    stop_hook_active: false,
    background_tasks: []
  });
  const late = { id: 'input-late', leaseId: 'lease-late', body: 'One more thing' };

  // Headless: the instruction arrives ~2.5 s after the Stop and is still delivered.
  resetBackend();
  const headless = makeScope();
  const timer = setTimeout(() => (backend.input = { ...late }), 2_500);
  const started = Date.now();
  const answer = await callHookTool(
    baseEnv(headless, { ...channelEnv, CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }),
    'overlord_hook_stop',
    templated(stop(headless.workspace), STOP_FIELDS)
  );
  clearTimeout(timer);
  assert.deepEqual(answer, { decision: 'block', reason: late.body });
  assert.ok(Date.now() - started >= 2_000, 'it waited for the late instruction');

  // Interactive: one claim, answered at once; the late instruction stays queued.
  resetBackend();
  const interactive = makeScope();
  const lateTimer = setTimeout(() => (backend.input = { ...late }), 2_500);
  const begun = Date.now();
  const quick = await callHookTool(
    baseEnv(interactive, { ...channelEnv, CLAUDE_CODE_ENTRYPOINT: 'cli' }),
    'overlord_hook_stop',
    templated(stop(interactive.workspace), STOP_FIELDS)
  );
  clearTimeout(lateTimer);
  assert.deepEqual(quick, {});
  assert.ok(Date.now() - begun < 2_500, 'interactive Stop does not wait');
  assert.equal(
    backend.requests.filter(r => r.path.endsWith('/inputs/claim')).length,
    1,
    'one claim'
  );
});

test('Stop timing: the hooks server budget and the plugin timeout cover the CLI wait', () => {
  const shim = renderConnectorMcpShim({ adapterKey: 'claude' });
  const constant = (name: string): number => {
    const match = new RegExp(`const ${name} = ([0-9_]+);`).exec(shim);
    assert.ok(match, `${name} is declared in the hooks server`);
    return Number(match[1]?.replaceAll('_', ''));
  };
  const wait = constant('HOOK_HEADLESS_STOP_WAIT_MS');
  assert.equal(wait, CLAUDE_HEADLESS_STOP_WAIT_MS, 'the server sizes its budget to the CLI wait');
  const inboxBudget = constant('HOOK_STOP_INBOX_BUDGET_MS');
  const reminderBudget = constant('HOOK_STOP_STEP_BUDGET_MS');
  // Claim, emitted and acknowledged are each bounded at 5 s by the channel client.
  assert.ok(inboxBudget > 15_000, 'the inbox step outlasts the CLI after the wait');

  const hooks = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'connectors', 'adapters', 'claude', 'hooks', 'hooks.json'),
      'utf8'
    )
  ) as { hooks: Record<string, Array<{ hooks: Array<{ timeout: number; input: Payload }> }>> };
  const stopHook = hooks.hooks.Stop?.[0]?.hooks[0];
  assert.ok(stopHook);
  assert.equal(stopHook.input.background_tasks, '${background_tasks}');
  assert.ok(
    stopHook.timeout * 1_000 >= wait + inboxBudget + reminderBudget + 10_000,
    `Stop timeout ${stopHook.timeout}s leaves at least 10 s of margin`
  );
});
