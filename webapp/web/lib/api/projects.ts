import type {
  CreateProjectBody,
  CreateProjectResourceBody,
  CreateProjectStatusBody,
  CreateProjectTagBody,
  ProjectDto,
  ProjectListLifecycle,
  ProjectRepositoryDto,
  ProjectResourceDto,
  ProjectStatusDto,
  ProjectTagDto,
  RecordMissionBranchObservationsBody,
  RecordMissionBranchObservationsResult,
  RecordTargetResourceObservationsBody,
  RecordTargetResourceObservationsResult,
  ReorderProjectsBody,
  ReorderProjectStatusesBody,
  UpdateProjectBody,
  UpdateProjectResourceBody,
  UpdateProjectResourceSourceBody,
  UpdateProjectStatusBody,
  UpdateProjectTagBody
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const projectsApi = {
  listProjects: (lifecycle: ProjectListLifecycle = 'active') =>
    request<ProjectDto[]>('GET', `/api/projects?lifecycle=${lifecycle}`),
  listProjectsForWorkspace: (workspaceId: string, lifecycle: ProjectListLifecycle = 'active') =>
    request<ProjectDto[]>('GET', `/api/workspaces/${workspaceId}/projects?lifecycle=${lifecycle}`),
  listWorkspaceProjectStatuses: (workspaceId: string) =>
    request<ProjectStatusDto[]>('GET', `/api/workspaces/${workspaceId}/project-statuses`),
  getProject: (id: string) => request<ProjectDto>('GET', `/api/projects/${id}`),
  createProject: (body: CreateProjectBody) => request<ProjectDto>('POST', '/api/projects', body),
  updateProject: (id: string, body: UpdateProjectBody) =>
    request<ProjectDto>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
  reorderProjects: (body: ReorderProjectsBody) =>
    request<ProjectDto[]>('PATCH', `/api/projects/reorder`, body),
  listProjectStatuses: (projectId: string) =>
    request<ProjectStatusDto[]>('GET', `/api/projects/${projectId}/statuses`),
  createProjectStatus: (projectId: string, body: CreateProjectStatusBody) =>
    request<ProjectStatusDto>('POST', `/api/projects/${projectId}/statuses`, body),
  updateProjectStatus: (projectId: string, statusId: string, body: UpdateProjectStatusBody) =>
    request<ProjectStatusDto>('PATCH', `/api/projects/${projectId}/statuses/${statusId}`, body),
  deleteProjectStatus: (projectId: string, statusId: string) =>
    request<{ ok: true }>('DELETE', `/api/projects/${projectId}/statuses/${statusId}`),
  reorderProjectStatuses: (projectId: string, body: ReorderProjectStatusesBody) =>
    request<ProjectStatusDto[]>('PATCH', `/api/projects/${projectId}/statuses/reorder`, body),
  listProjectTags: (id: string) => request<ProjectTagDto[]>('GET', `/api/projects/${id}/tags`),
  createProjectTag: (projectId: string, body: CreateProjectTagBody) =>
    request<ProjectTagDto>('POST', `/api/projects/${projectId}/tags`, body),
  updateProjectTag: (projectId: string, tagId: string, body: UpdateProjectTagBody) =>
    request<ProjectTagDto>('PATCH', `/api/projects/${projectId}/tags/${tagId}`, body),
  deleteProjectTag: (projectId: string, tagId: string) =>
    request<{ ok: true }>('DELETE', `/api/projects/${projectId}/tags/${tagId}`),
  listProjectResources: (id: string) =>
    request<ProjectResourceDto[]>('GET', `/api/projects/${id}/resources`),
  createProjectResource: (projectId: string, body: CreateProjectResourceBody) =>
    request<ProjectResourceDto>('POST', `/api/projects/${projectId}/resources`, body),
  updateProjectResource: (projectId: string, resourceId: string, body: UpdateProjectResourceBody) =>
    request<ProjectResourceDto>(
      'PATCH',
      `/api/projects/${projectId}/resources/${resourceId}`,
      body
    ),
  deleteProjectResource: (projectId: string, resourceId: string) =>
    request<{ ok: true }>('DELETE', `/api/projects/${projectId}/resources/${resourceId}`),
  deleteProjectResourceSource: (projectId: string, resourceId: string, sourceId: string) =>
    request<{ ok: true }>(
      'DELETE',
      `/api/projects/${projectId}/resources/${resourceId}/sources/${sourceId}`
    ),
  updateProjectResourceSource: (
    projectId: string,
    resourceId: string,
    sourceId: string,
    body: UpdateProjectResourceSourceBody
  ) =>
    request<ProjectResourceDto>(
      'PATCH',
      `/api/projects/${projectId}/resources/${resourceId}/sources/${sourceId}`,
      body
    ),
  recordTargetResourceObservations: (
    executionTargetId: string,
    body: RecordTargetResourceObservationsBody
  ) =>
    request<RecordTargetResourceObservationsResult>(
      'POST',
      `/api/execution-targets/${executionTargetId}/observations`,
      body
    ),
  recordMissionBranchObservations: (
    executionTargetId: string,
    body: RecordMissionBranchObservationsBody
  ) =>
    request<RecordMissionBranchObservationsResult>(
      'POST',
      `/api/execution-targets/${executionTargetId}/mission-branch-observations`,
      body
    ),
  getProjectRepository: (
    id: string,
    executionTargetId?: string | null,
    resourceKey?: string | null
  ) => {
    const params = new URLSearchParams();
    if (executionTargetId) params.set('executionTargetId', executionTargetId);
    if (resourceKey) params.set('resourceKey', resourceKey);
    const query = params.toString();
    return request<ProjectRepositoryDto>(
      'GET',
      `/api/projects/${id}/repository${query ? `?${query}` : ''}`
    );
  }
};
