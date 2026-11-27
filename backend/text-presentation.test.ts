import assert from 'node:assert/strict';
import test from 'node:test';

import { presentationText } from './text-presentation.js';

test('presentation text preserves underscores in snake_case identifiers', () => {
  assert.equal(presentationText('request_outstanding_items', 100), 'request_outstanding_items');
});

test('presentation text removes whitespace-delimited underscore emphasis', () => {
  assert.equal(presentationText('This is _emphasized_ text.', 100), 'This is emphasized text.');
});
