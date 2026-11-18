import type {
  CreateObjectiveBody,
  ObjectiveAttachmentDto,
  ObjectiveDto,
  ObjectivePromptDto,
  ObjectiveReportDraftList,
  ReorderObjectivesBody,
  UpdateObjectiveBody
} from '@overlord/contract';

/** `{ mode: summarize | regenerate | retry }` (POST /api/objectives/{id}/description-requests). */
export type ObjectiveDescriptionRequestMode = 'summarize' | 'regenerate' | 'retry';

import { request } from './request.ts';

export const objectivesApi = {
  reorderObjectives: (missionId: string, body: ReorderObjectivesBody) =>
    request<ObjectiveDto[]>('PATCH', `/api/missions/${missionId}/objectives/reorder`, body),
  createObjective: (body: CreateObjectiveBody) =>
    request<ObjectiveDto>('POST', '/api/objectives', body),
  updateObjective: (id: string, body: UpdateObjectiveBody) =>
    request<ObjectiveDto>('PATCH', `/api/objectives/${id}`, body),
  /** Summarize / Regenerate / Retry: records durable intent; never waits for the model. */
  requestObjectiveDescription: (id: string, body: { mode: ObjectiveDescriptionRequestMode }) =>
    request<ObjectiveDto>('POST', `/api/objectives/${id}/description-requests`, body),
  deleteObjective: (id: string) => request<{ ok: true }>('DELETE', `/api/objectives/${id}`),
  getObjectivePrompt: (id: string) =>
    request<ObjectivePromptDto>('GET', `/api/objectives/${id}/prompt`),

  /**
   * Read-only provisional draft evidence for one objective (ADR 0078). Never mission items,
   * obligations, seen state or completion; people cannot edit drafts.
   */
  listObjectiveReportDrafts: (objectiveId: string) =>
    request<ObjectiveReportDraftList>('GET', `/api/objectives/${objectiveId}/report-drafts`),

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
