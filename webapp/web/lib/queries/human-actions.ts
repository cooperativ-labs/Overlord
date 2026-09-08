import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  HumanActionItemDto,
  HumanActionResolutionStatus,
  HumanActionsDto
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

/**
 * Human follow-up actions from recent deliveries (coo:963). Freshness comes from
 * the realtime link invalidating `keys.humanActions` on delivery and resolution
 * changes; the query itself never polls.
 */
export function useHumanActions(includeResolved = false) {
  return useQuery<HumanActionsDto>({
    queryKey: keys.humanActionsScoped(includeResolved),
    queryFn: () => api.listHumanActions(includeResolved)
  });
}

function patchCachedItem(
  cached: HumanActionsDto | undefined,
  item: HumanActionItemDto,
  includeResolved: boolean
): HumanActionsDto | undefined {
  if (!cached) return cached;
  const wasOpen = cached.items.some(entry => entry.id === item.id && entry.resolution === null);
  const items = cached.items
    .map(entry => (entry.id === item.id ? item : entry))
    .filter(entry => includeResolved || entry.resolution === null);
  if (!items.some(entry => entry.id === item.id) && item.resolution === null) items.unshift(item);
  const openDelta = (item.resolution === null ? 1 : 0) - (wasOpen ? 1 : 0);
  return {
    ...cached,
    items,
    counts: {
      open: Math.max(0, cached.counts.open + openDelta),
      blocking: Math.max(0, cached.counts.blocking + (item.blocking ? openDelta : 0)),
      resolved: Math.max(0, cached.counts.resolved - openDelta)
    }
  };
}

function useApplyResolvedItem() {
  const qc = useQueryClient();
  return (item: HumanActionItemDto) => {
    for (const includeResolved of [false, true]) {
      qc.setQueryData<HumanActionsDto>(keys.humanActionsScoped(includeResolved), cached =>
        patchCachedItem(cached, item, includeResolved)
      );
    }
    void qc.invalidateQueries({ queryKey: keys.humanActions });
    void qc.invalidateQueries({ queryKey: keys.missionDeliveries(item.missionId) });
  };
}

export function useResolveHumanAction() {
  const apply = useApplyResolvedItem();
  return useMutation({
    mutationFn: ({
      deliveryId,
      actionId,
      status
    }: {
      deliveryId: string;
      actionId: string;
      status: HumanActionResolutionStatus;
    }) => api.resolveHumanAction(deliveryId, actionId, { status }),
    onSuccess: apply
  });
}

export function useReopenHumanAction() {
  const apply = useApplyResolvedItem();
  return useMutation({
    mutationFn: ({ deliveryId, actionId }: { deliveryId: string; actionId: string }) =>
      api.reopenHumanAction(deliveryId, actionId),
    onSuccess: apply
  });
}

/** Dismiss every open human action currently shown in the Feed rail. */
export function useClearAllHumanActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items
    }: {
      items: Array<{ deliveryId: string; actionId: string }>;
    }) => {
      if (items.length === 0) return [] as HumanActionItemDto[];
      return Promise.all(
        items.map(({ deliveryId, actionId }) =>
          api.resolveHumanAction(deliveryId, actionId, { status: 'dismissed' })
        )
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.humanActions });
    }
  });
}
