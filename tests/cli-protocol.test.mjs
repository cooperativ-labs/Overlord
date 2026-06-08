import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runProtocolCommand,
  resolveProtocolAgentIdentifier,
  resolveProtocolModelIdentifier,
  resolveProtocolTicketDelegate,
  detectCodexSessionId,
  detectCodexSessionIdFromDisk,
  extractCodexRolloutMeta
} from '../packages/overlord-cli/bin/_cli/protocol.mjs';

// The CLI prefers OVERLORD_AGENT_TOKEN over legacy OVERLORD_ACCESS_TOKEN.
// Pin a fixture token for these request-shape tests so ambient local auth does not leak in.
process.env.OVERLORD_AGENT_TOKEN = 'test-agent-token';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

test('resolveProtocolAgentIdentifier prefers explicit agent, then environment, then default', () => {
  const original = process.env.AGENT_IDENTIFIER;
  try {
    delete process.env.AGENT_IDENTIFIER;
    assert.equal(resolveProtocolAgentIdentifier({}), 'claude-code');

    process.env.AGENT_IDENTIFIER = 'codex';
    assert.equal(resolveProtocolAgentIdentifier({}), 'codex');
    assert.equal(resolveProtocolAgentIdentifier({ agent: 'cursor' }), 'cursor');
    assert.equal(resolveProtocolAgentIdentifier({ agent: true }), 'codex');
  } finally {
    if (original === undefined) {
      delete process.env.AGENT_IDENTIFIER;
    } else {
      process.env.AGENT_IDENTIFIER = original;
    }
  }
});

test('resolveProtocolTicketDelegate uses explicit delegate before model or agent identifier', () => {
  assert.equal(resolveProtocolTicketDelegate({ delegate: 'gemini' }, 'gpt-5.4', 'codex'), 'gemini');
  assert.equal(
    resolveProtocolTicketDelegate({ delegate: '  cursor  ' }, 'gpt-5.4', 'codex'),
    'cursor'
  );
});

test('resolveProtocolTicketDelegate falls back to model identifier before agent identifier', () => {
  assert.equal(resolveProtocolTicketDelegate({}, 'gpt-5.4', 'codex'), 'gpt-5.4');
  assert.equal(resolveProtocolTicketDelegate({}, '', 'codex'), 'codex');
  assert.equal(resolveProtocolTicketDelegate({ delegate: true }, '', 'claude-code'), 'claude-code');
});

test('resolveProtocolModelIdentifier prefers explicit model, then environment', () => {
  const previousOverlordModel = process.env.OVERLORD_MODEL_IDENTIFIER;
  const previousModel = process.env.MODEL_IDENTIFIER;
  const previousAgentModel = process.env.AGENT_MODEL;

  try {
    delete process.env.OVERLORD_MODEL_IDENTIFIER;
    delete process.env.MODEL_IDENTIFIER;
    delete process.env.AGENT_MODEL;
    assert.equal(resolveProtocolModelIdentifier({}), null);

    process.env.AGENT_MODEL = 'fallback-model';
    assert.equal(resolveProtocolModelIdentifier({}), 'fallback-model');

    process.env.MODEL_IDENTIFIER = 'model-env';
    assert.equal(resolveProtocolModelIdentifier({}), 'model-env');

    process.env.OVERLORD_MODEL_IDENTIFIER = 'overlord-model-env';
    assert.equal(resolveProtocolModelIdentifier({}), 'overlord-model-env');
    assert.equal(resolveProtocolModelIdentifier({ model: 'explicit-model' }), 'explicit-model');
  } finally {
    if (previousOverlordModel === undefined) delete process.env.OVERLORD_MODEL_IDENTIFIER;
    else process.env.OVERLORD_MODEL_IDENTIFIER = previousOverlordModel;

    if (previousModel === undefined) delete process.env.MODEL_IDENTIFIER;
    else process.env.MODEL_IDENTIFIER = previousModel;

    if (previousAgentModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = previousAgentModel;
  }
});

test('permission-request posts hook payload through protocol auth resolver', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousTicketId = process.env.TICKET_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';
    delete process.env.TICKET_ID;

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('permission-request', ['--ticket-id', 'ticket 123']);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
    if (previousTicketId === undefined) delete process.env.TICKET_ID;
    else process.env.TICKET_ID = previousTicketId;
  }

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://www.ovld.ai/api/protocol/permission-request?ticketId=ticket%20123'
  );
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-agent-token');
  assert.equal(calls[0].headers['x-organization-id'], '42');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].body, '{}');
  assert.match(logs.join('\n'), /"ok": true/);
});

test('deliver accepts --payload-json and posts the full delivery payload', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('deliver', [
      '--session-key',
      'session-123',
      '--ticket-id',
      '1:1022',
      '--payload-json',
      '{"summary":"Done","artifacts":[{"type":"note","label":"Delivery","content":"ok"}],"changeRationales":[{"label":"Deliver inline payload","file_path":"packages/overlord-cli/bin/_cli/protocol.mjs","summary":"Added payload-json support.","why":"Agents should be able to submit full delivery JSON inline.","impact":"No temp file or stdin transport is required for compact payloads.","hunks":[{"header":"@@ -1120,6 +1120,22 @@"}]}]}',
      '--skip-file-change-check'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/deliver');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-agent-token');
  assert.equal(calls[0].headers['x-organization-id'], '1');
  assert.deepEqual(JSON.parse(calls[0].body), {
    sessionKey: 'session-123',
    ticketId: '1:1022',
    summary: 'Done',
    artifacts: [{ type: 'note', label: 'Delivery', content: 'ok' }],
    changeRationales: [
      {
        label: 'Deliver inline payload',
        file_path: 'packages/overlord-cli/bin/_cli/protocol.mjs',
        summary: 'Added payload-json support.',
        why: 'Agents should be able to submit full delivery JSON inline.',
        impact: 'No temp file or stdin transport is required for compact payloads.',
        hunks: [{ header: '@@ -1120,6 +1120,22 @@' }]
      }
    ]
  });
  assert.match(logs.join('\n'), /"ok": true/);
});

test('deliver rejects conflicting payload inputs and summary/artifact/rationale flags', async () => {
  await assert.rejects(
    () =>
      runProtocolCommand('deliver', [
        '--session-key',
        'session-123',
        '--ticket-id',
        '1:1022',
        '--payload-json',
        '{"summary":"Done"}',
        '--summary',
        'Done',
        '--skip-file-change-check'
      ]),
    /Use either payload input or --summary\/--summary-file, not both/
  );

  await assert.rejects(
    () =>
      runProtocolCommand('deliver', [
        '--session-key',
        'session-123',
        '--ticket-id',
        '1:1022',
        '--payload-json',
        '{"summary":"Done"}',
        '--artifacts-json',
        '[]',
        '--skip-file-change-check'
      ]),
    /Use either payload input or --artifacts-json, not both/
  );

  await assert.rejects(
    () =>
      runProtocolCommand('deliver', [
        '--session-key',
        'session-123',
        '--ticket-id',
        '1:1022',
        '--payload-json',
        '{"summary":"Done"}',
        '--change-rationales-json',
        '[]',
        '--skip-file-change-check'
      ]),
    /Use either payload input or change-rationale flags, not both/
  );

  await assert.rejects(
    () =>
      runProtocolCommand('deliver', [
        '--session-key',
        'session-123',
        '--ticket-id',
        '1:1022',
        '--payload-json',
        '{"summary":"Done"}',
        '--payload-file',
        './deliver.json',
        '--skip-file-change-check'
      ]),
    /Use either --payload-file or --payload-json, not both/
  );
});

test('heartbeat posts lightweight session telemetry without a summary', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ ok: true, heartbeatAt: '2026-05-31T00:00:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('heartbeat', [
      '--session-key',
      'session-123',
      '--ticket-id',
      '1:1022',
      '--phase',
      'execute',
      '--percent',
      '40',
      '--note',
      'Running tests'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/heartbeat');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-agent-token');
  assert.equal(calls[0].headers['x-organization-id'], '1');
  assert.deepEqual(JSON.parse(calls[0].body), {
    sessionKey: 'session-123',
    ticketId: '1:1022',
    phase: 'execute',
    percent: 40,
    note: 'Running tests'
  });
  assert.match(logs.join('\n'), /"heartbeatAt": "2026-05-31T00:00:00.000Z"/);
});

test('create posts projectId for follow-up draft creation when explicitly overridden', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ ok: true, ticket: { id: 'ticket-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('create', [
      '--session-key',
      '11111111-2222-4333-8444-555555555555',
      '--ticket-id',
      '1:1333',
      '--project-id',
      'Shared Platform',
      '--objectives-json',
      '[{"objective":"Capture cross-project follow-up"}]'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/create-ticket');
  assert.deepEqual(JSON.parse(calls[0].body), {
    sessionKey: '11111111-2222-4333-8444-555555555555',
    ticketId: '1:1333',
    objectives: [{ objective: 'Capture cross-project follow-up' }],
    projectId: 'Shared Platform',
    delegate: 'claude-code'
  });
  assert.match(logs.join('\n'), /"ok": true/);
});

test('connect posts externalSessionId when explicitly provided', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ session: { sessionKey: 'session-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('connect', [
      '--ticket-id',
      '1:1333',
      '--agent',
      'codex',
      '--external-session-id',
      'codex-thread-123'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/connect');
  assert.deepEqual(JSON.parse(calls[0].body), {
    ticketId: '1:1333',
    agentIdentifier: 'codex',
    connectionMethod: 'cli',
    externalSessionId: 'codex-thread-123',
    metadata: {
      cwd: process.cwd()
    }
  });
  assert.match(logs.join('\n'), /"sessionKey": "session-1"/);
});

test('hook-event posts externalSessionId when explicitly provided', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];
  const logs = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('hook-event', [
      '--ticket-id',
      '1:1333',
      '--hook-type',
      'UserPromptSubmit',
      '--prompt',
      'Continue',
      '--turn-index',
      '1',
      '--session-key',
      'session-123',
      '--external-session-id',
      'claude-session-123'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/hook-event');
  assert.deepEqual(JSON.parse(calls[0].body), {
    hookType: 'UserPromptSubmit',
    ticketId: '1:1333',
    prompt: 'Continue',
    turnIndex: 1,
    externalSessionId: 'claude-session-123',
    sessionKey: 'session-123'
  });
  assert.match(logs.join('\n'), /"ok": true/);
});

test('revert fetches checkpoint row and restores the local git working tree', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-revert-test-'));
  const objectiveId = '11111111-2222-4333-8444-555555555555';
  const calls = [];
  const logs = [];

  try {
    git(repo, ['init']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'checkpoint\n');
    git(repo, ['add', 'file.txt']);
    git(repo, ['commit', '-m', 'checkpoint']);
    const checkpointSha = git(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'changed\n');

    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers,
        body: init.body
      });
      return new Response(
        JSON.stringify({
          checkpoint: {
            id: 'checkpoint-id',
            objective_id: objectiveId,
            git_commit_id: checkpointSha,
            git_ref_name: `refs/overlord/checkpoints/${objectiveId}`
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    };
    console.log = value => {
      logs.push(String(value));
    };

    await runProtocolCommand('revert', [
      '--objective-id',
      objectiveId,
      '--working-directory',
      repo
    ]);

    assert.equal(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8'), 'checkpoint\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/revert');
    assert.deepEqual(JSON.parse(calls[0].body), { objectiveId });
    assert.match(logs.join('\n'), /"ok": true/);
    assert.match(logs.join('\n'), /"safetyRef": "refs\/overlord\/safety\//);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('request-execution posts local launch payload with repeated flags', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(JSON.stringify({ request: { id: 'req-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('request-execution', [
      '--ticket-id',
      '1:899',
      '--requested-from',
      'manual_run',
      '--agent',
      'codex',
      '--launch-mode',
      'ask',
      '--working-directory',
      '/repo',
      '--flag',
      '--verbose',
      '--flag',
      '--dangerously-skip-permissions'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/request-execution');
  assert.deepEqual(JSON.parse(calls[0].body), {
    ticketId: '1:899',
    requestedFrom: 'manual_run',
    agentIdentifier: 'codex',
    launchMode: 'ask',
    flags: ['--verbose', '--dangerously-skip-permissions'],
    workingDirectory: '/repo'
  });
});

test('request-execution includes ssh targeting fields when provided', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({ body: init.body });
      return new Response(JSON.stringify({ request: { id: 'req-ssh' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('request-execution', [
      '--ticket-id',
      '1:900',
      '--target-kind',
      'ssh',
      '--ssh-command',
      'ssh dev@host',
      '--remote-working-directory',
      '/remote/repo',
      '--server-multiplexer',
      'tmux',
      '--tmux-command',
      'tmux new -s ovld'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.deepEqual(JSON.parse(calls[0].body), {
    ticketId: '1:900',
    requestedFrom: 'api',
    launchMode: 'run',
    flags: [],
    sshCommand: 'ssh dev@host',
    remoteWorkingDirectory: '/remote/repo',
    serverMultiplexer: 'tmux',
    tmuxCommand: 'tmux new -s ovld',
    targetKind: 'ssh'
  });
});

test('claim-execution posts device fingerprint from flag', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({ body: init.body });
      return new Response(JSON.stringify({ request: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('claim-execution', ['--device-fingerprint', 'fp-cli-test']);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.deepEqual(JSON.parse(calls[0].body), {
    deviceFingerprint: 'fp-cli-test'
  });
});

test('list-execution-requests posts queue filter payload', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(JSON.stringify({ requests: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('list-execution-requests', [
      '--device-fingerprint',
      'fp-cli-test',
      '--project-id',
      'aaaaaaaa-0000-4000-8000-000000000001'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/list-execution-requests');
  assert.deepEqual(JSON.parse(calls[0].body), {
    deviceFingerprint: 'fp-cli-test',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001'
  });
});

test('clear-execution-requests posts objective-id or clear-all payload', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(JSON.stringify({ clearedCount: 0, requests: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('clear-execution-requests', ['--objective-id', 'req-objective']);
    await runProtocolCommand('clear-execution-requests', ['--clear-all']);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
  }

  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/clear-execution-requests');
  assert.deepEqual(JSON.parse(calls[0].body), {
    objectiveId: 'req-objective'
  });
  assert.deepEqual(JSON.parse(calls[1].body), {
    clearAll: true
  });
});

test('complete-execution-launch and fail-execution-launch post expected payloads', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousLog = console.log;
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';
    process.env.OVERLORD_DEVICE_FINGERPRINT = 'fp-env';

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(JSON.stringify({ request: { id: 'req-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    console.log = () => {};

    await runProtocolCommand('complete-execution-launch', ['--request-id', 'req-uuid']);
    await runProtocolCommand('fail-execution-launch', [
      '--request-id',
      'req-uuid',
      '--error',
      'spawn failed'
    ]);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
    delete process.env.OVERLORD_DEVICE_FINGERPRINT;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/complete-execution-launch');
  assert.deepEqual(JSON.parse(calls[0].body), {
    requestId: 'req-uuid',
    deviceFingerprint: 'fp-env'
  });
  assert.equal(calls[1].url, 'https://www.ovld.ai/api/protocol/fail-execution-launch');
  assert.deepEqual(JSON.parse(calls[1].body), {
    requestId: 'req-uuid',
    deviceFingerprint: 'fp-env',
    error: 'spawn failed'
  });
});

// ---------------------------------------------------------------------------
// Codex external session id detection
// ---------------------------------------------------------------------------

function writeCodexRollout(home, { uuid, cwd, mtime, name }) {
  const dir = path.join(home, '.codex', 'sessions', '2026', '06', '08');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name ?? `rollout-2026-06-08T08-00-00-${uuid}.jsonl`);
  const meta = {
    type: 'session_meta',
    payload: { id: uuid, cwd, timestamp: '2026-06-08T08:00:00Z' }
  };
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n{"type":"event"}\n`);
  if (mtime !== undefined) fs.utimesSync(file, mtime, mtime);
  return file;
}

test('extractCodexRolloutMeta parses both enveloped and flat meta lines', () => {
  const uuid = 'abcdef12-3456-4789-8abc-def012345678';
  assert.deepEqual(
    extractCodexRolloutMeta(
      JSON.stringify({ type: 'session_meta', payload: { id: uuid, cwd: '/repo' } })
    ),
    { id: uuid, cwd: '/repo' }
  );
  assert.deepEqual(extractCodexRolloutMeta(JSON.stringify({ id: uuid })), { id: uuid, cwd: null });
  assert.equal(extractCodexRolloutMeta('not json'), null);
  assert.equal(extractCodexRolloutMeta(JSON.stringify({ payload: { id: 'nope' } })), null);
});

test('detectCodexSessionIdFromDisk prefers the rollout whose cwd matches', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-repo-'));
  const previousHome = process.env.HOME;
  const previousCwd = process.cwd();
  const matchId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const otherId = 'bbbbbbbb-2222-4222-8222-222222222222';
  try {
    process.env.HOME = home;
    // The cwd-matching rollout is older, the non-matching rollout is newer —
    // cwd match must still win over raw recency.
    writeCodexRollout(home, {
      uuid: matchId,
      cwd: repo,
      mtime: 1000,
      name: `rollout-2026-06-08T08-00-00-${matchId}.jsonl`
    });
    writeCodexRollout(home, {
      uuid: otherId,
      cwd: '/somewhere/else',
      mtime: 2000,
      name: `rollout-2026-06-08T09-00-00-${otherId}.jsonl`
    });
    process.chdir(repo);
    assert.equal(detectCodexSessionIdFromDisk(), matchId);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('detectCodexSessionIdFromDisk falls back to the most recent rollout when no cwd matches', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-repo-'));
  const previousHome = process.env.HOME;
  const previousCwd = process.cwd();
  const oldId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const newId = 'bbbbbbbb-2222-4222-8222-222222222222';
  try {
    process.env.HOME = home;
    writeCodexRollout(home, {
      uuid: oldId,
      cwd: '/old/path',
      mtime: 1000,
      name: `rollout-2026-06-08T08-00-00-${oldId}.jsonl`
    });
    writeCodexRollout(home, {
      uuid: newId,
      cwd: '/new/path',
      mtime: 2000,
      name: `rollout-2026-06-08T09-00-00-${newId}.jsonl`
    });
    process.chdir(repo);
    assert.equal(detectCodexSessionIdFromDisk(), newId);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('detectCodexSessionIdFromDisk returns null when no codex sessions exist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-home-'));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    assert.equal(detectCodexSessionIdFromDisk(), null);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('create keeps a local draft when the network fails and clears it on success', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousPendingDir = process.env.OVERLORD_PENDING_TICKETS_DIR;
  const previousLog = console.log;
  const pendingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-pending-'));

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';
    process.env.OVERLORD_PENDING_TICKETS_DIR = pendingDir;
    console.log = () => {};

    // 1) Network failure must preserve the draft and surface the file path.
    global.fetch = async () => {
      throw new Error('socket hang up');
    };

    await assert.rejects(
      runProtocolCommand('create', [
        '--session-key',
        '11111111-2222-4333-8444-555555555555',
        '--ticket-id',
        '1:1333',
        '--objectives-json',
        '[{"objective":"Survive flaky internet"}]'
      ]),
      error => {
        assert.match(error.message, /saved locally/);
        assert.match(error.message, new RegExp(pendingDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      }
    );

    let drafts = fs.readdirSync(pendingDir).filter(name => name.endsWith('.json'));
    assert.equal(drafts.length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(pendingDir, drafts[0]), 'utf8'));
    assert.equal(saved.endpoint, '/api/protocol/create-ticket');
    assert.deepEqual(saved.objectives, ['Survive flaky internet']);
    assert.deepEqual(saved.body.objectives, [{ objective: 'Survive flaky internet' }]);

    // 2) A confirmed write must delete the draft so it does not linger.
    global.fetch = async () =>
      new Response(JSON.stringify({ ok: true, ticket: { id: 'ticket-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    await runProtocolCommand('create', [
      '--session-key',
      '11111111-2222-4333-8444-555555555555',
      '--ticket-id',
      '1:1333',
      '--objectives-json',
      '[{"objective":"Confirmed write"}]'
    ]);

    drafts = fs.readdirSync(pendingDir).filter(name => name.endsWith('.json'));
    // The confirmed call leaves only the earlier failed draft behind.
    assert.equal(drafts.length, 1);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(pendingDir, drafts[0]), 'utf8')).objectives,
      ['Survive flaky internet']
    );
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
    if (previousPendingDir === undefined) delete process.env.OVERLORD_PENDING_TICKETS_DIR;
    else process.env.OVERLORD_PENDING_TICKETS_DIR = previousPendingDir;
    fs.rmSync(pendingDir, { recursive: true, force: true });
  }
});

test('pending-tickets --retry resends the saved body and clears the draft on success', async () => {
  const previousFetch = global.fetch;
  const previousOverlordUrl = process.env.OVERLORD_URL;
  const previousAgentToken = process.env.OVERLORD_ACCESS_TOKEN;
  const previousOrganizationId = process.env.OVERLORD_ORGANIZATION_ID;
  const previousPendingDir = process.env.OVERLORD_PENDING_TICKETS_DIR;
  const previousLog = console.log;
  const pendingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-pending-'));
  const calls = [];

  try {
    process.env.OVERLORD_URL = 'https://www.ovld.ai';
    process.env.OVERLORD_ACCESS_TOKEN = 'test-agent-token';
    process.env.OVERLORD_ORGANIZATION_ID = '42';
    process.env.OVERLORD_PENDING_TICKETS_DIR = pendingDir;
    console.log = () => {};

    const draftId = 'draft-retry-1';
    fs.writeFileSync(
      path.join(pendingDir, `${draftId}.json`),
      JSON.stringify({
        id: draftId,
        kind: 'add-objectives',
        endpoint: '/api/protocol/add-objectives',
        createdAt: new Date().toISOString(),
        ticketId: '1:1333',
        objectives: ['Retry me'],
        body: { ticketId: '1:1333', objectives: [{ objective: 'Retry me' }] }
      }),
      'utf8'
    );

    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await runProtocolCommand('pending-tickets', ['--retry', draftId]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://www.ovld.ai/api/protocol/add-objectives');
    assert.deepEqual(JSON.parse(calls[0].body), {
      ticketId: '1:1333',
      objectives: [{ objective: 'Retry me' }]
    });
    assert.equal(fs.existsSync(path.join(pendingDir, `${draftId}.json`)), false);
  } finally {
    global.fetch = previousFetch;
    console.log = previousLog;
    if (previousOverlordUrl === undefined) delete process.env.OVERLORD_URL;
    else process.env.OVERLORD_URL = previousOverlordUrl;
    if (previousAgentToken === undefined) delete process.env.OVERLORD_ACCESS_TOKEN;
    else process.env.OVERLORD_ACCESS_TOKEN = previousAgentToken;
    if (previousOrganizationId === undefined) delete process.env.OVERLORD_ORGANIZATION_ID;
    else process.env.OVERLORD_ORGANIZATION_ID = previousOrganizationId;
    if (previousPendingDir === undefined) delete process.env.OVERLORD_PENDING_TICKETS_DIR;
    else process.env.OVERLORD_PENDING_TICKETS_DIR = previousPendingDir;
    fs.rmSync(pendingDir, { recursive: true, force: true });
  }
});

test('pending-tickets --clear-all removes every saved draft', async () => {
  const previousPendingDir = process.env.OVERLORD_PENDING_TICKETS_DIR;
  const previousLog = console.log;
  const pendingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-pending-'));

  try {
    process.env.OVERLORD_PENDING_TICKETS_DIR = pendingDir;
    console.log = () => {};

    for (const id of ['a', 'b']) {
      fs.writeFileSync(
        path.join(pendingDir, `${id}.json`),
        JSON.stringify({ id, kind: 'create', createdAt: new Date().toISOString() }),
        'utf8'
      );
    }

    await runProtocolCommand('pending-tickets', ['--clear-all']);
    assert.equal(fs.readdirSync(pendingDir).filter(name => name.endsWith('.json')).length, 0);
  } finally {
    console.log = previousLog;
    if (previousPendingDir === undefined) delete process.env.OVERLORD_PENDING_TICKETS_DIR;
    else process.env.OVERLORD_PENDING_TICKETS_DIR = previousPendingDir;
    fs.rmSync(pendingDir, { recursive: true, force: true });
  }
});

test('detectCodexSessionId prefers env vars, then disk fallback', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ovld-codex-repo-'));
  const previousHome = process.env.HOME;
  const previousThread = process.env.CODEX_THREAD_ID;
  const previousSession = process.env.CODEX_SESSION_ID;
  const previousCwd = process.cwd();
  const diskId = 'aaaaaaaa-1111-4111-8111-111111111111';
  try {
    process.env.HOME = home;
    writeCodexRollout(home, { uuid: diskId, cwd: repo, mtime: 1000 });
    process.chdir(repo);

    process.env.CODEX_THREAD_ID = 'env-thread-id';
    assert.equal(detectCodexSessionId(), 'env-thread-id');

    delete process.env.CODEX_THREAD_ID;
    process.env.CODEX_SESSION_ID = 'env-session-id';
    assert.equal(detectCodexSessionId(), 'env-session-id');

    delete process.env.CODEX_SESSION_ID;
    assert.equal(detectCodexSessionId(), diskId);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
    if (previousSession === undefined) delete process.env.CODEX_SESSION_ID;
    else process.env.CODEX_SESSION_ID = previousSession;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
