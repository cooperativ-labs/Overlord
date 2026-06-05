import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseNumberedSelection,
  resolveProject,
  resolvePromptAgentIdentifier,
  resolveTicketCreationModelIdentifier,
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

test('resolveTicketCreationModelIdentifier prefers explicit model, then environment', () => {
  const previousOverlordModel = process.env.OVERLORD_MODEL_IDENTIFIER;
  const previousModel = process.env.MODEL_IDENTIFIER;
  const previousAgentModel = process.env.AGENT_MODEL;
  try {
    delete process.env.OVERLORD_MODEL_IDENTIFIER;
    delete process.env.MODEL_IDENTIFIER;
    delete process.env.AGENT_MODEL;
    assert.equal(resolveTicketCreationModelIdentifier({}), null);

    process.env.AGENT_MODEL = 'fallback-model';
    assert.equal(resolveTicketCreationModelIdentifier({}), 'fallback-model');

    process.env.MODEL_IDENTIFIER = 'model-env';
    assert.equal(resolveTicketCreationModelIdentifier({}), 'model-env');

    process.env.OVERLORD_MODEL_IDENTIFIER = 'overlord-model-env';
    assert.equal(resolveTicketCreationModelIdentifier({}), 'overlord-model-env');
    assert.equal(resolveTicketCreationModelIdentifier({ model: 'explicit-model' }), 'explicit-model');
  } finally {
    if (previousOverlordModel === undefined) delete process.env.OVERLORD_MODEL_IDENTIFIER;
    else process.env.OVERLORD_MODEL_IDENTIFIER = previousOverlordModel;
    if (previousModel === undefined) delete process.env.MODEL_IDENTIFIER;
    else process.env.MODEL_IDENTIFIER = previousModel;
    if (previousAgentModel === undefined) delete process.env.AGENT_MODEL;
    else process.env.AGENT_MODEL = previousAgentModel;
  }
});

test('resolveTicketCreationDelegate prefers explicit delegate, then model, then agent, then environment', () => {
  const original = process.env.AGENT_IDENTIFIER;
  try {
    delete process.env.AGENT_IDENTIFIER;
    assert.equal(resolveTicketCreationDelegate({ delegate: ' gemini ' }, 'codex', 'gpt-5.4'), 'gemini');
    assert.equal(resolveTicketCreationDelegate({}, 'claude', 'gpt-5.4'), 'gpt-5.4');
    assert.equal(resolveTicketCreationDelegate({ agent: 'codex' }), 'codex');
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

const SAMPLE_PROJECTS = [
  { id: 'aaaa-1111', name: 'Overlord' },
  { id: 'bbbb-2222', name: 'Mobile App' },
  { id: 'cccc-3333', name: 'Backend API' }
];

test('resolveProject matches by UUID', () => {
  const result = resolveProject(SAMPLE_PROJECTS, 'bbbb-2222');
  assert.equal(result.id, 'bbbb-2222');
  assert.equal(result.name, 'Mobile App');
});

test('resolveProject matches by exact project name', () => {
  const result = resolveProject(SAMPLE_PROJECTS, 'Overlord');
  assert.equal(result.id, 'aaaa-1111');
});

test('resolveProject matches by name case-insensitively', () => {
  const result = resolveProject(SAMPLE_PROJECTS, 'mobile app');
  assert.equal(result.id, 'bbbb-2222');

  const result2 = resolveProject(SAMPLE_PROJECTS, 'BACKEND API');
  assert.equal(result2.id, 'cccc-3333');
});

test('resolveProject returns null for empty input', () => {
  assert.equal(resolveProject(SAMPLE_PROJECTS, ''), null);
  assert.equal(resolveProject(SAMPLE_PROJECTS, null), null);
  assert.equal(resolveProject(SAMPLE_PROJECTS, undefined), null);
});

test('resolveProject throws for unknown name or id', () => {
  assert.throws(() => resolveProject(SAMPLE_PROJECTS, 'Nonexistent'), /Unknown project/);
  assert.throws(() => resolveProject(SAMPLE_PROJECTS, 'zzzz-9999'), /Unknown project/);
});
