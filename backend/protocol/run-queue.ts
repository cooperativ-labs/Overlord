import { type Permission, PERMISSIONS } from '@overlord/auth';

import {
  resolveMissionId,
  resolveObjectiveRef,
  resolveProjectId,
  type ServiceContext
} from '../../packages/core/service/context.ts';
import { ServiceError } from '../../packages/core/service/errors.ts';
import {
  createRunQueue,
  deleteRunQueue,
  enqueueRunQueueEntry,
  listProjectRunQueues,
  moveRunQueueEntry,
  removeRunQueueEntry,
  reorderProjectRunQueues,
  reorderRunQueue,
  updateRunQueue
} from '../../packages/core/service/run-queue.ts';
import { ApiError } from '../errors.ts';
import {
  boolFlag,
  objectiveRefFlag,
  parseJsonInput,
  type ProtocolRequestBody,
  requireFlag,
  strFlag
} from '../protocol.ts';

// ---- Run Queue protocol adapters -----------------------------------------
//
// The `ovld protocol` Run Queue subcommands, split out of backend/protocol.ts:
// flag parsing and queue-reference resolution on top of the same
// packages/core/service/run-queue.ts the REST sibling (backend/run-queue.ts)
// calls. protocol.ts spreads `runQueueHandlers` and
// `runQueueSubcommandPermissions` into its dispatch and permission maps; the
// import back into protocol.ts is for its shared flag helpers only.

type QueueEntryProjection = {
  id: string;
  objectiveId: string;
  objectiveDisplayId: string;
};

type QueueProjection = {
  id: string;
  name: string;
  isDefault: boolean;
  /** Mission this queue belongs to, or `null` for a free-standing project queue. */
  missionId: string | null;
  entries: QueueEntryProjection[];
};

type QueueOrderErrorDetails = {
  currentOrder: string[];
  runningEntryId: string | null;
};

function oneBasedQueuePosition(body: ProtocolRequestBody): number | undefined {
  const raw = strFlag(body, '--position');
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new ApiError(400, '--position must be a positive integer');
  }
  return Number(raw);
}

function queueByRef(queues: QueueProjection[], ref: string): QueueProjection {
  const exactId = queues.find(queue => queue.id === ref);
  if (exactId) return exactId;
  const matches = queues.filter(queue => queue.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new ApiError(409, `Run Queue name is ambiguous in this project: ${ref}`);
  }
  throw new ApiError(404, `Run Queue not found: ${ref}`);
}

/** Resolve a Run Queue's project from its explicit project, objective, or mission scope. */
async function runQueueProjectIdFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<string> {
  const objectiveRef = objectiveRefFlag(body);
  const missionRef = strFlag(body, '--mission-id');
  const objective = objectiveRef
    ? await resolveObjectiveRef({ ctx, ref: objectiveRef, missionId: missionRef })
    : null;
  const mission = missionRef ? await resolveMissionId(ctx, missionRef) : null;
  const projectRef = strFlag(body, '--project-id');

  if (projectRef) {
    const projectId = await resolveProjectId(ctx, projectRef);
    if (objective && projectId !== objective.projectId) {
      throw new ApiError(400, '--project-id does not own the addressed objective');
    }
    if (mission && projectId !== mission.projectId) {
      throw new ApiError(400, '--project-id does not own the addressed mission');
    }
    return projectId;
  }

  if (objective) return objective.projectId;
  if (mission) return mission.projectId;
  throw new ApiError(400, 'Missing required flag: --project-id');
}

async function reorderRunQueueFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const orderedRefs = parseJsonInput<unknown>(
    body,
    '--ordered-entries-json',
    '--ordered-entries-file'
  );
  if (orderedRefs === undefined) {
    throw new ApiError(400, 'Missing required flag: --ordered-entries-json');
  }
  if (!Array.isArray(orderedRefs) || !orderedRefs.every(ref => typeof ref === 'string')) {
    throw new ApiError(
      400,
      '--ordered-entries-json must be a JSON array of entry or objective ids'
    );
  }

  const projectId = await runQueueProjectIdFromProtocol(ctx, body);
  const projection = await listProjectRunQueues(ctx.db, projectId);
  const queue = queueByRef(projection.queues as QueueProjection[], requireFlag(body, '--queue'));
  const orderedEntryIds = orderedRefs.map(ref => {
    const entry = queue.entries.find(
      candidate =>
        candidate.id === ref ||
        candidate.objectiveId === ref ||
        candidate.objectiveDisplayId === ref
    );
    if (!entry) throw new ApiError(404, `Run Queue entry not found: ${ref}`);
    return entry.id;
  });

  try {
    return await reorderRunQueue(ctx.db, queue.id, orderedEntryIds);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;

    const refreshed = await listProjectRunQueues(ctx.db, projectId);
    const currentQueue = refreshed.queues.find(candidate => candidate.id === queue.id);
    const details: QueueOrderErrorDetails = {
      currentOrder: currentQueue?.entries.map(entry => entry.objectiveDisplayId) ?? [],
      runningEntryId: currentQueue?.running?.id ?? null
    };
    throw new ServiceError(error.message, error.code, error.status, details);
  }
}

/** Resolve `--queue` against the addressed project's live queues. */
async function addressedRunQueue(
  ctx: ServiceContext,
  body: ProtocolRequestBody,
  flag: string
): Promise<{ projectId: string; queues: QueueProjection[]; queue: QueueProjection }> {
  const projectId = await runQueueProjectIdFromProtocol(ctx, body);
  const projection = await listProjectRunQueues(ctx.db, projectId);
  const queues = projection.queues as QueueProjection[];
  return { projectId, queues, queue: queueByRef(queues, requireFlag(body, flag)) };
}

async function createRunQueueFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const projectId = await runQueueProjectIdFromProtocol(ctx, body);
  return createRunQueue(
    ctx.db,
    projectId,
    requireFlag(body, '--name'),
    ctx.actorWorkspaceUserId ?? null
  );
}

async function updateRunQueueFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const pause = boolFlag(body, '--pause');
  const resume = boolFlag(body, '--resume');
  if (pause && resume) {
    throw new ApiError(400, 'Choose only one pause option: --pause or --resume');
  }
  const name = strFlag(body, '--name');
  // A rename-nothing, pause-nothing call would succeed silently and teach the
  // caller that an intent landed when nothing changed.
  if (name === undefined && !pause && !resume) {
    throw new ApiError(400, 'Nothing to update: supply --name, --pause, or --resume');
  }

  const { queue } = await addressedRunQueue(ctx, body, '--queue');
  return updateRunQueue(ctx.db, queue.id, {
    ...(name !== undefined ? { name } : {}),
    ...(pause || resume ? { paused: pause } : {})
  });
}

async function deleteRunQueueFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const { queues, queue } = await addressedRunQueue(ctx, body, '--queue');
  const moveRef = strFlag(body, '--move-entries-to');
  const destination = moveRef ? queueByRef(queues, moveRef) : undefined;
  if (destination && destination.id === queue.id) {
    throw new ApiError(400, '--move-entries-to must name a different Run Queue');
  }
  return deleteRunQueue(ctx.db, queue.id, destination?.id);
}

async function reorderProjectRunQueuesFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const orderedRefs = parseJsonInput<unknown>(
    body,
    '--ordered-queues-json',
    '--ordered-queues-file'
  );
  if (orderedRefs === undefined) {
    throw new ApiError(400, 'Missing required flag: --ordered-queues-json');
  }
  if (!Array.isArray(orderedRefs) || !orderedRefs.every(ref => typeof ref === 'string')) {
    throw new ApiError(400, '--ordered-queues-json must be a JSON array of queue ids or names');
  }

  const projectId = await runQueueProjectIdFromProtocol(ctx, body);
  const projection = await listProjectRunQueues(ctx.db, projectId);
  const queues = projection.queues as QueueProjection[];
  const orderedQueueIds = orderedRefs.map(ref => queueByRef(queues, ref).id);
  return reorderProjectRunQueues(ctx.db, projectId, orderedQueueIds);
}

async function queueObjectiveFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<unknown> {
  const objective = await resolveObjectiveRef({
    ctx,
    ref: requireFlag(body, '--objective-id')
  });
  const projectRef = strFlag(body, '--project-id');
  if (projectRef) {
    const projectId = await resolveProjectId(ctx, projectRef);
    if (projectId !== objective.projectId) {
      throw new ApiError(400, '--project-id does not own the addressed objective');
    }
  }

  const hasAfter = strFlag(body, '--after') !== undefined;
  const hasFront = boolFlag(body, '--front');
  const requestedPosition = oneBasedQueuePosition(body);
  if (
    (hasAfter && (hasFront || requestedPosition !== undefined)) ||
    (hasFront && requestedPosition !== undefined)
  ) {
    throw new ApiError(400, 'Choose only one placement option: --after, --front, or --position');
  }

  const projection = await listProjectRunQueues(ctx.db, objective.projectId);
  const queues = projection.queues as QueueProjection[];
  const existing = queues
    .flatMap(queue => queue.entries)
    .find(entry => entry.objectiveId === objective.id);
  const afterRef = strFlag(body, '--after');
  const after = afterRef
    ? queues
        .flatMap(queue => queue.entries.map(entry => ({ ...entry, queueId: queue.id })))
        .find(
          entry =>
            entry.id === afterRef ||
            entry.objectiveId === afterRef ||
            entry.objectiveDisplayId === afterRef
        )
    : undefined;
  if (afterRef && !after) throw new ApiError(404, `Queued predecessor not found: ${afterRef}`);
  if (after?.objectiveId === objective.id) {
    throw new ApiError(400, 'An objective cannot be placed after itself');
  }

  // With no explicit destination the objective's own mission queue wins, then
  // the project default. When the mission has no queue yet `selectedQueue` stays
  // undefined and the enqueue below creates it — queues are never provisioned
  // for a mission before something is actually queued onto it.
  const queueRef = strFlag(body, '--queue');
  const selectedQueue = queueRef
    ? queueByRef(queues, queueRef)
    : after
      ? queues.find(queue => queue.id === after.queueId)
      : existing
        ? queues.find(queue => queue.entries.some(entry => entry.id === existing.id))
        : (queues.find(queue => queue.missionId === objective.missionId) ??
          queues.find(queue => queue.isDefault));
  if (queueRef && !selectedQueue) throw new ApiError(404, `Run Queue not found: ${queueRef}`);
  if (!selectedQueue && (after || existing)) throw new ApiError(404, 'Run Queue not found');
  if (after && selectedQueue && after.queueId !== selectedQueue.id) {
    throw new ApiError(400, 'The queued predecessor belongs to a different Run Queue');
  }

  const entriesWithoutCurrent = (selectedQueue?.entries ?? []).filter(
    entry => entry.id !== existing?.id
  );
  let afterEntryId: string | undefined = after?.id;
  let position: number | undefined;
  if (hasFront) {
    position = 0;
  } else if (requestedPosition !== undefined) {
    if (requestedPosition > entriesWithoutCurrent.length + 1) {
      throw new ApiError(400, '--position is outside the queue insertion range');
    }
    if (requestedPosition === 1) position = 0;
    else afterEntryId = entriesWithoutCurrent[requestedPosition - 2]?.id;
  }

  const wantsMove = Boolean(
    queueRef || afterEntryId || hasFront || requestedPosition !== undefined
  );
  if (existing && !wantsMove) {
    return queues.flatMap(queue => queue.entries).find(entry => entry.id === existing.id)!;
  }
  if (existing) {
    if (!selectedQueue) throw new ApiError(404, 'Run Queue not found');
    return moveRunQueueEntry(ctx.db, existing.id, {
      queueId: selectedQueue.id,
      ...(afterEntryId ? { afterEntryId } : {}),
      ...(position !== undefined ? { position } : {})
    });
  }
  return enqueueRunQueueEntry(ctx.db, objective.projectId, objective.id, {
    ...(selectedQueue ? { queueId: selectedQueue.id } : {}),
    ...(afterEntryId ? { afterEntryId } : {}),
    ...(position !== undefined ? { position } : {}),
    actorId: ctx.actorWorkspaceUserId
  });
}

async function dequeueObjectiveFromProtocol(
  ctx: ServiceContext,
  body: ProtocolRequestBody
): Promise<{ removed: boolean; objectiveId: string }> {
  const objective = await resolveObjectiveRef({
    ctx,
    ref: requireFlag(body, '--objective-id')
  });
  const projectRef = strFlag(body, '--project-id');
  if (projectRef && (await resolveProjectId(ctx, projectRef)) !== objective.projectId) {
    throw new ApiError(400, '--project-id does not own the addressed objective');
  }
  const projection = await listProjectRunQueues(ctx.db, objective.projectId);
  const entry = projection.queues
    .flatMap(queue => queue.entries)
    .find(item => item.objectiveId === objective.id);
  if (!entry) return { removed: false, objectiveId: objective.id };
  await removeRunQueueEntry(ctx.db, entry.id);
  return { removed: true, objectiveId: objective.id };
}

type Handler = (ctx: ServiceContext, body: ProtocolRequestBody) => unknown;

/** Run Queue subcommands, spread into `handlers` in backend/protocol.ts. */
export const runQueueHandlers: Record<string, Handler> = {
  'queue-objective': (ctx, body) => queueObjectiveFromProtocol(ctx, body),

  'dequeue-objective': (ctx, body) => dequeueObjectiveFromProtocol(ctx, body),

  'reorder-run-queue': (ctx, body) => reorderRunQueueFromProtocol(ctx, body),

  'create-run-queue': (ctx, body) => createRunQueueFromProtocol(ctx, body),

  'update-run-queue': (ctx, body) => updateRunQueueFromProtocol(ctx, body),

  'delete-run-queue': (ctx, body) => deleteRunQueueFromProtocol(ctx, body),

  'reorder-project-run-queues': (ctx, body) => reorderProjectRunQueuesFromProtocol(ctx, body),

  'run-queue': async (ctx, body) => {
    const projection = await listProjectRunQueues(
      ctx.db,
      await runQueueProjectIdFromProtocol(ctx, body)
    );
    const queueRef = strFlag(body, '--queue');
    if (!queueRef) return projection;
    return {
      ...projection,
      queues: [queueByRef(projection.queues as QueueProjection[], queueRef)]
    };
  }
};

/**
 * RBAC permission each Run Queue subcommand requires, spread into
 * `SUBCOMMAND_PERMISSIONS` in backend/protocol.ts.
 */
export const runQueueSubcommandPermissions: Record<string, Permission | null> = {
  'queue-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'dequeue-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'reorder-run-queue': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  // Queue definitions are project configuration, matching the REST mapping in
  // backend/run-queue.ts. `project:update` is not in MISSION_LIFECYCLE_GRANTS,
  // so these four are full-token operations by design.
  'create-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'update-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'delete-run-queue': PERMISSIONS.PROJECT_UPDATE,
  'reorder-project-run-queues': PERMISSIONS.PROJECT_UPDATE,
  'run-queue': PERMISSIONS.OBJECTIVE_READ
};
