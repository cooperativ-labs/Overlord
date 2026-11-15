import type { ResolveMissionItemBody } from '@overlord/contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

/**
 * A person's close and restore of a mission item (contract v173). Realtime
 * also invalidates on the `mission_item` change; the mutation waits for the
 * summary and delivery refetch itself so the row moves between the open lists
 * and the Resolved group before the control leaves its pending state.
 */
function useRefreshMissionItems() {
  const qc = useQueryClient();
  return (missionId: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.missionSummary(missionId) }),
      qc.invalidateQueries({ queryKey: keys.missionDeliveries(missionId) })
    ]);
}

export function useResolveMissionItem() {
  const refresh = useRefreshMissionItems();
  return useMutation({
    mutationFn: ({ id, ...body }: ResolveMissionItemBody & { id: string; missionId: string }) =>
      api.resolveMissionItem(id, { status: body.status, reason: body.reason ?? null }),
    onSuccess: (_item, variables) => refresh(variables.missionId)
  });
}

export function useRestoreMissionItem() {
  const refresh = useRefreshMissionItems();
  return useMutation({
    mutationFn: ({ id }: { id: string; missionId: string }) => api.restoreMissionItem(id),
    onSuccess: (_item, variables) => refresh(variables.missionId)
  });
}
