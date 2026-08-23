import { bindBool, UPDATE_EVENT_TYPES, UPDATE_PHASES } from '@overlord/database';
import { createHash } from 'node:crypto';

import { bindChannelToSession, findBindableChannelForMission } from './agent-session/channels.js';
import { hasControlCharacters, isExactEvidencePath } from './agent-session/pure/evidence-path.js';
import { emitNotification } from './notifications/notifications.js';
import { recordChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { resolveMissionId, resolveObjectiveRef, resolveProjectId } from './context.js';
import { buildDeliveryReport, markDeliveryPresentationPending } from './delivery-report.js';
import { ServiceError } from './errors.js';
import { linkExecutionRequestToSession } from './execution-requests.js';
import { findActingDeviceExecutionTargetId } from './execution-targets.js';
import { bindProviderSessionAgentSession } from './latch-provider-session.js';
import {
  enqueueLiveActivityRefreshForMission,
  enqueueLiveActivityStartForMission
} from './live-activity-jobs.js';
import {
  type ArtifactSummary,
  type AttachmentSummary,
  createMissionWithObjectives,
  ensureNextDraftObjective,
  getMissionSummary,
  insertArtifactRow,
  listArtifacts,
  listAttachments,
  listMissionEvents,
  listObjectives,
  listSharedContext,
  type MissionEventSummary,
  type MissionSummary,
  moveMissionToExecute,
  moveMissionToReview,
  type ObjectiveSummary,
  type SharedContextEntry
} from './missions.js';
import {
  OBJECTIVE_COMPLETED_AT_ASSIGNMENT,
  OBJECTIVE_LAUNCHED_AT_ASSIGNMENT,
  OBJECTIVE_STARTED_AT_ASSIGNMENT
} from './objective-lifecycle-timestamps.js';
import { countActiveMissionObjectives } from './objective-parallelism.js';
import { loadAgentInstructionsForWorkspaceUser } from './profiles.js';
import {
  buildProjectResourceManifest,
  formatProjectResourcesInstructions,
  type ProjectResourceManifestEntry
} from './project-resource-manifest.js';
import {
  discoverProject,
  findPrimaryProjectResource,
  findProjectResourceByKey
} from './projects.js';
import { enqueueRunQueueDispatch } from './run-queue.js';
import { generateSessionKey, hashSessionKey, newId, nowIso } from './util.js';
import { enqueueWebhookEvent } from './webhook-events.js';
import { enqueueDeliveryComposeJob } from './worker-jobs.js';
import { resolveAgentMissionAssignee } from './workspace-members.js';

export type SessionSummary = {
  id: string;
  sessionKey: string;
  state: string;
  objectiveId: string;
  missionId: string;
  phase: string;
  deliveryState: string;
};

export type AttachResponse = {
  mission: MissionSummary;
  objective: ObjectiveSummary;
  previousObjectives: ObjectiveSummary[];
  futureObjectives: ObjectiveSummary[];
  session: SessionSummary;
  history: MissionEventSummary[];
  artifacts: ArtifactSummary[];
  attachments: AttachmentSummary[];
  sharedState: SharedContextEntry[];
  agentInstructions: string;
  projectResources?: ProjectResourceManifestEntry[];
};

type SessionRow = {
  id: string;
  mission_id: string;
  objective_id: string;
  phase: string;
  delivery_state: string;
  ended_at: string | null;
  external_session_id: string | null;
};

const PROTOCOL_WORKFLOW = `

1. Read the current objective from the top-level \`objective\` field in this JSON response, then immediately begin executing it. This is an execution session: do not wait for more instructions or ask for confirmation.
2. Post progress with \`ovld protocol update\` or liveness with \`ovld protocol heartbeat\`.
3. Ask blocking questions with \`ovld protocol ask\` and stop work only when no safe progress remains.
4. Deliver with \`ovld protocol deliver\` when work is complete. A summary is the only required
   delivery input; optional change rationales use the canonical \`filePath\` field.
5. Do not stage or commit changes unless explicitly instructed to do so.
6. Do not continue implementation after delivery without \`--begin-follow-up-work\`.

Optional change-rationale format:
  Pass an array via \`--change-rationales-json '[ ... ]'\` (or stream it on stdin with
  \`--change-rationales-file -\` for large arrays). Each entry is a JSON object — use these
  exact field names:
    - \`filePath\` (string, required) — repo-relative path of the changed file.
    - \`label\`     (string, required) — short reviewer-facing title for the change.
    - \`summary\`   (string, required) — what changed. This field is named \`summary\`, NOT
      \`rationale\`; an annotation with unknown or retired keys is ignored with a bounded warning.
    - \`why\`       (string, required) — why the change was made.
    - \`impact\`    (string, required) — behavioral impact of the change.
    - \`hunks\`     (optional) — array of { "header": "@@ -10,6 +10,14 @@" } diff-hunk headers.
  Do NOT wrap entries under a \`rationale\` key, and do not send a top-level \`file_changes\`
  artifact. Example single entry:
    {"filePath":"src/api.ts","label":"Add retry","summary":"Added retry with backoff.","why":"Transient failures.","impact":"Requests retry up to 3x."}
  Changed files are synchronized from the objective ledger before delivery; do not send changed-file,
  observed-dirty-path, no-file-change, or rationale-skip inputs with update or deliver.

Delivery evidence:
  Every delivery should also provide a \`deliveryReport.agentReport\` in \`--payload-json\` or
  \`--payload-file\`: \`humanActions\`, \`tradeoffsMade\`, \`knownRisks\`, \`deferredWork\`, and
  \`assumptions\`. Use empty arrays when none apply. Human actions are only concrete work a
  human must perform outside completed agent work; never include Git actions or routine review/testing.
  Tradeoffs must describe an implementation decision, alternatives considered, and why it was chosen.`;

function resolveActiveObjective(objectives: ObjectiveSummary[]): ObjectiveSummary {
  const rankedStates = ['executing', 'launching', 'pending_delivery'] as const;
  for (const state of rankedStates) {
    const matches = objectives.filter(objective => objective.state === state);
    if (matches.length > 1) {
      throw new ServiceError(
        'Multiple active objectives; pass --objective-id to attach',
        'ambiguous_active_objective',
        409
      );
    }
    if (matches.length === 1) return matches[0]!;
  }

  const active =
    objectives.find(o => o.state === 'draft') ?? objectives.find(o => o.state !== 'complete');

  if (!active) {
    throw new ServiceError('No active objective found on mission', 'no_active_objective', 409);
  }
  return active;
}

/**
 * Pin attach to a known objective before falling back to mission-state rediscovery.
 *
 * 1. Explicit `--objective-id` (UUID or display id) that belongs to this mission.
 * 2. Else the execution request's `objective_id`.
 * 3. Else today's `resolveActiveObjective`.
 *
 * When (1) or (2) is present, do not fall through to (3).
 */
/**
 * Resolve an explicit objective reference (UUID or `coo:756.k7xm`) against the
 * mission's own objectives, falling back to state-based rediscovery when no
 * reference was supplied. Shared by attach, connect, and load-context so every
 * session-shaped entry point pins identically.
 */
async function resolvePinnedObjective({
  ctx,
  missionId,
  objectives,
  objectiveId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectives: ObjectiveSummary[];
  objectiveId?: string | null;
}): Promise<ObjectiveSummary> {
  const explicit = objectiveId?.trim();
  if (!explicit) return resolveActiveObjective(objectives);

  const resolved = await resolveObjectiveRef({ ctx, ref: explicit, missionId });
  const match = objectives.find(candidate => candidate.id === resolved.id);
  if (!match) {
    throw new ServiceError(
      `Objective ${explicit} does not belong to this mission`,
      'invalid_objective_ref',
      400
    );
  }
  return match;
}

async function resolvePinnedAttachObjective({
  ctx,
  missionId,
  objectives,
  objectiveId,
  executionRequestId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectives: ObjectiveSummary[];
  objectiveId?: string | null;
  executionRequestId?: string | null;
}): Promise<ObjectiveSummary> {
  const explicit = objectiveId?.trim();
  if (explicit) {
    return resolvePinnedObjective({ ctx, missionId, objectives, objectiveId: explicit });
  }

  const requestId = executionRequestId?.trim();
  if (requestId) {
    const row = (await ctx.db.get(
      `SELECT objective_id, mission_id
         FROM execution_requests
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [requestId, ctx.workspace.id]
    )) as { objective_id: string; mission_id: string } | undefined;
    if (!row || row.mission_id !== missionId) {
      throw new ServiceError(
        'Execution request does not match this mission/objective',
        'execution_request_mismatch',
        409
      );
    }
    const match = objectives.find(candidate => candidate.id === row.objective_id);
    if (!match) {
      throw new ServiceError(
        'Execution request does not match this mission/objective',
        'execution_request_mismatch',
        409
      );
    }
    return match;
  }

  return resolveActiveObjective(objectives);
}

async function getSessionByKeyMaybeEnded(
  ctx: ServiceContext,
  sessionKey: string,
  options: { includeEnded?: boolean } = {}
): Promise<SessionRow | undefined> {
  const hash = hashSessionKey(sessionKey);
  const endedFilter = options.includeEnded ? '' : 'AND ended_at IS NULL';
  return (await ctx.db.get(
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id
       FROM agent_sessions
       WHERE workspace_id = ? AND session_key_hash = ? AND deleted_at IS NULL ${endedFilter}
       ORDER BY started_at DESC LIMIT 1`,
    [ctx.workspace.id, hash]
  )) as SessionRow | undefined;
}

async function getSessionByKey(ctx: ServiceContext, sessionKey: string): Promise<SessionRow> {
  const row = await getSessionByKeyMaybeEnded(ctx, sessionKey);

  if (!row) {
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
  return row;
}

async function getLatestSessionByExternalId({
  ctx,
  missionId,
  externalSessionId
}: {
  ctx: ServiceContext;
  missionId: string;
  externalSessionId: string;
}): Promise<SessionRow | undefined> {
  return (await ctx.db.get(
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id
       FROM agent_sessions
       WHERE workspace_id = ? AND mission_id = ? AND external_session_id = ? AND deleted_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    [ctx.workspace.id, missionId, externalSessionId]
  )) as SessionRow | undefined;
}

async function getLatestSessionForObjective({
  ctx,
  objectiveId,
  openOnly = false
}: {
  ctx: ServiceContext;
  objectiveId: string;
  openOnly?: boolean;
}): Promise<SessionRow | undefined> {
  const endedFilter = openOnly ? 'AND ended_at IS NULL' : '';
  return (await ctx.db.get(
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id
       FROM agent_sessions
       WHERE workspace_id = ? AND objective_id = ? AND deleted_at IS NULL ${endedFilter}
       ORDER BY started_at DESC LIMIT 1`,
    [ctx.workspace.id, objectiveId]
  )) as SessionRow | undefined;
}

async function persistExternalSessionId({
  ctx,
  session,
  externalSessionId,
  mission
}: {
  ctx: ServiceContext;
  session: SessionRow;
  externalSessionId: string;
  mission: MissionSummary;
}): Promise<void> {
  if (session.external_session_id === externalSessionId) return;

  const now = nowIso();
  await ctx.db.run(
    `UPDATE agent_sessions SET external_session_id = ?, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [externalSessionId, now, session.id]
  );

  const revision = (
    (await ctx.db.get(`SELECT revision FROM agent_sessions WHERE id = ?`, [session.id])) as
      | { revision: number }
      | undefined
  )?.revision;

  await recordChange({
    ctx,
    entityType: 'agent_session',
    entityId: session.id,
    operation: 'update',
    entityRevision: revision ?? null,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: session.objective_id,
    changedFields: ['external_session_id']
  });
}

/**
 * A blank objective slot is a placeholder the UI keeps around so the user can
 * type the next objective — it is not work anybody has planned. Agents must
 * never see it, because an untyped slot reads to them like a real objective
 * that is merely awaiting approval.
 */
function hasInstruction(objective: ObjectiveSummary): boolean {
  return Boolean(objective.objective?.trim());
}

/**
 * Split a mission's objectives into the objectives before and after the current
 * one. Both arrays exclude the current objective (which is surfaced separately as
 * the top-level `objective`). `previousObjectives` are what has already been
 * worked (positioned before the current objective) and `futureObjectives` are
 * what is expected next (positioned after) — distinct from what the agent should
 * operate on today. Objectives with empty instructions are excluded from both:
 * they are empty input slots, not planned work.
 */
function splitObjectivesAroundCurrent({
  objectives,
  currentObjective
}: {
  objectives: ObjectiveSummary[];
  currentObjective: ObjectiveSummary;
}): { previousObjectives: ObjectiveSummary[]; futureObjectives: ObjectiveSummary[] } {
  const authored = objectives.filter(
    candidate => candidate.id !== currentObjective.id && hasInstruction(candidate)
  );
  const previousObjectives = authored.filter(
    candidate => candidate.position < currentObjective.position
  );
  const futureObjectives = authored.filter(
    candidate => candidate.position > currentObjective.position
  );
  return { previousObjectives, futureObjectives };
}

function assembleAgentInstructions({
  mission,
  objective,
  projectName,
  agentInstructions,
  projectResourcesSection = null
}: {
  mission: MissionSummary;
  objective: ObjectiveSummary;
  projectName: string;
  agentInstructions: string | null;
  projectResourcesSection?: string | null;
}): string {
  const objectiveLabel = objective.title?.trim() || `Objective ${objective.position + 1}`;

  return [
    `# Overlord Agent Instructions`,
    `You are attached to mission **${mission.displayId}** via Overlord.`,
    ``,
    `Mission ID: ${mission.displayId}  <- pass this to every \`ovld protocol ... --mission-id\` call`,
    `Objective ID: ${objective.displayId}  <- pass as --objective-id on attach; never as --mission-id`,
    `Objective: ${objectiveLabel}`,
    `Project: ${projectName}`,
    '',
    '## Context Location',
    '- The current task body is in the top-level `objective.objective` field.',
    '- Previous and future work are in `previousObjectives` and `futureObjectives`.',
    '- History, attachments, artifacts, and shared context are in their structured top-level fields.',
    '',
    projectResourcesSection ? '' : null,
    projectResourcesSection,
    `## Required Protocol Workflow`,
    PROTOCOL_WORKFLOW,
    '',
    '## Important Notes',
    `- Other agents may be working on the same branch as you, so you may notice file changes that are not yours. EXCLUDE THESE FROM THE FILE CHANGES YOU REPORT.`,
    agentInstructions ? '' : null,
    agentInstructions ? '## Additional Instructions' : null,
    agentInstructions
  ]
    .filter((line): line is string => line !== null)
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    .join('\n');
}

async function resolveProtocolExecutionTargetId({
  ctx,
  executionTargetId,
  executionRequestId,
  missionId,
  objectiveId
}: {
  ctx: ServiceContext;
  executionTargetId?: string | null;
  executionRequestId?: string | null;
  missionId?: string;
  objectiveId?: string;
}): Promise<string | null> {
  const explicit = executionTargetId?.trim();
  if (explicit) return explicit;

  if (executionRequestId?.trim() && missionId && objectiveId) {
    const row = (await ctx.db.get(
      `SELECT claimed_by_execution_target_id, execution_target_id
         FROM execution_requests
        WHERE id = ?
          AND workspace_id = ?
          AND mission_id = ?
          AND objective_id = ?
          AND deleted_at IS NULL`,
      [executionRequestId.trim(), ctx.workspace.id, missionId, objectiveId]
    )) as
      | {
          claimed_by_execution_target_id: string | null;
          execution_target_id: string | null;
        }
      | undefined;
    if (row) {
      return row.claimed_by_execution_target_id ?? row.execution_target_id ?? null;
    }
  }

  // Attribution falls back to the acting machine's already-declared target and
  // stays null when it has none (contract v38); attach never declares a target.
  try {
    return await findActingDeviceExecutionTargetId({ ctx });
  } catch {
    return null;
  }
}

async function resolveSessionResourceId({
  ctx,
  session,
  mission
}: {
  ctx: ServiceContext;
  session: { id: string; objective_id: string };
  mission: { projectId: string };
}): Promise<string | null> {
  const requestRow = (await ctx.db.get(
    `SELECT resolved_resource_id, claimed_by_execution_target_id, execution_target_id
       FROM execution_requests
      WHERE workspace_id = ?
        AND launched_session_id = ?
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1`,
    [ctx.workspace.id, session.id]
  )) as
    | {
        resolved_resource_id: string | null;
        claimed_by_execution_target_id: string | null;
        execution_target_id: string | null;
      }
    | undefined;

  if (requestRow?.resolved_resource_id) return requestRow.resolved_resource_id;

  let executionTargetId =
    requestRow?.claimed_by_execution_target_id ?? requestRow?.execution_target_id ?? null;
  if (!executionTargetId) {
    try {
      executionTargetId = await findActingDeviceExecutionTargetId({ ctx });
    } catch {
      executionTargetId = null;
    }
  }

  const objectiveRow = (await ctx.db.get(
    `SELECT resource_key FROM objectives WHERE id = ? AND deleted_at IS NULL`,
    [session.objective_id]
  )) as { resource_key: string | null } | undefined;
  const resourceKey = objectiveRow?.resource_key?.trim();
  if (resourceKey) {
    const resource = await findProjectResourceByKey({
      ctx,
      projectId: mission.projectId,
      resourceKey,
      executionTargetId
    });
    if (resource) return resource.id;
    // The bound key may exist project-wide even when not linked on this
    // target; attributing to it beats mis-attributing files to the primary.
    if (executionTargetId !== null) {
      const anyTarget = await findProjectResourceByKey({
        ctx,
        projectId: mission.projectId,
        resourceKey,
        executionTargetId: null
      });
      if (anyTarget) return anyTarget.id;
    }
  }

  const primary = await findPrimaryProjectResource({
    ctx,
    projectId: mission.projectId,
    executionTargetId
  });
  return primary?.id ?? null;
}

async function contextForObjective({
  ctx,
  mission,
  objective,
  executionTargetId = null
}: {
  ctx: ServiceContext;
  mission: MissionSummary;
  objective: ObjectiveSummary;
  executionTargetId?: string | null;
}): Promise<Omit<AttachResponse, 'session'>> {
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  const history = await listMissionEvents({ ctx, missionId: mission.id });
  const artifacts = await listArtifacts({ ctx, missionId: mission.id });
  const attachments = await listAttachments({
    ctx,
    missionId: mission.id,
    objectiveId: objective.id
  });
  const sharedState = await listSharedContext({ ctx, missionId: mission.id });
  const { previousObjectives, futureObjectives } = splitObjectivesAroundCurrent({
    objectives,
    currentObjective: objective
  });

  const project = (await ctx.db.get(`SELECT name FROM projects WHERE id = ?`, [
    mission.projectId
  ])) as { name: string };

  const agentInstructions = await loadAgentInstructionsForWorkspaceUser({
    db: ctx.db,
    workspaceUserId: ctx.actorWorkspaceUserId
  });

  const projectResources = await buildProjectResourceManifest({
    ctx,
    projectId: mission.projectId,
    executionTargetId,
    currentResourceKey: objective.resourceKey ?? null
  });
  const projectResourcesSection = formatProjectResourcesInstructions(projectResources);

  return {
    mission,
    objective,
    previousObjectives,
    futureObjectives,
    history,
    artifacts,
    attachments,
    sharedState,
    ...(projectResources.length > 0 ? { projectResources } : {}),
    agentInstructions: assembleAgentInstructions({
      mission,
      objective,
      projectName: project.name,
      agentInstructions,
      projectResourcesSection
    })
  };
}

export async function loadMissionContext({
  ctx,
  missionId,
  objectiveId = null,
  executionTargetId = null
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
  executionTargetId?: string | null;
}): Promise<Omit<AttachResponse, 'session'>> {
  const mission = await getMissionSummary({ ctx, missionId });
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  // Reading context is the reconnect path, so it must be pinnable the same way
  // attach is: a mission running two objectives in parallel has no single
  // "active" objective to rediscover.
  const objective = await resolvePinnedObjective({
    ctx,
    missionId: mission.id,
    objectives,
    objectiveId
  });
  const resolvedTargetId = await resolveProtocolExecutionTargetId({
    ctx,
    executionTargetId,
    missionId: mission.id,
    objectiveId: objective.id
  });
  return await contextForObjective({
    ctx,
    mission,
    objective,
    executionTargetId: resolvedTargetId
  });
}

export async function attachSession({
  ctx,
  missionId,
  agentIdentifier = 'unknown',
  modelIdentifier,
  connectionMethod = 'cli',
  existingSessionKey,
  externalSessionId,
  executionRequestId,
  executionTargetId = null,
  sessionChannelId = null,
  objectiveId = null
}: {
  ctx: ServiceContext;
  missionId: string;
  agentIdentifier?: string;
  modelIdentifier?: string | null;
  connectionMethod?: string;
  existingSessionKey?: string | null;
  externalSessionId?: string | null;
  executionRequestId?: string | null;
  executionTargetId?: string | null;
  /**
   * The channel prepared by the launch path, named by `OVERLORD_SESSION_CHANNEL_ID`.
   *
   * Only the channel *id* travels here — never its credential, which stays in the launched
   * process's environment and reaches the backend only through the adapter route family's
   * Authorization header. Attach is already authenticated by the caller's own credential, so
   * the id is enough to bind; and `bindChannelToSession` refuses a channel that belongs to
   * another mission or is already bound elsewhere, so naming someone else's channel id
   * achieves nothing.
   */
  sessionChannelId?: string | null;
  /** UUID or `{mission.display_id}.{display_key}`. Pins attach; skips rediscovery. */
  objectiveId?: string | null;
}): Promise<AttachResponse & { sessionKey: string }> {
  const mission = await getMissionSummary({ ctx, missionId });
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  const explicitPin = Boolean(objectiveId?.trim() || executionRequestId?.trim());
  // A live session already knows its objective. Re-attach must not rediscover
  // via mission state — with two executing siblings that 409s as ambiguous.
  let resolvedObjectiveId = objectiveId;
  if (existingSessionKey?.trim() && !explicitPin) {
    const existing = await getSessionByKey(ctx, existingSessionKey);
    resolvedObjectiveId = existing.objective_id;
  }
  const pinned = Boolean(resolvedObjectiveId?.trim() || executionRequestId?.trim());
  const objective = await resolvePinnedAttachObjective({
    ctx,
    missionId: mission.id,
    objectives,
    objectiveId: resolvedObjectiveId,
    executionRequestId
  });
  const resolvedTargetId = await resolveProtocolExecutionTargetId({
    ctx,
    executionTargetId,
    executionRequestId,
    missionId: mission.id,
    objectiveId: objective.id
  });
  const context = await contextForObjective({
    ctx,
    mission,
    objective,
    executionTargetId: resolvedTargetId
  });

  if (existingSessionKey) {
    const existing = await getSessionByKey(ctx, existingSessionKey);
    if (existing.mission_id !== context.mission.id) {
      throw new ServiceError('Session key belongs to a different mission', 'invalid_session', 401);
    }
    if (pinned && existing.objective_id !== objective.id) {
      throw new ServiceError(
        'Session key belongs to a different objective',
        'session_objective_mismatch',
        409
      );
    }
    if (externalSessionId !== undefined) {
      await ctx.db.run(
        `UPDATE agent_sessions SET external_session_id = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        [externalSessionId, nowIso(), existing.id]
      );
    }
    const linked = await linkExecutionRequestToSession({
      ctx,
      missionId: context.mission.id,
      objectiveId: existing.objective_id,
      sessionId: existing.id,
      executionRequestId: executionRequestId ?? null
    });
    if (linked) {
      await bindProviderSessionAgentSession({
        ctx,
        executionRequestId: linked.id,
        agentSessionId: existing.id
      });
    }
    const refreshedObjective =
      (await listObjectives({ ctx, missionId: context.mission.id })).find(
        candidate => candidate.id === existing.objective_id
      ) ?? context.objective;
    const refreshedContext = await contextForObjective({
      ctx,
      mission: context.mission,
      objective: refreshedObjective,
      executionTargetId: resolvedTargetId
    });
    const resolvedChannelId =
      sessionChannelId ??
      (await findBindableChannelForMission({
        ctx,
        missionId: context.mission.id,
        objectiveId: existing.objective_id,
        executionRequestId: executionRequestId ?? null
      }));
    if (resolvedChannelId) {
      await bindChannelToSession({
        ctx,
        channelId: resolvedChannelId,
        sessionId: existing.id,
        missionId: context.mission.id,
        objectiveId: existing.objective_id,
        projectId: context.mission.projectId,
        nativeSessionId: externalSessionId ?? null,
        agentIdentifier
      });
    }
    return {
      ...refreshedContext,
      session: {
        id: existing.id,
        sessionKey: existingSessionKey,
        state: 'executing',
        objectiveId: existing.objective_id,
        missionId: existing.mission_id,
        phase: existing.phase,
        deliveryState: existing.delivery_state
      },
      sessionKey: existingSessionKey
    };
  }

  const { rawKey, prefix, hash } = generateSessionKey();
  const now = nowIso();
  const sessionId = newId();
  const currentObjectiveAssignment = (await ctx.db.get(
    `SELECT assigned_agent, revision
       FROM objectives
       WHERE id = ? AND mission_id = ? AND deleted_at IS NULL`,
    [objective.id, context.mission.id]
  )) as { assigned_agent: string | null; revision: number } | undefined;
  const inheritedDraftAgent = currentObjectiveAssignment?.assigned_agent?.trim() || agentIdentifier;

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await txCtx.db.run(
      `UPDATE objectives
         SET state = 'executing',
             assigned_agent = COALESCE(assigned_agent, ?),
             ${OBJECTIVE_LAUNCHED_AT_ASSIGNMENT},
             ${OBJECTIVE_STARTED_AT_ASSIGNMENT},
             updated_at = ?,
             revision = revision + 1
         WHERE id = ? AND mission_id = ?`,
      [inheritedDraftAgent || null, now, now, now, objective.id, context.mission.id]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'objective',
      entityId: objective.id,
      operation: 'update',
      entityRevision: (currentObjectiveAssignment?.revision ?? 0) + 1,
      projectId: context.mission.projectId,
      missionId: context.mission.id,
      objectiveId: objective.id,
      changedFields: [
        'state',
        'launched_at',
        'started_at',
        ...(currentObjectiveAssignment?.assigned_agent ? [] : ['assigned_agent'])
      ]
    });
    // The objective just entered execution, which is exactly the moment a
    // desktop-launched mission should appear on the assignee's Lock Screen even
    // though they never opened the phone: refresh any activity already running
    // and, failing that, ask APNs to start one.
    await enqueueLiveActivityStartForMission({
      db: txCtx.db,
      workspaceId: ctx.workspace.id,
      missionId: context.mission.id,
      now
    });

    await ensureNextDraftObjective({
      ctx: txCtx,
      missionId: context.mission.id,
      projectId: context.mission.projectId,
      now
    });

    await moveMissionToExecute({ ctx: txCtx, missionId: context.mission.id });

    await txCtx.db.run(
      `INSERT INTO agent_sessions
           (id, workspace_id, project_id, mission_id, objective_id,
            session_key_prefix, session_key_hash, agent_identifier, model_identifier,
            connection_method, external_session_id, phase, delivery_state, started_at, last_heartbeat_at,
            metadata_json, created_by_workspace_user_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'execute', 'not_delivered', ?, ?, '{}', ?, ?, ?, 1)`,
      [
        sessionId,
        ctx.workspace.id,
        context.mission.projectId,
        context.mission.id,
        objective.id,
        prefix,
        hash,
        agentIdentifier,
        modelIdentifier ?? null,
        connectionMethod,
        externalSessionId ?? null,
        now,
        now,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );

    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session',
      entityId: sessionId,
      operation: 'insert',
      entityRevision: 1,
      projectId: context.mission.projectId,
      missionId: context.mission.id,
      objectiveId: objective.id
    });

    const linked = await linkExecutionRequestToSession({
      ctx: txCtx,
      missionId: context.mission.id,
      objectiveId: objective.id,
      sessionId,
      executionRequestId: executionRequestId ?? null
    });
    if (linked) {
      await bindProviderSessionAgentSession({
        ctx: txCtx,
        executionRequestId: linked.id,
        agentSessionId: sessionId
      });
    }
  });

  // Bind the prepared channel now that a session exists to bind it to. This is what turns the
  // pre-attach window from a hole into a correlated prefix: events the harness published
  // before the agent attached carry only a channel id, and this is where they acquire their
  // session. The working directory takes no part — it can locate an existing binding, but it
  // can never create one.
  //
  // When the launch wrapper stripped `OVERLORD_SESSION_CHANNEL_ID` (agent-pod), resolve the
  // unbound live channel for this mission/execution so the Activity health card still flips
  // off `preparing` once the agent has clearly attached via protocol.
  const resolvedChannelId =
    sessionChannelId ??
    (await findBindableChannelForMission({
      ctx,
      missionId: context.mission.id,
      objectiveId: objective.id,
      executionRequestId: executionRequestId ?? null
    }));
  if (resolvedChannelId) {
    await bindChannelToSession({
      ctx,
      channelId: resolvedChannelId,
      sessionId,
      missionId: context.mission.id,
      objectiveId: objective.id,
      projectId: context.mission.projectId,
      nativeSessionId: externalSessionId ?? null,
      agentIdentifier
    });
  }

  const refreshedMission = await getMissionSummary({ ctx, missionId: context.mission.id });
  const refreshedObjectives = await listObjectives({ ctx, missionId: context.mission.id });
  const refreshedObjective = refreshedObjectives.find(o => o.id === objective.id) ?? {
    ...objective,
    state: 'executing'
  };
  const refreshedSplit = splitObjectivesAroundCurrent({
    objectives: refreshedObjectives,
    currentObjective: refreshedObjective
  });
  const refreshedContext = await contextForObjective({
    ctx,
    mission: refreshedMission,
    objective: refreshedObjective,
    executionTargetId: resolvedTargetId
  });

  return {
    ...refreshedContext,
    mission: refreshedMission,
    objective: refreshedObjective,
    previousObjectives: refreshedSplit.previousObjectives,
    futureObjectives: refreshedSplit.futureObjectives,
    session: {
      id: sessionId,
      sessionKey: rawKey,
      state: 'executing',
      objectiveId: objective.id,
      missionId: context.mission.id,
      phase: 'execute',
      deliveryState: 'not_delivered'
    },
    sessionKey: rawKey
  };
}

export async function connectSession({
  ctx,
  missionId,
  objectiveId = null,
  agentIdentifier = 'unknown',
  externalSessionId
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
  agentIdentifier?: string;
  externalSessionId?: string | null;
}): Promise<{
  sessionKey: string;
  missionId: string;
  objectiveId: string;
  objectiveDisplayId: string;
}> {
  const result = await attachSession({
    ctx,
    missionId,
    objectiveId,
    agentIdentifier,
    connectionMethod: 'connect',
    externalSessionId: externalSessionId ?? null
  });
  return {
    sessionKey: result.sessionKey,
    missionId: result.mission.id,
    objectiveId: result.objective.id,
    objectiveDisplayId: result.objective.displayId
  };
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function objectiveFromSession(
  objectives: ObjectiveSummary[],
  session: SessionRow | undefined
): ObjectiveSummary | undefined {
  if (!session) return undefined;
  return objectives.find(objective => objective.id === session.objective_id);
}

function latestCompletedObjective(objectives: ObjectiveSummary[]): ObjectiveSummary | undefined {
  return [...objectives].reverse().find(objective => objective.state === 'complete');
}

async function resolveFollowUpObjective({
  ctx,
  mission,
  objectives,
  sessionKey,
  externalSessionId
}: {
  ctx: ServiceContext;
  mission: MissionSummary;
  objectives: ObjectiveSummary[];
  sessionKey?: string | null;
  externalSessionId?: string | null;
}): Promise<{ objective: ObjectiveSummary | undefined; session: SessionRow | undefined }> {
  const active =
    objectives.find(objective =>
      ['executing', 'pending_delivery', 'launching', 'submitted', 'draft'].includes(objective.state)
    ) ?? undefined;
  if (active) return { objective: active, session: undefined };

  const sessionFromKey = sessionKey
    ? await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true })
    : undefined;
  const objectiveFromKey = objectiveFromSession(objectives, sessionFromKey);
  if (objectiveFromKey) return { objective: objectiveFromKey, session: sessionFromKey };

  const sessionFromExternal = externalSessionId
    ? await getLatestSessionByExternalId({ ctx, missionId: mission.id, externalSessionId })
    : undefined;
  const objectiveFromExternal = objectiveFromSession(objectives, sessionFromExternal);
  if (objectiveFromExternal) {
    return { objective: objectiveFromExternal, session: sessionFromExternal };
  }

  return { objective: latestCompletedObjective(objectives), session: undefined };
}

export async function recordHookEvent({
  ctx,
  missionId,
  hookType,
  prompt,
  sessionKey,
  externalSessionId,
  turnIndex
}: {
  ctx: ServiceContext;
  missionId: string;
  hookType: string;
  prompt: string;
  sessionKey?: string | null;
  externalSessionId?: string | null;
  turnIndex?: string | null;
}): Promise<{ eventId: string; objectiveId: string | null; sessionId: string | null }> {
  if (hookType !== 'UserPromptSubmit') {
    throw new ServiceError(`Unsupported hook type: ${hookType}`, 'validation_error');
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new ServiceError('Hook prompt is required', 'validation_error');
  }

  const mission = await getMissionSummary({ ctx, missionId });
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  let { objective, session } = await resolveFollowUpObjective({
    ctx,
    mission,
    objectives,
    sessionKey: sessionKey ?? null,
    externalSessionId: externalSessionId ?? null
  });

  if (!session && sessionKey) {
    session = await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true });
  }

  if (!session && objective && ['executing', 'pending_delivery'].includes(objective.state)) {
    session = await getLatestSessionForObjective({
      ctx,
      objectiveId: objective.id,
      openOnly: true
    });
  }

  const hash = promptHash(trimmedPrompt);
  const dedupeParts = [
    hookType,
    mission.id,
    externalSessionId || session?.id || 'unknown-session',
    turnIndex || 'unknown-turn',
    hash
  ];
  const idempotencyKey = dedupeParts.join(':');

  const existing = (await ctx.db.get(
    `SELECT id, objective_id, session_id FROM mission_events
       WHERE workspace_id = ? AND source = ? AND idempotency_key = ?
       LIMIT 1`,
    [ctx.workspace.id, ctx.source, idempotencyKey]
  )) as { id: string; objective_id: string | null; session_id: string | null } | undefined;
  if (existing) {
    return {
      eventId: existing.id,
      objectiveId: existing.objective_id,
      sessionId: existing.session_id
    };
  }

  const eventId = newId();
  const now = nowIso();
  const phase =
    objective && ['executing', 'pending_delivery'].includes(objective.state) ? 'execute' : 'review';

  await ctx.db.run(
    `INSERT INTO mission_events
         (id, workspace_id, project_id, mission_id, objective_id, session_id,
          type, phase, summary, payload_json, source, actor_workspace_user_id,
          idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user_follow_up', ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      ctx.workspace.id,
      mission.projectId,
      mission.id,
      objective?.id ?? null,
      session?.id ?? null,
      phase,
      trimmedPrompt,
      JSON.stringify({
        hookType,
        ...(turnIndex ? { turnIndex } : {}),
        ...(externalSessionId ? { externalSessionId } : {}),
        promptHash: hash
      }),
      ctx.source,
      ctx.actorWorkspaceUserId,
      idempotencyKey,
      now
    ]
  );

  if (externalSessionId && session) {
    await persistExternalSessionId({ ctx, session, externalSessionId, mission });
  }

  return { eventId, objectiveId: objective?.id ?? null, sessionId: session?.id ?? null };
}

export async function resumeFollowUp({
  ctx,
  missionId,
  objectiveId,
  agentIdentifier = 'unknown',
  modelIdentifier,
  connectionMethod = 'cli',
  externalSessionId,
  summary = 'Beginning follow-up work.',
  executionTargetId = null
}: {
  ctx: ServiceContext;
  missionId: string;
  objectiveId?: string | null;
  agentIdentifier?: string;
  modelIdentifier?: string | null;
  connectionMethod?: string;
  externalSessionId?: string | null;
  summary?: string | null;
  executionTargetId?: string | null;
}): Promise<AttachResponse & { sessionKey: string }> {
  const trimmedSummary = summary?.trim() || 'Beginning follow-up work.';
  const mission = await getMissionSummary({ ctx, missionId });
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  const resolvedObjectiveId = objectiveId
    ? (await resolveObjectiveRef({ ctx, ref: objectiveId, missionId: mission.id })).id
    : null;
  const selectedObjective = resolvedObjectiveId
    ? objectives.find(objective => objective.id === resolvedObjectiveId)
    : latestCompletedObjective(objectives);

  if (!selectedObjective) {
    throw new ServiceError(
      'No completed objective found for follow-up',
      'no_active_objective',
      409
    );
  }

  const activeObjective = objectives.find(objective =>
    ['executing', 'pending_delivery'].includes(objective.state)
  );
  if (activeObjective) {
    throw new ServiceError(
      'Mission already has active follow-up or execution work',
      'active_objective_exists',
      409
    );
  }

  if (selectedObjective.state !== 'complete') {
    throw new ServiceError(
      'Follow-up resume requires a completed objective',
      'validation_error',
      409
    );
  }

  const { rawKey, prefix, hash } = generateSessionKey();
  const now = nowIso();
  const sessionId = newId();
  const eventId = newId();

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await txCtx.db.run(
      `UPDATE objectives
         SET state = 'pending_delivery', completed_at = NULL, updated_at = ?, revision = revision + 1
         WHERE id = ? AND mission_id = ? AND state = 'complete'`,
      [now, selectedObjective.id, mission.id]
    );

    await txCtx.db.run(
      `INSERT INTO agent_sessions
           (id, workspace_id, project_id, mission_id, objective_id,
            session_key_prefix, session_key_hash, agent_identifier, model_identifier,
            connection_method, external_session_id, phase, delivery_state, started_at, last_heartbeat_at,
            metadata_json, created_by_workspace_user_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'execute', 'pending_redelivery', ?, ?, '{}', ?, ?, ?, 1)`,
      [
        sessionId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        selectedObjective.id,
        prefix,
        hash,
        agentIdentifier,
        modelIdentifier ?? null,
        connectionMethod,
        externalSessionId ?? null,
        now,
        now,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );

    await txCtx.db.run(
      `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            type, phase, summary, payload_json, source, actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'update', 'execute', ?, ?, ?, ?, ?)`,
      [
        eventId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        selectedObjective.id,
        sessionId,
        trimmedSummary,
        JSON.stringify({ followUpIntent: 'execution', reactivated: true }),
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );

    await moveMissionToExecute({ ctx: txCtx, missionId: mission.id });

    await recordChange({
      ctx: txCtx,
      entityType: 'objective',
      entityId: selectedObjective.id,
      operation: 'update',
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: selectedObjective.id,
      changedFields: ['state', 'completed_at']
    });

    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session',
      entityId: sessionId,
      operation: 'insert',
      entityRevision: 1,
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: selectedObjective.id
    });
  });

  const refreshedMission = await getMissionSummary({ ctx, missionId: mission.id });
  const refreshedObjective = (await listObjectives({ ctx, missionId: mission.id })).find(
    objective => objective.id === selectedObjective.id
  ) ?? {
    ...selectedObjective,
    state: 'pending_delivery'
  };
  const context = await contextForObjective({
    ctx,
    mission: refreshedMission,
    objective: refreshedObjective,
    executionTargetId: await resolveProtocolExecutionTargetId({
      ctx,
      executionTargetId,
      missionId: mission.id,
      objectiveId: selectedObjective.id
    })
  });

  return {
    ...context,
    session: {
      id: sessionId,
      sessionKey: rawKey,
      state: 'executing',
      objectiveId: selectedObjective.id,
      missionId: mission.id,
      phase: 'execute',
      deliveryState: 'pending_redelivery'
    },
    sessionKey: rawKey
  };
}

export async function heartbeatSession({
  ctx,
  missionId,
  sessionKey,
  phase,
  note
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  phase?: string | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  const now = nowIso();
  const fields = ['last_heartbeat_at = ?', 'updated_at = ?', 'revision = revision + 1'];
  const params: Array<string | null> = [now, now];

  if (phase) {
    if (!['attach', 'execute', 'review', 'complete', 'blocked'].includes(phase)) {
      throw new ServiceError(`Invalid phase: ${phase}`, 'validation_error');
    }
    fields.unshift('phase = ?');
    params.unshift(phase);
  }

  if (note?.trim()) {
    const metadata = JSON.stringify({ lastHeartbeatNote: note.trim() });
    fields.unshift('metadata_json = ?');
    params.unshift(metadata);
  }

  params.push(session.id);
  await ctx.db.run(`UPDATE agent_sessions SET ${fields.join(', ')} WHERE id = ?`, params);

  return { ok: true };
}

const MAX_SYNC_CHANGE_ITEMS = 25;
const MAX_SYNC_KEY_LENGTH = 200;
const MAX_TOOL_WINDOW_ID_LENGTH = 200;
const MAX_HOOK_HEALTH_LENGTH = 160;
const MAX_SYNC_KEYS_PER_FILE = 32;
const HOOK_HEALTH_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;
const SYNC_CHANGE_ALLOWED_KEYS = new Set([
  'filePath',
  'idempotencyKey',
  'source',
  'quality',
  'overlap',
  'toolWindowId',
  'observedAt',
  'hookHealth'
]);

export type ChangeEvidenceSource = 'declared_edit' | 'window_observed';
export type ChangeEvidenceQuality = 'direct' | 'window';

type SyncChangeInput = {
  filePath?: unknown;
  idempotencyKey?: unknown;
  source?: unknown;
  quality?: unknown;
  overlap?: unknown;
  toolWindowId?: unknown;
  observedAt?: unknown;
  hookHealth?: unknown;
};

type SyncChangeOutcome = {
  idempotencyKey: string | null;
  filePath: string | null;
  status: 'accepted' | 'ignored' | 'warning';
  warning?: string;
};

type ValidSyncChange = {
  filePath: string;
  idempotencyKey: string;
  source: ChangeEvidenceSource;
  quality: ChangeEvidenceQuality;
  overlap: boolean;
  toolWindowId?: string;
  observedAt?: string;
  hookHealth?: string;
};

type StoredChangeEvidence = {
  source?: ChangeEvidenceSource;
  quality?: ChangeEvidenceQuality;
  overlap?: boolean;
  toolWindowId?: string;
  observedAt?: string;
  hookHealth?: string;
  syncKeys: string[];
};

function normalizeRepoRelativePath(value: unknown): string | null {
  return isExactEvidencePath(value) ? value : null;
}

function normalizeSyncKey(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > MAX_SYNC_KEY_LENGTH ||
    hasControlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function readSyncChangeIdentity(value: unknown): {
  filePath: string | null;
  idempotencyKey: string | null;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { filePath: null, idempotencyKey: null };
  }
  const input = value as SyncChangeInput;
  return {
    filePath: normalizeRepoRelativePath(input.filePath),
    idempotencyKey: normalizeSyncKey(input.idempotencyKey)
  };
}

function validateSyncChange(
  value: unknown
):
  | { change: ValidSyncChange }
  | { warning: string; filePath: string | null; idempotencyKey: string | null } {
  const identity = readSyncChangeIdentity(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...identity, warning: 'change evidence must be an object' };
  }
  const input = value as SyncChangeInput;
  if (Object.keys(input).some(key => !SYNC_CHANGE_ALLOWED_KEYS.has(key))) {
    return {
      ...identity,
      warning: 'change evidence contains unsupported fields'
    };
  }
  const filePath = normalizeRepoRelativePath(input.filePath);
  const idempotencyKey = normalizeSyncKey(input.idempotencyKey);
  if (!filePath) {
    return {
      ...identity,
      warning: 'filePath must be a bounded normalized repository-relative path without .. segments'
    };
  }
  if (!idempotencyKey) {
    return { ...identity, filePath, warning: 'idempotencyKey must be a bounded string' };
  }
  if (input.source !== 'declared_edit' && input.source !== 'window_observed') {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'source must be declared_edit or window_observed'
    };
  }
  if (input.quality !== 'direct' && input.quality !== 'window') {
    return { ...identity, filePath, idempotencyKey, warning: 'quality must be direct or window' };
  }
  if (
    (input.source === 'declared_edit' && input.quality !== 'direct') ||
    (input.source === 'window_observed' && input.quality !== 'window')
  ) {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'source and quality do not describe the same evidence class'
    };
  }
  if (input.overlap !== undefined && typeof input.overlap !== 'boolean') {
    return { ...identity, filePath, idempotencyKey, warning: 'overlap must be a boolean' };
  }
  if (
    input.toolWindowId !== undefined &&
    (typeof input.toolWindowId !== 'string' ||
      !input.toolWindowId.trim() ||
      input.toolWindowId.length > MAX_TOOL_WINDOW_ID_LENGTH ||
      hasControlCharacters(input.toolWindowId))
  ) {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'toolWindowId must be a bounded string'
    };
  }
  if (
    input.observedAt !== undefined &&
    (typeof input.observedAt !== 'string' ||
      input.observedAt.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.observedAt) ||
      Number.isNaN(Date.parse(input.observedAt)))
  ) {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'observedAt must be a bounded UTC ISO timestamp'
    };
  }
  if (
    input.hookHealth !== undefined &&
    (typeof input.hookHealth !== 'string' ||
      !input.hookHealth.trim() ||
      input.hookHealth.length > MAX_HOOK_HEALTH_LENGTH ||
      hasControlCharacters(input.hookHealth) ||
      !HOOK_HEALTH_PATTERN.test(input.hookHealth.trim()))
  ) {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'hookHealth must be a bounded string'
    };
  }
  return {
    change: {
      filePath,
      idempotencyKey,
      source: input.source,
      quality: input.quality,
      overlap: input.overlap ?? false,
      ...(typeof input.toolWindowId === 'string'
        ? { toolWindowId: input.toolWindowId.trim() }
        : {}),
      ...(typeof input.observedAt === 'string' ? { observedAt: input.observedAt } : {}),
      ...(typeof input.hookHealth === 'string' ? { hookHealth: input.hookHealth.trim() } : {})
    }
  };
}

function parseStoredChangeEvidence(value: string | null): StoredChangeEvidence {
  let parsed: Record<string, unknown> = {};
  try {
    const candidate = JSON.parse(value ?? '{}') as unknown;
    if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  const source = ['declared_edit', 'window_observed'].includes(String(parsed.source))
    ? (parsed.source as StoredChangeEvidence['source'])
    : undefined;
  const quality =
    parsed.quality === 'direct' || parsed.quality === 'window' ? parsed.quality : undefined;
  const boundedString = (candidate: unknown, maxLength: number): string | undefined =>
    typeof candidate === 'string' &&
    candidate.length <= maxLength &&
    !hasControlCharacters(candidate)
      ? candidate
      : undefined;
  return {
    ...(source ? { source } : {}),
    ...(quality ? { quality } : {}),
    ...(typeof parsed.overlap === 'boolean' ? { overlap: parsed.overlap } : {}),
    ...(boundedString(parsed.toolWindowId, MAX_TOOL_WINDOW_ID_LENGTH)
      ? { toolWindowId: boundedString(parsed.toolWindowId, MAX_TOOL_WINDOW_ID_LENGTH) }
      : {}),
    ...(boundedString(parsed.observedAt, 64)
      ? { observedAt: boundedString(parsed.observedAt, 64) }
      : {}),
    ...(boundedString(parsed.hookHealth, MAX_HOOK_HEALTH_LENGTH)
      ? { hookHealth: boundedString(parsed.hookHealth, MAX_HOOK_HEALTH_LENGTH) }
      : {}),
    syncKeys: Array.isArray(parsed.syncKeys)
      ? parsed.syncKeys
          .filter(
            (key): key is string =>
              typeof key === 'string' &&
              key.length > 0 &&
              key.length <= MAX_SYNC_KEY_LENGTH &&
              !hasControlCharacters(key)
          )
          .slice(-MAX_SYNC_KEYS_PER_FILE)
      : []
  };
}

function evidenceStrength(source: StoredChangeEvidence['source']): number {
  if (source === 'declared_edit') return 3;
  if (source === 'window_observed') return 2;
  return 0;
}

function mergeStoredChangeEvidence({
  existing,
  incoming
}: {
  existing: StoredChangeEvidence;
  incoming: ValidSyncChange;
}): StoredChangeEvidence {
  const incomingIsStrongest =
    evidenceStrength(incoming.source) >= evidenceStrength(existing.source);
  const strongest = incomingIsStrongest ? incoming : existing;
  return {
    source: strongest.source,
    quality: strongest.quality,
    overlap: existing.overlap === true || incoming.overlap,
    ...(strongest.toolWindowId ? { toolWindowId: strongest.toolWindowId } : {}),
    ...(strongest.observedAt ? { observedAt: strongest.observedAt } : {}),
    ...((incoming.hookHealth ?? existing.hookHealth)
      ? { hookHealth: incoming.hookHealth ?? existing.hookHealth }
      : {}),
    syncKeys: [...existing.syncKeys, incoming.idempotencyKey].slice(-MAX_SYNC_KEYS_PER_FILE)
  };
}

/** Upsert one validated objective-ledger observation inside the caller's transaction. */
async function upsertChangedFileObservation({
  ctx,
  mission,
  session,
  resourceId,
  change,
  now
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string };
  session: { id: string; objective_id: string };
  resourceId: string | null;
  change: ValidSyncChange;
  now: string;
}): Promise<'accepted' | 'ignored'> {
  const changedFileId = newId();
  const incomingMetadata: StoredChangeEvidence = {
    source: change.source,
    quality: change.quality,
    overlap: change.overlap,
    ...(change.toolWindowId ? { toolWindowId: change.toolWindowId } : {}),
    ...(change.observedAt ? { observedAt: change.observedAt } : {}),
    ...(change.hookHealth ? { hookHealth: change.hookHealth } : {}),
    syncKeys: [change.idempotencyKey]
  };
  const inserted = await ctx.db.run(
    `INSERT INTO changed_files
         (id, workspace_id, project_id, mission_id, objective_id, session_id, resource_id,
          file_path, vcs_status, current_diff_state, first_observed_at, last_observed_at,
          last_observed_event_id, observed_metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)
       ON CONFLICT (objective_id, file_path)
         WHERE objective_id IS NOT NULL AND deleted_at IS NULL
       DO NOTHING`,
    [
      changedFileId,
      ctx.workspace.id,
      mission.projectId,
      mission.id,
      session.objective_id,
      session.id,
      resourceId,
      change.filePath,
      null,
      'unknown',
      now,
      now,
      JSON.stringify(incomingMetadata),
      now,
      now
    ]
  );
  if (inserted.changes > 0) {
    await recordChange({
      ctx,
      entityType: 'changed_file',
      entityId: changedFileId,
      operation: 'insert',
      entityRevision: 1,
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id
    });
    return 'accepted';
  }

  const lockClause = ctx.db.dialect === 'postgres' ? ' FOR UPDATE' : '';
  const existing = (await ctx.db.get(
    `SELECT id, observed_metadata_json, revision FROM changed_files
       WHERE objective_id = ? AND file_path = ? AND deleted_at IS NULL${lockClause}`,
    [session.objective_id, change.filePath]
  )) as { id: string; observed_metadata_json: string | null; revision: number } | undefined;
  if (!existing) throw new Error('Objective changed-file row disappeared during upsert');

  const existingMetadata = parseStoredChangeEvidence(existing.observed_metadata_json);
  if (existingMetadata.syncKeys.includes(change.idempotencyKey)) return 'ignored';
  const mergedMetadata = mergeStoredChangeEvidence({
    existing: existingMetadata,
    incoming: change
  });
  await ctx.db.run(
    `UPDATE changed_files
       SET session_id = ?, resource_id = COALESCE(?, resource_id),
           last_observed_at = ?, last_observed_event_id = NULL,
           observed_metadata_json = ?, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [session.id, resourceId, now, JSON.stringify(mergedMetadata), now, existing.id]
  );
  await recordChange({
    ctx,
    entityType: 'changed_file',
    entityId: existing.id,
    operation: 'update',
    entityRevision: existing.revision + 1,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: session.objective_id,
    changedFields: ['session_id', 'resource_id', 'last_observed_at', 'observed_metadata_json']
  });
  return 'accepted';
}

/**
 * Persist objective-ledger observations without ever making delivery depend on
 * them. Every item has its own transaction so malformed siblings cannot roll
 * back valid metadata-only evidence.
 */
export async function syncChanges({
  ctx,
  missionId,
  sessionKey,
  changes
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  changes: unknown[];
}): Promise<{ outcomes: SyncChangeOutcome[] }> {
  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  const outcomes: SyncChangeOutcome[] = [];
  const resourceId = await resolveSessionResourceId({ ctx, session, mission });
  for (const input of changes.slice(0, MAX_SYNC_CHANGE_ITEMS)) {
    const validated = validateSyncChange(input);
    if ('warning' in validated) {
      outcomes.push({
        idempotencyKey: validated.idempotencyKey,
        filePath: validated.filePath,
        status: 'warning',
        warning: validated.warning
      });
      continue;
    }
    const change = validated.change;
    try {
      const result = await ctx.db.transaction(async tx => {
        return await upsertChangedFileObservation({
          ctx: { ...ctx, db: tx },
          mission,
          session,
          resourceId,
          change,
          now: nowIso()
        });
      });
      outcomes.push({
        idempotencyKey: change.idempotencyKey,
        filePath: change.filePath,
        status: result
      });
    } catch {
      outcomes.push({
        idempotencyKey: change.idempotencyKey,
        filePath: change.filePath,
        status: 'warning',
        warning: 'unable to persist change evidence'
      });
    }
  }
  for (const overflow of changes.slice(MAX_SYNC_CHANGE_ITEMS)) {
    const identity = readSyncChangeIdentity(overflow);
    outcomes.push({
      ...identity,
      status: 'warning',
      warning: `sync-changes accepts at most ${MAX_SYNC_CHANGE_ITEMS} items per request`
    });
  }
  return { outcomes };
}

export async function updateSession({
  ctx,
  missionId,
  sessionKey,
  summary,
  phase,
  eventType = 'update',
  payloadJson,
  externalUrl,
  externalSessionId,
  beginFollowUpWork = false,
  followUpIntent,
  changeRationales
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  summary: string;
  phase?: string | null;
  eventType?: string | null;
  payloadJson?: Record<string, unknown> | null;
  externalUrl?: string | null;
  externalSessionId?: string | null;
  beginFollowUpWork?: boolean;
  followUpIntent?: string | null;
  changeRationales?: ChangeRationaleInput[] | null;
}): Promise<{ eventId: string }> {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    throw new ServiceError('Update summary is required', 'validation_error');
  }

  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  if (session.delivery_state === 'delivered' && !beginFollowUpWork) {
    throw new ServiceError(
      'Mission was delivered. Use --begin-follow-up-work before posting execution updates.',
      'delivery_boundary',
      409
    );
  }

  if (phase && !UPDATE_PHASES.includes(phase as (typeof UPDATE_PHASES)[number])) {
    throw new ServiceError(`Invalid phase: ${phase}`, 'validation_error');
  }

  if (eventType && !UPDATE_EVENT_TYPES.includes(eventType as (typeof UPDATE_EVENT_TYPES)[number])) {
    throw new ServiceError(`Invalid event type: ${eventType}`, 'validation_error');
  }

  const now = nowIso();
  const eventId = newId();
  const normalizedRationales = normalizeChangeRationales(changeRationales ?? []);

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    if (beginFollowUpWork) {
      await txCtx.db.run(
        `UPDATE objectives SET state = 'pending_delivery', updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        [now, session.objective_id]
      );
      await txCtx.db.run(
        `UPDATE agent_sessions SET delivery_state = 'pending_redelivery', updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        [now, session.id]
      );
    }

    await txCtx.db.run(
      `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            type, phase, summary, payload_json, external_url, source,
            actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        session.objective_id,
        session.id,
        eventType ?? 'update',
        phase ?? null,
        trimmedSummary,
        JSON.stringify({
          ...(payloadJson ?? {}),
          ...(followUpIntent ? { followUpIntent } : {}),
          ...(normalizedRationales.warnings.length > 0
            ? { changeRationaleWarnings: normalizedRationales.warnings }
            : {})
        }),
        externalUrl ?? null,
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'mission_event',
      entityId: eventId,
      operation: 'insert',
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id
    });

    if (normalizedRationales.rationales.length > 0) {
      const changedFiles = (await txCtx.db.all(
        `SELECT id, file_path FROM changed_files
           WHERE objective_id = ? AND deleted_at IS NULL`,
        [session.objective_id]
      )) as Array<{ id: string; file_path: string }>;
      const changedFileIdByPath = new Map(changedFiles.map(row => [row.file_path, row.id]));
      for (const rationale of normalizedRationales.rationales) {
        await insertChangeRationaleRow({
          ctx: txCtx,
          projectId: mission.projectId,
          missionId: mission.id,
          objectiveId: session.objective_id,
          sessionId: session.id,
          deliveryId: null,
          changedFileId: changedFileIdByPath.get(rationale.filePath) ?? null,
          sourceEventId: eventId,
          rationale,
          isFinal: false,
          now
        });
      }
    }

    if (externalSessionId !== undefined) {
      await txCtx.db.run(
        `UPDATE agent_sessions SET external_session_id = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        [externalSessionId, now, session.id]
      );
    }

    if (phase) {
      await txCtx.db.run(
        `UPDATE agent_sessions SET phase = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        [phase, now, session.id]
      );
    }
  });
  return { eventId };
}

export async function askQuestion({
  ctx,
  missionId,
  sessionKey,
  question
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  question: string;
}): Promise<{ eventId: string }> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new ServiceError('Question is required', 'validation_error');
  }

  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  const now = nowIso();
  const eventId = newId();

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await txCtx.db.run(
      `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            type, phase, summary, payload_json, source, actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ask', 'blocked', ?, '{}', ?, ?, ?)`,
      [
        eventId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        session.objective_id,
        session.id,
        trimmed,
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'mission_event',
      entityId: eventId,
      operation: 'insert',
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id
    });
    await enqueueWebhookEvent(txCtx, {
      type: 'mission.blocked',
      projectId: mission.projectId,
      entity: { missionId: mission.id, objectiveId: session.objective_id, sessionId: session.id }
    });
    // A blocked agent cannot make progress until a person answers. The question
    // text itself stays in the mission event — the durable notification stores
    // only trusted type and identity references for every eligible transport.
    await emitNotification({
      db: txCtx.db,
      workspaceId: ctx.workspace.id,
      missionId: mission.id,
      type: 'agent_question',
      objectiveId: session.objective_id,
      now
    });

    await moveMissionToReview({ ctx: txCtx, missionId: mission.id });
  });

  return { eventId };
}

export type ChangeRationaleInput = {
  /** Canonical repository-relative path of the changed file. */
  filePath: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  hunks?: Array<{ header: string }>;
};

type NormalizedChangeRationale = {
  filePath: string;
  label: string;
  summary: string;
  why: string;
  impact: string;
  hunks?: Array<{ header: string }>;
};

const MAX_CHANGE_RATIONALE_ITEMS = 100;
const MAX_PROTOCOL_EVIDENCE_WARNINGS = 12;
const MAX_CHANGE_RATIONALE_LABEL_LENGTH = 240;
const MAX_CHANGE_RATIONALE_TEXT_LENGTH = 10_000;
const MAX_CHANGE_RATIONALE_HUNKS = 100;
const MAX_CHANGE_RATIONALE_HUNK_LENGTH = 1_000;
const CHANGE_RATIONALE_KEYS = new Set(['filePath', 'label', 'summary', 'why', 'impact', 'hunks']);
const CHANGE_RATIONALE_HUNK_KEYS = new Set(['header']);

function normalizeChangeRationales(input: unknown): {
  rationales: NormalizedChangeRationale[];
  warnings: string[];
} {
  const rationales: NormalizedChangeRationale[] = [];
  const rationaleIndexByPath = new Map<string, number>();
  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (warnings.length < MAX_PROTOCOL_EVIDENCE_WARNINGS) warnings.push(message);
  };
  if (!Array.isArray(input)) {
    warn('Ignored changeRationales: expected an array.');
    return { rationales, warnings };
  }
  if (input.length > MAX_CHANGE_RATIONALE_ITEMS) {
    warn(`Ignored ${input.length - MAX_CHANGE_RATIONALE_ITEMS} excess change-rationale item(s).`);
  }
  input.slice(0, MAX_CHANGE_RATIONALE_ITEMS).forEach((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      warn(`Ignored changeRationales[${index}]: expected an object.`);
      return;
    }
    const rationale = value as Record<string, unknown>;
    if (Object.keys(rationale).some(key => !CHANGE_RATIONALE_KEYS.has(key))) {
      warn(`Ignored changeRationales[${index}]: unsupported fields.`);
      return;
    }
    const filePath = normalizeRepoRelativePath(rationale.filePath);
    const readText = (
      field: 'label' | 'summary' | 'why' | 'impact',
      maxLength: number
    ): string | null => {
      const candidate = rationale[field];
      if (typeof candidate !== 'string') return null;
      const normalized = candidate.trim();
      return normalized && normalized.length <= maxLength ? normalized : null;
    };
    const label = readText('label', MAX_CHANGE_RATIONALE_LABEL_LENGTH);
    const summary = readText('summary', MAX_CHANGE_RATIONALE_TEXT_LENGTH);
    const why = readText('why', MAX_CHANGE_RATIONALE_TEXT_LENGTH);
    const impact = readText('impact', MAX_CHANGE_RATIONALE_TEXT_LENGTH);
    if (!filePath || !label || !summary || !why || !impact) {
      warn(
        `Ignored changeRationales[${index}]: filePath, label, summary, why, and impact must be non-empty bounded strings.`
      );
      return;
    }
    let hunks: Array<{ header: string }> | undefined;
    if (rationale.hunks !== undefined) {
      if (!Array.isArray(rationale.hunks)) {
        warn(`Ignored changeRationales[${index}].hunks: expected an array.`);
      } else {
        if (rationale.hunks.length > MAX_CHANGE_RATIONALE_HUNKS) {
          warn(
            `Ignored ${rationale.hunks.length - MAX_CHANGE_RATIONALE_HUNKS} excess changeRationales[${index}].hunks item(s).`
          );
        }
        hunks = rationale.hunks.slice(0, MAX_CHANGE_RATIONALE_HUNKS).flatMap((hunk, hunkIndex) => {
          if (typeof hunk !== 'object' || hunk === null || Array.isArray(hunk)) {
            warn(`Ignored changeRationales[${index}].hunks[${hunkIndex}]: expected an object.`);
            return [];
          }
          const candidate = hunk as Record<string, unknown>;
          if (Object.keys(candidate).some(key => !CHANGE_RATIONALE_HUNK_KEYS.has(key))) {
            warn(`Ignored changeRationales[${index}].hunks[${hunkIndex}]: unsupported fields.`);
            return [];
          }
          const header = candidate.header;
          if (
            typeof header !== 'string' ||
            !header.trim() ||
            header.length > MAX_CHANGE_RATIONALE_HUNK_LENGTH
          ) {
            warn(
              `Ignored changeRationales[${index}].hunks[${hunkIndex}]: header must be a non-empty bounded string.`
            );
            return [];
          }
          return [{ header: header.trim() }];
        });
      }
    }
    const normalized = { filePath, label, summary, why, impact, ...(hunks ? { hunks } : {}) };
    const previousIndex = rationaleIndexByPath.get(filePath);
    if (previousIndex === undefined) {
      rationaleIndexByPath.set(filePath, rationales.length);
      rationales.push(normalized);
    } else {
      rationales[previousIndex] = normalized;
      warn(`Duplicate changeRationales[${index}]: last valid item for filePath wins.`);
    }
  });
  return { rationales, warnings };
}

async function insertChangeRationaleRow({
  ctx,
  projectId,
  missionId,
  objectiveId,
  sessionId,
  deliveryId,
  changedFileId,
  sourceEventId,
  rationale,
  isFinal,
  now
}: {
  ctx: ServiceContext;
  projectId: string;
  missionId: string;
  objectiveId: string;
  sessionId: string | null;
  deliveryId: string | null;
  changedFileId: string | null;
  sourceEventId: string | null;
  rationale: NormalizedChangeRationale;
  isFinal: boolean;
  now: string;
}): Promise<string> {
  const rationaleId = newId();
  await ctx.db.run(
    `INSERT INTO change_rationales
         (id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
          changed_file_id, file_path, label, summary, why, impact, hunks_json,
          source_event_id, is_final, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      rationaleId,
      ctx.workspace.id,
      projectId,
      missionId,
      objectiveId,
      sessionId,
      deliveryId,
      changedFileId,
      rationale.filePath,
      rationale.label,
      rationale.summary,
      rationale.why,
      rationale.impact,
      JSON.stringify(rationale.hunks ?? []),
      sourceEventId,
      bindBool(ctx.db.dialect, isFinal),
      now,
      now
    ]
  );
  await recordChange({
    ctx,
    entityType: 'change_rationale',
    entityId: rationaleId,
    operation: 'insert',
    entityRevision: 1,
    projectId,
    missionId,
    objectiveId
  });
  return rationaleId;
}

type NormalizedRecordWorkChangedFile = {
  filePath: string;
  vcsStatus: string | null;
};

const MAX_RECORD_WORK_CHANGED_FILES = 100;
const MAX_VCS_STATUS_LENGTH = 32;
const RECORD_WORK_CHANGED_FILE_KEYS = new Set(['filePath', 'vcsStatus']);

function normalizeRecordWorkChangedFiles(input: unknown): {
  files: NormalizedRecordWorkChangedFile[];
  warnings: string[];
} {
  const files: NormalizedRecordWorkChangedFile[] = [];
  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (warnings.length < MAX_PROTOCOL_EVIDENCE_WARNINGS) warnings.push(message);
  };
  if (!Array.isArray(input)) {
    warn('Ignored changedFiles: expected an array.');
    return { files, warnings };
  }
  if (input.length > MAX_RECORD_WORK_CHANGED_FILES) {
    warn(`Ignored ${input.length - MAX_RECORD_WORK_CHANGED_FILES} excess changedFiles item(s).`);
  }
  input.slice(0, MAX_RECORD_WORK_CHANGED_FILES).forEach((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      warn(`Ignored changedFiles[${index}]: expected an object.`);
      return;
    }
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).some(key => !RECORD_WORK_CHANGED_FILE_KEYS.has(key))) {
      warn(`Ignored changedFiles[${index}]: unsupported fields.`);
      return;
    }
    const filePath = normalizeRepoRelativePath(candidate.filePath);
    if (!filePath) {
      warn(`Ignored changedFiles[${index}]: filePath must be canonical and repository-relative.`);
      return;
    }
    let vcsStatus: string | null = null;
    if (candidate.vcsStatus !== undefined && candidate.vcsStatus !== null) {
      if (
        typeof candidate.vcsStatus !== 'string' ||
        !candidate.vcsStatus.trim() ||
        candidate.vcsStatus.length > MAX_VCS_STATUS_LENGTH ||
        hasControlCharacters(candidate.vcsStatus)
      ) {
        warn(`Ignored changedFiles[${index}]: vcsStatus must be a bounded string or null.`);
        return;
      }
      vcsStatus = candidate.vcsStatus.trim();
    }
    files.push({ filePath, vcsStatus });
  });
  return { files, warnings };
}

type ProtocolArtifactInput = {
  type: string;
  label: string;
  content?: string | null;
  url?: string | null;
};

const MAX_PROTOCOL_ARTIFACTS = 100;
const PROTOCOL_ARTIFACT_KEYS = new Set(['type', 'label', 'content', 'url']);

function validateProtocolArtifacts(input: unknown): ProtocolArtifactInput[] {
  if (!Array.isArray(input)) {
    throw new ServiceError('artifacts must be an array', 'validation_error', 400);
  }
  if (input.length > MAX_PROTOCOL_ARTIFACTS) {
    throw new ServiceError(
      `artifacts accepts at most ${MAX_PROTOCOL_ARTIFACTS} items`,
      'validation_error',
      400
    );
  }
  return input.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ServiceError(`artifacts[${index}] must be an object`, 'validation_error', 400);
    }
    const artifact = value as Record<string, unknown>;
    if (Object.keys(artifact).some(key => !PROTOCOL_ARTIFACT_KEYS.has(key))) {
      throw new ServiceError(
        `artifacts[${index}] contains unsupported fields`,
        'validation_error',
        400
      );
    }
    if (typeof artifact.type !== 'string' || !artifact.type.trim()) {
      throw new ServiceError(
        `artifacts[${index}].type must be a non-empty string`,
        'validation_error',
        400
      );
    }
    if (typeof artifact.label !== 'string' || !artifact.label.trim()) {
      throw new ServiceError(
        `artifacts[${index}].label must be a non-empty string`,
        'validation_error',
        400
      );
    }
    for (const key of ['content', 'url'] as const) {
      if (
        artifact[key] !== undefined &&
        artifact[key] !== null &&
        typeof artifact[key] !== 'string'
      ) {
        throw new ServiceError(
          `artifacts[${index}].${key} must be a string or null`,
          'validation_error',
          400
        );
      }
    }
    if (
      (artifact.content === undefined || artifact.content === null) &&
      (artifact.url === undefined || artifact.url === null)
    ) {
      throw new ServiceError(
        `artifacts[${index}] requires content or url`,
        'validation_error',
        400
      );
    }
    return artifact as ProtocolArtifactInput;
  });
}

function appendDeliveryWarnings<T extends { warnings?: string[] }>(
  report: T,
  warnings: string[]
): T {
  if (warnings.length === 0) return report;
  return {
    ...report,
    warnings: [...(report.warnings ?? []), ...warnings].slice(0, MAX_PROTOCOL_EVIDENCE_WARNINGS)
  };
}

export async function deliverSession({
  ctx,
  missionId,
  sessionKey,
  summary,
  artifacts = [],
  changeRationales = [],
  payloadJson,
  verificationSummary,
  followUpNotes
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  summary: string;
  artifacts?: unknown[];
  changeRationales?: ChangeRationaleInput[];
  payloadJson?: Record<string, unknown> | null;
  verificationSummary?: string | null;
  followUpNotes?: string | null;
}): Promise<{ deliveryId: string; eventId: string }> {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    throw new ServiceError('Delivery summary is required', 'validation_error');
  }

  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  const normalizedRationales = normalizeChangeRationales(changeRationales);
  const normalizedArtifacts = validateProtocolArtifacts(artifacts);
  const deliveryReport = appendDeliveryWarnings(
    markDeliveryPresentationPending(
      buildDeliveryReport({
        summary: trimmedSummary,
        deliveryReport: payloadJson?.deliveryReport
      })
    ),
    normalizedRationales.warnings
  );

  const now = nowIso();
  const deliveryId = newId();
  const eventId = newId();

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    const objectiveChangedFiles = (await txCtx.db.all(
      `SELECT id, file_path FROM changed_files
         WHERE objective_id = ? AND deleted_at IS NULL`,
      [session.objective_id]
    )) as Array<{
      id: string;
      file_path: string;
    }>;
    const changedFileIdByPath = new Map(objectiveChangedFiles.map(row => [row.file_path, row.id]));

    await txCtx.db.run(
      `INSERT INTO deliveries
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            summary, payload_json, verification_summary, follow_up_notes,
            delivered_at, delivered_by_workspace_user_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        deliveryId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        session.objective_id,
        session.id,
        trimmedSummary,
        JSON.stringify({
          ...(payloadJson ?? {}),
          deliveryReport
        }),
        verificationSummary ?? null,
        followUpNotes ?? null,
        now,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );

    for (const artifact of normalizedArtifacts) {
      await insertArtifactRow({
        ctx: txCtx,
        workspaceId: ctx.workspace.id,
        projectId: mission.projectId,
        missionId: mission.id,
        objectiveId: session.objective_id,
        sessionId: session.id,
        deliveryId,
        type: artifact.type,
        label: artifact.label,
        contentText: artifact.content ?? null,
        externalUrl: artifact.url ?? null,
        now
      });
    }

    for (const rationale of normalizedRationales.rationales) {
      const changedFileId = changedFileIdByPath.get(rationale.filePath) ?? null;
      await insertChangeRationaleRow({
        ctx: txCtx,
        projectId: mission.projectId,
        missionId: mission.id,
        objectiveId: session.objective_id,
        sessionId: session.id,
        deliveryId,
        changedFileId,
        sourceEventId: null,
        rationale,
        isFinal: true,
        now
      });
    }

    await txCtx.db.run(
      `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            type, phase, summary, payload_json, source, actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'delivery', 'deliver', ?, ?, ?, ?, ?)`,
      [
        eventId,
        ctx.workspace.id,
        mission.projectId,
        mission.id,
        session.objective_id,
        session.id,
        trimmedSummary,
        JSON.stringify({ deliveryId }),
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );
    await recordChange({
      ctx: txCtx,
      entityType: 'mission_event',
      entityId: eventId,
      operation: 'insert',
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id
    });
    await enqueueWebhookEvent(txCtx, {
      type: 'mission.delivered',
      projectId: mission.projectId,
      entity: {
        missionId: mission.id,
        objectiveId: session.objective_id,
        sessionId: session.id,
        deliveryId
      }
    });
    await enqueueDeliveryComposeJob({ ctx: txCtx, deliveryId, now });

    await txCtx.db.run(
      `UPDATE objectives SET state = 'complete', ${OBJECTIVE_COMPLETED_AT_ASSIGNMENT}, updated_at = ?, revision = revision + 1
         WHERE id = ?`,
      [now, now, session.objective_id]
    );
    await txCtx.db.run(
      `UPDATE run_queue_entries SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE objective_id = ? AND deleted_at IS NULL`,
      [now, now, session.objective_id]
    );
    const objectiveRevision = (
      (await txCtx.db.get(`SELECT revision FROM objectives WHERE id = ?`, [
        session.objective_id
      ])) as { revision: number } | undefined
    )?.revision;
    await recordChange({
      ctx: txCtx,
      entityType: 'objective',
      entityId: session.objective_id,
      operation: 'update',
      entityRevision: objectiveRevision ?? null,
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id,
      changedFields: ['state', 'completed_at']
    });
    await enqueueWebhookEvent(txCtx, {
      type: 'objective.completed',
      projectId: mission.projectId,
      entity: {
        missionId: mission.id,
        objectiveId: session.objective_id,
        sessionId: session.id,
        deliveryId
      }
    });
    await enqueueLiveActivityRefreshForMission({
      db: txCtx.db,
      workspaceId: ctx.workspace.id,
      missionId: mission.id,
      now
    });

    await txCtx.db.run(
      `UPDATE agent_sessions
         SET delivery_state = 'delivered', phase = 'review', ended_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ?`,
      [now, now, session.id]
    );
    const sessionRevision = (
      (await txCtx.db.get(`SELECT revision FROM agent_sessions WHERE id = ?`, [session.id])) as
        | { revision: number }
        | undefined
    )?.revision;
    await recordChange({
      ctx: txCtx,
      entityType: 'agent_session',
      entityId: session.id,
      operation: 'update',
      entityRevision: sessionRevision ?? null,
      projectId: mission.projectId,
      missionId: mission.id,
      objectiveId: session.objective_id,
      changedFields: ['delivery_state', 'phase', 'ended_at']
    });

    const remainingActive = await countActiveMissionObjectives({
      ctx: txCtx,
      missionId: mission.id
    });
    if (remainingActive === 0) {
      await moveMissionToReview({ ctx: txCtx, missionId: mission.id });
    }
  });

  // Run Queue membership is authoritative; its durable project-deduped worker
  // owns target/config resolution and launch retries.
  await enqueueRunQueueDispatch(ctx.db, mission.projectId, ctx.workspace.id);

  // A draft with no instruction text is the blank slot the UI keeps ready for the
  // user to type into, not queued work. Treating it as the next objective raised
  // a bogus "waiting for approval: New objective" status item on every delivery.
  const nextObjective = (await ctx.db.get(
    `SELECT id, title
       FROM objectives
       WHERE mission_id = ? AND position > (
         SELECT position FROM objectives WHERE id = ?
       ) AND state = 'draft' AND TRIM(COALESCE(instruction_text, '')) <> ''
       ORDER BY position ASC LIMIT 1`,
    [mission.id, session.objective_id]
  )) as
    | {
        id: string;
        title: string;
      }
    | undefined;

  if (nextObjective) {
    const queued = await ctx.db.get<{ id: string }>(
      'SELECT id FROM run_queue_entries WHERE objective_id = ? AND deleted_at IS NULL',
      [nextObjective.id]
    );
    if (!queued) {
      await ctx.db.run(
        `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id,
            type, phase, summary, payload_json, source, actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'awaiting_approval', 'review', ?, '{}', ?, ?, ?)`,
        [
          newId(),
          ctx.workspace.id,
          mission.projectId,
          mission.id,
          nextObjective.id,
          `Next objective is waiting for approval: ${nextObjective.title}`,
          ctx.source,
          ctx.actorWorkspaceUserId,
          nowIso()
        ]
      );
    }
  }

  const remainingActive = await countActiveMissionObjectives({
    ctx,
    missionId: mission.id
  });
  if (remainingActive === 0) {
    await emitNotification({
      db: ctx.db,
      workspaceId: ctx.workspace.id,
      missionId: mission.id,
      type: 'mission_awaiting_review',
      objectiveId: session.objective_id
    });
  }

  return { deliveryId, eventId };
}

export async function protocolCreate({
  ctx,
  projectId,
  objectives,
  title,
  assignedTo
}: {
  ctx: ServiceContext;
  projectId?: string | null;
  objectives: Array<{
    objective: string;
    title?: string | null;
    autoAdvance?: boolean;
    resourceKey?: string | null;
  }>;
  title?: string | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
}): Promise<{ mission: MissionSummary; objectives: ObjectiveSummary[] }> {
  const resolvedProjectId = projectId
    ? await resolveProjectId(ctx, projectId)
    : (await discoverProject({ ctx })).projectId;
  const assignedWorkspaceUserId = await resolveAgentMissionAssignee({ ctx, assignedTo });
  return await createMissionWithObjectives({
    ctx,
    projectId: resolvedProjectId,
    objectives,
    assignedWorkspaceUserId,
    ...(title !== undefined ? { title } : {})
  });
}

export async function protocolPrompt({
  ctx,
  projectId,
  objectives,
  title,
  agentIdentifier = 'unknown',
  externalSessionId,
  assignedTo
}: {
  ctx: ServiceContext;
  projectId?: string | null;
  objectives: Array<{
    objective: string;
    title?: string | null;
    autoAdvance?: boolean;
    resourceKey?: string | null;
  }>;
  title?: string | null;
  agentIdentifier?: string;
  externalSessionId?: string | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
}): Promise<AttachResponse & { sessionKey: string }> {
  const discovery = projectId
    ? { projectId: await resolveProjectId(ctx, projectId) }
    : await discoverProject({ ctx });
  const assignedWorkspaceUserId = await resolveAgentMissionAssignee({ ctx, assignedTo });
  const created = await createMissionWithObjectives({
    ctx,
    projectId: discovery.projectId,
    objectives,
    assignedWorkspaceUserId,
    ...(title !== undefined ? { title } : {})
  });

  const launchedAt = nowIso();
  const submitted = await ctx.db.run(
    `UPDATE objectives SET state = 'launching', ${OBJECTIVE_LAUNCHED_AT_ASSIGNMENT}, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [launchedAt, launchedAt, created.objectives[0]?.id]
  );

  void submitted;

  return await attachSession({
    ctx,
    missionId: created.mission.id,
    agentIdentifier,
    connectionMethod: 'prompt',
    externalSessionId: externalSessionId ?? null
  });
}

export async function recordWork({
  ctx,
  projectId,
  summary,
  objective,
  title,
  artifacts = [],
  changeRationales = [],
  changedFiles = [],
  payloadJson,
  assignedTo
}: {
  ctx: ServiceContext;
  projectId?: string | null;
  summary: string;
  objective: string;
  title?: string | null;
  artifacts?: unknown[];
  changeRationales?: ChangeRationaleInput[];
  changedFiles?: unknown[];
  payloadJson?: Record<string, unknown> | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
}): Promise<{ mission: MissionSummary; deliveryId: string }> {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    throw new ServiceError('Summary is required for record-work', 'validation_error');
  }
  const normalizedRationales = normalizeChangeRationales(changeRationales);
  const normalizedChangedFiles = normalizeRecordWorkChangedFiles(changedFiles);
  const normalizedArtifacts = validateProtocolArtifacts(artifacts);
  const deliveryReport = appendDeliveryWarnings(
    markDeliveryPresentationPending(
      buildDeliveryReport({
        summary: trimmedSummary,
        deliveryReport: payloadJson?.deliveryReport
      })
    ),
    [...normalizedRationales.warnings, ...normalizedChangedFiles.warnings]
  );

  const resolvedProjectId = projectId
    ? await resolveProjectId(ctx, projectId)
    : (await discoverProject({ ctx })).projectId;

  const assignedWorkspaceUserId = await resolveAgentMissionAssignee({ ctx, assignedTo });
  const created = await createMissionWithObjectives({
    ctx,
    projectId: resolvedProjectId,
    objectives: [{ objective }],
    statusType: 'review',
    assignedWorkspaceUserId,
    ...(title !== undefined ? { title } : {})
  });

  const now = nowIso();
  const deliveryId = newId();
  const objectiveId = created.objectives[0]?.id;
  if (!objectiveId) {
    throw new ServiceError('Failed to create objective for record-work', 'internal_error', 500);
  }

  await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    await txCtx.db.run(
      `INSERT INTO deliveries
           (id, workspace_id, project_id, mission_id, objective_id, session_id,
            summary, payload_json, delivered_at, delivered_by_workspace_user_id,
            created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`,
      [
        deliveryId,
        ctx.workspace.id,
        resolvedProjectId,
        created.mission.id,
        objectiveId,
        trimmedSummary,
        JSON.stringify({ ...(payloadJson ?? {}), deliveryReport }),
        now,
        ctx.actorWorkspaceUserId,
        now,
        now
      ]
    );

    for (const artifact of normalizedArtifacts) {
      await insertArtifactRow({
        ctx: txCtx,
        workspaceId: ctx.workspace.id,
        projectId: resolvedProjectId,
        missionId: created.mission.id,
        objectiveId,
        sessionId: null,
        deliveryId,
        type: artifact.type,
        label: artifact.label,
        contentText: artifact.content ?? null,
        externalUrl: artifact.url ?? null,
        now
      });
    }

    // record-work has no attached execution target, so its explicit changed-file
    // list remains authoritative. Include rationale paths so every annotation
    // links to the durable objective/path row created in this transaction.
    const changedFileStatus = new Map<string, string | null>();
    for (const rationale of normalizedRationales.rationales) {
      if (!changedFileStatus.has(rationale.filePath)) {
        changedFileStatus.set(rationale.filePath, null);
      }
    }
    for (const file of normalizedChangedFiles.files) {
      const normalizedPath = file.filePath;
      changedFileStatus.set(
        normalizedPath,
        file.vcsStatus ?? changedFileStatus.get(normalizedPath) ?? null
      );
    }
    const changedFileIdByPath = new Map<string, string>();
    for (const [normalizedPath, vcsStatus] of changedFileStatus) {
      const changedFileId = newId();
      await txCtx.db.run(
        `INSERT INTO changed_files
             (id, workspace_id, project_id, mission_id, objective_id, session_id, resource_id,
              file_path, vcs_status, current_diff_state, first_observed_at, last_observed_at,
              last_observed_event_id, observed_metadata_json, created_at, updated_at, revision)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'unknown', ?, ?, NULL, '{}', ?, ?, 1)`,
        [
          changedFileId,
          ctx.workspace.id,
          resolvedProjectId,
          created.mission.id,
          objectiveId,
          normalizedPath,
          vcsStatus,
          now,
          now,
          now,
          now
        ]
      );
      await recordChange({
        ctx: txCtx,
        entityType: 'changed_file',
        entityId: changedFileId,
        operation: 'insert',
        entityRevision: 1,
        projectId: resolvedProjectId,
        missionId: created.mission.id,
        objectiveId
      });
      changedFileIdByPath.set(normalizedPath, changedFileId);
    }
    for (const rationale of normalizedRationales.rationales) {
      await insertChangeRationaleRow({
        ctx: txCtx,
        projectId: resolvedProjectId,
        missionId: created.mission.id,
        objectiveId,
        sessionId: null,
        deliveryId,
        changedFileId: changedFileIdByPath.get(rationale.filePath) ?? null,
        sourceEventId: null,
        rationale,
        isFinal: true,
        now
      });
    }

    await txCtx.db.run(
      `INSERT INTO mission_events
           (id, workspace_id, project_id, mission_id, objective_id,
            type, phase, summary, payload_json, source, actor_workspace_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'delivery', 'deliver', ?, ?, ?, ?, ?)`,
      [
        newId(),
        ctx.workspace.id,
        resolvedProjectId,
        created.mission.id,
        objectiveId,
        trimmedSummary,
        JSON.stringify({ deliveryId, recordWork: true }),
        ctx.source,
        ctx.actorWorkspaceUserId,
        now
      ]
    );
    await enqueueWebhookEvent(txCtx, {
      type: 'mission.delivered',
      projectId: resolvedProjectId,
      entity: { missionId: created.mission.id, objectiveId, deliveryId }
    });
    await enqueueWebhookEvent(txCtx, {
      type: 'objective.completed',
      projectId: resolvedProjectId,
      entity: { missionId: created.mission.id, objectiveId, deliveryId }
    });
    await enqueueDeliveryComposeJob({ ctx: txCtx, deliveryId, now });
    await enqueueLiveActivityRefreshForMission({
      db: txCtx.db,
      workspaceId: ctx.workspace.id,
      missionId: created.mission.id,
      now
    });
  });
  return { mission: created.mission, deliveryId };
}

export function authStatus({ ctx }: { ctx: ServiceContext }): {
  ready: boolean;
  workspaceId: string;
  workspaceName: string;
  authMode: 'local_implicit';
  actorWorkspaceUserId: string | null;
} {
  return {
    ready: true,
    workspaceId: ctx.workspace.id,
    workspaceName: ctx.workspace.name,
    authMode: 'local_implicit',
    actorWorkspaceUserId: ctx.actorWorkspaceUserId
  };
}

export {
  addObjectivesToMission,
  createMissionWithObjectives,
  discussObjective,
  listSharedContext,
  searchMissions,
  searchMissionsV2,
  searchMissionsV3,
  updateObjective,
  writeSharedContext
} from './missions.js';
