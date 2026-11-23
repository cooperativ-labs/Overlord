import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../errors.ts';

import { objectiveUpdateFromFlags, parseObjectiveArrayInput } from './objective-input.ts';

test('parseObjectiveArrayInput preserves item values and accepts file input', () => {
  const items = [
    {
      instructions: '  Keep the original spacing.  ',
      title: null,
      summary: '',
      agent: 'codex',
      model: null,
      resourceKey: 'primary',
      autoAdvance: false
    }
  ];
  assert.equal(parseObjectiveArrayInput({}), undefined);
  assert.deepEqual(
    parseObjectiveArrayInput({
      flags: { '--objectives-file': '-' },
      fileInputs: { '--objectives-file': JSON.stringify(items) }
    }),
    items
  );
});

test('parseObjectiveArrayInput rejects invalid items with their index', () => {
  for (const [item, message] of [
    [null, /objectives\[1\] must be an object/],
    [{ objective: 'Old instructions' }, /"objective" is now "instructions"/],
    [{ instructions: 'Valid', extra: true }, /objectives\[1\] contains unsupported fields/],
    [{ instructions: ' ' }, /objectives\[1\]\.instructions must be a non-empty string/],
    [{ instructions: 'Valid', summary: true }, /objectives\[1\]\.summary must be a string or null/],
    [
      { instructions: 'Valid', autoAdvance: 'false' },
      /objectives\[1\]\.autoAdvance must be a boolean/
    ]
  ] as const) {
    assert.throws(
      () =>
        parseObjectiveArrayInput({
          flags: { '--objectives-json': JSON.stringify([{ instructions: 'First item' }, item]) }
        }),
      { status: 400, code: 'invalid_input', message }
    );
  }
});

test('objectiveUpdateFromFlags uses replacement instructions for summary placement', async () => {
  const checks: string[] = [];
  const result = await objectiveUpdateFromFlags(
    {
      flags: {
        '--instruction-text-file': '-',
        '--summary': 'Short overview',
        '--no-auto-advance': true,
        '--title': '',
        '--objective-agent': 'human'
      },
      fileInputs: { '--instruction-text-file': 'New instructions' }
    },
    async what => {
      checks.push(what);
      return { instructionText: 'Current instructions' };
    }
  );
  assert.deepEqual(checks, ['instruction text', 'summary']);
  assert.deepEqual(result, {
    update: {
      autoAdvance: false,
      title: '',
      instructionText: 'New instructions',
      summary: 'Short overview',
      assignedAgent: 'manual',
      model: null,
      reasoningEffort: null
    },
    wantsSummaryRequest: undefined,
    placement: { instructions: 'New instructions', summary: 'Short overview' }
  });
});

test('objectiveUpdateFromFlags checks draft state before reading missing file input', async () => {
  const notDraft = new ApiError(
    400,
    'Objective instruction text can only be edited in draft state'
  );
  const body = {
    flags: { '--instruction-text-file': '-', '--summary-request': 'invalid' }
  };
  await assert.rejects(
    () =>
      objectiveUpdateFromFlags(body, async () => {
        throw notDraft;
      }),
    notDraft
  );
  await assert.rejects(
    () => objectiveUpdateFromFlags(body, async () => ({ instructionText: '' })),
    {
      status: 400,
      code: 'invalid_input',
      message: /Missing file input for --instruction-text-file/
    }
  );
});

test('objectiveUpdateFromFlags validates summary requests before checking draft state', async () => {
  const assertDraft = async () => {
    assert.fail('a conflicting summary request should fail before consulting draft state');
  };
  await assert.rejects(
    () =>
      objectiveUpdateFromFlags(
        { flags: { '--summary-request': 'retry', '--summary': '' } },
        assertDraft
      ),
    { status: 400, code: 'invalid_input', message: /--summary-request cannot be combined/ }
  );
  const result = await objectiveUpdateFromFlags(
    { flags: { '--summary-request': 'retry' } },
    async what => {
      assert.equal(what, 'summary');
      return { instructionText: 'Current instructions' };
    }
  );
  assert.deepEqual(result, { update: {}, wantsSummaryRequest: 'retry', placement: null });
});
