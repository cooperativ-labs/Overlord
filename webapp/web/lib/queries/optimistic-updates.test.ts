import type { QueryClient } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MissionDetailDto, MissionDto, MyMissionsResponse } from '../../../shared/contract.ts';
import { keys } from '../query-keys.ts';

import {
  createReorderBoardColumnMutation,
  createReorderFutureObjectivesMutation,
  createReorderMyMissionsMutation
} from './optimistic-updates.ts';

/** Whether a cached key sits under a prefix, as React Query's matcher does. */
function matchesPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((segment, index) => JSON.stringify(key[index]) === JSON.stringify(segment));
}

function fakeClient(initial: Map<string, unknown>) {
  const calls: string[] = [];
  const entriesUnder = (prefix: readonly unknown[]) =>
    [...initial.keys()]
      .map(serialized => JSON.parse(serialized) as readonly unknown[])
      .filter(key => matchesPrefix(key, prefix));
  const client = {
    cancelQueries: async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      calls.push(`cancel:${JSON.stringify(queryKey)}`);
    },
    getQueryData: (queryKey: readonly unknown[]) => initial.get(JSON.stringify(queryKey)),
    getQueriesData: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      entriesUnder(queryKey).map(key => [key, initial.get(JSON.stringify(key))]),
    setQueryData: (queryKey: readonly unknown[], value: unknown) => {
      calls.push(`set:${JSON.stringify(queryKey)}`);
      initial.set(JSON.stringify(queryKey), value);
    },
    setQueriesData: (
      { queryKey }: { queryKey: readonly unknown[] },
      updater: (current: unknown) => unknown
    ) => {
      for (const key of entriesUnder(queryKey)) {
        const serialized = JSON.stringify(key);
        calls.push(`set:${serialized}`);
        initial.set(serialized, updater(initial.get(serialized)));
      }
    },
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      calls.push(`invalidate:${JSON.stringify(queryKey)}`);
      return Promise.resolve();
    }
  } as unknown as QueryClient;
  return { calls, client, initial };
}

test('board reorder cancels, patches, rolls back, then invalidates the same key', async () => {
  const key = keys.missionsScoped('project-1', 'recent');
  const previous = [
    {
      id: 'mission-1',
      boardPosition: 100,
      sequenceNumber: 1,
      statusId: 'old',
      statusType: 'draft'
    },
    { id: 'mission-2', boardPosition: 200, sequenceNumber: 2, statusId: 'old', statusType: 'draft' }
  ] as unknown as MissionDto[];
  const { calls, client, initial } = fakeClient(new Map([[JSON.stringify(key), previous]]));
  const mutation = createReorderBoardColumnMutation(client);
  const vars = {
    projectId: 'project-1',
    statusId: 'execute',
    statusType: 'execute' as const,
    orderedMissionIds: ['mission-2', 'mission-1']
  };

  const context = await mutation.onMutate(vars);
  assert.equal((initial.get(JSON.stringify(key)) as MissionDto[])[0]?.id, 'mission-2');
  mutation.onError(new Error('nope'), vars, context);
  mutation.onSettled(undefined, undefined, vars);

  assert.deepEqual(calls, [
    'cancel:["project","project-1","missions"]',
    'set:["project","project-1","missions","recent"]',
    'set:["project","project-1","missions","recent"]',
    'invalidate:["project","project-1","missions"]'
  ]);
  assert.equal(initial.get(JSON.stringify(key)), previous);
});

test('my-missions reorder preserves its optimistic lifecycle', async () => {
  const previous = {
    missions: [{ id: 'mission-1', myPosition: 100, statusId: 'old', statusType: 'draft' }]
  } as unknown as MyMissionsResponse;
  const { calls, client, initial } = fakeClient(
    new Map([[JSON.stringify(keys.myMissionsScoped('recent')), previous]])
  );
  const mutation = createReorderMyMissionsMutation(client);
  const vars = {
    statusId: 'execute',
    statusType: 'execute' as const,
    orderedMissionIds: ['mission-1']
  };

  const context = await mutation.onMutate(vars);
  mutation.onError(new Error('nope'), vars, context);
  mutation.onSettled();

  assert.deepEqual(calls, [
    'cancel:["workspace","my-missions"]',
    'set:["workspace","my-missions","recent"]',
    'set:["workspace","my-missions","recent"]',
    'invalidate:["workspace","my-missions"]'
  ]);
  assert.equal(initial.get(JSON.stringify(keys.myMissionsScoped('recent'))), previous);
});

test('future-objective reorder patches, rolls back, and invalidates its mission', async () => {
  const key = keys.mission('mission-1');
  const previous = {
    objectives: [
      { id: 'objective-1', position: 2 },
      { id: 'objective-2', position: 3 }
    ]
  } as unknown as MissionDetailDto;
  const { calls, client, initial } = fakeClient(new Map([[JSON.stringify(key), previous]]));
  const mutation = createReorderFutureObjectivesMutation(client);
  const vars = { missionId: 'mission-1', orderedObjectiveIds: ['objective-2', 'objective-1'] };

  const context = await mutation.onMutate(vars);
  assert.deepEqual(
    (initial.get(JSON.stringify(key)) as MissionDetailDto).objectives.map(
      objective => objective.id
    ),
    ['objective-2', 'objective-1']
  );
  mutation.onError(new Error('nope'), vars, context);
  mutation.onSettled(undefined, undefined, vars);

  assert.deepEqual(calls, [
    'cancel:["mission","mission-1"]',
    'set:["mission","mission-1"]',
    'set:["mission","mission-1"]',
    'invalidate:["mission","mission-1"]'
  ]);
  assert.equal(initial.get(JSON.stringify(key)), previous);
});
