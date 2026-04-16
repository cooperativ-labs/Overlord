import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseNumberedSelection,
  resolvePromptAgentIdentifier,
  resolveTicketCreationDelegate,
  sortProjects
} from '../packages/overlord-cli/bin/_cli/new-ticket.mjs';

test('parseNumberedSelection accepts in-range numeric input', () => {
  assert.equal(parseNumberedSelection('1', 3), 0);
  assert.equal(parseNumberedSelection(' 3 ', 3), 2);
});

test('parseNumberedSelection rejects invalid input', () => {
  assert.equal(parseNumberedSelection('', 3), null);
  assert.equal(parseNumberedSelection('0', 3), null);
  assert.equal(parseNumberedSelection('4', 3), null);
  assert.equal(parseNumberedSelection('abc', 3), null);
});

test('sortProjects orders by organization, then project name, then id', () => {
  const sorted = sortProjects([
    { id: 'b', name: 'Zulu', organizationName: 'Beta' },
    { id: 'c', name: 'Alpha', organizationName: 'Acme' },
    { id: 'a', name: 'Alpha', organizationName: 'Beta' },
    { id: 'd', name: 'Alpha', organizationName: 'Beta' }
  ]);

  assert.deepEqual(
    sorted.map(project => project.id),
    ['c', 'a', 'd', 'b']
  );
});

test('resolvePromptAgentIdentifier maps prompt agents to protocol identifiers', () => {
  assert.equal(resolvePromptAgentIdentifier('claude'), 'claude-code');
  assert.equal(resolvePromptAgentIdentifier('codex'), 'codex');
  assert.equal(resolvePromptAgentIdentifier('cursor'), 'cursor');
});

test('resolveTicketCreationDelegate prefers explicit delegate, then selected agent, then environment', () => {
  const original = process.env.AGENT_IDENTIFIER;
  try {
    delete process.env.AGENT_IDENTIFIER;
    assert.equal(resolveTicketCreationDelegate({ delegate: ' gemini ' }, 'codex'), 'gemini');
    assert.equal(resolveTicketCreationDelegate({}, 'claude'), 'claude-code');
    assert.equal(resolveTicketCreationDelegate({}), null);

    process.env.AGENT_IDENTIFIER = 'codex';
    assert.equal(resolveTicketCreationDelegate({}), 'codex');
  } finally {
    if (original === undefined) {
      delete process.env.AGENT_IDENTIFIER;
    } else {
      process.env.AGENT_IDENTIFIER = original;
    }
  }
});
