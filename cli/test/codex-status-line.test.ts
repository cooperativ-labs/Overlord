/**
 * Codex status line (`terminal.statusSurface`, coo:1325.fx4f).
 *
 * Codex 0.171 renders an MCP statusline provider in its TUI footer: a tool whose
 * `_meta["openai/ui"].entrypoints` names a `statusline` resource, read with `resources/read` and
 * the displayed thread's state in `params._meta["com.openai/codex-statusline-state"]`. The
 * Overlord Codex plugin's MCP shim is that provider; the Overlord segment comes from the shared
 * `ovld status-line --agent codex --ui-tree` command.
 *
 * These tests drive the real rendered shim over NDJSON stdio (with the real built CLI, and with
 * stub `ovld` binaries for the slow and failing paths) and the setup opt-in that selects it.
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
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';
import { parse } from 'smol-toml';

import {
  indexThreadForStatusLine,
  unindexThreadForStatusLine
} from '../src/agent-session/codex-app-server/index.ts';
import {
  CODEX_STATUS_LINE_FEATURE,
  CODEX_STATUS_LINE_SERVER,
  CODEX_STATUS_LINE_TOOL,
  configureCodexStatusLine,
  inspectCodexStatusLine
} from '../src/codex-status-line.ts';
import { renderConnectorMcpShim } from '../src/connector-core-render.ts';
import { harnessNativeSession, writeNativeSessionIndex } from '../src/hook-binding.ts';
import {
  buildStatusLineView,
  readStatusLinePayload,
  renderStatusLineUiTree,
  resolveStatusLineBinding,
  runStatusLine,
  type StatusLineSnapshot,
  writeStatusLineSnapshot
} from '../src/status-line.ts';

const cliRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(cliRoot, '..');
const cliEntry = path.join(cliRoot, 'bin', 'ovld.mjs');
const codexFixtures = path.join(repoRoot, 'connectors', 'adapters', 'codex', 'fixtures');

const THREAD = '01a1fb0e-f2ae-7191-973b-836eea97f063';
/** The built-in items the provider keeps, from the recorded state. */
const BUILT_IN = ['GPT-6.2-Sol low', '·', 'Overlord', '·', '97% context left'];
const STATE_META = 'com.openai/codex-statusline-state';

/** The recorded Codex statusline state (fixtures/status-line-state.json). */
function codexState(threadId = THREAD): Record<string, unknown> {
  const fixture = JSON.parse(
    readFileSync(path.join(codexFixtures, 'status-line-state.json'), 'utf8')
  ) as { payload: Record<string, unknown> };
  const state = structuredClone(fixture.payload);
  (state.thread as Record<string, unknown>).id = threadId;
  return state;
}

function snapshot(overrides: Partial<StatusLineSnapshot> = {}): StatusLineSnapshot {
  return {
    schemaVersion: 1,
    missionId: 'coo:12',
    objectiveId: 'coo:12.ab12',
    mission: { displayId: 'coo:12', title: 'Ship the status line', statusType: 'execute' },
    objective: { displayId: 'coo:12.ab12', title: 'Wire Codex', state: 'executing' },
    openRequests: { question: 0, permission: 0 },
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

function withOvldHome<T>(home: string, run: () => T): T {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = home;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

/** Every string leaf of a UI tree, in order. */
function leaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  return ((node as { children?: unknown[] }).children ?? []).flatMap(leaves);
}

// ---------------------------------------------------------------- the shared command

test('the Codex statusline state binds by its displayed thread id', () => {
  const payload = readStatusLinePayload(JSON.stringify(codexState()));
  assert.equal(payload.nativeSessionId, THREAD);
  assert.equal(payload.workingDirectory, '/Users/dev/Overlord');
  // Claude's shape still wins where both could apply.
  assert.equal(
    readStatusLinePayload(JSON.stringify({ session_id: 'claude-id', thread: { id: THREAD } }))
      .nativeSessionId,
    'claude-id'
  );
});

test('the UI tree is the same segment as the text line, with state colors', () => {
  const binding = { missionId: 'coo:12', objectiveId: 'coo:12.ab12', source: 'env' as const };
  const tree = renderStatusLineUiTree(buildStatusLineView({ binding, snapshot: snapshot() }));
  assert.deepEqual(leaves(tree), [
    'ovld',
    'coo:12',
    'Ship the status line',
    '›',
    'ab12',
    'Wire Codex'
  ]);
  assert.deepEqual((tree as { type: string; props: unknown }).props, { gap: 1, wrap: 'nowrap' });

  const blocked = renderStatusLineUiTree(
    buildStatusLineView({
      binding,
      snapshot: snapshot({ openRequests: { question: 1, permission: 0 } })
    })
  ) as { children: Array<{ props?: { color?: string }; children?: unknown[] }> };
  const last = blocked.children.at(-1);
  assert.deepEqual(last, {
    type: 'text',
    props: { color: 'yellow' },
    children: ['awaiting answer']
  });

  // Long titles are cut to their share, identifiers never are.
  const long = renderStatusLineUiTree(
    buildStatusLineView({
      binding,
      snapshot: snapshot({
        mission: { displayId: 'coo:12', title: 'M'.repeat(200), statusType: 'execute' },
        objective: { displayId: 'coo:12.ab12', title: 'O'.repeat(200), state: 'executing' }
      })
    })
  );
  const text = leaves(long);
  assert.equal([...text[2]!].length, 32);
  assert.equal([...text[5]!].length, 48);
  assert.equal(text[1], 'coo:12');
});

test('an unbound thread answers a null tree and touches nothing', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-codex-sl-'));
  withOvldHome(home, () => {
    let spawned = 0;
    const result = runStatusLine({
      agent: 'codex',
      payloadRaw: null,
      nativeSessionId: THREAD,
      format: 'ui-tree',
      env: {},
      spawnRefresh: () => (spawned += 1)
    });
    assert.equal(result.stdout, 'null\n');
    assert.equal(spawned, 0);
    assert.equal(existsSync(path.join(home, 'status-line')), false);
  });
});

test('Codex attach indexes its root session, the id hooks and the status line read', () => {
  // fixtures/shell-session-env.json: on a root thread both ids are the thread id.
  assert.deepEqual(harnessNativeSession({ CODEX_SESSION_ID: THREAD, CODEX_THREAD_ID: THREAD }), {
    agent: 'codex',
    nativeSessionId: THREAD
  });
  // Inside a subagent the root session is indexed, as hooks report it.
  assert.deepEqual(harnessNativeSession({ CODEX_SESSION_ID: THREAD, CODEX_THREAD_ID: 'child' }), {
    agent: 'codex',
    nativeSessionId: THREAD
  });
  // Claude keeps precedence, so an inherited Codex id never changes a Claude binding.
  assert.deepEqual(
    harnessNativeSession({ CLAUDE_CODE_SESSION_ID: 'claude-id', CODEX_SESSION_ID: THREAD }),
    { agent: 'claude', nativeSessionId: 'claude-id' }
  );
  assert.equal(harnessNativeSession({}), null);
});

test('an app-server session indexes its thread for the status line while it runs', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-codex-sl-'));
  withOvldHome(home, () => {
    const state = { cwd: '/repo', missionId: 'coo:12', objectiveId: 'coo:12.ab12' };
    indexThreadForStatusLine(state, THREAD);
    // The provider runs in the server's allowlisted environment: no launch binding at all.
    assert.deepEqual(
      resolveStatusLineBinding({ agent: 'codex', nativeSessionId: THREAD, env: {} }),
      {
        missionId: 'coo:12',
        objectiveId: 'coo:12.ab12',
        source: 'native-session-index'
      }
    );
    // An entry a later attach re-pointed at another objective is not this session's to remove.
    unindexThreadForStatusLine({ ...state, objectiveId: 'coo:12.zz99' }, THREAD);
    assert.ok(resolveStatusLineBinding({ agent: 'codex', nativeSessionId: THREAD, env: {} }));
    unindexThreadForStatusLine(state, THREAD);
    assert.equal(
      resolveStatusLineBinding({ agent: 'codex', nativeSessionId: THREAD, env: {} }),
      null
    );

    // A session without an objective (run by hand) indexes nothing.
    indexThreadForStatusLine({ cwd: '/repo', missionId: null, objectiveId: null }, THREAD);
    assert.equal(
      resolveStatusLineBinding({ agent: 'codex', nativeSessionId: THREAD, env: {} }),
      null
    );
  });
});

// ---------------------------------------------------------------- the MCP shim provider

type McpSession = {
  request: (method: string, params?: unknown) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
};

function openShim(shimPath: string, env: NodeJS.ProcessEnv): McpSession {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [shimPath], {
    env,
    cwd: repoRoot
  });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data: string) => {
    buffered += data;
    let newline = buffered.indexOf('\n');
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      pending.get(message.id as number)?.(message);
      pending.delete(message.id as number);
    }
  });
  let nextId = 1;
  return {
    request: (method, params) =>
      new Promise(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    close: async () => {
      child.stdin.end();
      child.kill();
      await new Promise(resolve => child.on('close', resolve));
    }
  };
}

const STRIPPED_ENV = /^(OVERLORD_|OVLD_|MISSION_ID$|SESSION_KEY$|CLAUDE_CODE_SESSION_ID$|CODEX_)/;

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

/** An `ovld` stand-in: logs its argv, then runs `body` (a shell snippet). */
function stubOvld(body: string): { bin: string; log: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-codex-sl-bin-'));
  const bin = path.join(dir, 'ovld');
  const log = path.join(dir, 'argv.log');
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n${body}\n`);
  chmodSync(bin, 0o755);
  return { bin, log };
}

function spawnCount(log: string): number {
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

async function readFooter(
  shim: McpSession,
  state: Record<string, unknown> = codexState()
): Promise<{ tree: unknown; ms: number; response: Record<string, unknown> }> {
  const started = Date.now();
  const response = await shim.request('resources/read', {
    uri: 'ui://overlord/status-line',
    _meta: { [STATE_META]: state }
  });
  const ms = Date.now() - started;
  const contents = (response.result as { contents: Array<Record<string, unknown>> }).contents;
  assert.equal(contents.length, 1);
  assert.equal(contents[0]?.uri, 'ui://overlord/status-line');
  assert.equal(contents[0]?.mimeType, 'application/json');
  return { tree: JSON.parse(contents[0]?.text as string), ms, response };
}

let codexShim = '';
let claudeShim = '';

before(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-codex-sl-shim-'));
  codexShim = path.join(dir, 'codex-overlord-mcp.mjs');
  claudeShim = path.join(dir, 'claude-overlord-mcp.mjs');
  writeFileSync(codexShim, renderConnectorMcpShim({ adapterKey: 'codex' }));
  writeFileSync(claudeShim, renderConnectorMcpShim({ adapterKey: 'claude' }));
});

test('the Codex shim advertises exactly one statusline entrypoint and a resource', async () => {
  const { bin } = stubOvld('echo null');
  const shim = openShim(codexShim, cleanEnv({ OVLD_BIN: bin }));
  try {
    const init = await shim.request('initialize', { protocolVersion: '2025-06-18' });
    const capabilities = (init.result as { capabilities: Record<string, unknown> }).capabilities;
    assert.ok(capabilities.resources, 'resources capability is declared');

    const listed = await shim.request('tools/list');
    const tools = (listed.result as { tools: Array<Record<string, unknown>> }).tools;
    const providers = tools.filter(tool => {
      const entrypoints = (tool._meta as Record<string, { entrypoints?: unknown[] }> | undefined)?.[
        'openai/ui'
      ]?.entrypoints;
      return Array.isArray(entrypoints);
    });
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.name, CODEX_STATUS_LINE_TOOL);
    assert.equal(providers[0]?.title, 'Overlord mission');
    assert.deepEqual((providers[0]?._meta as Record<string, unknown>)['openai/ui'], {
      entrypoints: [{ type: 'statusline', resourceUri: 'ui://overlord/status-line' }]
    });

    const resources = await shim.request('resources/list');
    assert.deepEqual(
      (resources.result as { resources: Array<{ uri: string }> }).resources.map(r => r.uri),
      ['ui://overlord/status-line']
    );

    const unknown = await shim.request('resources/read', { uri: 'ui://other/thing' });
    assert.equal((unknown.error as { code: number }).code, -32002);

    const called = await shim.request('tools/call', {
      name: CODEX_STATUS_LINE_TOOL,
      arguments: {}
    });
    assert.match(JSON.stringify(called.result), /\/statusline/);
  } finally {
    await shim.close();
  }
});

test('other adapters do not get the provider', async () => {
  const shim = openShim(claudeShim, cleanEnv({}));
  try {
    const init = await shim.request('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(
      (init.result as { capabilities: Record<string, unknown> }).capabilities.resources,
      undefined
    );
    const listed = await shim.request('tools/list');
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map(t => t.name);
    assert.equal(names.includes(CODEX_STATUS_LINE_TOOL), false);
    const read = await shim.request('resources/read', { uri: 'ui://overlord/status-line' });
    assert.equal((read.error as { code: number }).code, -32601);
  } finally {
    await shim.close();
  }
});

test('a bound thread shows the built-in items and the mission, through the real CLI', async () => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-codex-sl-home-')));
  withOvldHome(home, () => {
    writeNativeSessionIndex({
      agent: 'codex',
      nativeSessionId: THREAD,
      workingDirectory: '/Users/dev/Overlord',
      missionId: 'coo:12',
      objectiveId: 'coo:12.ab12'
    });
    writeStatusLineSnapshot(snapshot({ openRequests: { question: 0, permission: 1 } }));
  });
  const { bin } = stubOvld(
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliEntry)} "$@"`
  );
  const shim = openShim(codexShim, cleanEnv({ OVLD_BIN: bin, OVLD_HOME: home, HOME: home }));
  try {
    // The first read may beat the CLI's cold start; the footer never waits past the budget.
    let footer = await readFooter(shim);
    assert.ok(footer.ms < 1_000, `read took ${footer.ms} ms`);
    for (let attempt = 0; attempt < 20 && !leaves(footer.tree).includes('coo:12'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      footer = await readFooter(shim);
    }
    assert.deepEqual(leaves(footer.tree), [
      ...BUILT_IN,
      '·',
      'ovld',
      'coo:12',
      'Ship the status line',
      '›',
      'ab12',
      'Wire Codex',
      '·',
      'awaiting approval'
    ]);
    // Another thread in the same Codex is not bound: built-in items only.
    const other = await readFooter(shim, codexState('01a1fb0e-0000-7000-8000-000000000000'));
    let otherTree = other.tree;
    for (let attempt = 0; attempt < 20 && leaves(otherTree).length === 0; attempt += 1) {
      otherTree = (await readFooter(shim, codexState('01a1fb0e-0000-7000-8000-000000000000'))).tree;
    }
    assert.deepEqual(leaves(otherTree), BUILT_IN);
  } finally {
    await shim.close();
  }
});

test('the segment is cached per thread, so polling every second spawns rarely', async () => {
  const { bin, log } = stubOvld(
    `echo '{"type":"row","props":{"gap":1},"children":["ovld","coo:1"]}'`
  );
  const shim = openShim(codexShim, cleanEnv({ OVLD_BIN: bin }));
  try {
    for (let read = 0; read < 5; read += 1) {
      const { tree } = await readFooter(shim);
      assert.deepEqual(leaves(tree).slice(-2), ['ovld', 'coo:1']);
    }
    assert.equal(spawnCount(log), 1);
    assert.match(readFileSync(log, 'utf8'), new RegExp(`--ui-tree --native-session-id ${THREAD}`));
  } finally {
    await shim.close();
  }
});

test('a slow or failing ovld never fails or stalls a read', async () => {
  const slow = stubOvld('sleep 3; echo null');
  let shim = openShim(codexShim, cleanEnv({ OVLD_BIN: slow.bin }));
  try {
    const footer = await readFooter(shim);
    assert.ok(footer.ms < 1_000, `read took ${footer.ms} ms`);
    assert.deepEqual(leaves(footer.tree), BUILT_IN);
    // A read while the first command still runs does not start a second one.
    await readFooter(shim);
    assert.equal(spawnCount(slow.log), 1);
  } finally {
    await shim.close();
  }

  const broken = stubOvld('echo "not json"; exit 3');
  shim = openShim(codexShim, cleanEnv({ OVLD_BIN: broken.bin }));
  try {
    const footer = await readFooter(shim);
    assert.equal(footer.response.error, undefined);
    assert.deepEqual(leaves(footer.tree), BUILT_IN);
    // Garbage state still answers, with nothing to show.
    const empty = await shim.request('resources/read', {
      uri: 'ui://overlord/status-line',
      _meta: { [STATE_META]: 'garbage' }
    });
    assert.equal((empty.result as { contents: Array<{ text: string }> }).contents[0]?.text, 'null');
  } finally {
    await shim.close();
  }

  const missing = cleanEnv({ OVLD_BIN: path.join(tmpdir(), 'no-such-ovld-binary') });
  shim = openShim(codexShim, missing);
  try {
    const footer = await readFooter(shim);
    assert.deepEqual(leaves(footer.tree), BUILT_IN);
  } finally {
    await shim.close();
  }
});

// ---------------------------------------------------------------- setup opt-in

function codexHome(config?: string): string {
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-codex-home-'));
  if (config !== undefined) writeFileSync(path.join(home, 'config.toml'), config);
  return home;
}

function readConfig(home: string): Record<string, Record<string, unknown>> {
  return parse(readFileSync(path.join(home, 'config.toml'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
}

test('setup turns the feature on and selects the provider, keeping the rest of the config', () => {
  const home = codexHome(
    'model = "gpt-5.5"\n\n[features]\njs_repl = false\n\n[tui]\nstatus_line = ["model"]\n'
  );
  const result = configureCodexStatusLine({ codexHome: home, codexVersion: '0.171.0' });
  assert.equal(result.status, 'installed');
  const config = readConfig(home);
  assert.equal(config.model as unknown, 'gpt-5.5');
  assert.equal(config.features?.js_repl, false);
  assert.equal(config.features?.[CODEX_STATUS_LINE_FEATURE], true);
  assert.deepEqual(config.tui?.status_line, ['model']);
  assert.deepEqual(config.tui?.status_line_provider, {
    server: CODEX_STATUS_LINE_SERVER,
    tool: CODEX_STATUS_LINE_TOOL
  });
  assert.equal(inspectCodexStatusLine(path.join(home, 'config.toml')).state, 'overlord');

  const again = configureCodexStatusLine({ codexHome: home, codexVersion: '0.171.0' });
  assert.equal(again.status, 'unchanged');
});

test('setup creates the config when Codex has none, and dry-run writes nothing', () => {
  const dry = codexHome();
  assert.equal(
    configureCodexStatusLine({ codexHome: dry, codexVersion: '0.171.0', dryRun: true }).status,
    'would-install'
  );
  assert.equal(existsSync(path.join(dry, 'config.toml')), false);

  const fresh = codexHome();
  assert.equal(
    configureCodexStatusLine({ codexHome: fresh, codexVersion: '0.171.0' }).status,
    'installed'
  );
  assert.equal(readConfig(fresh).features?.[CODEX_STATUS_LINE_FEATURE], true);
});

test("setup never replaces the person's own status line selection or an explicit off", () => {
  const ownProvider = '[tui]\nstatus_line_provider = { server = "mine", tool = "footer" }\n';
  const own = codexHome(ownProvider);
  const kept = configureCodexStatusLine({ codexHome: own, codexVersion: '0.171.0' });
  assert.equal(kept.status, 'kept-existing');
  assert.equal(readFileSync(path.join(own, 'config.toml'), 'utf8'), ownProvider);
  assert.match(kept.message, /\/statusline/);

  const builtin = codexHome('[tui]\nstatus_line_provider = "default"\n');
  assert.equal(
    configureCodexStatusLine({ codexHome: builtin, codexVersion: '0.171.0' }).status,
    'kept-existing'
  );

  const offText = `[features]\n${CODEX_STATUS_LINE_FEATURE} = false\n`;
  const off = codexHome(offText);
  assert.equal(
    configureCodexStatusLine({ codexHome: off, codexVersion: '0.171.0' }).status,
    'feature-disabled'
  );
  assert.equal(readFileSync(path.join(off, 'config.toml'), 'utf8'), offText);
});

test('setup leaves unreadable or uneditable config untouched', () => {
  const broken = codexHome('this is = = not toml');
  assert.equal(
    configureCodexStatusLine({ codexHome: broken, codexVersion: '0.171.0' }).status,
    'unreadable'
  );
  assert.equal(readFileSync(path.join(broken, 'config.toml'), 'utf8'), 'this is = = not toml');

  // Dotted top-level keys cannot gain a later [tui] table; the merge refuses instead.
  const dottedText = 'tui.status_line = ["model"]\n';
  const dotted = codexHome(dottedText);
  const result = configureCodexStatusLine({ codexHome: dotted, codexVersion: '0.171.0' });
  assert.equal(result.status, 'unreadable');
  assert.match(result.message, /status_line_provider = \{ server = "overlord"/);
  assert.equal(readFileSync(path.join(dotted, 'config.toml'), 'utf8'), dottedText);
});

test('setup on an older Codex still writes the selection and says it needs 0.171', () => {
  const home = codexHome();
  const result = configureCodexStatusLine({ codexHome: home, codexVersion: '0.170.0' });
  assert.equal(result.status, 'installed');
  assert.match(result.message, /Codex 0\.170\.0 cannot show it yet/);
  assert.match(result.message, /0\.171\.0/);
});
