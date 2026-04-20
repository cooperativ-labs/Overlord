'use client';

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateProjectResult } from '@/lib/actions/projects';
import {
  createProject,
  deleteProjectAction,
  disconnectProjectFromEverhourAction,
  type SidebarProject,
  updateProjectColorAction,
  updateProjectNameAction,
  updateProjectSshConfigAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
import { updateTicketFields } from '@/lib/client-data/tickets/board-reducers';
import type { TicketBoardState } from '@/lib/client-data/tickets/board-types';
import { applyToAllBoards, restoreBoards, snapshotBoards } from '@/lib/client-data/tickets/cache';
import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';

type ProjectSnapshot = {
  projects: SidebarProject[] | undefined;
  boards: [readonly unknown[], TicketBoardState][];
};

function snapshotProjectState(queryClient: QueryClient): ProjectSnapshot {
  return {
    projects: queryClient.getQueryData<SidebarProject[]>(ticketQueryKeys.projects()),
    boards: snapshotBoards(queryClient)
  };
}

function restoreProjectState(queryClient: QueryClient, snapshot: ProjectSnapshot) {
  queryClient.setQueryData(ticketQueryKeys.projects(), snapshot.projects);
  restoreBoards(queryClient, snapshot.boards);
}

function sortProjects(projects: SidebarProject[]) {
  return [...projects].sort((left, right) => left.name.localeCompare(right.name));
}

function patchProjectCache(
  queryClient: QueryClient,
  projectId: string,
  patch: Partial<SidebarProject>
) {
  queryClient.setQueryData<SidebarProject[]>(ticketQueryKeys.projects(), current => {
    if (!current) return current;
    return sortProjects(
      current.map(project => (project.id === projectId ? { ...project, ...patch } : project))
    );
  });

  applyToAllBoards(queryClient, state => {
    let next = state;
    for (const ticket of Object.values(state.ticketsById)) {
      if (ticket.project_id !== projectId) continue;
      next = updateTicketFields(next, ticket.id, {
        project_name: patch.name ?? ticket.project_name,
        project_color: patch.color ?? ticket.project_color
      });
    }
    return next;
  });
}

function removeProjectFromCache(queryClient: QueryClient, projectId: string) {
  queryClient.setQueryData<SidebarProject[]>(ticketQueryKeys.projects(), current =>
    current?.filter(project => project.id !== projectId)
  );
}

function emptySshFields() {
  return {
    localWorkingDirectory: null,
    sshCommand: null,
    remoteWorkingDirectory: null,
    sshHost: null,
    sshPort: null,
    sshUser: null,
    sshAuthMethod: null,
    sshPrivateKeyPath: null,
    remoteHelperInstalledAt: null,
    remoteHelperVersion: null
  } as const;
}

function appendCreatedProject(queryClient: QueryClient, created: CreateProjectResult) {
  const project: SidebarProject = {
    id: created.id,
    name: created.name,
    color: created.color,
    organizationId: created.organizationId,
    ...emptySshFields()
  };

  queryClient.setQueryData<SidebarProject[]>(ticketQueryKeys.projects(), current => {
    const existing = current ?? [];
    if (existing.some(item => item.id === project.id)) return existing;
    return sortProjects([...existing, project]);
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      const temporaryId = `optimistic:${crypto.randomUUID()}`;
      queryClient.setQueryData<SidebarProject[]>(ticketQueryKeys.projects(), current =>
        sortProjects([
          ...(current ?? []),
          {
            id: temporaryId,
            name: input.name.trim(),
            color: input.color.toLowerCase(),
            organizationId: input.organizationId,
            ...emptySshFields()
          }
        ])
      );
      return { snapshot, temporaryId };
    },
    onError: (_error, _input, context) => {
      if (context) restoreProjectState(queryClient, context.snapshot);
    },
    onSuccess: (created, _input, context) => {
      queryClient.setQueryData<SidebarProject[]>(ticketQueryKeys.projects(), current =>
        current?.filter(project => project.id !== context?.temporaryId)
      );
      appendCreatedProject(queryClient, created);
    }
  });
}

export function useUpdateProjectColorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectColorAction,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      patchProjectCache(queryClient, input.projectId, { color: input.color.toLowerCase() });
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}

export function useUpdateProjectNameMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectNameAction,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      patchProjectCache(queryClient, input.projectId, { name: input.name.trim() });
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}

export function useUpdateProjectWorkingDirectoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectWorkingDirectoryAction,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      patchProjectCache(queryClient, input.projectId, {
        localWorkingDirectory:
          typeof input.workingDirectory === 'string' && input.workingDirectory.trim().length > 0
            ? input.workingDirectory.trim()
            : null
      });
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}

export function useUpdateProjectSshConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectSshConfigAction,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      const trim = (value: string | null | undefined) =>
        typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
      patchProjectCache(queryClient, input.projectId, {
        remoteWorkingDirectory: trim(input.remoteWorkingDirectory),
        sshHost: trim(input.sshHost),
        sshPort: input.sshPort ?? null,
        sshUser: trim(input.sshUser),
        sshAuthMethod: input.sshAuthMethod ?? null,
        sshPrivateKeyPath: trim(input.sshPrivateKeyPath)
      });
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}

export function useDisconnectProjectEverhourMutation() {
  return useMutation({
    mutationFn: disconnectProjectFromEverhourAction
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProjectAction,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      removeProjectFromCache(queryClient, input.projectId);
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}
