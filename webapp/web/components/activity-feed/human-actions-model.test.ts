import assert from 'node:assert/strict';
import test from 'node:test';

import type { HumanActionItemDto } from '../../../shared/contract.ts';

import { groupHumanActions, humanActionCategoryLabel } from './human-actions-model.ts';

function item(overrides: Partial<HumanActionItemDto>): HumanActionItemDto {
  return {
    id: 'human-action:d1:human-action-1',
    deliveryId: 'd1',
    actionId: 'human-action-1',
    action: 'Do the thing',
    reason: null,
    category: 'other',
    blocking: false,
    command: null,
    verify: null,
    link: null,
    source: 'agent',
    workspaceId: 'w1',
    workspaceName: 'Workspace',
    projectId: 'p1',
    projectName: 'Project',
    projectColor: null,
    missionId: 'm1',
    missionDisplayId: 'coo:1',
    missionTitle: 'Mission one',
    objectiveId: 'o1',
    objectiveDisplayId: 'coo:1.aaaa',
    objectiveTitle: null,
    deliveredAt: '2026-09-07T10:00:00.000Z',
    agentIdentifier: 'claude',
    resolution: null,
    ...overrides
  };
}

test('groups by mission then objective, preserving server order', () => {
  const groups = groupHumanActions([
    item({
      id: 'a',
      missionId: 'm2',
      missionDisplayId: 'coo:2',
      objectiveId: 'o3',
      blocking: true
    }),
    item({ id: 'b', missionId: 'm1', objectiveId: 'o1' }),
    item({ id: 'c', missionId: 'm1', objectiveId: 'o2', objectiveDisplayId: 'coo:1.bbbb' }),
    item({ id: 'd', missionId: 'm1', objectiveId: 'o1', actionId: 'human-action-2' })
  ]);

  assert.deepEqual(
    groups.map(group => group.missionId),
    ['m2', 'm1']
  );
  assert.equal(groups[0]!.blocking, true);
  assert.equal(groups[0]!.openCount, 1);
  assert.deepEqual(
    groups[1]!.objectives.map(group => group.objectiveId),
    ['o1', 'o2']
  );
  assert.deepEqual(
    groups[1]!.objectives[0]!.items.map(entry => entry.id),
    ['b', 'd']
  );
  assert.equal(groups[1]!.openCount, 3);
});

test('resolved actions do not count as open or blocking', () => {
  const groups = groupHumanActions([
    item({
      id: 'a',
      blocking: true,
      resolution: {
        status: 'done',
        resolvedAt: '2026-09-07T11:00:00.000Z',
        resolvedByWorkspaceUserId: null
      }
    }),
    item({ id: 'b', actionId: 'human-action-2' })
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.openCount, 1);
  assert.equal(groups[0]!.blocking, false);
});

test('unknown categories fall back to Other', () => {
  assert.equal(humanActionCategoryLabel('database'), 'Database');
  assert.equal(humanActionCategoryLabel('something-new'), 'Other');
});
