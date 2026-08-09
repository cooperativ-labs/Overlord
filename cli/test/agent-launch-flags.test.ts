import {
  agentLaunchFlagsToArgv,
  formatAgentLaunchFlagText,
  formatOvldLaunchCommand,
  formatShellWord,
  normalizeAgentLaunchFlags,
  parseAgentLaunchFlagText
} from '@overlord/contract';
import assert from 'node:assert/strict';
import test from 'node:test';

test('parseAgentLaunchFlagText accepts boolean and positional flags', () => {
  assert.deepEqual(parseAgentLaunchFlagText('--verbose'), { name: '--verbose' });
  assert.deepEqual(parseAgentLaunchFlagText('--permission-mode auto'), {
    name: '--permission-mode',
    value: 'auto'
  });
  assert.deepEqual(parseAgentLaunchFlagText('--permission-mode=auto'), {
    name: '--permission-mode',
    value: 'auto'
  });
});

test('normalizeAgentLaunchFlags coerces legacy string arrays and structured objects', () => {
  assert.deepEqual(normalizeAgentLaunchFlags(['--verbose', '--permission-mode auto']), [
    { name: '--verbose' },
    { name: '--permission-mode', value: 'auto' }
  ]);
  assert.deepEqual(
    normalizeAgentLaunchFlags([
      { name: '--permission-mode', value: 'auto' },
      { name: '--verbose' }
    ]),
    [
      { name: '--permission-mode', value: 'auto' },
      { name: '--verbose', value: null }
    ]
  );
});

test('agentLaunchFlagsToArgv emits separate argv tokens for positional values', () => {
  assert.deepEqual(
    agentLaunchFlagsToArgv([{ name: '--permission-mode', value: 'auto' }, { name: '--verbose' }]),
    ['--permission-mode', 'auto', '--verbose']
  );
});

test('formatAgentLaunchFlagText renders boolean and positional flags', () => {
  assert.equal(formatAgentLaunchFlagText({ name: '--verbose' }), '--verbose');
  assert.equal(
    formatAgentLaunchFlagText({ name: '--permission-mode', value: 'auto' }),
    '--permission-mode auto'
  );
});

test('formatShellWord quotes values that need shell protection', () => {
  assert.equal(formatShellWord('cursor'), 'cursor');
  assert.equal(formatShellWord('gpt-5.6-terra'), 'gpt-5.6-terra');
  assert.equal(formatShellWord('--sandbox workspace-write'), "'--sandbox workspace-write'");
  assert.equal(formatShellWord("don't"), "'don'\\''t'");
});

test('formatOvldLaunchCommand builds a paste-ready ovld launch invocation', () => {
  assert.equal(
    formatOvldLaunchCommand({
      agent: 'cursor',
      missionDisplayId: 'coo:659',
      objectiveId: 'obj-1',
      model: 'gpt-5.6-terra',
      thinking: 'high',
      preCommand: 'agp',
      flags: [{ name: '--sandbox', value: 'workspace-write' }]
    }),
    "ovld launch cursor --mission-id coo:659 --objective-id obj-1 --model gpt-5.6-terra --thinking high --pre-command agp --flag '--sandbox workspace-write'"
  );
});
