import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomAgentValues,
  isBuiltinLaunchAgent,
  parseDirectLaunchArgs,
  resolveTemplate
} from '../packages/overlord-cli/bin/_cli/direct-launch.mjs';

test('isBuiltinLaunchAgent recognizes built-in agents case-insensitively', () => {
  assert.equal(isBuiltinLaunchAgent('claude'), true);
  assert.equal(isBuiltinLaunchAgent('CODEX'), true);
  assert.equal(isBuiltinLaunchAgent('opencode'), true);
  assert.equal(isBuiltinLaunchAgent('pi'), true);
  assert.equal(isBuiltinLaunchAgent('not-an-agent'), false);
  assert.equal(isBuiltinLaunchAgent(''), false);
  assert.equal(isBuiltinLaunchAgent(undefined), false);
});

test('parseDirectLaunchArgs separates objective, overlord flags, and passthrough', () => {
  const parsed = parseDirectLaunchArgs([
    'fix the login bug',
    '--model',
    'opus',
    '--thinking',
    'high',
    '--flag',
    '-x',
    '--',
    '--search',
    '--full-auto'
  ]);

  assert.equal(parsed.objective, 'fix the login bug');
  assert.equal(parsed.flags.model, 'opus');
  assert.equal(parsed.flags.thinking, 'high');
  assert.deepEqual(parsed.repeatedFlags, ['-x']);
  assert.deepEqual(parsed.passthrough, ['--search', '--full-auto']);
});

test('parseDirectLaunchArgs joins multiple unquoted positionals into one objective', () => {
  const parsed = parseDirectLaunchArgs(['refactor', 'the', 'auth', 'module', '--for-human']);
  assert.equal(parsed.objective, 'refactor the auth module');
  assert.equal(parsed.flags['for-human'], true);
});

test('parseDirectLaunchArgs treats bare value flags and = forms consistently', () => {
  const parsed = parseDirectLaunchArgs(['do it', '--project-id=abc-123', '--personal']);
  assert.equal(parsed.objective, 'do it');
  assert.equal(parsed.flags['project-id'], 'abc-123');
  assert.equal(parsed.flags.personal, true);
});

test('parseDirectLaunchArgs collects repeated --flag values', () => {
  const parsed = parseDirectLaunchArgs(['task', '--flag', '--foo', '--flag=--bar']);
  assert.deepEqual(parsed.repeatedFlags, ['--foo', '--bar']);
});

test('parseDirectLaunchArgs handles an empty argument list', () => {
  const parsed = parseDirectLaunchArgs([]);
  assert.equal(parsed.objective, '');
  assert.deepEqual(parsed.repeatedFlags, []);
  assert.deepEqual(parsed.passthrough, []);
});

test('resolveTemplate substitutes tokens and collapses gaps from empty values', () => {
  assert.equal(
    resolveTemplate('ollama claude {{model}} --effort {{effort}}', {
      model: 'qwen2.5-coder',
      effort: 'high'
    }),
    'ollama claude qwen2.5-coder --effort high'
  );
  assert.equal(
    resolveTemplate('run {{model}} {{missing}} now', { model: 'm' }),
    'run m now'
  );
});

test('buildCustomAgentValues maps model/thinking roles and falls back to first option', () => {
  const agent = {
    id: 'ollama-claude',
    name: 'Ollama Claude',
    commandTemplate: 'ollama claude {{model}} --effort {{effort}} --mode {{mode}}',
    placeholders: [
      { token: 'model', label: 'Model', role: 'model', options: [] },
      { token: 'effort', label: 'Effort', role: 'thinking', options: [] },
      {
        token: 'mode',
        label: 'Mode',
        role: 'other',
        options: [{ value: 'fast', label: 'Fast' }]
      }
    ]
  };

  const values = buildCustomAgentValues(agent, 'qwen', 'high');
  assert.equal(values.model, 'qwen');
  assert.equal(values.effort, 'high');
  assert.equal(values.mode, 'fast');
});
