import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateObjectiveBody,
  ObjectiveAttachmentDto,
  UpdateObjectiveBody
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

import { createReorderFutureObjectivesMutation } from './optimistic-updates.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export function useCreateObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateObjectiveBody) => api.createObjective(body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateObjectiveBody }) =>
      api.updateObjective(id, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteObjective(id),
    onSuccess: () => invalidateAll(qc)
  });
}

// ---- Objective attachments -----------------------------------------------

export const useObjectiveAttachments = (
  objectiveId: string,
  { enabled = true }: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.objectiveAttachments(objectiveId),
    queryFn: () => api.listObjectiveAttachments(objectiveId),
    enabled
  });

export function useUploadObjectiveAttachment(objectiveId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadObjectiveAttachment(objectiveId, file),
    onSuccess: attachment => {
      qc.setQueryData<ObjectiveAttachmentDto[]>(keys.objectiveAttachments(objectiveId), prev =>
        prev ? [...prev, attachment] : [attachment]
      );
      void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
    }
  });
}

export function useDeleteObjectiveAttachment(objectiveId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteObjectiveAttachment(objectiveId, attachmentId),
    onSuccess: remaining => {
      qc.setQueryData(keys.objectiveAttachments(objectiveId), remaining);
      void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
    }
  });
}

/**
 * Reorders a mission's future objectives with an optimistic cache update: the new
 * order shows instantly and is reverted only if the server rejects it. The
 * realtime SSE feed reconciles the cache with server truth on success.
 */
export function useReorderFutureObjectives() {
  const qc = useQueryClient();
  return useMutation(createReorderFutureObjectivesMutation(qc));
}

// ---- Agent launch ----------------------------------------------------------

/**
 * A workspace's agent/model catalog. Pass a `workspaceId` to read the catalog
 * of any workspace the caller is a member of (workspace-equal surfaces such as
 * the workspace settings Models page or a cross-workspace project chooser);
 * omit it for the active workspace.
 */
