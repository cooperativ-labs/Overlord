import { planRunQueueDispatch } from '@overlord/automations';
import { OBJECTIVE_LAUNCHED_AT_ASSIGNMENT } from '@overlord/core/service/objective-lifecycle-timestamps';
import type { DatabaseClient } from '@overlord/database';

import { sanitizeDispatchFailure } from '../packages/core/service/dispatch-diagnostics.ts';
import {
  ACTIVE_EXECUTION_REQUEST_STATUSES,
  createExecutionRequest
} from '../packages/core/service/execution-requests.ts';
import { findSiblingLockHolders } from '../packages/core/service/objective-parallelism.ts';
import {
  resolveLaunchConfig,
  resolveLaunchExecutionTarget
} from '../packages/core/service/project-execution-target.ts';
import { RUN_QUEUE_DISPATCH_JOB_TYPE } from '../packages/core/service/run-queue.ts';
import { enqueueRunQueueDispatch } from '../packages/core/service/run-queue.ts';
import { nowIso } from '../packages/core/service/util.ts';
import type { ClaimedWorkerJob } from '../packages/core/service/worker-jobs.ts';

import { buildWebappServiceContextForWorkspace, requireDatabaseClient } from './db.ts';
import { WorkerJobPoller } from './worker-job-poller.ts';

type QueueRow = { id: string; paused: number | boolean; position: number };
type EntryRow = {
  id: string;
  queue_id: string;
  objective_id: string;
  position: number;
  state: 'waiting' | 'blocked' | 'dispatched' | 'running';
  blocked_reason: string | null;
  waiting_reason: string | null;
  waiting_on_objective_id: string | null;
  attempt_count: number;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  enqueued_by_workspace_user_id: string | null;
};
type MissionRow = { id: string; allow_parallel_objectives: number | boolean };
type ObjectiveRow = {
  id: string;
  state: string;
  instruction_text: string;
  assigned_agent: string | null;
  model: string | null;
  reasoning_effort: string | null;
  launch_config_json: string | null;
  resource_key: string | null;
  mission_id: string;
  project_id: string;
  workspace_id: string;
  deleted_at: string | null;
};

function parseProjectId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as { projectId?: unknown };
    return typeof value.projectId === 'string' && value.projectId ? value.projectId : null;
  } catch {
    return null;
  }
}

type FailureKind = 'dispatch_failed' | 'request_failed';

/**
 * Which failure a hold's detail text records (`dispatch_failed: …` or
 * `request_failed: …`), if any. A `wait('retry_pending')` written by a failed
 * attempt keeps that detail when the attempt ceiling turns it into a `block`,
 * because it is the only record of *why* the attempts were consumed.
 */
function entryFailureKind(entry: EntryRow): FailureKind | undefined {
  if (entry.blocked_reason?.startsWith('request_failed')) return 'request_failed';
  if (entry.blocked_reason?.startsWith('dispatch_failed')) return 'dispatch_failed';
  return undefined;
}

/**
 * Persist one planner decision. The planner re-evaluates every non-in-flight
 * entry on every tick, so these writes must be no-ops when nothing changed —
 * otherwise a queue holding a blocked entry would bump `revision` and emit a
 * change event every 60 s sweep forever.
 */
function entryHoldIsUnchanged(
  entry: EntryRow,
  next: {
    state: 'waiting' | 'blocked';
    waitingReason: string | null;
    waitingOnObjectiveId: string | null;
    blockedReason: string | null;
  }
): boolean {
  return (
    entry.state === next.state &&
    (entry.waiting_reason ?? null) === next.waitingReason &&
    (entry.waiting_on_objective_id ?? null) === next.waitingOnObjectiveId &&
    (entry.blocked_reason ?? null) === next.blockedReason
  );
}

export async function dispatchProjectRunQueues(
  db: DatabaseClient,
  projectId: string
): Promise<void> {
  const queues = await db.all<QueueRow>(
    'SELECT id, paused, position FROM run_queues WHERE project_id = ? AND deleted_at IS NULL ORDER BY position',
    [projectId]
  );
  const entries = await db.all<EntryRow>(
    'SELECT id, queue_id, objective_id, position, state, blocked_reason, waiting_reason, waiting_on_objective_id, attempt_count, workspace_id, project_id, mission_id, enqueued_by_workspace_user_id FROM run_queue_entries WHERE project_id = ? AND deleted_at IS NULL ORDER BY position',
    [projectId]
  );
  const objectiveRows = await db.all<ObjectiveRow>(
    `SELECT o.id, o.state, o.instruction_text, o.assigned_agent, o.model, o.reasoning_effort, o.launch_config_json, o.resource_key, o.mission_id, o.project_id, o.workspace_id, o.deleted_at FROM objectives o WHERE o.id IN (${entries.map(() => '?').join(',') || "''"})`,
    entries.map(e => e.objective_id)
  );
  const objectives: Record<
    string,
    {
      id: string;
      missionId: string;
      state: string;
      instructionText: string;
      assignedAgent: string | null;
      deleted: boolean;
    }
  > = {};
  for (const objective of objectiveRows)
    objectives[objective.id] = {
      id: objective.id,
      missionId: objective.mission_id,
      state: objective.state,
      instructionText: objective.instruction_text,
      assignedAgent: objective.assigned_agent,
      deleted: Boolean(objective.deleted_at)
    };

  // One busy/allow-parallel row per distinct mission, not one query per
  // objective, and computed with the same sibling-lock predicate the direct-Run
  // path uses so the two entry points cannot disagree.
  const missionIds = [...new Set(entries.map(entry => entry.mission_id))];
  const workspaceId = entries[0]?.workspace_id ?? null;
  const missionRows = missionIds.length
    ? await db.all<MissionRow>(
        `SELECT id, allow_parallel_objectives FROM missions WHERE id IN (${missionIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        missionIds
      )
    : [];
  const lockHolders = workspaceId
    ? await findSiblingLockHolders({ db, workspaceId, missionIds })
    : [];
  const missions: Record<string, { allowParallelObjectives: boolean; busyObjectiveIds: string[] }> =
    {};
  for (const mission of missionRows)
    missions[mission.id] = {
      allowParallelObjectives:
        mission.allow_parallel_objectives === true || mission.allow_parallel_objectives === 1,
      busyObjectiveIds: []
    };
  for (const holder of lockHolders)
    missions[holder.missionId]?.busyObjectiveIds.push(holder.objectiveId);

  const actions = planRunQueueDispatch({
    queues: queues.map(q => ({
      id: q.id,
      paused: q.paused === true || q.paused === 1,
      position: q.position
    })),
    entries: entries.map(e => ({
      id: e.id,
      queueId: e.queue_id,
      objectiveId: e.objective_id,
      position: e.position,
      state: e.state,
      attemptCount: e.attempt_count,
      failureKind: entryFailureKind(e)
    })),
    objectives,
    missions
  });
  for (const action of actions) {
    const entry = entries.find(e => e.id === action.entryId);
    if (!entry) continue;
    const now = nowIso();
    if (action.action === 'drop') {
      await db.run(
        'UPDATE run_queue_entries SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
        [now, now, entry.id]
      );
      continue;
    }
    if (action.action === 'wait') {
      // A `retry_pending` hold keeps the detail explaining the attempt that
      // failed; every other wait clears it — the entry is not failing, it is
      // simply not its turn.
      const next = {
        state: 'waiting' as const,
        waitingReason: action.reason,
        waitingOnObjectiveId: action.waitingOnObjectiveId ?? null,
        blockedReason:
          action.reason === 'retry_pending' && entryFailureKind(entry) ? entry.blocked_reason : null
      };
      if (entryHoldIsUnchanged(entry, next)) continue;
      await db.run(
        "UPDATE run_queue_entries SET state = 'waiting', waiting_reason = ?, waiting_on_objective_id = ?, blocked_reason = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND state IN ('waiting','blocked')",
        [next.waitingReason, next.waitingOnObjectiveId, next.blockedReason, now, entry.id]
      );
      continue;
    }
    if (action.action === 'block') {
      const next = {
        state: 'blocked' as const,
        waitingReason: null,
        waitingOnObjectiveId: null,
        blockedReason:
          entryFailureKind(entry) === action.reason ? entry.blocked_reason : action.reason
      };
      if (entryHoldIsUnchanged(entry, next)) continue;
      await db.run(
        "UPDATE run_queue_entries SET state = 'blocked', blocked_reason = ?, waiting_reason = NULL, waiting_on_objective_id = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND state IN ('waiting','blocked')",
        [next.blockedReason, now, entry.id]
      );
      continue;
    }
    if (action.action === 'mark_running') {
      if (entry.state === 'running') continue;
      await db.run(
        "UPDATE run_queue_entries SET state = 'running', blocked_reason = NULL, waiting_reason = NULL, waiting_on_objective_id = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
        [now, entry.id]
      );
      continue;
    }
    const objective = objectiveRows.find(o => o.id === action.objectiveId);
    if (!objective) continue;
    try {
      await db.transaction(async tx => {
        const ctx = await buildWebappServiceContextForWorkspace(
          entry.workspace_id,
          tx,
          entry.enqueued_by_workspace_user_id
        );
        if (action.promoteFutureToDraft)
          await tx.run(
            "UPDATE objectives SET state = 'draft', updated_at = ?, revision = revision + 1 WHERE id = ? AND state = 'future'",
            [now, objective.id]
          );
        // A retry of an objective wedged in `launching` — its launch died before
        // the runner attached, and `expireStaleExecutionRequests` already retired
        // the request. Without this reset the `state IN ('draft','submitted')`
        // guard below silently no-ops and the retry can never actually launch,
        // which is why removing the entry with `force` was the only way out.
        if (objective.state === 'launching')
          await tx.run(
            `UPDATE objectives SET state = 'draft', updated_at = ?, revision = revision + 1
               WHERE id = ? AND state = 'launching'
                 AND NOT EXISTS (
                   SELECT 1 FROM execution_requests er
                    WHERE er.objective_id = ? AND er.deleted_at IS NULL
                      AND er.status IN (${ACTIVE_EXECUTION_REQUEST_STATUSES.map(() => '?').join(',')})
                 )`,
            [now, objective.id, objective.id, ...ACTIVE_EXECUTION_REQUEST_STATUSES]
          );
        await tx.run(
          `UPDATE objectives SET state = 'launching', ${OBJECTIVE_LAUNCHED_AT_ASSIGNMENT}, updated_at = ?, revision = revision + 1 WHERE id = ? AND state IN ('draft','submitted')`,
          [now, now, objective.id]
        );
        const target = await resolveLaunchExecutionTarget({ ctx, projectId: objective.project_id });
        const resolved = await resolveLaunchConfig({
          ctx,
          objectiveLaunchConfigJson: objective.launch_config_json,
          executionTargetId: target.executionTargetId,
          agentKey: objective.assigned_agent!,
          userConfigs: target.agentConfigs,
          projectId: objective.project_id,
          objectiveResourceKey: objective.resource_key
        });
        const request = await createExecutionRequest({
          ctx,
          missionId: objective.mission_id,
          objectiveId: objective.id,
          requestedAgent: objective.assigned_agent,
          requestedModel: objective.model,
          requestedReasoningEffort: objective.reasoning_effort,
          launchFlags: { preCommand: resolved.config.preCommand, flags: resolved.config.flags },
          requestedSource: 'run_queue',
          idempotencyKey: action.idempotencyKey,
          executionTargetId: target.executionTargetId,
          metadata: { launchConfigSource: resolved.source, runQueueEntryId: entry.id },
          eventSummary: `Queued ${objective.assigned_agent} execution from Run Queue.`,
          eventPayload: { runQueueEntryId: entry.id }
        });
        await tx.run(
          "UPDATE run_queue_entries SET state = 'dispatched', blocked_reason = NULL, waiting_reason = NULL, waiting_on_objective_id = NULL, dispatched_at = ?, execution_request_id = ?, attempt_count = attempt_count + 1, updated_at = ?, revision = revision + 1 WHERE id = ? AND state IN ('waiting','blocked')",
          [now, request.id, now, entry.id]
        );
      });
    } catch (error) {
      // Keep the real cause. `dispatch_failed` alone told the user nothing about
      // *why* their queued objective stopped — an unconnected resource, a missing
      // execution target, and an unlaunchable objective state all rendered as the
      // same opaque word in "Held: dispatch_failed". The reason is surfaced
      // verbatim in the Run Queue panel, so keep the machine-readable prefix and
      // append a bounded detail.
      //
      // The hold is `waiting`, not `blocked`: a failed attempt is retryable
      // until the ceiling, and the planner raises `block('dispatch_failed')`
      // once `attempt_count` reaches it. Blocking here spent the very first
      // attempt of a designed three and needed a human to release it.
      const detail = sanitizeDispatchFailure(error);
      console.error('[run-queue-dispatcher] dispatch failed', { entryId: entry.id, error });
      await db.run(
        "UPDATE run_queue_entries SET state = 'waiting', waiting_reason = 'retry_pending', waiting_on_objective_id = NULL, blocked_reason = ?, attempt_count = attempt_count + 1, updated_at = ?, revision = revision + 1 WHERE id = ?",
        [detail ? `dispatch_failed: ${detail.slice(0, 400)}` : 'dispatch_failed', now, entry.id]
      );
    }
  }
}

class RunQueueDispatchWorker extends WorkerJobPoller {
  private sweepTimer: NodeJS.Timeout | null = null;
  constructor() {
    super({
      workerIdPrefix: 'run-queue',
      jobTypes: [RUN_QUEUE_DISPATCH_JOB_TYPE],
      logPrefix: 'run-queue-dispatcher'
    });
  }
  override start(): void {
    super.start();
    if (this.sweepTimer) return;
    const sweep = () =>
      void this.enqueueSweep().catch(error =>
        console.error('[run-queue-dispatcher] sweep failed', error)
      );
    sweep();
    this.sweepTimer = setInterval(sweep, 60_000);
  }
  private async enqueueSweep(): Promise<void> {
    const db = this.databaseClient();
    const projects = await db.all<{ project_id: string; workspace_id: string }>(
      `SELECT DISTINCT e.project_id, e.workspace_id FROM run_queue_entries e JOIN run_queues q ON q.id = e.queue_id WHERE e.deleted_at IS NULL AND q.deleted_at IS NULL AND q.paused = ?`,
      [db.dialect === 'postgres' ? false : 0]
    );
    for (const project of projects)
      await enqueueRunQueueDispatch(db, project.project_id, project.workspace_id);
    this.pollNow();
  }
  protected databaseClient(): DatabaseClient {
    return requireDatabaseClient();
  }
  protected async processJob(db: DatabaseClient, job: ClaimedWorkerJob): Promise<void> {
    const projectId = parseProjectId(job.payload_json);
    if (!projectId) {
      await this.finishJob(db, job, 'failed', 'Malformed Run Queue payload');
      return;
    }
    await dispatchProjectRunQueues(db, projectId);
    await this.finishJob(db, job);
  }
}
export const runQueueDispatchWorker = new RunQueueDispatchWorker();
