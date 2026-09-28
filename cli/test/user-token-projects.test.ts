import assert from 'node:assert/strict';
import test from 'node:test';

import { projectFlags } from '../src/user-token.ts';

test('user-token create retains every repeated project selection', () => {
  assert.deepEqual(
    projectFlags([
      '--scope',
      'project-automation',
      '--project',
      'one',
      '--label',
      'importer',
      '--project=two'
    ]),
    ['one', 'two']
  );
  assert.throws(() => projectFlags(['--project']), /requires an ID or name/);
});
