/**
 * Objective launch surface: execution-request queueing and copyable prompts/commands.
 * Resolves objective overrides, user target config and workspace defaults, then
 * snapshots the launch config into execution_requests for the runner.
 */
import { PERMISSIONS } from '@overlord/auth';
import type {
  ExecutionRequestDto,
  ExecutionRequestStatus,
  LaunchObjectiveBody,
  ObjectiveEffectiveLaunchConfigDto,
  ObjectiveLaunchCommandDto,
  ObjectivePromptDto,
  ObjectiveState
} from '@overlord/contract';
import { formatOvldLaunchCommand, normalizeAgentLaunchFlags } from '@overlord/contract';
import { OBJECTIVE_LAUNCHED_AT_ASSIGNMENT } from '@overlord/core/service/objective-lifecycle-timestamps';
import { type DatabaseClient, formatObjectiveDisplayId } from '@overlord/database';

import {
  ACTIVE_EXECUTION_REQUEST_STATUSES,
  clearExecutionRequests,
  createExecutionRequest,
  type ExecutionRequestSummary,
  expireStaleExecutionRequests,
  LAUNCHABLE_OBJECTIVE_STATES,
  selectExecutionRequestSummaries
} from '../../packages/core/service/execution-requests.ts';
import {
  LOCAL_TARGET_MUTATION_REQUESTED_SOURCE,
  parseLocalTargetMutation
} from '../../packages/core/service/local-target-mutations.ts';
import { isManualAgentKey } from '../../packages/core/service/manual-agent.ts';
import {
  findConflictingActiveSibling,
  missionAllowsParallelObjectives
} from '../../packages/core/service/objective-parallelism.ts';
import {
  resolveLaunchConfig,
  resolveLaunchExecutionTarget
} from '../../packages/core/service/project-execution-target.ts';
import { assertLaunchResourceConnected } from '../../packages/core/service/projects.ts';
import {
  removeRunQueueEntryForObjective,
  resumeRunQueueForObjective
} from '../../packages/core/service/run-queue.ts';
import {
  buildWebappServiceContextForWorkspace,
  findActiveMembershipId,
  newId,
  nowIso,
  recordChange,
  requireDatabaseClient,
  resolveActiveProfileId
} from '../db.ts';
import { ApiError } from '../errors.ts';
import { resolveObjectiveIdForRest } from '../objective-ref.ts';
import { requireObjectivePermission } from '../rbac.ts';

// ---- Execution requests -----------------------------------------------------

function executionRequestMutationKind(
  requestedSource: string,
  metadata: Record<string, unknown>
): ExecutionRequestDto['localTargetMutationKind'] {
  if (requestedSource !== LOCAL_TARGET_MUTATION_REQUESTED_SOURCE) return null;
  const mutation = parseLocalTargetMutation(metadata);
  return mutation?.kind ?? null;
}

function executionSummaryToDto(r: ExecutionRequestSummary): ExecutionRequestDto {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    missionId: r.missionId,
    objectiveId: r.objectiveId,
    executionTargetId: r.executionTargetId,
    requestedAgent: r.requestedAgent,
    requestedModel: r.requestedModel,
    requestedReasoningEffort: r.requestedReasoningEffort,
    launchConfig: {
      preCommand: typeof r.launchFlags.preCommand === 'string' ? r.launchFlags.preCommand : '',
      flags: normalizeAgentLaunchFlags(r.launchFlags.flags)
    },
    status: r.status as ExecutionRequestStatus,
    requestedSource: r.requestedSource,
    localTargetMutationKind: executionRequestMutationKind(r.requestedSource, r.metadata),
    lastError: r.lastError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

/** Active (queued/claimed/launching) requests for a mission, newest first per objective. */
export async function listMissionExecutionRequests(
  missionId: string
): Promise<ExecutionRequestDto[]> {
  const summaries = await selectExecutionRequestSummaries(requireDatabaseClient(), {
    where: `er.mission_id = ?
          AND er.status IN (${ACTIVE_EXECUTION_REQUEST_STATUSES.map(() => '?').join(', ')})
          AND er.deleted_at IS NULL`,
    params: [missionId, ...ACTIVE_EXECUTION_REQUEST_STATUSES],
    orderBy: 'er.created_at DESC'
  });
  return summaries.map(executionSummaryToDto);
}

interface LaunchObjectiveRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  title: string | null;
  instruction_text: string;
  state: string;
  assigned_agent: string | null;
  model: string | null;
  reasoning_effort: string | null;
  launch_config_json: string | null;
  resource_key: string | null;
  revision: number;
}

export { LAUNCHABLE_OBJECTIVE_STATES as LAUNCHABLE_STATES } from '../../packages/core/service/execution-requests.ts';

/**
 * Remove an objective from the runner queue when a user manually completes,
 * disconnects, or deletes it in the UI. Clears any active (queued/claimed/
 * launching/launched) execution requests so a retry cannot reuse work the
 * user has stopped, and ends any still-open agent session bound to the
 * objective so the session status reflects the new objective state.
 *
 * Must be called inside the caller's transaction so the objective mutation and
 * these queue/session updates land atomically. Returns the counts so callers
 * can decide whether to surface them.
 */
export async function dequeueObjective({
  objectiveId,
  projectId,
  missionId,
  workspaceId,
  workspaceUserId,
  reason,
  newState,
  now,
  tx = requireDatabaseClient()
}: {
  objectiveId: string;
  projectId: string;
  missionId: string;
  /** The objective's own workspace — not the caller's active one (coo:135). */
  workspaceId: string;
  workspaceUserId: string | null;
  /** Why the objective left the queue, for the audit event payload. */
  reason: 'completed' | 'disconnected' | 'deleted';
  /** New objective state, or null when the objective is being deleted. */
  newState: string | null;
  now: string;
  tx?: DatabaseClient;
}): Promise<{ clearedRequests: number; endedSessions: number }> {
  // Drop the queue entry *before* clearing requests. An objective that has been
  // completed, disconnected, or deleted has no queue membership left to plan,
  // and clearing its request first would reconcile the still-live entry back to
  // `waiting('retry_pending')` — a hold on work nobody is going to do. Removal
  // also enqueues its own dispatch tick. A forced disconnect is an intentional
  // intervention point, however, so it pauses that queue transactionally and
  // cannot release the following objective.
  await removeRunQueueEntryForObjective(tx, projectId, objectiveId, {
    pauseQueue: reason === 'disconnected'
  });

  const { cleared } = await clearExecutionRequests({
    ctx: {
      ...(await buildWebappServiceContextForWorkspace(workspaceId, tx, workspaceUserId)),
      db: tx
    },
    objectiveId,
    now,
    emitEvents: false,
    includeLaunched: true
  });

  // A completed objective ends its session cleanly; a disconnect/delete leaves
  // it blocked since the agent never reached a delivery.
  const sessionPhase = newState === 'complete' ? 'complete' : 'blocked';
  const openSessions = await tx.all<{ id: string; revision: number }>(
    `SELECT id, revision FROM agent_sessions
        WHERE workspace_id = ? AND objective_id = ? AND deleted_at IS NULL
          AND ended_at IS NULL`,
    [workspaceId, objectiveId]
  );

  for (const session of openSessions) {
    const revision = session.revision + 1;
    await tx.run(
      `UPDATE agent_sessions
         SET phase = ?, ended_at = ?, updated_at = ?, revision = ?
       WHERE id = ? AND workspace_id = ?`,
      [sessionPhase, now, now, revision, session.id, workspaceId]
    );
    await recordChange(
      {
        entityType: 'agent_session',
        entityId: session.id,
        operation: 'update',
        entityRevision: revision,
        projectId,
        missionId,
        objectiveId,
        changedFields: ['phase', 'ended_at'],
        workspaceId,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );
  }

  if (cleared > 0 || openSessions.length > 0) {
    await tx.run(
      `INSERT INTO mission_events
         (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
          payload_json, source, actor_workspace_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'status_change', NULL, ?, ?, 'webapp', ?, ?)`,
      [
        newId(),
        workspaceId,
        projectId,
        missionId,
        objectiveId,
        `Objective ${reason}: cleared ${cleared} delegated execution request(s) ` +
          `and ended ${openSessions.length} active session(s).`,
        JSON.stringify({
          reason,
          newState,
          clearedRequests: cleared,
          endedSessions: openSessions.length
        }),
        workspaceUserId,
        now
      ]
    );
  }

  return { clearedRequests: cleared, endedSessions: openSessions.length };
}

/**
 * Queue an execution request for an objective. Persists the agent/model
 * selection onto the objective, stores an explicit launch override when one is
 * supplied, resolves the effective launch config, moves a draft objective to
 * `launching`, and writes the `execution_requests` row plus the
 * `mission_events` / `entity_changes` records in one transaction.
 */
export async function launchObjective(
  objectiveRef: string,
  body: LaunchObjectiveBody
): Promise<ExecutionRequestDto> {
  // Direct launches are also a stale-request recovery boundary. Do this before
  // opening the launch transaction, then re-read inside it below, so a Run click
  // cannot keep returning a request whose runner disappeared mid-launch.
  const db = requireDatabaseClient();
  const { id: preflightObjectiveId } = await resolveObjectiveIdForRest({ ref: objectiveRef, db });
  const preflightObjective = await db.get<{ workspace_id: string }>(
    'SELECT workspace_id FROM objectives WHERE id = ? AND deleted_at IS NULL',
    [preflightObjectiveId]
  );
  if (!preflightObjective) throw new ApiError(404, 'Objective not found');
  const preflightProfileId = await resolveActiveProfileId(db);
  const preflightWorkspaceUserId = preflightProfileId
    ? await findActiveMembershipId(preflightObjective.workspace_id, preflightProfileId, db)
    : null;
  if (preflightWorkspaceUserId) {
    const preflightCtx = await buildWebappServiceContextForWorkspace(
      preflightObjective.workspace_id,
      db,
      preflightWorkspaceUserId
    );
    await expireStaleExecutionRequests({ ctx: preflightCtx });
  }
  return db.transaction(async tx => {
    const agentKey = (body.agent ?? '').trim();
    if (!agentKey) throw new ApiError(400, 'agent is required');
    // Clients hide Run for Manual objectives; this keeps MCP, CLI, and stale
    // clients from queueing an execution request no runner can serve.
    if (isManualAgentKey(agentKey)) {
      throw new ApiError(
        400,
        'Manual objectives are done by a person and cannot be launched',
        'Assign an agent to launch this objective, or mark it complete when the work is done.',
        'manual_agent_not_launchable'
      );
    }

    const { objectiveId, workspaceUserId } = await requireObjectivePermission({
      objectiveId: objectiveRef,
      permission: PERMISSIONS.EXECUTION_REQUEST_CREATE,
      db: tx
    });

    const objective = await tx.get<LaunchObjectiveRow>(
      `SELECT id, workspace_id, project_id, mission_id, title, instruction_text, state,
                assigned_agent, model, reasoning_effort, launch_config_json, resource_key, revision
           FROM objectives
          WHERE id = ? AND deleted_at IS NULL`,
      [objectiveId]
    );
    if (!objective) throw new ApiError(404, 'Objective not found');

    if (!LAUNCHABLE_OBJECTIVE_STATES.includes(objective.state as ObjectiveState)) {
      throw new ApiError(
        409,
        `Objective is not launchable from state "${objective.state}"`,
        objective.state === 'future'
          ? 'Promote the objective to draft first.'
          : 'Only draft, submitted, or launching objectives can be launched.'
      );
    }

    const serviceCtx = await buildWebappServiceContextForWorkspace(
      objective.workspace_id,
      tx,
      workspaceUserId
    );
    const allowParallelObjectives = await missionAllowsParallelObjectives({
      ctx: serviceCtx,
      missionId: objective.mission_id
    });
    const activeSibling = await findConflictingActiveSibling({
      ctx: serviceCtx,
      missionId: objective.mission_id,
      projectId: objective.project_id,
      objectiveId: objective.id,
      resourceKey: objective.resource_key,
      allowParallelObjectives
    });
    if (activeSibling) {
      throw new ApiError(
        409,
        'Another objective on this mission is already active. Enable auto-advance on this objective instead of delegating it to the runner.'
      );
    }

    const launchTarget = await resolveLaunchExecutionTarget({
      ctx: serviceCtx,
      projectId: objective.project_id,
      executionTargetId: body.executionTargetId
    });
    const { executionTargetId, agentConfigs } = launchTarget;
    const now = nowIso();

    await assertLaunchResourceConnected({
      ctx: serviceCtx,
      projectId: objective.project_id,
      objectiveResourceKey: objective.resource_key,
      executionTargetId
    });

    // Persist the selection (and explicit override) onto the objective so the
    // queue snapshot and the objective row never disagree about what was asked.
    const model = body.model ?? null;
    const reasoningEffort = body.reasoningEffort ?? null;
    const fields: string[] = [];
    const setParams: unknown[] = [];
    const changed: string[] = [];
    if (objective.assigned_agent !== agentKey) {
      fields.push('assigned_agent = ?');
      setParams.push(agentKey);
      changed.push('assigned_agent');
    }
    if (objective.model !== model) {
      fields.push('model = ?');
      setParams.push(model);
      changed.push('model');
    }
    if (objective.reasoning_effort !== reasoningEffort) {
      fields.push('reasoning_effort = ?');
      setParams.push(reasoningEffort);
      changed.push('reasoning_effort');
    }
    let launchConfigJson = objective.launch_config_json;
    if (body.launchConfigOverride !== undefined && body.launchConfigOverride !== null) {
      let parsed: Record<string, Record<string, unknown>>;
      try {
        parsed = launchConfigJson
          ? (JSON.parse(launchConfigJson) as Record<string, Record<string, unknown>>)
          : {};
      } catch {
        parsed = {};
      }
      const launchConfigTargetKey = executionTargetId ?? '*';
      parsed[launchConfigTargetKey] = {
        ...(parsed[launchConfigTargetKey] ?? {}),
        [agentKey]: {
          preCommand: body.launchConfigOverride.preCommand ?? '',
          flags: normalizeAgentLaunchFlags(body.launchConfigOverride.flags)
        }
      };
      launchConfigJson = JSON.stringify(parsed);
      fields.push('launch_config_json = ?');
      setParams.push(launchConfigJson);
      changed.push('launch_config_json');
    }
    if (objective.state === 'draft') {
      fields.push(`state = 'launching'`, OBJECTIVE_LAUNCHED_AT_ASSIGNMENT);
      setParams.push(now);
      changed.push('state', 'launched_at');
    }

    let revision = objective.revision;
    if (fields.length > 0) {
      revision += 1;
      await tx.run(
        `UPDATE objectives SET ${fields.join(', ')}, updated_at = ?, revision = ?
           WHERE id = ?`,
        [...setParams, now, revision, objective.id]
      );
      await recordChange(
        {
          entityType: 'objective',
          entityId: objective.id,
          operation: 'update',
          entityRevision: revision,
          projectId: objective.project_id,
          missionId: objective.mission_id,
          objectiveId: objective.id,
          changedFields: changed,
          workspaceId: objective.workspace_id
        },
        tx
      );
    }

    const resolved = await resolveLaunchConfig({
      ctx: serviceCtx,
      objectiveLaunchConfigJson: launchConfigJson,
      executionTargetId,
      agentKey,
      userConfigs: agentConfigs,
      projectId: objective.project_id,
      objectiveResourceKey: objective.resource_key
    });

    // Queue membership is inert until the user starts it. Direct Run on a
    // queued objective is also an explicit queue-start gesture, so resume the
    // queue in this transaction. Do this before the idempotency return because
    // a previously delegated objective must still be able to start its queue.
    await resumeRunQueueForObjective(tx, objective.id);

    // An objective stays in `launching` state until the runner claims and
    // launches its request; a second Run click in that window must not queue
    // a duplicate. Once the prior request reaches a terminal status, this
    // check clears and a relaunch is allowed.
    const [activeRequest] = await selectExecutionRequestSummaries(tx, {
      where: `er.objective_id = ? AND er.deleted_at IS NULL
            AND er.status IN (${[...ACTIVE_EXECUTION_REQUEST_STATUSES, 'launched'].map(() => '?').join(', ')})`,
      params: [objective.id, ...ACTIVE_EXECUTION_REQUEST_STATUSES, 'launched'],
      orderBy: 'er.created_at DESC',
      limit: 1
    });
    if (activeRequest) {
      return executionSummaryToDto(activeRequest);
    }

    const request = await createExecutionRequest({
      ctx: serviceCtx,
      missionId: objective.mission_id,
      objectiveId: objective.id,
      requestedAgent: agentKey,
      requestedModel: model,
      requestedReasoningEffort: reasoningEffort,
      launchFlags: {
        preCommand: resolved.config.preCommand,
        flags: resolved.config.flags
      },
      requestedSource: 'webapp',
      // WS-C (R3): stamp the project's selected execution target (or the sole
      // eligible target). NULL still means "any eligible target may claim."
      executionTargetId,
      metadata: { launchConfigSource: resolved.source },
      eventSummary: `Delegated ${agentKey}${model ? ` (${model})` : ''} execution for a runner.`,
      eventPayload: { agent: agentKey, model, reasoningEffort }
    });
    // Direct Run bypasses queue ordering, but if this objective already belongs
    // to a Run Queue it becomes that queue's in-flight entry so delivery advances it.
    await tx.run(
      `UPDATE run_queue_entries
          SET state = 'running', blocked_reason = NULL, execution_request_id = ?,
              dispatched_at = COALESCE(dispatched_at, ?), updated_at = ?, revision = revision + 1
        WHERE objective_id = ? AND deleted_at IS NULL AND state IN ('waiting', 'blocked')`,
      [request.id, now, now, objective.id]
    );
    return executionSummaryToDto(request);
  });
}

// ---- Copyable prompt --------------------------------------------------------

/**
 * Assemble a prompt the user can paste into an agent they start themselves.
 * Mirrors the shape of the context `ovld launch` hands to agents: the
 * objective, mission identity, and the protocol attach instruction.
 */
export async function getObjectivePrompt(objectiveRef: string): Promise<ObjectivePromptDto> {
  const db = requireDatabaseClient();
  // Resolves in the objective's own workspace (coo:135), not necessarily the
  // request's active one, since the caller may be viewing a secondary
  // workspace's mission.
  const { objectiveId } = await requireObjectivePermission({
    objectiveId: objectiveRef,
    permission: PERMISSIONS.OBJECTIVE_READ,
    db
  });
  const row = await db.get<{
    id: string;
    mission_id: string;
    instruction_text: string;
    display_id: string;
    display_key: string;
    mission_title: string;
  }>(
    `SELECT o.id, o.mission_id, o.instruction_text, o.display_key,
              t.display_id, t.title AS mission_title
         FROM objectives o
         JOIN missions t ON t.id = o.mission_id
        WHERE o.id = ? AND o.deleted_at IS NULL`,
    [objectiveId]
  );
  if (!row) throw new ApiError(404, 'Objective not found');

  const prompt = [
    `# Overlord Agent Instructions`,
    ``,
    `You are an AI coding agent working on mission **${row.display_id}** via Overlord.`,
    `Complete the work described below, then deliver a summary back to the platform.`,
    ``,
    `## Task`,
    ``,
    `- **Title:** ${row.mission_title}`,
    `- **Mission ID:** ${row.display_id} — pass this as \`--mission-id\``,
    `- **Objective ID:** ${formatObjectiveDisplayId({ missionDisplayId: row.display_id, displayKey: row.display_key })} — pass this as \`--objective-id\`; never as \`--mission-id\``,
    ``,
    `### Objective`,
    ``,
    row.instruction_text,
    ``,
    `## Overlord Protocol`,
    ``,
    `Attach to this objective before doing anything else, then post updates while you`,
    `work and deliver a summary when you finish:`,
    ``,
    // Markdown code fences use backticks, which leave a shell with an unmatched
    // command substitution when a copied prompt is pasted into a terminal.
    // Indentation preserves a clearly copyable command without shell syntax.
    `    ovld protocol attach --mission-id ${row.display_id} --objective-id ${formatObjectiveDisplayId({ missionDisplayId: row.display_id, displayKey: row.display_key })}`
  ].join('\n');

  return { objectiveId: row.id, missionId: row.mission_id, prompt };
}

export type ObjectiveLaunchCommandQuery = {
  agent: string;
  model?: string | null;
  reasoningEffort?: string | null;
  executionTargetId?: string | null;
};

export type ObjectiveEffectiveLaunchConfigQuery = {
  agent: string;
  executionTargetId?: string | null;
};

type ObjectiveLaunchResolutionRow = {
  id: string;
  mission_id: string;
  project_id: string;
  launch_config_json: string | null;
  resource_key: string | null;
  display_id: string;
  display_key: string;
};

/**
 * Shared read path for the copyable launch command and the effective launch
 * config: authorize `objective:read` in the objective's own workspace, then run
 * the same target + launch-config resolution `launchObjective` snapshots.
 */
async function resolveObjectiveLaunchResolution(
  objectiveRef: string,
  { agent, executionTargetId }: { agent: string; executionTargetId?: string | null }
) {
  const db = requireDatabaseClient();
  const { workspaceId, workspaceUserId, objectiveId } = await requireObjectivePermission({
    objectiveId: objectiveRef,
    permission: PERMISSIONS.OBJECTIVE_READ,
    db
  });
  const row = await db.get<ObjectiveLaunchResolutionRow>(
    `SELECT o.id, o.mission_id, o.project_id, o.launch_config_json, o.resource_key,
              o.display_key, t.display_id
         FROM objectives o
         JOIN missions t ON t.id = o.mission_id
        WHERE o.id = ? AND o.deleted_at IS NULL`,
    [objectiveId]
  );
  if (!row) throw new ApiError(404, 'Objective not found');

  const serviceCtx = await buildWebappServiceContextForWorkspace(workspaceId, db, workspaceUserId);
  const launchTarget = await resolveLaunchExecutionTarget({
    ctx: serviceCtx,
    projectId: row.project_id,
    executionTargetId
  });
  const resolved = await resolveLaunchConfig({
    ctx: serviceCtx,
    objectiveLaunchConfigJson: row.launch_config_json,
    executionTargetId: launchTarget.executionTargetId,
    agentKey: agent,
    userConfigs: launchTarget.agentConfigs,
    projectId: row.project_id,
    objectiveResourceKey: row.resource_key
  });
  return { row, serviceCtx, launchTarget, resolved };
}

/** Return the exact read-only launch config direct and queued launches snapshot. */
export async function getObjectiveEffectiveLaunchConfig(
  objectiveRef: string,
  query: ObjectiveEffectiveLaunchConfigQuery
): Promise<ObjectiveEffectiveLaunchConfigDto> {
  const agentKey = (query.agent ?? '').trim();
  if (!agentKey) throw new ApiError(400, 'agent is required');

  const { row, launchTarget, resolved } = await resolveObjectiveLaunchResolution(objectiveRef, {
    agent: agentKey,
    executionTargetId: query.executionTargetId
  });
  return {
    objectiveId: row.id,
    missionId: row.mission_id,
    executionTargetId: launchTarget.executionTargetId,
    launchConfig: resolved.config,
    source: resolved.source
  };
}

/**
 * Build a paste-ready `ovld launch` command for the objective using the caller's
 * current agent/model selection and the same launch-config resolution order as
 * `launchObjective`.
 */
export async function getObjectiveLaunchCommand(
  objectiveRef: string,
  query: ObjectiveLaunchCommandQuery
): Promise<ObjectiveLaunchCommandDto> {
  const agentKey = (query.agent ?? '').trim();
  if (!agentKey) throw new ApiError(400, 'agent is required');

  const { row, resolved } = await resolveObjectiveLaunchResolution(objectiveRef, {
    agent: agentKey,
    executionTargetId: query.executionTargetId
  });

  const command = formatOvldLaunchCommand({
    agent: agentKey,
    missionDisplayId: row.display_id,
    objectiveId: formatObjectiveDisplayId({
      missionDisplayId: row.display_id,
      displayKey: row.display_key
    }),
    model: query.model,
    thinking: query.reasoningEffort,
    preCommand: resolved.config.preCommand,
    flags: resolved.config.flags
  });

  return { objectiveId: row.id, missionId: row.mission_id, command };
}
