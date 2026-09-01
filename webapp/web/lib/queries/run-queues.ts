import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectRunQueuesDto } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { getDesktopBridge } from '../desktop-chrome.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export const useRunnerStatus = (options?: { enabled?: boolean; refetchInterval?: number }) =>
  useQuery({
    queryKey: keys.runnerStatus,
    queryFn: api.getRunnerStatus,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 15_000
  });

/** Project-scoped Run Queue state. Poll while a queue is live so held/running rows stay current. */
export const useProjectRunQueues = (projectId: string) =>
  useQuery<ProjectRunQueuesDto>({
    queryKey: keys.runQueues(projectId),
    queryFn: () => api.getProjectRunQueues(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 10_000
  });

function invalidateRunQueue(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: keys.runQueues(projectId) });
  void qc.invalidateQueries({ queryKey: keys.missions(projectId) });
  invalidateAll(qc);
}

export function useEnqueueRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Omitting `queueId` targets the objective's own mission queue, creating it
    // if the mission does not have one yet.
    mutationFn: (body: { objectiveId: string; queueId?: string; afterEntryId?: string }) =>
      api.enqueueRunQueueEntry(projectId, body),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

/**
 * Remove a queue entry. `force` also clears the objective's stuck execution
 * requests and resets a `launching` objective, which is the only way to
 * recover an entry wedged in flight.
 */
export function useRemoveRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { entryId: string; force?: boolean }) =>
      typeof input === 'string'
        ? api.deleteRunQueueEntry(input)
        : api.deleteRunQueueEntry(input.entryId, input.force ? { force: true } : {}),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

/**
 * Clear a held entry's hold and attempt budget so the dispatcher tries again.
 * Refused for an entry already in flight — force-removal is the way out of that.
 */
export function useRetryRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.retryRunQueueEntry(entryId),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useUpdateRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      queueId,
      body
    }: {
      queueId: string;
      body: { paused?: boolean; name?: string };
    }) => api.updateRunQueue(queueId, body),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useCreateRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { name: string; missionId?: string | null }) =>
      api.createRunQueue(projectId, typeof input === 'string' ? { name: input } : input),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

export function useDeleteRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, moveEntriesTo }: { queueId: string; moveEntriesTo?: string }) =>
      api.deleteRunQueue(queueId, moveEntriesTo ? { moveEntriesTo } : {}),
    onSuccess: () => invalidateRunQueue(qc, projectId)
  });
}

/** Queue definition order is optimistic and restores the prior projection on rejection. */
export function useReorderProjectRunQueues(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedQueueIds: string[]) =>
      api.reorderProjectRunQueues(projectId, orderedQueueIds),
    onMutate: async orderedQueueIds => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
          ...previous,
          queues: orderedQueueIds
            .map(id => previous.queues.find(queue => queue.id === id))
            .filter((queue): queue is NonNullable<typeof queue> => Boolean(queue))
            .map((queue, index) => ({ ...queue, position: index + 1 }))
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/** Cross-queue entry moves update both sections optimistically and recover on rejected writes. */
export function useMoveRunQueueEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      queueId,
      afterEntryId
    }: {
      entryId: string;
      queueId: string;
      afterEntryId?: string;
    }) => api.moveRunQueueEntry(entryId, { queueId, ...(afterEntryId ? { afterEntryId } : {}) }),
    onMutate: async ({ entryId, queueId, afterEntryId }) => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        const entry = previous.queues
          .flatMap(queue => queue.entries)
          .find(item => item.id === entryId);
        if (entry) {
          qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
            ...previous,
            queues: previous.queues.map(queue => {
              const withoutEntry = queue.entries.filter(item => item.id !== entryId);
              if (queue.id !== queueId) {
                return {
                  ...queue,
                  entries: withoutEntry.map((item, index) => ({ ...item, position: index + 1 }))
                };
              }
              const insertAt = afterEntryId
                ? Math.max(0, withoutEntry.findIndex(item => item.id === afterEntryId) + 1)
                : withoutEntry.length;
              const entries = [...withoutEntry];
              entries.splice(insertAt, 0, {
                ...entry,
                queueId,
                state: 'waiting',
                blockedReason: null
              });
              return {
                ...queue,
                entries: entries.map((item, index) => ({ ...item, position: index + 1 }))
              };
            })
          });
        }
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/** Reordering is optimistic and restores the previous queue snapshot on a rejected write. */
export function useReorderRunQueue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, orderedEntryIds }: { queueId: string; orderedEntryIds: string[] }) =>
      api.reorderRunQueue(queueId, orderedEntryIds),
    onMutate: async ({ queueId, orderedEntryIds }) => {
      await qc.cancelQueries({ queryKey: keys.runQueues(projectId) });
      const previous = qc.getQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId));
      if (previous) {
        qc.setQueryData<ProjectRunQueuesDto>(keys.runQueues(projectId), {
          ...previous,
          queues: previous.queues.map(queue =>
            queue.id !== queueId
              ? queue
              : {
                  ...queue,
                  entries: orderedEntryIds
                    .map(id => queue.entries.find(entry => entry.id === id))
                    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                    .map((entry, index) => ({ ...entry, position: index + 1 }))
                }
          )
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(keys.runQueues(projectId), context.previous);
    },
    onSettled: () => invalidateRunQueue(qc, projectId)
  });
}

/**
 * Local persistent-runner service state via the desktop bridge (`ovld runner
 * service status`). Resolves to null in a plain browser or when the bridge call
 * fails, so consumers can quietly fall back to queue-only signals.
 */
export const useRunnerServiceStatus = (options?: { enabled?: boolean }) => {
  const runnerService = getDesktopBridge()?.runnerService;
  return useQuery({
    queryKey: keys.runnerServiceStatus,
    queryFn: async () => {
      if (!runnerService) return null;
      const result = await runnerService.getStatus();
      return result.ok ? (result.status ?? null) : null;
    },
    enabled: (options?.enabled ?? true) && Boolean(runnerService),
    // Each read spawns a CLI process; poll gently and reuse across consumers.
    refetchInterval: 60_000,
    staleTime: 30_000
  });
};
