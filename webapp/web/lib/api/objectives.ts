import type {
  CreateObjectiveBody,
  ObjectiveAttachmentDto,
  ObjectiveDto,
  ObjectivePromptDto,
  ReorderFutureObjectivesBody,
  UpdateObjectiveBody
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const objectivesApi = {
  reorderFutureObjectives: (missionId: string, body: ReorderFutureObjectivesBody) =>
    request<ObjectiveDto[]>('PATCH', `/api/missions/${missionId}/objectives/reorder`, body),
  createObjective: (body: CreateObjectiveBody) =>
    request<ObjectiveDto>('POST', '/api/objectives', body),
  updateObjective: (id: string, body: UpdateObjectiveBody) =>
    request<ObjectiveDto>('PATCH', `/api/objectives/${id}`, body),
  deleteObjective: (id: string) => request<{ ok: true }>('DELETE', `/api/objectives/${id}`),
  getObjectivePrompt: (id: string) =>
    request<ObjectivePromptDto>('GET', `/api/objectives/${id}/prompt`),

  listObjectiveAttachments: (objectiveId: string) =>
    request<ObjectiveAttachmentDto[]>('GET', `/api/objectives/${objectiveId}/attachments`),
  /**
   * Upload a single File as an objective attachment. The raw bytes are sent as
   * the request body; the filename rides in a header so the server can record
   * it without multipart parsing (mirrors the image upload service).
   */
  uploadObjectiveAttachment: (objectiveId: string, file: File) =>
    request<ObjectiveAttachmentDto>('POST', `/api/objectives/${objectiveId}/attachments`, file, {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Filename': encodeURIComponent(file.name)
    }),
  deleteObjectiveAttachment: (objectiveId: string, attachmentId: string) =>
    request<ObjectiveAttachmentDto[]>(
      'DELETE',
      `/api/objectives/${objectiveId}/attachments/${attachmentId}`
    )
};
