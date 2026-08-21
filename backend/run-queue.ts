import { PERMISSIONS } from '@overlord/auth';
import type { DatabaseClient } from '@overlord/database';

import { clearExecutionRequests } from '../packages/core/service/execution-requests.ts';
import {
  createRunQueue as createQueue,
  deleteRunQueue as deleteQueue,
  enqueueRunQueueEntry as enqueueEntry,
  listProjectRunQueues as listQueues,
  moveRunQueueEntry as moveEntry,
  removeRunQueueEntry as removeEntry,
  reorderProjectRunQueues as reorderQueues,
  reorderRunQueue as reorderQueue,
  updateRunQueue as updateQueue
} from '../packages/core/service/run-queue.ts';

import {
  buildWebappServiceContextForWorkspace,
  getActorWorkspaceUserId,
  requireDatabaseClient
} from './db.ts';
import { requireProjectPermission } from './rbac.ts';

async function projectForQueue(db: DatabaseClient, queueId: string): Promise<string> {
  const row = await db.get<{ project_id: string }>(
    'SELECT project_id FROM run_queues WHERE id = ? AND deleted_at IS NULL',
    [queueId]
  );
  if (!row) throw Object.assign(new Error('Run Queue not found'), { status: 404 });
  return row.project_id;
}
async function projectForEntry(db: DatabaseClient, entryId: string): Promise<string> {
  const row = await db.get<{ project_id: string }>(
    'SELECT project_id FROM run_queue_entries WHERE id = ? AND deleted_at IS NULL',
    [entryId]
  );
  if (!row) throw Object.assign(new Error('Run Queue entry not found'), { status: 404 });
  return row.project_id;
}
async function authorize(projectId: string, permission: string, db: DatabaseClient) {
  await requireProjectPermission({ projectId, permission: permission as never, db });
}

export async function getProjectRunQueues(projectId: string) {
  const db = requireDatabaseClient();
  await authorize(projectId, PERMISSIONS.OBJECTIVE_READ, db);
  return listQueues(db, projectId);
}
export async function postProjectRunQueue(
  projectId: string,
  body: { name?: string; missionId?: string | null }
) {
  const db = requireDatabaseClient();
  await authorize(projectId, PERMISSIONS.PROJECT_UPDATE, db);
  return createQueue(
    db,
    projectId,
    body.name ?? '',
    getActorWorkspaceUserId(),
    body.missionId ?? null
  );
}
export async function patchProjectRunQueueOrder(
  projectId: string,
  body: { orderedQueueIds?: string[] }
) {
  const db = requireDatabaseClient();
  await authorize(projectId, PERMISSIONS.PROJECT_UPDATE, db);
  return reorderQueues(db, projectId, body.orderedQueueIds ?? []);
}
export async function patchRunQueue(queueId: string, body: { name?: string; paused?: boolean }) {
  const db = requireDatabaseClient();
  const projectId = await projectForQueue(db, queueId);
  await authorize(projectId, PERMISSIONS.PROJECT_UPDATE, db);
  return updateQueue(db, queueId, body);
}
export async function removeRunQueue(queueId: string, body: { moveEntriesTo?: string } = {}) {
  const db = requireDatabaseClient();
  const projectId = await projectForQueue(db, queueId);
  await authorize(projectId, PERMISSIONS.PROJECT_UPDATE, db);
  return deleteQueue(db, queueId, body.moveEntriesTo);
}
export async function postRunQueueEntry(
  projectId: string,
  body: { objectiveId: string; queueId?: string; afterEntryId?: string; position?: number }
) {
  const db = requireDatabaseClient();
  await authorize(projectId, PERMISSIONS.EXECUTION_REQUEST_CREATE, db);
  return enqueueEntry(db, projectId, body.objectiveId, {
    ...body,
    actorId: getActorWorkspaceUserId()
  });
}
export async function patchRunQueueEntry(
  entryId: string,
  body: { queueId?: string; afterEntryId?: string; position?: number }
) {
  const db = requireDatabaseClient();
  const projectId = await projectForEntry(db, entryId);
  await authorize(projectId, PERMISSIONS.EXECUTION_REQUEST_CREATE, db);
  return moveEntry(db, entryId, body);
}
/**
 * Remove a queue entry. `force` also unsticks an entry wedged in
 * `dispatched`/`running`: its objective's still-active execution requests are
 * cleared and a `launching` objective is reset to `draft`, so an entry whose
 * dispatch never reached a runner stops blocking every future launch.
 */
export async function deleteRunQueueEntry(entryId: string, body: { force?: boolean } = {}) {
  const db = requireDatabaseClient();
  const projectId = await projectForEntry(db, entryId);
  await authorize(projectId, PERMISSIONS.EXECUTION_REQUEST_CREATE, db);
  const force = body.force === true;
  const result = await removeEntry(db, entryId, { force });
  let clearedExecutionRequests = 0;
  if (force) {
    const ctx = await buildWebappServiceContextForWorkspace(
      result.workspaceId,
      db,
      getActorWorkspaceUserId()
    );
    ({ cleared: clearedExecutionRequests } = await clearExecutionRequests({
      ctx,
      objectiveId: result.objectiveId,
      eventSummary: 'Cleared execution request by forced Run Queue removal.'
    }));
  }
  return {
    removed: result.removed,
    forced: force,
    objectiveId: result.objectiveId,
    previousState: result.previousState,
    objectiveReset: result.objectiveReset,
    clearedExecutionRequests,
    removedEmptyQueueId: result.removedEmptyQueueId
  };
}
export async function patchRunQueueOrder(queueId: string, body: { orderedEntryIds?: string[] }) {
  const db = requireDatabaseClient();
  const projectId = await projectForQueue(db, queueId);
  await authorize(projectId, PERMISSIONS.EXECUTION_REQUEST_CREATE, db);
  return reorderQueue(db, queueId, body.orderedEntryIds ?? []);
}
