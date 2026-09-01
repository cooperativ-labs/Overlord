import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';

import type {
  CreateProjectBody,
  CreateProjectResourceBody,
  CreateProjectStatusBody,
  CreateProjectTagBody,
  ProjectDto,
  ProjectListLifecycle,
  ProjectStatusDto,
  ProjectTagDto,
  ReorderProjectsBody,
  ReorderProjectStatusesBody,
  UpdateProjectBody,
  UpdateProjectResourceBody,
  UpdateProjectResourceSourceBody,
  UpdateProjectStatusBody,
  UpdateProjectTagBody
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

import { useMeta } from './profile.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export const useProjects = (workspaceId?: string, lifecycle: ProjectListLifecycle = 'active') => {
  return useQuery({
    queryKey: keys.projects(workspaceId, lifecycle),
    queryFn: () => {
      if (!workspaceId) return Promise.resolve([]);
      return api.listProjectsForWorkspace(workspaceId, lifecycle);
    },
    enabled: Boolean(workspaceId)
  });
};

/**
 * Projects across every accessible workspace of the active organization
 * (coo:324), in `meta.workspaces` order. New-mission surfaces (new mission
 * modal, quick task bar) use this so every workspace the caller is a member
 * of is offered equally; per-workspace cache entries are shared with
 * `useProjects(workspaceId)` via the same query keys.
 */
export const useAllProjects = (lifecycle: ProjectListLifecycle = 'active') => {
  const meta = useMeta();
  const workspaces = meta.data?.workspaces ?? [];

  const combined = useQueries({
    queries: workspaces.map(workspace => ({
      queryKey: keys.projects(workspace.id, lifecycle),
      queryFn: () => api.listProjectsForWorkspace(workspace.id, lifecycle)
    })),
    combine: results => ({
      projects: results.flatMap(result => result.data ?? []),
      anyLoading: results.some(result => result.isLoading),
      anyError: results.some(result => result.isError)
    })
  });

  return {
    data: combined.projects,
    isLoading: meta.isLoading || combined.anyLoading,
    isPending: meta.isPending || combined.anyLoading,
    isError: meta.isError || combined.anyError
  };
};

export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api.getProject(id) });

export const useProjectStatuses = (projectId: string) =>
  useQuery({
    queryKey: keys.projectStatuses(projectId),
    queryFn: () => api.listProjectStatuses(projectId),
    enabled: Boolean(projectId)
  });

export const useWorkspaceProjectStatuses = (workspaceId: string) =>
  useQuery({
    queryKey: keys.workspaceProjectStatuses(workspaceId),
    queryFn: () => api.listWorkspaceProjectStatuses(workspaceId),
    enabled: Boolean(workspaceId)
  });

// Project-scoped queries are routinely mounted before a project is chosen (the
// quick-task bar, the new-mission modal). Without this guard they request
// `/api/projects//resources` and every sibling project route with an empty id,
// which the backend answers 404 — a burst of red herrings in the request log
// that looks like a launch failure and is only an unselected project.
export const useProjectResources = (id: string) =>
  useQuery({
    queryKey: keys.projectResources(id),
    queryFn: () => api.listProjectResources(id),
    enabled: Boolean(id)
  });

export const useProjectTags = (id: string | null) =>
  useQuery({
    queryKey: keys.projectTags(id ?? 'none'),
    queryFn: () => api.listProjectTags(id as string),
    enabled: Boolean(id)
  });

export const useProjectRepository = (
  id: string,
  executionTargetId: string | null,
  resourceKey?: string | null
) =>
  useQuery({
    queryKey: keys.projectRepository(id, executionTargetId, resourceKey ?? null),
    queryFn: () => api.getProjectRepository(id, executionTargetId, resourceKey ?? null),
    enabled: Boolean(id)
  });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) => api.createProject(body),
    onSuccess: () => invalidateAll(qc)
  });
}

function patchProjectInQueryCaches({
  qc,
  updated
}: {
  qc: QueryClient;
  updated: ProjectDto;
}): void {
  qc.setQueryData(keys.project(updated.id), updated);
  qc.setQueryData(keys.projects(updated.workspaceId), (prev: ProjectDto[] | undefined) =>
    prev?.map(project => (project.id === updated.id ? updated : project))
  );
  qc.setQueryData(keys.projects(), (prev: ProjectDto[] | undefined) =>
    prev?.map(project => (project.id === updated.id ? updated : project))
  );
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectBody) => api.updateProject(id, body),
    onSuccess: updated => {
      patchProjectInQueryCaches({ qc, updated });
      invalidateAll(qc);
    }
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useReorderProjects(workspaceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: ReorderProjectsBody) => api.reorderProjects(body),
    onSuccess: data => {
      qc.setQueryData(keys.projects(workspaceId), data);
      void qc.invalidateQueries({ queryKey: keys.projects(workspaceId) });
      invalidateAll(qc);
    }
  });
}

export function useCreateProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectStatusBody) => api.createProjectStatus(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectStatuses(projectId), (prev: ProjectStatusDto[] | undefined) =>
        prev ? [...prev, data].sort((a, b) => a.position - b.position) : [data]
      );
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
    }
  });
}

export function useUpdateProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ statusId, body }: { statusId: string; body: UpdateProjectStatusBody }) =>
      api.updateProjectStatus(projectId, statusId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useDeleteProjectStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statusId: string) => api.deleteProjectStatus(projectId, statusId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useReorderProjectStatuses(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderProjectStatusesBody) => api.reorderProjectStatuses(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectStatuses(projectId), data);
      void qc.invalidateQueries({ queryKey: keys.projectStatuses(projectId) });
      void qc.invalidateQueries({ queryKey: keys.myMissions });
    }
  });
}

export function useCreateProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectTagBody) => api.createProjectTag(projectId, body),
    onSuccess: data => {
      qc.setQueryData(keys.projectTags(projectId), (prev: ProjectTagDto[] | undefined) =>
        prev ? [...prev, data].sort((a, b) => a.label.localeCompare(b.label)) : [data]
      );
      void qc.invalidateQueries({ queryKey: keys.projectTags(projectId) });
    }
  });
}

export function useCreateProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectResourceBody) => api.createProjectResource(projectId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, body }: { resourceId: string; body: UpdateProjectResourceBody }) =>
      api.updateProjectResource(projectId, resourceId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => api.deleteProjectResource(projectId, resourceId),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectResourceSource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceId, sourceId }: { resourceId: string; sourceId: string }) =>
      api.deleteProjectResourceSource(projectId, resourceId, sourceId),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectResourceSource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resourceId,
      sourceId,
      body
    }: {
      resourceId: string;
      sourceId: string;
      body: UpdateProjectResourceSourceBody;
    }) => api.updateProjectResourceSource(projectId, resourceId, sourceId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useUpdateProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, body }: { tagId: string; body: UpdateProjectTagBody }) =>
      api.updateProjectTag(projectId, tagId, body),
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteProjectTag(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => api.deleteProjectTag(projectId, tagId),
    onSuccess: () => invalidateAll(qc)
  });
}

/** Restores an archived project. Takes the project id per call so list rows can share one hook. */
export function useUnarchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.updateProject(id, { status: 'active' }),
    onSuccess: () => invalidateAll(qc)
  });
}
