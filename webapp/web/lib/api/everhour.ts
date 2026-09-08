import type {
  CreateEverhourTimeBody,
  EverhourIntegrationDto,
  LinkProjectEverhourBody,
  MissionEverhourStateDto,
  ProjectEverhourLinkDto,
  ProjectEverhourStateDto,
  UpdateEverhourTimeBody
} from '@overlord/contract/ext/everhour';

import { request } from './request.ts';

export const everhourApi = {
  getEverhourIntegration: () =>
    request<EverhourIntegrationDto>('GET', '/ext/everhour/user-connection'),
  setEverhourApiKey: (apiKey: string) =>
    request<EverhourIntegrationDto>('PUT', '/ext/everhour/user-connection', { apiKey }),
  clearEverhourApiKey: () =>
    request<EverhourIntegrationDto>('DELETE', '/ext/everhour/user-connection'),
  getProjectEverhourLink: (projectId: string) =>
    request<ProjectEverhourLinkDto>('GET', `/ext/everhour/projects/${projectId}/link`),
  linkProjectEverhour: (projectId: string, body: LinkProjectEverhourBody) =>
    request<ProjectEverhourLinkDto>('PUT', `/ext/everhour/projects/${projectId}/link`, body),
  getProjectEverhour: (projectId: string) =>
    request<ProjectEverhourStateDto>('GET', `/ext/everhour/projects/${projectId}`),
  startProjectTimer: (projectId: string) =>
    request<ProjectEverhourStateDto>('POST', `/ext/everhour/projects/${projectId}/timer/start`),
  stopProjectTimer: (projectId: string) =>
    request<ProjectEverhourStateDto>('POST', `/ext/everhour/projects/${projectId}/timer/stop`),
  addProjectTime: (projectId: string, body: CreateEverhourTimeBody) =>
    request<ProjectEverhourStateDto>('POST', `/ext/everhour/projects/${projectId}/time`, body),
  updateProjectTime: (projectId: string, recordId: string, body: UpdateEverhourTimeBody) =>
    request<ProjectEverhourStateDto>(
      'PATCH',
      `/ext/everhour/projects/${projectId}/time/${recordId}`,
      body
    ),
  deleteProjectTime: (projectId: string, recordId: string) =>
    request<ProjectEverhourStateDto>(
      'DELETE',
      `/ext/everhour/projects/${projectId}/time/${recordId}`
    ),
  getMissionEverhour: (missionId: string) =>
    request<MissionEverhourStateDto>('GET', `/ext/everhour/missions/${missionId}`),
  startMissionTimer: (missionId: string) =>
    request<MissionEverhourStateDto>('POST', `/ext/everhour/missions/${missionId}/timer/start`),
  stopMissionTimer: (missionId: string) =>
    request<MissionEverhourStateDto>('POST', `/ext/everhour/missions/${missionId}/timer/stop`),
  addMissionTime: (missionId: string, body: CreateEverhourTimeBody) =>
    request<MissionEverhourStateDto>('POST', `/ext/everhour/missions/${missionId}/time`, body),
  updateMissionTime: (missionId: string, recordId: string, body: UpdateEverhourTimeBody) =>
    request<MissionEverhourStateDto>(
      'PATCH',
      `/ext/everhour/missions/${missionId}/time/${recordId}`,
      body
    ),
  deleteMissionTime: (missionId: string, recordId: string) =>
    request<MissionEverhourStateDto>(
      'DELETE',
      `/ext/everhour/missions/${missionId}/time/${recordId}`
    )
};
