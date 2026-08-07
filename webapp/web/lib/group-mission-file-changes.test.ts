import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileChangeDto, ProjectResourceDto } from '../../shared/contract.ts';

import { groupMissionFileChanges } from './group-mission-file-changes.ts';

function resource(overrides: Partial<ProjectResourceDto> = {}): ProjectResourceDto {
  return {
    id: 'res-1',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    executionTargetId: 'et-1',
    resourceKey: 'primary',
    type: 'local_directory',
    label: 'Overlord',
    path: '/tmp/overlord',
    isPrimary: true,
    accessMode: 'read_write',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    sources: [],
    ...overrides
  };
}

function fileChange(overrides: Partial<FileChangeDto> = {}): FileChangeDto {
  return {
    id: 'fc-1',
    missionId: 'mission-1',
    objectiveId: 'obj-1',
    filePath: 'src/index.ts',
    fileName: 'index.ts',
    label: 'Update entrypoint',
    summary: 'Changed the entrypoint.',
    why: 'Needed for the feature.',
    impact: 'App boots differently.',
    diffState: 'present',
    vcsStatus: 'modified',
    resourceKey: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

test('does not group when the project has only one resource', () => {
  const result = groupMissionFileChanges({
    fileChanges: [
      fileChange({ id: 'fc-1', resourceKey: 'primary' }),
      fileChange({
        id: 'fc-2',
        resourceKey: 'primary',
        filePath: 'README.md',
        fileName: 'README.md'
      })
    ],
    resources: [resource()]
  });

  assert.equal(result.shouldGroup, false);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0]?.fileChanges.length, 2);
});

test('does not group when every change belongs to the same resource', () => {
  const result = groupMissionFileChanges({
    fileChanges: [
      fileChange({ id: 'fc-1', resourceKey: 'mobile' }),
      fileChange({ id: 'fc-2', resourceKey: 'mobile', filePath: 'App.tsx', fileName: 'App.tsx' })
    ],
    resources: [
      resource(),
      resource({
        id: 'res-2',
        resourceKey: 'mobile',
        label: 'Mobile app',
        path: '/tmp/mobile',
        isPrimary: false
      })
    ]
  });

  assert.equal(result.shouldGroup, false);
  assert.equal(result.groups[0]?.resourceLabel, 'Mobile app');
});

test('groups by resource and preserves newest-first order within each group', () => {
  const result = groupMissionFileChanges({
    fileChanges: [
      fileChange({ id: 'fc-1', resourceKey: 'mobile', createdAt: '2026-01-03T00:00:00.000Z' }),
      fileChange({
        id: 'fc-2',
        resourceKey: 'primary',
        filePath: 'webapp/index.ts',
        fileName: 'index.ts',
        createdAt: '2026-01-02T00:00:00.000Z'
      }),
      fileChange({
        id: 'fc-3',
        resourceKey: 'mobile',
        filePath: 'App.tsx',
        fileName: 'App.tsx',
        createdAt: '2026-01-01T00:00:00.000Z'
      })
    ],
    resources: [
      resource(),
      resource({
        id: 'res-2',
        resourceKey: 'mobile',
        label: 'Mobile app',
        path: '/tmp/mobile',
        isPrimary: false
      })
    ]
  });

  assert.equal(result.shouldGroup, true);
  assert.deepEqual(
    result.groups.map(group => group.resourceKey),
    ['mobile', 'primary']
  );
  assert.deepEqual(
    result.groups[0]?.fileChanges.map(change => change.id),
    ['fc-1', 'fc-3']
  );
  assert.equal(result.groups[0]?.resourceLabel, 'Mobile app');
  assert.equal(result.groups[1]?.resourceLabel, 'Overlord');
});
