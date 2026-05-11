'use client';

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateProjectResult, SidebarProject } from '@/lib/actions/project-types';
import {
  createProject,
  deleteProjectAction,
  disconnectProjectFromEverhourAction,
  moveProjectToOrganizationAction,
  updateProjectColorAction,
  updateProjectLocalVersionControlAction,
  updateProjectNameAction,
  updateProjectSshConfigAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
import { updateTicketFields } from '@/lib/client-data/tickets/board-reducers';
import type { TicketBoardState } from '@/lib/client-data/tickets/board-types';
import { applyToAllBoards, restoreBoards, snapshotBoards } from '@/lib/client-data/tickets/cache';
import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

type ProjectSnapshot = {
  projects: SidebarProject[] | undefined;
  boards: [readonly unknown[], TicketBoardState][];
};

type CreateProjectInput = {
  organizationId: number;
  name: string;
  color: string;
};

type CreateProjectContext = {
  snapshot: ProjectSnapshot;
  temporaryId: string;
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
    localVersionControl: 'off',
    localVersionControlInstalledAt: null,
    localVersionControlError: null,
    sshHost: null,
    sshPort: null,
    sshUser: null,
    sshAuthMethod: null,
    sshPrivateKeyPath: null,
    remoteHelperInstalledAt: null,
    remoteHelperVersion: null
  } as const;
}

const createProjectWithRetry = withElectronActionRetry(createProject);
const moveProjectToOrganizationWithRetry = withElectronActionRetry(moveProjectToOrganizationAction);
const updateProjectColorWithRetry = withElectronActionRetry(updateProjectColorAction);
const updateProjectNameWithRetry = withElectronActionRetry(updateProjectNameAction);
const updateProjectWorkingDirectoryWithRetry = withElectronActionRetry(
  updateProjectWorkingDirectoryAction
);
const updateProjectLocalVersionControlWithRetry = withElectronActionRetry(
  updateProjectLocalVersionControlAction
);
const updateProjectSshConfigWithRetry = withElectronActionRetry(updateProjectSshConfigAction);
const disconnectProjectFromEverhourWithRetry = withElectronActionRetry(
  disconnectProjectFromEverhourAction
);
const deleteProjectWithRetry = withElectronActionRetry(deleteProjectAction);

function deriveSshCommand(input: {
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
}) {
  if (!input.sshHost || !input.sshUser) return null;
  const port = input.sshPort && input.sshPort !== 22 ? ` -p ${input.sshPort}` : '';
  return `ssh${port} ${input.sshUser}@${input.sshHost}`;
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
  return useMutation<CreateProjectResult, Error, CreateProjectInput, CreateProjectContext>({
    mutationFn: createProjectWithRetry,
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
    mutationFn: updateProjectColorWithRetry,
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
    mutationFn: updateProjectNameWithRetry,
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

  const mutationFn = async (input: { projectId: string; workingDirectory: string | null }) => {
    try {
      await updateProjectWorkingDirectoryWithRetry(input);
    } catch (error) {
      const normalizedWorkingDirectory =
        typeof input.workingDirectory === 'string' ? input.workingDirectory.trim() : '';
      const isClearingDirectory = normalizedWorkingDirectory.length === 0;
      const fallbackMessage = isClearingDirectory
        ? 'Failed to clear the project working directory. Please try again.'
        : `Failed to save "${normalizedWorkingDirectory}" as the project working directory.`;

      if (error instanceof Error) {
        const message = error.message.toLowerCase();

        if (message.includes('must be signed in')) {
          throw new Error('Your session expired. Sign in again to update the working directory.', {
            cause: error
          });
        }
        if (message.includes('row-level security')) {
          throw new Error('You do not have permission to update this project working directory.', {
            cause: error
          });
        }
        if (message.includes('invalid') && message.includes('directory')) {
          throw new Error(
            'The selected path is not valid for this project. Choose a different folder.',
            { cause: error }
          );
        }

        throw new Error(fallbackMessage, { cause: error });
      }

      throw new Error(
        'Something went wrong while updating the project working directory. Please try again.',
        { cause: error }
      );
    }
  };

  return useMutation({
    mutationFn,
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

export function useUpdateProjectLocalVersionControlMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectLocalVersionControlWithRetry,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      patchProjectCache(queryClient, input.projectId, {
        localVersionControl: input.mode,
        localVersionControlInstalledAt: input.installedAt ?? null,
        localVersionControlError: input.error ?? null
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
    mutationFn: updateProjectSshConfigWithRetry,
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
        sshPrivateKeyPath: trim(input.sshPrivateKeyPath),
        sshCommand: deriveSshCommand({
          sshHost: trim(input.sshHost),
          sshPort: input.sshPort ?? null,
          sshUser: trim(input.sshUser)
        })
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
    mutationFn: disconnectProjectFromEverhourWithRetry
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProjectWithRetry,
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

export function useMoveProjectToOrganizationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: moveProjectToOrganizationWithRetry,
    onMutate: input => {
      const snapshot = snapshotProjectState(queryClient);
      patchProjectCache(queryClient, input.projectId, {
        organizationId: input.targetOrganizationId
      });
      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot) restoreProjectState(queryClient, snapshot);
    }
  });
}
