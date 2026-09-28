import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ResolveHumanActionBody } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

/**
 * Operator decisions on deferred-work items shown on delivery cards (coo:1045).
 * The realtime link also invalidates the mission's deliveries when a resolution
 * changes; the mutation refreshes them at once so the card never lags.
 */
function useRefreshDeliveries() {
  const qc = useQueryClient();
  return (missionId: string) => {
    void qc.invalidateQueries({ queryKey: keys.missionDeliveries(missionId) });
  };
}

export function useResolveDeferredWork() {
  const refresh = useRefreshDeliveries();
  return useMutation({
    mutationFn: ({
      deliveryId,
      actionId,
      ...body
    }: ResolveHumanActionBody & {
      deliveryId: string;
      actionId: string;
      missionId: string;
    }) => api.resolveDeferredWork(deliveryId, actionId, body),
    onSuccess: (_item, variables) => refresh(variables.missionId)
  });
}

export function useReopenDeferredWork() {
  const refresh = useRefreshDeliveries();
  return useMutation({
    mutationFn: ({
      deliveryId,
      actionId
    }: {
      deliveryId: string;
      actionId: string;
      missionId: string;
    }) => api.reopenDeferredWork(deliveryId, actionId),
    onSuccess: (_item, variables) => refresh(variables.missionId)
  });
}
