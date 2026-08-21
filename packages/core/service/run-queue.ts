import type { ProjectRunQueuesDto, RunQueueDto, RunQueueEntryDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { ServiceError } from './errors.js';
import { newId, nowIso } from './util.js';
import { enqueueWorkerJob } from './worker-jobs.js';

export const RUN_QUEUE_DISPATCH_JOB_TYPE = 'overlord.run-queue.dispatch.v1';
const STEP = 1000;

type QueueRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  position: number;
  paused: number | boolean;
  is_default: number | boolean;
  mission_id: string | null;
};
type EntryRow = {
  id: string;
  queue_id: string;
  project_id: string;
  workspace_id: string;
  mission_id: string;
  objective_id: string;
  position: number;
  state: RunQueueEntryDto['state'];
  blocked_reason: string | null;
  enqueued_at: string;
  execution_request_id: string | null;
  objective_title: string | null;
  objective_display_key: string;
  assigned_agent: string | null;
  resource_key: string | null;
  mission_display_id: string;
  mission_title: string;
};

const truthy = (value: number | boolean) => value === true || value === 1;

const MISSION_QUEUE_NAME_LIMIT = 80;

/** Human-readable, per-project unique name for a mission-scoped queue. */
export function missionQueueName(missionDisplayId: string, missionTitle: string | null): string {
  const title = (missionTitle ?? '').trim();
  const suffix = title ? ` · ${title}` : '';
  return `${missionDisplayId}${suffix}`.slice(0, MISSION_QUEUE_NAME_LIMIT);
}

export async function enqueueRunQueueDispatch(
  db: DatabaseClient,
  projectId: string,
  workspaceId: string
) {
  return enqueueWorkerJob({
    db,
    workspaceId,
    type: RUN_QUEUE_DISPATCH_JOB_TYPE,
    dedupeBy: { field: 'projectId', value: projectId },
    payload: { projectId }
  });
}

async function projectRow(db: DatabaseClient, projectId: string) {
  const row = await db.get<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM projects WHERE id = ? AND deleted_at IS NULL',
    [projectId]
  );
  if (!row) throw new ServiceError('Project not found', 'project_not_found', 404);
  return row;
}

export async function ensureDefaultRunQueue(
  db: DatabaseClient,
  projectId: string,
  actorId: string | null = null
): Promise<QueueRow> {
  const existing = await db.get<QueueRow>(
    'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE project_id = ? AND is_default = ? AND deleted_at IS NULL',
    [projectId, db.dialect === 'postgres' ? true : 1]
  );
  if (existing) return existing;
  const project = await projectRow(db, projectId);
  const now = nowIso();
  const id = newId();
  await db.run(
    'INSERT INTO run_queues (id, project_id, workspace_id, name, position, paused, is_default, created_by_workspace_user_id, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [
      id,
      projectId,
      project.workspace_id,
      'Run Queue',
      STEP,
      db.dialect === 'postgres' ? false : 0,
      db.dialect === 'postgres' ? true : 1,
      actorId,
      now,
      now
    ]
  );
  return {
    id,
    project_id: projectId,
    workspace_id: project.workspace_id,
    name: 'Run Queue',
    position: STEP,
    paused: false,
    is_default: true,
    mission_id: null
  };
}

/**
 * Resolve the queue that belongs to `missionId`, creating it on first use.
 *
 * Queues are never provisioned up front for every mission. One is created only
 * when a caller actually queues an objective whose mission has no queue yet, or
 * when a user creates a queue by hand. The name is derived from the mission so
 * it reads well in the picker; the per-project unique name index is satisfied by
 * the mission display id, and a manual queue that already owns that exact name
 * is adopted rather than duplicated.
 */
export async function ensureMissionRunQueue(
  db: DatabaseClient,
  projectId: string,
  missionId: string,
  actorId: string | null = null
): Promise<QueueRow> {
  const existing = await db.get<QueueRow>(
    'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE project_id = ? AND mission_id = ? AND deleted_at IS NULL',
    [projectId, missionId]
  );
  if (existing) return existing;
  const mission = await db.get<{
    id: string;
    project_id: string;
    workspace_id: string;
    display_id: string;
    title: string;
  }>(
    'SELECT id, project_id, workspace_id, display_id, title FROM missions WHERE id = ? AND deleted_at IS NULL',
    [missionId]
  );
  if (!mission || mission.project_id !== projectId)
    throw new ServiceError('Mission not found', 'mission_not_found', 404);
  const name = missionQueueName(mission.display_id, mission.title);
  const adopted = await db.get<QueueRow>(
    'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE project_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL',
    [projectId, name]
  );
  const now = nowIso();
  if (adopted) {
    await db.run(
      'UPDATE run_queues SET mission_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [missionId, now, adopted.id]
    );
    return { ...adopted, mission_id: missionId };
  }
  const max = await db.get<{ value: number | null }>(
    'SELECT MAX(position) value FROM run_queues WHERE project_id = ? AND deleted_at IS NULL',
    [projectId]
  );
  const id = newId();
  const position = (max?.value ?? 0) + STEP;
  await db.run(
    'INSERT INTO run_queues (id, project_id, workspace_id, mission_id, name, position, paused, is_default, created_by_workspace_user_id, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [
      id,
      projectId,
      mission.workspace_id,
      missionId,
      name,
      position,
      db.dialect === 'postgres' ? false : 0,
      db.dialect === 'postgres' ? false : 0,
      actorId,
      now,
      now
    ]
  );
  return {
    id,
    project_id: projectId,
    workspace_id: mission.workspace_id,
    name,
    position,
    paused: false,
    is_default: false,
    mission_id: missionId
  };
}

function entryDto(row: EntryRow, rank: number): RunQueueEntryDto {
  return {
    id: row.id,
    queueId: row.queue_id,
    position: rank,
    state: row.state,
    blockedReason: row.blocked_reason,
    objectiveId: row.objective_id,
    objectiveDisplayId: `${row.mission_display_id}.${row.objective_display_key}`,
    objectiveTitle: row.objective_title,
    missionId: row.mission_id,
    missionDisplayId: row.mission_display_id,
    missionTitle: row.mission_title,
    assignedAgent: row.assigned_agent,
    resourceKey: row.resource_key?.trim() || null,
    enqueuedAt: row.enqueued_at,
    executionRequestId: row.execution_request_id
  };
}

export async function listProjectRunQueues(
  db: DatabaseClient,
  projectId: string
): Promise<ProjectRunQueuesDto> {
  await projectRow(db, projectId);
  const queues = await db.all<QueueRow>(
    'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE project_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, position ASC',
    [projectId]
  );
  const rows = await db.all<EntryRow>(
    `SELECT e.*, o.title objective_title, o.display_key objective_display_key, o.assigned_agent, o.resource_key, m.display_id mission_display_id, m.title mission_title FROM run_queue_entries e JOIN objectives o ON o.id = e.objective_id JOIN missions m ON m.id = e.mission_id WHERE e.project_id = ? AND e.deleted_at IS NULL ORDER BY e.position ASC`,
    [projectId]
  );
  const missionIds = queues
    .map(queue => queue.mission_id)
    .filter((value): value is string => Boolean(value));
  const missionRows = missionIds.length
    ? await db.all<{ id: string; display_id: string }>(
        `SELECT id, display_id FROM missions WHERE id IN (${missionIds.map(() => '?').join(',')})`,
        missionIds
      )
    : [];
  const missionDisplayIds = new Map(missionRows.map(row => [row.id, row.display_id]));
  return {
    projectId,
    queues: queues.map(queue => {
      const entries = rows
        .filter(row => row.queue_id === queue.id)
        .map((row, index) => entryDto(row, index + 1));
      return {
        id: queue.id,
        projectId,
        name: queue.name,
        isDefault: truthy(queue.is_default),
        missionId: queue.mission_id,
        missionDisplayId: queue.mission_id
          ? (missionDisplayIds.get(queue.mission_id) ?? null)
          : null,
        paused: truthy(queue.paused),
        position: queue.position,
        entries,
        running: entries.find(e => e.state === 'running' || e.state === 'dispatched') ?? null
      };
    })
  };
}

async function rewriteMissionPositions(db: DatabaseClient, missionId: string) {
  const rows = await db.all<{
    id: string;
    state: string;
    position: number;
    queue_position: number | null;
    queue_order: number | null;
  }>(
    `SELECT o.id, o.state, o.position, e.position queue_position, q.position queue_order FROM objectives o LEFT JOIN run_queue_entries e ON e.objective_id = o.id AND e.deleted_at IS NULL LEFT JOIN run_queues q ON q.id = e.queue_id AND q.deleted_at IS NULL WHERE o.mission_id = ? AND o.deleted_at IS NULL ORDER BY CASE WHEN o.state IN ('executing','pending_delivery','complete') THEN 0 WHEN e.id IS NOT NULL THEN 1 ELSE 2 END, q.position, e.position, o.position`,
    [missionId]
  );
  const now = nowIso();
  // Position has a per-mission uniqueness constraint. Use a high non-negative
  // staging range to avoid swap collisions without violating SQLite's
  // `position >= 0` constraint.
  for (let i = 0; i < rows.length; i++)
    await db.run(
      'UPDATE objectives SET position = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [1_000_000_000 + i, now, rows[i]!.id]
    );
  for (let i = 0; i < rows.length; i++)
    await db.run(
      'UPDATE objectives SET position = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [i, now, rows[i]!.id]
    );
}

export async function createRunQueue(
  db: DatabaseClient,
  projectId: string,
  name: string,
  actorId: string | null,
  missionId: string | null = null
): Promise<RunQueueDto> {
  const project = await projectRow(db, projectId);
  const clean = name.trim();
  if (!clean) throw new ServiceError('Queue name is required', 'invalid_queue_name', 400);
  const max = await db.get<{ value: number | null }>(
    'SELECT MAX(position) value FROM run_queues WHERE project_id = ? AND deleted_at IS NULL',
    [projectId]
  );
  if (missionId) {
    const mission = await db.get<{ id: string }>(
      'SELECT id FROM missions WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
      [missionId, projectId]
    );
    if (!mission) throw new ServiceError('Mission not found', 'mission_not_found', 404);
  }
  const id = newId();
  const now = nowIso();
  await db.run(
    'INSERT INTO run_queues (id, project_id, workspace_id, mission_id, name, position, paused, is_default, created_by_workspace_user_id, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [
      id,
      projectId,
      project.workspace_id,
      missionId,
      clean,
      (max?.value ?? 0) + STEP,
      db.dialect === 'postgres' ? false : 0,
      db.dialect === 'postgres' ? false : 0,
      actorId,
      now,
      now
    ]
  );
  await enqueueRunQueueDispatch(db, projectId, project.workspace_id);
  return (await listProjectRunQueues(db, projectId)).queues.find(q => q.id === id)!;
}

export async function updateRunQueue(
  db: DatabaseClient,
  queueId: string,
  patch: { name?: string; paused?: boolean }
): Promise<RunQueueDto> {
  const queue = await db.get<QueueRow>(
    'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE id = ? AND deleted_at IS NULL',
    [queueId]
  );
  if (!queue) throw new ServiceError('Run Queue not found', 'run_queue_not_found', 404);
  const name = patch.name === undefined ? queue.name : patch.name.trim();
  if (!name) throw new ServiceError('Queue name is required', 'invalid_queue_name', 400);
  const paused = patch.paused === undefined ? truthy(queue.paused) : patch.paused;
  await db.run(
    'UPDATE run_queues SET name = ?, paused = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
    [name, db.dialect === 'postgres' ? paused : paused ? 1 : 0, nowIso(), queueId]
  );
  if (!paused) await enqueueRunQueueDispatch(db, queue.project_id, queue.workspace_id);
  return (await listProjectRunQueues(db, queue.project_id)).queues.find(q => q.id === queueId)!;
}

/** Reorder queue definitions without changing entry membership or objective positions. */
export async function reorderProjectRunQueues(
  db: DatabaseClient,
  projectId: string,
  orderedQueueIds: string[]
): Promise<ProjectRunQueuesDto> {
  return db.transaction(async tx => {
    const queues = await tx.all<QueueRow>(
      'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE project_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, position ASC',
      [projectId]
    );
    if (
      queues.length !== orderedQueueIds.length ||
      new Set(orderedQueueIds).size !== queues.length ||
      queues.some(queue => !orderedQueueIds.includes(queue.id))
    ) {
      throw new ServiceError(
        'orderedQueueIds must contain every live queue exactly once',
        'invalid_run_queue_order',
        400
      );
    }
    const defaultQueue = queues.find(queue => truthy(queue.is_default));
    if (defaultQueue && orderedQueueIds[0] !== defaultQueue.id) {
      throw new ServiceError(
        'The default Run Queue must remain first',
        'default_run_queue_position',
        409
      );
    }
    const now = nowIso();
    for (let index = 0; index < orderedQueueIds.length; index++) {
      await tx.run(
        'UPDATE run_queues SET position = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [(index + 1) * STEP, now, orderedQueueIds[index]]
      );
    }
    return listProjectRunQueues(tx, projectId);
  });
}

export async function enqueueRunQueueEntry(
  db: DatabaseClient,
  projectId: string,
  objectiveId: string,
  options: {
    queueId?: string;
    afterEntryId?: string;
    position?: number;
    actorId?: string | null;
  } = {}
): Promise<RunQueueEntryDto> {
  return db.transaction(async tx => {
    const objective = await tx.get<{
      id: string;
      project_id: string;
      workspace_id: string;
      mission_id: string;
    }>(
      'SELECT id, project_id, workspace_id, mission_id FROM objectives WHERE id = ? AND deleted_at IS NULL',
      [objectiveId]
    );
    if (!objective || objective.project_id !== projectId)
      throw new ServiceError('Objective not found', 'objective_not_found', 404);
    const existing = await tx.get<{ id: string }>(
      'SELECT id FROM run_queue_entries WHERE objective_id = ? AND deleted_at IS NULL',
      [objectiveId]
    );
    if (existing)
      return (await listProjectRunQueues(tx, projectId)).queues
        .flatMap(q => q.entries)
        .find(e => e.id === existing.id)!;
    // No explicit queue means "this objective's own mission queue". It is
    // created on demand here — the only automatic queue creation path — so
    // projects never accumulate a queue per mission before one is needed.
    const queue = options.queueId
      ? await tx.get<QueueRow>(
          'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
          [options.queueId, projectId]
        )
      : await ensureMissionRunQueue(tx, projectId, objective.mission_id, options.actorId ?? null);
    if (!queue) throw new ServiceError('Run Queue not found', 'run_queue_not_found', 404);
    let position = options.position;
    if (options.afterEntryId) {
      const after = await tx.get<{ position: number }>(
        'SELECT position FROM run_queue_entries WHERE id = ? AND queue_id = ? AND deleted_at IS NULL',
        [options.afterEntryId, queue.id]
      );
      if (!after)
        throw new ServiceError('Preceding entry not found', 'run_queue_entry_not_found', 404);
      const next = await tx.get<{ position: number }>(
        'SELECT position FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL AND position > ? ORDER BY position LIMIT 1',
        [queue.id, after.position]
      );
      position = next ? (after.position + next.position) / 2 : after.position + STEP;
    }
    if (position === undefined) {
      const max = await tx.get<{ value: number | null }>(
        'SELECT MAX(position) value FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL',
        [queue.id]
      );
      position = (max?.value ?? 0) + STEP;
    }
    const id = newId();
    const now = nowIso();
    await tx.run(
      `INSERT INTO run_queue_entries (id, queue_id, project_id, workspace_id, mission_id, objective_id, position, state, enqueued_by_workspace_user_id, enqueued_at, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, 1)`,
      [
        id,
        queue.id,
        projectId,
        objective.workspace_id,
        objective.mission_id,
        objectiveId,
        position,
        options.actorId ?? null,
        now,
        now,
        now
      ]
    );
    await tx.run(
      'UPDATE objectives SET auto_advance = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [tx.dialect === 'postgres' ? true : 1, now, objectiveId]
    );
    await rewriteMissionPositions(tx, objective.mission_id);
    await enqueueRunQueueDispatch(tx, projectId, objective.workspace_id);
    return (await listProjectRunQueues(tx, projectId)).queues
      .flatMap(q => q.entries)
      .find(e => e.id === id)!;
  });
}

export type RunQueueEntryRemoval = {
  removed: true;
  projectId: string;
  workspaceId: string;
  missionId: string;
  objectiveId: string;
  /** Entry state at removal time — `dispatched`/`running` means it was in flight. */
  previousState: RunQueueEntryDto['state'];
  /** Execution request the entry had already dispatched, when it had one. */
  executionRequestId: string | null;
  /** True when a forced removal reset a stuck `launching` objective to `draft`. */
  objectiveReset: boolean;
  /** Mission-scoped queue soft-deleted because this removal emptied it. */
  removedEmptyQueueId: string | null;
};

/**
 * Detach an objective from its queue.
 *
 * `force` is the escape hatch for entries wedged in `dispatched`/`running`:
 * besides dropping the entry it clears the dispatch link and resets an objective
 * still parked in `launching` back to `draft`, so it can be launched again.
 * Callers that can build a service context should also clear the objective's
 * active execution requests — see the backend route.
 */
export async function removeRunQueueEntry(
  db: DatabaseClient,
  entryId: string,
  options: { force?: boolean } = {}
): Promise<RunQueueEntryRemoval> {
  return db.transaction(async tx => {
    const row = await tx.get<{
      project_id: string;
      workspace_id: string;
      mission_id: string;
      objective_id: string;
      queue_id: string;
      state: RunQueueEntryDto['state'];
      execution_request_id: string | null;
    }>(
      'SELECT project_id, workspace_id, mission_id, objective_id, queue_id, state, execution_request_id FROM run_queue_entries WHERE id = ? AND deleted_at IS NULL',
      [entryId]
    );
    if (!row) throw new ServiceError('Run Queue entry not found', 'run_queue_entry_not_found', 404);
    const inFlight = row.state === 'dispatched' || row.state === 'running';
    const now = nowIso();
    await tx.run(
      'UPDATE run_queue_entries SET deleted_at = ?, execution_request_id = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [now, now, entryId]
    );
    await tx.run(
      'UPDATE objectives SET auto_advance = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [tx.dialect === 'postgres' ? false : 0, now, row.objective_id]
    );
    // A dispatch that never reached a runner parks the objective in `launching`,
    // where nothing can relaunch it. Forced removal puts it back in `draft`.
    // `executing` is left alone: that objective has a live session a user must
    // end deliberately.
    const objective = await tx.get<{ state: string }>(
      'SELECT state FROM objectives WHERE id = ? AND deleted_at IS NULL',
      [row.objective_id]
    );
    const objectiveReset = options.force === true && inFlight && objective?.state === 'launching';
    if (objectiveReset)
      await tx.run(
        "UPDATE objectives SET state = 'draft', updated_at = ?, revision = revision + 1 WHERE id = ?",
        [now, row.objective_id]
      );
    // A mission queue exists only to hold that mission's work. Retire it once
    // the last entry leaves so projects never silt up with empty queues.
    let removedEmptyQueueId: string | null = null;
    const queue = await tx.get<QueueRow>(
      'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE id = ? AND deleted_at IS NULL',
      [row.queue_id]
    );
    if (queue?.mission_id && !truthy(queue.is_default)) {
      const remaining = await tx.get<{ id: string }>(
        'SELECT id FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL LIMIT 1',
        [queue.id]
      );
      if (!remaining) {
        await tx.run(
          'UPDATE run_queues SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
          [now, now, queue.id]
        );
        removedEmptyQueueId = queue.id;
      }
    }
    await rewriteMissionPositions(tx, row.mission_id);
    await enqueueRunQueueDispatch(tx, row.project_id, row.workspace_id);
    return {
      removed: true,
      projectId: row.project_id,
      workspaceId: row.workspace_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      previousState: row.state,
      executionRequestId: row.execution_request_id,
      objectiveReset,
      removedEmptyQueueId
    };
  });
}

/**
 * Compatibility placement for the legacy auto-advance controls. A newly
 * opted-in objective follows the latest queued sibling from its mission; when
 * the mission has no queued sibling it joins its own mission queue, which is
 * created on demand. This keeps multi-objective agent creation in the authored
 * mission order while leaving unrelated missions independent.
 */
export async function enqueueObjectiveAfterLastQueuedSibling(
  db: DatabaseClient,
  projectId: string,
  objectiveId: string,
  actorId: string | null = null
): Promise<RunQueueEntryDto> {
  const objective = await db.get<{
    id: string;
    mission_id: string;
    position: number;
  }>(
    'SELECT id, mission_id, position FROM objectives WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
    [objectiveId, projectId]
  );
  if (!objective) throw new ServiceError('Objective not found', 'objective_not_found', 404);

  const sibling = await db.get<{ id: string; queue_id: string }>(
    `SELECT e.id, e.queue_id
       FROM run_queue_entries e
       JOIN objectives sibling ON sibling.id = e.objective_id
      WHERE e.project_id = ?
        AND e.mission_id = ?
        AND e.deleted_at IS NULL
        AND sibling.deleted_at IS NULL
        AND (sibling.position < ? OR (sibling.position = ? AND sibling.id <> ?))
      ORDER BY sibling.position DESC, e.position DESC
      LIMIT 1`,
    [projectId, objective.mission_id, objective.position, objective.position, objectiveId]
  );

  return enqueueRunQueueEntry(db, projectId, objectiveId, {
    ...(sibling ? { queueId: sibling.queue_id, afterEntryId: sibling.id } : {}),
    actorId
  });
}

/** Remove live queue membership by objective, treating an already-unqueued row as a no-op. */
export async function removeRunQueueEntryForObjective(
  db: DatabaseClient,
  projectId: string,
  objectiveId: string
): Promise<{ removed: boolean }> {
  const entry = await db.get<{ id: string }>(
    'SELECT id FROM run_queue_entries WHERE project_id = ? AND objective_id = ? AND deleted_at IS NULL',
    [projectId, objectiveId]
  );
  if (!entry) return { removed: false };
  await removeRunQueueEntry(db, entry.id);
  return { removed: true };
}

export async function reorderRunQueue(
  db: DatabaseClient,
  queueId: string,
  orderedEntryIds: string[]
): Promise<RunQueueDto> {
  return db.transaction(async tx => {
    const queue = await tx.get<QueueRow>(
      'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE id = ? AND deleted_at IS NULL',
      [queueId]
    );
    if (!queue) throw new ServiceError('Run Queue not found', 'run_queue_not_found', 404);
    const rows = await tx.all<{ id: string; mission_id: string; state: string }>(
      'SELECT id, mission_id, state FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL ORDER BY position',
      [queueId]
    );
    if (
      rows.length !== orderedEntryIds.length ||
      new Set(orderedEntryIds).size !== rows.length ||
      rows.some(r => !orderedEntryIds.includes(r.id))
    )
      throw new ServiceError(
        'orderedEntryIds must contain every live entry exactly once',
        'invalid_run_queue_order',
        400
      );
    if (
      rows.some(
        r =>
          (r.state === 'running' || r.state === 'dispatched') &&
          orderedEntryIds.indexOf(r.id) !== rows.indexOf(r)
      )
    )
      throw new ServiceError('Running entries cannot be moved', 'run_queue_entry_running', 409);
    const now = nowIso();
    for (let i = 0; i < orderedEntryIds.length; i++)
      await tx.run(
        'UPDATE run_queue_entries SET position = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [(i + 1) * STEP, now, orderedEntryIds[i]]
      );
    for (const missionId of new Set(rows.map(r => r.mission_id)))
      await rewriteMissionPositions(tx, missionId);
    await enqueueRunQueueDispatch(tx, queue.project_id, queue.workspace_id);
    return (await listProjectRunQueues(tx, queue.project_id)).queues.find(q => q.id === queueId)!;
  });
}

export async function moveRunQueueEntry(
  db: DatabaseClient,
  entryId: string,
  options: { queueId?: string; afterEntryId?: string; position?: number }
): Promise<RunQueueEntryDto> {
  return db.transaction(async tx => {
    const current = await tx.get<{
      project_id: string;
      workspace_id: string;
      mission_id: string;
      queue_id: string;
      state: string;
    }>(
      'SELECT project_id, workspace_id, mission_id, queue_id, state FROM run_queue_entries WHERE id = ? AND deleted_at IS NULL',
      [entryId]
    );
    if (!current)
      throw new ServiceError('Run Queue entry not found', 'run_queue_entry_not_found', 404);
    if (current.state === 'running' || current.state === 'dispatched')
      throw new ServiceError('Running entries cannot be moved', 'run_queue_entry_running', 409);
    const queueId = options.queueId ?? current.queue_id;
    const queue = await tx.get<{ id: string }>(
      'SELECT id FROM run_queues WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
      [queueId, current.project_id]
    );
    if (!queue) throw new ServiceError('Run Queue not found', 'run_queue_not_found', 404);
    let position = options.position;
    if (options.afterEntryId) {
      const after = await tx.get<{ position: number }>(
        'SELECT position FROM run_queue_entries WHERE id = ? AND queue_id = ? AND deleted_at IS NULL',
        [options.afterEntryId, queueId]
      );
      if (!after)
        throw new ServiceError('Preceding entry not found', 'run_queue_entry_not_found', 404);
      const next = await tx.get<{ position: number }>(
        'SELECT position FROM run_queue_entries WHERE queue_id = ? AND id <> ? AND deleted_at IS NULL AND position > ? ORDER BY position LIMIT 1',
        [queueId, entryId, after.position]
      );
      position = next ? (after.position + next.position) / 2 : after.position + STEP;
    }
    if (position === undefined) {
      const max = await tx.get<{ value: number | null }>(
        'SELECT MAX(position) value FROM run_queue_entries WHERE queue_id = ? AND id <> ? AND deleted_at IS NULL',
        [queueId, entryId]
      );
      position = (max?.value ?? 0) + STEP;
    }
    await tx.run(
      "UPDATE run_queue_entries SET queue_id = ?, position = ?, state = 'waiting', blocked_reason = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
      [queueId, position, nowIso(), entryId]
    );
    await rewriteMissionPositions(tx, current.mission_id);
    await enqueueRunQueueDispatch(tx, current.project_id, current.workspace_id);
    return (await listProjectRunQueues(tx, current.project_id)).queues
      .flatMap(q => q.entries)
      .find(e => e.id === entryId)!;
  });
}

export async function deleteRunQueue(
  db: DatabaseClient,
  queueId: string,
  moveEntriesTo?: string
): Promise<{ removed: true; projectId: string }> {
  return db.transaction(async tx => {
    const queue = await tx.get<QueueRow>(
      'SELECT id, project_id, workspace_id, name, position, paused, is_default, mission_id FROM run_queues WHERE id = ? AND deleted_at IS NULL',
      [queueId]
    );
    if (!queue) throw new ServiceError('Run Queue not found', 'run_queue_not_found', 404);
    if (truthy(queue.is_default))
      throw new ServiceError('The default Run Queue cannot be deleted', 'default_run_queue', 409);
    const entries = await tx.all<{ id: string; mission_id: string }>(
      'SELECT id, mission_id FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL',
      [queueId]
    );
    if (entries.length && !moveEntriesTo)
      throw new ServiceError(
        'moveEntriesTo is required for a non-empty queue',
        'run_queue_not_empty',
        409
      );
    if (moveEntriesTo) {
      const target = await tx.get<{ id: string }>(
        'SELECT id FROM run_queues WHERE id = ? AND project_id = ? AND deleted_at IS NULL',
        [moveEntriesTo, queue.project_id]
      );
      if (!target)
        throw new ServiceError('Destination Run Queue not found', 'run_queue_not_found', 404);
      const max = await tx.get<{ value: number | null }>(
        'SELECT MAX(position) value FROM run_queue_entries WHERE queue_id = ? AND deleted_at IS NULL',
        [moveEntriesTo]
      );
      for (let i = 0; i < entries.length; i++)
        await tx.run(
          'UPDATE run_queue_entries SET queue_id = ?, position = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
          [moveEntriesTo, (max?.value ?? 0) + (i + 1) * STEP, nowIso(), entries[i]!.id]
        );
    }
    const now = nowIso();
    await tx.run(
      'UPDATE run_queues SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
      [now, now, queueId]
    );
    for (const missionId of new Set(entries.map(e => e.mission_id)))
      await rewriteMissionPositions(tx, missionId);
    await enqueueRunQueueDispatch(tx, queue.project_id, queue.workspace_id);
    return { removed: true, projectId: queue.project_id };
  });
}
