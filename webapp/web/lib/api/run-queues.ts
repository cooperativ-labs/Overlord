import type {
  ProjectRunQueuesDto,
  RunQueueDto,
  RunQueueEntryDto
} from '../../../shared/contract.ts';

import { request } from './request.ts';

/** One queued/active execution request as surfaced by `/api/runner/status`. */
export interface RunnerQueueRequest {
  id: string;
  projectId: string | null;
  missionId: string | null;
  objectiveId: string | null;
  requestedAgent: string | null;
  status: string;
  workingDirectory: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Response shape of `GET /api/runner/status`. */
export interface RunnerQueueStatus {
  queue: RunnerQueueRequest[];
  activeCount: number;
}

export const runQueuesApi = {
  getRunnerStatus: () => request<RunnerQueueStatus>('GET', '/api/runner/status'),
  getProjectRunQueues: (projectId: string) =>
    request<ProjectRunQueuesDto>('GET', `/api/projects/${projectId}/run-queues`),
  createRunQueue: (projectId: string, body: { name: string; missionId?: string | null }) =>
    request<RunQueueDto>('POST', `/api/projects/${projectId}/run-queues`, body),
  reorderProjectRunQueues: (projectId: string, orderedQueueIds: string[]) =>
    request<ProjectRunQueuesDto>('PATCH', `/api/projects/${projectId}/run-queues/order`, {
      orderedQueueIds
    }),
  enqueueRunQueueEntry: (
    projectId: string,
    body: { objectiveId: string; queueId?: string; afterEntryId?: string; position?: number }
  ) => request<RunQueueEntryDto>('POST', `/api/projects/${projectId}/run-queues/entries`, body),
  updateRunQueue: (queueId: string, body: { name?: string; paused?: boolean }) =>
    request<RunQueueDto>('PATCH', `/api/run-queues/${queueId}`, body),
  deleteRunQueue: (queueId: string, body: { moveEntriesTo?: string } = {}) =>
    request<{ removed: boolean }>('DELETE', `/api/run-queues/${queueId}`, body),
  reorderRunQueue: (queueId: string, orderedEntryIds: string[]) =>
    request<RunQueueDto>('PATCH', `/api/run-queues/${queueId}/order`, { orderedEntryIds }),
  moveRunQueueEntry: (
    entryId: string,
    body: { queueId?: string; afterEntryId?: string; position?: number }
  ) => request<RunQueueEntryDto>('PATCH', `/api/run-queues/entries/${entryId}`, body),
  /** Clear a held entry's hold and attempt budget so the dispatcher tries again. */
  retryRunQueueEntry: (entryId: string) =>
    request<RunQueueEntryDto>('PATCH', `/api/run-queues/entries/${entryId}`, { retry: true }),
  deleteRunQueueEntry: (entryId: string, body: { force?: boolean } = {}) =>
    request<{
      removed: boolean;
      forced: boolean;
      objectiveReset: boolean;
      clearedExecutionRequests: number;
    }>('DELETE', `/api/run-queues/entries/${entryId}`, body),
  clearRunnerQueue: (body: { objectiveId?: string; projectId?: string } = {}) =>
    request<{ cleared: number }>('POST', '/api/runner/clear', body)
};
