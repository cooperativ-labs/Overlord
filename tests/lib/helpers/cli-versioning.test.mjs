import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveCliVersion, parseVersion } from '../../../lib/helpers/cli-versioning.mjs';

test('parseVersion accepts strict x.x.y versions', () => {
  assert.deepEqual(parseVersion('3.5.2'), { major: 3, minor: 5, patch: 2 });
  assert.equal(parseVersion('3.5'), null);
  assert.equal(parseVersion('3.5.2-beta.1'), null);
});

test('deriveCliVersion keeps CLI patch when desktop major/minor stay the same', () => {
  assert.equal(deriveCliVersion('3.5.2', '3.5.1'), '3.5.1');
  assert.equal(deriveCliVersion('3.5.2', '3.5.9'), '3.5.9');
});

test('deriveCliVersion resets CLI patch when desktop major/minor changes', () => {
  assert.equal(deriveCliVersion('3.6.0', '3.5.1'), '3.6.0');
  assert.equal(deriveCliVersion('4.0.0', '3.9.7'), '4.0.0');
});
