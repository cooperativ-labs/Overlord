import type {
  ProjectResourceReadCatalog,
  ProjectResourceReadRequest,
  ProjectResourceReadResult
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { api } from '@/lib/api';
import { ResourceAccountContext } from '@/lib/resource-account';

import { ProjectResourceBrowser } from './ProjectResourceBrowser.tsx';

test('requires an explicit runner for Git and clears a file preview on access loss', async t => {
  const source = {
    sourceId: 'source-a',
    sourceRevision: 1,
    executionTargetId: 'target-a',
    targetLabel: 'Mac',
    availability: 'ready' as const
  };
  const resources: ProjectResourceReadCatalog = [
    {
      id: 'git',
      resourceKey: 'repo',
      label: 'Repository',
      hasGitSource: true,
      sources: [source, { ...source, sourceId: 'source-b', executionTargetId: 'target-b' }]
    },
    {
      id: 'files',
      resourceKey: 'folder',
      label: 'Notes',
      hasGitSource: false,
      sources: [{ ...source, sourceId: 'folder-a' }]
    }
  ];
  let visible = resources;
  t.mock.method(api, 'listProjectResourceReads', async () => visible);
  function result(
    data: ProjectResourceReadResult['data'],
    outcome: ProjectResourceReadResult['outcome'] = 'ok'
  ): ProjectResourceReadResult {
    return {
      outcome,
      branch: 'main',
      message: null,
      observedAt: '2026-11-27T12:00:00Z',
      truncated: false,
      data
    };
  }
  const read = t.mock.method(
    api,
    'readProjectResource',
    async (_projectId: string, request: ProjectResourceReadRequest) => {
      if (request.resourceKey === 'folder' && request.operation === 'git_status')
        return result(null, 'not_git_repository');
      if (request.operation === 'git_status')
        return result({
          branch: 'main',
          head: null,
          upstream: null,
          ahead: null,
          behind: null,
          staged: [{ path: 'change.txt', originalPath: null, index: 'M', worktree: '.' }],
          unstaged: [],
          conflicted: [],
          untracked: []
        });
      if (request.operation === 'diff')
        return result({
          scope: request.scope,
          diff: '+example diff',
          files: ['change.txt'],
          excludedPaths: []
        });
      if (request.operation === 'list_directory')
        return result({
          relativePath: '',
          nextOffset: null,
          entries: [{ name: 'note.txt', relativePath: 'note.txt', type: 'file' }]
        });
      return result({
        relativePath: 'note.txt',
        totalBytes: 15,
        totalLines: 1,
        startLine: 1,
        endLine: 1,
        content: 'a private note'
      });
    }
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => {
    cleanup();
    client.clear();
  });
  render(
    <QueryClientProvider client={client}>
      <ResourceAccountContext.Provider value="reader">
        <ProjectResourceBrowser projectId="project" />
      </ResourceAccountContext.Provider>
    </QueryClientProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Project Git and Files' }));
  const runner = await screen.findByLabelText('Runner');
  assert.equal(
    read.mock.calls.some(call => call.arguments[1].resourceKey === 'repo'),
    false
  );
  await waitFor(() => assert.equal(Boolean(screen.queryByText('Notes')), false));
  fireEvent.change(runner, { target: { value: 'source-b' } });
  fireEvent.click(await screen.findByRole('button', { name: 'View changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'change.txt' }));
  assert.ok(await screen.findByText('+example diff'));
  const diff = read.mock.calls.find(call => call.arguments[1].operation === 'diff')?.arguments[1];
  assert.deepEqual(diff, {
    operation: 'diff',
    scope: 'staged',
    resourceKey: 'repo',
    sourceId: 'source-b',
    sourceRevision: 1,
    executionTargetId: 'target-b',
    relativePath: 'change.txt'
  });

  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Browse files' }));
  fireEvent.click(await screen.findByRole('button', { name: 'note.txt' }));
  assert.ok(await screen.findByText('a private note'));

  visible = [resources[0]!, { ...resources[1]!, sources: [] }];
  await client.invalidateQueries({ queryKey: ['project-resource-read-catalog'] });
  await waitFor(() => {
    assert.equal(Boolean(screen.queryByText('a private note')), false);
    assert.ok(screen.getByText('No accessible checkout is linked to a runner.'));
  });
});
