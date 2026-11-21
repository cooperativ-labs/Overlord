import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLAUDE_STATUS_LINE_COMMAND,
  configureClaudeStatusLine,
  inspectClaudeStatusLine
} from '../src/claude-status-line.ts';
import { writeNativeSessionIndex } from '../src/hook-binding.ts';
import {
  buildStatusLineView,
  readStatusLinePayload,
  readStatusLineSnapshot,
  refreshStatusLineSnapshot,
  renderStatusLine,
  resolveStatusLineBinding,
  runStatusLine,
  STATUS_LINE_FRESH_MS,
  type StatusLineBinding,
  type StatusLineSnapshot,
  statusLineSnapshotPath,
  writeStatusLineSnapshot
} from '../src/status-line.ts';

const cliRoot = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const SESSION = '131fb042-ffe6-4876-9e5d-72b0ede9819c';

/** The payload Claude Code 2.1.329 piped to a status line command (trimmed). */
function claudePayload(sessionId = SESSION): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: `/home/user/.claude/projects/repo/${sessionId}.jsonl`,
    cwd: '/repo',
    model: { id: 'claude-haiku-5-5', display_name: 'Haiku 5.5' },
    workspace: { current_dir: '/repo', project_dir: '/repo', added_dirs: [] },
    version: '2.1.329'
  });
}

function withTempHome(run: (home: string) => void | Promise<void>): Promise<void> {
  const previous = process.env.OVLD_HOME;
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-status-line-'));
  process.env.OVLD_HOME = home;
  return Promise.resolve()
    .then(() => run(home))
    .finally(() => {
      if (previous === undefined) delete process.env.OVLD_HOME;
      else process.env.OVLD_HOME = previous;
    });
}

function snapshot(overrides: Partial<StatusLineSnapshot> = {}): StatusLineSnapshot {
  return {
    schemaVersion: 1,
    missionId: 'coo:12',
    objectiveId: 'coo:12.ab12',
    mission: { displayId: 'coo:12', title: 'Ship the status line', statusType: 'execute' },
    objective: { displayId: 'coo:12.ab12', title: 'Wire Claude', state: 'executing' },
    openRequests: { question: 0, permission: 0 },
    fetchedAt: new Date(NOW).toISOString(),
    ...overrides
  };
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

const launchEnv = { OVERLORD_MISSION_ID: 'coo:12', OVERLORD_OBJECTIVE_ID: 'coo:12.ab12' };

test('an unbound session prints nothing, reads no cache and starts no refresh', async () => {
  await withTempHome(home => {
    const spawned: StatusLineBinding[] = [];
    const result = runStatusLine({
      agent: 'claude',
      payloadRaw: claudePayload(),
      env: {},
      now: NOW,
      spawnRefresh: binding => spawned.push(binding)
    });
    assert.equal(result.stdout, '');
    assert.equal(result.view.bound, false);
    assert.deepEqual(spawned, []);
    assert.equal(existsSync(path.join(home, 'status-line')), false);
  });
});

test('the working directory never selects a binding', async () => {
  await withTempHome(() => {
    writeNativeSessionIndex({
      agent: 'claude',
      nativeSessionId: 'another-conversation',
      workingDirectory: '/repo',
      missionId: 'coo:12',
      objectiveId: 'coo:12.ab12'
    });
    const binding = resolveStatusLineBinding({
      agent: 'claude',
      nativeSessionId: SESSION,
      env: {}
    });
    assert.equal(binding, null);
  });
});

test('a launched session shows its identifiers at once and starts one detached refresh', async () => {
  await withTempHome(() => {
    const spawned: StatusLineBinding[] = [];
    const run = () =>
      runStatusLine({
        agent: 'claude',
        payloadRaw: claudePayload(),
        env: launchEnv,
        now: NOW,
        color: false,
        spawnRefresh: binding => spawned.push(binding)
      });
    assert.equal(run().stdout, 'ovld coo:12 › ab12\n');
    assert.deepEqual(spawned, [{ missionId: 'coo:12', objectiveId: 'coo:12.ab12', source: 'env' }]);
    // The refresh lock stops a stampede from runs that follow before the refresh lands.
    run();
    assert.equal(spawned.length, 1);
  });
});

test('a stale refresh lock is reclaimed', async () => {
  await withTempHome(home => {
    const spawned: StatusLineBinding[] = [];
    const run = (now: number) =>
      runStatusLine({
        agent: 'claude',
        payloadRaw: claudePayload(),
        env: launchEnv,
        now,
        spawnRefresh: binding => spawned.push(binding)
      });
    run(NOW);
    const lock = readdirSync(path.join(home, 'status-line')).find(name =>
      name.endsWith('.refresh')
    );
    assert.ok(lock);
    const lockPath = path.join(home, 'status-line', lock);
    const old = (NOW - 60_000) / 1000;
    utimesSync(lockPath, old, old);
    run(NOW);
    assert.equal(spawned.length, 2);
  });
});

test('the native-session index written by attach wins over the launch environment', async () => {
  await withTempHome(() => {
    writeNativeSessionIndex({
      agent: 'claude',
      nativeSessionId: SESSION,
      workingDirectory: '/repo',
      missionId: 'coo:99',
      objectiveId: 'coo:99.zz99'
    });
    const binding = resolveStatusLineBinding({
      agent: 'claude',
      nativeSessionId: SESSION,
      env: launchEnv
    });
    assert.deepEqual(binding, {
      missionId: 'coo:99',
      objectiveId: 'coo:99.zz99',
      source: 'native-session-index'
    });
    // Another harness's index entry under the same id is not this session's binding.
    assert.equal(
      resolveStatusLineBinding({ agent: 'codex', nativeSessionId: SESSION, env: {} }),
      null
    );
  });
});

test('a fresh snapshot renders titles and starts no refresh', async () => {
  await withTempHome(() => {
    writeStatusLineSnapshot(snapshot());
    const spawned: StatusLineBinding[] = [];
    const result = runStatusLine({
      agent: 'claude',
      payloadRaw: claudePayload(),
      env: launchEnv,
      now: NOW + 1_000,
      color: false,
      columns: 120,
      spawnRefresh: binding => spawned.push(binding)
    });
    assert.equal(result.stdout, 'ovld coo:12 Ship the status line › ab12 Wire Claude\n');
    assert.equal(result.view.stale, false);
    assert.deepEqual(spawned, []);
  });
});

test('a stale snapshot still renders and asks for a refresh', async () => {
  await withTempHome(() => {
    writeStatusLineSnapshot(snapshot());
    const spawned: StatusLineBinding[] = [];
    const result = runStatusLine({
      agent: 'claude',
      payloadRaw: claudePayload(),
      env: launchEnv,
      now: NOW + STATUS_LINE_FRESH_MS,
      color: false,
      spawnRefresh: binding => spawned.push(binding)
    });
    assert.match(result.stdout, /Wire Claude/);
    assert.equal(spawned.length, 1);
  });
});

test('blocked and awaiting-answer states are shown, most specific first', () => {
  const binding: StatusLineBinding = {
    missionId: 'coo:12',
    objectiveId: 'coo:12.ab12',
    source: 'env'
  };
  const render = (overrides: Partial<StatusLineSnapshot>) =>
    renderStatusLine({
      view: buildStatusLineView({ binding, snapshot: snapshot(overrides), now: NOW }),
      columns: 200,
      color: false
    });
  const blocked = { displayId: 'coo:12', title: 'Ship', statusType: 'blocked' };
  assert.match(
    render({ mission: blocked, openRequests: { question: 1, permission: 1 } }),
    / · awaiting answer$/
  );
  assert.match(
    render({ mission: blocked, openRequests: { question: 0, permission: 2 } }),
    / · awaiting approval$/
  );
  assert.match(render({ mission: blocked }), / · blocked$/);
  assert.match(
    render({ objective: { displayId: 'coo:12.ab12', title: 'Wire', state: 'pending_delivery' } }),
    / · delivered$/
  );
  assert.doesNotMatch(render({}), / · /);
});

test('the line fits the terminal width and keeps identifiers whole', () => {
  const view = buildStatusLineView({
    binding: { missionId: 'coo:1323', objectiveId: 'coo:1323.dsnh', source: 'env' },
    snapshot: snapshot({
      missionId: 'coo:1323',
      objectiveId: 'coo:1323.dsnh',
      mission: {
        displayId: 'coo:1323',
        title: 'Replace Claude plugin shell hooks with mcp_tool hooks',
        statusType: 'blocked'
      },
      objective: {
        displayId: 'coo:1323.dsnh',
        title: 'Claude status line (mission/objective) with a much longer title than fits',
        state: 'executing'
      }
    }),
    now: NOW
  });
  for (const columns of [40, 60, 80, 120]) {
    const line = stripAnsi(renderStatusLine({ view, columns, color: true }));
    assert.ok(line.length <= columns, `${columns}: ${line}`);
    assert.match(line, /^ovld coo:1323 /);
    assert.match(line, / › dsnh/);
    assert.match(line, / · blocked$/);
  }
  const colored = renderStatusLine({ view, columns: 120, color: true });
  assert.ok(colored.includes('\u001b[31mblocked\u001b[0m'));
});

test('NO_COLOR turns colors off', async () => {
  await withTempHome(() => {
    writeStatusLineSnapshot(snapshot());
    const result = runStatusLine({
      agent: 'claude',
      payloadRaw: claudePayload(),
      env: { ...launchEnv, NO_COLOR: '1', COLUMNS: '100' },
      now: NOW,
      spawnRefresh: () => undefined
    });
    assert.equal(result.stdout, stripAnsi(result.stdout));
  });
});

test('json output reports the computed view', async () => {
  await withTempHome(() => {
    writeStatusLineSnapshot(snapshot({ openRequests: { question: 1, permission: 0 } }));
    const result = runStatusLine({
      agent: 'claude',
      payloadRaw: claudePayload(),
      env: launchEnv,
      format: 'json',
      now: NOW,
      spawnRefresh: () => undefined
    });
    const view = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(view.bound, true);
    assert.equal(view.state, 'awaiting-answer');
    assert.equal(view.objectiveTitle, 'Wire Claude');
  });
});

test('payload parsing tolerates garbage and reads the native id and cwd', () => {
  assert.deepEqual(readStatusLinePayload(claudePayload()), {
    nativeSessionId: SESSION,
    workingDirectory: '/repo'
  });
  assert.deepEqual(readStatusLinePayload('not json'), {
    nativeSessionId: null,
    workingDirectory: null
  });
  assert.deepEqual(readStatusLinePayload(null), { nativeSessionId: null, workingDirectory: null });
});

test('refresh reads mission, objectives and open requests without side-effecting routes', async () => {
  await withTempHome(async () => {
    const paths: string[] = [];
    const backend = {
      get: async <T>(requestPath: string): Promise<T> => {
        paths.push(requestPath);
        if (requestPath.startsWith('/api/missions/search')) {
          return {
            missions: [
              { id: 'm-uuid', displayId: 'coo:12', title: 'Ship it', statusType: 'blocked' }
            ]
          } as T;
        }
        if (requestPath.endsWith('/objectives')) {
          return [
            { id: 'o-other', displayId: 'coo:12.zz99', title: 'Other', state: 'draft' },
            { id: 'o-uuid', displayId: 'coo:12.ab12', title: 'Wire  Claude', state: 'executing' }
          ] as T;
        }
        return {
          requests: [
            { kind: 'question', status: 'open' },
            { kind: 'permission', status: 'open' },
            { kind: 'permission', status: 'resolved' }
          ]
        } as T;
      }
    };
    const result = await refreshStatusLineSnapshot({
      backend,
      missionId: 'coo:12',
      objectiveId: 'coo:12.ab12',
      now: () => new Date(NOW)
    });
    assert.deepEqual(paths.sort(), [
      '/api/agent-requests?missionId=coo%3A12&status=open&limit=50&objectiveId=coo%3A12.ab12',
      '/api/missions/coo%3A12/objectives',
      '/api/missions/search?q=coo%3A12&limit=5'
    ]);
    // GET /api/missions/:id marks the blocking question seen, so it is never read.
    assert.ok(!paths.some(requestPath => /^\/api\/missions\/[^/?]+$/.test(requestPath)));
    assert.deepEqual(result.mission, {
      displayId: 'coo:12',
      title: 'Ship it',
      statusType: 'blocked'
    });
    assert.deepEqual(result.objective, {
      displayId: 'coo:12.ab12',
      title: 'Wire Claude',
      state: 'executing'
    });
    assert.deepEqual(result.openRequests, { question: 1, permission: 1 });
    assert.deepEqual(readStatusLineSnapshot('coo:12', 'coo:12.ab12'), result);
    const mode = statSync(statusLineSnapshotPath('coo:12', 'coo:12.ab12')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

test('a failed read keeps the previous value instead of blanking it', async () => {
  await withTempHome(async () => {
    writeStatusLineSnapshot(snapshot());
    const backend = {
      get: async <T>(requestPath: string): Promise<T> => {
        if (requestPath.startsWith('/api/agent-requests')) return { requests: [] } as T;
        throw new Error('backend down');
      }
    };
    const result = await refreshStatusLineSnapshot({
      backend,
      missionId: 'coo:12',
      objectiveId: 'coo:12.ab12',
      now: () => new Date(NOW + 60_000)
    });
    assert.equal(result.mission?.title, 'Ship the status line');
    assert.equal(result.objective?.title, 'Wire Claude');
    assert.equal(result.fetchedAt, new Date(NOW + 60_000).toISOString());
  });
});

test('the built CLI exits 0 silently for an unbound session', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-status-line-cli-'));
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, OVLD_HOME: home };
  const result = spawnSync(
    process.execPath,
    [
      path.join(cliRoot, 'bin', 'ovld.mjs'),
      'status-line',
      '--agent',
      'claude',
      '--payload-file',
      '-'
    ],
    { input: claudePayload(), env, encoding: 'utf8', timeout: 20_000 }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(existsSync(path.join(home, 'status-line')), false);
});

test('the built CLI prints the launch binding from the cache', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-status-line-cli-'));
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = home;
  try {
    writeStatusLineSnapshot(snapshot({ fetchedAt: new Date().toISOString() }));
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    OVLD_HOME: home,
    NO_COLOR: '1',
    COLUMNS: '100',
    ...launchEnv
  };
  const result = spawnSync(
    process.execPath,
    [
      path.join(cliRoot, 'bin', 'ovld.mjs'),
      'status-line',
      '--agent',
      'claude',
      '--payload-file',
      '-'
    ],
    { input: claudePayload(), env, encoding: 'utf8', timeout: 20_000 }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ovld coo:12 Ship the status line › ab12 Wire Claude\n');
});

function tempClaudeDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'ovld-claude-config-'));
}

test('agent-setup adds the status line only when none is configured', () => {
  const configDir = tempClaudeDir();
  const settingsPath = path.join(configDir, 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify({ enabledPlugins: { 'overlord@overlord-local': true }, theme: 'dark' }),
    { mode: 0o644 }
  );

  const dry = configureClaudeStatusLine({ configDir, dryRun: true });
  assert.equal(dry.status, 'would-install');
  assert.equal(inspectClaudeStatusLine(configDir).state, 'none');

  const installed = configureClaudeStatusLine({ configDir });
  assert.equal(installed.status, 'installed');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(settings.statusLine, {
    type: 'command',
    command: CLAUDE_STATUS_LINE_COMMAND,
    padding: 0,
    refreshInterval: 10
  });
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(settings.enabledPlugins, { 'overlord@overlord-local': true });
  assert.equal(statSync(settingsPath).mode & 0o777, 0o644);

  assert.equal(configureClaudeStatusLine({ configDir }).status, 'unchanged');
});

test("agent-setup never replaces the user's own status line", () => {
  const configDir = tempClaudeDir();
  const settingsPath = path.join(configDir, 'settings.json');
  const original = `${JSON.stringify({ statusLine: { type: 'command', command: '~/bin/line.sh' } })}\n`;
  writeFileSync(settingsPath, original);
  const result = configureClaudeStatusLine({ configDir });
  assert.equal(result.status, 'kept-existing');
  assert.equal(result.existingCommand, '~/bin/line.sh');
  assert.match(result.message, /ovld status-line --agent claude --payload-file -/);
  assert.equal(readFileSync(settingsPath, 'utf8'), original);
});

test('agent-setup leaves an unreadable settings file untouched', () => {
  const configDir = tempClaudeDir();
  const settingsPath = path.join(configDir, 'settings.json');
  writeFileSync(settingsPath, '{ not json');
  assert.equal(configureClaudeStatusLine({ configDir }).status, 'unreadable');
  assert.equal(readFileSync(settingsPath, 'utf8'), '{ not json');
});

test('agent-setup creates settings.json when Claude has none yet', () => {
  const configDir = path.join(tempClaudeDir(), '.claude');
  assert.equal(configureClaudeStatusLine({ configDir }).status, 'installed');
  assert.equal(inspectClaudeStatusLine(configDir).state, 'overlord');
});
