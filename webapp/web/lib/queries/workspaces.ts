import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AcceptWorkspaceInvitationBody,
  CreateWorkspaceBody,
  InviteWorkspaceMemberBody,
  UpdateWorkspaceBody,
  UpdateWorkspaceMemberRoleBody,
  WorkspaceExecutionTargetDto
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { invalidateNonEverhourQueries } from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

import { useMeta } from './profile.ts';

function invalidateAll(qc: QueryClient) {
  invalidateNonEverhourQueries(qc);
}

export const useWorkspaceExecutionTargets = (workspaceId: string) =>
  useQuery<WorkspaceExecutionTargetDto[]>({
    queryKey: keys.workspaceExecutionTargets(workspaceId),
    queryFn: () => api.getWorkspaceExecutionTargets(workspaceId),
    staleTime: 30_000
  });

export function useDeleteWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (executionTargetId: string) =>
      api.deleteWorkspaceExecutionTarget(workspaceId, executionTargetId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useRegisterWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string } = {}) =>
      api.registerWorkspaceExecutionTarget(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useRenameWorkspaceExecutionTarget(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ executionTargetId, label }: { executionTargetId: string; label: string }) =>
      api.updateWorkspaceExecutionTarget(workspaceId, executionTargetId, { label }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export function useUpdateWorkspaceExecutionTargetStatus(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      executionTargetId,
      status
    }: {
      executionTargetId: string;
      status: 'active' | 'disabled';
    }) => api.updateWorkspaceExecutionTarget(workspaceId, executionTargetId, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspaceExecutionTargets(workspaceId) });
      invalidateNonEverhourQueries(qc);
    }
  });
}

export const useAccessibleWorkspaces = () => {
  const meta = useMeta();
  return meta.data?.workspaces ?? [];
};

export const useWorkspaces = () =>
  useQuery({ queryKey: keys.workspaces, queryFn: api.listWorkspaces });

export const useWorkspaceMembers = (id: string | null) =>
  useQuery({
    queryKey: keys.workspaceMembers(id ?? '__none__'),
    queryFn: () => api.listWorkspaceMembers(id ?? ''),
    enabled: Boolean(id)
  });

export const useWorkspaceInvitations = (id: string | null) =>
  useQuery({
    queryKey: keys.workspaceInvitations(id ?? '__none__'),
    queryFn: () => api.listWorkspaceInvitations(id ?? ''),
    enabled: Boolean(id)
  });

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceBody) => api.createWorkspace(body),
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWorkspaceBody }) =>
      api.updateWorkspace(id, body),
    // Renaming the active workspace also changes the sidebar identity (meta).
    onSuccess: () => invalidateAll(qc)
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}

export function useInviteWorkspaceMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteWorkspaceMemberBody) => api.inviteWorkspaceMember(workspaceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceInvitations(workspaceId) })
  });
}

export function useRevokeWorkspaceInvitation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => api.revokeWorkspaceInvitation(workspaceId, invitationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceInvitations(workspaceId) })
  });
}

export function useRemoveWorkspaceMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceUserId: string) =>
      api.removeWorkspaceMember(workspaceId, workspaceUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceMembers(workspaceId) })
  });
}

export function useUpdateWorkspaceMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceUserId,
      body
    }: {
      workspaceUserId: string;
      body: UpdateWorkspaceMemberRoleBody;
    }) => api.updateWorkspaceMemberRole(workspaceId, workspaceUserId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaceMembers(workspaceId) })
  });
}

export function useAcceptWorkspaceInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AcceptWorkspaceInvitationBody) => api.acceptWorkspaceInvitation(body),
    // Accepting grants a brand-new workspace membership, so the whole cache is stale.
    onSuccess: () => {
      invalidateAll(qc);
    }
  });
}
