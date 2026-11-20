import type {
  CreateObjectiveBody,
  ObjectiveAttachmentDto,
  UpdateObjectiveBody
} from '@overlord/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import type { ObjectiveSummaryRequestMode } from '../api/objectives.ts';
import { invalidateNonEverhourQueries as invalidateAll } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

import { createReorderObjectivesMutation } from './optimistic-updates.ts';

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

/**
 * A person's summary edit or Remove (`summary: null`). Sends the revision the editor
 * started from, so a concurrent change answers 409 `summary_conflict` instead of being
 * overwritten. Refetches on error too: after a conflict the card must show the current text.
 */
export function useUpdateObjectiveSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      summary,
      expectedSummaryRevision
    }: {
      id: string;
      summary: string | null;
      expectedSummaryRevision?: number;
    }) =>
      api.updateObjective(id, {
        summary,
        ...(expectedSummaryRevision === undefined ? {} : { expectedSummaryRevision })
      }),
    onSettled: () => invalidateAll(qc)
  });
}

/**
 * Summarize, Regenerate or Retry an objective's summary (ADR 0059). Only a person's
 * Summarize or Regenerate clears a removal; the request returns at once and the worker's
 * result arrives through the realtime refetch.
 */
export function useRequestObjectiveSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: ObjectiveSummaryRequestMode }) =>
      api.requestObjectiveSummary(id, { mode }),
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

// ---- Objective report drafts (read-only, ADR 0078) --------------------------

/**
 * Provisional draft evidence for one objective. Mount it only where the operator asked to see
 * it (an opened disclosure), so a collapsed objective never fetches drafts. Refreshed by
 * `delivery_report_draft` and `agent_session` entity changes scoped to the objective.
 */
export const useObjectiveReportDrafts = (objectiveId: string) =>
  useQuery({
    queryKey: keys.objectiveReportDrafts(objectiveId),
    queryFn: () => api.listObjectiveReportDrafts(objectiveId)
  });

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
 * Reorders a mission's draft queue (every draft and submitted objective) with an
 * optimistic cache update: the new order shows instantly and is reverted only if
 * the server rejects it — including a 409 when the queued set changed under the
 * client, after which the settled refetch shows the current queue. The realtime
 * SSE feed reconciles the cache with server truth on success.
 */
export function useReorderObjectives() {
  const qc = useQueryClient();
  return useMutation(createReorderObjectivesMutation(qc));
}

// ---- Agent launch ----------------------------------------------------------

/**
 * A workspace's agent/model catalog. Pass a `workspaceId` to read the catalog
 * of any workspace the caller is a member of (workspace-equal surfaces such as
 * the workspace settings Models page or a cross-workspace project chooser);
 * omit it for the active workspace.
 */
