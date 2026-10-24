import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { FileChangeDto, ObjectiveFileChangesDto } from '../../../shared/contract.ts';
import { keys } from '../../lib/query-keys.ts';
import { FileChangeRow } from '../FileChangeRow.tsx';
import { LiveFileChangeList } from '../LiveFileChangeList.tsx';

import { ObjectiveFileChangesBody } from './ObjectiveFileChanges.tsx';

afterEach(() => cleanup());

function read(overrides: Partial<ObjectiveFileChangesDto> = {}): ObjectiveFileChangesDto {
  return {
    scope: 'server_objective',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    items: [],
    total: 0,
    limit: 200,
    truncated: false,
    capture: { sessions: [], warnings: [] },
    ...overrides
  };
}

const boundSession = {
  sessionId: 'session-1',
  startedAt: '2026-10-24T09:00:00.000Z',
  bindingState: 'bound' as const,
  callbackObservedAt: null,
  health: []
};

describe('ObjectiveFileChangesBody', () => {
  it('says tracking was unavailable when no capture session exists', () => {
    render(<ObjectiveFileChangesBody projectId="project-1" data={read()} />);
    assert.ok(screen.getByText(/File tracking was not available for this objective/));
    assert.ok(screen.getByText(/Cumulative for this objective/));
  });

  it('distinguishes an empty capture with incomplete tracking and shows the warning', () => {
    render(
      <ObjectiveFileChangesBody
        projectId="project-1"
        data={read({ capture: { sessions: [boundSession], warnings: ['bound_no_callback'] } })}
      />
    );
    assert.ok(screen.getByText(/No file changes were captured, and tracking was incomplete/));
    assert.ok(screen.getByText('File tracking is configured but no callback has been observed.'));
    assert.ok(screen.getByText(/Capture details · 1 session/));
  });

  it('reports a healthy empty capture without warnings', () => {
    render(
      <ObjectiveFileChangesBody
        projectId="project-1"
        data={read({
          capture: {
            sessions: [{ ...boundSession, callbackObservedAt: '2026-10-24T09:01:00.000Z' }],
            warnings: []
          }
        })}
      />
    );
    assert.ok(screen.getByText('No file changes were captured.'));
    assert.equal(screen.queryByRole('status'), null);
  });
});

describe('FileChangeRow', () => {
  const row: FileChangeDto = {
    id: 'fc-1',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    resourceKey: 'primary',
    filePath: 'webapp/web/lib/a, b.ts',
    source: null,
    observedAt: '2026-10-24T10:00:00.000Z',
    hookHealth: null
  };

  it('does not open an unlinked resource under the primary repository', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: 0, retry: false } }
    });
    client.setQueryData(keys.profile, { editorScheme: 'vscode' });
    client.setQueryData(keys.projectExecutionTarget('project-1'), {
      selectedExecutionTargetId: 'target'
    });
    client.setQueryData(keys.projectResources('project-1'), [
      {
        id: 'primary',
        resourceKey: 'primary',
        path: '/repo/primary',
        status: 'active',
        type: 'local_directory',
        executionTargetId: 'target',
        isPrimary: true
      }
    ]);
    const { container } = render(
      <QueryClientProvider client={client}>
        <LiveFileChangeList
          projectId="project-1"
          fileChanges={[
            { ...row, id: 'primary', filePath: 'primary.ts' },
            { ...row, id: 'mobile', resourceKey: 'mobile', filePath: 'mobile.swift' }
          ]}
        />
      </QueryClientProvider>
    );
    assert.equal(container.querySelectorAll('a').length, 1);
    assert.equal(screen.getByText('mobile.swift').closest('a'), null);
    assert.ok(
      screen.getByText('primary.ts').closest('a')?.href.includes('/repo/primary/primary.ts')
    );
    client.clear();
  });

  it('renders basename, directory and an Unknown chip with no prose', () => {
    const { container } = render(
      <ul>
        <FileChangeRow fileChange={row} rootPath={null} editorScheme={null} />
      </ul>
    );
    assert.ok(screen.getByText('a, b.ts'));
    assert.ok(screen.getByText('webapp/web/lib'));
    assert.ok(screen.getByText('Unknown'));
    assert.equal(container.querySelector('a'), null);
  });

  it('labels native and declared provenance', () => {
    render(
      <ul>
        <FileChangeRow
          fileChange={{ ...row, id: 'a', source: 'declared_edit' }}
          rootPath={null}
          editorScheme={null}
        />
        <FileChangeRow
          fileChange={{ ...row, id: 'b', source: 'agent_declared' }}
          rootPath={null}
          editorScheme={null}
        />
      </ul>
    );
    assert.ok(screen.getByText('Native'));
    assert.ok(screen.getByText('Declared'));
  });
});
