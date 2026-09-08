import type {
  AcceptWorkspaceInvitationBody,
  CreateWorkspaceBody,
  InviteWorkspaceMemberBody,
  InviteWorkspaceMemberResultDto,
  UpdateWorkspaceBody,
  UpdateWorkspaceMemberRoleBody,
  WorkspaceDto,
  WorkspaceExecutionTargetDto,
  WorkspaceInvitationDto,
  WorkspaceMemberDto
} from '../../../shared/contract.ts';

import { request, requestDownload } from './request.ts';

export const workspacesApi = {
  listWorkspaces: () => request<WorkspaceDto[]>('GET', '/api/workspaces'),
  createWorkspace: (body: CreateWorkspaceBody) =>
    request<WorkspaceDto>('POST', '/api/workspaces', body),
  updateWorkspace: (id: string, body: UpdateWorkspaceBody) =>
    request<WorkspaceDto>('PATCH', `/api/workspaces/${id}`, body),
  deleteWorkspace: (id: string) => request<WorkspaceDto[]>('DELETE', `/api/workspaces/${id}`),
  listWorkspaceMembers: (id: string) =>
    request<WorkspaceMemberDto[]>('GET', `/api/workspaces/${id}/members`),
  removeWorkspaceMember: (id: string, workspaceUserId: string) =>
    request<{ ok: true }>('DELETE', `/api/workspaces/${id}/members/${workspaceUserId}`),
  updateWorkspaceMemberRole: (
    id: string,
    workspaceUserId: string,
    body: UpdateWorkspaceMemberRoleBody
  ) =>
    request<WorkspaceMemberDto>(
      'PATCH',
      `/api/workspaces/${id}/members/${workspaceUserId}/role`,
      body
    ),
  downloadWorkspaceObjectivesCsv: (id: string) =>
    requestDownload('GET', `/api/workspaces/${id}/objectives.csv`),
  listWorkspaceInvitations: (id: string) =>
    request<WorkspaceInvitationDto[]>('GET', `/api/workspaces/${id}/invitations`),
  inviteWorkspaceMember: (id: string, body: InviteWorkspaceMemberBody) =>
    request<InviteWorkspaceMemberResultDto>('POST', `/api/workspaces/${id}/invitations`, body),
  revokeWorkspaceInvitation: (id: string, invitationId: string) =>
    request<{ ok: true }>('DELETE', `/api/workspaces/${id}/invitations/${invitationId}`),
  acceptWorkspaceInvitation: (body: AcceptWorkspaceInvitationBody) =>
    request<WorkspaceDto>('POST', '/api/invitations/accept', body),

  getWorkspaceExecutionTargets: (workspaceId: string) =>
    request<WorkspaceExecutionTargetDto[]>(
      'GET',
      `/api/workspaces/${workspaceId}/execution-targets`
    ),
  /**
   * Declare the machine this client runs on as an execution target (contract v39).
   * Only meaningful from the desktop shell or CLI: an ordinary browser sends no
   * machine identity and is refused with `no_execution_target_registered`.
   */
  registerWorkspaceExecutionTarget: (workspaceId: string, body: { label?: string } = {}) =>
    request<WorkspaceExecutionTargetDto>(
      'POST',
      `/api/workspaces/${workspaceId}/execution-targets`,
      body
    ),
  updateWorkspaceExecutionTarget: (
    workspaceId: string,
    executionTargetId: string,
    body: { label?: string; status?: 'active' | 'disabled' }
  ) =>
    request<WorkspaceExecutionTargetDto>(
      'PATCH',
      `/api/workspaces/${workspaceId}/execution-targets/${executionTargetId}`,
      body
    ),
  deleteWorkspaceExecutionTarget: (workspaceId: string, executionTargetId: string) =>
    request<{ ok: true }>(
      'DELETE',
      `/api/workspaces/${workspaceId}/execution-targets/${executionTargetId}`
    )
};
