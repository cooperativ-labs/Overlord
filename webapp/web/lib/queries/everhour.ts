import type {
  CreateEverhourTimeBody,
  LinkProjectEverhourBody,
  UpdateEverhourTimeBody
} from '@overlord/contract/ext/everhour';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import {
  invalidateMissionEverhourQueries,
  invalidateProjectEverhourQueries
} from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

// ---- Everhour integration ------------------------------------------------

/** Caller's Everhour connection state. Used to gate all Everhour UI. */
export const useEverhourIntegration = () =>
  useQuery({ queryKey: keys.everhourIntegration, queryFn: () => api.getEverhourIntegration() });

export function useSetEverhourApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => api.setEverhourApiKey(apiKey),
    onSuccess: data => {
      qc.setQueryData(keys.everhourIntegration, data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useClearEverhourApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearEverhourApiKey(),
    onSuccess: data => {
      qc.setQueryData(keys.everhourIntegration, data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useLinkProjectEverhour(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkProjectEverhourBody) => api.linkProjectEverhour(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhourLink(projectId), data);
      invalidateMissionEverhourQueries(qc);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export const useProjectEverhourLink = (projectId: string, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.projectEverhourLink(projectId),
    queryFn: () => api.getProjectEverhourLink(projectId),
    enabled: options.enabled ?? true
  });

/**
 * Everhour state for one project's fixed `general` task. Only enabled once we
 * know the acting user is connected. Polls while the caller opts in (e.g. a
 * running timer) to keep elapsed time roughly fresh.
 */
export const useProjectEverhour = (
  projectId: string,
  options: { enabled?: boolean; poll?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.projectEverhour(projectId),
    queryFn: () => api.getProjectEverhour(projectId),
    enabled: options.enabled ?? true,
    staleTime: options.poll ? 0 : 5 * 60_000,
    refetchInterval: options.poll ? 15_000 : false
  });

export function useStartProjectTimer(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startProjectTimer(projectId),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhour(projectId), data);
      invalidateMissionEverhourQueries(qc);
    }
  });
}

export function useStopProjectTimer(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopProjectTimer(projectId),
    onSuccess: data => {
      qc.setQueryData(keys.projectEverhour(projectId), data);
      invalidateMissionEverhourQueries(qc);
    }
  });
}

export function useAddProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEverhourTimeBody) => api.addProjectTime(projectId, body),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

export function useUpdateProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: UpdateEverhourTimeBody }) =>
      api.updateProjectTime(projectId, recordId, body),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

export function useDeleteProjectTime(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.deleteProjectTime(projectId, recordId),
    onSuccess: data => qc.setQueryData(keys.projectEverhour(projectId), data)
  });
}

/**
 * Everhour state for one mission. Only enabled once we know the workspace is
 * connected, so a disconnected workspace never hits the proxy. Polls while the
 * caller opts in (e.g. a running timer) to keep elapsed time roughly fresh.
 */
export const useMissionEverhour = (
  id: string,
  options: { enabled?: boolean; poll?: boolean } = {}
) =>
  useQuery({
    queryKey: keys.missionEverhour(id),
    queryFn: () => api.getMissionEverhour(id),
    enabled: options.enabled ?? true,
    staleTime: options.poll ? 0 : 5 * 60_000,
    refetchInterval: options.poll ? 15_000 : false
  });

export function useStartMissionTimer(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startMissionTimer(missionId),
    onSuccess: data => {
      qc.setQueryData(keys.missionEverhour(missionId), data);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useStopMissionTimer(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopMissionTimer(missionId),
    onSuccess: data => {
      qc.setQueryData(keys.missionEverhour(missionId), data);
      invalidateProjectEverhourQueries(qc);
    }
  });
}

export function useAddMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEverhourTimeBody) => api.addMissionTime(missionId, body),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}

export function useUpdateMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, body }: { recordId: string; body: UpdateEverhourTimeBody }) =>
      api.updateMissionTime(missionId, recordId, body),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}

export function useDeleteMissionTime(missionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.deleteMissionTime(missionId, recordId),
    onSuccess: data => qc.setQueryData(keys.missionEverhour(missionId), data)
  });
}
