import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveProtocolAgentIdentifier,
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

test('resolveProtocolTicketDelegate uses explicit delegate before agent identifier', () => {
  assert.equal(resolveProtocolTicketDelegate({ delegate: 'gemini' }, 'codex'), 'gemini');
  assert.equal(resolveProtocolTicketDelegate({ delegate: '  cursor  ' }, 'codex'), 'cursor');
});

test('resolveProtocolTicketDelegate falls back to agent identifier', () => {
  assert.equal(resolveProtocolTicketDelegate({}, 'codex'), 'codex');
  assert.equal(resolveProtocolTicketDelegate({ delegate: true }, 'claude-code'), 'claude-code');
});
