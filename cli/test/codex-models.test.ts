import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PINNED_QUERY_METHODS } from '../dist/agent-session/codex-app-server/protocol.js';
import {
  bundledCodexModels,
  checkCodexLaunchSelection,
  type CodexLiveModels,
  codexLiveModelsReportBody,
  createRunnerCodexModelsReporter,
  loadCodexLiveModels,
  parseAccountSummary,
  parseCodexModel,
  parseCodexModelPages,
  parseCodexProviders,
  queryCodexLiveModels,
  readCodexModelsCache,
  writeCodexModelsCache
} from '../dist/codex-models.js';
import { CliError } from '../dist/errors.js';
import { assertCodexLaunchSelection } from '../dist/launch.js';

// Shapes recorded from a live `codex app-server` 0.170.0 (plan §3.7); identifiers are fake.
const MODEL_PAGE_1 = {
  data: [
    {
      id: 'gpt-6.2-sol',
      model: 'gpt-6.2-sol',
      displayName: 'GPT-6.2-Sol',
      description: 'Fast, go-to model for coding and everyday work.',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'max', description: 'Max' },
        { reasoningEffort: 'ultra', description: 'Ultra' }
      ],
      defaultReasoningEffort: 'low',
      inputModalities: ['text', 'image']
    },
    {
      id: 'internal-eval',
      model: 'internal-eval',
      displayName: 'Hidden',
      hidden: true,
      isDefault: false,
      supportedReasoningEfforts: []
    }
  ],
  nextCursor: 'page-2'
};
const MODEL_PAGE_2 = {
  data: [
    {
      id: 'gpt-6-luna',
      model: 'gpt-6-luna',
      displayName: 'GPT-6-Luna',
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: '' },
        { reasoningEffort: 'high', description: '' }
      ],
      defaultReasoningEffort: 'medium'
    }
  ],
  nextCursor: null
};
const PROVIDERS = {
  data: [
    { id: 'openai', name: 'OpenAI', canEdit: false, baseUrl: null, settings: {} },
    {
      id: 'corp',
      name: 'Corp gateway',
      canEdit: true,
      baseUrl: 'https://llm.corp.internal/v1',
      settings: { env_key: 'CORP_KEY' }
    }
  ],
  defaultProviderId: 'openai',
  canChangeDefault: true
};
const ACCOUNT = {
  account: {
    type: 'chatgpt',
    email: 'person@example.com',
    planType: 'pro',
    workspaceName: 'Example Co'
  },
  userId: 'user-123',
  requiresOpenaiAuth: true,
  workspaceRouting: { accountId: 'acct-456' }
};

function live(overrides: Partial<CodexLiveModels> = {}): CodexLiveModels {
  return {
    source: 'live',
    codexVersion: '0.171.0',
    provider: null,
    models: parseCodexModelPages([MODEL_PAGE_1, MODEL_PAGE_2]),
    providers: [{ id: 'openai', name: 'OpenAI' }],
    defaultProviderId: 'openai',
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

/** A stand-in `codex` that answers the one-shot query over stdio, logging what it was asked. */
function fakeCodex(dir: string, { failModelList = false } = {}): { bin: string; log: string } {
  const bin = path.join(dir, 'codex');
  const log = path.join(dir, 'requests.jsonl');
  const responses = {
    initialize: { userAgent: 'codex_cli_rs/0.171.0 (Mac OS; arm64)', platformOs: 'macos' },
    'modelProvider/list': PROVIDERS,
    'account/read': ACCOUNT
  };
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] !== 'app-server') process.exit(2);
const responses = ${JSON.stringify(responses)};
const pages = ${JSON.stringify([MODEL_PAGE_1, MODEL_PAGE_2])};
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(message) + '\\n');
    if (message.id === undefined) continue;
    let reply;
    if (message.method === 'model/list') {
      reply = ${failModelList}
        ? { id: message.id, error: { code: -32600, message: 'not configured', data: { type: 'modelProviderNotConfigured' } } }
        : { id: message.id, result: message.params && message.params.cursor === 'page-2' ? pages[1] : pages[0] };
    } else if (responses[message.method]) {
      reply = { id: message.id, result: responses[message.method] };
    } else {
      reply = { id: message.id, error: { code: -32601, message: 'unknown method' } };
    }
    process.stdout.write(JSON.stringify(reply) + '\\n');
  }
});
`
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

test('the one-shot query surface is the reviewed read-only list', () => {
  assert.deepEqual(
    [...PINNED_QUERY_METHODS],
    ['initialize', 'model/list', 'modelProvider/list', 'account/read']
  );
});

test('parseCodexModel keeps the slug, efforts and a valid default effort; drops hidden models', () => {
  const [sol, luna] = parseCodexModelPages([MODEL_PAGE_1, MODEL_PAGE_2]);
  assert.deepEqual(sol, {
    id: 'gpt-6.2-sol',
    displayName: 'GPT-6.2-Sol',
    description: 'Fast, go-to model for coding and everyday work.',
    reasoningOptions: ['low', 'medium', 'max', 'ultra'],
    defaultReasoningEffort: 'low',
    isDefault: true
  });
  assert.equal(luna?.defaultReasoningEffort, null, 'a default outside the efforts is ignored');
  assert.equal(parseCodexModel(MODEL_PAGE_1.data[1]), null);
  assert.equal(parseCodexModel({ displayName: 'no id' }), null);
});

test('account and provider parsing keep no identifiers or endpoints', () => {
  const account = parseAccountSummary(ACCOUNT);
  assert.deepEqual(account, { type: 'chatgpt', planType: 'pro', requiresOpenaiAuth: true });
  assert.doesNotMatch(JSON.stringify(account), /person@example|user-123|acct-456|Example Co/);
  assert.deepEqual(parseAccountSummary({ account: null, requiresOpenaiAuth: true }), {
    type: null,
    planType: null,
    requiresOpenaiAuth: true
  });
  const providers = parseCodexProviders(PROVIDERS);
  assert.deepEqual(providers, {
    providers: [
      { id: 'openai', name: 'OpenAI' },
      { id: 'corp', name: 'Corp gateway' }
    ],
    defaultProviderId: 'openai'
  });
  assert.doesNotMatch(JSON.stringify(providers), /corp\.internal|CORP_KEY/);
});

test('queryCodexLiveModels asks a stdio app server, follows pages and strips the account', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-models-'));
  try {
    const { bin, log } = fakeCodex(dir);
    const result = await queryCodexLiveModels({
      codexBin: bin,
      cwd: dir,
      includeAccount: true,
      provider: 'openai'
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.live.codexVersion, '0.171.0');
    assert.equal(result.live.provider, 'openai');
    assert.deepEqual(
      result.live.models.map(model => model.id),
      ['gpt-6.2-sol', 'gpt-6-luna']
    );
    assert.equal(result.live.defaultProviderId, 'openai');
    assert.deepEqual(result.account, {
      type: 'chatgpt',
      planType: 'pro',
      requiresOpenaiAuth: true
    });
    assert.doesNotMatch(JSON.stringify(result), /person@example|user-123|acct-456/);

    const { readFileSync } = await import('node:fs');
    const sent = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { method: string; params?: Record<string, unknown> });
    for (const message of sent) {
      assert.ok(
        (PINNED_QUERY_METHODS as readonly string[]).includes(message.method) ||
          message.method === 'initialized',
        `unexpected method ${message.method}`
      );
    }
    const listCalls = sent.filter(message => message.method === 'model/list');
    assert.equal(listCalls.length, 2);
    assert.equal(listCalls[0]?.params?.modelProvider, 'openai');
    assert.equal(listCalls[1]?.params?.cursor, 'page-2');
    assert.equal(
      sent.some(message => message.method === 'thread/start'),
      false
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queryCodexLiveModels reports failures instead of throwing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-models-'));
  try {
    const missing = await queryCodexLiveModels({ codexBin: path.join(dir, 'nope'), cwd: dir });
    assert.equal(missing.ok, false);

    const { bin } = fakeCodex(dir, { failModelList: true });
    const refused = await queryCodexLiveModels({ codexBin: bin, cwd: dir, provider: 'ghost' });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.reason, /modelProviderNotConfigured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the local cache is owner-only, provider-keyed and expires', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-models-'));
  try {
    const cachePath = path.join(dir, 'cache', 'codex-models.json');
    const fetchedAt = new Date('2026-11-20T10:00:00.000Z');
    writeCodexModelsCache(live({ fetchedAt: fetchedAt.toISOString() }), cachePath);
    assert.equal(statSync(cachePath).mode & 0o777, 0o600);
    const at = (minutes: number) => () => new Date(fetchedAt.getTime() + minutes * 60_000);
    assert.ok(readCodexModelsCache({ cachePath, now: at(5) }));
    assert.equal(readCodexModelsCache({ cachePath, now: at(11) }), null);
    assert.equal(readCodexModelsCache({ cachePath, provider: 'corp', now: at(1) }), null);

    let queries = 0;
    const query = async () => {
      queries += 1;
      return { ok: true as const, live: live(), account: null };
    };
    const freshPath = path.join(dir, 'fresh.json');
    assert.ok(await loadCodexLiveModels({ cachePath: freshPath, query }));
    assert.ok(await loadCodexLiveModels({ cachePath: freshPath, query }));
    assert.equal(queries, 1, 'the second load is served from the cache');
    await loadCodexLiveModels({ cachePath: freshPath, query, refresh: true });
    assert.equal(queries, 2);
    assert.equal(
      await loadCodexLiveModels({
        cachePath: path.join(dir, 'none.json'),
        query: async () => ({ ok: false as const, reason: 'down' })
      }),
      null
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCodexLaunchSelection names the available models and efforts', () => {
  const list = live();
  assert.deepEqual(checkCodexLaunchSelection({ live: list, model: 'gpt-6-luna', effort: 'high' }), {
    ok: true
  });
  assert.deepEqual(checkCodexLaunchSelection({ live: list, model: null, effort: 'ultra' }), {
    ok: true
  });
  const unknown = checkCodexLaunchSelection({ live: list, model: 'gpt-6.1-sol', effort: null });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.match(unknown.message, /"gpt-6\.1-sol" is not available in Codex 0\.171\.0/);
    assert.match(unknown.message, /gpt-6\.2-sol, gpt-6-luna/);
  }
  const effort = checkCodexLaunchSelection({ live: list, model: 'gpt-6-luna', effort: 'ultra' });
  assert.equal(effort.ok, false);
  if (!effort.ok) assert.match(effort.message, /Supported efforts: low, high/);
  const defaultEffort = checkCodexLaunchSelection({ live: list, effort: 'xhigh' });
  assert.equal(defaultEffort.ok, false, 'the effort is checked against the default model');
});

test('the report body carries models only', () => {
  const body = codexLiveModelsReportBody(live());
  assert.deepEqual(Object.keys(body).sort(), ['agent', 'harnessVersion', 'models']);
  assert.equal(body.agent, 'codex');
  assert.deepEqual(Object.keys(body.models[0] ?? {}).sort(), [
    'defaultReasoningEffort',
    'displayName',
    'id',
    'isDefault',
    'reasoningOptions'
  ]);
});

test('the bundled fallback mirrors agent-catalog-defaults', () => {
  const models = bundledCodexModels();
  assert.ok(models.length > 0);
  assert.equal(models.filter(model => model.isDefault).length, 1);
});

test('assertCodexLaunchSelection refuses an unsupported pick and skips without a live list', async () => {
  const base = {
    agent: 'codex',
    missionId: 'coo:1',
    workingDirectory: os.tmpdir(),
    model: 'gpt-6.1-sol',
    thinking: 'high'
  };
  await assert.rejects(
    assertCodexLaunchSelection({ ...base, codexLiveModels: async () => live() }),
    (error: unknown) => error instanceof CliError && /not available/.test(error.message)
  );
  await assertCodexLaunchSelection({
    ...base,
    model: 'gpt-6.2-sol',
    thinking: 'ultra',
    codexLiveModels: async () => live()
  });
  await assertCodexLaunchSelection({ ...base, codexLiveModels: async () => null });
  await assertCodexLaunchSelection({
    ...base,
    codexLiveModels: async () => {
      throw new Error('codex crashed');
    }
  });
  let asked = false;
  const spy = async () => {
    asked = true;
    return live();
  };
  await assertCodexLaunchSelection({ ...base, dryRun: true, codexLiveModels: spy });
  await assertCodexLaunchSelection({ ...base, agent: 'claude', codexLiveModels: spy });
  await assertCodexLaunchSelection({ ...base, model: null, thinking: null, codexLiveModels: spy });
  assert.equal(asked, false, 'dry runs, other agents and unpinned launches never ask Codex');
});

test('the runner reporter throttles, and stops after a permission refusal', async () => {
  let clock = 0;
  const posts: { path: string; body?: unknown }[] = [];
  const logs: string[] = [];
  let status: number | null = null;
  const backend = {
    post: async <T>(args: { path: string; body?: unknown }): Promise<T> => {
      posts.push(args);
      if (status !== null) throw new CliError({ message: 'refused', status });
      return {} as T;
    }
  };
  const reporter = createRunnerCodexModelsReporter({
    backend,
    resolveWorkspaceId: async () => 'ws-1',
    load: async () => live(),
    intervalMs: 1000,
    now: () => clock,
    log: message => logs.push(message)
  });
  await reporter.tick();
  await reporter.tick();
  assert.equal(posts.length, 1, 'a second tick inside the interval does nothing');
  assert.equal(posts[0]?.path, '/api/workspaces/ws-1/agent-catalog/live-models');
  clock = 1500;
  status = 403;
  await reporter.tick();
  assert.equal(posts.length, 2);
  assert.match(logs.join('\n'), /launch:configure/);
  clock = 5000;
  await reporter.tick();
  assert.equal(posts.length, 2, 'no more reports once refused');

  const quiet = createRunnerCodexModelsReporter({
    backend,
    resolveWorkspaceId: async () => 'ws-1',
    load: async () => null,
    log: message => logs.push(message)
  });
  await quiet.tick();
  assert.equal(posts.length, 2, 'without Codex nothing is reported');
});
