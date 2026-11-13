import type {
  CreateRunQueueBody,
  DeleteRunQueueBody,
  DeleteRunQueueEntryBody,
  EnqueueRunQueueEntryBody,
  ProjectRunQueuesDto,
  RunnerClearBody,
  RunnerClearResultDto,
  RunnerStatusDto,
  RunQueueDto,
  RunQueueEntryDto,
  RunQueueEntryRemovalDto,
  RunQueueRemovalDto,
  UpdateRunQueueBody,
  UpdateRunQueueEntryBody
} from '@overlord/contract';

import { request } from './request.ts';

export const runQueuesApi = {
  getRunnerStatus: () => request<RunnerStatusDto>('GET', '/api/runner/status'),
  getProjectRunQueues: (projectId: string) =>
    request<ProjectRunQueuesDto>('GET', `/api/projects/${projectId}/run-queues`),
  createRunQueue: (projectId: string, body: CreateRunQueueBody) =>
    request<RunQueueDto>('POST', `/api/projects/${projectId}/run-queues`, body),
  reorderProjectRunQueues: (projectId: string, orderedQueueIds: string[]) =>
    request<ProjectRunQueuesDto>('PATCH', `/api/projects/${projectId}/run-queues/order`, {
      orderedQueueIds
    }),
  enqueueRunQueueEntry: (projectId: string, body: EnqueueRunQueueEntryBody) =>
    request<RunQueueEntryDto>('POST', `/api/projects/${projectId}/run-queues/entries`, body),
  updateRunQueue: (queueId: string, body: UpdateRunQueueBody) =>
    request<RunQueueDto>('PATCH', `/api/run-queues/${queueId}`, body),
  deleteRunQueue: (queueId: string, body: DeleteRunQueueBody = {}) =>
    request<RunQueueRemovalDto>('DELETE', `/api/run-queues/${queueId}`, body),
  reorderRunQueue: (queueId: string, orderedEntryIds: string[]) =>
    request<RunQueueDto>('PATCH', `/api/run-queues/${queueId}/order`, { orderedEntryIds }),
  moveRunQueueEntry: (entryId: string, body: Omit<UpdateRunQueueEntryBody, 'retry'>) =>
    request<RunQueueEntryDto>('PATCH', `/api/run-queues/entries/${entryId}`, body),
  /** Clear a held entry's hold and attempt budget so the dispatcher tries again. */
  retryRunQueueEntry: (entryId: string) =>
    request<RunQueueEntryDto>('PATCH', `/api/run-queues/entries/${entryId}`, { retry: true }),
  deleteRunQueueEntry: (entryId: string, body: DeleteRunQueueEntryBody = {}) =>
    request<RunQueueEntryRemovalDto>('DELETE', `/api/run-queues/entries/${entryId}`, body),
  clearRunnerQueue: (body: RunnerClearBody = {}) =>
    request<RunnerClearResultDto>('POST', '/api/runner/clear', body)
};
