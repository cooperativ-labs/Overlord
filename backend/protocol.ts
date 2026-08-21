import { type Permission, PERMISSIONS } from '@overlord/auth';
import {
  type CreateArtifactBody,
  missionDisplayIdFromObjectiveRef,
  type MissionSearchDateField,
  type UpdateArtifactBody,
  type UpdateObjectiveBody
} from '@overlord/contract';

import {
  resolveMissionId,
  resolveObjectiveRef,
  resolveProjectId,
  type ServiceContext
} from '../packages/core/service/context.ts';
import { ServiceError } from '../packages/core/service/errors.ts';
import { listAttachments } from '../packages/core/service/missions.ts';
import { registerActingExecutionTarget } from '../packages/core/service/project-execution-target.ts';
import {
  createProject as createProjectService,
  discoverProject,
  listProjectStatuses
} from '../packages/core/service/projects.ts';
import {
  addObjectivesToMission,
  askQuestion,
  attachSession,
  authStatus,
  type ChangeRationaleInput,
  connectSession,
  deliverSession,
  discussObjective,
  heartbeatSession,
  listSharedContext,
  loadMissionContext,
  protocolCreate,
  protocolPrompt,
  recordHookEvent,
  recordWork,
  resumeFollowUp,
  searchMissions,
  updateSession,
  writeSharedContext
} from '../packages/core/service/protocol.ts';
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
} from '../packages/core/service/run-queue.ts';
import { hashSessionKey } from '../packages/core/service/util.ts';

import { launchObjective } from './execution/launch.ts';
import {
  buildWebappServiceContext,
  buildWebappServiceContextForWorkspace,
  getActorWorkspaceUserId,
  getAuthorizedWorkspacesContext,
  requireDatabaseClient,
  serviceDatabaseClient
} from './db.ts';
import { ApiError } from './errors.ts';
import { resolveObjectiveIdForRest } from './objective-ref.ts';
import {
  requireAnyWorkspacePermission,
  requirePermission,
  requireWorkspacePermission
} from './rbac.ts';
import {
  callerMembershipsInActiveOrganization,
  callerWorkspaceMemberships,
  createArtifact,
  createInboxItem,
  listMissionDeliveries,
  reorderFutureObjectives,
  searchMissionsV2 as searchMissionsAcrossWorkspaces,
  searchMissionsV3 as searchMissionsV3AcrossWorkspaces,
  updateArtifact,
  updateObjective as updateObjectiveRecord
} from './repository.ts';
import { listWorkspaces } from './workspaces.ts';

// ---- Protocol command dispatch -------------------------------------------
//
// The published npm CLI is client-only: `ovld protocol <subcommand>` forwards
// to `POST /api/protocol/<subcommand>` carrying the parsed flags/positional
// args/stdin. This module turns that envelope back into a service-layer call so
// every protocol command shares one implementation with the rest of Overlord.

/** Envelope posted by the CLI's `runProtocolCommand`. */
export interface ProtocolRequestBody {
  args?: string[];
  positional?: string[];
  flags?: Record<string, string | boolean>;
  /**
   * Per-flag file/stdin payloads, keyed by the `--*-file` flag name. Replaces the
   * single `stdin` field so multiple file payloads in one call no longer collide.
   */
  fileInputs?: Record<string, string>;
  /** Legacy single-payload field; still honored when `fileInputs` lacks the flag. */
  stdin?: string;
  externalSessionId?: string | null;
}

/**
 * One project the caller can reach, labelled with its owning workspace.
 *
 * Project slugs and names are unique per workspace, never per organization, so
 * a human reference can legitimately match in more than one workspace. The
 * workspace labels are what let the caller (or the user behind an agent) tell
 * the candidates apart.
 */
export type ProjectChoice = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

/**
 * Raised when a human project reference matches in more than one workspace.
 *
 * Carried as a throw rather than a return value because project references are
 * resolved deep inside workspace derivation, before any subcommand handler
 * runs. `runProtocolSubcommand` converts it into the structured
 * `project_selection_required` result so every surface that accepts a project
 * name gets the same disambiguation contract — search, board-column reads,
 * mission creation, and project discovery alike.
 */
export class ProjectSelectionRequiredError extends Error {
  readonly projectRef: string;
  readonly projects: ProjectChoice[];

  constructor(projectRef: string, projects: ProjectChoice[]) {
    super(`Project reference matches more than one workspace: ${projectRef}`);
    this.name = 'ProjectSelectionRequiredError';
    this.projectRef = projectRef;
    this.projects = projects;
  }
}

/**
 * Resolve a human project reference — UUID, slug, or name — against the
 * caller's live memberships.
 *
 * A UUID is an exact address and short-circuits. Slug and name matching is
 * case-insensitive and may return several rows; `--workspace-id` (id, slug, or
 * name) narrows them, which is how a caller retries after a
 * `project_selection_required` result.
 */
async function resolveProjectRefChoices({
  projectRef,
  workspaceHint,
  workspaceIds
}: {
  projectRef: string;
  workspaceHint?: string | null;
  workspaceIds: string[];
}): Promise<ProjectChoice[]> {
  if (workspaceIds.length === 0) return [];
  const db = serviceDatabaseClient();
  const placeholders = workspaceIds.map(() => '?').join(', ');
  const selectChoice = `SELECT p.id, p.name, p.slug, p.workspace_id, w.name AS workspace_name,
            w.slug AS workspace_slug
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.deleted_at IS NULL AND p.workspace_id IN (${placeholders})`;
  type ChoiceRow = {
    id: string;
    name: string;
    slug: string;
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
  };
  const toChoice = (row: ChoiceRow): ProjectChoice => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug
  });

  const byId = await db.get<ChoiceRow>(`${selectChoice} AND p.id = ?`, [
    ...workspaceIds,
    projectRef
  ]);
  if (byId) return [toChoice(byId)];

  const matches = (
    await db.all<ChoiceRow>(
      `${selectChoice} AND (lower(p.slug) = lower(?) OR lower(p.name) = lower(?))`,
      [...workspaceIds, projectRef, projectRef]
    )
  ).map(toChoice);

  const hint = workspaceHint?.trim().toLowerCase();
  if (!hint || matches.length <= 1) return matches;
  // A hint only narrows: it never widens the set beyond live membership.
  const narrowed = matches.filter(
    choice =>
      choice.workspaceId.toLowerCase() === hint ||
      choice.workspaceSlug.toLowerCase() === hint ||
      choice.workspaceName.toLowerCase() === hint
  );
  return narrowed.length > 0 ? narrowed : matches;
}

async function protocolWorkspaceId(body: ProtocolRequestBody): Promise<string | null> {
  const scopes = await callerWorkspaceMemberships();
  if (scopes.length === 0) return null;
  const workspaceIds = scopes.map(scope => scope.workspaceId);
  const placeholders = workspaceIds.map(() => '?').join(', ');
  const db = serviceDatabaseClient();

  const executionRequestId = strFlag(body, '--execution-request-id');
  if (executionRequestId) {
    const request = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM execution_requests
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [executionRequestId, ...workspaceIds]
    );
    if (request) return request.workspace_id;
  }

  const sessionKey = strFlag(body, '--session-key');
  if (sessionKey) {
    const session = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM agent_sessions
        WHERE session_key_hash = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [hashSessionKey(sessionKey), ...workspaceIds]
    );
    if (session) return session.workspace_id;
  }

  // `--objective-id` alone is a complete address, so it has to resolve a
  // workspace on its own: a UUID identifies the objective row directly, and a
  // display id falls through to the mission lookup below via `missionRefFlag`.
  const objectiveRef = strFlag(body, '--objective-id');
  if (objectiveRef) {
    const objective = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM objectives
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [objectiveRef, ...workspaceIds]
    );
    if (objective) return objective.workspace_id;
  }

  const missionRef =
    strFlag(body, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef) ?? undefined;
  if (missionRef) {
    const byId = await db.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM missions
        WHERE id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [missionRef, ...workspaceIds]
    );
    if (byId) return byId.workspace_id;

    const byDisplay = await db.all<{ workspace_id: string }>(
      `SELECT workspace_id FROM missions
        WHERE display_id = ? AND deleted_at IS NULL AND workspace_id IN (${placeholders})`,
      [missionRef, ...workspaceIds]
    );
    if (byDisplay.length > 1) {
      throw new ApiError(409, `Mission reference is ambiguous across workspaces: ${missionRef}`);
    }
    if (byDisplay[0]) return byDisplay[0].workspace_id;
  }

  // Human project references (slug/name) are unique per workspace only, so this
  // is the one derivation step that can legitimately be ambiguous. Ambiguity is
  // reported as a selection result rather than an error so an agent can ask the
  // user and retry with `--workspace-id`.
  const projectRef = strFlag(body, '--project-id');
  if (!projectRef) return null;
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint: strFlag(body, '--workspace-id'),
    workspaceIds
  });
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return choices[0]?.workspaceId ?? null;
}

async function buildProtocolContext(
  body: ProtocolRequestBody,
  permission: Permission | null
): Promise<ServiceContext> {
  const workspaceId = await protocolWorkspaceId(body);
  if (!workspaceId) {
    const authorized = getAuthorizedWorkspacesContext();
    if (authorized) {
      const scope = permission
        ? await requireAnyWorkspacePermission(permission)
        : [...authorized.workspaces].sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))[0];
      if (!scope) throw new ApiError(404, 'Workspace not found');
      const ctx = await buildWebappServiceContextForWorkspace(
        scope.workspaceId,
        serviceDatabaseClient(),
        scope.workspaceUserId
      );
      // Aggregate/account-owned protocol handlers require ServiceContext for
      // the shared service signature, but authorization/fan-out remains inside
      // the handler. This deterministic anchor is never an ambient default.
      return { ...ctx, source: 'protocol' };
    }
    // Direct service tests and the loopback bootstrap surface have no request
    // authorization snapshot; preserve their process-local compatibility path.
    const ctx = buildWebappServiceContext();
    if (permission) {
      await requirePermission(permission, {
        workspaceId: ctx.workspace.id,
        workspaceUserId: ctx.actorWorkspaceUserId
      });
    }
    return { ...ctx, source: 'protocol' };
  }
  const workspaceUserId = permission
    ? await requireWorkspacePermission({ workspaceId, permission })
    : (await callerWorkspaceMemberships()).find(scope => scope.workspaceId === workspaceId)
        ?.workspaceUserId;
  if (!workspaceUserId) throw new ApiError(404, 'Workspace not found');
  const ctx = await buildWebappServiceContextForWorkspace(
    workspaceId,
    serviceDatabaseClient(),
    workspaceUserId
  );
  return { ...ctx, source: 'protocol' };
}

// ---- flag/argument helpers -----------------------------------------------

function flagsOf(body: ProtocolRequestBody): Record<string, string | boolean> {
  return body.flags ?? {};
}

/** String value of a `--flag value` pair, or undefined for absent/boolean flags. */
function strFlag(body: ProtocolRequestBody, name: string): string | undefined {
  const value = flagsOf(body)[name];
  return typeof value === 'string' ? value : undefined;
}

/** True when a boolean flag is present (`--flag` or `--flag true`). */
function boolFlag(body: ProtocolRequestBody, name: string): boolean {
  const value = flagsOf(body)[name];
  return value === true || value === 'true';
}

/**
 * Optional tri-state boolean from `--flag` / `--no-flag` / `--flag true|false`.
 * `--no-flag` wins when both are present.
 */
function optionalBoolFlag({
  body,
  name,
  negatedName
}: {
  body: ProtocolRequestBody;
  name: string;
  negatedName: string;
}): boolean | undefined {
  if (boolFlag(body, negatedName)) return false;
  const value = flagsOf(body)[name];
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ApiError(400, `${name} must be true or false`);
}

function optionalAutoAdvanceFlag(body: ProtocolRequestBody): boolean | undefined {
  return optionalBoolFlag({
    body,
    name: '--auto-advance',
    negatedName: '--no-auto-advance'
  });
}

function withDefaultAutoAdvance(
  items: ObjectiveInput[],
  autoAdvance: boolean | undefined
): ObjectiveInput[] {
  if (autoAdvance === undefined) return items;
  return items.map(item => ({
    ...item,
    autoAdvance: item.autoAdvance ?? autoAdvance
  }));
}

/**
 * Resolve `agent_sessions.id` from `--session-key` when present. Soft lookup —
 * a missing or unknown key yields null rather than failing the create path.
 */
async function resolveSessionId(body: ProtocolRequestBody): Promise<string | null> {
  const sessionKey = strFlag(body, '--session-key');
  if (!sessionKey) return null;
  const session = await serviceDatabaseClient().get<{ id: string }>(
    `SELECT id FROM agent_sessions
      WHERE session_key_hash = ? AND deleted_at IS NULL`,
    [hashSessionKey(sessionKey)]
  );
  return session?.id ?? null;
}

/** Stamp agent authorship provenance onto a protocol create-ish context. */
async function withAgentOrigin({
  ctx,
  body
}: {
  ctx: ServiceContext;
  body: ProtocolRequestBody;
}): Promise<ServiceContext> {
  return {
    ...ctx,
    origin: {
      kind: 'agent',
      agent: strFlag(body, '--agent') ?? null,
      sessionId: await resolveSessionId(body)
    }
  };
}

/** True when the flag appears at all, regardless of value. */
function hasFlag(body: ProtocolRequestBody, name: string): boolean {
  return name in flagsOf(body);
}

/** Agent protocol surfaces may edit instruction text only on queued objectives. */
async function assertInstructionEditableOnProtocolSurface(objectiveRef: string): Promise<void> {
  const db = requireDatabaseClient();
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveRef, db });
  const row = (await db.get(
    `SELECT state FROM objectives
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [resolved.id, resolved.workspaceId]
  )) as { state: string } | undefined;
  if (!row) {
    throw new ApiError(404, 'Objective not found');
  }
  if (row.state !== 'draft' && row.state !== 'future') {
    throw new ApiError(
      400,
      'Objective instruction text can only be edited in draft or future state'
    );
  }
}

/**
 * Resolve the per-flag file payload the CLI streamed for `fileFlag`, falling back
 * to the legacy single `stdin` field for older clients. Each `--*-file` flag now
 * carries its own content in `fileInputs`, so multiple file payloads in one call
 * no longer collide.
 */
function fileInput(body: ProtocolRequestBody, fileFlag: string): string | undefined {
  const perFlag = body.fileInputs?.[fileFlag];
  if (typeof perFlag === 'string') return perFlag;
  return body.stdin ?? '';
}

/**
 * Resolve text supplied either inline (`--summary "..."`) or via the file
 * variant (`--summary-file -`). The CLI streams file contents in the `fileInputs`
 * envelope, so any presence of the file flag means "use that payload" — this is
 * how the contract avoids shell-quoting failures for special characters.
 */
function resolveInput(
  body: ProtocolRequestBody,
  valueFlag: string,
  fileFlag: string
): string | undefined {
  const direct = strFlag(body, valueFlag);
  if (direct !== undefined) return direct;
  if (hasFlag(body, fileFlag)) return fileInput(body, fileFlag);
  return undefined;
}

/** Native session id: explicit flag wins, else the CLI's resolved value. */
function externalSessionId(body: ProtocolRequestBody): string | null | undefined {
  const flag = strFlag(body, '--external-session-id');
  if (flag !== undefined) return flag;
  return body.externalSessionId ?? undefined;
}

function requireFlag(body: ProtocolRequestBody, name: string): string {
  const value = strFlag(body, name);
  if (value === undefined || value.trim() === '') {
    throw new ApiError(400, `Missing required flag: ${name}`);
  }
  return value;
}

/**
 * The mission reference for a subcommand, derived from `--objective-id` when the
 * caller supplied only that.
 *
 * An objective display id spells its parent mission (`coo:756.k7xm` -> `coo:756`),
 * so an agent that has been handed one identifier can address every subcommand
 * with it. The CLI derives this client-side too, but hosted MCP and any direct
 * REST caller reach this handler with an untouched body, so the derivation has
 * to exist on both sides. An objective UUID names no mission, so it cannot
 * stand in for one.
 */
function missionRefFlag(body: ProtocolRequestBody): string {
  const explicit = strFlag(body, '--mission-id');
  if (explicit !== undefined && explicit.trim() !== '') return explicit;

  const derived = missionDisplayIdFromObjectiveRef(strFlag(body, '--objective-id'));
  if (derived) return derived;

  throw new ApiError(
    400,
    'Missing required flag: --mission-id (pass it, or an objective display id such as coo:756.k7xm as --objective-id)'
  );
}

/** Optional objective reference (UUID or `{mission.display_id}.{display_key}`). */
function objectiveRefFlag(body: ProtocolRequestBody): string | null {
  const value = strFlag(body, '--objective-id');
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

/** Validate the mission/objective pair even when a command uses the objective only as scope. */
async function validateObjectiveAddressing({
  ctx,
  body,
  subcommand
}: {
  ctx: ServiceContext;
  body: ProtocolRequestBody;
  subcommand: string;
}): Promise<void> {
  // update-objective is addressed by an objective alone and deliberately has
  // no mission scope to validate against.
  if (subcommand === 'update-objective') return;
  const objectiveRef = objectiveRefFlag(body);
  if (!objectiveRef) return;
  const missionRef =
    strFlag(body, '--mission-id') ?? missionDisplayIdFromObjectiveRef(objectiveRef);
  if (!missionRef) return;
  await resolveObjectiveRef({ ctx, ref: objectiveRef, missionId: missionRef });
}

/** Parse a JSON flag supplied inline (`--x-json`) or via stdin (`--x-file`). */
function parseJsonInput<T>(
  body: ProtocolRequestBody,
  jsonFlag: string,
  fileFlag: string
): T | undefined {
  const raw = resolveInput(body, jsonFlag, fileFlag);
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ApiError(
      400,
      `Invalid JSON for ${jsonFlag}`,
      err instanceof Error ? err.message : undefined
    );
  }
}

type DeliveryPayloadEnvelope = {
  summary?: string;
  artifacts?: ArtifactInput[];
  changeRationales?: ChangeRationaleInput[];
  verificationSummary?: string | null;
  followUpNotes?: string | null;
  payloadJson?: Record<string, unknown>;
};

/**
 * `--payload-json` is the portable delivery envelope. Individual delivery flags
 * remain authoritative when both forms are present, preserving older clients.
 */
function parseDeliveryPayloadEnvelope(body: ProtocolRequestBody): DeliveryPayloadEnvelope {
  const input = parseJsonInput<unknown>(body, '--payload-json', '--payload-file');
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ApiError(400, 'Delivery payload must be a JSON object');
  }

  const {
    summary,
    artifacts,
    changeRationales,
    verificationSummary,
    followUpNotes,
    ...payloadJson
  } = input as Record<string, unknown>;
  if (summary !== undefined && typeof summary !== 'string') {
    throw new ApiError(400, 'Delivery payload summary must be a string');
  }
  if (artifacts !== undefined && !Array.isArray(artifacts)) {
    throw new ApiError(400, 'Delivery payload artifacts must be an array');
  }
  if (changeRationales !== undefined && !Array.isArray(changeRationales)) {
    throw new ApiError(400, 'Delivery payload changeRationales must be an array');
  }
  if (
    verificationSummary !== undefined &&
    verificationSummary !== null &&
    typeof verificationSummary !== 'string'
  ) {
    throw new ApiError(400, 'Delivery payload verificationSummary must be a string or null');
  }
  if (followUpNotes !== undefined && followUpNotes !== null && typeof followUpNotes !== 'string') {
    throw new ApiError(400, 'Delivery payload followUpNotes must be a string or null');
  }
  return {
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(Array.isArray(artifacts) ? { artifacts: artifacts as ArtifactInput[] } : {}),
    ...(Array.isArray(changeRationales)
      ? { changeRationales: changeRationales as ChangeRationaleInput[] }
      : {}),
    ...(verificationSummary === null || typeof verificationSummary === 'string'
      ? { verificationSummary }
      : {}),
    ...(followUpNotes === null || typeof followUpNotes === 'string' ? { followUpNotes } : {}),
    payloadJson
  };
}

function csvFlag(body: ProtocolRequestBody, name: string): string[] | undefined {
  const value = strFlag(body, name);
  if (value === undefined) return undefined;
  const parts = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function intFlag(body: ProtocolRequestBody, name: string): number | undefined {
  const value = strFlag(body, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * CLI protocol accepts the same human project references as other CLI
 * commands, but the fan-out repository search deliberately accepts only
 * stable project IDs. Resolve the human form before crossing that boundary.
 */
/**
 * Resolve the `--project-id` filter for a V2 search.
 *
 * V2 is an organization-bounded aggregate read, so the reference resolves
 * against every membership in the active organization rather than one anchor
 * workspace. A name matching in two workspaces raises the selection flow
 * instead of guessing which board the user meant.
 */
async function resolveV2SearchProjectId(
  projectRef: string | null,
  workspaceHint?: string | null
): Promise<string[] | null> {
  if (!projectRef) return null;
  const scopes = await callerMembershipsInActiveOrganization(serviceDatabaseClient());
  const choices = await resolveProjectRefChoices({
    projectRef,
    workspaceHint,
    workspaceIds: scopes.map(scope => scope.workspaceId)
  });
  if (choices.length === 0) throw new ApiError(404, `Project not found: ${projectRef}`);
  if (choices.length > 1) throw new ProjectSelectionRequiredError(projectRef, choices);
  return [choices[0]!.id];
}

/** Objective text for create/prompt/record-work: `--objective`, else positional. */
function objectiveText(body: ProtocolRequestBody): string {
  const flag = strFlag(body, '--objective');
  if (flag !== undefined && flag.trim() !== '') return flag;
  const positional = (body.positional ?? []).join(' ').trim();
  if (positional) return positional;
  throw new ApiError(400, 'Missing objective text (use --objective or a positional argument)');
}

type ObjectiveInput = {
  objective: string;
  title?: string | null;
  autoAdvance?: boolean;
  resourceKey?: string | null;
};

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

/** Objective array for create/prompt: `--objectives-json`, else a one-item `--objective`. */
function objectiveInputs(body: ProtocolRequestBody): ObjectiveInput[] {
  const parsed =
    parseJsonInput<ObjectiveInput[]>(body, '--objectives-json', '--objectives-file') ?? null;
  const autoAdvance = optionalAutoAdvanceFlag(body);
  if (parsed) {
    if (!Array.isArray(parsed)) {
      throw new ApiError(400, 'objectives-json must be an array');
    }
    return withDefaultAutoAdvance(parsed, autoAdvance);
  }
  const resourceKey = strFlag(body, '--resource');
  return withDefaultAutoAdvance(
    [
      {
        objective: objectiveText(body),
        ...(resourceKey ? { resourceKey } : {})
      }
    ],
    autoAdvance
  );
}

type ArtifactInput = {
  type: string;
  label: string;
  content?: string | null;
  url?: string | null;
};

type ChangedFileInput = {
  filePath: string;
  vcsStatus?: string | null;
  attribution?: 'mine' | 'claimed' | 'unclaimed';
  claimedByMissionIds?: string[];
};

type Handler = (ctx: ServiceContext, body: ProtocolRequestBody) => unknown;

// ---- parentless workspace resolution -------------------------------------

type WorkspaceChoice = { id: string; name: string; slug: string };

type ParentlessWorkspaceResolution =
  | { kind: 'selection'; result: unknown }
  | { kind: 'workspace'; workspace: WorkspaceChoice };

/**
 * Resolve the target workspace for a "parentless" protocol action — one where
 * no mission/project/session reference identifies the workspace (project and
 * execution-target creation). When the caller belongs to more than one
 * workspace and did not name one via `--workspace-id`, this returns a structured
 * `workspace_selection_required` result listing the caller's workspaces instead
 * of silently defaulting; the agent/UI must ask the user and retry. Per-target
 * RBAC stays in the caller so the selection flow runs before any permission
 * check binds to a default workspace.
 */
async function resolveParentlessWorkspace(
  body: ProtocolRequestBody,
  selectionMessage: string
): Promise<ParentlessWorkspaceResolution> {
  const memberships = await callerWorkspaceMemberships();
  if (memberships.length === 0) {
    throw new ApiError(403, 'No active workspace membership; create or join a workspace first.');
  }

  const memberWorkspaceIds = new Set(memberships.map(m => m.workspaceId));
  const workspaces: WorkspaceChoice[] = (await listWorkspaces())
    .filter(w => memberWorkspaceIds.has(w.id))
    .map(w => ({ id: w.id, name: w.name, slug: w.slug }));

  const requested = strFlag(body, '--workspace-id')?.trim();
  if (requested) {
    const needle = requested.toLowerCase();
    const target = workspaces.find(
      w => w.id === requested || w.slug.toLowerCase() === needle || w.name.toLowerCase() === needle
    );
    if (!target) {
      throw new ApiError(404, `Workspace not found or not a member: ${requested}`);
    }
    return { kind: 'workspace', workspace: target };
  }
  if (workspaces.length === 1) {
    return { kind: 'workspace', workspace: workspaces[0]! };
  }
  return {
    kind: 'selection',
    result: {
      status: 'workspace_selection_required',
      message: selectionMessage,
      workspaces
    }
  };
}

/**
 * Create a project over the protocol/MCP surface. Project creation is
 * "parentless" (see {@link resolveParentlessWorkspace}).
 */
async function createProjectFromProtocol(body: ProtocolRequestBody): Promise<unknown> {
  const name = requireFlag(body, '--name');
  const resolved = await resolveParentlessWorkspace(
    body,
    'You belong to more than one workspace. Ask the user which workspace to create the ' +
      'project in, then retry with workspaceId set to the chosen id, slug, or name.'
  );
  if (resolved.kind === 'selection') return resolved.result;
  const target = resolved.workspace;

  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: target.id,
    permission: PERMISSIONS.PROJECT_CREATE,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx: ServiceContext = {
    ...(await buildWebappServiceContextForWorkspace(
      target.id,
      serviceDatabaseClient(),
      workspaceUserId
    )),
    source: 'protocol'
  };
  const project = await createProjectService({
    ctx,
    name,
    description: strFlag(body, '--description') ?? null,
    slug: strFlag(body, '--slug') ?? null
  });
  return { status: 'created', project, workspace: target };
}

/**
 * Register (announce) the acting machine as an execution target over the
 * protocol/MCP surface. Like project creation this is "parentless" — the target
 * belongs to a workspace with no mission/project to derive it from — so it reuses
 * {@link resolveParentlessWorkspace} for the multi-workspace selection flow.
 * `execution_request:claim` (in the `mission_lifecycle` token scope) gates it, so
 * a runner/agent that will actually run executions can self-register, while the
 * per-target check runs after the workspace is chosen.
 */
async function registerTargetFromProtocol(body: ProtocolRequestBody): Promise<unknown> {
  const resolved = await resolveParentlessWorkspace(
    body,
    'You belong to more than one workspace. Ask the user which workspace to register the ' +
      'execution target in, then retry with workspaceId set to the chosen id, slug, or name.'
  );
  if (resolved.kind === 'selection') return resolved.result;
  const target = resolved.workspace;

  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: target.id,
    permission: PERMISSIONS.EXECUTION_REQUEST_CLAIM,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const ctx: ServiceContext = {
    ...(await buildWebappServiceContextForWorkspace(
      target.id,
      serviceDatabaseClient(),
      workspaceUserId
    )),
    source: 'protocol'
  };
  const registered = await registerActingExecutionTarget({
    ctx,
    label: strFlag(body, '--name') ?? null
  });
  return { status: 'registered', executionTarget: registered, workspace: target };
}

// ---- subcommand handlers -------------------------------------------------

const handlers: Record<string, Handler> = {
  // Session lifecycle ------------------------------------------------------
  attach: (ctx, body) =>
    attachSession({
      ctx,
      missionId: missionRefFlag(body),
      agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
      modelIdentifier: strFlag(body, '--model') ?? null,
      existingSessionKey: strFlag(body, '--session-key') ?? null,
      externalSessionId: externalSessionId(body),
      executionRequestId: strFlag(body, '--execution-request-id') ?? null,
      executionTargetId: strFlag(body, '--execution-target-id') ?? null,
      // The channel id only. Its credential never travels in a protocol flag — it reaches the
      // backend solely as an Authorization header on the adapter route family.
      sessionChannelId: strFlag(body, '--session-channel-id') ?? null,
      objectiveId: objectiveRefFlag(body)
    }),

  update: (ctx, body) =>
    updateSession({
      ctx,
      missionId: missionRefFlag(body),
      sessionKey: requireFlag(body, '--session-key'),
      summary: resolveInput(body, '--summary', '--summary-file') ?? '',
      phase: strFlag(body, '--phase') ?? null,
      eventType: strFlag(body, '--event-type') ?? 'update',
      payloadJson: parseJsonInput<Record<string, unknown>>(
        body,
        '--payload-json',
        '--payload-file'
      ),
      externalUrl: strFlag(body, '--external-url') ?? null,
      externalSessionId: externalSessionId(body),
      beginFollowUpWork: boolFlag(body, '--begin-follow-up-work'),
      followUpIntent: strFlag(body, '--follow-up-intent') ?? null,
      changedFiles: parseJsonInput<ChangedFileInput[]>(
        body,
        '--changed-files-json',
        '--changed-files-file'
      ),
      changeRationales: parseJsonInput<Array<Record<string, unknown>>>(
        body,
        '--change-rationales-json',
        '--change-rationales-file'
      )
    }),

  heartbeat: (ctx, body) =>
    heartbeatSession({
      ctx,
      missionId: missionRefFlag(body),
      sessionKey: requireFlag(body, '--session-key'),
      phase: strFlag(body, '--phase') ?? null,
      note: strFlag(body, '--note') ?? null
    }),

  ask: (ctx, body) =>
    askQuestion({
      ctx,
      missionId: missionRefFlag(body),
      sessionKey: requireFlag(body, '--session-key'),
      question: resolveInput(body, '--question', '--question-file') ?? ''
    }),

  deliver: (ctx, body) => {
    const envelope = parseDeliveryPayloadEnvelope(body);
    const artifacts = parseJsonInput<ArtifactInput[]>(body, '--artifacts', '--artifacts-file');
    const changeRationales = parseJsonInput<ChangeRationaleInput[]>(
      body,
      '--change-rationales-json',
      '--change-rationales-file'
    );
    return deliverSession({
      ctx,
      missionId: missionRefFlag(body),
      sessionKey: requireFlag(body, '--session-key'),
      summary: resolveInput(body, '--summary', '--summary-file') ?? envelope.summary ?? '',
      artifacts: artifacts ?? envelope.artifacts ?? [],
      changeRationales: changeRationales ?? envelope.changeRationales ?? [],
      changedFiles: parseJsonInput<ChangedFileInput[]>(
        body,
        '--changed-files-json',
        '--changed-files-file'
      ),
      noFileChanges: boolFlag(body, '--no-file-changes'),
      skipRationaleFor:
        parseJsonInput<Array<{ filePath?: string; file_path?: string; reason: string }>>(
          body,
          '--skip-rationale-for-json',
          '--skip-rationale-for-file'
        ) ?? [],
      observedDirtyPaths: parseJsonInput<string[]>(
        body,
        '--observed-dirty-paths-json',
        '--observed-dirty-paths-file'
      ),
      payloadJson: envelope.payloadJson,
      verificationSummary:
        strFlag(body, '--verification-summary') ?? envelope.verificationSummary ?? null,
      followUpNotes: strFlag(body, '--follow-up-notes') ?? envelope.followUpNotes ?? null
    });
  },

  'hook-event': (ctx, body) =>
    recordHookEvent({
      ctx,
      missionId: missionRefFlag(body),
      hookType: requireFlag(body, '--hook-type'),
      prompt: resolveInput(body, '--prompt', '--prompt-file') ?? '',
      sessionKey: strFlag(body, '--session-key') ?? null,
      externalSessionId: externalSessionId(body) ?? null,
      turnIndex: strFlag(body, '--turn-index') ?? null
    }),

  'resume-follow-up': (ctx, body) =>
    resumeFollowUp({
      ctx,
      missionId: missionRefFlag(body),
      objectiveId: objectiveRefFlag(body),
      agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
      modelIdentifier: strFlag(body, '--model') ?? null,
      externalSessionId: externalSessionId(body),
      summary: resolveInput(body, '--summary', '--summary-file') ?? null,
      executionTargetId: strFlag(body, '--execution-target-id') ?? null
    }),

  // Mission creation and discovery -----------------------------------------
  create: async (ctx, body) => {
    const objectives = objectiveInputs(body);
    if (boolFlag(body, '--inbox')) {
      const first = objectives[0]?.objective?.trim();
      if (!first) throw new ApiError(400, 'Inbox creation requires an objective');
      return {
        unassigned: true,
        inboxItem: await createInboxItem({
          title: strFlag(body, '--title')?.trim() || first,
          objectives: [first]
        })
      };
    }
    try {
      const assignedTo = strFlag(body, '--assigned-to');
      return await protocolCreate({
        ctx: await withAgentOrigin({ ctx, body }),
        projectId: strFlag(body, '--project-id') ?? null,
        objectives,
        title: strFlag(body, '--title') ?? null,
        ...(assignedTo !== undefined ? { assignedTo } : {})
      });
    } catch (error) {
      if (
        strFlag(body, '--project-id') ||
        !(error instanceof ServiceError) ||
        error.code !== 'project_not_found'
      ) {
        throw error;
      }
      const first = objectives[0]?.objective?.trim();
      if (!first) throw error;
      return {
        unassigned: true,
        inboxItem: await createInboxItem({
          title: strFlag(body, '--title')?.trim() || first,
          objectives: [first]
        })
      };
    }
  },

  prompt: async (ctx, body) => {
    const assignedTo = strFlag(body, '--assigned-to');
    return protocolPrompt({
      ctx: await withAgentOrigin({ ctx, body }),
      projectId: strFlag(body, '--project-id') ?? null,
      objectives: objectiveInputs(body),
      title: strFlag(body, '--title') ?? null,
      agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
      externalSessionId: externalSessionId(body),
      ...(assignedTo !== undefined ? { assignedTo } : {})
    });
  },

  'load-context': (ctx, body) =>
    loadMissionContext({
      ctx,
      missionId: missionRefFlag(body),
      objectiveId: objectiveRefFlag(body),
      executionTargetId: strFlag(body, '--execution-target-id') ?? null
    }),

  'list-deliveries': (_ctx, body) => listMissionDeliveries(missionRefFlag(body)),

  'launch-objective': (_ctx, body) =>
    launchObjective(requireFlag(body, '--objective-id'), {
      agent: requireFlag(body, '--agent'),
      ...(strFlag(body, '--model') !== undefined ? { model: strFlag(body, '--model') } : {}),
      ...(strFlag(body, '--reasoning-effort') !== undefined
        ? { reasoningEffort: strFlag(body, '--reasoning-effort') }
        : {}),
      ...(strFlag(body, '--execution-target-id') !== undefined
        ? { executionTargetId: strFlag(body, '--execution-target-id') }
        : {})
    }),

  'reorder-future-objectives': (_ctx, body) => {
    const orderedObjectiveIds = parseJsonInput<string[]>(
      body,
      '--ordered-objective-ids-json',
      '--ordered-objective-ids-file'
    );
    if (orderedObjectiveIds === undefined) {
      throw new ApiError(400, 'Missing required flag: --ordered-objective-ids-json');
    }
    return reorderFutureObjectives(missionRefFlag(body), { orderedObjectiveIds });
  },

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
  },

  connect: (ctx, body) =>
    connectSession({
      ctx,
      missionId: missionRefFlag(body),
      objectiveId: objectiveRefFlag(body),
      agentIdentifier: strFlag(body, '--agent') ?? 'unknown',
      externalSessionId: externalSessionId(body)
    }),

  'search-missions': async (ctx, body) => {
    const params = {
      ctx,
      query: strFlag(body, '--query') ?? null,
      statusTypes: csvFlag(body, '--status') ?? null,
      projectId: strFlag(body, '--project-id') ?? null,
      resourceKeys: csvFlag(body, '--resource-key') ?? null,
      dateField: (strFlag(body, '--date-field') as MissionSearchDateField | undefined) ?? null,
      from: strFlag(body, '--from') ?? null,
      to: strFlag(body, '--to') ?? null,
      limit: intFlag(body, '--limit') ?? 25
    };
    const responseVersion = intFlag(body, '--response-version');
    if (responseVersion === 3) {
      return searchMissionsV3AcrossWorkspaces({
        query: params.query,
        projectIds: await resolveV2SearchProjectId(
          params.projectId,
          strFlag(body, '--workspace-id')
        ),
        statusTypes: params.statusTypes,
        resourceKeys: params.resourceKeys,
        dateField: params.dateField,
        from: params.from,
        to: params.to,
        limit: params.limit,
        entityTypes: csvFlag(body, '--entity-types') ?? null,
        objectiveStates: csvFlag(body, '--objective-states') ?? null,
        matchesPerResult: intFlag(body, '--matches-per-result') ?? null
      });
    }
    if (responseVersion !== 2) return searchMissions(params);

    // V2 is an organization-bounded aggregate read. It must not inherit the
    // one workspace selected for ordinary protocol entity operations.
    return searchMissionsAcrossWorkspaces({
      query: params.query,
      projectIds: await resolveV2SearchProjectId(params.projectId, strFlag(body, '--workspace-id')),
      statusTypes: params.statusTypes,
      resourceKeys: params.resourceKeys,
      dateField: params.dateField,
      from: params.from,
      to: params.to,
      limit: params.limit
    });
  },

  'discuss-objective': (ctx, body) =>
    discussObjective({
      ctx,
      missionId: missionRefFlag(body),
      objectiveId: objectiveRefFlag(body)
    }),

  'add-objectives': async (ctx, body) =>
    addObjectivesToMission({
      ctx: await withAgentOrigin({ ctx, body }),
      missionId: missionRefFlag(body),
      objectives: withDefaultAutoAdvance(
        parseJsonInput<ObjectiveInput[]>(body, '--objectives-json', '--objectives-file') ?? [],
        optionalAutoAdvanceFlag(body)
      )
    }),

  'update-objective': async (_ctx, body) => {
    const objectiveId = requireFlag(body, '--objective-id');
    const update: UpdateObjectiveBody = {};
    const autoAdvance = optionalAutoAdvanceFlag(body);
    if (autoAdvance !== undefined) {
      update.autoAdvance = autoAdvance;
    }
    if (hasFlag(body, '--instruction-text') || hasFlag(body, '--instruction-text-file')) {
      await assertInstructionEditableOnProtocolSurface(objectiveId);
      update.instructionText =
        resolveInput(body, '--instruction-text', '--instruction-text-file') ?? '';
    }
    if (autoAdvance === undefined && update.instructionText === undefined) {
      throw new ApiError(
        400,
        'Provide at least one of --auto-advance/--no-auto-advance or --instruction-text/--instruction-text-file'
      );
    }
    return updateObjectiveRecord(objectiveId, update);
  },

  'record-work': async (ctx, body) => {
    const envelope = parseDeliveryPayloadEnvelope(body);
    // record-work is often driven from a single streamed JSON envelope, so
    // `objective`, `title`, and `changedFiles` may arrive either as flags or as
    // fields inside `--payload-json`/`--payload-file`. Pull them out of the
    // leftover payload here (flags always win) and keep the rest (e.g.
    // `deliveryReport`) as the stored delivery payload.
    const {
      objective: payloadObjective,
      title: payloadTitle,
      changedFiles: payloadChangedFiles,
      ...restPayload
    } = envelope.payloadJson ?? {};
    const artifacts = parseJsonInput<ArtifactInput[]>(body, '--artifacts', '--artifacts-file');
    const changeRationales = parseJsonInput<ChangeRationaleInput[]>(
      body,
      '--change-rationales-json',
      '--change-rationales-file'
    );
    const changedFiles = parseJsonInput<ChangedFileInput[]>(
      body,
      '--changed-files-json',
      '--changed-files-file'
    );
    const objective =
      strFlag(body, '--objective') ??
      ((body.positional ?? []).join(' ').trim() || undefined) ??
      (typeof payloadObjective === 'string' ? payloadObjective : undefined);
    if (!objective || !objective.trim()) {
      throw new ApiError(
        400,
        'Missing objective text (use --objective, a positional argument, or an "objective" field in --payload-json)'
      );
    }
    const assignedTo = strFlag(body, '--assigned-to');
    return recordWork({
      ctx: await withAgentOrigin({ ctx, body }),
      projectId: strFlag(body, '--project-id') ?? null,
      summary: resolveInput(body, '--summary', '--summary-file') ?? envelope.summary ?? '',
      objective,
      title: strFlag(body, '--title') ?? (typeof payloadTitle === 'string' ? payloadTitle : null),
      artifacts: artifacts ?? envelope.artifacts ?? [],
      changeRationales: changeRationales ?? envelope.changeRationales ?? [],
      changedFiles: changedFiles ?? (Array.isArray(payloadChangedFiles) ? payloadChangedFiles : []),
      payloadJson: restPayload,
      ...(assignedTo !== undefined ? { assignedTo } : {})
    });
  },

  // Shared context ---------------------------------------------------------
  'read-context': (ctx, body) =>
    listSharedContext({
      ctx,
      missionId: missionRefFlag(body),
      keySubstring: strFlag(body, '--key') ?? null,
      limit: intFlag(body, '--limit') ?? 50
    }),

  'write-context': (ctx, body) => {
    const valueJson = parseJsonInput<unknown>(body, '--value-json', '--value-file');
    const value = valueJson !== undefined ? valueJson : (strFlag(body, '--value') ?? '');
    return writeSharedContext({
      ctx,
      missionId: missionRefFlag(body),
      key: requireFlag(body, '--key'),
      value
    });
  },

  // Mid-turn artifact create (same service as REST POST). Optional session key
  // stamps session/objective provenance when the agent is on a live turn.
  'add-artifact': (_ctx, body) => {
    const create: CreateArtifactBody = {
      type: requireFlag(body, '--type'),
      label: requireFlag(body, '--label')
    };
    if (hasFlag(body, '--content-text') || hasFlag(body, '--content-text-file')) {
      const content = resolveInput(body, '--content-text', '--content-text-file');
      create.contentText = content !== undefined && content.trim() ? content : null;
    }
    if (hasFlag(body, '--external-url')) {
      const url = strFlag(body, '--external-url');
      create.externalUrl = url !== undefined && url.trim() ? url : null;
    }
    const sessionKey = strFlag(body, '--session-key');
    if (sessionKey) {
      create.sessionKey = sessionKey;
    }
    // Without a live session there is nothing to infer objective provenance
    // from, so an explicit reference is the only way a mid-turn artifact lands
    // on the objective it belongs to.
    const objectiveRef = objectiveRefFlag(body);
    if (objectiveRef) {
      create.objectiveId = objectiveRef;
    }
    return createArtifact(missionRefFlag(body), create);
  },

  // In-place artifact edit (same service as REST PATCH). No session key — a
  // later objective or follow-up can revise an artifact created earlier.
  'update-artifact': (_ctx, body) => {
    const expectedRevision = intFlag(body, '--expected-revision');
    if (expectedRevision === undefined) {
      throw new ApiError(400, 'Missing required flag: --expected-revision');
    }
    const update: UpdateArtifactBody = { expectedRevision };
    if (hasFlag(body, '--label')) {
      update.label = strFlag(body, '--label') ?? '';
    }
    if (hasFlag(body, '--content-text') || hasFlag(body, '--content-text-file')) {
      const content = resolveInput(body, '--content-text', '--content-text-file');
      update.contentText = content !== undefined && content.trim() ? content : null;
    }
    if (hasFlag(body, '--external-url')) {
      const url = strFlag(body, '--external-url');
      update.externalUrl = url !== undefined && url.trim() ? url : null;
    }
    return updateArtifact(missionRefFlag(body), requireFlag(body, '--artifact-id'), update);
  },

  'attachment-list': async (ctx, body) => {
    const missionId = missionRefFlag(body);
    const attachments = await listAttachments({
      ctx,
      missionId,
      objectiveId: objectiveRefFlag(body)
    });
    return attachments.map(a => ({
      ...a,
      url: `/api/storage/attachments/${encodeURIComponent(a.storageKey)}`
    }));
  },

  'attachment-download-url': async (ctx, body) => {
    const missionId = missionRefFlag(body);
    const attachmentId = requireFlag(body, '--attachment-id');
    const attachments = await listAttachments({
      ctx,
      missionId,
      objectiveId: objectiveRefFlag(body)
    });
    const found = attachments.find(a => a.id === attachmentId);
    if (!found) throw new ApiError(404, `Attachment not found: ${attachmentId}`);
    return {
      id: found.id,
      filename: found.filename,
      contentType: found.mimeType,
      url: `/api/storage/attachments/${encodeURIComponent(found.storageKey)}`
    };
  },

  // Auth and discovery -----------------------------------------------------
  'auth-status': ctx => authStatus({ ctx }),

  'discover-project': (ctx, body) =>
    discoverProject({
      ctx,
      projectId: strFlag(body, '--project-id') ?? null,
      workingDirectory: strFlag(body, '--directory') ?? null
    }),

  // Board-column discovery. Statuses are project-scoped (coo:752), so an agent
  // that needs to name a column must ask the project that owns it. Read-only:
  // status *definitions* are edited in project settings, never over the protocol.
  statuses: (ctx, body) =>
    listProjectStatuses({
      ctx,
      projectId: requireFlag(body, '--project-id')
    }),

  // Parentless project creation. Resolves/validates the target workspace itself
  // (see `createProjectFromProtocol`) so it can return a `workspace_selection_required`
  // result when the caller has multiple memberships instead of defaulting.
  'create-project': (_ctx, body) => createProjectFromProtocol(body),

  // Parentless execution-target registration. Resolves/validates the target
  // workspace itself (see `registerTargetFromProtocol`) so it can return a
  // `workspace_selection_required` result when the caller has multiple
  // memberships instead of defaulting.
  'register-target': (_ctx, body) => registerTargetFromProtocol(body),

  // Predates the real `organizations` table/hierarchy (coo:135) — despite the
  // name, this returns only the caller's current *workspace* context (never
  // an organization row), kept as-is to avoid a breaking protocol rename.
  // Use `GET /api/organizations` (web) for real organization data.
  'list-organizations': ctx => [
    { id: ctx.workspace.id, slug: ctx.workspace.slug, name: ctx.workspace.name }
  ]
};

/**
 * RBAC permission each protocol subcommand requires. Enforced before dispatch so
 * a scoped `USER_TOKEN` (and any under-privileged actor) is rejected uniformly —
 * the `mission_lifecycle` scope grants exactly the set used here. `auth-status` is
 * intentionally ungated so any authenticated actor can check who it is.
 */
export const SUBCOMMAND_PERMISSIONS: Record<string, Permission | null> = {
  attach: PERMISSIONS.SESSION_ATTACH,
  update: PERMISSIONS.EVENT_CREATE,
  heartbeat: PERMISSIONS.EVENT_CREATE,
  ask: PERMISSIONS.EVENT_CREATE,
  deliver: PERMISSIONS.EVENT_CREATE,
  'hook-event': PERMISSIONS.EVENT_CREATE,
  'resume-follow-up': PERMISSIONS.SESSION_ATTACH,
  create: null,
  prompt: PERMISSIONS.MISSION_CREATE,
  'load-context': PERMISSIONS.MISSION_READ,
  'list-deliveries': PERMISSIONS.MISSION_READ,
  'launch-objective': PERMISSIONS.EXECUTION_REQUEST_CREATE,
  'reorder-future-objectives': PERMISSIONS.OBJECTIVE_UPDATE,
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
  'run-queue': PERMISSIONS.OBJECTIVE_READ,
  connect: PERMISSIONS.SESSION_ATTACH,
  'search-missions': PERMISSIONS.MISSION_READ,
  'discuss-objective': PERMISSIONS.OBJECTIVE_SUBMIT,
  'add-objectives': PERMISSIONS.OBJECTIVE_UPDATE,
  'update-objective': PERMISSIONS.OBJECTIVE_UPDATE,
  'record-work': PERMISSIONS.MISSION_CREATE,
  'read-context': PERMISSIONS.MISSION_READ,
  'write-context': PERMISSIONS.MISSION_UPDATE,
  'add-artifact': PERMISSIONS.ARTIFACT_CREATE,
  'update-artifact': PERMISSIONS.MISSION_UPDATE,
  'attachment-list': PERMISSIONS.ARTIFACT_READ,
  'attachment-download-url': PERMISSIONS.ARTIFACT_READ,
  'auth-status': null,
  'discover-project': PERMISSIONS.PROJECT_READ,
  statuses: PERMISSIONS.PROJECT_READ,
  // Enforced per-target inside the handler (requireWorkspacePermission) so the
  // multi-workspace selection flow runs before any default-workspace gate.
  'create-project': null,
  'register-target': null,
  'list-organizations': PERMISSIONS.PROJECT_READ
};

/**
 * Dispatch a single `ovld protocol <subcommand>` invocation to the service
 * layer. Throws `ApiError(404)` for unknown subcommands; service-layer
 * validation surfaces as `ServiceError` (mapped to HTTP status by the caller).
 */
export async function runProtocolSubcommand(
  subcommand: string,
  body: ProtocolRequestBody
): Promise<unknown> {
  const canonicalSubcommand = subcommand === 'search' ? 'search-missions' : subcommand;
  const handler = handlers[canonicalSubcommand];
  if (!handler) {
    throw new ApiError(
      404,
      `Unknown protocol subcommand: ${subcommand}`,
      `Supported subcommands: ${Object.keys(handlers).sort().join(', ')}`
    );
  }
  // V2 search authorizes mission:read per workspace inside the repository
  // fan-out. A single ambient workspace check would deny valid secondary
  // workspaces and reintroduce the pre-v95 scoping bug.
  const isAggregateSearch =
    canonicalSubcommand === 'search-missions' &&
    (intFlag(body, '--response-version') === 2 || intFlag(body, '--response-version') === 3);
  const requiredPermission = isAggregateSearch
    ? null
    : (SUBCOMMAND_PERMISSIONS[canonicalSubcommand] ?? null);
  try {
    const ctx = await buildProtocolContext(body, requiredPermission);
    await validateObjectiveAddressing({ ctx, body, subcommand: canonicalSubcommand });
    return await handler(ctx, body);
  } catch (error) {
    // A project name that matches in two workspaces is a question for the user,
    // not a failure. Mirrors `workspace_selection_required` on the parentless
    // creates: the caller asks, then retries with `--workspace-id`.
    if (error instanceof ProjectSelectionRequiredError) {
      return {
        status: 'project_selection_required',
        message:
          `More than one project matches "${error.projectRef}". Ask the user which workspace ` +
          'they mean, then retry with workspaceId set to the chosen workspace id, slug, or name.',
        projectRef: error.projectRef,
        projects: error.projects
      };
    }
    throw error;
  }
}
