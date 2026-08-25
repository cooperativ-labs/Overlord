import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectRunQueuesDto, RunQueueEntryDto } from '../../../shared/contract.ts';

import { buildEverythingQueuedProjection } from './everything-queued-model.ts';

function queues(
  projectId: string,
  entryId: string,
  overrides: Partial<RunQueueEntryDto> = {}
): ProjectRunQueuesDto {
  return {
    projectId,
    queues: [
      {
        id: `${projectId}-queue`,
        projectId,
        name: 'Run Queue',
        isDefault: true,
        missionId: null,
        missionDisplayId: null,
        paused: false,
        position: 1,
        running: null,
        entries: [
          {
            id: entryId,
            queueId: `${projectId}-queue`,
            position: 1,
            state: 'waiting',
            blockedReason: null,
            objectiveId: `${entryId}-objective`,
            objectiveDisplayId: `coo:786.${entryId}`,
            objectiveTitle: entryId,
            missionId: `${entryId}-mission`,
            missionDisplayId: 'coo:786',
            missionTitle: 'Queue work',
            assignedAgent: null,
            resourceKey: null,
            enqueuedAt: '2026-08-20T00:00:00.000Z',
            executionRequestId: null,
            executionRequest: null,
            diagnosticCode: null,
            ...overrides
          }
        ]
      }
    ]
  };
}

test('filters queue data from projects whose read request was denied', () => {
  const projection = buildEverythingQueuedProjection([
    {
      project: { id: 'allowed', name: 'Visible', workspaceId: 'workspace-a' },
      workspaceName: 'Workspace A',
      queues: queues('allowed', 'visible-entry'),
      readable: true
    },
    {
      project: { id: 'denied', name: 'Hidden', workspaceId: 'workspace-b' },
      workspaceName: 'Workspace B',
      queues: queues('denied', 'hidden-entry'),
      readable: false
    }
  ]);

  assert.deepEqual(
    projection.map(item => item.projectId),
    ['allowed']
  );
  assert.deepEqual(
    projection.flatMap(item => item.queue.entries.map(entry => entry.id)),
    ['visible-entry']
  );
});

test('keeps queue entries scoped to their source project without a global order', () => {
  const projection = buildEverythingQueuedProjection([
    {
      project: { id: 'first', name: 'First', workspaceId: 'workspace-a' },
      workspaceName: 'Workspace A',
      queues: queues('first', 'first-entry'),
      readable: true
    },
    {
      project: { id: 'second', name: 'Second', workspaceId: 'workspace-b' },
      workspaceName: 'Workspace B',
      queues: queues('second', 'second-entry'),
      readable: true
    }
  ]);

  assert.deepEqual(
    projection.map(item => [item.workspaceName, item.projectName, item.queue.entries[0]?.id]),
    [
      ['Workspace A', 'First', 'first-entry'],
      ['Workspace B', 'Second', 'second-entry']
    ]
  );
  assert.deepEqual(
    projection.map(item => item.canMutate),
    [false, false]
  );
});

test('the waiting metadata a hold is rendered from survives the projection', () => {
  const projection = buildEverythingQueuedProjection([
    {
      project: { id: 'allowed', name: 'Visible', workspaceId: 'workspace-a' },
      workspaceName: 'Workspace A',
      queues: queues('allowed', 'held-entry', {
        waitingReason: 'mission_busy',
        waitingOnObjectiveId: 'sibling-objective',
        waitingOnObjectiveDisplayId: 'coo:786.9hm5',
        attemptCount: 1
      }),
      readable: true
    }
  ]);

  const entry = projection[0]?.queue.entries[0];
  assert.deepEqual(
    {
      waitingReason: entry?.waitingReason,
      waitingOnObjectiveDisplayId: entry?.waitingOnObjectiveDisplayId,
      attemptCount: entry?.attemptCount
    },
    { waitingReason: 'mission_busy', waitingOnObjectiveDisplayId: 'coo:786.9hm5', attemptCount: 1 }
  );
});
