import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runProtocolCommand,
  resolveProtocolAgentIdentifier,
  resolveProtocolModelIdentifier,
  resolveProtocolTicketDelegate
} from '../packages/overlord-cli/bin/_cli/protocol.mjs';

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
  assert.equal(resolveProtocolTicketDelegate({ delegate: '  cursor  ' }, 'gpt-5.4', 'codex'), 'cursor');
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

    await runProtocolCommand('permission-request', [
      '--ticket-id',
      'ticket 123'
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
