import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNumberedSelection, sortProjects } from '../packages/overlord-cli/bin/_cli/new-ticket.mjs';

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
