import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type ProjectOption, resolveProjectId } from './quick-task-helpers.ts';

const projects: ProjectOption[] = [
  { id: 'first', name: 'First', color: null, workspaceId: 'workspace-a', workspaceName: null },
  { id: 'second', name: 'Second', color: null, workspaceId: 'workspace-a', workspaceName: null },
  { id: 'third', name: 'Third', color: null, workspaceId: 'workspace-b', workspaceName: null }
];

test('resolves quick-task projects in candidate priority order', () => {
  assert.equal(resolveProjectId(projects, 'third', 'second', 'first'), 'third');
  assert.equal(resolveProjectId(projects, null, 'second', 'first'), 'second');
});

test('skips unavailable candidates before using the existing first-project fallback', () => {
  assert.equal(resolveProjectId(projects, 'deleted', 'second', 'first'), 'second');
  assert.equal(resolveProjectId(projects, 'deleted'), 'first');
  assert.equal(resolveProjectId([], 'deleted'), '');
});
