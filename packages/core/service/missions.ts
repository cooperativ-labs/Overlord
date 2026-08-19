import type { MissionSearchDateField, SearchMissionsResponseV2 } from '@overlord/contract';
import { bindBool, formatObjectiveDisplayId, OBJECTIVE_STATES } from '@overlord/database';

import { recordChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import {
  resolveMissionId,
  resolveObjectiveRef,
  resolveOrigin,
  resolveProjectId
} from './context.js';
import { ServiceError } from './errors.js';
import { searchWorkspaceMissions, toSearchMissionsResponseV2 } from './mission-search.js';
import { allocateObjectiveDisplayKey } from './objective-display-id.js';
import { assertProjectResourceKeyExists } from './projects.js';
import { initialTitleFromInstruction, newId, nowIso } from './util.js';
import { enqueueWebhookEvent } from './webhook-events.js';

export type ObjectiveSummary = {
  id: string;
  displayKey: string;
  displayId: string;
  missionId: string;
  projectId: string;
  position: number;
  title: string | null;
  objective: string;
  state: string;
  autoAdvance: boolean;
  resourceKey: string | null;
};

export type MissionSummary = {
  id: string;
  displayId: string;
  projectId: string;
  title: string;
  statusType: string;
  statusId: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  objectiveCount: number;
};

export type MissionEventSummary = {
  id: string;
  type: string;
  phase: string | null;
  summary: string;
  createdAt: string;
  objectiveId: string | null;
};

export type SharedContextEntry = {
  id?: string;
  key: string;
  value: unknown;
  tags: string[];
  updatedAt: string;
  revision?: number;
};

export type ArtifactSummary = {
  id: string;
  type: string;
  label: string;
  content: string | null;
  externalUrl: string | null;
};

export type AttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  storageKey: string;
};

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1;
}

async function nextMissionSequence(ctx: ServiceContext): Promise<number> {
  const row = (await ctx.db.get(
    `SELECT id, next_value FROM mission_sequences
       WHERE workspace_id = ? AND scope_type = 'workspace' AND counter_name = 'mission'`,
    [ctx.workspace.id]
  )) as { id: string; next_value: number } | undefined;

  // A workspace provisioned before the counter existed (or one seeded outside
  // the normal bootstrap) has no row yet. Start it at 1 rather than failing the
  // create — matching what the REST path has always done.
  if (!row) {
    const seq = 1;
    await ctx.db.run(
      `INSERT INTO mission_sequences
         (id, workspace_id, scope_type, scope_id, counter_name, next_value, updated_at)
       VALUES (?, ?, 'workspace', ?, 'mission', ?, ?)`,
      [newId(), ctx.workspace.id, ctx.workspace.id, seq + 1, nowIso()]
    );
    return seq;
  }

  const seq = row.next_value;
  await ctx.db.run(`UPDATE mission_sequences SET next_value = ?, updated_at = ? WHERE id = ?`, [
    seq + 1,
    nowIso(),
    row.id
  ]);
  return seq;
}

async function getDefaultStatusId(
  ctx: ServiceContext,
  projectId: string
): Promise<{
  id: string;
  type: string;
}> {
  const row = (await ctx.db.get(
    `SELECT id, type FROM project_statuses
       WHERE project_id = ? AND is_default = ? AND deleted_at IS NULL LIMIT 1`,
    [projectId, bindBool(ctx.db.dialect, true)]
  )) as { id: string; type: string } | undefined;

  if (!row) {
    throw new ServiceError('Project has no default status', 'validation_error', 409);
  }
  return row;
}

async function getReviewStatusId(
  ctx: ServiceContext,
  projectId: string
): Promise<{
  id: string;
  type: string;
}> {
  const row = (await ctx.db.get(
    `SELECT id, type FROM project_statuses
       WHERE project_id = ? AND type = 'review' AND deleted_at IS NULL LIMIT 1`,
    [projectId]
  )) as { id: string; type: string } | undefined;

  if (!row) {
    throw new ServiceError('Project has no review status', 'validation_error', 409);
  }
  return row;
}

async function getExecuteStatusId(
  ctx: ServiceContext,
  projectId: string
): Promise<{
  id: string;
  type: string;
}> {
  const row = (await ctx.db.get(
    `SELECT id, type FROM project_statuses
       WHERE project_id = ? AND type = 'execute' AND deleted_at IS NULL LIMIT 1`,
    [projectId]
  )) as { id: string; type: string } | undefined;

  if (!row) {
    throw new ServiceError('Project has no execute status', 'validation_error', 409);
  }
  return row;
}

/**
 * Look up an explicitly-chosen project status. The board lets a REST caller
 * create a mission directly into any column, so creation cannot always go
 * through the default/review lookups above.
 */
async function getProjectStatusById(
  ctx: ServiceContext,
  projectId: string,
  statusId: string
): Promise<{ id: string; type: string }> {
  const row = (await ctx.db.get(
    `SELECT id, type FROM project_statuses
       WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [statusId, projectId]
  )) as { id: string; type: string } | undefined;

  if (!row) {
    throw new ServiceError('Unknown status for project', 'validation_error', 409);
  }
  return row;
}

/**
 * Attach tag definitions to a freshly-created mission. Each tag must belong to
 * the mission's own project (and not be soft-deleted), so a mission can never
 * carry a foreign-project tag. Insert-only: it assumes the mission has no tag
 * rows yet, which is true on the create path.
 */
export async function assignMissionTags({
  ctx,
  missionId,
  projectId,
  tagIds,
  now
}: {
  ctx: ServiceContext;
  missionId: string;
  projectId: string;
  tagIds: string[] | undefined;
  now: string;
}): Promise<void> {
  const unique = [...new Set((tagIds ?? []).map(value => value.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  for (const tagId of unique) {
    const tag = (await ctx.db.get(
      `SELECT id FROM project_tags
         WHERE id = ? AND project_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [tagId, projectId, ctx.workspace.id]
    )) as { id: string } | undefined;
    if (!tag) {
      throw new ServiceError('Tag does not belong to this project', 'validation_error');
    }
  }

  for (const tagId of unique) {
    // Portable upsert-ignore: works on both modern SQLite and PostgreSQL.
    await ctx.db.run(
      `INSERT INTO mission_tags (mission_id, tag_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      [missionId, tagId, now]
    );
  }
}

async function topBoardPosition(
  ctx: ServiceContext,
  projectId: string,
  statusId: string
): Promise<number> {
  const row = (await ctx.db.get(
    `SELECT MIN(board_position) AS min_pos FROM missions
       WHERE project_id = ? AND status_id = ? AND deleted_at IS NULL`,
    [projectId, statusId]
  )) as { min_pos: number | null };
  const minPos = row.min_pos;
  return minPos === null ? 100 : minPos - 100;
}

export async function listObjectives({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<ObjectiveSummary[]> {
  const resolved = await resolveMissionId(ctx, missionId);
  const rows = (await ctx.db.all(
    `SELECT o.id, o.mission_id, o.project_id, o.position, o.title, o.instruction_text, o.state,
            o.auto_advance, o.resource_key, o.display_key, m.display_id AS mission_display_id
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id
      WHERE o.mission_id = ? AND o.deleted_at IS NULL
      ORDER BY o.position ASC`,
    [resolved.id]
  )) as Array<{
    id: string;
    mission_id: string;
    project_id: string;
    position: number;
    title: string | null;
    instruction_text: string;
    state: string;
    auto_advance: number;
    resource_key: string | null;
    display_key: string;
    mission_display_id: string;
  }>;

  return rows.map(toObjectiveSummary);
}

function toObjectiveSummary(row: {
  id: string;
  mission_id: string;
  project_id: string;
  position: number;
  title: string | null;
  instruction_text: string;
  state: string;
  auto_advance: number;
  resource_key: string | null;
  display_key: string;
  mission_display_id: string;
}): ObjectiveSummary {
  return {
    id: row.id,
    displayKey: row.display_key,
    displayId: formatObjectiveDisplayId({
      missionDisplayId: row.mission_display_id,
      displayKey: row.display_key
    }),
    missionId: row.mission_id,
    projectId: row.project_id,
    position: row.position,
    title: row.title,
    objective: row.instruction_text,
    state: row.state,
    autoAdvance: isTruthyFlag(row.auto_advance),
    resourceKey: row.resource_key?.trim() || null
  };
}

/**
 * The project's last-used launch selection, stored by the webapp on
 * `project_user_preferences.preferences_json.launchPreference`. New draft slots
 * inherit it so the agent recorded on the objective (and the launch button that
 * reads it) matches what the user last chose, rather than leaving the agent unset
 * and letting execution fall back to a hardcoded default.
 */
async function readProjectLaunchSelection(
  ctx: ServiceContext,
  projectId: string
): Promise<{ agent: string | null; model: string | null; reasoningEffort: string | null }> {
  const empty = { agent: null, model: null, reasoningEffort: null };
  if (!ctx.actorWorkspaceUserId) return empty;
  const row = (await ctx.db.get(
    `SELECT preferences_json FROM project_user_preferences
        WHERE workspace_id = ? AND project_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, projectId, ctx.actorWorkspaceUserId]
  )) as { preferences_json: string } | undefined;
  if (!row) return empty;
  try {
    const prefs = JSON.parse(row.preferences_json) as {
      launchPreference?: {
        selectedAgent?: string | null;
        selectedModel?: string | null;
        selectedReasoningEffort?: string | null;
      };
    };
    const launch = prefs.launchPreference ?? {};
    return {
      agent: launch.selectedAgent ?? null,
      model: launch.selectedModel ?? null,
      reasoningEffort: launch.selectedReasoningEffort ?? null
    };
  } catch {
    return empty;
  }
}

export async function insertObjective({
  ctx,
  missionId,
  instructionText,
  title,
  state,
  autoAdvance = false,
  assignedAgent,
  resourceKey = null
}: {
  ctx: ServiceContext;
  missionId: string;
  instructionText: string;
  title?: string | null;
  state?: string;
  autoAdvance?: boolean;
  assignedAgent?: string | null;
  resourceKey?: string | null;
}): Promise<ObjectiveSummary> {
  const instruction = instructionText.trim();

  const mission = await resolveMissionId(ctx, missionId);
  const normalizedResourceKey = resourceKey?.trim() || null;
  if (normalizedResourceKey) {
    await assertProjectResourceKeyExists({
      ctx,
      projectId: mission.projectId,
      resourceKey: normalizedResourceKey
    });
  }
  const requestedState = state ?? 'draft';
  if (!OBJECTIVE_STATES.includes(requestedState as (typeof OBJECTIVE_STATES)[number])) {
    throw new ServiceError(`Invalid objective state: ${requestedState}`, 'validation_error');
  }

  const draftRow = (await ctx.db.get(
    `SELECT id FROM objectives
       WHERE mission_id = ? AND state = 'draft' AND deleted_at IS NULL
       LIMIT 1`,
    [mission.id]
  )) as { id: string } | undefined;
  const resolvedState = requestedState === 'draft' && draftRow ? 'future' : requestedState;
  const allowsBlankInstruction = resolvedState === 'draft' || resolvedState === 'future';
  if (!instruction && !allowsBlankInstruction) {
    throw new ServiceError('Objective instruction is required', 'validation_error');
  }

  const maxRow = (await ctx.db.get(
    `SELECT MAX(position) AS max_pos FROM objectives WHERE mission_id = ? AND deleted_at IS NULL`,
    [mission.id]
  )) as { max_pos: number | null };
  const position = (maxRow.max_pos ?? -1) + 1;
  const now = nowIso();
  const id = newId();
  const resolvedTitle =
    title?.trim() || (instruction ? initialTitleFromInstruction(instruction) : 'New objective');
  // Editable slots (draft/future) default to the project's last-used selection so
  // the agent is always recorded in the db; an explicit agent passed by the caller
  // still wins. Executed/complete states are created with whatever the caller set.
  const explicitAgent = assignedAgent?.trim() || null;
  const launchSelection =
    !explicitAgent && (resolvedState === 'draft' || resolvedState === 'future')
      ? await readProjectLaunchSelection(ctx, mission.projectId)
      : { agent: null, model: null, reasoningEffort: null };
  const resolvedAssignedAgent = explicitAgent ?? launchSelection.agent;
  const resolvedModel = explicitAgent ? null : launchSelection.model;
  const resolvedReasoningEffort = explicitAgent ? null : launchSelection.reasoningEffort;
  const origin = resolveOrigin(ctx);
  const displayKey = await allocateObjectiveDisplayKey({ db: ctx.db, missionId: mission.id });

  await ctx.db.run(
    `INSERT INTO objectives
         (id, workspace_id, project_id, mission_id, position, title, instruction_text, state,
          assigned_agent, model, reasoning_effort, agent_flags_json, auto_advance,
          execution_metadata_json, resource_key, display_key, created_by_workspace_user_id,
          created_by_kind, created_by_agent, created_by_session_id,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      ctx.workspace.id,
      mission.projectId,
      mission.id,
      position,
      resolvedTitle,
      instruction,
      resolvedState,
      resolvedAssignedAgent,
      resolvedModel,
      resolvedReasoningEffort,
      bindBool(ctx.db.dialect, autoAdvance),
      normalizedResourceKey,
      displayKey,
      ctx.actorWorkspaceUserId,
      origin.kind,
      origin.agent,
      origin.sessionId,
      now,
      now
    ]
  );

  await recordChange({
    ctx,
    entityType: 'objective',
    entityId: id,
    operation: 'insert',
    entityRevision: 1,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: id
  });

  return toObjectiveSummary({
    id,
    mission_id: mission.id,
    project_id: mission.projectId,
    position,
    title: resolvedTitle,
    instruction_text: instruction,
    state: resolvedState,
    auto_advance: autoAdvance ? 1 : 0,
    resource_key: normalizedResourceKey,
    display_key: displayKey,
    mission_display_id: mission.displayId
  });
}

/**
 * Refills the next-up draft slot after an objective leaves the queue by
 * promoting the first authored `future` objective, dropping any leftover blank
 * draft it replaces.
 *
 * It never *creates* a blank draft. A stored objective with no instruction text
 * is indistinguishable from real work to agents, counts, and auto-advance, so
 * the "empty field to type into" is a client-only composer (the mission panel's
 * ghost objective card) that persists an objective only once it has content.
 */
export async function ensureNextDraftObjective({
  ctx,
  missionId,
  projectId,
  now
}: {
  ctx: ServiceContext;
  missionId: string;
  projectId: string;
  now: string;
}): Promise<void> {
  const drafts = (await ctx.db.all(
    `SELECT id, instruction_text, revision FROM objectives
       WHERE mission_id = ? AND state = 'draft' AND deleted_at IS NULL
       ORDER BY position ASC, created_at ASC`,
    [missionId]
  )) as Array<{ id: string; instruction_text: string; revision: number }>;

  if (drafts.some(draft => draft.instruction_text.trim())) return;

  // Only an authored future objective refills the slot; a blank one (legacy rows
  // from when blank slots were persisted) is not real work to promote.
  const nextFuture = (await ctx.db.get(
    `SELECT id, revision FROM objectives
       WHERE mission_id = ? AND state = 'future' AND deleted_at IS NULL
         AND TRIM(instruction_text) <> ''
       ORDER BY position ASC, created_at ASC LIMIT 1`,
    [missionId]
  )) as { id: string; revision: number } | undefined;

  if (nextFuture) {
    for (const draft of drafts) {
      const revision = draft.revision + 1;
      await ctx.db.run(
        `UPDATE objectives SET deleted_at = ?, updated_at = ?, revision = ?
           WHERE id = ? AND mission_id = ?`,
        [now, now, revision, draft.id, missionId]
      );
      await recordChange({
        ctx,
        entityType: 'objective',
        entityId: draft.id,
        operation: 'delete',
        entityRevision: revision,
        projectId,
        missionId,
        objectiveId: draft.id
      });
    }

    const revision = nextFuture.revision + 1;
    await ctx.db.run(
      `UPDATE objectives SET state = 'draft', updated_at = ?, revision = ?
         WHERE id = ? AND mission_id = ?`,
      [now, revision, nextFuture.id, missionId]
    );

    await recordChange({
      ctx,
      entityType: 'objective',
      entityId: nextFuture.id,
      operation: 'update',
      entityRevision: revision,
      projectId,
      missionId,
      objectiveId: nextFuture.id,
      changedFields: ['state']
    });
  }
}

/**
 * The single mission-creation entry point for every surface — CLI, Protocol,
 * MCP, and the REST API (`backend/repository.ts::createMissionTx` delegates
 * here). The optional fields below exist because the board exposes them at
 * creation time; callers that omit them get the plain agent-created mission
 * shape (default status, `normal` priority, no due date, no assignee, no tags).
 */
export async function createMissionWithObjectives({
  ctx,
  projectId,
  objectives,
  title,
  statusType,
  statusId,
  priority,
  dueDatetime,
  assignedWorkspaceUserId,
  tagIds
}: {
  ctx: ServiceContext;
  projectId: string;
  objectives: Array<{
    objective: string;
    title?: string | null;
    autoAdvance?: boolean;
    resourceKey?: string | null;
  }>;
  title?: string | null;
  statusType?: 'draft' | 'review';
  /** Explicit target column. Wins over `statusType` when both are supplied. */
  statusId?: string | null;
  priority?: string | null;
  dueDatetime?: string | null;
  assignedWorkspaceUserId?: string | null;
  tagIds?: string[];
}): Promise<{ mission: MissionSummary; objectives: ObjectiveSummary[] }> {
  const explicitTitle = title?.trim() ?? '';
  // A titled mission may legitimately start with no objectives at all (the
  // board's "new mission" card authors them afterwards); an untitled one has
  // nothing to name itself from, so it must carry at least one.
  if (objectives.length === 0 && !explicitTitle) {
    throw new ServiceError('At least one objective is required', 'validation_error');
  }

  const resolvedProjectId = await resolveProjectId(ctx, projectId);
  const firstInstruction = objectives[0]?.objective.trim() ?? '';
  if (objectives.length > 0 && !firstInstruction) {
    throw new ServiceError('First objective instruction is required', 'validation_error');
  }

  const missionTitle = explicitTitle || initialTitleFromInstruction(firstInstruction);
  const status = statusId
    ? await getProjectStatusById(ctx, resolvedProjectId, statusId)
    : statusType === 'review'
      ? await getReviewStatusId(ctx, resolvedProjectId)
      : await getDefaultStatusId(ctx, resolvedProjectId);

  const now = nowIso();
  const missionId = newId();
  const sequence = await nextMissionSequence(ctx);
  const displayId = `${ctx.workspace.slug}:${sequence}`;

  const createdObjectives: ObjectiveSummary[] = [];

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const origin = resolveOrigin(txCtx);
    await txCtx.db.run(
      `INSERT INTO missions
           (id, workspace_id, project_id, display_id, sequence_number, title,
            status_id, status_type, board_position, priority,
            execution_target_intent_json, metadata_json, created_by_workspace_user_id,
            assigned_workspace_user_id, due_datetime,
            created_by_kind, created_by_agent, created_by_session_id,
            created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        missionId,
        ctx.workspace.id,
        resolvedProjectId,
        displayId,
        sequence,
        missionTitle,
        status.id,
        status.type,
        await topBoardPosition(txCtx, resolvedProjectId, status.id),
        priority ?? 'normal',
        ctx.actorWorkspaceUserId,
        assignedWorkspaceUserId ?? null,
        dueDatetime ?? null,
        origin.kind,
        origin.agent,
        origin.sessionId,
        now,
        now
      ]
    );

    await recordChange({
      ctx: txCtx,
      entityType: 'mission',
      entityId: missionId,
      operation: 'insert',
      entityRevision: 1,
      projectId: resolvedProjectId,
      missionId
    });

    for (let index = 0; index < objectives.length; index++) {
      const item = objectives[index]!;
      const instruction = item.objective.trim();
      if (!instruction) {
        throw new ServiceError(
          `Objective ${index + 1} instruction is required`,
          'validation_error'
        );
      }
      const objectiveState =
        statusType === 'review' ? 'complete' : index === 0 ? 'draft' : 'future';
      createdObjectives.push(
        await insertObjective({
          ctx: txCtx,
          missionId,
          instructionText: instruction,
          ...(item.title !== undefined ? { title: item.title } : {}),
          state: objectiveState,
          autoAdvance: item.autoAdvance ?? false,
          ...(item.resourceKey !== undefined ? { resourceKey: item.resourceKey } : {})
        })
      );
    }

    await assignMissionTags({
      ctx: txCtx,
      missionId,
      projectId: resolvedProjectId,
      tagIds,
      now
    });
  });

  return {
    mission: await getMissionSummary({ ctx, missionId }),
    objectives: createdObjectives
  };
}

export async function getMissionSummary({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<MissionSummary> {
  const resolved = await resolveMissionId(ctx, missionId);
  const row = (await ctx.db.get(
    `SELECT t.id, t.display_id, t.project_id, t.title, t.status_type, t.status_id,
              t.priority, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM objectives o WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count
       FROM missions t
       WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL`,
    [resolved.id, ctx.workspace.id]
  )) as {
    id: string;
    display_id: string;
    project_id: string;
    title: string;
    status_type: string;
    status_id: string;
    priority: string | null;
    created_at: string;
    updated_at: string;
    objective_count: number;
  };

  if (!row) {
    throw new ServiceError('Mission not found', 'mission_not_found', 404);
  }

  return {
    id: row.id,
    displayId: row.display_id,
    projectId: row.project_id,
    title: row.title,
    statusType: row.status_type,
    statusId: row.status_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    objectiveCount: row.objective_count
  };
}

export async function listMissions({
  ctx,
  projectId,
  statusTypes,
  limit = 50
}: {
  ctx: ServiceContext;
  projectId?: string | null;
  statusTypes?: string[] | null;
  limit?: number;
}): Promise<MissionSummary[]> {
  const params: Array<string | number> = [ctx.workspace.id];
  let sql = `SELECT t.id, t.display_id, t.project_id, t.title, t.status_type, t.status_id,
                    t.priority, t.created_at, t.updated_at,
                    (SELECT COUNT(*) FROM objectives o WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count
             FROM missions t
             WHERE t.workspace_id = ? AND t.deleted_at IS NULL`;

  if (projectId) {
    sql += ' AND t.project_id = ?';
    params.push(await resolveProjectId(ctx, projectId));
  }

  if (statusTypes && statusTypes.length > 0) {
    const placeholders = statusTypes.map(() => '?').join(', ');
    sql += ` AND t.status_type IN (${placeholders})`;
    params.push(...statusTypes);
  }

  sql += ' ORDER BY t.updated_at DESC LIMIT ?';
  params.push(limit);

  const rows = (await ctx.db.all(sql, params)) as Array<{
    id: string;
    display_id: string;
    project_id: string;
    title: string;
    status_type: string;
    status_id: string;
    priority: string | null;
    created_at: string;
    updated_at: string;
    objective_count: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    displayId: row.display_id,
    projectId: row.project_id,
    title: row.title,
    statusType: row.status_type,
    statusId: row.status_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    objectiveCount: row.objective_count
  }));
}

async function searchMissionsWorkspace({
  ctx,
  query,
  statusTypes,
  projectId,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  ctx: ServiceContext;
  query?: string | null;
  statusTypes?: string[] | null;
  projectId?: string | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}) {
  const projectIds = projectId ? [await resolveProjectId(ctx, projectId)] : [];
  return searchWorkspaceMissions({
    db: ctx.db,
    workspaceId: ctx.workspace.id,
    query: query ?? null,
    projectIds,
    statusTypes: statusTypes ?? null,
    resourceKeys: resourceKeys ?? null,
    dateField: dateField ?? null,
    from: from ?? null,
    to: to ?? null,
    limit
  });
}

export async function searchMissions({
  ctx,
  query,
  statusTypes,
  projectId,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  ctx: ServiceContext;
  query?: string | null;
  statusTypes?: string[] | null;
  projectId?: string | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<MissionSummary[]> {
  const result = await searchMissionsWorkspace({
    ctx,
    query: query ?? null,
    statusTypes: statusTypes ?? null,
    projectId: projectId ?? null,
    resourceKeys: resourceKeys ?? null,
    dateField: dateField ?? null,
    from: from ?? null,
    to: to ?? null,
    limit
  });
  return result.hits.map(hit => ({
    id: hit.id,
    displayId: hit.displayId,
    projectId: hit.projectId,
    title: hit.title,
    statusType: hit.statusType,
    statusId: hit.statusId,
    priority: hit.priority,
    createdAt: hit.createdAt,
    updatedAt: hit.updatedAt,
    objectiveCount: hit.objectiveCount
  }));
}

export async function searchMissionsV2({
  ctx,
  query,
  statusTypes,
  projectId,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  ctx: ServiceContext;
  query?: string | null;
  statusTypes?: string[] | null;
  projectId?: string | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<SearchMissionsResponseV2> {
  const result = await searchMissionsWorkspace({
    ctx,
    query: query ?? null,
    statusTypes: statusTypes ?? null,
    projectId: projectId ?? null,
    resourceKeys: resourceKeys ?? null,
    dateField: dateField ?? null,
    from: from ?? null,
    to: to ?? null,
    limit
  });
  return toSearchMissionsResponseV2(result);
}

export async function addObjectivesToMission({
  ctx,
  missionId,
  objectives
}: {
  ctx: ServiceContext;
  missionId: string;
  objectives: Array<{
    objective: string;
    title?: string | null;
    autoAdvance?: boolean;
    resourceKey?: string | null;
  }>;
}): Promise<ObjectiveSummary[]> {
  if (objectives.length === 0) {
    throw new ServiceError('At least one objective is required', 'validation_error');
  }

  const resolved = await resolveMissionId(ctx, missionId);
  const created: ObjectiveSummary[] = [];

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    for (const item of objectives) {
      created.push(
        await insertObjective({
          ctx: txCtx,
          missionId: resolved.id,
          instructionText: item.objective,
          ...(item.title !== undefined ? { title: item.title } : {}),
          autoAdvance: item.autoAdvance ?? false,
          ...(item.resourceKey !== undefined ? { resourceKey: item.resourceKey } : {}),
          state: 'draft'
        })
      );
    }
  });
  return created;
}

export async function updateObjective({
  ctx,
  objectiveId,
  autoAdvance
}: {
  ctx: ServiceContext;
  objectiveId: string;
  autoAdvance: boolean;
}): Promise<ObjectiveSummary> {
  const resolved = await resolveObjectiveRef({ ctx, ref: objectiveId });
  const existing = (await ctx.db.get(
    `SELECT o.id, o.mission_id, o.project_id, o.position, o.title, o.instruction_text, o.state,
            o.auto_advance, o.resource_key, o.display_key, o.revision,
            m.display_id AS mission_display_id
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id
      WHERE o.id = ? AND o.workspace_id = ? AND o.deleted_at IS NULL`,
    [resolved.id, ctx.workspace.id]
  )) as
    | {
        id: string;
        mission_id: string;
        project_id: string;
        position: number;
        title: string | null;
        instruction_text: string;
        state: string;
        auto_advance: number;
        resource_key: string | null;
        display_key: string;
        revision: number;
        mission_display_id: string;
      }
    | undefined;
  if (!existing) {
    throw new ServiceError('Objective not found', 'not_found', 404);
  }

  const now = nowIso();
  const nextRevision = existing.revision + 1;
  await ctx.db.run(
    `UPDATE objectives
        SET auto_advance = ?, updated_at = ?, revision = ?
      WHERE id = ? AND workspace_id = ?`,
    [bindBool(ctx.db.dialect, autoAdvance), now, nextRevision, existing.id, ctx.workspace.id]
  );

  await recordChange({
    ctx,
    entityType: 'objective',
    entityId: existing.id,
    operation: 'update',
    entityRevision: nextRevision,
    projectId: existing.project_id,
    missionId: existing.mission_id,
    objectiveId: existing.id,
    changedFields: ['auto_advance']
  });

  return toObjectiveSummary({ ...existing, auto_advance: autoAdvance ? 1 : 0 });
}

async function resolveDraftObjectiveToDiscuss({
  ctx,
  missionId,
  objectives,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectives: ObjectiveSummary[];
  objectiveId: string;
}): Promise<ObjectiveSummary> {
  const resolved = await resolveObjectiveRef({ ctx, ref: objectiveId, missionId });
  const match = objectives.find(candidate => candidate.id === resolved.id);
  if (!match) {
    throw new ServiceError(
      `Objective ${objectiveId} does not belong to this mission`,
      'invalid_objective_ref',
      400
    );
  }
  if (match.state !== 'draft') {
    throw new ServiceError(
      `Objective ${match.displayId} is ${match.state}, not draft`,
      'validation_error'
    );
  }
  return match;
}

export async function discussObjective({
  ctx,
  missionId,
  objectiveId = null
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
}): Promise<ObjectiveSummary> {
  const objectives = await listObjectives({ ctx, missionId });
  // A mission may hold several drafts once objectives are added in batches, so
  // "the draft" is only unambiguous when the caller did not name one.
  const draft = objectiveId?.trim()
    ? await resolveDraftObjectiveToDiscuss({ ctx, missionId, objectives, objectiveId })
    : objectives.find(o => o.state === 'draft');
  if (!draft) {
    throw new ServiceError('No draft objective found on mission', 'validation_error');
  }

  const now = nowIso();
  await ctx.db.run(
    `UPDATE objectives SET state = 'launching', updated_at = ?, revision = revision + 1
       WHERE id = ? AND mission_id = ?`,
    [now, draft.id, draft.missionId]
  );

  await recordChange({
    ctx,
    entityType: 'objective',
    entityId: draft.id,
    operation: 'update',
    projectId: draft.projectId,
    missionId: draft.missionId,
    objectiveId: draft.id,
    changedFields: ['state']
  });

  return { ...draft, state: 'launching' };
}

export async function listMissionEvents({
  ctx,
  missionId,
  limit = 100
}: {
  ctx: ServiceContext;
  missionId: string;
  limit?: number;
}): Promise<MissionEventSummary[]> {
  const resolved = await resolveMissionId(ctx, missionId);
  const rows = (await ctx.db.all(
    `SELECT id, type, phase, summary, created_at, objective_id
       FROM mission_events WHERE mission_id = ? ORDER BY created_at ASC LIMIT ?`,
    [resolved.id, limit]
  )) as Array<{
    id: string;
    type: string;
    phase: string | null;
    summary: string;
    created_at: string;
    objective_id: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    phase: row.phase,
    summary: row.summary,
    createdAt: row.created_at,
    objectiveId: row.objective_id
  }));
}

export async function listSharedContext({
  ctx,
  missionId,
  keySubstring,
  limit = 50
}: {
  ctx: ServiceContext;
  missionId: string;
  keySubstring?: string | null;
  limit?: number;
}): Promise<SharedContextEntry[]> {
  const resolved = await resolveMissionId(ctx, missionId);
  const params: Array<string | number> = [resolved.id];
  let sql = `SELECT id, key, value_kind, value_text, value_json, updated_at, revision
             FROM shared_context_entries
             WHERE mission_id = ? AND deleted_at IS NULL`;

  if (keySubstring?.trim()) {
    sql += ' AND key LIKE ?';
    params.push(`%${keySubstring.trim()}%`);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const rows = (await ctx.db.all(sql, params)) as Array<{
    id: string;
    key: string;
    value_kind: string;
    value_text: string | null;
    value_json: string | null;
    updated_at: string;
    revision: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    key: row.key,
    value:
      row.value_kind === 'json' && row.value_json
        ? (JSON.parse(row.value_json) as unknown)
        : row.value_text,
    tags: [],
    updatedAt: row.updated_at,
    revision: row.revision
  }));
}

export async function writeSharedContext({
  ctx,
  missionId,
  key,
  value
}: {
  ctx: ServiceContext;
  missionId: string;
  key: string;
  value: unknown;
  tags?: string[];
}): Promise<SharedContextEntry> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new ServiceError('Shared context key is required', 'validation_error');
  }

  const resolved = await resolveMissionId(ctx, missionId);
  const now = nowIso();
  const existing = (await ctx.db.get(
    `SELECT id, revision FROM shared_context_entries
       WHERE mission_id = ? AND workspace_id = ? AND key = ? AND deleted_at IS NULL`,
    [resolved.id, ctx.workspace.id, trimmedKey]
  )) as { id: string; revision: number } | undefined;

  const isJson = typeof value === 'object' && value !== null;
  const valueKind = isJson ? 'json' : 'string';
  const valueText = isJson ? null : String(value);
  const valueJson = isJson ? JSON.stringify(value) : null;

  let entryId: string;
  let revision: number;

  if (existing) {
    entryId = existing.id;
    revision = existing.revision + 1;
    await ctx.db.run(
      `UPDATE shared_context_entries
         SET value_kind = ?, value_text = ?, value_json = ?, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [valueKind, valueText, valueJson, now, revision, entryId, ctx.workspace.id]
    );
  } else {
    entryId = newId();
    revision = 1;
    await ctx.db.run(
      `INSERT INTO shared_context_entries
           (id, workspace_id, mission_id, key, value_kind, value_text, value_json,
            created_by_workspace_user_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        entryId,
        ctx.workspace.id,
        resolved.id,
        trimmedKey,
        valueKind,
        valueText,
        valueJson,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );
  }

  await recordChange({
    ctx,
    entityType: 'shared_context_entry',
    entityId: entryId,
    operation: existing ? 'update' : 'insert',
    entityRevision: revision,
    projectId: resolved.projectId,
    missionId: resolved.id,
    changedFields: ['key', 'value_kind', 'value_text', 'value_json']
  });

  return {
    id: entryId,
    key: trimmedKey,
    value,
    tags: [],
    updatedAt: now,
    revision
  };
}

export const CORE_ARTIFACT_TYPES = new Set([
  'test_results',
  'next_steps',
  'note',
  'url',
  'decision',
  'migration'
]);

export async function insertArtifactRow({
  ctx,
  workspaceId,
  projectId,
  missionId,
  objectiveId,
  sessionId,
  deliveryId,
  type,
  label,
  contentText,
  externalUrl,
  createdByWorkspaceUserId,
  now
}: {
  ctx: ServiceContext;
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string | null;
  sessionId: string | null;
  deliveryId: string | null;
  type: string;
  label: string;
  contentText: string | null;
  externalUrl: string | null;
  createdByWorkspaceUserId?: string | null;
  now?: string;
}): Promise<{ id: string }> {
  const trimmedType = type.trim();
  // Core CHECK currently enumerates the six built-in types; namespaced extension
  // values are accepted here and rejected by the DB if the deployment has not
  // widened the constraint.
  if (!CORE_ARTIFACT_TYPES.has(trimmedType) && !trimmedType.includes('.')) {
    throw new ServiceError(
      `Artifact type must be one of ${[...CORE_ARTIFACT_TYPES].join(', ')} or a namespaced extension value`,
      'validation_error'
    );
  }

  const id = newId();
  const createdAt = now ?? nowIso();
  await ctx.db.run(
    `INSERT INTO artifacts
       (id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
        type, label, content_text, external_url, created_by_workspace_user_id,
        created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      workspaceId,
      projectId,
      missionId,
      objectiveId,
      sessionId,
      deliveryId,
      trimmedType,
      label,
      contentText,
      externalUrl,
      createdByWorkspaceUserId ?? ctx.actorWorkspaceUserId ?? null,
      createdAt,
      createdAt
    ]
  );
  return { id };
}

export async function listArtifacts({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<ArtifactSummary[]> {
  const resolved = await resolveMissionId(ctx, missionId);
  const rows = (await ctx.db.all(
    `SELECT id, type, label, content_text, external_url
       FROM artifacts WHERE mission_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    [resolved.id]
  )) as Array<{
    id: string;
    type: string;
    label: string;
    content_text: string | null;
    external_url: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    label: row.label,
    content: row.content_text,
    externalUrl: row.external_url
  }));
}

export async function listAttachments({
  ctx,
  missionId,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
}): Promise<AttachmentSummary[]> {
  const resolved = await resolveMissionId(ctx, missionId);
  const params: string[] = [resolved.id];
  let sql = `SELECT id, storage_key, filename, content_type, size_bytes, upload_status
             FROM attachments
             WHERE mission_id = ? AND deleted_at IS NULL`;

  if (objectiveId) {
    // Callers reach this with an objective display id (`coo:756.k7xm`) as often
    // as a UUID; comparing the raw ref to the UUID column would silently match
    // nothing instead of failing.
    const objective = await resolveObjectiveRef({ ctx, ref: objectiveId, missionId: resolved.id });
    sql += ' AND objective_id = ?';
    params.push(objective.id);
  }

  sql += ' ORDER BY created_at ASC';
  const rows = (await ctx.db.all(sql, params)) as Array<{
    id: string;
    storage_key: string;
    filename: string;
    content_type: string | null;
    size_bytes: number | null;
    upload_status: string;
  }>;

  return rows.map(row => ({
    id: row.id,
    storageKey: row.storage_key,
    filename: row.filename,
    mimeType: row.content_type,
    sizeBytes: row.size_bytes,
    status: row.upload_status
  }));
}

// Mirrors backend/repository.ts's MY_POSITION_STEP: gap-based spacing so a
// personal-position renumber reads naturally.
const MY_POSITION_STEP = 100;

async function topMyMissionPosition(
  ctx: ServiceContext,
  workspaceUserId: string,
  statusId: string
): Promise<number> {
  const row = (await ctx.db.get(
    `SELECT MIN(position) AS min_pos FROM my_mission_positions
       WHERE workspace_user_id = ? AND status_id = ?`,
    [workspaceUserId, statusId]
  )) as { min_pos: number | null };
  const minPos = row.min_pos;
  return minPos === null ? MY_POSITION_STEP : minPos - MY_POSITION_STEP;
}

// Mirrors backend/repository.ts's upsertMyMissionPosition. Needed because
// My Missions ordering sorts any explicitly-positioned mission in a column
// ahead of unpositioned ones regardless of board_position, so a delivered
// mission with no row here (or a stale row from a previous drag) can land
// below other missions in the review column instead of at the top.
async function upsertMyMissionPositionOnReview(
  ctx: ServiceContext,
  {
    workspaceId,
    projectId,
    workspaceUserId,
    missionId,
    statusId,
    position,
    now
  }: {
    workspaceId: string;
    projectId: string;
    workspaceUserId: string;
    missionId: string;
    statusId: string;
    position: number;
    now: string;
  }
): Promise<void> {
  const existing = (await ctx.db.get(
    `SELECT id, revision FROM my_mission_positions
       WHERE workspace_id = ? AND workspace_user_id = ? AND mission_id = ?`,
    [workspaceId, workspaceUserId, missionId]
  )) as { id: string; revision: number } | undefined;

  if (existing) {
    await ctx.db.run(
      `UPDATE my_mission_positions
          SET project_id = ?, status_id = ?, position = ?, updated_at = ?, revision = ?
        WHERE id = ?`,
      [projectId, statusId, position, now, existing.revision + 1, existing.id]
    );
    return;
  }

  await ctx.db.run(
    `INSERT INTO my_mission_positions
       (id, workspace_id, project_id, workspace_user_id, mission_id, status_id, position, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [newId(), workspaceId, projectId, workspaceUserId, missionId, statusId, position, now, now]
  );
}

export async function moveMissionToReview({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<void> {
  const mission = await getMissionSummary({ ctx, missionId });
  const reviewStatus = await getReviewStatusId(ctx, mission.projectId);
  const now = nowIso();
  const boardPosition = await topBoardPosition(ctx, mission.projectId, reviewStatus.id);

  await ctx.db.run(
    `UPDATE missions SET status_id = ?, status_type = ?, board_position = ?, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [reviewStatus.id, reviewStatus.type, boardPosition, now, mission.id]
  );

  const assignee = (await ctx.db.get(
    `SELECT assigned_workspace_user_id FROM missions WHERE id = ?`,
    [mission.id]
  )) as { assigned_workspace_user_id: string | null };
  if (assignee.assigned_workspace_user_id) {
    const myPosition = await topMyMissionPosition(
      ctx,
      assignee.assigned_workspace_user_id,
      reviewStatus.id
    );
    await upsertMyMissionPositionOnReview(ctx, {
      workspaceId: ctx.workspace.id,
      projectId: mission.projectId,
      workspaceUserId: assignee.assigned_workspace_user_id,
      missionId: mission.id,
      statusId: reviewStatus.id,
      position: myPosition,
      now
    });
  }

  await recordChange({
    ctx,
    entityType: 'mission',
    entityId: mission.id,
    operation: 'update',
    projectId: mission.projectId,
    missionId: mission.id,
    changedFields: ['status_id', 'status_type', 'board_position']
  });
  await enqueueWebhookEvent(ctx, {
    type: 'mission.status_changed',
    projectId: mission.projectId,
    entity: { missionId: mission.id }
  });
}

export async function moveMissionToExecute({
  ctx,
  missionId
}: {
  ctx: ServiceContext;
  missionId: string;
}): Promise<void> {
  const mission = await getMissionSummary({ ctx, missionId });
  const executeStatus = await getExecuteStatusId(ctx, mission.projectId);
  if (mission.statusId === executeStatus.id && mission.statusType === executeStatus.type) {
    return;
  }

  const now = nowIso();
  const boardPosition = await topBoardPosition(ctx, mission.projectId, executeStatus.id);

  await ctx.db.run(
    `UPDATE missions
       SET status_id = ?, status_type = ?, board_position = ?, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [executeStatus.id, executeStatus.type, boardPosition, now, mission.id]
  );

  await recordChange({
    ctx,
    entityType: 'mission',
    entityId: mission.id,
    operation: 'update',
    projectId: mission.projectId,
    missionId: mission.id,
    changedFields: ['status_id', 'status_type', 'board_position']
  });
  await enqueueWebhookEvent(ctx, {
    type: 'mission.status_changed',
    projectId: mission.projectId,
    entity: { missionId: mission.id }
  });
}

export { getDefaultStatusId, getExecuteStatusId, getProjectStatusById, getReviewStatusId };
