import {
  DEFAULT_USER_TOKEN_TTL_DAYS,
  generateUserTokenSecret,
  hashUserTokenSecret,
  listActiveTokenScopeGrants,
  type Permission,
  PERMISSIONS,
  scopeGrantsForPreset,
  USER_TOKEN_HASH_ALGORITHM,
  USER_TOKEN_PREFIX
} from '@overlord/auth';
import { generateDateFromSchedule, type ScheduleLike } from '@overlord/automations';
import type { CreatedGitHubRepositoryDto } from '@overlord/contract/ext/github';
import {
  OBJECTIVE_COMPLETED_AT_ASSIGNMENT,
  OBJECTIVE_LAUNCHED_AT_ASSIGNMENT,
  OBJECTIVE_STARTED_AT_ASSIGNMENT
} from '@overlord/core/service/objective-lifecycle-timestamps';
import {
  bindBool,
  type DatabaseClient,
  DEFAULT_STATUSES,
  formatObjectiveDisplayId,
  OBJECTIVE_STATES,
  type ObjectiveState,
  type SqlDialect
} from '@overlord/database';
import path from 'node:path';

import type { ServiceContext } from '../packages/core/service/context.ts';
import { readDeliveryReport } from '../packages/core/service/delivery-report.ts';
import { ServiceError } from '../packages/core/service/errors.ts';
import {
  declareActingDeviceTarget,
  NO_EXECUTION_TARGET_REGISTERED,
  readActorLaunchSessionDefaults
} from '../packages/core/service/execution-targets.ts';
import {
  enqueueLiveActivityRefreshForMission,
  enqueueLiveActivityStartForMission
} from '../packages/core/service/live-activity-jobs.ts';
import {
  resolveBackendResourceProvider,
  resolveManagedWorktreeRoot,
  UnavailableProvider
} from '../packages/core/service/local-target/index.ts';
import type {
  CapabilityFailure,
  TargetMetadata
} from '../packages/core/service/local-target/types.ts';
import {
  loadMissionBranchObservationsForMissions,
  mergeMissionBranchObservation
} from '../packages/core/service/mission-branch-observations.ts';
import {
  allocateWorkspaceSearchLimits,
  mergeWorkspaceMissionSearches,
  mergeWorkspaceSearchV3,
  searchWorkspaceMissions,
  searchWorkspaceMissionsV3,
  toSearchMissionsResponseV2,
  toSearchResponseV3
} from '../packages/core/service/mission-search.ts';
import {
  assignMissionTags as assignMissionTagsOnCreate,
  createMissionWithObjectives,
  insertArtifactRow,
  insertObjective as createObjectiveOnMission,
  writeSharedContext
} from '../packages/core/service/missions.ts';
import { emitNotification } from '../packages/core/service/notifications/notifications.ts';
import { resolveProjectExecutionTargetForLaunch } from '../packages/core/service/project-execution-target.ts';
import {
  enqueueObjectiveAfterLastQueuedSibling,
  enqueueRunQueueDispatch,
  removeRunQueueEntryForObjective
} from '../packages/core/service/run-queue.ts';
import {
  loadTargetResourceObservations,
  mergeResourceStatusWithObservation,
  type TargetResourceObservationRow
} from '../packages/core/service/target-resource-observations.ts';
import { hashSessionKey } from '../packages/core/service/util.ts';
import type {
  ArtifactDto,
  CreateArtifactBody,
  CreatedByKind,
  CreateInboxItemBody,
  CreateMissionBody,
  CreateObjectiveBody,
  CreateProjectBody,
  CreateProjectResourceBody,
  CreateProjectStatusBody,
  CreateProjectTagBody,
  CreateUserTokenBody,
  CreateUserTokenResultDto,
  DefaultProjectPreferenceDto,
  DeliveryDto,
  DeliveryReportPayloadV1,
  FileChangeDto,
  GenerateCommitMessageResultDto,
  InboxItemDto,
  InboxMissionDto,
  InboxMissionReason,
  InboxMissionsResponse,
  InitializeProjectBody,
  InitializeProjectResultDto,
  MissionBranchDto,
  MissionBranchListDto,
  MissionCreatedFromDto,
  MissionDetailDto,
  MissionDto,
  MissionEventDto,
  MissionScheduleDto,
  MissionSearchDateField,
  MissionWorktreePreference,
  MyMissionDto,
  MyMissionReorderRequest,
  MyMissionsResponse,
  ObjectiveDto,
  PreviewScheduleBody,
  ProfileDto,
  ProjectDto,
  ProjectListLifecycle,
  ProjectRepositoryDto,
  ProjectResourceDto,
  ProjectStatusDto,
  ProjectTagDto,
  PurgeWorktreesResultDto,
  RemoveWorktreeBody,
  ReorderBoardColumnBody,
  ReorderFutureObjectivesBody,
  ReorderProjectsBody,
  ReorderProjectStatusesBody,
  RunQueueWaitingReason,
  ScheduleDto,
  ScheduleInput,
  SearchMissionsResponseV2,
  SearchResponseV3,
  SharedContextEntryDto,
  StatusType,
  TokenScope,
  UpdateArtifactBody,
  UpdateInboxItemBody,
  UpdateMissionBody,
  UpdateObjectiveBody,
  UpdateProfileBody,
  UpdateProjectBody,
  UpdateProjectResourceBody,
  UpdateProjectResourceSourceBody,
  UpdateProjectStatusBody,
  UpdateProjectTagBody,
  UpdateUserTokenBody,
  UpsertSharedContextBody,
  UserTokenDto,
  WorktreeDto
} from '../webapp/shared/contract.ts';
import {
  isMyMissionsColumnType,
  MY_MISSIONS_COLUMN_TYPES,
  normalizeAgentLaunchFlags
} from '../webapp/shared/contract.ts';

import { generateCommitMessageFromDiff } from './automation/commit-message-automation.ts';
import {
  generateMissionTitleNow,
  initialTitleFromInstruction,
  scheduleMissionTitleGeneration,
  scheduleObjectiveTitleGeneration
} from './automation/title-automation.ts';
import { listMissionTerminalSessions } from './execution/latch-sessions.ts';
import {
  dequeueObjective,
  LAUNCHABLE_STATES,
  listMissionExecutionRequests
} from './execution/launch.ts';
import { resolveProjectLocalTargetProvider } from './execution/local-target-mutation-queue.ts';
import {
  createProjectInitialization,
  type ProjectInitializationRow,
  readProjectInitialization,
  readProjectInitializationById,
  recordPrivateRepositoryLink,
  recordProvisioningFailure,
  recordProvisioningSuccess
} from './ext/github/service.ts';
import { createPrivateGitHubRepository } from './ext/github/user-oauth.ts';
import { missionWorktreePath, previewMissionBranch } from './branch-planning.ts';
import {
  buildWebappServiceContextForWorkspace,
  DATABASE_DIALECT,
  enqueueWebhookEventRest,
  findActiveMembershipId,
  getActorWorkspaceUserId,
  getAuthorizedWorkspacesContext,
  getBootstrapWorkspaceIdOrNull,
  newId,
  nowIso,
  recordChange,
  requireDatabaseClient,
  resolveActiveProfileId
} from './db.ts';
import { ApiError } from './errors.ts';
import { resolveObjectiveIdForRest } from './objective-ref.ts';
import { getActiveOrganizationIdOrNull } from './organizations.ts';
import {
  actorCan,
  loadActorRoles,
  requireMissionPermission,
  requireProjectPermission,
  requireWorkspacePermission
} from './rbac.ts';

export { ApiError };

/** Control-plane provider: never touches linked checkout paths on the server (WS-F3). */
function checkoutControlPlaneProvider(target: TargetMetadata) {
  return resolveBackendResourceProvider(false, target);
}

function throwCheckoutLocalRequired(): never {
  throw new ApiError(
    409,
    'Checkout-local work must run on a local execution target (Overlord Desktop or the dev invoke proxy).',
    'The hosted Overlord backend stores metadata and queues work, but it cannot inspect or mutate your local filesystem.',
    'LOCAL_FILESYSTEM_UNAVAILABLE'
  );
}

/**
 * How long a REST handler waits for a queued capability call before answering.
 * The job is not cancelled by the wait ending — a `LOCAL_TARGET_TIMEOUT` means
 * "still running over there", which callers render as in-progress.
 */
const BRANCH_ACTION_WAIT_MS = 15_000;
const WORKTREE_MUTATION_WAIT_MS = 15_000;

/**
 * Map a local-target capability failure onto the HTTP error the surfaces already
 * understand. "No target could serve this" keeps the long-standing
 * `LOCAL_FILESYSTEM_UNAVAILABLE` contract so the desktop client still falls back
 * to its own bridge. `LOCAL_TARGET_TIMEOUT` never reaches here: it is not a
 * failure, and each caller decides what "still running" looks like.
 */
function throwLocalTargetCapabilityFailure(failure: CapabilityFailure): never {
  if (failure.code === 'LOCAL_TARGET_REQUIRED' || failure.code === 'LOCAL_TARGET_UNREACHABLE') {
    throwCheckoutLocalRequired();
  }
  const details =
    failure.details && typeof failure.details === 'object' && !Array.isArray(failure.details)
      ? (failure.details as Record<string, unknown>)
      : {};
  throw new ApiError(
    409,
    failure.message,
    typeof details.detail === 'string' ? details.detail : undefined,
    typeof details.branchActionCode === 'string' ? details.branchActionCode : failure.code
  );
}

/** Metadata for capability calls that must not run on the control-plane backend. */
function backendTargetMetadata(executionTargetId: string | null): TargetMetadata {
  return { executionTargetId, deviceLabel: null, transport: 'in_process' };
}

// The default workflow seeded for every new project. The schema enforces (via
// partial unique indexes) at most one default, one `execute`, and one `review`
// status per project, so this set is intentionally one of each.
// ---- row shapes ----------------------------------------------------------

interface ProjectRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string | null;
  settings_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  revision: number;
  mission_count: number;
  position: number | null;
}

const PROJECT_COLOR_SETTINGS_KEY = 'overlord.color';
const PROJECT_DEFAULT_BRANCH_SETTINGS_KEY = 'overlord.defaultBranch';
const PROJECT_PRE_LAUNCH_COMMANDS_SETTINGS_KEY = 'overlord.preLaunchCommands';
const PROJECT_LAUNCH_ENV_VARS_SETTINGS_KEY = 'overlord.launchEnvVars';

function readProjectStringSetting(settingsJson: string, key: string): string | null {
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function readProjectColor(settingsJson: string): string | null {
  return readProjectStringSetting(settingsJson, PROJECT_COLOR_SETTINGS_KEY);
}

// The project-configured base/parent branch for mission branches. `null` means
// "not configured"; callers fall back to the repo default (`main`).
function readProjectDefaultBranch(settingsJson: string): string | null {
  return readProjectStringSetting(settingsJson, PROJECT_DEFAULT_BRANCH_SETTINGS_KEY);
}

// Normalize an unknown settings value to a clean `string[]` of non-empty,
// trimmed command lines. Anything that is not an array of strings yields `[]`.
function normalizePreLaunchCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const commands: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) commands.push(entry.trim());
  }
  return commands;
}

// Normalize an unknown settings value to a clean `Record<string, string>` of
// launch env vars. Keys are trimmed and blank keys dropped; values are coerced
// to strings and preserved verbatim (an empty value is legitimate).
function normalizeLaunchEnvVars(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const vars: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (typeof rawValue === 'string') vars[key] = rawValue;
  }
  return vars;
}

// The project's configured pre-launch command lines (see
// `ProjectDto.preLaunchCommands`). Exported for the Runner Layer, which reads
// them directly from a claimed request's project settings row.
export function readProjectPreLaunchCommands(settingsJson: string): string[] {
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    return normalizePreLaunchCommands(parsed[PROJECT_PRE_LAUNCH_COMMANDS_SETTINGS_KEY]);
  } catch {
    return [];
  }
}

// The project's configured launch environment variables (see
// `ProjectDto.launchEnvVars`). Exported for the Runner Layer, which reads them
// directly from a claimed request's project settings row.
export function readProjectLaunchEnvVars(settingsJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    return normalizeLaunchEnvVars(parsed[PROJECT_LAUNCH_ENV_VARS_SETTINGS_KEY]);
  } catch {
    return {};
  }
}

// Conservative branch-name validation for the user-entered default branch. The
// authoritative check (`git check-ref-format`) happens in the Runner Layer when
// it actually cuts/operates on the branch; this just rejects obviously invalid
// input at the REST boundary (whitespace, control chars, and the characters git
// forbids in ref names).
function isValidBranchName(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (/[\s~^:?*[\\]/.test(branch)) return false;
  if (branch.includes('..') || branch.includes('@{')) return false;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.lock')) return false;
  if (branch.startsWith('-') || branch.startsWith('.')) return false;
  return true;
}

function buildProjectSettingsJson({ color }: { color?: string }): string {
  if (!color) return '{}';
  return JSON.stringify({ [PROJECT_COLOR_SETTINGS_KEY]: color });
}

function mergeProjectSettingsJson(
  existingJson: string,
  updates: {
    color?: string | null;
    defaultBranch?: string | null;
    preLaunchCommands?: string[];
    launchEnvVars?: Record<string, string>;
  }
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(existingJson) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  if (updates.color !== undefined) {
    if (updates.color) {
      parsed[PROJECT_COLOR_SETTINGS_KEY] = updates.color;
    } else {
      delete parsed[PROJECT_COLOR_SETTINGS_KEY];
    }
  }
  if (updates.defaultBranch !== undefined) {
    if (updates.defaultBranch) {
      parsed[PROJECT_DEFAULT_BRANCH_SETTINGS_KEY] = updates.defaultBranch;
    } else {
      delete parsed[PROJECT_DEFAULT_BRANCH_SETTINGS_KEY];
    }
  }
  if (updates.preLaunchCommands !== undefined) {
    if (updates.preLaunchCommands.length > 0) {
      parsed[PROJECT_PRE_LAUNCH_COMMANDS_SETTINGS_KEY] = updates.preLaunchCommands;
    } else {
      delete parsed[PROJECT_PRE_LAUNCH_COMMANDS_SETTINGS_KEY];
    }
  }
  if (updates.launchEnvVars !== undefined) {
    if (Object.keys(updates.launchEnvVars).length > 0) {
      parsed[PROJECT_LAUNCH_ENV_VARS_SETTINGS_KEY] = updates.launchEnvVars;
    } else {
      delete parsed[PROJECT_LAUNCH_ENV_VARS_SETTINGS_KEY];
    }
  }
  return JSON.stringify(parsed);
}

interface ProjectStatusRow {
  id: string;
  workspace_id: string;
  project_id: string;
  key: string;
  name: string;
  type: string;
  position: number;
  is_default: number;
  is_terminal: number;
  revision: number;
}

const STATUS_TYPES: StatusType[] = [
  'draft',
  'next',
  'execute',
  'review',
  'complete',
  'blocked',
  'cancelled'
];

function assertValidStatusType(type: string): StatusType {
  if (!STATUS_TYPES.includes(type as StatusType)) {
    throw new ApiError(400, 'Invalid status type');
  }
  return type as StatusType;
}

function isTerminalStatusType(type: StatusType): boolean {
  return type === 'complete' || type === 'cancelled';
}

async function uniqueStatusKey(
  db: DatabaseClient,
  { name, projectId }: { name: string; projectId: string }
): Promise<string> {
  const base = slugify(name).replace(/-/g, '_');
  let key = base;
  let suffix = 2;
  while (
    await db.get(`SELECT 1 FROM project_statuses WHERE project_id = ? AND key = ?`, [
      projectId,
      key
    ])
  ) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  return key;
}

async function getProjectStatusRow(
  db: DatabaseClient,
  statusId: string,
  projectId: string
): Promise<ProjectStatusRow> {
  const row = (await db.get(
    `SELECT id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, revision
         FROM project_statuses
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [statusId, projectId]
  )) as ProjectStatusRow | undefined;
  if (!row) throw new ApiError(404, 'Status not found');
  return row;
}

async function assertUniqueStatusName(
  db: DatabaseClient,
  {
    name,
    excludeStatusId,
    projectId
  }: {
    name: string;
    excludeStatusId?: string;
    projectId: string;
  }
): Promise<void> {
  const existing = await db.get(
    `SELECT 1 FROM project_statuses
        WHERE project_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)
          AND id != ?`,
    [projectId, name, excludeStatusId ?? '']
  );
  if (existing) throw new ApiError(409, `A status named "${name}" already exists`);
}

async function countActiveStatusesByType(
  db: DatabaseClient,
  { type, projectId }: { type: string; projectId: string }
): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) AS count FROM project_statuses
        WHERE project_id = ? AND type = ? AND deleted_at IS NULL`,
    [projectId, type]
  )) as { count: number };
  return row.count;
}

async function countMissionsOnStatus(db: DatabaseClient, statusId: string): Promise<number> {
  const row = (await db.get(
    `SELECT COUNT(*) AS count FROM missions WHERE status_id = ? AND deleted_at IS NULL`,
    [statusId]
  )) as { count: number };
  return row.count;
}

async function clearProjectDefaultStatuses(
  db: DatabaseClient,
  { now, projectId }: { now: string; projectId: string }
): Promise<void> {
  await db.run(
    `UPDATE project_statuses
        SET is_default = ?, updated_at = ?, revision = revision + 1
      WHERE project_id = ? AND is_default = ? AND deleted_at IS NULL`,
    [bindBool(DATABASE_DIALECT, false), now, projectId, bindBool(DATABASE_DIALECT, true)]
  );
}

interface ProjectResourceRow {
  id: string;
  workspace_id: string;
  project_id: string;
  resource_key: string;
  label: string | null;
  is_primary: number;
  access_mode: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  revision: number;
}

interface ProjectResourceSourceRow {
  id: string;
  resource_id: string;
  execution_target_id: string | null;
  source_kind: string;
  descriptor_json: string;
  observed_revision: string | null;
  observed_content_digest: string | null;
}

function sourcePath(source: ProjectResourceSourceRow | null | undefined): string {
  if (!source || source.source_kind !== 'local_checkout') return '';
  try {
    const value = (JSON.parse(source.descriptor_json) as { path?: unknown }).path;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function toSourceDto(source: ProjectResourceSourceRow) {
  let descriptor: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(source.descriptor_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) descriptor = parsed;
  } catch {
    descriptor = {};
  }
  const rawLaunchDefaults = descriptor.launchDefaults;
  const launchDefaults: Record<
    string,
    { preCommand: string; flags: ReturnType<typeof normalizeAgentLaunchFlags> }
  > = {};
  if (
    rawLaunchDefaults &&
    typeof rawLaunchDefaults === 'object' &&
    !Array.isArray(rawLaunchDefaults)
  ) {
    for (const [agentKey, value] of Object.entries(rawLaunchDefaults)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const config = value as { preCommand?: unknown; flags?: unknown };
      launchDefaults[agentKey] = {
        preCommand: typeof config.preCommand === 'string' ? config.preCommand : '',
        flags: normalizeAgentLaunchFlags(config.flags)
      };
    }
  }
  return {
    id: source.id,
    executionTargetId: source.execution_target_id,
    sourceKind: source.source_kind,
    descriptor,
    launchDefaults,
    observedRevision: source.observed_revision,
    observedContentDigest: source.observed_content_digest
  };
}

interface MissionRow {
  id: string;
  workspace_id: string;
  project_id: string;
  display_id: string;
  sequence_number: number;
  title: string;
  status_id: string;
  status_type: string;
  board_position: number;
  priority: string | null;
  assigned_workspace_user_id: string | null;
  notes_text: string | null;
  schedule_id: string | null;
  due_datetime: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  active_branch: string | null;
  branch_override: string | null;
  worktree_preference: string | null;
  allow_parallel_objectives?: unknown;
  objective_count: number;
  completed_objective_count: number;
  has_executing_objective: number;
  has_completed_objective: number;
  has_pending_objective_with_instructions: number;
  has_unseen_blocking_question: number;
  has_unseen_returned_to_execute: number;
  draft_objective_resource_key: string | null;
  created_by_kind: string | null;
  created_by_agent: string | null;
  created_by_workspace_user_id: string | null;
  /**
   * Only selected by `selectMissionsSql`, which the detail read goes through.
   * The search and My Missions projections omit it: nothing renders
   * `createdFrom` on a card, and resolving it would cost a join per row.
   */
  created_by_session_id?: string | null;
}

interface ObjectiveRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  position: number;
  title: string | null;
  instruction_text: string;
  state: string;
  auto_advance: number;
  assigned_agent: string | null;
  model: string | null;
  reasoning_effort: string | null;
  resource_key: string | null;
  launch_config_json: string | null;
  created_at: string;
  updated_at: string;
  launched_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  revision: number;
  branch: string | null;
  external_session_id?: string | null;
  display_key: string;
  mission_display_id?: string;
  created_by_kind: string | null;
  created_by_agent: string | null;
  created_by_workspace_user_id: string | null;
  queue_entry_id?: string | null;
  queue_id?: string | null;
  queue_name?: string | null;
  queue_position?: number | null;
  queue_state?: string | null;
  queue_blocked_reason?: string | null;
  queue_waiting_reason?: string | null;
  queue_waiting_on_objective_id?: string | null;
  queue_waiting_on_objective_display_key?: string | null;
  queue_attempt_count?: number | null;
}

// ---- serializers ---------------------------------------------------------

function orderByLabelAsc(column: string): string {
  return DATABASE_DIALECT === 'sqlite' ? `${column} COLLATE NOCASE ASC` : `LOWER(${column}) ASC`;
}

function toProjectDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    color: readProjectColor(r.settings_json),
    defaultBranch: readProjectDefaultBranch(r.settings_json),
    status: r.status as ProjectDto['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
    missionCount: r.mission_count,
    position: r.position ?? 0,
    preLaunchCommands: readProjectPreLaunchCommands(r.settings_json),
    launchEnvVars: readProjectLaunchEnvVars(r.settings_json)
  };
}

function toStatusDto(r: ProjectStatusRow): ProjectStatusDto {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    key: r.key,
    name: r.name,
    type: r.type as StatusType,
    position: r.position,
    isDefault: isTruthyFlag(r.is_default),
    isTerminal: isTruthyFlag(r.is_terminal)
  };
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1;
}

async function toProjectResourceDto(
  r: ProjectResourceRow,
  observationsByResourceId: Map<string, TargetResourceObservationRow> = new Map(),
  sources: ProjectResourceSourceRow[] = []
): Promise<ProjectResourceDto> {
  const source = sources.find(item => item.source_kind === 'local_checkout') ?? sources[0] ?? null;
  const merged = mergeResourceStatusWithObservation({
    lifecycleStatus: r.status,
    resourceExecutionTargetId: source?.execution_target_id ?? null,
    observation: observationsByResourceId.get(r.id)
  });
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    executionTargetId: source?.execution_target_id ?? null,
    resourceKey: r.resource_key,
    type: (source?.source_kind === 'local_checkout'
      ? 'local_directory'
      : (source?.source_kind ?? 'remote_directory')) as ProjectResourceDto['type'],
    label: r.label,
    path: sourcePath(source),
    isPrimary: isTruthyFlag(r.is_primary),
    accessMode: isTruthyFlag(r.is_primary)
      ? 'read_write'
      : r.access_mode === 'read'
        ? 'read'
        : 'read_write',
    status: merged.status as ProjectResourceDto['status'],
    observedAt: merged.observedAt,
    observationSource: merged.observedAt ? 'client' : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
    sources: sources.map(toSourceDto)
  };
}

async function executionTargetBelongsToWorkspace(
  db: DatabaseClient,
  executionTargetId: string,
  workspaceId: string
): Promise<boolean> {
  const row = (await db.get(
    `SELECT id FROM execution_targets
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [executionTargetId, workspaceId]
  )) as { id: string } | undefined;
  return Boolean(row);
}

/**
 * Resolve the execution target a `local_checkout` source belongs to (contract v39).
 *
 * An explicit id names an already-declared target and creates nothing — that is how
 * an ordinary browser edits a source for a target someone else declared. Omitting it
 * means "the machine I am calling from holds this path", which is the second and only
 * other declaration act; it requires a real machine-local identity and is refused with
 * `no_execution_target_registered` otherwise, rather than inferring a target from the
 * caller. Git/URL sources never reach here: they are project-global by construction.
 */
async function resolveResourceExecutionTargetId(
  db: DatabaseClient,
  workspaceId: string,
  executionTargetId: string | null | undefined
): Promise<string | null> {
  if (executionTargetId === undefined) {
    const workspaceUserId = await requireWorkspacePermission({
      workspaceId,
      permission: PERMISSIONS.PROJECT_UPDATE,
      db,
      notFoundMessage: 'Project not found'
    });
    const ctx = await buildWebappServiceContextForWorkspace(workspaceId, db, workspaceUserId);
    try {
      return (await declareActingDeviceTarget({ ctx, declaration: 'local_checkout_link' }))
        .executionTargetId;
    } catch (error) {
      if (error instanceof ServiceError && error.code === NO_EXECUTION_TARGET_REGISTERED) {
        throw new ApiError(
          error.status,
          `${error.message} To link a directory from a browser, choose an execution target that already exists; otherwise run the link from that machine's CLI or desktop app.`,
          undefined,
          error.code
        );
      }
      throw error;
    }
  }

  if (executionTargetId === null) return null;

  const trimmed = executionTargetId.trim();
  if (!trimmed) return null;
  if (!(await executionTargetBelongsToWorkspace(db, trimmed, workspaceId))) {
    throw new ApiError(404, 'Execution target not found');
  }
  return trimmed;
}

async function getProjectResourceRow(
  db: DatabaseClient,
  projectId: string,
  resourceId: string,
  permission: Permission = PERMISSIONS.PROJECT_READ
): Promise<ProjectResourceRow> {
  await getProject(projectId, db, permission);
  const row = (await db.get(
    `SELECT id, workspace_id, project_id, resource_key, label,
              is_primary, access_mode, status, created_at, updated_at, revision
         FROM project_resources
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [resourceId, projectId]
  )) as ProjectResourceRow | undefined;
  if (!row) throw new ApiError(404, 'Resource not found');
  return row;
}

async function clearPrimaryResourcesForTarget(
  db: DatabaseClient,
  {
    projectId,
    now
  }: {
    projectId: string;
    now: string;
  }
): Promise<void> {
  await db.run(
    `UPDATE project_resources
      SET is_primary = ?, updated_at = ?, revision = revision + 1
    WHERE project_id = ? AND deleted_at IS NULL AND is_primary = ?`,
    [bindBool(DATABASE_DIALECT, false), now, projectId, bindBool(DATABASE_DIALECT, true)]
  );
}

async function promoteFallbackPrimary(
  db: DatabaseClient,
  {
    projectId,
    now
  }: {
    projectId: string;
    now: string;
  }
): Promise<void> {
  const primary = (await db.get(
    `SELECT id FROM project_resources
      WHERE project_id = ? AND deleted_at IS NULL AND is_primary = ? LIMIT 1`,
    [projectId, bindBool(DATABASE_DIALECT, true)]
  )) as { id: string } | undefined;
  if (primary) return;

  const fallback = (await db.get(
    `SELECT id FROM project_resources
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [projectId]
  )) as { id: string } | undefined;
  if (!fallback) return;

  await db.run(
    `UPDATE project_resources
        SET is_primary = ?, updated_at = ?, revision = revision + 1
      WHERE id = ?`,
    [bindBool(DATABASE_DIALECT, true), now, fallback.id]
  );
}

// `created_by_kind` is NOT NULL in both tables, so the null branch only fires
// for a projection that did not select the column. Falling back to 'human'
// keeps `createdByKind` non-optional on the wire, which is what lets every
// client render provenance without a null branch. Biasing an unknown value to
// 'human' is also the safe direction: it under-claims rather than misattributes.
function toCreatedByKind(value: string | null | undefined): CreatedByKind {
  return value === 'agent' || value === 'automation' ? value : 'human';
}

function toMissionDto(r: MissionRow, tags: ProjectTagDto[] = []): MissionDto {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    displayId: r.display_id,
    sequenceNumber: r.sequence_number,
    title: r.title,
    statusId: r.status_id,
    statusType: r.status_type as StatusType,
    boardPosition: r.board_position,
    priority: r.priority as MissionDto['priority'],
    assignedWorkspaceUserId: r.assigned_workspace_user_id,
    notes: r.notes_text,
    scheduleId: r.schedule_id,
    dueDatetime: r.due_datetime,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    revision: r.revision,
    objectiveCount: r.objective_count,
    completedObjectiveCount: r.completed_objective_count,
    hasExecutingObjective: r.has_executing_objective === 1,
    hasCompletedObjective: r.has_completed_objective === 1,
    hasPendingObjectiveWithInstructions: r.has_pending_objective_with_instructions === 1,
    hasUnseenBlockingQuestion: r.has_unseen_blocking_question === 1,
    hasUnseenReturnedToExecute: r.has_unseen_returned_to_execute === 1,
    allowParallelObjectives: isTruthyFlag(r.allow_parallel_objectives),
    draftObjectiveResourceKey: r.draft_objective_resource_key?.trim() || null,
    tags,
    createdByKind: toCreatedByKind(r.created_by_kind),
    createdByAgent: r.created_by_agent ?? null,
    createdByWorkspaceUserId: r.created_by_workspace_user_id ?? null
  };
}

// Derives the mission-panel branch status from the real git state in the project's
// primary worktree. `active_branch` being set means a branch was prepared, so the
// floor is `created`; we upgrade to `published` once a remote ref exists, to
// `merged_unpushed` once the branch has landed in the *local* base but the base
// has not been pushed, and to `merged` once it has landed in the *remote* base.
//
// The `merged` / `merged_unpushed` split is the intermediate the merge-with-parent
// flow needs: Action A advances the local parent to contain the branch (→
// `merged_unpushed`); Action B pushes that parent to origin (→ `merged`). The
// flow uses a `--no-ff` merge commit on the parent precisely so the parent tip
// diverges from the branch tip, keeping this derivation unambiguous (a plain
// fast-forward would leave parent and branch tips identical and indistinguishable
// from a freshly-cut branch — see CONTRACT.md branch status derivation).
async function deriveBranchStatus(_input: {
  projectId: string;
  branchName: string;
  baseBranch: string | null;
  executionTargetId?: string | null;
}): Promise<'created' | 'published' | 'merged_unpushed' | 'merged'> {
  // Live git status is observed on the client via the desktop bridge (WS-F2/F3).
  return 'created';
}

async function getProjectSlug(projectId: string, workspaceId: string): Promise<string> {
  const row = (await requireDatabaseClient().get(
    `SELECT slug FROM projects WHERE id = ? AND workspace_id = ?`,
    [projectId, workspaceId]
  )) as { slug: string } | undefined;
  return row?.slug ?? 'project';
}

// The fallback base/parent branch when neither project configuration nor an
// inspectable primary checkout can provide one.
const FALLBACK_BASE_BRANCH = 'main';

async function primaryCheckoutBranch(
  _projectId: string,
  _executionTargetId?: string | null
): Promise<string | null> {
  return null;
}

// Resolves the base/parent branch for new mission branches: the project-
// configured default branch (Resources settings) when set, otherwise the branch
// checked out in the project's primary/main worktree, otherwise `main`.
async function resolveProjectBaseBranch(
  projectId: string,
  workspaceId: string,
  executionTargetId?: string | null
): Promise<string> {
  const row = (await requireDatabaseClient().get(
    `SELECT settings_json FROM projects WHERE id = ? AND workspace_id = ?`,
    [projectId, workspaceId]
  )) as { settings_json: string } | undefined;
  return (
    (row && readProjectDefaultBranch(row.settings_json)) ||
    (await primaryCheckoutBranch(projectId, executionTargetId)) ||
    FALLBACK_BASE_BRANCH
  );
}

async function preparedBaseBranch(
  missionId: string,
  workspaceId: string,
  branchName: string
): Promise<string | null> {
  const rows = (await requireDatabaseClient().all(
    `SELECT payload_json FROM mission_events
        WHERE workspace_id = ? AND mission_id = ?
          AND payload_json IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50`,
    [workspaceId, missionId]
  )) as { payload_json: string | null }[];

  for (const row of rows) {
    if (!row.payload_json) continue;
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      let payloadBranch = '';
      if (typeof payload.branchName === 'string') {
        payloadBranch = payload.branchName.trim();
      } else if (typeof payload.branch === 'string') {
        payloadBranch = payload.branch.trim();
      }
      const baseBranch = typeof payload.baseBranch === 'string' ? payload.baseBranch.trim() : '';
      if (payloadBranch === branchName && baseBranch) return baseBranch;
    } catch {
      // Ignore unrelated or legacy event payloads.
    }
  }
  return null;
}

async function resolveMissionBaseBranch({
  projectId,
  missionId,
  workspaceId,
  branchName,
  executionTargetId
}: {
  projectId: string;
  missionId: string;
  workspaceId: string;
  branchName: string;
  executionTargetId?: string | null;
}): Promise<string> {
  return (
    (await preparedBaseBranch(missionId, workspaceId, branchName)) ||
    (await resolveProjectBaseBranch(projectId, workspaceId, executionTargetId))
  );
}

// Normalizes the raw `missions.worktree_preference` column to the contract type.
// Unknown values (forward-compat with future modes) read as "inherit" (null).
function parseWorktreePreference(value: string | null): MissionWorktreePreference | null {
  return value === 'worktree' || value === 'branch' ? value : null;
}

// Resolves a mission's effective branch behavior by combining its per-mission
// preference with the acting user's automation default (coo:9). When the
// preference is null the mission inherits the user default (the original
// behavior); `'worktree'`/`'branch'` opt an individual mission in regardless.
async function resolveBranchAutomation(
  preference: MissionWorktreePreference | null,
  ctx: ServiceContext
): Promise<{
  automationEnabled: boolean;
  willPrepareBranch: boolean;
  willUseWorktree: boolean;
}> {
  const { worktreeBranchAutomationEnabled: automationEnabled } =
    await readActorLaunchSessionDefaults({ ctx });
  const willPrepareBranch =
    preference === 'worktree' ||
    preference === 'branch' ||
    (preference === null && automationEnabled);
  const willUseWorktree = preference === 'worktree' || (preference === null && automationEnabled);
  return { automationEnabled, willPrepareBranch, willUseWorktree };
}

// Where a prepared branch actually lives. Worktree-mode missions live in their
// dedicated worktree (the canonical path); branch-only missions are checked out
// in the project's primary repo. Prefer git's view of where the branch is
// checked out, falling back to the canonical worktree path.
async function resolvePreparedWorktreePath({
  fallback
}: {
  projectId: string;
  branchName: string;
  fallback: string;
  executionTargetId?: string | null;
}): Promise<string> {
  return fallback;
}

// Derives the mission-panel branch metadata from `missions.active_branch` (the
// source of truth the runner writes). When it is null no branch has been
// prepared yet, so we surface the planner's predicted name with a pending status.
async function missionBranchDto(row: MissionRow): Promise<MissionBranchDto> {
  const ctx = await buildWebappServiceContextForWorkspace(row.workspace_id);
  const executionTargetId = await resolveProjectExecutionTargetForLaunch({
    ctx,
    projectId: row.project_id
  });
  const projectSlug = await getProjectSlug(row.project_id, row.workspace_id);
  const worktreeRoot = resolveManagedWorktreeRoot();
  const resourceKey = await primaryResourceKey(row.project_id, row.workspace_id, executionTargetId);
  const overrideBranch = row.branch_override?.trim() || null;
  const worktreePreference = parseWorktreePreference(row.worktree_preference);
  const { automationEnabled, willPrepareBranch, willUseWorktree } = await resolveBranchAutomation(
    worktreePreference,
    ctx
  );
  const name = row.active_branch?.trim();
  if (name) {
    const baseBranch = await resolveMissionBaseBranch({
      projectId: row.project_id,
      missionId: row.id,
      workspaceId: row.workspace_id,
      branchName: name,
      executionTargetId
    });
    const canonical = missionWorktreePath({
      worktreeRoot,
      projectSlug,
      resourceKey,
      branch: name
    });
    const worktreePath = await resolvePreparedWorktreePath({
      projectId: row.project_id,
      branchName: name,
      fallback: canonical,
      executionTargetId
    });
    const branch = {
      name,
      baseBranch,
      worktreePath,
      status: await deriveBranchStatus({
        projectId: row.project_id,
        branchName: name,
        baseBranch,
        executionTargetId
      }),
      dirty: false,
      overrideBranch,
      worktreeAutomationEnabled: automationEnabled,
      worktreePreference,
      willPrepareBranch,
      willUseWorktree
    };
    const observations = await loadMissionBranchObservationsForMissions({
      ctx,
      executionTargetId,
      missionIds: [row.id],
      resourceKey
    });
    return mergeMissionBranchObservation({
      controlPlaneBranch: branch,
      observation: observations.get(row.id)
    });
  }

  // No branch prepared yet: preview the name the next launch will use. A pinned
  // override wins over the planner's canonical prediction so the panel reflects
  // exactly what the next launch will prepare.
  const baseBranch = await resolveProjectBaseBranch(
    row.project_id,
    row.workspace_id,
    executionTargetId
  );
  const preview = previewMissionBranch({
    mission: { title: row.title, sequence: row.sequence_number },
    project: { slug: projectSlug },
    resourceKey,
    base: baseBranch,
    worktreeRoot
  });
  const previewName = overrideBranch ?? preview.branch;
  return {
    name: previewName,
    baseBranch: preview.baseBranch,
    worktreePath:
      previewName === preview.branch
        ? preview.worktreePath
        : missionWorktreePath({
            worktreeRoot,
            projectSlug,
            resourceKey,
            branch: previewName
          }),
    status: 'pending',
    // No branch/worktree exists yet, so there is nothing to be dirty.
    dirty: false,
    overrideBranch,
    worktreeAutomationEnabled: automationEnabled,
    worktreePreference,
    willPrepareBranch,
    willUseWorktree
  };
}

// ---- Branch actions (merge with parent / push / publish) -----------------
//
// Git mutations route through the local-target capability provider (WS-D 4).
// The REST layer resolves mission/project paths, then calls
// `performBranchAction` on an in-process provider when co-located.

export type BranchActionName = 'integrate' | 'commit' | 'push_parent' | 'publish';

interface BranchActionContext {
  missionId: string;
  projectId: string;
  /** The mission's own workspace — not necessarily the caller's active one. */
  workspaceId: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  primaryRepoPath: string;
}

async function resolveProjectResourceScopeTargetId(
  projectId: string,
  workspaceId: string
): Promise<string | null> {
  return resolveProjectExecutionTargetForLaunch({
    ctx: await buildWebappServiceContextForWorkspace(workspaceId),
    projectId
  });
}

// Shared scoped lookup behind primaryResource/resourceByKey: rows scoped to the
// resolved execution target beat global (NULL-target) rows, then the primary
// flag and creation order break ties.
async function activeResourceRow({
  projectId,
  workspaceId,
  resourceKey = null,
  executionTargetId
}: {
  projectId: string;
  workspaceId: string;
  resourceKey?: string | null;
  executionTargetId?: string | null;
}): Promise<{ id: string; path: string; resource_key: string } | undefined> {
  const targetId =
    executionTargetId === undefined
      ? await resolveProjectResourceScopeTargetId(projectId, workspaceId)
      : executionTargetId;

  const conditions = [
    'pr.project_id = ?',
    'pr.workspace_id = ?',
    `pr.status = 'active'`,
    'pr.deleted_at IS NULL',
    `prs.source_kind = 'local_checkout'`
  ];
  const params: unknown[] = [projectId, workspaceId];
  if (resourceKey !== null) {
    conditions.push('pr.resource_key = ?');
    params.push(resourceKey);
  }
  const orderBy: string[] = [];
  if (targetId !== null) {
    conditions.push('(prs.execution_target_id = ? OR prs.execution_target_id IS NULL)');
    params.push(targetId);
    orderBy.push('CASE WHEN prs.execution_target_id = ? THEN 0 ELSE 1 END');
    params.push(targetId);
  }
  orderBy.push('pr.is_primary DESC', 'pr.created_at ASC');

  const pathExpression =
    DATABASE_DIALECT === 'postgres'
      ? "prs.descriptor_json->>'path'"
      : "json_extract(prs.descriptor_json, '$.path')";
  return (await requireDatabaseClient().get(
    `SELECT pr.id, ${pathExpression} AS path, pr.resource_key FROM project_resources pr
        JOIN project_resource_sources prs ON prs.resource_id = pr.id AND prs.deleted_at IS NULL
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy.join(', ')}
        LIMIT 1`,
    params
  )) as { id: string; path: string; resource_key: string } | undefined;
}

async function primaryResource(
  projectId: string,
  workspaceId: string,
  executionTargetId?: string | null
): Promise<{ id: string; path: string; resourceKey: string } | null> {
  const row = await activeResourceRow({ projectId, workspaceId, executionTargetId });
  if (!row) return null;
  return {
    id: row.id,
    path: row.path,
    resourceKey: row.resource_key?.trim() || 'project'
  };
}

async function resourceByKey({
  projectId,
  workspaceId,
  resourceKey,
  executionTargetId
}: {
  projectId: string;
  workspaceId: string;
  resourceKey: string;
  executionTargetId?: string | null;
}): Promise<{ id: string; path: string; resourceKey: string } | null> {
  const normalizedKey = resourceKey.trim();
  if (!normalizedKey) return null;
  const row = await activeResourceRow({
    projectId,
    workspaceId,
    resourceKey: normalizedKey,
    executionTargetId
  });
  if (!row) return null;
  return {
    id: row.id,
    path: row.path,
    resourceKey: row.resource_key?.trim() || normalizedKey
  };
}

async function primaryResourceKey(
  projectId: string,
  workspaceId: string,
  executionTargetId?: string | null
): Promise<string> {
  return (
    (await primaryResource(projectId, workspaceId, executionTargetId))?.resourceKey ?? 'project'
  );
}

async function loadBranchActionContext(
  missionRef: string,
  options: { resourceKey?: unknown } = {}
): Promise<BranchActionContext> {
  const row = await getMissionRow(missionRef, undefined, PERMISSIONS.MISSION_UPDATE);
  const branchName = row.active_branch?.trim();
  if (!branchName) {
    throw new ApiError(
      409,
      'No branch has been prepared for this mission yet.',
      undefined,
      'BRANCH_NOT_PREPARED'
    );
  }
  const executionTargetId = await resolveProjectResourceScopeTargetId(
    row.project_id,
    row.workspace_id
  );
  const explicitKey = typeof options.resourceKey === 'string' ? options.resourceKey.trim() : '';
  const resource = explicitKey
    ? await resourceByKey({
        projectId: row.project_id,
        workspaceId: row.workspace_id,
        resourceKey: explicitKey,
        executionTargetId
      })
    : await primaryResource(row.project_id, row.workspace_id, executionTargetId);
  if (!resource) {
    throw new ApiError(
      409,
      explicitKey
        ? `Project resource key "${explicitKey}" is not connected on this device.`
        : 'This project has no connected primary working directory on this device.',
      undefined,
      explicitKey ? 'BRANCH_RESOURCE_NOT_CONNECTED' : 'BRANCH_NO_PRIMARY'
    );
  }
  const projectSlug = await getProjectSlug(row.project_id, row.workspace_id);
  const worktreeRoot = resolveManagedWorktreeRoot();
  const canonicalWorktree = missionWorktreePath({
    worktreeRoot,
    projectSlug,
    resourceKey: resource.resourceKey,
    branch: branchName
  });
  return {
    missionId: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    branchName,
    baseBranch: await resolveMissionBaseBranch({
      projectId: row.project_id,
      missionId: row.id,
      workspaceId: row.workspace_id,
      branchName,
      executionTargetId
    }),
    worktreePath: await resolvePreparedWorktreePath({
      projectId: row.project_id,
      branchName,
      fallback: canonicalWorktree,
      executionTargetId
    }),
    primaryRepoPath: resource.path
  };
}

async function missionHasActiveExecution(missionId: string, workspaceId: string): Promise<boolean> {
  return Boolean(
    await requireDatabaseClient().get(
      `SELECT 1 FROM execution_requests
          WHERE mission_id = ? AND workspace_id = ?
            AND status IN ('queued', 'claimed', 'launching')
          LIMIT 1`,
      [missionId, workspaceId]
    )
  );
}

async function recordBranchActionActivity(
  ctx: BranchActionContext,
  summary: string
): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const mission = (await tx.get(
      `SELECT revision FROM missions WHERE id = ? AND workspace_id = ?`,
      [ctx.missionId, ctx.workspaceId]
    )) as { revision: number } | undefined;
    const now = nowIso();
    // Attribute the change to the caller's membership in the mission's own
    // workspace — the request-level actor id belongs to the active workspace.
    const profileId = await resolveActiveProfileId(tx);
    const actorWorkspaceUserId = profileId
      ? await findActiveMembershipId(ctx.workspaceId, profileId, tx)
      : null;
    if (mission) {
      const revision = mission.revision + 1;
      await tx.run(
        `UPDATE missions SET updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [now, revision, ctx.missionId, ctx.workspaceId]
      );
      await recordChange(
        {
          entityType: 'mission',
          entityId: ctx.missionId,
          operation: 'update',
          entityRevision: revision,
          projectId: ctx.projectId,
          missionId: ctx.missionId,
          workspaceId: ctx.workspaceId,
          actorWorkspaceUserId,
          changedFields: ['updated_at']
        },
        tx
      );
    }
    await tx.run(
      `INSERT INTO mission_events
       (id, workspace_id, project_id, mission_id, objective_id, type, phase, summary,
        payload_json, source, actor_workspace_user_id, created_at)
     VALUES (?, ?, ?, ?, NULL, 'update', 'execute', ?, ?, 'webapp', ?, ?)`,
      [
        newId(),
        ctx.workspaceId,
        ctx.projectId,
        ctx.missionId,
        summary,
        JSON.stringify({ branch: ctx.branchName, baseBranch: ctx.baseBranch }),
        actorWorkspaceUserId,
        now
      ]
    );
  });
}

// Runs an on-demand branch mutation and returns the refreshed mission detail.
// Git side-effects happen first (and throw typed ApiErrors on failure); only on
// success do we record the activity + realtime change in a single transaction.
export async function performBranchAction(
  missionRef: string,
  body: {
    action?: unknown;
    message?: unknown;
    confirmBusy?: unknown;
    clientExecuted?: unknown;
    summary?: unknown;
    resourceKey?: unknown;
  }
): Promise<MissionDetailDto> {
  const action = String(body.action ?? '') as BranchActionName;
  if (
    action !== 'integrate' &&
    action !== 'commit' &&
    action !== 'push_parent' &&
    action !== 'publish'
  ) {
    throw new ApiError(400, 'Invalid branch action.');
  }
  const ctx = await loadBranchActionContext(missionRef, { resourceKey: body.resourceKey });
  if (
    body.confirmBusy !== true &&
    (await missionHasActiveExecution(ctx.missionId, ctx.workspaceId))
  ) {
    throw new ApiError(
      409,
      'An objective is currently executing on this branch. Continuing may conflict with in-progress work in its worktree.',
      'Re-run with confirmation to proceed anyway.',
      'BRANCH_BUSY_EXECUTING'
    );
  }

  if (body.clientExecuted === true) {
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!summary) {
      throw new ApiError(400, 'A branch-action summary is required when clientExecuted is true.');
    }
    await recordBranchActionActivity(ctx, summary);
    return getMissionDetail(ctx.missionId);
  }

  // One resolution, no transport branch: the registry hands back the runner-queue
  // transport for a reachable target and a typed unavailable provider otherwise.
  // The wait is deliberately short — the job outlives it, and a `LOCAL_TARGET_TIMEOUT`
  // just means "still running on that machine", which the refreshed mission
  // detail already reflects once the runner reports.
  const provider = await resolveProjectLocalTargetProvider({
    ctx: await buildWebappServiceContextForWorkspace(ctx.workspaceId),
    projectId: ctx.projectId,
    missionId: ctx.missionId,
    writeTimeoutMs: BRANCH_ACTION_WAIT_MS
  });
  const result = await provider.performBranchAction({
    action,
    branchName: ctx.branchName,
    baseBranch: ctx.baseBranch,
    worktreePath: ctx.worktreePath,
    primaryRepoPath: ctx.primaryRepoPath,
    ...(typeof body.message === 'string' ? { message: body.message } : {})
  });
  // A timeout is not a failure: the runner still holds the job, and its
  // completion report will record the branch activity whenever it lands.
  if (!result.ok && result.code !== 'LOCAL_TARGET_TIMEOUT') {
    throwLocalTargetCapabilityFailure(result);
  }
  // Branch activity is recorded by the runner's completion report, not here, so
  // a result that arrives after this response still lands on the timeline.
  return getMissionDetail(ctx.missionId);
}

/**
 * Drafts a commit message for the uncommitted changes in a mission branch's
 * worktree via the Automations Layer (Gemini). Gathers the diff through the
 * local-target provider, then summarizes it on the backend. Does not persist
 * anything — the client drops the draft into the editable commit field. Throws
 * typed errors when no work exists or the summarizer is unavailable so the UI
 * can explain why no draft appeared.
 */
export async function generateCommitMessage(
  missionRef: string,
  body: { diff?: unknown } = {}
): Promise<GenerateCommitMessageResultDto> {
  await loadBranchActionContext(missionRef);
  const diff = typeof body.diff === 'string' ? body.diff.trim() : '';
  if (!diff) {
    throwCheckoutLocalRequired();
  }

  const message = await generateCommitMessageFromDiff({ diff, env: process.env });
  if (!message) {
    throw new ApiError(
      502,
      'Failed to draft a commit message. Check that the AI summarizer is configured.',
      undefined,
      'COMMIT_MESSAGE_GENERATION_FAILED'
    );
  }
  return { message };
}

// ---- Branch selection (available branches for a mission) ------------------
//
// Powers the mission panel's branch selector: when the planner's default branch
// is wrong, the user picks any existing branch in the project's primary repo and
// pins it as the mission's `branch_override` (consumed by the Runner Layer at the
// next launch). We list real refs so the choice is always valid.

// Returns the mission's current/pinned branch from metadata. Full ref lists come
// from the desktop local-target bridge (WS-F3).
export async function listMissionBranches(missionRef: string): Promise<MissionBranchListDto> {
  const row = await getMissionRow(missionRef);
  const current = row.active_branch?.trim() || row.branch_override?.trim() || null;
  return { branches: current ? [current] : [], current };
}

// ---- Worktree management (Settings → Worktrees) --------------------------
//
// Listing and git mutations run on the client via the desktop bridge (WS-F3).
// The control plane only acknowledges client-executed removals.

export async function listWorktrees(): Promise<WorktreeDto[]> {
  return [];
}

// Removes a single worktree by path. Refuses a dirty worktree unless `force`,
// returning a typed error so the UI can warn before destroying uncommitted work.
export async function removeWorktree(body: RemoveWorktreeBody): Promise<PurgeWorktreesResultDto> {
  const target = typeof body.path === 'string' ? path.resolve(body.path.trim()) : '';
  if (!target) throw new ApiError(400, 'A worktree path is required.');

  if (body.clientExecuted === true) {
    const primaryRepoPath =
      typeof body.primaryRepoPath === 'string' ? body.primaryRepoPath.trim() : '';
    if (!primaryRepoPath) {
      throw new ApiError(400, 'primaryRepoPath is required when clientExecuted is true.');
    }
    return {
      removed: [target],
      skipped: [],
      worktrees: []
    };
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (projectId) {
    const scope = await requireProjectPermission({
      projectId,
      permission: PERMISSIONS.PROJECT_UPDATE
    });
    const provider = await resolveProjectLocalTargetProvider({
      ctx: await buildWebappServiceContextForWorkspace(
        scope.workspaceId,
        undefined,
        scope.workspaceUserId
      ),
      projectId,
      executionTargetId:
        typeof body.executionTargetId === 'string' ? body.executionTargetId.trim() : null,
      writeTimeoutMs: WORKTREE_MUTATION_WAIT_MS
    });
    // Resolve the provider before validating the payload: when no target can
    // serve this, the answer is "run it locally", not "your body was wrong".
    const primaryRepoPath =
      typeof body.primaryRepoPath === 'string' ? body.primaryRepoPath.trim() : '';
    if (!primaryRepoPath) {
      if (provider instanceof UnavailableProvider) throwCheckoutLocalRequired();
      throw new ApiError(400, 'primaryRepoPath is required to remove a worktree on a target.');
    }
    const result = await provider.removeWorktree({
      path: target,
      primaryRepoPath,
      force: body.force === true
    });
    // Still running on the target: report nothing removed *yet* rather than an
    // error, exactly as the fire-and-forget queue path used to.
    if (!result.ok && result.code === 'LOCAL_TARGET_TIMEOUT') {
      return { removed: [], skipped: [], worktrees: [] };
    }
    if (!result.ok) throwLocalTargetCapabilityFailure(result);
    return { removed: result.value.removed, skipped: result.value.skipped, worktrees: [] };
  }

  throwCheckoutLocalRequired();
}

// Removes every clean, merged worktree in one pass ("Purge all merged"). Dirty
// worktrees are skipped (never force-removed) so in-progress work is preserved.
export async function purgeMergedWorktrees(
  body: {
    projectId?: unknown;
    executionTargetId?: unknown;
    primaryRepoPath?: unknown;
    worktreeRoot?: unknown;
  } = {}
): Promise<PurgeWorktreesResultDto> {
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (projectId) {
    const scope = await requireProjectPermission({
      projectId,
      permission: PERMISSIONS.PROJECT_UPDATE
    });
    const provider = await resolveProjectLocalTargetProvider({
      ctx: await buildWebappServiceContextForWorkspace(
        scope.workspaceId,
        undefined,
        scope.workspaceUserId
      ),
      projectId,
      executionTargetId:
        typeof body.executionTargetId === 'string' ? body.executionTargetId.trim() : null,
      writeTimeoutMs: WORKTREE_MUTATION_WAIT_MS
    });
    // Resolve the provider before validating the payload: when no target can
    // serve this, the answer is "run it locally", not "your body was wrong".
    const primaryRepoPath =
      typeof body.primaryRepoPath === 'string' ? body.primaryRepoPath.trim() : '';
    if (!primaryRepoPath) {
      if (provider instanceof UnavailableProvider) throwCheckoutLocalRequired();
      throw new ApiError(400, 'primaryRepoPath is required to purge merged worktrees on a target.');
    }
    // The backend has no filesystem, so it names the repo and lets the target
    // decide both where its managed worktrees live and which are merged and clean.
    const worktreeRoot = typeof body.worktreeRoot === 'string' ? body.worktreeRoot.trim() : '';
    const result = await provider.purgeMergedWorktrees({
      discover: true,
      primaryRepoPath,
      ...(worktreeRoot ? { worktreeRoot } : {})
    });
    if (!result.ok && result.code === 'LOCAL_TARGET_TIMEOUT') {
      return { removed: [], skipped: [], worktrees: [] };
    }
    if (!result.ok) throwLocalTargetCapabilityFailure(result);
    return { removed: result.value.removed, skipped: result.value.skipped, worktrees: [] };
  }

  throwCheckoutLocalRequired();
}

interface ProjectTagRow {
  id: string;
  workspace_id: string;
  project_id: string;
  label: string;
  color: string | null;
  active: boolean | number;
  revision: number;
}

function toProjectTagDto(r: ProjectTagRow): ProjectTagDto {
  return {
    id: r.id,
    projectId: r.project_id,
    label: r.label,
    color: r.color,
    active: isTruthyFlag(r.active)
  };
}

/** Tags assigned to one mission, ordered by label for stable rendering. */
async function getMissionTags(missionId: string): Promise<ProjectTagDto[]> {
  const rows = (await requireDatabaseClient().all(
    `SELECT pt.id, pt.workspace_id, pt.project_id, pt.label, pt.color, pt.active, pt.revision
         FROM mission_tags tt
         JOIN project_tags pt ON pt.id = tt.tag_id AND pt.deleted_at IS NULL
        WHERE tt.mission_id = ?
        ORDER BY ${orderByLabelAsc('pt.label')}`,
    [missionId]
  )) as ProjectTagRow[];
  return rows.map(toProjectTagDto);
}

/**
 * Batch-resolve tags for many missions in one query, returning a map keyed by
 * mission id so board/list reads avoid an N+1 of per-mission tag lookups.
 */
async function getTagsByMission(missionIds: string[]): Promise<Map<string, ProjectTagDto[]>> {
  const byMission = new Map<string, ProjectTagDto[]>();
  if (missionIds.length === 0) return byMission;
  const placeholders = missionIds.map(() => '?').join(', ');
  const rows = (await requireDatabaseClient().all(
    `SELECT tt.mission_id, pt.id, pt.workspace_id, pt.project_id, pt.label, pt.color, pt.active, pt.revision
         FROM mission_tags tt
         JOIN project_tags pt ON pt.id = tt.tag_id AND pt.deleted_at IS NULL
        WHERE tt.mission_id IN (${placeholders})
        ORDER BY ${orderByLabelAsc('pt.label')}`,
    missionIds
  )) as Array<ProjectTagRow & { mission_id: string }>;
  for (const row of rows) {
    const list = byMission.get(row.mission_id) ?? [];
    list.push(toProjectTagDto(row));
    byMission.set(row.mission_id, list);
  }
  return byMission;
}

function toObjectiveDto(r: ObjectiveRow): ObjectiveDto {
  let launchConfigOverrides: Record<
    string,
    Record<string, { preCommand: string; flags: ReturnType<typeof normalizeAgentLaunchFlags> }>
  > = {};
  try {
    const parsed = r.launch_config_json ? (JSON.parse(r.launch_config_json) as unknown) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [targetKey, rawAgents] of Object.entries(parsed)) {
        if (!rawAgents || typeof rawAgents !== 'object' || Array.isArray(rawAgents)) continue;
        const agents: Record<
          string,
          { preCommand: string; flags: ReturnType<typeof normalizeAgentLaunchFlags> }
        > = {};
        for (const [agentKey, rawConfig] of Object.entries(rawAgents)) {
          if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
          const config = rawConfig as { preCommand?: unknown; flags?: unknown };
          agents[agentKey] = {
            preCommand: typeof config.preCommand === 'string' ? config.preCommand : '',
            flags: normalizeAgentLaunchFlags(config.flags)
          };
        }
        if (Object.keys(agents).length > 0) launchConfigOverrides[targetKey] = agents;
      }
    }
  } catch {
    launchConfigOverrides = {};
  }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    missionId: r.mission_id,
    position: r.position,
    title: r.title,
    instructionText: r.instruction_text,
    state: r.state as ObjectiveDto['state'],
    autoAdvance:
      r.queue_entry_id !== undefined ? Boolean(r.queue_entry_id) : isTruthyFlag(r.auto_advance),
    queueEntry:
      r.queue_entry_id &&
      r.queue_id &&
      r.queue_name &&
      typeof r.queue_position === 'number' &&
      r.queue_state
        ? {
            id: r.queue_entry_id,
            queueId: r.queue_id,
            queueName: r.queue_name,
            position: r.queue_position,
            state: r.queue_state as 'waiting' | 'blocked' | 'dispatched' | 'running',
            blockedReason: r.queue_blocked_reason ?? null,
            waitingReason: (r.queue_waiting_reason as RunQueueWaitingReason | null) ?? null,
            waitingOnObjectiveId: r.queue_waiting_on_objective_id ?? null,
            waitingOnObjectiveDisplayId: r.queue_waiting_on_objective_display_key
              ? formatObjectiveDisplayId({
                  missionDisplayId: r.mission_display_id ?? '',
                  displayKey: r.queue_waiting_on_objective_display_key
                })
              : null,
            attemptCount: r.queue_attempt_count ?? 0,
            precededBy: null
          }
        : null,
    assignedAgent: r.assigned_agent,
    model: r.model,
    reasoningEffort: r.reasoning_effort,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    launchedAt: r.launched_at ?? null,
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
    revision: r.revision,
    externalSessionId: r.external_session_id ?? null,
    branch: r.branch ?? null,
    resourceKey: r.resource_key?.trim() || null,
    displayKey: r.display_key,
    displayId: formatObjectiveDisplayId({
      missionDisplayId: r.mission_display_id ?? '',
      displayKey: r.display_key
    }),
    createdByKind: toCreatedByKind(r.created_by_kind),
    createdByAgent: r.created_by_agent ?? null,
    createdByWorkspaceUserId: r.created_by_workspace_user_id ?? null,
    launchConfigOverrides
  };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'project';
}

function deriveProjectResourceKey({
  resourceKey,
  label,
  directoryPath
}: {
  resourceKey?: string | null;
  label?: string | null;
  directoryPath: string;
}): string {
  const explicit = resourceKey?.trim();
  if (explicit) return slugify(explicit);
  const labelKey = label?.trim();
  if (labelKey) return slugify(labelKey);
  return slugify(path.basename(path.resolve(directoryPath)));
}

async function assertObjectiveResourceKeyOnProject(
  db: DatabaseClient,
  projectId: string,
  resourceKey: string | null | undefined
): Promise<string | null> {
  const normalized = resourceKey?.trim() || null;
  if (!normalized) return null;
  const row = (await db.get(
    `SELECT 1 AS ok FROM project_resources
        WHERE project_id = ? AND resource_key = ? AND deleted_at IS NULL
        LIMIT 1`,
    [projectId, normalized]
  )) as { ok: number } | undefined;
  if (!row) {
    throw new ApiError(409, `Project resource key "${normalized}" is not linked to this project.`);
  }
  return normalized;
}

// ---- Projects ------------------------------------------------------------

const selectProjectsSql = `
  SELECT p.*, (
    SELECT COUNT(*) FROM missions t
      WHERE t.project_id = p.id AND t.deleted_at IS NULL
  ) AS mission_count
  FROM projects p
  WHERE p.workspace_id = ? AND p.deleted_at IS NULL
`;

function projectListLifecyclePredicate(lifecycle: ProjectListLifecycle): string {
  return lifecycle === 'all' ? '' : ' AND p.status = ?';
}

function projectListLifecycleParams(lifecycle: ProjectListLifecycle): string[] {
  return lifecycle === 'all' ? [] : [lifecycle];
}

async function callerAuthorizedWorkspaceScopes(
  permission: Permission,
  db: DatabaseClient
): Promise<Array<{ workspaceId: string; workspaceUserId: string }>> {
  // Auth captures this immutable, organization-bounded set once per request.
  // The fallback is for local/background callers without request context and is
  // still constrained to one selected organization.
  const memberships = await callerMembershipsInActiveOrganization(db);
  const checked = await Promise.all(
    memberships.map(async scope => ({ scope, allowed: await actorCan(permission, scope) }))
  );
  return checked.filter(entry => entry.allowed).map(entry => entry.scope);
}

export async function listProjects(
  db: DatabaseClient = requireDatabaseClient(),
  lifecycle: ProjectListLifecycle = 'active'
): Promise<ProjectDto[]> {
  // This is an index, not an active-workspace settings view. A caller can work
  // in every workspace they actively belong to, so aggregate those workspaces
  // explicitly instead of letting the request preference select one tenant.
  const scopes = await callerAuthorizedWorkspaceScopes(PERMISSIONS.PROJECT_READ, db);
  const rows = (
    await Promise.all(
      scopes.map(scope =>
        db.all(
          `${selectProjectsSql}${projectListLifecyclePredicate(lifecycle)} ORDER BY p.status ASC, p.position ASC, p.created_at ASC`,
          [scope.workspaceId, ...projectListLifecycleParams(lifecycle)]
        )
      )
    )
  ).flat() as unknown as ProjectRow[];
  rows.sort(
    (left, right) =>
      left.status.localeCompare(right.status) ||
      (left.position ?? 0) - (right.position ?? 0) ||
      left.created_at.localeCompare(right.created_at)
  );
  return rows.map(toProjectDto);
}

/**
 * Projects of an arbitrary (not necessarily active) workspace, for the
 * sidebar rendering several workspaces of the active organization at once.
 * Membership is validated per target workspace (coo:96 pattern) — the caller
 * must be an active member of `workspaceId`, independent of which workspace
 * happens to be their currently active one.
 */
export async function listProjectsForWorkspace(
  workspaceId: string,
  db: DatabaseClient = requireDatabaseClient(),
  lifecycle: ProjectListLifecycle = 'active'
): Promise<ProjectDto[]> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.PROJECT_READ,
    db,
    notFoundMessage: 'Workspace not found or no active membership'
  });

  const rows = (await db.all(
    `${selectProjectsSql}${projectListLifecyclePredicate(lifecycle)} ORDER BY p.status ASC, p.position ASC, p.created_at ASC`,
    [workspaceId, ...projectListLifecycleParams(lifecycle)]
  )) as ProjectRow[];
  return rows.map(toProjectDto);
}

export async function getProject(
  id: string,
  db: DatabaseClient = requireDatabaseClient(),
  permission: Permission = PERMISSIONS.PROJECT_READ
): Promise<ProjectDto> {
  const { workspaceId } = await requireProjectPermission({
    projectId: id,
    permission,
    db
  });
  const row = (await db.get(`${selectProjectsSql} AND p.id = ?`, [workspaceId, id])) as
    | ProjectRow
    | undefined;
  if (!row) throw new ApiError(404, 'Project not found');
  return toProjectDto(row);
}

export async function reorderProjects(body: ReorderProjectsBody): Promise<ProjectDto[]> {
  return requireDatabaseClient().transaction(async tx => {
    const orderedIds = body.orderedProjectIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new ApiError(400, 'orderedProjectIds is required');
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new ApiError(400, 'orderedProjectIds contains duplicates');
    }

    const workspaceRows = (await tx.all(
      `SELECT id, workspace_id FROM projects
         WHERE id IN (${orderedIds.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
      orderedIds
    )) as Array<{ id: string; workspace_id: string }>;
    if (workspaceRows.length !== orderedIds.length) {
      throw new ApiError(400, 'Unknown project in reorder list');
    }
    const workspaceIds = new Set(workspaceRows.map(row => row.workspace_id));
    if (workspaceIds.size !== 1) {
      throw new ApiError(400, 'All projects in a reorder must belong to the same workspace');
    }
    const workspaceId = [...workspaceIds][0]!;
    await requireWorkspacePermission({
      workspaceId,
      permission: PERMISSIONS.PROJECT_UPDATE,
      db: tx,
      notFoundMessage: 'Project not found'
    });

    const current = (await tx.all(
      `SELECT id, position, revision
         FROM projects
        WHERE workspace_id = ? AND deleted_at IS NULL`,
      [workspaceId]
    )) as Array<{ id: string; position: number | null; revision: number }>;
    if (orderedIds.length !== current.length) {
      throw new ApiError(400, 'orderedProjectIds must include every project');
    }

    const currentIds = new Set(current.map(project => project.id));
    for (const id of orderedIds) {
      if (!currentIds.has(id)) {
        throw new ApiError(400, 'Unknown project in reorder list');
      }
    }

    const currentById = new Map(current.map(project => [project.id, project]));
    const updates = orderedIds
      .map((id, index) => {
        const existing = currentById.get(id);
        if (!existing) {
          throw new ApiError(400, 'Unknown project in reorder list');
        }
        return {
          id,
          position: index + 1,
          existing
        };
      })
      .filter(({ existing, position }) => existing.position !== position);
    if (updates.length === 0) {
      return listProjectsForWorkspace(workspaceId, tx);
    }

    const now = nowIso();
    const maxPosition = Math.max(...current.map(project => project.position ?? 0), 0);
    const tempBase = maxPosition + updates.length + 1;

    // Move changed rows out of the active range first so swaps never collide
    // with the workspace+position unique index mid-transaction.
    for (const [index, { id }] of updates.entries()) {
      await tx.run(
        `UPDATE projects
            SET position = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [tempBase + index, now, id, workspaceId]
      );
    }

    for (const { id, position, existing } of updates) {
      const revision = existing.revision + 1;
      await tx.run(
        `UPDATE projects
            SET position = ?, updated_at = ?, revision = ?
          WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [position, now, revision, id, workspaceId]
      );
      await recordChange(
        {
          entityType: 'project',
          entityId: id,
          operation: 'update',
          entityRevision: revision,
          changedFields: ['position'],
          projectId: id,
          workspaceId
        },
        tx
      );
    }

    return listProjectsForWorkspace(workspaceId, tx);
  });
}

async function selectProjectStatuses(
  projectId: string,
  db: DatabaseClient = requireDatabaseClient()
): Promise<ProjectStatusDto[]> {
  const rows = (await db.all(
    `SELECT id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, revision
         FROM project_statuses
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY position ASC`,
    [projectId]
  )) as ProjectStatusRow[];
  return rows.map(toStatusDto);
}

export async function listProjectStatuses(
  projectId: string,
  db: DatabaseClient = requireDatabaseClient()
): Promise<ProjectStatusDto[]> {
  await requireProjectPermission({ projectId, permission: PERMISSIONS.PROJECT_READ, db });
  return selectProjectStatuses(projectId, db);
}

export async function listWorkspaceProjectStatuses(
  workspaceId: string,
  db: DatabaseClient = requireDatabaseClient()
): Promise<ProjectStatusDto[]> {
  await requireWorkspacePermission({
    workspaceId,
    permission: PERMISSIONS.WORKSPACE_READ,
    db,
    notFoundMessage: 'Workspace not found or no active membership'
  });
  const rows = (await db.all(
    `SELECT ps.id, ps.workspace_id, ps.project_id, ps.key, ps.name, ps.type, ps.position,
            ps.is_default, ps.is_terminal, ps.revision
       FROM project_statuses ps
       JOIN projects p ON p.id = ps.project_id AND p.workspace_id = ps.workspace_id
      WHERE ps.workspace_id = ? AND ps.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY p.position ASC, ps.position ASC`,
    [workspaceId]
  )) as ProjectStatusRow[];
  return rows.map(toStatusDto);
}

async function resolveStatusProjectScope(
  db: DatabaseClient,
  projectId: string
): Promise<{ projectId: string; workspaceId: string }> {
  const scope = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.PROJECT_UPDATE,
    db
  });
  return { projectId, workspaceId: scope.workspaceId };
}

export async function createProjectStatus(
  projectId: string,
  body: CreateProjectStatusBody
): Promise<ProjectStatusDto> {
  return requireDatabaseClient().transaction(async tx => {
    const scope = await resolveStatusProjectScope(tx, projectId);
    const name = (body.name ?? '').trim();
    if (!name) throw new ApiError(400, 'Status name is required');
    await assertUniqueStatusName(tx, { name, projectId });

    const type = assertValidStatusType(body.type);
    if (type === 'next' || type === 'execute' || type === 'review') {
      if ((await countActiveStatusesByType(tx, { type, projectId })) > 0) {
        throw new ApiError(409, `This project already has a ${type} status`);
      }
    }

    const isDefault = body.isDefault ?? false;
    if (isDefault && type !== 'draft' && type !== 'next') {
      throw new ApiError(400, 'Only draft- or next-type statuses can be the default');
    }

    const now = nowIso();
    const id = newId();
    const key = await uniqueStatusKey(tx, { name, projectId });
    const maxPos = (await tx.get(
      `SELECT COALESCE(MAX(position), -1) AS max_pos FROM project_statuses
          WHERE project_id = ? AND deleted_at IS NULL`,
      [projectId]
    )) as { max_pos: number };
    const position = maxPos.max_pos + 1;

    if (isDefault) {
      await clearProjectDefaultStatuses(tx, { now, projectId });
    }

    await tx.run(
      `INSERT INTO project_statuses
         (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        scope.workspaceId,
        projectId,
        key,
        name,
        type,
        position,
        bindBool(DATABASE_DIALECT, isDefault),
        bindBool(DATABASE_DIALECT, isTerminalStatusType(type)),
        now,
        now
      ]
    );

    await recordChange(
      {
        workspaceId: scope.workspaceId,
        projectId,
        entityType: 'project_status',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        changedFields: ['name', 'type', 'position', ...(isDefault ? ['is_default'] : [])]
      },
      tx
    );

    return toStatusDto(await getProjectStatusRow(tx, id, projectId));
  });
}

export async function updateProjectStatus(
  projectId: string,
  statusId: string,
  body: UpdateProjectStatusBody
): Promise<ProjectStatusDto> {
  return requireDatabaseClient().transaction(async tx => {
    const scope = await resolveStatusProjectScope(tx, projectId);
    const existing = await getProjectStatusRow(tx, statusId, projectId);
    const changed: string[] = [];
    const now = nowIso();
    const fields: string[] = [];
    const setParams: unknown[] = [];

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new ApiError(400, 'Status name cannot be empty');
      await assertUniqueStatusName(tx, { name, excludeStatusId: statusId, projectId });
      fields.push('name = ?');
      setParams.push(name);
      changed.push('name');
    }

    if (body.isDefault !== undefined) {
      if (body.isDefault) {
        if (existing.type !== 'draft' && existing.type !== 'next') {
          throw new ApiError(400, 'Only draft- or next-type statuses can be the default');
        }
        await clearProjectDefaultStatuses(tx, { now, projectId });
        fields.push('is_default = ?');
        setParams.push(bindBool(DATABASE_DIALECT, true));
        changed.push('is_default');
      } else if (existing.is_default === 1) {
        throw new ApiError(409, 'Choose another status as the default before clearing this one');
      }
    }

    if (fields.length === 0) {
      return toStatusDto(existing);
    }

    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE project_statuses
          SET ${fields.join(', ')}, updated_at = ?, revision = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [...setParams, now, revision, statusId, projectId]
    );

    await recordChange(
      {
        workspaceId: scope.workspaceId,
        projectId,
        entityType: 'project_status',
        entityId: statusId,
        operation: 'update',
        entityRevision: revision,
        changedFields: changed
      },
      tx
    );

    return toStatusDto(await getProjectStatusRow(tx, statusId, projectId));
  });
}

export async function deleteProjectStatus(projectId: string, statusId: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const scope = await resolveStatusProjectScope(tx, projectId);
    const existing = await getProjectStatusRow(tx, statusId, projectId);

    if (existing.type === 'execute' || existing.type === 'review') {
      throw new ApiError(409, 'Cannot remove the required execute or review status');
    }
    if (existing.is_default === 1) {
      throw new ApiError(409, 'Set another status as the default before deleting this one');
    }

    const missionCount = await countMissionsOnStatus(tx, statusId);
    if (missionCount > 0) {
      throw new ApiError(
        409,
        `Cannot delete a status used by ${missionCount} mission(s). Move them first.`
      );
    }

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE project_statuses
        SET deleted_at = ?, updated_at = ?, revision = ?
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, revision, statusId, projectId]
    );

    await recordChange(
      {
        workspaceId: scope.workspaceId,
        projectId,
        entityType: 'project_status',
        entityId: statusId,
        operation: 'delete',
        entityRevision: revision,
        changedFields: ['deleted_at']
      },
      tx
    );
  });
}

export async function reorderProjectStatuses(
  projectId: string,
  body: ReorderProjectStatusesBody
): Promise<ProjectStatusDto[]> {
  return requireDatabaseClient().transaction(async tx => {
    const scope = await resolveStatusProjectScope(tx, projectId);
    const orderedIds = body.orderedStatusIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new ApiError(400, 'orderedStatusIds is required');
    }

    const current = await selectProjectStatuses(projectId, tx);
    if (orderedIds.length !== current.length) {
      throw new ApiError(400, 'orderedStatusIds must include every status');
    }

    const currentIds = new Set(current.map(status => status.id));
    for (const id of orderedIds) {
      if (!currentIds.has(id)) {
        throw new ApiError(400, 'Unknown status in reorder list');
      }
    }

    const now = nowIso();
    for (const [position, id] of orderedIds.entries()) {
      await tx.run(
        `UPDATE project_statuses
          SET position = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
        [position, now, id, projectId]
      );
      await recordChange(
        {
          workspaceId: scope.workspaceId,
          projectId,
          entityType: 'project_status',
          entityId: id,
          operation: 'update',
          changedFields: ['position']
        },
        tx
      );
    }

    return selectProjectStatuses(projectId, tx);
  });
}

// ---- Project tags --------------------------------------------------------

const selectProjectTagColumns = `id, workspace_id, project_id, label, color, active, revision`;

async function getProjectTagRow(
  db: DatabaseClient,
  projectId: string,
  tagId: string,
  permission: Permission = PERMISSIONS.PROJECT_READ
): Promise<ProjectTagRow> {
  const project = await getProject(projectId, db, permission);
  const row = (await db.get(
    `SELECT ${selectProjectTagColumns} FROM project_tags
        WHERE id = ? AND project_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [tagId, projectId, project.workspaceId]
  )) as ProjectTagRow | undefined;
  if (!row) throw new ApiError(404, 'Tag not found');
  return row;
}

export async function listProjectTags(projectId: string): Promise<ProjectTagDto[]> {
  const project = await getProject(projectId);
  const rows = (await requireDatabaseClient().all(
    `SELECT ${selectProjectTagColumns} FROM project_tags
        WHERE project_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ORDER BY ${orderByLabelAsc('label')}`,
    [projectId, project.workspaceId]
  )) as ProjectTagRow[];
  return rows.map(toProjectTagDto);
}

function normalizeTagColor(color: string | null | undefined): string | null {
  if (color === null || color === undefined) return null;
  const trimmed = color.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createProjectTag(
  projectId: string,
  body: CreateProjectTagBody
): Promise<ProjectTagDto> {
  return requireDatabaseClient().transaction(async tx => {
    const project = await getProject(projectId, tx, PERMISSIONS.PROJECT_UPDATE);
    const label = (body.label ?? '').trim();
    if (!label) throw new ApiError(400, 'Tag label cannot be empty');

    const duplicate = await tx.get(
      `SELECT 1 FROM project_tags
          WHERE project_id = ? AND label = ? AND deleted_at IS NULL`,
      [projectId, label]
    );
    if (duplicate) throw new ApiError(409, 'A tag with this label already exists');

    const now = nowIso();
    const id = newId();
    await tx.run(
      `INSERT INTO project_tags
         (id, workspace_id, project_id, label, color, active, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        project.workspaceId,
        projectId,
        label,
        normalizeTagColor(body.color),
        bindBool(DATABASE_DIALECT, true),
        now,
        now
      ]
    );

    await recordChange(
      {
        entityType: 'project_tag',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        projectId,
        workspaceId: project.workspaceId
      },
      tx
    );

    return toProjectTagDto(await getProjectTagRow(tx, projectId, id));
  });
}

export async function updateProjectTag(
  projectId: string,
  tagId: string,
  body: UpdateProjectTagBody
): Promise<ProjectTagDto> {
  return requireDatabaseClient().transaction(async tx => {
    const existing = await getProjectTagRow(tx, projectId, tagId, PERMISSIONS.PROJECT_UPDATE);

    const fields: string[] = [];
    const setParams: unknown[] = [];

    if (body.label !== undefined) {
      const label = body.label.trim();
      if (!label) throw new ApiError(400, 'Tag label cannot be empty');
      const duplicate = await tx.get(
        `SELECT 1 FROM project_tags
            WHERE project_id = ? AND label = ? AND id != ? AND deleted_at IS NULL`,
        [projectId, label, tagId]
      );
      if (duplicate) throw new ApiError(409, 'A tag with this label already exists');
      fields.push('label = ?');
      setParams.push(label);
    }
    if (body.color !== undefined) {
      fields.push('color = ?');
      setParams.push(normalizeTagColor(body.color));
    }
    if (body.active !== undefined) {
      fields.push('active = ?');
      setParams.push(bindBool(DATABASE_DIALECT, body.active));
    }
    if (fields.length === 0) return toProjectTagDto(existing);

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE project_tags SET ${fields.join(', ')}, updated_at = ?, revision = ?
         WHERE id = ? AND project_id = ?`,
      [...setParams, now, revision, tagId, projectId]
    );

    await recordChange(
      {
        entityType: 'project_tag',
        entityId: tagId,
        operation: 'update',
        entityRevision: revision,
        projectId,
        workspaceId: existing.workspace_id
      },
      tx
    );

    return toProjectTagDto(await getProjectTagRow(tx, projectId, tagId));
  });
}

export async function deleteProjectTag(projectId: string, tagId: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await getProjectTagRow(tx, projectId, tagId, PERMISSIONS.PROJECT_UPDATE);
    const now = nowIso();
    const revision = existing.revision + 1;
    // Soft-delete the definition; `mission_tags` rows cascade away via the FK so the
    // tag disappears from any mission that carried it.
    await tx.run(`DELETE FROM mission_tags WHERE tag_id = ?`, [tagId]);
    await tx.run(
      `UPDATE project_tags SET deleted_at = ?, updated_at = ?, revision = ?
       WHERE id = ? AND project_id = ?`,
      [now, now, revision, tagId, projectId]
    );

    await recordChange(
      {
        entityType: 'project_tag',
        entityId: tagId,
        operation: 'delete',
        entityRevision: revision,
        projectId,
        workspaceId: existing.workspace_id
      },
      tx
    );
  });
}

export async function listProjectResources(projectId: string): Promise<ProjectResourceDto[]> {
  const project = await getProject(projectId);

  const db = requireDatabaseClient();
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: project.workspaceId,
    permission: PERMISSIONS.PROJECT_READ,
    db,
    notFoundMessage: 'Project not found'
  });
  const rows = (await db.all(
    `SELECT id, workspace_id, project_id, resource_key, label,
              is_primary, access_mode, status, created_at, updated_at, revision
         FROM project_resources
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY status ASC, is_primary DESC, label ASC, resource_key ASC`,
    [projectId]
  )) as ProjectResourceRow[];
  const sources = (await db.all(
    `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
            observed_revision, observed_content_digest
       FROM project_resource_sources
      WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId]
  )) as ProjectResourceSourceRow[];
  const sourcesByResourceId = new Map<string, ProjectResourceSourceRow[]>();
  for (const source of sources) {
    const bucket = sourcesByResourceId.get(source.resource_id) ?? [];
    bucket.push(source);
    sourcesByResourceId.set(source.resource_id, bucket);
  }
  const observations = await loadTargetResourceObservations({
    ctx: await buildWebappServiceContextForWorkspace(project.workspaceId, db, workspaceUserId),
    resourceIds: rows.map(row => row.id)
  });
  return await Promise.all(
    rows.map(row => toProjectResourceDto(row, observations, sourcesByResourceId.get(row.id) ?? []))
  );
}

async function findProjectResourceSource({
  db,
  resourceId,
  executionTargetId,
  sourceKind
}: {
  db: DatabaseClient;
  resourceId: string;
  executionTargetId: string | null;
  sourceKind: string;
}): Promise<{ id: string; descriptor_json: string } | undefined> {
  if (executionTargetId === null) {
    return (await db.get(
      `SELECT id, descriptor_json FROM project_resource_sources
        WHERE resource_id = ? AND execution_target_id IS NULL
          AND source_kind = ? AND deleted_at IS NULL`,
      [resourceId, sourceKind]
    )) as { id: string; descriptor_json: string } | undefined;
  }

  return (await db.get(
    `SELECT id, descriptor_json FROM project_resource_sources
      WHERE resource_id = ? AND execution_target_id = ?
        AND source_kind = ? AND deleted_at IS NULL`,
    [resourceId, executionTargetId, sourceKind]
  )) as { id: string; descriptor_json: string } | undefined;
}

async function insertProjectResource(
  db: DatabaseClient,
  project: Pick<ProjectDto, 'id' | 'workspaceId'>,
  body: CreateProjectResourceBody & { path?: string },
  pathRequiredMessage: string,
  options: { actorWorkspaceUserId?: string | null } = {}
): Promise<string> {
  const resourcePath = (body.directoryPath ?? body.path ?? '').trim();
  const sourceUrl = body.sourceUrl?.trim() ?? '';
  if (!resourcePath && !sourceUrl) throw new ApiError(400, pathRequiredMessage);
  if (sourceUrl && !/^https?:\/\//.test(sourceUrl) && !/^git@[^:]+:.+/.test(sourceUrl)) {
    throw new ApiError(400, 'sourceUrl must be an http(s) or SSH Git URL');
  }
  const resourceKey = deriveProjectResourceKey({
    resourceKey: body.resourceKey,
    label: body.label,
    directoryPath: resourcePath || sourceUrl
  });
  const sourceKind = sourceUrl ? 'git' : 'local_checkout';
  const executionTargetId = sourceUrl
    ? (body.executionTargetId ?? null)
    : await resolveResourceExecutionTargetId(db, project.workspaceId, body.executionTargetId);

  const willBePrimary = body.isPrimary !== false;
  // coo:368: primary resources are always read & write; a non-primary resource
  // defaults to `read` when the caller does not explicitly request `read_write`.
  const resolvedAccessMode = willBePrimary
    ? 'read_write'
    : body.accessMode === 'read_write'
      ? 'read_write'
      : 'read';

  const now = nowIso();
  if (willBePrimary) await clearPrimaryResourcesForTarget(db, { projectId: project.id, now });

  const existing = (await db.get(
    `SELECT id FROM project_resources WHERE project_id = ? AND resource_key = ? AND deleted_at IS NULL`,
    [project.id, resourceKey]
  )) as { id: string } | undefined;
  const resourceId = existing?.id ?? newId();
  if (!existing) {
    await db.run(
      `INSERT INTO project_resources
         (id, workspace_id, project_id, resource_key, label, is_primary, access_mode, status, metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?, 1)`,
      [
        resourceId,
        project.workspaceId,
        project.id,
        resourceKey,
        body.label ?? null,
        bindBool(DATABASE_DIALECT, willBePrimary),
        resolvedAccessMode,
        now,
        now
      ]
    );
  } else if (willBePrimary) {
    await db.run(
      `UPDATE project_resources SET is_primary = ?, access_mode = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [bindBool(DATABASE_DIALECT, true), 'read_write', now, resourceId]
    );
  } else if (body.accessMode !== undefined) {
    await db.run(
      `UPDATE project_resources SET access_mode = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [resolvedAccessMode, now, resourceId]
    );
  }
  const source = await findProjectResourceSource({
    db,
    resourceId,
    executionTargetId,
    sourceKind
  });
  let descriptorObject: Record<string, unknown> = {};
  if (source) {
    try {
      const parsed = JSON.parse(source.descriptor_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        descriptorObject = parsed as Record<string, unknown>;
      }
    } catch {
      descriptorObject = {};
    }
  }
  if (sourceUrl) {
    descriptorObject.url = sourceUrl;
    delete descriptorObject.path;
  } else {
    descriptorObject.path = resourcePath;
    delete descriptorObject.url;
  }
  const descriptor = JSON.stringify(descriptorObject);
  if (source) {
    await db.run(
      `UPDATE project_resource_sources SET descriptor_json = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [descriptor, now, source.id]
    );
  } else {
    await db.run(
      `INSERT INTO project_resource_sources (id, workspace_id, project_id, resource_id, execution_target_id, source_kind, descriptor_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        newId(),
        project.workspaceId,
        project.id,
        resourceId,
        executionTargetId,
        sourceKind,
        descriptor,
        now,
        now
      ]
    );
  }

  // Client/desktop owns `.overlord/project.json` on linked paths (WS-F3).

  await recordChange(
    {
      entityType: 'project_resource',
      entityId: resourceId,
      operation: 'insert',
      entityRevision: 1,
      projectId: project.id,
      changedFields: [
        sourceUrl ? 'source_url' : 'path',
        'resource_key',
        'is_primary',
        'access_mode'
      ],
      workspaceId: project.workspaceId,
      actorWorkspaceUserId: options.actorWorkspaceUserId
    },
    db
  );

  return resourceId;
}

export async function createProjectResource(
  projectId: string,
  body: CreateProjectResourceBody & { path?: string }
): Promise<ProjectResourceDto> {
  return requireDatabaseClient().transaction(async tx => {
    const project = await getProject(projectId, tx, PERMISSIONS.PROJECT_UPDATE);
    const id = await insertProjectResource(tx, project, body, 'directoryPath is required');

    const row = (await tx.get(
      `SELECT id, workspace_id, project_id, resource_key, label,
                is_primary, access_mode, status, created_at, updated_at, revision
           FROM project_resources
          WHERE id = ?`,
      [id]
    )) as ProjectResourceRow;
    const sources = (await tx.all(
      `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
              observed_revision, observed_content_digest
         FROM project_resource_sources WHERE resource_id = ? AND deleted_at IS NULL`,
      [id]
    )) as ProjectResourceSourceRow[];
    return await toProjectResourceDto(row, new Map(), sources);
  });
}

export async function updateProjectResource(
  projectId: string,
  resourceId: string,
  body: UpdateProjectResourceBody
): Promise<ProjectResourceDto> {
  return requireDatabaseClient().transaction(async tx => {
    const existing = await getProjectResourceRow(
      tx,
      projectId,
      resourceId,
      PERMISSIONS.PROJECT_UPDATE
    );
    const now = nowIso();
    const changedFields: string[] = [];
    let revision = existing.revision;

    if (body.resourceKey !== undefined) {
      const nextResourceKey = deriveProjectResourceKey({
        resourceKey: body.resourceKey,
        label: existing.label,
        directoryPath: existing.resource_key
      });
      if (nextResourceKey !== existing.resource_key) {
        revision += 1;
        await tx.run(
          `UPDATE project_resources
              SET resource_key = ?, updated_at = ?, revision = ?
            WHERE id = ?`,
          [nextResourceKey, now, revision, resourceId]
        );
        changedFields.push('resource_key');
      }
    }

    const becomingPrimary = body.isPrimary === true && !isTruthyFlag(existing.is_primary);
    if (becomingPrimary) {
      await clearPrimaryResourcesForTarget(tx, {
        projectId,
        now
      });
      // coo:368: a primary resource is always read & write, so promoting a
      // resource to primary also upgrades its access mode.
      await tx.run(
        `UPDATE project_resources
            SET is_primary = ?, access_mode = ?, updated_at = ?, revision = ?
          WHERE id = ?`,
        [bindBool(DATABASE_DIALECT, true), 'read_write', now, revision + 1, resourceId]
      );
      revision += 1;
      changedFields.push('is_primary');
      changedFields.push('access_mode');
    }

    // A standalone access-mode change is honored only when the resource is not
    // (and is not becoming) primary — primary resources are pinned to read_write.
    const staysPrimary = becomingPrimary || isTruthyFlag(existing.is_primary);
    if (body.accessMode !== undefined && !staysPrimary) {
      const nextAccessMode = body.accessMode === 'read_write' ? 'read_write' : 'read';
      if (nextAccessMode !== (existing.access_mode === 'read' ? 'read' : 'read_write')) {
        revision += 1;
        await tx.run(
          `UPDATE project_resources
              SET access_mode = ?, updated_at = ?, revision = ?
            WHERE id = ?`,
          [nextAccessMode, now, revision, resourceId]
        );
        changedFields.push('access_mode');
      }
    }

    if (changedFields.length > 0) {
      await recordChange(
        {
          entityType: 'project_resource',
          entityId: resourceId,
          operation: 'update',
          entityRevision: revision,
          projectId,
          changedFields,
          workspaceId: existing.workspace_id
        },
        tx
      );
    }

    const sources = (await tx.all(
      `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
              observed_revision, observed_content_digest
         FROM project_resource_sources WHERE resource_id = ? AND deleted_at IS NULL`,
      [resourceId]
    )) as ProjectResourceSourceRow[];
    return await toProjectResourceDto(
      await getProjectResourceRow(tx, projectId, resourceId),
      new Map(),
      sources
    );
  });
}

export async function deleteProjectResource(projectId: string, resourceId: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await getProjectResourceRow(
      tx,
      projectId,
      resourceId,
      PERMISSIONS.PROJECT_UPDATE
    );
    const now = nowIso();
    const revision = existing.revision + 1;

    await tx.run(
      `UPDATE project_resources
        SET deleted_at = ?, updated_at = ?, revision = ?
      WHERE id = ?`,
      [now, now, revision, resourceId]
    );

    await promoteFallbackPrimary(tx, {
      projectId,
      now
    });

    await recordChange(
      {
        entityType: 'project_resource',
        entityId: resourceId,
        operation: 'delete',
        entityRevision: revision,
        projectId,
        workspaceId: existing.workspace_id
      },
      tx
    );
  });
}

/**
 * Disconnect one materialization descriptor while preserving its logical project
 * resource. A resource without sources is intentionally valid: it can be
 * reconnected on another execution target or through a different source kind.
 */
export async function deleteProjectResourceSource(
  projectId: string,
  resourceId: string,
  sourceId: string
): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const resource = await getProjectResourceRow(
      tx,
      projectId,
      resourceId,
      PERMISSIONS.PROJECT_UPDATE
    );
    const source = (await tx.get(
      `SELECT id FROM project_resource_sources
        WHERE id = ? AND project_id = ? AND resource_id = ? AND deleted_at IS NULL`,
      [sourceId, projectId, resourceId]
    )) as { id: string } | undefined;
    if (!source) throw new ApiError(404, 'Project resource source not found');

    const now = nowIso();
    const revision = resource.revision + 1;
    await tx.run(
      `UPDATE project_resource_sources
          SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ?`,
      [now, now, sourceId]
    );
    await tx.run(
      `UPDATE project_resources
          SET updated_at = ?, revision = ?
        WHERE id = ?`,
      [now, revision, resourceId]
    );
    await recordChange(
      {
        entityType: 'project_resource',
        entityId: resourceId,
        operation: 'update',
        entityRevision: revision,
        projectId,
        changedFields: ['sources'],
        workspaceId: resource.workspace_id
      },
      tx
    );
  });
}

/** Replace launch defaults on one source without disturbing its materialization descriptor. */
export async function updateProjectResourceSource(
  projectId: string,
  resourceId: string,
  sourceId: string,
  body: UpdateProjectResourceSourceBody
): Promise<ProjectResourceDto> {
  return requireDatabaseClient().transaction(async tx => {
    const resource = await getProjectResourceRow(
      tx,
      projectId,
      resourceId,
      PERMISSIONS.PROJECT_UPDATE
    );
    const source = await tx.get<ProjectResourceSourceRow>(
      `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
              observed_revision, observed_content_digest
         FROM project_resource_sources
        WHERE id = ? AND project_id = ? AND resource_id = ? AND deleted_at IS NULL`,
      [sourceId, projectId, resourceId]
    );
    if (!source) throw new ApiError(404, 'Project resource source not found');
    if (
      !body.launchDefaults ||
      typeof body.launchDefaults !== 'object' ||
      Array.isArray(body.launchDefaults)
    ) {
      throw new ApiError(400, 'launchDefaults must be an object keyed by agent');
    }

    let descriptor: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(source.descriptor_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        descriptor = parsed as Record<string, unknown>;
      }
    } catch {
      descriptor = {};
    }
    const launchDefaults: Record<
      string,
      { preCommand: string; flags: ReturnType<typeof normalizeAgentLaunchFlags> }
    > = {};
    for (const [rawAgentKey, rawConfig] of Object.entries(body.launchDefaults)) {
      const agentKey = rawAgentKey.trim();
      if (!agentKey || !rawConfig || typeof rawConfig !== 'object') continue;
      const preCommand =
        typeof rawConfig.preCommand === 'string' ? rawConfig.preCommand.trim() : '';
      const flags = normalizeAgentLaunchFlags(rawConfig.flags);
      if (!preCommand && flags.length === 0) continue;
      launchDefaults[agentKey] = { preCommand, flags };
    }
    if (Object.keys(launchDefaults).length > 0) descriptor.launchDefaults = launchDefaults;
    else delete descriptor.launchDefaults;

    const now = nowIso();
    const revision = resource.revision + 1;
    await tx.run(
      `UPDATE project_resource_sources
          SET descriptor_json = ?, updated_at = ?, revision = revision + 1
        WHERE id = ?`,
      [JSON.stringify(descriptor), now, sourceId]
    );
    await tx.run(`UPDATE project_resources SET updated_at = ?, revision = ? WHERE id = ?`, [
      now,
      revision,
      resourceId
    ]);
    await recordChange(
      {
        entityType: 'project_resource',
        entityId: resourceId,
        operation: 'update',
        entityRevision: revision,
        projectId,
        changedFields: ['sources.launch_defaults'],
        workspaceId: resource.workspace_id
      },
      tx
    );

    const sources = await tx.all<ProjectResourceSourceRow>(
      `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
              observed_revision, observed_content_digest
         FROM project_resource_sources WHERE resource_id = ? AND deleted_at IS NULL`,
      [resourceId]
    );
    return toProjectResourceDto(
      await getProjectResourceRow(tx, projectId, resourceId),
      new Map(),
      sources
    );
  });
}

async function getProjectRepositoryResource(
  projectId: string,
  executionTargetId: string | null,
  resourceKey: string | null
): Promise<ProjectResourceDto | null> {
  // A non-null `resourceKey` sorts matching resources first; when the key isn't
  // linked (or is null) `resource_key = NULL` is never true, so the CASE collapses
  // to 1 for every row and ordering falls back to the project primary.
  const db = requireDatabaseClient();
  const row = (await db.get(
    `SELECT id, workspace_id, project_id, resource_key, label,
            is_primary, access_mode, status, created_at, updated_at, revision
       FROM project_resources
      WHERE project_id = ? AND status = 'active' AND deleted_at IS NULL
      ORDER BY CASE WHEN resource_key = ? THEN 0 ELSE 1 END, is_primary DESC, created_at ASC LIMIT 1`,
    [projectId, resourceKey]
  )) as ProjectResourceRow | undefined;
  if (!row) return null;
  const sources = (await db.all(
    `SELECT id, resource_id, execution_target_id, source_kind, descriptor_json,
            observed_revision, observed_content_digest
       FROM project_resource_sources
      WHERE resource_id = ? AND deleted_at IS NULL
      ORDER BY CASE WHEN execution_target_id = ? THEN 0 WHEN execution_target_id IS NULL THEN 1 ELSE 2 END`,
    [row.id, executionTargetId]
  )) as ProjectResourceSourceRow[];
  return await toProjectResourceDto(row, new Map(), sources);
}

export async function getProjectRepository(
  projectId: string,
  executionTargetId: string | null,
  resourceKey: string | null = null
): Promise<ProjectRepositoryDto> {
  await getProject(projectId);

  const scannedAt = nowIso();
  const resource = await getProjectRepositoryResource(projectId, executionTargetId, resourceKey);
  if (!resource) {
    return {
      projectId,
      executionTargetId,
      resource: null,
      status: 'no_resource',
      rootPath: null,
      gitRoot: null,
      branch: null,
      commit: null,
      entries: [],
      truncated: false,
      scannedAt,
      message: 'No active project resource is linked for this execution target.'
    };
  }

  if (resource.type !== 'local_directory') {
    return {
      projectId,
      executionTargetId,
      resource,
      status: 'unsupported_resource',
      rootPath: resource.path,
      gitRoot: null,
      branch: null,
      commit: null,
      entries: [],
      truncated: false,
      scannedAt,
      message: `Repository reading is not supported for ${resource.type} resources yet.`
    };
  }

  const provider = checkoutControlPlaneProvider(backendTargetMetadata(executionTargetId));
  const tree = await provider.readRepositoryTree({
    resourceId: resource.id,
    repoPath: resource.path
  });
  if (tree.ok) {
    return {
      projectId,
      executionTargetId,
      resource,
      status: 'ready',
      rootPath: tree.value.rootPath,
      gitRoot: tree.value.gitRoot,
      branch: tree.value.branch,
      commit: tree.value.commit,
      entries: tree.value.entries,
      truncated: tree.value.truncated,
      scannedAt,
      message: null
    };
  }
  const status =
    tree.code === 'LOCAL_TARGET_REQUIRED' || tree.code === 'LOCAL_TARGET_UNREACHABLE'
      ? 'unsupported_resource'
      : tree.code === 'NOT_GIT_REPOSITORY'
        ? 'not_git_repository'
        : 'unreadable';
  const message =
    tree.code === 'LOCAL_TARGET_REQUIRED'
      ? 'Repository browsing for linked local directories must run on a local execution target.'
      : tree.message;
  return {
    projectId,
    executionTargetId,
    resource,
    status,
    rootPath: resource.path,
    gitRoot: null,
    branch: null,
    commit: null,
    entries: [],
    truncated: false,
    scannedAt,
    message
  };
}

const hexColorPattern = /^#?[0-9a-fA-F]{6}$/;

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return hexColorPattern.test(withHash) ? withHash.toLowerCase() : null;
}

export async function createProject(body: CreateProjectBody): Promise<ProjectDto> {
  return requireDatabaseClient().transaction(async tx => {
    const name = (body.name ?? '').trim();
    if (!name) throw new ApiError(400, 'Project name is required');

    const targetWorkspaceId =
      body.workspaceId?.trim() ||
      (getAuthorizedWorkspacesContext() ? null : getBootstrapWorkspaceIdOrNull());
    if (!targetWorkspaceId) {
      throw new ApiError(400, 'workspaceId is required when creating a project');
    }
    const targetWorkspaceUserId = await requireWorkspacePermission({
      workspaceId: targetWorkspaceId,
      permission: PERMISSIONS.PROJECT_CREATE,
      db: tx,
      notFoundMessage: 'Workspace not found or no active membership'
    });

    const color = body.color ? normalizeHexColor(body.color) : null;
    if (body.color && !color) {
      throw new ApiError(400, 'Use a valid 6-digit hex color, like #d4d4d8.');
    }

    const now = nowIso();
    const id = newId();
    const slug = body.slug?.trim() ? slugify(body.slug) : slugify(name);
    const settingsJson = buildProjectSettingsJson({ color: color ?? undefined });
    const maxPosition = (await tx.get(
      `SELECT COALESCE(MAX(position), 0) AS max_position FROM projects
          WHERE workspace_id = ? AND deleted_at IS NULL`,
      [targetWorkspaceId]
    )) as { max_position: number };
    const position = maxPosition.max_position + 1;

    await tx.run(
      `INSERT INTO projects
       (id, workspace_id, slug, name, description, status, settings_json,
        created_by_workspace_user_id, created_at, updated_at, revision, position)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, ?)`,
      [
        id,
        targetWorkspaceId,
        slug,
        name,
        body.description?.trim() || null,
        settingsJson,
        targetWorkspaceUserId,
        now,
        now,
        position
      ]
    );

    await seedProjectStatuses(tx, { projectId: id, workspaceId: targetWorkspaceId, now });

    await recordChange(
      {
        entityType: 'project',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        projectId: id,
        workspaceId: targetWorkspaceId,
        actorWorkspaceUserId: targetWorkspaceUserId
      },
      tx
    );

    const primaryResourcePath = body.primaryResource?.directoryPath?.trim() ?? '';
    if (primaryResourcePath) {
      await insertProjectResource(
        tx,
        { id, workspaceId: targetWorkspaceId },
        {
          directoryPath: primaryResourcePath,
          executionTargetId: body.primaryResource?.executionTargetId,
          isPrimary: true
        },
        'primaryResource.directoryPath is required',
        { actorWorkspaceUserId: targetWorkspaceUserId }
      );
    }

    return getProject(id, tx);
  });
}

async function seedProjectStatuses(
  db: DatabaseClient,
  { projectId, workspaceId, now }: { projectId: string; workspaceId: string; now: string }
): Promise<void> {
  for (const status of DEFAULT_STATUSES) {
    await db.run(
      `INSERT INTO project_statuses
         (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        newId(),
        workspaceId,
        projectId,
        status.key,
        status.name,
        status.type,
        status.position,
        bindBool(db.dialect, status.isDefault),
        bindBool(db.dialect, status.isTerminal),
        now,
        now
      ]
    );
  }
}

function initializationProvisioning(
  row: ProjectInitializationRow,
  resource: ProjectResourceDto | null
): InitializeProjectResultDto['repositoryProvisioning'] {
  const succeeded = row.provisioning_status === 'succeeded';
  return {
    status: row.provisioning_status,
    retryable: row.provisioning_status === 'pending' || row.provisioning_status === 'failed',
    ownerLogin: row.github_owner_login,
    repository:
      succeeded && row.github_repo_id && row.full_name && row.default_branch && row.clone_url
        ? {
            id: row.github_repo_id,
            fullName: row.full_name,
            defaultBranch: row.default_branch,
            private: true,
            cloneUrl: row.clone_url
          }
        : null,
    resource,
    error: row.failure_message
  };
}

/**
 * The mobile composite creation boundary. Internal idea capture is committed in
 * one transaction; the external GitHub side effect is deliberately retried
 * afterwards using the same caller idempotency key.
 */
export async function initializeProject(
  body: InitializeProjectBody
): Promise<InitializeProjectResultDto> {
  const db = requireDatabaseClient();
  const workspaceId = body.workspaceId?.trim();
  const idempotencyKey = body.idempotencyKey?.trim();
  const name = body.name?.trim();
  const description = body.description?.trim();
  const wantsRepository = body.createGitHubRepository === true;
  const ownerLogin = body.githubOwnerLogin?.trim() || null;
  if (!workspaceId || !idempotencyKey || idempotencyKey.length > 200 || !name || !description) {
    throw new ApiError(400, 'workspaceId, idempotencyKey, name, and description are required.');
  }
  if (wantsRepository !== Boolean(ownerLogin)) {
    throw new ApiError(400, 'githubOwnerLogin is required only when creating a GitHub repository.');
  }
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required.');

  let initialization = await db.transaction(async tx => {
    const existing = await readProjectInitialization(tx, profileId, idempotencyKey);
    if (existing) return existing;
    const workspaceUserId = await requireWorkspacePermission({
      workspaceId,
      permission: PERMISSIONS.PROJECT_CREATE,
      db: tx,
      notFoundMessage: 'Workspace not found or no active membership'
    });
    const now = nowIso();
    const projectId = newId();
    const maxPosition = (await tx.get(
      `SELECT COALESCE(MAX(position), 0) AS max_position FROM projects
        WHERE workspace_id = ? AND deleted_at IS NULL`,
      [workspaceId]
    )) as { max_position: number };
    await tx.run(
      `INSERT INTO projects (id, workspace_id, slug, name, description, status, settings_json,
          created_by_workspace_user_id, created_at, updated_at, revision, position)
       VALUES (?, ?, ?, ?, ?, 'active', '{}', ?, ?, ?, 1, ?)`,
      [
        projectId,
        workspaceId,
        slugify(name),
        name,
        description,
        workspaceUserId,
        now,
        now,
        maxPosition.max_position + 1
      ]
    );
    await seedProjectStatuses(tx, { projectId, workspaceId, now });
    await recordChange(
      {
        entityType: 'project',
        entityId: projectId,
        operation: 'insert',
        entityRevision: 1,
        projectId,
        workspaceId,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );
    const mission = await createMissionTx(
      { projectId, title: name, firstObjective: description },
      tx,
      true
    );
    const id = newId();
    const status = wantsRepository ? 'pending' : 'not_requested';
    return createProjectInitialization(tx, {
      id,
      profileId,
      workspaceId,
      projectId,
      missionId: mission.missionId,
      idempotencyKey,
      ownerLogin,
      status,
      now
    });
  });

  if (
    initialization.provisioning_status !== 'not_requested' &&
    initialization.provisioning_status !== 'succeeded'
  ) {
    try {
      const repo = await createPrivateGitHubRepository({
        ownerLogin: ownerLogin!,
        name: slugify(name)
      });
      initialization = await persistInitializedRepository({ db, initialization, repo });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'GitHub repository provisioning failed.';
      const now = nowIso();
      await recordProvisioningFailure(db, {
        id: initialization.id,
        message,
        now
      });
      initialization = (await readProjectInitialization(db, profileId, idempotencyKey))!;
    }
  }

  const project = await getProject(initialization.project_id);
  const mission = await getMissionDetail(initialization.mission_id);
  const resources = await listProjectResources(initialization.project_id);
  const resource = initialization.clone_url
    ? (resources.find(item =>
        item.sources.some(source => source.descriptor.url === initialization.clone_url)
      ) ?? null)
    : null;
  return {
    project,
    mission,
    repositoryProvisioning: initializationProvisioning(initialization, resource)
  };
}

async function persistInitializedRepository({
  db,
  initialization,
  repo
}: {
  db: DatabaseClient;
  initialization: ProjectInitializationRow;
  repo: CreatedGitHubRepositoryDto;
}): Promise<ProjectInitializationRow> {
  return db.transaction(async tx => {
    const current = (await readProjectInitializationById(tx, initialization.id))!;
    if (current.provisioning_status === 'succeeded') return current;
    const project = await getProject(current.project_id, tx, PERMISSIONS.PROJECT_READ);
    const now = nowIso();
    await recordPrivateRepositoryLink(tx, { project, repo, now });
    await insertProjectResource(
      tx,
      project,
      {
        sourceUrl: repo.cloneUrl,
        label: repo.fullName,
        isPrimary: false,
        accessMode: 'read'
      },
      'GitHub clone URL is required'
    );
    return recordProvisioningSuccess(tx, { id: current.id, repo, now });
  });
}

export async function updateProject(id: string, body: UpdateProjectBody): Promise<ProjectDto> {
  return requireDatabaseClient().transaction(async tx => {
    const { workspaceId, workspaceUserId } = await requireProjectPermission({
      projectId: id,
      permission: PERMISSIONS.PROJECT_UPDATE,
      db: tx
    });
    const existing = (await tx.get(
      `SELECT * FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [id, workspaceId]
    )) as ProjectRow | undefined;
    if (!existing) throw new ApiError(404, 'Project not found');

    const fields: string[] = [];
    const setParams: unknown[] = [];
    const changed: string[] = [];

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new ApiError(400, 'Project name cannot be empty');
      fields.push('name = ?');
      setParams.push(name);
      changed.push('name');
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      setParams.push(body.description?.trim() || null);
      changed.push('description');
    }
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'archived') {
        throw new ApiError(400, 'Invalid project status');
      }
      fields.push('status = ?');
      setParams.push(body.status);
      changed.push('status');
    }
    // `color`, `defaultBranch`, `preLaunchCommands`, and `launchEnvVars` all live
    // in `settings_json`; merge them into a single update so a request that sets
    // several doesn't clobber one with the other.
    const settingsUpdates: {
      color?: string | null;
      defaultBranch?: string | null;
      preLaunchCommands?: string[];
      launchEnvVars?: Record<string, string>;
    } = {};
    if (body.color !== undefined) {
      const color = body.color ? normalizeHexColor(body.color) : null;
      if (body.color && !color) {
        throw new ApiError(400, 'Use a valid 6-digit hex color, like #d4d4d8.');
      }
      settingsUpdates.color = color;
    }
    if (body.defaultBranch !== undefined) {
      const branch = body.defaultBranch?.trim() || null;
      if (branch && !isValidBranchName(branch)) {
        throw new ApiError(400, 'Enter a valid git branch name (e.g. main, develop, release/v2).');
      }
      settingsUpdates.defaultBranch = branch;
    }
    if (body.preLaunchCommands !== undefined) {
      if (!Array.isArray(body.preLaunchCommands)) {
        throw new ApiError(400, 'preLaunchCommands must be an array of command strings.');
      }
      settingsUpdates.preLaunchCommands = normalizePreLaunchCommands(body.preLaunchCommands);
    }
    if (body.launchEnvVars !== undefined) {
      if (
        !body.launchEnvVars ||
        typeof body.launchEnvVars !== 'object' ||
        Array.isArray(body.launchEnvVars)
      ) {
        throw new ApiError(400, 'launchEnvVars must be an object of name/value strings.');
      }
      settingsUpdates.launchEnvVars = normalizeLaunchEnvVars(body.launchEnvVars);
    }
    if (
      settingsUpdates.color !== undefined ||
      settingsUpdates.defaultBranch !== undefined ||
      settingsUpdates.preLaunchCommands !== undefined ||
      settingsUpdates.launchEnvVars !== undefined
    ) {
      fields.push('settings_json = ?');
      setParams.push(mergeProjectSettingsJson(existing.settings_json, settingsUpdates));
      changed.push('settings_json');
    }
    if (fields.length === 0) return getProject(id, tx);

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE projects SET ${fields.join(', ')}, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [...setParams, now, revision, id, workspaceId]
    );

    await recordChange(
      {
        entityType: 'project',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        projectId: id,
        changedFields: changed,
        workspaceId,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );
    return getProject(id, tx);
  });
}

export async function deleteProject(id: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const { workspaceId, workspaceUserId } = await requireProjectPermission({
      projectId: id,
      permission: PERMISSIONS.PROJECT_DELETE,
      db: tx
    });
    const existing = (await tx.get(
      `SELECT id, revision FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [id, workspaceId]
    )) as { id: string; revision: number } | undefined;
    if (!existing) throw new ApiError(404, 'Project not found');

    const now = nowIso();
    const revision = existing.revision + 1;

    // Cascade soft-delete to missions and their objectives.
    const missionIds = (
      (await tx.all(
        `SELECT id FROM missions WHERE project_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [id, workspaceId]
      )) as { id: string }[]
    ).map(r => r.id);

    for (const missionId of missionIds) {
      await tx.run(
        `UPDATE objectives SET deleted_at = ?, revision = revision + 1
         WHERE mission_id = ? AND deleted_at IS NULL`,
        [now, missionId]
      );
    }

    if (missionIds.length > 0) {
      await tx.run(
        `UPDATE missions SET deleted_at = ?, revision = revision + 1
         WHERE project_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [now, id, workspaceId]
      );
    }

    await tx.run(
      `UPDATE projects SET deleted_at = ?, updated_at = ?, revision = ?
       WHERE id = ? AND workspace_id = ?`,
      [now, now, revision, id, workspaceId]
    );

    await recordChange(
      {
        entityType: 'project',
        entityId: id,
        operation: 'delete',
        entityRevision: revision,
        projectId: id,
        workspaceId,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );
  });
}

// ---- Missions -------------------------------------------------------------

/**
 * Extract a scalar JSON field without relying on SQLite's text-backed JSON
 * representation. PostgreSQL stores these columns as jsonb, which cannot be
 * compared with text operators such as LIKE.
 */
function jsonTextFieldSql(column: string, field: string, dialect: SqlDialect): string {
  return dialect === 'postgres'
    ? `${column}->>'${field}'`
    : `json_extract(${column}, '$.${field}')`;
}

function missionHasUnseenBlockingQuestionSql(dialect: SqlDialect): string {
  const answerRequestId = jsonTextFieldSql('answer.payload_json', 'agentRequestId', dialect);
  return `
         (SELECT COUNT(*) > 0 FROM mission_events me
            WHERE me.mission_id = t.id AND me.type = 'ask'
              AND NOT EXISTS (
                SELECT 1 FROM agent_requests ar
                 JOIN mission_events answer
                   ON answer.mission_id = me.mission_id
                  AND answer.type = 'answer'
                  AND ${answerRequestId} = ar.id
                WHERE ar.source_event_id = me.id AND ar.deleted_at IS NULL
              )
              AND (
                NOT EXISTS (SELECT 1 FROM mission_status_seen mss
                  WHERE mss.mission_id = t.id AND mss.status_id = 'blocking_question')
                OR me.created_at > (SELECT mss.seen_at FROM mission_status_seen mss
                  WHERE mss.mission_id = t.id AND mss.status_id = 'blocking_question')
              ))
            AS has_unseen_blocking_question`;
}

const missionHasUnseenReturnedToExecuteSql = `
         (CASE WHEN t.returned_to_execute_at IS NOT NULL
                    AND (
                      NOT EXISTS (SELECT 1 FROM mission_status_seen mss
                        WHERE mss.mission_id = t.id AND mss.status_id = 'returned_to_execute')
                      OR t.returned_to_execute_at > (SELECT mss.seen_at FROM mission_status_seen mss
                        WHERE mss.mission_id = t.id AND mss.status_id = 'returned_to_execute')
                    )
               THEN 1 ELSE 0 END)
            AS has_unseen_returned_to_execute`;

function selectMissionsSql(dialect: SqlDialect): string {
  return `
  SELECT t.id, t.workspace_id, t.project_id, t.display_id, t.sequence_number, t.title,
         t.status_id, t.status_type, t.board_position, t.priority,
         t.assigned_workspace_user_id,
         t.notes_text,
         t.schedule_id, t.due_datetime,
         t.created_at, t.updated_at, t.revision, t.active_branch, t.branch_override,
         t.worktree_preference, t.allow_parallel_objectives,
         t.created_by_kind, t.created_by_agent, t.created_by_workspace_user_id,
         t.created_by_session_id,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS completed_objective_count,
         -- pending_delivery counts as executing: the agent re-attached after
         -- finishing a turn and is still on the objective, so the card should
         -- keep reading as live work rather than going quiet until delivery.
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('executing', 'pending_delivery'))
            AS has_executing_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS has_completed_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('draft', 'future') AND TRIM(o.instruction_text) != '')
            AS has_pending_objective_with_instructions,
${missionHasUnseenBlockingQuestionSql(dialect)},
${missionHasUnseenReturnedToExecuteSql},
         (SELECT o.resource_key FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'draft'
            LIMIT 1) AS draft_objective_resource_key
  FROM missions t
  WHERE t.workspace_id = ? AND t.deleted_at IS NULL
`;
}

/**
 * Every non-deleted objective belonging to `missionIds`, grouped by mission and
 * ordered by `position`, resolved in a single statement. This is the batched
 * counterpart to `listObjectives` and exists so a client that renders objective
 * bodies for a whole board (the mobile chat feed) does not have to issue one
 * request — and one query — per mission. The caller is responsible for
 * authorizing the mission set before calling.
 */
async function getObjectivesByMission(
  missionIds: string[],
  db: DatabaseClient = requireDatabaseClient()
): Promise<Map<string, ObjectiveDto[]>> {
  const byMission = new Map<string, ObjectiveDto[]>();
  if (missionIds.length === 0) return byMission;
  const placeholders = missionIds.map(() => '?').join(', ');
  const rows = (await db.all(
    `SELECT o.*, m.display_id AS mission_display_id,
         e.id AS queue_entry_id, e.queue_id, q.name AS queue_name,
         CASE WHEN e.id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM run_queue_entries er WHERE er.queue_id = e.queue_id AND er.deleted_at IS NULL AND (er.position < e.position OR (er.position = e.position AND er.id <= e.id))) END AS queue_position,
         e.state AS queue_state, e.blocked_reason AS queue_blocked_reason,
         e.waiting_reason AS queue_waiting_reason, e.waiting_on_objective_id AS queue_waiting_on_objective_id,
         e.attempt_count AS queue_attempt_count, wo.display_key AS queue_waiting_on_objective_display_key,
         (
           SELECT s.external_session_id
             FROM agent_sessions s
            WHERE s.objective_id = o.id AND s.deleted_at IS NULL
            ORDER BY s.started_at DESC
            LIMIT 1
         ) AS external_session_id
         FROM objectives o
         JOIN missions m ON m.id = o.mission_id
         LEFT JOIN run_queue_entries e ON e.objective_id = o.id AND e.deleted_at IS NULL
         LEFT JOIN run_queues q ON q.id = e.queue_id AND q.deleted_at IS NULL
         LEFT JOIN objectives wo ON wo.id = e.waiting_on_objective_id AND wo.deleted_at IS NULL
        WHERE o.mission_id IN (${placeholders}) AND o.deleted_at IS NULL
        ORDER BY o.mission_id ASC, o.position ASC`,
    missionIds
  )) as ObjectiveRow[];
  for (const row of rows) {
    const list = byMission.get(row.mission_id) ?? [];
    list.push(toObjectiveDto(row));
    byMission.set(row.mission_id, list);
  }
  return byMission;
}

export async function listMissions(
  projectId: string,
  options: { includeObjectives?: boolean } = {}
): Promise<MissionDto[]> {
  const { workspaceId } = await requireProjectPermission({
    projectId,
    permission: PERMISSIONS.MISSION_READ
  });
  if (options.includeObjectives) {
    await requireProjectPermission({ projectId, permission: PERMISSIONS.OBJECTIVE_READ });
  }
  // Board order: ascending board_position within each column, with
  // sequence_number DESC as a stable tiebreaker (e.g. brand-new missions that
  // share a position before the column is first reordered).
  const db = requireDatabaseClient();
  const rows = (await db.all(
    `${selectMissionsSql(db.dialect)} AND t.project_id = ?
         ORDER BY t.board_position ASC, t.sequence_number DESC`,
    [workspaceId, projectId]
  )) as MissionRow[];
  const tagsByMission = await getTagsByMission(rows.map(row => row.id));
  const objectivesByMission = options.includeObjectives
    ? await getObjectivesByMission(rows.map(row => row.id))
    : null;
  return rows.map(row => {
    const dto = toMissionDto(row, tagsByMission.get(row.id) ?? []);
    return objectivesByMission
      ? { ...dto, objectives: objectivesByMission.get(row.id) ?? [] }
      : dto;
  });
}

async function hydrateMissionDtos({
  workspaceId,
  missionIds,
  client
}: {
  workspaceId: string;
  missionIds: string[];
  client: DatabaseClient;
}): Promise<MissionDto[]> {
  if (missionIds.length === 0) return [];
  const rows = (await client.all(
    `${selectMissionsSql(client.dialect)} AND t.id IN (${missionIds.map(() => '?').join(', ')})`,
    [workspaceId, ...missionIds]
  )) as MissionRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  const tagsByMission = await getTagsByMission(missionIds);
  return missionIds.flatMap(id => {
    const row = byId.get(id);
    return row ? [toMissionDto(row, tagsByMission.get(id) ?? [])] : [];
  });
}

async function searchMissionsInWorkspace({
  query,
  projectId,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25,
  workspaceId,
  client
}: {
  query?: string | null;
  projectId?: string | null;
  projectIds?: string[] | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  workspaceId: string;
  client: DatabaseClient;
}) {
  const resolvedProjectIds = projectIds?.length ? projectIds : projectId ? [projectId] : [];
  return searchWorkspaceMissions({
    db: client,
    workspaceId,
    query,
    projectIds: resolvedProjectIds,
    statusTypes,
    resourceKeys,
    dateField,
    from,
    to,
    limit
  });
}

export async function searchMissions({
  query,
  projectId,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  query?: string | null;
  projectId?: string | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<MissionDto[]> {
  const client = requireDatabaseClient();
  if (projectId) {
    const { workspaceId } = await requireProjectPermission({
      projectId,
      permission: PERMISSIONS.MISSION_READ,
      db: client
    });
    const result = await searchMissionsInWorkspace({
      query,
      projectId,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to,
      limit,
      workspaceId,
      client
    });
    return hydrateMissionDtos({
      workspaceId,
      missionIds: result.hits.map(hit => hit.id),
      client
    });
  }

  const scopes = await callerAuthorizedWorkspaceScopes(PERMISSIONS.MISSION_READ, client);
  const quotas = allocateWorkspaceSearchLimits({
    workspaceIds: scopes.map(scope => scope.workspaceId),
    limit
  });
  const ranked = (
    await Promise.all(
      scopes.map(async scope => {
        const result = await searchMissionsInWorkspace({
          query,
          statusTypes,
          resourceKeys,
          dateField,
          from,
          to,
          limit: quotas.get(scope.workspaceId) ?? 0,
          workspaceId: scope.workspaceId,
          client
        });
        return result.hits;
      })
    )
  )
    .flat()
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, limit);

  const byWorkspace = new Map<string, string[]>();
  for (const hit of ranked) {
    const ids = byWorkspace.get(hit.workspaceId) ?? [];
    ids.push(hit.id);
    byWorkspace.set(hit.workspaceId, ids);
  }
  const dtosById = new Map<string, MissionDto>();
  await Promise.all(
    [...byWorkspace.entries()].map(async ([workspaceId, missionIds]) => {
      const dtos = await hydrateMissionDtos({ workspaceId, missionIds, client });
      for (const dto of dtos) dtosById.set(dto.id, dto);
    })
  );
  return ranked.flatMap(hit => {
    const dto = dtosById.get(hit.id);
    return dto ? [dto] : [];
  });
}

export async function searchMissionsAcrossWorkspacesV2({
  query,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25
}: {
  query?: string | null;
  projectIds?: string[] | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<SearchMissionsResponseV2> {
  const client = requireDatabaseClient();
  const projects = projectIds?.filter(id => id.trim() !== '') ?? [];
  if (projects.length === 1) {
    const { workspaceId } = await requireProjectPermission({
      projectId: projects[0]!,
      permission: PERMISSIONS.MISSION_READ,
      db: client
    });
    const result = await searchMissionsInWorkspace({
      query,
      projectIds: projects,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to,
      limit,
      workspaceId,
      client
    });
    return toSearchMissionsResponseV2(result);
  }

  const scopes = await callerAuthorizedWorkspaceScopes(PERMISSIONS.MISSION_READ, client);
  const quotas = allocateWorkspaceSearchLimits({
    workspaceIds: scopes.map(scope => scope.workspaceId),
    limit
  });
  const results = await Promise.all(
    scopes.map(scope =>
      searchMissionsInWorkspace({
        query,
        projectIds: projects,
        statusTypes,
        resourceKeys,
        dateField,
        from,
        to,
        limit: quotas.get(scope.workspaceId) ?? 0,
        workspaceId: scope.workspaceId,
        client
      })
    )
  );
  return mergeWorkspaceMissionSearches({ results, limit });
}

export async function searchMissionsAcrossWorkspacesV3({
  query,
  projectIds,
  statusTypes,
  resourceKeys,
  dateField,
  from,
  to,
  limit = 25,
  entityTypes,
  objectiveStates,
  matchesPerResult,
  candidateLimit
}: {
  query?: string | null;
  projectIds?: string[] | null;
  statusTypes?: string[] | null;
  resourceKeys?: string[] | null;
  dateField?: MissionSearchDateField | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  entityTypes?: string[] | null;
  objectiveStates?: string[] | null;
  matchesPerResult?: number | string | null;
  candidateLimit?: number | null;
}): Promise<SearchResponseV3> {
  const client = requireDatabaseClient();
  const projects = projectIds?.filter(id => id.trim() !== '') ?? [];
  const searchInWorkspace = ({
    workspaceId,
    workspaceLimit
  }: {
    workspaceId: string;
    workspaceLimit: number;
  }) =>
    searchWorkspaceMissionsV3({
      db: client,
      workspaceId,
      query,
      projectIds: projects,
      statusTypes,
      resourceKeys,
      dateField,
      from,
      to,
      limit: workspaceLimit,
      entityTypes,
      objectiveStates,
      matchesPerResult,
      candidateLimit
    });

  if (projects.length === 1) {
    const { workspaceId } = await requireProjectPermission({
      projectId: projects[0]!,
      permission: PERMISSIONS.MISSION_READ,
      db: client
    });
    return toSearchResponseV3(await searchInWorkspace({ workspaceId, workspaceLimit: limit }));
  }

  const scopes = await callerAuthorizedWorkspaceScopes(PERMISSIONS.MISSION_READ, client);
  const quotas = allocateWorkspaceSearchLimits({
    workspaceIds: scopes.map(scope => scope.workspaceId),
    limit
  });
  const results = await Promise.all(
    scopes.map(scope =>
      searchInWorkspace({
        workspaceId: scope.workspaceId,
        workspaceLimit: quotas.get(scope.workspaceId) ?? 0
      })
    )
  );
  return mergeWorkspaceSearchV3({ results, limit });
}

// New cards drop in at the top of their column. Gap-based: one step (100) above
// the current minimum so no renumber is needed until the column is reordered.
async function topBoardPosition(
  db: DatabaseClient,
  projectId: string,
  statusId: string,
  excludeMissionId?: string
): Promise<number> {
  const row = excludeMissionId
    ? ((await db.get(
        `SELECT MIN(board_position) AS min_pos FROM missions
         WHERE project_id = ? AND status_id = ?
           AND deleted_at IS NULL AND id != ?`,
        [projectId, statusId, excludeMissionId]
      )) as { min_pos: number | null })
    : ((await db.get(
        `SELECT MIN(board_position) AS min_pos FROM missions
         WHERE project_id = ? AND status_id = ? AND deleted_at IS NULL`,
        [projectId, statusId]
      )) as { min_pos: number | null });
  return row.min_pos === null ? 100 : row.min_pos - 100;
}

async function getProjectStatus(
  db: DatabaseClient,
  projectId: string,
  statusId: string
): Promise<ProjectStatusRow> {
  const statusRow = (await db.get(
    `SELECT * FROM project_statuses WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [statusId, projectId]
  )) as ProjectStatusRow | undefined;
  if (!statusRow) {
    throw new ApiError(409, 'That status is not available for missions in this project');
  }
  return statusRow;
}

/** Repoint denormalized project_id columns on mission-owned rows. */
async function cascadeMissionProjectId(
  db: DatabaseClient,
  {
    workspaceId,
    missionId,
    newProjectId,
    now
  }: {
    workspaceId: string;
    missionId: string;
    newProjectId: string;
    now: string;
  }
): Promise<void> {
  await db.run(
    `UPDATE objectives
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE my_mission_positions
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE agent_sessions
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE mission_events SET project_id = ?
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, missionId, workspaceId]
  );
  await db.run(
    `UPDATE deliveries
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE artifacts
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE changed_files
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE change_rationales
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
  await db.run(
    `UPDATE execution_requests
       SET project_id = ?, updated_at = ?, revision = revision + 1
     WHERE mission_id = ? AND workspace_id = ?`,
    [newProjectId, now, missionId, workspaceId]
  );
}

async function getMissionRow(
  missionRef: string,
  db: DatabaseClient = requireDatabaseClient(),
  permission: Permission = PERMISSIONS.MISSION_READ
): Promise<MissionRow> {
  const { workspaceId, missionId } = await requireMissionPermission({
    missionRef,
    permission,
    db
  });
  const row = (await db.get(`${selectMissionsSql(db.dialect)} AND t.id = ?`, [
    workspaceId,
    missionId
  ])) as MissionRow | undefined;
  if (!row) throw new ApiError(404, 'Mission not found');
  return row;
}

/**
 * Stamps seen rows in `mission_status_seen` for every unseen status indicator
 * on the mission, clearing the mission card's corner dots. Called when a user
 * opens a mission's detail. No-ops (and records no change) when there are no
 * unseen statuses, so repeated opens don't churn the change feed or loop the
 * realtime board invalidation. Does not touch `updated_at`/`revision`, keeping
 * board ordering and optimistic concurrency untouched.
 */
export async function markMissionStatusesSeen(missionRef: string): Promise<void> {
  const db = requireDatabaseClient();
  const row = await getMissionRow(missionRef, db);

  const toMark: string[] = [];
  if (row.has_unseen_blocking_question === 1) toMark.push('blocking_question');
  if (row.has_unseen_returned_to_execute === 1) toMark.push('returned_to_execute');
  if (toMark.length === 0) return;

  const now = nowIso();
  await db.transaction(async tx => {
    for (const statusId of toMark) {
      await tx.run(
        `INSERT INTO mission_status_seen (mission_id, status_id, seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT (mission_id, status_id) DO UPDATE SET seen_at = excluded.seen_at`,
        [row.id, statusId, now]
      );
    }
    await recordChange(
      {
        entityType: 'mission',
        entityId: row.id,
        operation: 'update',
        entityRevision: row.revision,
        projectId: row.project_id,
        missionId: row.id,
        workspaceId: row.workspace_id,
        changedFields: toMark.map(s => `${s}_seen`)
      },
      tx
    );
  });
}

/**
 * Resolves what the authoring agent was working on when it filed this mission.
 *
 * `missions.created_by_session_id` is a soft reference with no foreign key, so
 * the session (and its mission) may be gone; every failure to resolve returns
 * `null` rather than throwing, and the mission page renders without the
 * provenance line. This is detail-only on purpose — a board of 200 cards should
 * not pay two joins each for a sentence nobody can read at card size.
 */
async function missionCreatedFromDto(
  row: MissionRow,
  db: DatabaseClient = requireDatabaseClient()
): Promise<MissionCreatedFromDto | null> {
  const sessionId = row.created_by_session_id?.trim();
  if (!sessionId) return null;
  const found = (await db.get(
    `SELECT s.id, s.mission_id, s.agent_identifier, m.display_id
       FROM agent_sessions s
       LEFT JOIN missions m ON m.id = s.mission_id AND m.deleted_at IS NULL
      WHERE s.id = ? AND s.workspace_id = ? AND s.deleted_at IS NULL`,
    [sessionId, row.workspace_id]
  )) as
    | { id: string; mission_id: string; agent_identifier: string; display_id: string | null }
    | undefined;
  if (!found?.display_id) return null;
  return {
    sessionId: found.id,
    missionId: found.mission_id,
    missionDisplayId: found.display_id,
    agentIdentifier: found.agent_identifier
  };
}

export async function getMissionDetail(missionRef: string): Promise<MissionDetailDto> {
  const row = await getMissionRow(missionRef);
  const mission = toMissionDto(row, await getMissionTags(row.id));
  const objectives = await listObjectives(row.id);
  const statuses = await selectProjectStatuses(row.project_id);
  const executionRequests = await listMissionExecutionRequests(row.id);
  const terminalSessions = await listMissionTerminalSessions(row.id);
  return {
    ...mission,
    objectives,
    statuses,
    executionRequests,
    terminalSessions,
    branch: await missionBranchDto(row),
    createdFrom: await missionCreatedFromDto(row)
  };
}

interface MissionEventRow {
  id: string;
  mission_id: string;
  objective_id: string | null;
  type: string;
  phase: string | null;
  summary: string;
  source: string;
  actor_workspace_user_id: string | null;
  actor_display_name: string | null;
  actor_handle: string | null;
  actor_metadata_json: string | null;
  external_url: string | null;
  payload_json: string | null;
  created_at: string;
}

/**
 * Returns a mission's workflow history newest-first for the live activity feed.
 * `mission_events` is append-only, so there is no soft-delete filter; the
 * workspace scope guards against cross-workspace reads.
 */
export async function listMissionEvents(
  missionRef: string,
  limit = 200
): Promise<MissionEventDto[]> {
  const mission = await getMissionRow(missionRef, undefined, PERMISSIONS.EVENT_READ);
  const rows = (await requireDatabaseClient().all(
    `SELECT me.id, me.mission_id, me.objective_id, me.type, me.phase, me.summary,
              me.source, me.actor_workspace_user_id, me.external_url, me.payload_json, me.created_at,
              p.display_name AS actor_display_name,
              p.handle AS actor_handle,
              p.metadata_json AS actor_metadata_json
         FROM mission_events me
         LEFT JOIN workspace_users wu
           ON wu.id = me.actor_workspace_user_id
          AND wu.workspace_id = me.workspace_id
          AND wu.deleted_at IS NULL
         LEFT JOIN profiles p
           ON p.id = wu.profile_id
          AND p.deleted_at IS NULL
        WHERE me.mission_id = ? AND me.workspace_id = ?
        ORDER BY me.created_at DESC, me.id DESC
        LIMIT ?`,
    [mission.id, mission.workspace_id, limit]
  )) as MissionEventRow[];
  return rows.map(row => ({
    id: row.id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    type: row.type,
    phase: row.phase,
    summary: row.summary,
    source: row.source,
    actorWorkspaceUserId: row.actor_workspace_user_id,
    actor:
      row.actor_workspace_user_id && row.actor_display_name
        ? {
            workspaceUserId: row.actor_workspace_user_id,
            displayName: row.actor_display_name,
            handle: row.actor_handle,
            avatarUrl: avatarUrlFromMetadata(row.actor_metadata_json ?? '{}')
          }
        : null,
    externalUrl: row.external_url,
    ...(row.type === 'delivery'
      ? { deliveryId: deliveryIdFromEventPayload(row.payload_json) }
      : {}),
    createdAt: row.created_at
  }));
}

function deliveryIdFromEventPayload(payloadJson: string | null): string | null {
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson) as { deliveryId?: unknown };
    return typeof payload.deliveryId === 'string' && payload.deliveryId.trim()
      ? payload.deliveryId
      : null;
  } catch {
    return null;
  }
}

export function deliveryReportFromPayload(
  payloadJson: string | null,
  summary: string
): DeliveryReportPayloadV1 {
  if (!payloadJson) return readDeliveryReport({ summary, deliveryReport: undefined });
  try {
    const payload = JSON.parse(payloadJson) as { deliveryReport?: unknown };
    return readDeliveryReport({ summary, deliveryReport: payload.deliveryReport });
  } catch {
    return readDeliveryReport({ summary, deliveryReport: undefined });
  }
}

interface DeliveryRow {
  id: string;
  mission_id: string;
  objective_id: string;
  session_id: string | null;
  summary: string;
  verification_summary: string | null;
  follow_up_notes: string | null;
  payload_json: string | null;
  delivered_at: string;
  agent_identifier: string | null;
  model_identifier: string | null;
}

/** Returns delivery records without exposing their arbitrary persisted payload JSON. */
export async function listMissionDeliveries(
  missionRef: string,
  limit = 200
): Promise<DeliveryDto[]> {
  const mission = await getMissionRow(missionRef, undefined, PERMISSIONS.MISSION_READ);
  const rows = (await requireDatabaseClient().all(
    `SELECT d.id, d.mission_id, d.objective_id, d.session_id, d.summary,
            d.verification_summary, d.follow_up_notes, d.payload_json, d.delivered_at,
            s.agent_identifier, s.model_identifier
       FROM deliveries d
       LEFT JOIN agent_sessions s ON s.id = d.session_id AND s.deleted_at IS NULL
      WHERE d.mission_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL
      ORDER BY d.delivered_at DESC, d.id DESC
      LIMIT ?`,
    [mission.id, mission.workspace_id, limit]
  )) as DeliveryRow[];

  return rows.map(row => ({
    id: row.id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    sessionId: row.session_id,
    summary: row.summary,
    verificationSummary: row.verification_summary,
    followUpNotes: row.follow_up_notes,
    report: deliveryReportFromPayload(row.payload_json, row.summary),
    deliveredAt: row.delivered_at,
    agentIdentifier: row.agent_identifier,
    modelIdentifier: row.model_identifier
  }));
}

interface FileChangeRow {
  id: string;
  mission_id: string;
  objective_id: string;
  file_path: string;
  label: string | null;
  summary: string | null;
  why: string | null;
  impact: string | null;
  vcs_status: string | null;
  observed_metadata_json: string;
  resource_key: string | null;
  created_at: string;
}

const MAX_FILE_CHANGE_HOOK_HEALTH_LENGTH = 160;
const FILE_CHANGE_HOOK_HEALTH_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;

function projectFileChangeEvidence(metadata: {
  source?: unknown;
  quality?: unknown;
  overlap?: unknown;
  hookHealth?: unknown;
}): {
  source: FileChangeDto['source'];
  quality: FileChangeDto['quality'];
  overlap: boolean;
  hookHealth: string | null;
} {
  const paired =
    (metadata.source === 'declared_edit' && metadata.quality === 'direct') ||
    (metadata.source === 'window_observed' && metadata.quality === 'window');
  const health = typeof metadata.hookHealth === 'string' ? metadata.hookHealth.trim() : '';
  return {
    source: paired ? (metadata.source as FileChangeDto['source']) : null,
    quality: paired ? (metadata.quality as FileChangeDto['quality']) : null,
    overlap: paired && metadata.overlap === true,
    hookHealth:
      health &&
      health.length <= MAX_FILE_CHANGE_HOOK_HEALTH_LENGTH &&
      FILE_CHANGE_HOOK_HEALTH_PATTERN.test(health)
        ? health
        : null
  };
}

/**
 * Returns a mission's observed changed files newest-first for the File Changes
 * section, with an optional rationale. Like the activity feed, the global SSE change feed
 * invalidates the client query so changes recorded by the agent or CLI in
 * another process stream into the panel without a manual refresh.
 */
export async function listMissionFileChanges(
  missionRef: string,
  limit = 200
): Promise<FileChangeDto[]> {
  const mission = await getMissionRow(missionRef);
  const rows = (await requireDatabaseClient().all(
    `WITH ranked_rationales AS (
       SELECT objective_id, file_path, label, summary, why, impact,
              ROW_NUMBER() OVER (
                PARTITION BY objective_id, file_path
                ORDER BY created_at DESC, id DESC
              ) AS rationale_rank
         FROM change_rationales
        WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
     )
     SELECT cf.id, cf.mission_id, cf.objective_id, cf.file_path, cr.label, cr.summary,
              cr.why, cr.impact, cf.last_observed_at AS created_at,
              cf.vcs_status AS vcs_status,
              cf.observed_metadata_json,
              COALESCE(pr_cf.resource_key, o.resource_key) AS resource_key
         FROM changed_files cf
         LEFT JOIN ranked_rationales cr
           ON cr.objective_id = cf.objective_id
          AND cr.file_path = cf.file_path
          AND cr.rationale_rank = 1
         LEFT JOIN objectives o
           ON o.id = cf.objective_id AND o.deleted_at IS NULL
         LEFT JOIN project_resources pr_cf
           ON pr_cf.id = cf.resource_id AND pr_cf.deleted_at IS NULL
        WHERE cf.mission_id = ? AND cf.workspace_id = ?
          AND cf.deleted_at IS NULL
        ORDER BY cf.last_observed_at DESC, cf.id DESC
        LIMIT ?`,
    [mission.id, mission.workspace_id, mission.id, mission.workspace_id, limit]
  )) as FileChangeRow[];
  return rows.map(row => {
    let metadata: {
      source?: unknown;
      quality?: unknown;
      overlap?: unknown;
      hookHealth?: unknown;
    } = {};
    try {
      const parsed = JSON.parse(row.observed_metadata_json) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        metadata = parsed as typeof metadata;
      }
    } catch {
      // Unreadable stored metadata remains reviewable without attribution labels.
    }
    const evidence = projectFileChangeEvidence(metadata);
    return {
      id: row.id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      filePath: row.file_path,
      fileName: row.file_path.split('/').pop() || row.file_path,
      label: row.label,
      summary: row.summary,
      why: row.why,
      impact: row.impact,
      vcsStatus: row.vcs_status,
      source: evidence.source,
      quality: evidence.quality,
      overlap: evidence.overlap,
      hookHealth: evidence.hookHealth,
      resourceKey: row.resource_key?.trim() || null,
      createdAt: row.created_at
    };
  });
}

interface ArtifactRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string | null;
  session_id: string | null;
  delivery_id: string | null;
  type: string;
  label: string;
  content_text: string | null;
  content_json: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

function toArtifactDto(row: ArtifactRow): ArtifactDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    sessionId: row.session_id,
    deliveryId: row.delivery_id,
    type: row.type,
    label: row.label,
    contentText: row.content_text,
    contentJson: row.content_json ? (JSON.parse(row.content_json) as unknown) : null,
    externalUrl: row.external_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision
  };
}

export async function listArtifacts(missionRef: string, limit = 200): Promise<ArtifactDto[]> {
  const mission = await getMissionRow(missionRef, undefined, PERMISSIONS.ARTIFACT_READ);
  const rows = (await requireDatabaseClient().all(
    `SELECT id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
              type, label, content_text, content_json, external_url, created_at, updated_at, revision
         FROM artifacts
        WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    [mission.id, mission.workspace_id, limit]
  )) as ArtifactRow[];
  return rows.map(toArtifactDto);
}

type SharedContextRow = {
  id: string;
  mission_id: string;
  key: string;
  value_kind: string;
  value_text: string | null;
  value_json: string | null;
  updated_at: string;
  revision: number;
};

function toSharedContextEntryDto(row: SharedContextRow): SharedContextEntryDto {
  const valueKind = row.value_kind === 'json' ? 'json' : 'string';
  return {
    id: row.id,
    missionId: row.mission_id,
    key: row.key,
    value:
      valueKind === 'json' && row.value_json
        ? (JSON.parse(row.value_json) as unknown)
        : row.value_text,
    valueKind,
    tags: [],
    updatedAt: row.updated_at,
    revision: row.revision
  };
}

/** GET /api/missions/:id/context — durable shared mission memory. */
export async function listMissionSharedContext(
  missionRef: string,
  limit = 100
): Promise<SharedContextEntryDto[]> {
  const mission = await getMissionRow(missionRef, undefined, PERMISSIONS.MISSION_READ);
  const rows = (await requireDatabaseClient().all(
    `SELECT id, mission_id, key, value_kind, value_text, value_json, updated_at, revision
       FROM shared_context_entries
      WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, key ASC
      LIMIT ?`,
    [mission.id, mission.workspace_id, limit]
  )) as SharedContextRow[];
  return rows.map(toSharedContextEntryDto);
}

/** PUT /api/missions/:id/context — upsert one shared-context entry by key. */
export async function upsertMissionSharedContext(
  missionRef: string,
  body: UpsertSharedContextBody
): Promise<SharedContextEntryDto> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Shared context body must be an object');
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) {
    throw new ApiError(400, 'Shared context key is required');
  }
  if (body.value === undefined) {
    throw new ApiError(400, 'Shared context value is required');
  }

  return requireDatabaseClient().transaction(async tx => {
    const mission = await getMissionRow(missionRef, tx, PERMISSIONS.MISSION_UPDATE);
    const ctx = await buildWebappServiceContextForWorkspace(
      mission.workspace_id,
      tx,
      getActorWorkspaceUserId()
    );
    const written = await writeSharedContext({
      ctx,
      missionId: mission.id,
      key,
      value: body.value
    });

    const row = (await tx.get(
      `SELECT id, mission_id, key, value_kind, value_text, value_json, updated_at, revision
         FROM shared_context_entries
        WHERE id = ? AND workspace_id = ?`,
      [written.id, mission.workspace_id]
    )) as SharedContextRow;

    return toSharedContextEntryDto(row);
  });
}

function normalizeExternalUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'Artifact externalUrl must be a string or null');
  }
  const externalUrl = value.trim() || null;
  if (!externalUrl) return null;
  try {
    const url = new URL(externalUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new ApiError(400, 'Artifact externalUrl must be an http(s) URL');
  }
  return externalUrl;
}

/** Create a mission artifact without a delivery (mid-turn / agent-published). */
export async function createArtifact(
  missionRef: string,
  body: CreateArtifactBody
): Promise<ArtifactDto> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Artifact create body must be an object');
  }

  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!type) {
    throw new ApiError(400, 'Artifact type is required');
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) {
    throw new ApiError(400, 'Artifact label is required');
  }

  let contentText: string | null = null;
  if (body.contentText !== undefined && body.contentText !== null) {
    if (typeof body.contentText !== 'string') {
      throw new ApiError(400, 'Artifact contentText must be a string or null');
    }
    contentText = body.contentText.trim() ? body.contentText : null;
  }
  const externalUrl = normalizeExternalUrl(body.externalUrl);
  if (!contentText && !externalUrl) {
    throw new ApiError(400, 'Provide contentText and/or externalUrl');
  }

  return requireDatabaseClient().transaction(async tx => {
    const mission = await getMissionRow(missionRef, tx, PERMISSIONS.ARTIFACT_CREATE);

    let objectiveId: string | null =
      typeof body.objectiveId === 'string' && body.objectiveId.trim()
        ? body.objectiveId.trim()
        : null;
    let sessionId: string | null =
      typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null;

    const sessionKey =
      typeof body.sessionKey === 'string' && body.sessionKey.trim() ? body.sessionKey.trim() : null;
    if (sessionKey) {
      const session = (await tx.get(
        `SELECT id, mission_id, objective_id
           FROM agent_sessions
          WHERE workspace_id = ? AND session_key_hash = ? AND ended_at IS NULL AND deleted_at IS NULL
          ORDER BY started_at DESC LIMIT 1`,
        [mission.workspace_id, hashSessionKey(sessionKey)]
      )) as { id: string; mission_id: string; objective_id: string } | undefined;
      if (!session) {
        throw new ApiError(401, 'Invalid or ended session key');
      }
      if (session.mission_id !== mission.id) {
        throw new ApiError(400, 'Session key does not match mission');
      }
      sessionId = session.id;
      objectiveId = session.objective_id;
    } else if (objectiveId) {
      // Protocol/MCP callers pass the objective display id (`coo:756.k7xm`) far
      // more often than the UUID, so resolve the reference before matching.
      const resolvedRef = await resolveObjectiveIdForRest({ ref: objectiveId, db: tx });
      const objective = (await tx.get(
        `SELECT id FROM objectives
          WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [resolvedRef.id, mission.id, mission.workspace_id]
      )) as { id: string } | undefined;
      if (!objective) {
        throw new ApiError(404, 'Objective not found on mission');
      }
      objectiveId = objective.id;
    } else if (sessionId) {
      const session = (await tx.get(
        `SELECT id, objective_id FROM agent_sessions
          WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [sessionId, mission.id, mission.workspace_id]
      )) as { id: string; objective_id: string } | undefined;
      if (!session) {
        throw new ApiError(404, 'Session not found on mission');
      }
      if (!objectiveId) objectiveId = session.objective_id;
    }

    const now = nowIso();
    const ctx = await buildWebappServiceContextForWorkspace(
      mission.workspace_id,
      tx,
      getActorWorkspaceUserId()
    );
    let id: string;
    try {
      ({ id } = await insertArtifactRow({
        ctx,
        workspaceId: mission.workspace_id,
        projectId: mission.project_id,
        missionId: mission.id,
        objectiveId,
        sessionId,
        deliveryId: null,
        type,
        label,
        contentText,
        externalUrl,
        createdByWorkspaceUserId: getActorWorkspaceUserId(),
        now
      }));
    } catch (error) {
      if (error instanceof ServiceError) {
        throw new ApiError(error.status, error.message, undefined, error.code);
      }
      throw error;
    }

    const created = (await tx.get(
      `SELECT id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
              type, label, content_text, content_json, external_url, created_at, updated_at, revision
         FROM artifacts
        WHERE id = ? AND workspace_id = ?`,
      [id, mission.workspace_id]
    )) as ArtifactRow;

    await recordChange(
      {
        entityType: 'artifact',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        workspaceId: mission.workspace_id,
        projectId: mission.project_id,
        missionId: mission.id,
        objectiveId,
        changedFields: ['type', 'label', 'content_text', 'external_url']
      },
      tx
    );
    return toArtifactDto(created);
  });
}

/** Update the human-facing presentation fields of an existing mission artifact. */
export async function updateArtifact(
  missionRef: string,
  artifactId: string,
  body: UpdateArtifactBody
): Promise<ArtifactDto> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Artifact update body must be an object');
  }

  return requireDatabaseClient().transaction(async tx => {
    const mission = await getMissionRow(missionRef, tx, PERMISSIONS.MISSION_UPDATE);
    const artifact = (await tx.get(
      `SELECT id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
              type, label, content_text, content_json, external_url, created_at, updated_at, revision
         FROM artifacts
        WHERE id = ? AND mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [artifactId, mission.id, mission.workspace_id]
    )) as ArtifactRow | undefined;
    if (!artifact) throw new ApiError(404, 'Artifact not found');
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) {
      throw new ApiError(400, 'Artifact expectedRevision must be a positive integer');
    }
    if (body.expectedRevision !== artifact.revision) {
      throw new ApiError(409, 'Artifact was updated by someone else; refresh and try again');
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const changedFields: string[] = [];
    let contentText = artifact.content_text;
    let externalUrl = artifact.external_url;

    if (body.label !== undefined) {
      if (typeof body.label !== 'string' || !body.label.trim()) {
        throw new ApiError(400, 'Artifact label cannot be empty');
      }
      fields.push('label = ?');
      params.push(body.label.trim());
      changedFields.push('label');
    }
    if (body.contentText !== undefined) {
      if (body.contentText !== null && typeof body.contentText !== 'string') {
        throw new ApiError(400, 'Artifact contentText must be a string or null');
      }
      contentText = body.contentText?.trim() ? body.contentText : null;
      fields.push('content_text = ?');
      params.push(contentText);
      changedFields.push('content_text');
    }
    if (body.externalUrl !== undefined) {
      if (body.externalUrl !== null && typeof body.externalUrl !== 'string') {
        throw new ApiError(400, 'Artifact externalUrl must be a string or null');
      }
      externalUrl = body.externalUrl?.trim() || null;
      if (externalUrl) {
        try {
          const url = new URL(externalUrl);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Unsupported protocol');
          }
        } catch {
          throw new ApiError(400, 'Artifact externalUrl must be an http(s) URL');
        }
      }
      fields.push('external_url = ?');
      params.push(externalUrl);
      changedFields.push('external_url');
    }
    if (fields.length === 0) {
      throw new ApiError(400, 'Provide at least one editable artifact field');
    }
    if (!contentText && !artifact.content_json && !externalUrl) {
      throw new ApiError(400, 'An artifact must retain text, structured content, or a URL');
    }

    const updatedAt = nowIso();
    const revision = artifact.revision + 1;
    await tx.run(
      `UPDATE artifacts
          SET ${fields.join(', ')}, updated_at = ?, revision = ?
        WHERE id = ? AND workspace_id = ? AND revision = ?`,
      [...params, updatedAt, revision, artifact.id, mission.workspace_id, artifact.revision]
    );
    const updated = (await tx.get(
      `SELECT id, workspace_id, project_id, mission_id, objective_id, session_id, delivery_id,
              type, label, content_text, content_json, external_url, created_at, updated_at, revision
         FROM artifacts
        WHERE id = ? AND workspace_id = ?`,
      [artifact.id, mission.workspace_id]
    )) as ArtifactRow;

    await recordChange(
      {
        entityType: 'artifact',
        entityId: artifact.id,
        operation: 'update',
        entityRevision: revision,
        workspaceId: mission.workspace_id,
        projectId: mission.project_id,
        missionId: mission.id,
        objectiveId: artifact.objective_id,
        changedFields
      },
      tx
    );
    return toArtifactDto(updated);
  });
}

async function nextMissionSequence(db: DatabaseClient, workspaceId: string): Promise<number> {
  // Allocate the next workspace-scoped mission number, creating the counter row
  // if a fresh database somehow lacks it.
  const row = (await db.get(
    `SELECT id, next_value FROM mission_sequences
         WHERE workspace_id = ? AND scope_type = 'workspace'
           AND scope_id = ? AND counter_name = 'mission'`,
    [workspaceId, workspaceId]
  )) as { id: string; next_value: number } | undefined;

  if (!row) {
    const seq = 1;
    await db.run(
      `INSERT INTO mission_sequences (id, workspace_id, scope_type, scope_id, counter_name, next_value, updated_at)
       VALUES (?, ?, 'workspace', ?, 'mission', ?, ?)`,
      [newId(), workspaceId, workspaceId, seq + 1, nowIso()]
    );
    return seq;
  }

  const seq = row.next_value;
  await db.run(`UPDATE mission_sequences SET next_value = ?, updated_at = ? WHERE id = ?`, [
    seq + 1,
    nowIso(),
    row.id
  ]);
  return seq;
}

type CreateMissionResult = {
  missionId: string;
  objectiveIds: string[];
  instruction: string;
  shouldGenerateMissionTitle: boolean;
};

async function createMissionTx(
  body: CreateMissionBody,
  client: DatabaseClient = requireDatabaseClient(),
  alreadyInTransaction = false
): Promise<CreateMissionResult> {
  const execute = async (tx: DatabaseClient): Promise<CreateMissionResult> => {
    const objectiveInputs =
      body.objectives && body.objectives.length > 0
        ? body.objectives
        : body.firstObjective
          ? [{ objective: body.firstObjective }]
          : [];
    const instruction = (objectiveInputs[0]?.objective ?? body.title ?? '').trim();
    if (!instruction) {
      throw new ApiError(400, 'Describe the work to be done (title or first objective)');
    }

    const explicitTitle = (body.title ?? '').trim();

    // Resolve the target project's own workspace (coo:135) — a mission created
    // on a secondary-workspace project must not be validated/stamped against the
    // request's active workspace, mirroring `requireProjectPermission`.
    const { workspaceId, workspaceUserId } = await requireProjectPermission({
      projectId: body.projectId,
      permission: PERMISSIONS.MISSION_CREATE,
      db: tx
    });

    // REST-specific request validation stays here, ahead of the shared create,
    // so the API keeps answering 400 for malformed input rather than surfacing a
    // service-layer error shape.
    const priority = body.priority ?? 'normal';
    if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
      throw new ApiError(400, 'Invalid priority');
    }
    if (
      body.dueDatetime !== undefined &&
      body.dueDatetime !== null &&
      Number.isNaN(Date.parse(body.dueDatetime))
    ) {
      throw new ApiError(400, 'dueDatetime must be a valid ISO-8601 datetime or null');
    }

    // The board can create a mission straight into a chosen column; validating
    // the id here keeps a project-scoped error and lets
    // the shared create take an already-checked status.
    if (body.statusId) await getProjectStatus(tx, body.projectId, body.statusId);

    // Unlike the agent surfaces, a REST-created mission defaults to being owned
    // by whoever created it.
    const assignedWorkspaceUserId =
      body.assignedWorkspaceUserId === undefined
        ? workspaceUserId
        : await resolveAssignedWorkspaceUserId(tx, workspaceId, body.assignedWorkspaceUserId);

    const ctx = await buildWebappServiceContextForWorkspace(workspaceId, tx, workspaceUserId);
    const created = await createMissionWithObjectives({
      ctx,
      projectId: body.projectId,
      objectives: objectiveInputs.map(item => ({
        objective: item.objective,
        ...(item.title !== undefined ? { title: item.title } : {}),
        autoAdvance: item.autoAdvance ?? false,
        ...(item.resourceKey !== undefined ? { resourceKey: item.resourceKey } : {})
      })),
      title: explicitTitle || initialTitleFromInstruction(instruction),
      ...(body.statusId ? { statusId: body.statusId } : {}),
      priority,
      dueDatetime: body.dueDatetime ?? null,
      assignedWorkspaceUserId,
      ...(body.tagIds !== undefined ? { tagIds: body.tagIds } : {})
    });

    return {
      missionId: created.mission.id,
      objectiveIds: created.objectives.map(objective => objective.id),
      instruction,
      shouldGenerateMissionTitle: !explicitTitle
    };
  };
  return alreadyInTransaction ? execute(client) : client.transaction(execute);
}

/**
 * Replace a mission's tag assignments. De-duplicates the input and validates that
 * every tag belongs to the mission's project (and is not soft-deleted) so a mission
 * can never carry a foreign-project tag. Unknown or cross-project tag ids raise a 400.
 */
async function syncMissionTags(
  db: DatabaseClient,
  {
    workspaceId,
    projectId,
    missionId,
    tagIds,
    now
  }: {
    workspaceId: string;
    projectId: string;
    missionId: string;
    tagIds: string[];
    now: string;
  }
): Promise<void> {
  const unique = [...new Set(tagIds.map(value => value.trim()).filter(Boolean))];

  for (const tagId of unique) {
    const tag = (await db.get(
      `SELECT id FROM project_tags
       WHERE id = ? AND project_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [tagId, projectId, workspaceId]
    )) as { id: string } | undefined;
    if (!tag) throw new ApiError(400, 'Tag does not belong to this project');
  }

  if (unique.length === 0) {
    await db.run(`DELETE FROM mission_tags WHERE mission_id = ?`, [missionId]);
    return;
  }

  const placeholders = unique.map(() => '?').join(', ');
  await db.run(
    `DELETE FROM mission_tags WHERE mission_id = ? AND tag_id NOT IN (${placeholders})`,
    [missionId, ...unique]
  );

  for (const tagId of unique) {
    // Portable upsert-ignore: works on both modern SQLite and PostgreSQL.
    await db.run(
      `INSERT INTO mission_tags (mission_id, tag_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      [missionId, tagId, now]
    );
  }
}

/**
 * Assign tag definitions to a mission that has none yet. Intended to run inside
 * the create transaction; delegates to the shared service helper that mission
 * creation itself uses, so the "tag must belong to this project" rule has one
 * implementation on the create path.
 */
async function assignMissionTags(
  db: DatabaseClient,
  {
    workspaceId,
    missionId,
    projectId,
    tagIds,
    now
  }: {
    workspaceId: string;
    missionId: string;
    projectId: string;
    tagIds: string[] | undefined;
    now: string;
  }
): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;
  const ctx = await buildWebappServiceContextForWorkspace(workspaceId, db);
  await assignMissionTagsOnCreate({ ctx, missionId, projectId, tagIds, now });
}

export async function createMission(body: CreateMissionBody): Promise<MissionDetailDto> {
  const { missionId, objectiveIds, instruction, shouldGenerateMissionTitle } =
    await createMissionTx(body);
  const detail = await getMissionDetail(missionId);

  if (shouldGenerateMissionTitle) {
    scheduleMissionTitleGeneration({
      missionId: detail.id,
      projectId: detail.projectId,
      instructionText: instruction
    });
  }

  const firstObjectiveId = objectiveIds[0];
  if (firstObjectiveId) {
    scheduleObjectiveTitleGeneration({
      objectiveId: firstObjectiveId,
      projectId: detail.projectId,
      missionId: detail.id,
      instructionText: instruction
    });
  }

  return detail;
}

type InboxItemRow = {
  id: string;
  title: string;
  objectives_json: string;
  due_datetime: string | null;
  priority: InboxItemDto['priority'];
  created_at: string;
  updated_at: string;
};

function validateInboxBody(body: {
  title?: unknown;
  objectives?: unknown;
  dueDatetime?: unknown;
  priority?: unknown;
}): {
  title: string;
  objectives: string[];
  dueDatetime: string | null;
  priority: InboxItemDto['priority'];
} {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new ApiError(400, 'Inbox title is required');
  if (!Array.isArray(body.objectives) || body.objectives.length !== 1) {
    throw new ApiError(400, 'Inbox objectives must contain exactly one item');
  }
  const objectives = body.objectives.map(item => (typeof item === 'string' ? item.trim() : ''));
  if (!objectives[0]) throw new ApiError(400, 'Inbox objective is required');
  const dueDatetime =
    body.dueDatetime === undefined || body.dueDatetime === null ? null : body.dueDatetime;
  if (
    dueDatetime !== null &&
    (typeof dueDatetime !== 'string' || Number.isNaN(Date.parse(dueDatetime)))
  ) {
    throw new ApiError(400, 'dueDatetime must be a valid ISO-8601 datetime or null');
  }
  const priority = body.priority === undefined || body.priority === null ? null : body.priority;
  if (priority !== null && !['low', 'normal', 'high', 'urgent'].includes(String(priority))) {
    throw new ApiError(400, 'Invalid priority');
  }
  return { title, objectives, dueDatetime, priority: priority as InboxItemDto['priority'] };
}

function toInboxItemDto(row: InboxItemRow): InboxItemDto {
  let objectives: string[];
  try {
    objectives = JSON.parse(row.objectives_json) as string[];
  } catch {
    throw new ApiError(500, 'Stored inbox item is invalid');
  }
  return {
    id: row.id,
    title: row.title,
    objectives,
    dueDatetime: row.due_datetime,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function activeInboxProfileId(db: DatabaseClient): Promise<string> {
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  return profileId;
}

async function ownedInboxRow(
  db: DatabaseClient,
  profileId: string,
  id: string
): Promise<InboxItemRow> {
  const row = await db.get<InboxItemRow>(
    `SELECT id, title, objectives_json, due_datetime, priority, created_at, updated_at
       FROM inbox_items WHERE id = ? AND profile_id = ?`,
    [id, profileId]
  );
  if (!row) throw new ApiError(404, 'Inbox item not found');
  return row;
}

export async function listInboxItems(): Promise<InboxItemDto[]> {
  const db = requireDatabaseClient();
  const profileId = await activeInboxProfileId(db);
  const rows = await db.all<InboxItemRow>(
    `SELECT id, title, objectives_json, due_datetime, priority, created_at, updated_at
       FROM inbox_items WHERE profile_id = ? ORDER BY created_at DESC`,
    [profileId]
  );
  return rows.map(toInboxItemDto);
}

export async function getInboxItem(id: string): Promise<InboxItemDto> {
  const db = requireDatabaseClient();
  return toInboxItemDto(await ownedInboxRow(db, await activeInboxProfileId(db), id));
}

export async function createInboxItem(body: CreateInboxItemBody): Promise<InboxItemDto> {
  const db = requireDatabaseClient();
  const profileId = await activeInboxProfileId(db);
  const input = validateInboxBody(body);
  const now = nowIso();
  const row: InboxItemRow = {
    id: newId(),
    title: input.title,
    objectives_json: JSON.stringify(input.objectives),
    due_datetime: input.dueDatetime,
    priority: input.priority,
    created_at: now,
    updated_at: now
  };
  await db.run(
    `INSERT INTO inbox_items (id, profile_id, title, objectives_json, due_datetime, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, profileId, row.title, row.objectives_json, row.due_datetime, row.priority, now, now]
  );
  return toInboxItemDto(row);
}

export async function updateInboxItem(
  id: string,
  body: UpdateInboxItemBody
): Promise<InboxItemDto> {
  const db = requireDatabaseClient();
  const profileId = await activeInboxProfileId(db);
  const existing = await ownedInboxRow(db, profileId, id);
  const input = validateInboxBody({
    title: body.title ?? existing.title,
    objectives: body.objectives ?? JSON.parse(existing.objectives_json),
    dueDatetime: body.dueDatetime === undefined ? existing.due_datetime : body.dueDatetime,
    priority: body.priority === undefined ? existing.priority : body.priority
  });
  const now = nowIso();
  await db.run(
    `UPDATE inbox_items SET title = ?, objectives_json = ?, due_datetime = ?, priority = ?, updated_at = ?
      WHERE id = ? AND profile_id = ?`,
    [
      input.title,
      JSON.stringify(input.objectives),
      input.dueDatetime,
      input.priority,
      now,
      id,
      profileId
    ]
  );
  return {
    id,
    title: input.title,
    objectives: input.objectives,
    dueDatetime: input.dueDatetime,
    priority: input.priority,
    createdAt: existing.created_at,
    updatedAt: now
  };
}

export async function deleteInboxItem(id: string): Promise<void> {
  const db = requireDatabaseClient();
  const profileId = await activeInboxProfileId(db);
  await ownedInboxRow(db, profileId, id);
  await db.run(`DELETE FROM inbox_items WHERE id = ? AND profile_id = ?`, [id, profileId]);
}

export async function promoteInboxItem(id: string, projectId: string): Promise<MissionDetailDto> {
  const db = requireDatabaseClient();
  const profileId = await activeInboxProfileId(db);
  const missionId = await db.transaction(async tx => {
    const item = await ownedInboxRow(tx, profileId, id);
    const objectives = JSON.parse(item.objectives_json) as string[];
    const created = await createMissionTx(
      {
        projectId,
        title: item.title,
        objectives: objectives.map(objective => ({ objective })),
        dueDatetime: item.due_datetime,
        ...(item.priority ? { priority: item.priority } : {})
      },
      tx,
      true
    );
    await tx.run(`DELETE FROM inbox_items WHERE id = ? AND profile_id = ?`, [id, profileId]);
    return created.missionId;
  });
  return getMissionDetail(missionId);
}

/**
 * Manually (re)generates a mission's title via the Automations Layer
 * summarizer, using the same instruction-text source as creation-time
 * generation (the earliest-position objective with non-empty instructions).
 * Persists the result and returns the refreshed mission detail.
 */
export async function generateMissionTitle(missionRef: string): Promise<MissionDetailDto> {
  const detail = await getMissionDetail(missionRef);
  const instructionText = detail.objectives
    .find(objective => objective.instructionText.trim().length > 0)
    ?.instructionText.trim();
  if (!instructionText) {
    throw new ApiError(400, 'Add an objective before generating a title.');
  }

  const title = await generateMissionTitleNow({
    missionId: detail.id,
    projectId: detail.projectId,
    instructionText
  });
  if (!title) {
    throw new ApiError(502, 'Failed to generate a title.');
  }

  return getMissionDetail(missionRef);
}

/**
 * Validate a mission assignee. Returns the `workspace_users.id` when it names an
 * active member of the current workspace, or `null` to unassign. Throws 400 for
 * an unknown member so callers cannot point a mission at a foreign workspace.
 */
async function resolveAssignedWorkspaceUserId(
  db: DatabaseClient,
  workspaceId: string,
  value: string | null | undefined
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const member = (await db.get(
    `SELECT id FROM workspace_users
        WHERE id = ? AND workspace_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [trimmed, workspaceId]
  )) as { id: string } | undefined;
  if (!member) throw new ApiError(400, 'Assignee is not a member of this workspace');
  return member.id;
}

async function patchMissionFieldsTx(id: string, body: UpdateMissionBody): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await getMissionRow(id, tx, PERMISSIONS.MISSION_UPDATE);

    const fields: string[] = [];
    const setParams: unknown[] = [];
    const changed: string[] = [];

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) throw new ApiError(400, 'Mission title cannot be empty');
      fields.push('title = ?');
      setParams.push(title);
      changed.push('title');
    }
    if (body.priority !== undefined) {
      if (body.priority !== null && !['low', 'normal', 'high', 'urgent'].includes(body.priority)) {
        throw new ApiError(400, 'Invalid priority');
      }
      fields.push('priority = ?');
      setParams.push(body.priority);
      changed.push('priority');
    }
    if (body.assignedWorkspaceUserId !== undefined) {
      fields.push('assigned_workspace_user_id = ?');
      setParams.push(
        await resolveAssignedWorkspaceUserId(
          tx,
          existing.workspace_id,
          body.assignedWorkspaceUserId
        )
      );
      changed.push('assigned_workspace_user_id');
    }
    let scheduleTriggerStatusType: StatusType | null = null;
    let returnedToExecute = false;
    if (body.statusId !== undefined) {
      const statusRow = await getProjectStatus(tx, existing.project_id, body.statusId);
      fields.push('status_id = ?', 'status_type = ?');
      setParams.push(statusRow.id, statusRow.type);
      changed.push('status_id', 'status_type');
      if (statusRow.id !== existing.status_id) {
        fields.push('board_position = ?');
        setParams.push(await topBoardPosition(tx, existing.project_id, statusRow.id, id));
        changed.push('board_position');
        // Only an actual transition into this status should spawn a scheduled
        // duplicate — re-saving the same status (e.g. a no-op PATCH) must not.
        scheduleTriggerStatusType = statusRow.type as StatusType;
        if (statusRow.type === 'execute' && existing.status_type !== 'execute') {
          returnedToExecute = true;
        }
      }
    }
    if (body.notes !== undefined) {
      fields.push('notes_text = ?');
      setParams.push(body.notes?.trim() || null);
      changed.push('notes_text');
    }
    if (body.branchOverride !== undefined) {
      const override = body.branchOverride?.trim() || null;
      fields.push('branch_override = ?');
      setParams.push(override);
      changed.push('branch_override');
    }
    if (body.worktreePreference !== undefined) {
      const preference = body.worktreePreference;
      if (preference !== null && preference !== 'worktree' && preference !== 'branch') {
        throw new ApiError(400, "worktreePreference must be 'worktree', 'branch', or null");
      }
      fields.push('worktree_preference = ?');
      setParams.push(preference);
      changed.push('worktree_preference');
    }
    if (body.allowParallelObjectives !== undefined) {
      if (typeof body.allowParallelObjectives !== 'boolean') {
        throw new ApiError(400, 'allowParallelObjectives must be a boolean');
      }
      fields.push('allow_parallel_objectives = ?');
      setParams.push(bindBool(DATABASE_DIALECT, body.allowParallelObjectives));
      changed.push('allow_parallel_objectives');
    }
    if (body.resetActiveBranch === true) {
      if (!existing.active_branch?.trim()) {
        throw new ApiError(400, 'Mission has no prepared branch to reset.');
      }
      fields.push('active_branch = ?');
      setParams.push(null);
      changed.push('active_branch');
      await tx.run(
        `DELETE FROM mission_branch_observations
          WHERE workspace_id = ? AND mission_id = ?`,
        [existing.workspace_id, id]
      );
    }
    if (body.dueDatetime !== undefined) {
      if (body.dueDatetime !== null && Number.isNaN(Date.parse(body.dueDatetime))) {
        throw new ApiError(400, 'dueDatetime must be a valid ISO-8601 datetime or null');
      }
      fields.push('due_datetime = ?');
      setParams.push(body.dueDatetime);
      changed.push('due_datetime');
    }

    const now = nowIso();
    if (returnedToExecute) {
      fields.push('returned_to_execute_at = ?');
      setParams.push(now);
      changed.push('returned_to_execute_at');
    }
    const tagsChanged = body.tagIds !== undefined;
    if (tagsChanged) {
      await syncMissionTags(tx, {
        workspaceId: existing.workspace_id,
        missionId: id,
        projectId: existing.project_id,
        tagIds: body.tagIds ?? [],
        now
      });
      changed.push('tags');
    }

    if (fields.length === 0 && !tagsChanged) return;

    const revision = existing.revision + 1;
    if (fields.length > 0) {
      await tx.run(
        `UPDATE missions SET ${fields.join(', ')}, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [...setParams, now, revision, id, existing.workspace_id]
      );
    } else {
      await tx.run(
        `UPDATE missions SET updated_at = ?, revision = ? WHERE id = ? AND workspace_id = ?`,
        [now, revision, id, existing.workspace_id]
      );
    }

    await recordChange(
      {
        entityType: 'mission',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        projectId: existing.project_id,
        missionId: id,
        changedFields: changed,
        workspaceId: existing.workspace_id
      },
      tx
    );

    // Turning parallel objectives on releases every sibling this mission was
    // holding across all queues; turning it off may require new waits. Either
    // way the dispatcher's picture of this mission just changed.
    if (changed.includes('allow_parallel_objectives')) {
      await enqueueRunQueueDispatch(tx, existing.project_id, existing.workspace_id);
    }

    if (scheduleTriggerStatusType) {
      await createScheduledDuplicateIfNeeded(tx, existing, scheduleTriggerStatusType);
    }

    // Closing the mission is the end of the story the assignee has been tracking,
    // so it earns its own category rather than another awaiting-review ping.
    if (scheduleTriggerStatusType === 'complete' && existing.status_type !== 'complete') {
      await emitNotification({
        db: tx,
        workspaceId: existing.workspace_id,
        missionId: id,
        type: 'mission_complete',
        now
      });
    }
    if (returnedToExecute) {
      await emitNotification({
        db: tx,
        workspaceId: existing.workspace_id,
        missionId: id,
        type: 'returned_to_execute',
        now
      });
    }
  });
}

async function moveMissionProjectTx({
  id,
  body,
  existing,
  targetProjectId,
  statusRow
}: {
  id: string;
  body: UpdateMissionBody;
  existing: MissionRow;
  targetProjectId: string;
  statusRow: ProjectStatusRow;
}): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    // On PostgreSQL the composite mission/objective FKs are deferred for the unit
    // of work instead of toggling a connection pragma (the SQLite path disables
    // `foreign_keys` around this transaction in `updateMission`).
    if (tx.dialect === 'postgres') {
      await tx.exec('SET CONSTRAINTS ALL DEFERRED');
    }

    const fields = ['project_id = ?', 'status_id = ?', 'status_type = ?', 'board_position = ?'];
    const setParams: unknown[] = [
      targetProjectId,
      statusRow.id,
      statusRow.type,
      await topBoardPosition(tx, targetProjectId, statusRow.id, id)
    ];
    const changed = ['project_id', 'status_id', 'status_type', 'board_position'];

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) throw new ApiError(400, 'Mission title cannot be empty');
      fields.push('title = ?');
      setParams.push(title);
      changed.push('title');
    }
    if (body.priority !== undefined) {
      if (body.priority !== null && !['low', 'normal', 'high', 'urgent'].includes(body.priority)) {
        throw new ApiError(400, 'Invalid priority');
      }
      fields.push('priority = ?');
      setParams.push(body.priority);
      changed.push('priority');
    }
    if (body.assignedWorkspaceUserId !== undefined) {
      fields.push('assigned_workspace_user_id = ?');
      setParams.push(
        await resolveAssignedWorkspaceUserId(
          tx,
          existing.workspace_id,
          body.assignedWorkspaceUserId
        )
      );
      changed.push('assigned_workspace_user_id');
    }
    if (body.notes !== undefined) {
      fields.push('notes_text = ?');
      setParams.push(body.notes?.trim() || null);
      changed.push('notes_text');
    }

    const now = nowIso();
    const returnedToExecute = statusRow.type === 'execute' && existing.status_type !== 'execute';
    if (returnedToExecute) {
      fields.push('returned_to_execute_at = ?');
      setParams.push(now);
      changed.push('returned_to_execute_at');
    }
    const revision = existing.revision + 1;
    await cascadeMissionProjectId(tx, {
      workspaceId: existing.workspace_id,
      missionId: id,
      newProjectId: targetProjectId,
      now
    });
    await tx.run(
      `UPDATE missions SET ${fields.join(', ')}, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [...setParams, now, revision, id, existing.workspace_id]
    );

    await recordChange(
      {
        entityType: 'mission',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        projectId: targetProjectId,
        missionId: id,
        changedFields: changed,
        workspaceId: existing.workspace_id
      },
      tx
    );
    if (returnedToExecute) {
      await emitNotification({
        db: tx,
        workspaceId: existing.workspace_id,
        missionId: id,
        type: 'returned_to_execute',
        now
      });
    }
  });
}

/** PATCH /api/missions/:id — field updates and cross-project moves. */
export async function updateMission(
  id: string,
  body: UpdateMissionBody
): Promise<MissionDetailDto> {
  const client = requireDatabaseClient();
  const existing = await getMissionRow(id, undefined, PERMISSIONS.MISSION_UPDATE);
  if (body.projectId !== undefined && body.projectId !== existing.project_id) {
    // A cross-project move must stay within the mission's own workspace — the
    // mission's display_id and workspace-scoped statuses/sequence are tied to
    // that workspace, not the request's active one (coo:135).
    const targetProject = (await client.get(
      `SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [body.projectId, existing.workspace_id]
    )) as { id: string } | undefined;
    if (!targetProject) throw new ApiError(404, 'Project not found');

    const sourceStatus = await getProjectStatus(client, existing.project_id, existing.status_id);
    let statusRow: ProjectStatusRow | undefined;
    if (body.statusId) {
      statusRow = await getProjectStatus(client, targetProject.id, body.statusId);
    } else {
      statusRow = (await client.get(
        `SELECT * FROM project_statuses WHERE project_id = ? AND key = ? AND deleted_at IS NULL`,
        [targetProject.id, sourceStatus.key]
      )) as ProjectStatusRow | undefined;
      if (!statusRow) {
        statusRow = (await client.get(
          `SELECT * FROM project_statuses
            WHERE project_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL`,
          [targetProject.id, sourceStatus.name]
        )) as ProjectStatusRow | undefined;
      }
      if (!statusRow) {
        statusRow = (await client.get(
          `SELECT * FROM project_statuses
            WHERE project_id = ? AND is_default = ? AND deleted_at IS NULL LIMIT 1`,
          [targetProject.id, bindBool(client.dialect, true)]
        )) as ProjectStatusRow | undefined;
      }
    }
    if (!statusRow) throw new ApiError(409, 'Project has no default status');

    // Composite mission/objective FKs require briefly disabling enforcement; SQLite
    // will not allow toggling the pragma inside an open transaction, so it is done
    // around the transaction here (Postgres defers the constraints inside the tx).
    if (client.dialect === 'sqlite') await client.exec('PRAGMA foreign_keys = OFF');
    try {
      await moveMissionProjectTx({
        id,
        body,
        existing,
        targetProjectId: body.projectId,
        statusRow
      });
    } finally {
      if (client.dialect === 'sqlite') await client.exec('PRAGMA foreign_keys = ON');
    }
    return getMissionDetail(id);
  }

  await patchMissionFieldsTx(id, body);
  return getMissionDetail(id);
}

export async function deleteMissions(
  missionRefs: string[]
): Promise<{ deletedMissionIds: string[] }> {
  if (missionRefs.length === 0) throw new ApiError(400, 'At least one mission is required');

  return requireDatabaseClient().transaction(async tx => {
    const missions: MissionRow[] = [];
    for (const missionRef of missionRefs) {
      missions.push(await getMissionRow(missionRef, tx, PERMISSIONS.MISSION_DELETE));
    }
    if (new Set(missions.map(mission => mission.id)).size !== missions.length) {
      throw new ApiError(400, 'missionIds contains duplicate missions');
    }

    const now = nowIso();
    for (const existing of missions) {
      const revision = existing.revision + 1;
      // Soft-delete the mission and its objectives so referential integrity holds.
      await tx.run(
        `UPDATE objectives SET deleted_at = ?, revision = revision + 1
         WHERE mission_id = ? AND deleted_at IS NULL`,
        [now, existing.id]
      );
      await tx.run(
        `UPDATE missions SET deleted_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [now, revision, existing.id, existing.workspace_id]
      );

      await recordChange(
        {
          entityType: 'mission',
          entityId: existing.id,
          operation: 'delete',
          entityRevision: revision,
          projectId: existing.project_id,
          missionId: existing.id,
          workspaceId: existing.workspace_id
        },
        tx
      );
    }

    return { deletedMissionIds: missions.map(mission => mission.id) };
  });
}

export async function deleteMission(id: string): Promise<void> {
  await deleteMissions([id]);
}

export async function deleteObjectives(
  objectiveRefs: string[]
): Promise<{ deletedObjectiveIds: string[] }> {
  if (objectiveRefs.length === 0) throw new ApiError(400, 'At least one objective is required');

  return requireDatabaseClient().transaction(async tx => {
    const objectives: Array<{
      existing: ObjectiveRow;
      workspaceId: string;
      workspaceUserId: string;
    }> = [];
    for (const objectiveRef of objectiveRefs) {
      const { workspaceId, workspaceUserId, objectiveId } = await requireObjectivePermission({
        objectiveId: objectiveRef,
        permission: PERMISSIONS.OBJECTIVE_UPDATE,
        db: tx
      });
      const existing = (await tx.get(
        `SELECT o.*, m.display_id AS mission_display_id
           FROM objectives o
           JOIN missions m ON m.id = o.mission_id
          WHERE o.id = ? AND o.workspace_id = ? AND o.deleted_at IS NULL`,
        [objectiveId, workspaceId]
      )) as ObjectiveRow | undefined;
      if (!existing) throw new ApiError(404, 'Objective not found');
      objectives.push({ existing, workspaceId, workspaceUserId });
    }
    if (new Set(objectives.map(({ existing }) => existing.id)).size !== objectives.length) {
      throw new ApiError(400, 'objectiveIds contains duplicate objectives');
    }

    const now = nowIso();
    for (const { existing, workspaceId, workspaceUserId } of objectives) {
      const revision = existing.revision + 1;
      await tx.run(
        `UPDATE objectives SET deleted_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [now, revision, existing.id, workspaceId]
      );

      await recordChange(
        {
          entityType: 'objective',
          entityId: existing.id,
          operation: 'delete',
          entityRevision: revision,
          projectId: existing.project_id,
          missionId: existing.mission_id,
          objectiveId: existing.id,
          workspaceId
        },
        tx
      );

      // A deleted objective must also leave the runner queue: the runner's claim
      // query joins objectives without filtering soft-deletes, so stale queued
      // requests could otherwise still be claimed.
      await dequeueObjective({
        objectiveId: existing.id,
        projectId: existing.project_id,
        missionId: existing.mission_id,
        workspaceId,
        workspaceUserId,
        reason: 'deleted',
        newState: null,
        now,
        tx
      });
    }

    return { deletedObjectiveIds: objectives.map(({ existing }) => existing.id) };
  });
}

/**
 * Reorder one board column. `orderedMissionIds` is the full top-to-bottom order
 * the `statusId` column should have afterwards. Each mission is renumbered to a
 * dense gap-based position (100, 200, 300, …); any mission arriving from another
 * column also has its status changed to match. Missions whose status and
 * position are already correct are skipped so no redundant change feed rows are
 * written. Returns the destination column in its new order.
 */
export async function reorderBoardColumn(
  projectId: string,
  body: ReorderBoardColumnBody
): Promise<MissionDto[]> {
  const statusId = body.statusId;
  const orderedIds = body.orderedMissionIds;
  if (!statusId) throw new ApiError(400, 'statusId is required');
  if (!Array.isArray(orderedIds)) throw new ApiError(400, 'orderedMissionIds must be an array');

  await requireDatabaseClient().transaction(async tx => {
    const { workspaceId, workspaceUserId } = await requireProjectPermission({
      projectId,
      permission: PERMISSIONS.MISSION_UPDATE,
      db: tx
    });
    const statusRow = (await tx.get(
      `SELECT * FROM project_statuses WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [statusId, projectId]
    )) as ProjectStatusRow | undefined;
    if (!statusRow)
      throw new ApiError(409, 'That status is not available for missions in this project');

    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new ApiError(400, 'orderedMissionIds contains duplicates');
    }

    const now = nowIso();
    for (const [index, missionId] of orderedIds.entries()) {
      const existing = (await tx.get(
        `SELECT * FROM missions
             WHERE id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL`,
        [missionId, workspaceId, projectId]
      )) as MissionRow | undefined;
      if (!existing) throw new ApiError(404, `Mission ${missionId} not found in project`);

      const boardPosition = (index + 1) * 100;
      const statusChanged = existing.status_id !== statusId;
      const positionChanged = existing.board_position !== boardPosition;
      if (!statusChanged && !positionChanged) continue;

      const setClauses = ['board_position = ?'];
      const setParams: unknown[] = [boardPosition];
      const changed = ['board_position'];
      if (statusChanged) {
        setClauses.push('status_id = ?', 'status_type = ?');
        setParams.push(statusId, statusRow.type);
        changed.push('status_id', 'status_type');
        if (statusRow.type === 'execute' && existing.status_type !== 'execute') {
          setClauses.push('returned_to_execute_at = ?');
          setParams.push(now);
          changed.push('returned_to_execute_at');
        }
      }

      const revision = existing.revision + 1;
      await tx.run(
        `UPDATE missions SET ${setClauses.join(', ')}, updated_at = ?, revision = ?
           WHERE id = ? AND workspace_id = ?`,
        [...setParams, now, revision, missionId, workspaceId]
      );

      await recordChange(
        {
          entityType: 'mission',
          entityId: missionId,
          operation: 'update',
          entityRevision: revision,
          projectId,
          missionId,
          changedFields: changed,
          workspaceId
        },
        tx
      );

      if (statusChanged) {
        await enqueueWebhookEventRest(
          {
            type: 'mission.status_changed',
            projectId,
            entity: { missionId },
            scope: { workspaceId, workspaceUserId }
          },
          tx
        );
        await createScheduledDuplicateIfNeeded(tx, existing, statusRow.type as StatusType);
        if (statusRow.type === 'execute' && existing.status_type !== 'execute') {
          await emitNotification({
            db: tx,
            workspaceId,
            missionId,
            type: 'returned_to_execute',
            now
          });
        }
      }
    }
  });

  return (await listMissions(projectId)).filter(t => t.statusId === statusId);
}

// ---- Mission scheduling (coo:124) -----------------------------------------
//
// A `schedules` row is a repeating recurrence rule computed by the
// SchedulingEngine (`@overlord/automations`). A mission with a `schedule_id`
// carries a computed `due_datetime`; when the mission reaches a `complete`-type
// status, `createScheduledDuplicateIfNeeded` below spawns a duplicate mission
// with the next occurrence. See
// planning/feature-plans/mission-scheduling-engine.md and
// automations/src/scheduling-engine/schedulingEngine.md.

interface ScheduleRow {
  id: string;
  workspace_id: string;
  name: string | null;
  period_type: string;
  period_interval: number;
  weeks_of_month_json: string;
  days_of_month_json: string;
  days_of_week_json: string;
  timezone: string;
  start_date: string | null;
  next_status_key: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

function parseScheduleJsonArray(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toScheduleDto(row: ScheduleRow): ScheduleDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    periodType: row.period_type as ScheduleDto['periodType'],
    periodInterval: row.period_interval,
    weeksOfMonth: parseScheduleJsonArray(row.weeks_of_month_json) as number[],
    daysOfMonth: parseScheduleJsonArray(row.days_of_month_json) as number[],
    daysOfWeek: parseScheduleJsonArray(row.days_of_week_json) as ScheduleDto['daysOfWeek'],
    timezone: row.timezone,
    startDate: row.start_date,
    nextStatusKey: row.next_status_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision
  };
}

function toScheduleLike(input: ScheduleInput): ScheduleLike {
  return {
    name: input.name ?? undefined,
    periodType: input.periodType,
    periodInterval: input.periodInterval,
    weeksOfMonth: input.weeksOfMonth ?? undefined,
    daysOfMonth: input.daysOfMonth ?? undefined,
    daysOfWeek: input.daysOfWeek ?? undefined,
    timezone: input.timezone,
    startDate: input.startDate ?? undefined
  };
}

function scheduleRowToInput(row: ScheduleRow): ScheduleInput {
  const dto = toScheduleDto(row);
  return {
    name: dto.name,
    periodType: dto.periodType,
    periodInterval: dto.periodInterval,
    weeksOfMonth: dto.weeksOfMonth,
    daysOfMonth: dto.daysOfMonth,
    daysOfWeek: dto.daysOfWeek,
    timezone: dto.timezone,
    startDate: dto.startDate,
    nextStatusKey: dto.nextStatusKey
  };
}

async function getScheduleRow(
  db: DatabaseClient,
  workspaceId: string,
  scheduleId: string
): Promise<ScheduleRow | undefined> {
  return (await db.get(
    `SELECT id, workspace_id, name, period_type, period_interval, weeks_of_month_json,
            days_of_month_json, days_of_week_json, timezone, start_date, next_status_key,
            created_at, updated_at, revision
       FROM schedules WHERE id = ? AND workspace_id = ?`,
    [scheduleId, workspaceId]
  )) as ScheduleRow | undefined;
}

/**
 * Validates and computes the next due datetime without persisting anything.
 * Powers the ScheduleEditor live preview and the completion trigger below.
 * Validation is delegated to the SchedulingEngine's zod schema
 * (automations/src/scheduling-engine); this layer only translates the thrown
 * validation `Error` into an `ApiError`.
 */
function previewScheduleDueDatetime(input: ScheduleInput, itemDueDatetime?: string | null): string {
  try {
    const result = generateDateFromSchedule({
      schedule: toScheduleLike(input),
      itemDueDatetime: itemDueDatetime ? new Date(itemDueDatetime) : null
    });
    return result.toISOString();
  } catch (err) {
    throw new ApiError(400, err instanceof Error ? err.message : 'Invalid schedule.');
  }
}

/** POST /api/missions/schedule/preview */
export function previewMissionSchedule(body: PreviewScheduleBody): { dueDatetime: string } {
  if (!body?.schedule) throw new ApiError(400, 'schedule is required');
  return { dueDatetime: previewScheduleDueDatetime(body.schedule, body.itemDueDatetime) };
}

/** GET /api/missions/:id/schedule */
export async function getMissionSchedule(missionRef: string): Promise<MissionScheduleDto> {
  const mission = await getMissionRow(missionRef);
  if (!mission.schedule_id) {
    return { dueDatetime: mission.due_datetime, schedule: null };
  }
  const scheduleRow = await getScheduleRow(
    requireDatabaseClient(),
    mission.workspace_id,
    mission.schedule_id
  );
  return {
    dueDatetime: mission.due_datetime,
    schedule: scheduleRow ? toScheduleDto(scheduleRow) : null
  };
}

/** PUT /api/missions/:id/schedule — create or update the linked schedule and recompute due_datetime. */
export async function upsertMissionSchedule(
  missionRef: string,
  input: ScheduleInput
): Promise<MissionScheduleDto> {
  if (!input) throw new ApiError(400, 'schedule is required');

  return requireDatabaseClient().transaction(async tx => {
    const existing = await getMissionRow(missionRef, tx, PERMISSIONS.MISSION_UPDATE);
    if (input.nextStatusKey) {
      const configured = await tx.get(
        `SELECT 1 FROM project_statuses WHERE project_id = ? AND key = ? AND deleted_at IS NULL`,
        [existing.project_id, input.nextStatusKey]
      );
      if (!configured)
        throw new ApiError(409, 'That status is not available for missions in this project');
    }
    const dueDatetime = previewScheduleDueDatetime(input, existing.due_datetime);
    const now = nowIso();
    const scheduleId = existing.schedule_id ?? newId();

    if (existing.schedule_id) {
      await tx.run(
        `UPDATE schedules
           SET name = ?, period_type = ?, period_interval = ?, weeks_of_month_json = ?,
               days_of_month_json = ?, days_of_week_json = ?, timezone = ?, start_date = ?,
               next_status_key = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND workspace_id = ?`,
        [
          input.name?.trim() || null,
          input.periodType,
          input.periodInterval,
          JSON.stringify(input.weeksOfMonth ?? []),
          JSON.stringify(input.daysOfMonth ?? []),
          JSON.stringify(input.daysOfWeek ?? []),
          input.timezone,
          input.startDate ?? null,
          input.nextStatusKey ?? null,
          now,
          existing.schedule_id,
          existing.workspace_id
        ]
      );
    } else {
      await tx.run(
        `INSERT INTO schedules
           (id, workspace_id, name, period_type, period_interval, weeks_of_month_json,
            days_of_month_json, days_of_week_json, timezone, start_date, next_status_key,
            created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          scheduleId,
          existing.workspace_id,
          input.name?.trim() || null,
          input.periodType,
          input.periodInterval,
          JSON.stringify(input.weeksOfMonth ?? []),
          JSON.stringify(input.daysOfMonth ?? []),
          JSON.stringify(input.daysOfWeek ?? []),
          input.timezone,
          input.startDate ?? null,
          input.nextStatusKey ?? null,
          now,
          now
        ]
      );
    }

    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE missions SET schedule_id = ?, due_datetime = ?, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [scheduleId, dueDatetime, now, revision, existing.id, existing.workspace_id]
    );

    await recordChange(
      {
        entityType: 'mission',
        entityId: existing.id,
        operation: 'update',
        entityRevision: revision,
        projectId: existing.project_id,
        missionId: existing.id,
        changedFields: ['schedule_id', 'due_datetime'],
        workspaceId: existing.workspace_id
      },
      tx
    );

    const scheduleRow = await getScheduleRow(tx, existing.workspace_id, scheduleId);
    if (!scheduleRow) throw new ApiError(500, 'Schedule not found after upsert');
    return { dueDatetime, schedule: toScheduleDto(scheduleRow) };
  });
}

/** DELETE /api/missions/:id/schedule — unlink and delete the schedule if unreferenced. */
export async function clearMissionSchedule(missionRef: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await getMissionRow(missionRef, tx, PERMISSIONS.MISSION_UPDATE);
    if (!existing.schedule_id) return;

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE missions SET schedule_id = NULL, due_datetime = NULL, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [now, revision, existing.id, existing.workspace_id]
    );

    await recordChange(
      {
        entityType: 'mission',
        entityId: existing.id,
        operation: 'update',
        entityRevision: revision,
        projectId: existing.project_id,
        missionId: existing.id,
        changedFields: ['schedule_id', 'due_datetime'],
        workspaceId: existing.workspace_id
      },
      tx
    );

    const stillReferenced = await tx.get(
      `SELECT id FROM missions WHERE schedule_id = ? AND workspace_id = ? LIMIT 1`,
      [existing.schedule_id, existing.workspace_id]
    );
    if (!stillReferenced) {
      await tx.run(`DELETE FROM schedules WHERE id = ? AND workspace_id = ?`, [
        existing.schedule_id,
        existing.workspace_id
      ]);
    }
  });
}

/**
 * Resolves the project status a scheduled duplicate lands in by its stable key,
 * falling back to the mission project's default.
 */
async function resolveScheduleDuplicateStatus(
  db: DatabaseClient,
  projectId: string,
  nextStatusKey: string | null
): Promise<ProjectStatusRow> {
  if (nextStatusKey) {
    const configured = (await db.get(
      `SELECT * FROM project_statuses WHERE project_id = ? AND key = ? AND deleted_at IS NULL`,
      [projectId, nextStatusKey]
    )) as ProjectStatusRow | undefined;
    if (configured) return configured;
  }

  const defaultStatus = (await db.get(
    `SELECT * FROM project_statuses
       WHERE project_id = ? AND is_default = ? AND deleted_at IS NULL LIMIT 1`,
    [projectId, bindBool(DATABASE_DIALECT, true)]
  )) as ProjectStatusRow | undefined;
  if (!defaultStatus) throw new ApiError(409, 'Project has no default status');
  return defaultStatus;
}

/**
 * Mission-completion recurrence hook (coo:124): when a scheduled mission is moved
 * into a `complete`-type status (`complete` or `cancelled` — see
 * `isTerminalStatusType`), spawns a duplicate mission with the next computed due
 * date. Skips `cancelled`: the ticket-scheduling behavior this was ported from
 * explicitly does not regenerate cancelled work. Must run inside the same
 * transaction as the status change so the duplicate and the status update land
 * atomically. Callers must only invoke this on an actual transition into
 * `newStatusType` (not a same-status no-op PATCH), or every redundant save would
 * spawn another duplicate.
 */
async function createScheduledDuplicateIfNeeded(
  tx: DatabaseClient,
  mission: MissionRow,
  newStatusType: StatusType
): Promise<void> {
  if (!isTerminalStatusType(newStatusType) || !mission.schedule_id) return;
  if (newStatusType === 'cancelled') return;

  const scheduleRow = await getScheduleRow(tx, mission.workspace_id, mission.schedule_id);
  if (!scheduleRow) return;

  let nextDueDatetime: string;
  try {
    nextDueDatetime = previewScheduleDueDatetime(
      scheduleRowToInput(scheduleRow),
      mission.due_datetime
    );
  } catch {
    // The schedule became invalid since it was saved (e.g. edited elsewhere into
    // an unreachable rule); don't block the status change that triggered this.
    return;
  }

  const targetStatus = await resolveScheduleDuplicateStatus(
    tx,
    mission.project_id,
    scheduleRow.next_status_key
  );

  const now = nowIso();
  const newMissionId = newId();
  const sequence = await nextMissionSequence(tx, mission.workspace_id);
  const workspaceRow = (await tx.get(`SELECT slug FROM workspaces WHERE id = ?`, [
    mission.workspace_id
  ])) as { slug: string };
  const displayId = `${workspaceRow.slug}:${sequence}`;
  const boardPosition = await topBoardPosition(tx, mission.project_id, targetStatus.id);

  await tx.run(
    `INSERT INTO missions
       (id, workspace_id, project_id, display_id, sequence_number, title,
        status_id, status_type, board_position, priority, assigned_workspace_user_id,
        notes_text, execution_target_intent_json,
        metadata_json, schedule_id, due_datetime, allow_parallel_objectives,
        created_by_kind, created_by_agent, created_by_session_id,
        created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, 'automation', NULL, NULL, ?, ?, 1)`,
    [
      newMissionId,
      mission.workspace_id,
      mission.project_id,
      displayId,
      sequence,
      mission.title,
      targetStatus.id,
      targetStatus.type,
      boardPosition,
      mission.priority ?? 'normal',
      mission.assigned_workspace_user_id,
      mission.notes_text,
      mission.schedule_id,
      nextDueDatetime,
      bindBool(DATABASE_DIALECT, isTruthyFlag(mission.allow_parallel_objectives)),
      now,
      now
    ]
  );

  await recordChange(
    {
      entityType: 'mission',
      entityId: newMissionId,
      operation: 'insert',
      entityRevision: 1,
      projectId: mission.project_id,
      missionId: newMissionId,
      workspaceId: mission.workspace_id
    },
    tx
  );

  const tagRows = (await tx.all(`SELECT tag_id FROM mission_tags WHERE mission_id = ?`, [
    mission.id
  ])) as { tag_id: string }[];
  if (tagRows.length > 0) {
    await assignMissionTags(tx, {
      workspaceId: mission.workspace_id,
      missionId: newMissionId,
      projectId: mission.project_id,
      tagIds: tagRows.map(row => row.tag_id),
      now
    });
  }

  const latestObjective = (await tx.get(
    `SELECT instruction_text FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL AND TRIM(instruction_text) != ''
       ORDER BY position DESC LIMIT 1`,
    [mission.id]
  )) as { instruction_text: string } | undefined;

  // Scheduled regenerations are Overlord automation, not a human retyping the
  // original. Pass origin on the service context so insertObjective stamps
  // created_by_kind = 'automation' rather than defaulting from webapp source.
  const automationCtx = {
    ...(await buildWebappServiceContextForWorkspace(mission.workspace_id, tx, null)),
    origin: { kind: 'automation' as const }
  };
  await createObjectiveOnMission({
    ctx: automationCtx,
    missionId: newMissionId,
    instructionText: latestObjective?.instruction_text ?? ''
  });
}

// ---- My Missions (selected-workspace aggregate) ---------------------------

/** Typed error code the client renders as a workspace-specific status alert. */
const STATUS_UNAVAILABLE_FOR_WORKSPACE = 'STATUS_UNAVAILABLE_FOR_WORKSPACE';

// Gap-based spacing for a personal column position; mirrors the board's
// (index + 1) * 100 scheme so dense personal renumbers read naturally.
const MY_POSITION_STEP = 100;

interface MyMissionRow extends MissionRow {
  project_name: string;
  project_settings_json: string;
  my_position: number | null;
}

function toMyMissionDto(r: MyMissionRow, tags: ProjectTagDto[]): MyMissionDto {
  return {
    ...toMissionDto(r, tags),
    projectName: r.project_name,
    projectColor: readProjectColor(r.project_settings_json),
    myPosition: r.my_position
  };
}

/** Every active workspace membership for the authenticated profile, across organizations. */
export async function callerWorkspaceMemberships(
  client: DatabaseClient = requireDatabaseClient()
): Promise<Array<{ workspaceId: string; workspaceUserId: string }>> {
  const profileId = await resolveActiveProfileId(client);
  if (!profileId) return [];
  const rows = await client.all<{ workspace_id: string; workspace_user_id: string }>(
    `SELECT wu.workspace_id, wu.id AS workspace_user_id
       FROM workspace_users wu
       JOIN workspaces w ON w.id = wu.workspace_id AND w.deleted_at IS NULL
      WHERE wu.profile_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
      ORDER BY wu.created_at ASC, wu.id ASC`,
    [profileId]
  );
  return rows.map(row => ({
    workspaceId: row.workspace_id,
    workspaceUserId: row.workspace_user_id
  }));
}

/**
 * The caller's active `(workspace_id, workspace_user_id)` memberships across
 * every live workspace of the active organization — My Missions aggregates
 * across all of them (Q5: v1 is a plain union of status columns per
 * workspace; merging like-named statuses across workspaces is deferred).
 * Empty pre-onboarding (no active organization) or with no active profile.
 */
export async function callerMembershipsInActiveOrganization(
  client: DatabaseClient = requireDatabaseClient()
): Promise<Array<{ workspaceId: string; workspaceUserId: string }>> {
  const authorized = getAuthorizedWorkspacesContext();
  if (authorized) {
    return authorized.workspaces.map(workspace => ({
      workspaceId: workspace.workspaceId,
      workspaceUserId: workspace.workspaceUserId
    }));
  }
  const profileId = await resolveActiveProfileId(client);
  const organizationId = await getActiveOrganizationIdOrNull(client);
  if (!profileId || !organizationId) return [];
  const rows = await client.all<{ workspace_id: string; workspace_user_id: string }>(
    `SELECT wu.workspace_id, wu.id AS workspace_user_id
       FROM workspace_users wu
       JOIN workspaces w ON w.id = wu.workspace_id AND w.deleted_at IS NULL
      WHERE w.organization_id = ? AND wu.profile_id = ?
        AND wu.status = 'active' AND wu.deleted_at IS NULL`,
    [organizationId, profileId]
  );
  return rows.map(row => ({
    workspaceId: row.workspace_id,
    workspaceUserId: row.workspace_user_id
  }));
}

// Missions assigned to the caller across every workspace they belong to in the
// active organization, joined to their (non-deleted) project for name/color and
// to the caller's own personal column position in that mission's workspace. The
// position only applies when its stored status_id still matches the mission's
// current status, so a status change made on the project board self-corrects
// (the mission falls back to the default order in its new column). Matched via
// a `(workspace_id, assigned_workspace_user_id)` pair list rather than a single
// workspace/actor pair, since the caller has a distinct `workspace_users.id` in
// each workspace.
function selectMyMissionsSql(pairPlaceholders: string, dialect: SqlDialect): string {
  return `
  SELECT t.id, t.workspace_id, t.project_id, t.display_id, t.sequence_number, t.title,
         t.status_id, t.status_type, t.board_position, t.priority,
         t.assigned_workspace_user_id,
         t.notes_text,
         t.schedule_id, t.due_datetime,
         t.created_at, t.updated_at, t.revision,
         t.created_by_kind, t.created_by_agent, t.created_by_workspace_user_id,
         p.name AS project_name, p.settings_json AS project_settings_json,
         mtp.position AS my_position,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS completed_objective_count,
         -- pending_delivery counts as executing: the agent re-attached after
         -- finishing a turn and is still on the objective, so the card should
         -- keep reading as live work rather than going quiet until delivery.
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('executing', 'pending_delivery'))
            AS has_executing_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS has_completed_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('draft', 'future') AND TRIM(o.instruction_text) != '')
            AS has_pending_objective_with_instructions,
${missionHasUnseenBlockingQuestionSql(dialect)},
${missionHasUnseenReturnedToExecuteSql},
         (SELECT o.resource_key FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'draft'
            LIMIT 1) AS draft_objective_resource_key
    FROM missions t
    JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      AND p.deleted_at IS NULL
    LEFT JOIN my_mission_positions mtp
      ON mtp.workspace_id = t.workspace_id AND mtp.mission_id = t.id
        AND mtp.workspace_user_id = t.assigned_workspace_user_id AND mtp.status_id = t.status_id
   WHERE t.deleted_at IS NULL
     AND (t.workspace_id, t.assigned_workspace_user_id) IN (${pairPlaceholders})
`;
}

/**
 * GET /api/workspace/my-missions — missions assigned to the caller across every
 * workspace they belong to in the active organization (Q5). Read-time merge
 * order: positioned missions first by their personal position, then
 * unpositioned missions by the approximate default aggregate order
 * (board_position, then recency, then a stable tiebreaker). The client
 * regroups by statusId, preserving this within-column order. Returns an empty
 * list rather than broadening when there is no active organization or no
 * memberships in it.
 */
export async function listWorkspaceMyMissions(): Promise<MyMissionsResponse> {
  const memberships = await callerMembershipsInActiveOrganization();
  const readableMemberships: Array<{ workspaceId: string; workspaceUserId: string }> = [];
  for (const membership of memberships) {
    if (
      await actorCan(PERMISSIONS.MISSION_READ, {
        workspaceId: membership.workspaceId,
        workspaceUserId: membership.workspaceUserId
      })
    ) {
      readableMemberships.push(membership);
    }
  }
  if (readableMemberships.length === 0) return { missions: [] };

  const pairPlaceholders = readableMemberships.map(() => '(?, ?)').join(', ');
  const pairParams = readableMemberships.flatMap(m => [m.workspaceId, m.workspaceUserId]);

  const db = requireDatabaseClient();
  const rows = (await db.all(
    `${selectMyMissionsSql(pairPlaceholders, db.dialect)}
         ORDER BY (mtp.position IS NULL) ASC, mtp.position ASC,
                  t.board_position ASC, t.updated_at DESC, t.sequence_number DESC, t.id ASC`,
    pairParams
  )) as MyMissionRow[];
  const tagsByMission = await getTagsByMission(rows.map(row => row.id));
  return { missions: rows.map(row => toMyMissionDto(row, tagsByMission.get(row.id) ?? [])) };
}

// ---- Inbox missions (overdue + due soon + agent Next) ---------------------

/** Rolling window for "recently created" on the Inbox missions list (coo:826). */
const INBOX_MISSION_RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const INBOX_MISSION_AGENT_NEXT_LIMIT = 60;
/** Cap on the due-today/tomorrow slice of the Inbox missions list (coo:858). */
const INBOX_MISSION_DUE_SOON_LIMIT = 60;
/** Cap on the past-due slice of the Inbox missions list (coo:858). */
const INBOX_MISSION_OVERDUE_LIMIT = 60;

/**
 * UTC day boundaries the Inbox due slices are cut on, as ISO timestamps.
 * `todayStart` is the exclusive end of the overdue slice
 * (`due_datetime < todayStart`) and the inclusive start of the due-soon slice;
 * `dueSoonEnd` is its exclusive end, two days later. Due dates picked in the UI
 * are anchored at 12:00 UTC (see `webapp/web/lib/due-datetime.ts`), so UTC day
 * boundaries select the calendar date the operator chose without needing a
 * per-caller timezone.
 */
function inboxDueWindow(now: Date): { todayStart: string; dueSoonEnd: string } {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    todayStart: new Date(startOfToday).toISOString(),
    dueSoonEnd: new Date(startOfToday + 2 * dayMs).toISOString()
  };
}

interface InboxMissionRow extends MissionRow {
  project_name: string;
  project_settings_json: string;
}

/**
 * Shared SELECT for Inbox mission triage cards. Same MissionDto projection as
 * My Missions (without personal position), joined to project name/color.
 */
function selectInboxMissionsSql(workspacePlaceholders: string, dialect: SqlDialect): string {
  return `
  SELECT t.id, t.workspace_id, t.project_id, t.display_id, t.sequence_number, t.title,
         t.status_id, t.status_type, t.board_position, t.priority,
         t.assigned_workspace_user_id,
         t.notes_text,
         t.schedule_id, t.due_datetime,
         t.created_at, t.updated_at, t.revision,
         t.created_by_kind, t.created_by_agent, t.created_by_workspace_user_id,
         t.allow_parallel_objectives,
         p.name AS project_name, p.settings_json AS project_settings_json,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL) AS objective_count,
         (SELECT COUNT(*) FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS completed_objective_count,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('executing', 'pending_delivery'))
            AS has_executing_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'complete')
            AS has_completed_objective,
         (SELECT COUNT(*) > 0 FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL
              AND o.state IN ('draft', 'future') AND TRIM(o.instruction_text) != '')
            AS has_pending_objective_with_instructions,
${missionHasUnseenBlockingQuestionSql(dialect)},
${missionHasUnseenReturnedToExecuteSql},
         (SELECT o.resource_key FROM objectives o
            WHERE o.mission_id = t.id AND o.deleted_at IS NULL AND o.state = 'draft'
            LIMIT 1) AS draft_objective_resource_key
    FROM missions t
    JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      AND p.deleted_at IS NULL AND p.status = 'active'
   WHERE t.deleted_at IS NULL
     AND t.workspace_id IN (${workspacePlaceholders})
`;
}

function toInboxMissionDto(
  r: InboxMissionRow,
  tags: ProjectTagDto[],
  reasons: InboxMissionReason[]
): InboxMissionDto {
  return {
    ...toMissionDto(r, tags),
    projectName: r.project_name,
    projectColor: readProjectColor(r.project_settings_json),
    reasons
  };
}

/**
 * GET /api/inbox/missions — agent-authored missions in status type `next`,
 * unioned with missions of any creator that are past due or due today or
 * tomorrow, from active projects across every workspace the caller may
 * `mission:read` in the active organization. Other human-created missions never
 * appear here; unallocated captures live on profile-owned `/api/inbox`.
 * Overdue rows lead, most recently overdue first, then due-soon rows
 * soonest-first, then agent-Next rows newest-first; each slice is capped
 * independently. Rows created within the rolling recent window carry a `recent`
 * reason for UI labeling only.
 */
export async function listInboxMissions(): Promise<InboxMissionsResponse> {
  const generatedAt = new Date().toISOString();
  const memberships = await callerMembershipsInActiveOrganization();
  const readableWorkspaceIds: string[] = [];
  for (const membership of memberships) {
    if (
      await actorCan(PERMISSIONS.MISSION_READ, {
        workspaceId: membership.workspaceId,
        workspaceUserId: membership.workspaceUserId
      })
    ) {
      readableWorkspaceIds.push(membership.workspaceId);
    }
  }
  if (readableWorkspaceIds.length === 0) {
    return { missions: [], generatedAt };
  }

  const workspacePlaceholders = readableWorkspaceIds.map(() => '?').join(', ');
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - INBOX_MISSION_RECENT_MS).toISOString();
  const dueWindow = inboxDueWindow(now);
  const client = requireDatabaseClient();
  const baseSql = selectInboxMissionsSql(workspacePlaceholders, client.dialect);

  // Past due leads the whole list: a missed date is the most urgent thing on
  // the surface. Descending due date puts the most recently missed work — the
  // most likely to still matter — at the top, so stale months-old rows sink
  // rather than burying today's triage.
  const overdueRows = (await client.all(
    `${baseSql}
       AND t.due_datetime IS NOT NULL
       AND t.due_datetime < ?
       AND t.status_type NOT IN ('complete', 'cancelled')
     ORDER BY t.due_datetime DESC, t.sequence_number DESC, t.id ASC
     LIMIT ?`,
    [...readableWorkspaceIds, dueWindow.todayStart, INBOX_MISSION_OVERDUE_LIMIT]
  )) as InboxMissionRow[];

  // Due today/tomorrow follows: time-sensitive regardless of who filed the
  // mission. Finished and abandoned work is never triage.
  const dueSoonRows = (await client.all(
    `${baseSql}
       AND t.due_datetime IS NOT NULL
       AND t.due_datetime >= ?
       AND t.due_datetime < ?
       AND t.status_type NOT IN ('complete', 'cancelled')
     ORDER BY t.due_datetime ASC, t.sequence_number DESC, t.id ASC
     LIMIT ?`,
    [
      ...readableWorkspaceIds,
      dueWindow.todayStart,
      dueWindow.dueSoonEnd,
      INBOX_MISSION_DUE_SOON_LIMIT
    ]
  )) as InboxMissionRow[];

  const agentNextRows = (await client.all(
    `${baseSql}
       AND t.created_by_kind = 'agent'
       AND t.status_type = 'next'
     ORDER BY t.created_at DESC, t.sequence_number DESC, t.id ASC
     LIMIT ?`,
    [...readableWorkspaceIds, INBOX_MISSION_AGENT_NEXT_LIMIT]
  )) as InboxMissionRow[];

  // A mission can qualify several ways; it is one card carrying every reason,
  // kept at the position of its most urgent one. Overdue and due-soon are
  // mutually exclusive by construction — the windows do not overlap.
  const overdueIds = new Set(overdueRows.map(row => row.id));
  const dueSoonIds = new Set(dueSoonRows.map(row => row.id));
  const orderedRows = [
    ...overdueRows,
    ...dueSoonRows,
    ...agentNextRows.filter(row => !overdueIds.has(row.id) && !dueSoonIds.has(row.id))
  ];
  const agentNextIds = new Set(agentNextRows.map(row => row.id));

  const tagsByMission = await getTagsByMission(orderedRows.map(row => row.id));
  return {
    generatedAt,
    missions: orderedRows.map(row => {
      const reasons: InboxMissionReason[] = [];
      if (overdueIds.has(row.id)) reasons.push('overdue');
      if (dueSoonIds.has(row.id)) reasons.push('due_soon');
      if (agentNextIds.has(row.id)) reasons.push('agent_next');
      if (row.created_at >= recentCutoff) {
        reasons.push('recent');
      }
      return toInboxMissionDto(row, tagsByMission.get(row.id) ?? [], reasons);
    })
  };
}

/** Insert or update one operator's personal position for a mission in a column. */
async function upsertMyMissionPosition(
  db: DatabaseClient,
  {
    workspaceId,
    projectId,
    missionId,
    statusId,
    position,
    actor,
    now
  }: {
    workspaceId: string;
    projectId: string;
    missionId: string;
    statusId: string;
    position: number;
    actor: string;
    now: string;
  }
): Promise<void> {
  const existing = (await db.get(
    `SELECT id, revision FROM my_mission_positions
         WHERE workspace_id = ? AND workspace_user_id = ? AND mission_id = ?`,
    [workspaceId, actor, missionId]
  )) as { id: string; revision: number } | undefined;
  if (existing) {
    await db.run(
      `UPDATE my_mission_positions
          SET project_id = ?, status_id = ?, position = ?, updated_at = ?, revision = ?
        WHERE id = ?`,
      [projectId, statusId, position, now, existing.revision + 1, existing.id]
    );
    return;
  }
  await db.run(
    `INSERT INTO my_mission_positions
       (id, workspace_id, project_id, workspace_user_id, mission_id, status_id, position, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [newId(), workspaceId, projectId, actor, missionId, statusId, position, now, now]
  );
}

/**
 * My Missions columns are `StatusType`s, not project statuses, so a reorder is
 * resolved per mission inside that mission's *own* project: the lowest-position
 * active status of the requested type. A mission already sitting in a status of
 * that type keeps its concrete status, so project-specific column naming
 * survives a drag. Returns `undefined` when the project defines no active status
 * of the type, which the caller reports as `STATUS_UNAVAILABLE_FOR_WORKSPACE`.
 */
async function resolveMyMissionsColumnStatus(
  tx: DatabaseClient,
  { projectId, statusType }: { projectId: string; statusType: StatusType }
): Promise<ProjectStatusRow | undefined> {
  return (await tx.get(
    `SELECT ps.* FROM project_statuses ps
        WHERE ps.project_id = ? AND ps.type = ? AND ps.deleted_at IS NULL
        ORDER BY ps.position ASC, ps.id ASC
        LIMIT 1`,
    [projectId, statusType]
  )) as ProjectStatusRow | undefined;
}

/**
 * The caller's `workspace_users.id` per workspace they actively belong to in the
 * active organization — the same membership rule the My Missions read uses. A
 * reorder may span several workspaces at once, so membership is resolved once
 * up front rather than per status.
 */
async function myMissionsActorByWorkspace(tx: DatabaseClient): Promise<Map<string, string>> {
  const memberships = await callerMembershipsInActiveOrganization(tx);
  return new Map(memberships.map(m => [m.workspaceId, m.workspaceUserId]));
}

async function reorderWorkspaceMyMissionsTx(body: MyMissionReorderRequest): Promise<void> {
  const statusType = body.statusType;
  const orderedIds = body.orderedMissionIds;
  if (!statusType || !isMyMissionsColumnType(statusType)) {
    throw new ApiError(400, `statusType must be one of ${MY_MISSIONS_COLUMN_TYPES.join(', ')}`);
  }
  if (!Array.isArray(orderedIds)) throw new ApiError(400, 'orderedMissionIds must be an array');
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new ApiError(400, 'orderedMissionIds contains duplicates');
  }

  await requireDatabaseClient().transaction(async tx => {
    const actorByWorkspace = await myMissionsActorByWorkspace(tx);
    const now = nowIso();

    for (const [index, missionId] of orderedIds.entries()) {
      const existing = (await tx.get(`SELECT * FROM missions WHERE id = ? AND deleted_at IS NULL`, [
        missionId
      ])) as MissionRow | undefined;
      if (!existing) throw new ApiError(404, `Mission ${missionId} not found`);

      const workspaceId = existing.workspace_id;
      const actor = actorByWorkspace.get(workspaceId);
      if (!actor) throw new ApiError(403, 'Not an active member of that mission’s workspace');
      if (existing.assigned_workspace_user_id !== actor) {
        throw new ApiError(403, `Mission ${missionId} is not assigned to you`);
      }

      // Already in a status of this type: keep the project's own status so a
      // custom column name is not collapsed onto the seeded one. Otherwise this
      // is a real cross-column status change, resolved within this mission's
      // project.
      let statusId = existing.status_id;
      if (existing.status_type !== statusType) {
        const targetStatus = await resolveMyMissionsColumnStatus(tx, {
          projectId: existing.project_id,
          statusType
        });
        if (!targetStatus) {
          throw new ApiError(
            409,
            `That mission's project has no ${statusType} status`,
            undefined,
            STATUS_UNAVAILABLE_FOR_WORKSPACE
          );
        }
        statusId = targetStatus.id;

        // Apply the canonical status-change writes (status_id + denormalized
        // status_type + reset board_position to top-of-new-column) so the project
        // board and the My Missions unpositioned fallback both stay correct.
        const revision = existing.revision + 1;
        await tx.run(
          `UPDATE missions
              SET status_id = ?, status_type = ?,
                  board_position = ?, updated_at = ?, revision = ?
            WHERE id = ? AND workspace_id = ?`,
          [
            targetStatus.id,
            targetStatus.type,
            await topBoardPosition(tx, existing.project_id, targetStatus.id, missionId),
            now,
            revision,
            missionId,
            workspaceId
          ]
        );
        await recordChange(
          {
            entityType: 'mission',
            entityId: missionId,
            operation: 'update',
            entityRevision: revision,
            projectId: existing.project_id,
            missionId,
            workspaceId,
            changedFields: ['status_id', 'status_type', 'board_position']
          },
          tx
        );
      }

      // Personal slot within the (operator, status-type) column. Positions are
      // assigned across the whole aggregated column, so an interleaved order that
      // spans several projects round-trips exactly. Writes only
      // my_mission_positions — never missions.board_position for a same-type move.
      await upsertMyMissionPosition(tx, {
        workspaceId,
        projectId: existing.project_id,
        missionId,
        statusId,
        position: (index + 1) * MY_POSITION_STEP,
        actor,
        now
      });
    }
  });
}

/**
 * PATCH /api/workspace/my-missions/order — persist a personal reorder of one My
 * Missions status-*type* column for the active operator. The column aggregates
 * every project and workspace in the active organization, so one call may move
 * and reorder missions across several of them. Translates a foreign-key
 * rejection (a status the mission's project lacks) into the typed
 * `STATUS_UNAVAILABLE_FOR_WORKSPACE` error so the client can alert and revert.
 */
export async function reorderWorkspaceMyMissions(
  body: MyMissionReorderRequest
): Promise<MyMissionsResponse> {
  try {
    await reorderWorkspaceMyMissionsTx(body);
    return listWorkspaceMyMissions();
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
    ) {
      // The rejected status belongs to the moved mission's project, which —
      // now that My Missions aggregates across the organization — need not be
      // the caller's active one, so no workspace is named here.
      throw new ApiError(
        409,
        `That status is not available in this mission's project`,
        undefined,
        STATUS_UNAVAILABLE_FOR_WORKSPACE
      );
    }
    throw err;
  }
}

// ---- Objectives ----------------------------------------------------------

export async function listObjectives(
  missionId: string,
  db: DatabaseClient = requireDatabaseClient()
): Promise<ObjectiveDto[]> {
  await requireMissionPermission({
    missionRef: missionId,
    permission: PERMISSIONS.OBJECTIVE_READ,
    db
  });
  const rows = (await db.all(
    `SELECT o.*, m.display_id AS mission_display_id,
         e.id AS queue_entry_id, e.queue_id, q.name AS queue_name,
         CASE WHEN e.id IS NULL THEN NULL ELSE (SELECT COUNT(*) FROM run_queue_entries er WHERE er.queue_id = e.queue_id AND er.deleted_at IS NULL AND (er.position < e.position OR (er.position = e.position AND er.id <= e.id))) END AS queue_position,
         e.state AS queue_state, e.blocked_reason AS queue_blocked_reason,
         e.waiting_reason AS queue_waiting_reason, e.waiting_on_objective_id AS queue_waiting_on_objective_id,
         e.attempt_count AS queue_attempt_count, wo.display_key AS queue_waiting_on_objective_display_key,
         (
           SELECT s.external_session_id
             FROM agent_sessions s
            WHERE s.objective_id = o.id AND s.deleted_at IS NULL
            ORDER BY s.started_at DESC
            LIMIT 1
         ) AS external_session_id
         FROM objectives o
         JOIN missions m ON m.id = o.mission_id
         LEFT JOIN run_queue_entries e ON e.objective_id = o.id AND e.deleted_at IS NULL
         LEFT JOIN run_queues q ON q.id = e.queue_id AND q.deleted_at IS NULL
         LEFT JOIN objectives wo ON wo.id = e.waiting_on_objective_id AND wo.deleted_at IS NULL
        WHERE o.mission_id = ? AND o.deleted_at IS NULL
        ORDER BY o.position ASC`,
    [missionId]
  )) as ObjectiveRow[];
  return rows.map(toObjectiveDto);
}

/** Active pipeline states a user can disconnect back to the next-up queue. */
const DISCONNECT_FROM_STATES = ['launching', 'executing', 'pending_delivery'] as const;

/**
 * Objective columns a Run Queue hold can be waiting on. Changing one of these
 * on a queued objective is exactly the human action `blocked` asks for, so it
 * earns an immediate dispatch tick.
 */
const RUN_QUEUE_DISPATCH_FIELDS = [
  'assigned_agent',
  'instruction_text',
  'state',
  'resource_key'
] as const;

/**
 * Persists objective position changes with a two-phase write so
 * mission_id+position uniqueness is not violated mid-transaction.
 */
async function applyObjectivePositionUpdates(
  tx: DatabaseClient,
  options: {
    workspaceId: string;
    missionId: string;
    projectId: string;
    rows: ObjectiveRow[];
    positionById: Map<string, number>;
    now: string;
  }
): Promise<void> {
  const { workspaceId, missionId, projectId, rows, positionById, now } = options;
  const byId = new Map(rows.map(row => [row.id, row]));

  const updates = [...positionById.entries()]
    .map(([objectiveId, position]) => {
      const existing = byId.get(objectiveId);
      if (!existing || existing.position === position) return null;
      return { existing, position, revision: existing.revision + 1 };
    })
    .filter((update): update is NonNullable<typeof update> => update !== null);

  if (updates.length === 0) return;

  const maxPosition = Math.max(
    ...rows.map(row => row.position),
    ...updates.map(update => update.position)
  );
  const tempBase = maxPosition + updates.length + 1;

  for (const [index, { existing }] of updates.entries()) {
    await tx.run(
      `UPDATE objectives SET position = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      [tempBase + index, now, existing.id, workspaceId]
    );
  }

  for (const { existing, position, revision } of updates) {
    await tx.run(
      `UPDATE objectives SET position = ?, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [position, now, revision, existing.id, workspaceId]
    );

    await recordChange(
      {
        entityType: 'objective',
        entityId: existing.id,
        operation: 'update',
        entityRevision: revision,
        projectId,
        missionId,
        objectiveId: existing.id,
        changedFields: ['position'],
        workspaceId
      },
      tx
    );
  }
}

/**
 * Reorder a mission's `future` objectives. `orderedObjectiveIds` is the full
 * top-to-bottom order the future group should have afterwards. The future rows
 * are renumbered relative to one another starting at the lowest position they
 * currently occupy, so they keep sitting after any non-future objectives.
 * Objectives whose position is already correct are skipped so no redundant
 * change-feed rows are written. Returns the mission's full objective list in its
 * new order.
 */
export async function reorderFutureObjectives(
  missionId: string,
  body: ReorderFutureObjectivesBody
): Promise<ObjectiveDto[]> {
  const orderedIds = body.orderedObjectiveIds;
  if (!Array.isArray(orderedIds)) {
    throw new ApiError(400, 'orderedObjectiveIds must be an array');
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new ApiError(400, 'orderedObjectiveIds contains duplicates');
  }

  await requireDatabaseClient().transaction(async tx => {
    const { workspaceId } = await requireMissionPermission({
      missionRef: missionId,
      permission: PERMISSIONS.OBJECTIVE_UPDATE,
      db: tx
    });
    const mission = (await tx.get(
      `SELECT id, project_id FROM missions WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [missionId, workspaceId]
    )) as { id: string; project_id: string } | undefined;
    if (!mission) throw new ApiError(404, 'Mission not found');

    const rows = (await tx.all(
      `SELECT * FROM objectives
           WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [missionId, workspaceId]
    )) as ObjectiveRow[];
    const byId = new Map(rows.map(row => [row.id, row]));

    const targets = orderedIds.map(id => {
      const row = byId.get(id);
      if (!row) throw new ApiError(404, `Objective ${id} not found on mission`);
      if (row.state !== 'future') {
        throw new ApiError(400, `Objective ${id} is not a future objective`);
      }
      return row;
    });
    if (targets.length === 0) return;

    // Renumber starting at the lowest position the future group currently holds,
    // keeping the whole group after any non-future objectives.
    const basePosition = Math.min(...targets.map(row => row.position));

    const updates = targets
      .map((existing, index) => ({
        existing,
        position: basePosition + index,
        revision: existing.revision + 1
      }))
      .filter(({ existing, position }) => existing.position !== position);
    if (updates.length === 0) return;

    const now = nowIso();
    const maxPosition = Math.max(...rows.map(row => row.position), basePosition);
    const tempBase = maxPosition + updates.length + 1;

    // Move every changed row out of the constrained range first so swaps do not
    // trip the mission_id+position uniqueness constraint mid-transaction.
    for (const [index, { existing }] of updates.entries()) {
      await tx.run(
        `UPDATE objectives SET position = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        [tempBase + index, now, existing.id, workspaceId]
      );
    }

    for (const { existing, position, revision } of updates) {
      await tx.run(
        `UPDATE objectives SET position = ?, updated_at = ?, revision = ?
           WHERE id = ? AND workspace_id = ?`,
        [position, now, revision, existing.id, workspaceId]
      );

      await recordChange(
        {
          entityType: 'objective',
          entityId: existing.id,
          operation: 'update',
          entityRevision: revision,
          projectId: mission.project_id,
          missionId,
          objectiveId: existing.id,
          changedFields: ['position'],
          workspaceId
        },
        tx
      );
    }
  });

  return listObjectives(missionId);
}

type InternalCreateObjectiveBody = CreateObjectiveBody & { assignedAgent?: string | null };

// Internal insert used by both createObjective and createMission's first objective.
// Runs on the provided transaction-scoped client. `ctx` carries the mission's own
// workspace (resolved by the caller, independent of the request's active
// workspace — coo:135) and the acting member's identity within it.
//
// The insert itself lives in the shared service layer so REST, CLI, Protocol and
// MCP all create objectives through one implementation (CONTRACT.md's "REST API →
// Database uses the same service layer as CLI and Protocol"). This wrapper only
// adapts the REST shapes: a workspace-scoped ctx in, a full `ObjectiveDto` out.
async function insertObjective(
  db: DatabaseClient,
  ctx: { workspaceId: string; workspaceUserId: string | null },
  body: InternalCreateObjectiveBody
): Promise<ObjectiveDto> {
  const serviceCtx = await buildWebappServiceContextForWorkspace(
    ctx.workspaceId,
    db,
    ctx.workspaceUserId
  );
  const created = await createObjectiveOnMission({
    ctx: serviceCtx,
    missionId: body.missionId,
    instructionText: body.instructionText ?? '',
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.state !== undefined ? { state: body.state } : {}),
    autoAdvance: body.autoAdvance ?? false,
    ...(body.assignedAgent !== undefined ? { assignedAgent: body.assignedAgent } : {}),
    ...(body.resourceKey !== undefined ? { resourceKey: body.resourceKey } : {})
  });

  const row = (await db.get(
    `SELECT o.*, m.display_id AS mission_display_id
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id
      WHERE o.id = ?`,
    [created.id]
  )) as ObjectiveRow;
  return toObjectiveDto(row);
}

function createObjectiveTx(body: InternalCreateObjectiveBody): Promise<ObjectiveDto> {
  return requireDatabaseClient().transaction(async tx => {
    const { workspaceId, workspaceUserId } = await requireMissionPermission({
      missionRef: body.missionId,
      permission: PERMISSIONS.OBJECTIVE_UPDATE,
      db: tx
    });
    return insertObjective(tx, { workspaceId, workspaceUserId }, body);
  });
}

export async function createObjective(body: CreateObjectiveBody): Promise<ObjectiveDto> {
  const objective = await createObjectiveTx(body);

  if (!body.title?.trim() && objective.instructionText.trim()) {
    scheduleObjectiveTitleGeneration({
      objectiveId: objective.id,
      projectId: objective.projectId,
      missionId: objective.missionId,
      instructionText: objective.instructionText
    });
  }

  return objective;
}

/**
 * Refills the next-up draft slot after an objective leaves the queue by
 * promoting the first authored `future` objective (and dropping any leftover
 * blank draft it replaces).
 *
 * It never *creates* a blank draft. A stored objective with no instruction text
 * is indistinguishable from real work to agents, counts, and auto-advance, so
 * the "empty field to type into" is a client-only composer (the mission panel's
 * ghost objective card) that persists an objective only once it has content.
 */
async function ensureDraftSlotAfterObjectiveLeavesQueue(
  db: DatabaseClient,
  {
    workspaceId,
    missionId,
    projectId,
    now
  }: {
    workspaceId: string;
    missionId: string;
    projectId: string;
    now: string;
  }
): Promise<void> {
  const drafts = (await db.all(
    `SELECT id, instruction_text, revision FROM objectives
       WHERE mission_id = ? AND workspace_id = ? AND state = 'draft' AND deleted_at IS NULL
       ORDER BY position ASC, created_at ASC`,
    [missionId, workspaceId]
  )) as Array<{
    id: string;
    instruction_text: string;
    revision: number;
  }>;

  if (drafts.some(draft => draft.instruction_text.trim())) return;

  // Only an authored future objective refills the slot; a blank one (legacy rows
  // from when blank slots were persisted) is not real work to promote.
  const nextFuture = (await db.get(
    `SELECT id, revision FROM objectives
       WHERE mission_id = ? AND workspace_id = ? AND state = 'future' AND deleted_at IS NULL
         AND TRIM(instruction_text) <> ''
       ORDER BY position ASC, created_at ASC LIMIT 1`,
    [missionId, workspaceId]
  )) as { id: string; revision: number } | undefined;

  if (nextFuture) {
    for (const draft of drafts) {
      const draftRevision = draft.revision + 1;
      await db.run(
        `UPDATE objectives
         SET deleted_at = ?, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
        [now, now, draftRevision, draft.id, workspaceId]
      );

      await recordChange(
        {
          entityType: 'objective',
          entityId: draft.id,
          operation: 'delete',
          entityRevision: draftRevision,
          projectId,
          missionId,
          objectiveId: draft.id,
          workspaceId
        },
        db
      );
    }

    const nextRevision = nextFuture.revision + 1;
    await db.run(
      `UPDATE objectives
       SET state = 'draft', completed_at = NULL, updated_at = ?, revision = ?
       WHERE id = ? AND workspace_id = ?`,
      [now, nextRevision, nextFuture.id, workspaceId]
    );

    await recordChange(
      {
        entityType: 'objective',
        entityId: nextFuture.id,
        operation: 'update',
        entityRevision: nextRevision,
        projectId,
        missionId,
        objectiveId: nextFuture.id,
        changedFields: ['state', 'completed_at'],
        workspaceId
      },
      db
    );
  }
}

/**
 * Resolves an objective to its owning workspace and checks permission there
 * (coo:135). UUIDs are globally unique and unscoped by the caller's active
 * workspace; display ids (`coo:756.k7xm`) resolve in the active workspace.
 */
async function requireObjectivePermission({
  objectiveId,
  permission,
  db = requireDatabaseClient()
}: {
  objectiveId: string;
  permission: Permission;
  db?: DatabaseClient;
}): Promise<{ workspaceId: string; workspaceUserId: string; objectiveId: string }> {
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveId, db });
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: resolved.workspaceId,
    permission,
    db,
    notFoundMessage: 'Objective not found'
  });
  return {
    workspaceId: resolved.workspaceId,
    workspaceUserId,
    objectiveId: resolved.id
  };
}

async function updateObjectiveTx(
  idRef: string,
  body: UpdateObjectiveBody
): Promise<{ objective: ObjectiveDto; regenerateTitle: boolean }> {
  return requireDatabaseClient().transaction(async tx => {
    const {
      workspaceId,
      workspaceUserId,
      objectiveId: id
    } = await requireObjectivePermission({
      objectiveId: idRef,
      permission: PERMISSIONS.OBJECTIVE_UPDATE,
      db: tx
    });
    const existing = (await tx.get(
      `SELECT o.*, m.display_id AS mission_display_id
         FROM objectives o
         JOIN missions m ON m.id = o.mission_id
        WHERE o.id = ? AND o.workspace_id = ? AND o.deleted_at IS NULL`,
      [id, workspaceId]
    )) as ObjectiveRow | undefined;
    if (!existing) throw new ApiError(404, 'Objective not found');

    const fields: string[] = [];
    const setParams: unknown[] = [];
    const changed: string[] = [];

    let instructionChanged = false;
    if (body.instructionText !== undefined) {
      const instruction = body.instructionText.trim();
      const resultingState = body.state ?? existing.state;
      const allowsBlankInstruction = resultingState === 'draft' || resultingState === 'future';
      if (!instruction && !allowsBlankInstruction) {
        throw new ApiError(400, 'Objective instruction is required');
      }
      const lockedStates = ['executing', 'pending_delivery', 'complete'] as const;
      if (lockedStates.includes(existing.state as (typeof lockedStates)[number])) {
        throw new ApiError(400, 'Objective instruction cannot be edited once execution has begun');
      }
      fields.push('instruction_text = ?');
      setParams.push(instruction);
      changed.push('instruction_text');
      instructionChanged = true;
    }
    if (body.title !== undefined) {
      fields.push('title = ?');
      setParams.push(body.title?.trim() || null);
      changed.push('title');
    }
    if (body.state !== undefined) {
      if (!OBJECTIVE_STATES.includes(body.state as ObjectiveState)) {
        throw new ApiError(400, 'Invalid objective state');
      }
      if (existing.state === 'complete' && body.state === 'future') {
        throw new ApiError(400, 'Completed objectives cannot be moved back to the future queue.');
      }
      fields.push('state = ?');
      setParams.push(body.state);
      changed.push('state');
      // Stamp the lifecycle moment the mission objective list orders by. See
      // OBJECTIVE_*_AT_ASSIGNMENT: launch/start are first-wins, completion is not.
      if (body.state === 'launching') {
        fields.push(OBJECTIVE_LAUNCHED_AT_ASSIGNMENT);
        setParams.push(nowIso());
        changed.push('launched_at');
      }
      if (body.state === 'executing') {
        fields.push(OBJECTIVE_LAUNCHED_AT_ASSIGNMENT, OBJECTIVE_STARTED_AT_ASSIGNMENT);
        const startedAt = nowIso();
        setParams.push(startedAt, startedAt);
        changed.push('launched_at', 'started_at');
      }
      if (body.state === 'complete') {
        fields.push(OBJECTIVE_COMPLETED_AT_ASSIGNMENT);
        setParams.push(nowIso());
        changed.push('completed_at');
      }
    }
    if (body.autoAdvance !== undefined) {
      fields.push('auto_advance = ?');
      setParams.push(bindBool(DATABASE_DIALECT, body.autoAdvance));
      changed.push('auto_advance');
    }
    if (body.position !== undefined) {
      if (!Number.isInteger(body.position) || body.position < 0) {
        throw new ApiError(400, 'Invalid position');
      }
      fields.push('position = ?');
      setParams.push(body.position);
      changed.push('position');
    }
    if (body.assignedAgent !== undefined) {
      fields.push('assigned_agent = ?');
      setParams.push(body.assignedAgent?.trim() || null);
      changed.push('assigned_agent');
    }
    if (body.model !== undefined) {
      fields.push('model = ?');
      setParams.push(body.model?.trim() || null);
      changed.push('model');
    }
    if (body.reasoningEffort !== undefined) {
      fields.push('reasoning_effort = ?');
      setParams.push(body.reasoningEffort?.trim() || null);
      changed.push('reasoning_effort');
    }
    if (body.resourceKey !== undefined) {
      const nextResourceKey = await assertObjectiveResourceKeyOnProject(
        tx,
        existing.project_id,
        body.resourceKey
      );
      fields.push('resource_key = ?');
      setParams.push(nextResourceKey);
      changed.push('resource_key');
    }
    if (body.launchConfigOverride !== undefined) {
      const agentKey = body.launchConfigAgent?.trim();
      if (!agentKey) throw new ApiError(400, 'launchConfigAgent is required');
      let launchConfigs: Record<string, Record<string, unknown>> = {};
      try {
        const parsed = existing.launch_config_json
          ? (JSON.parse(existing.launch_config_json) as unknown)
          : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          launchConfigs = parsed as Record<string, Record<string, unknown>>;
        }
      } catch {
        launchConfigs = {};
      }
      const anyTarget = { ...(launchConfigs['*'] ?? {}) };
      if (body.launchConfigOverride === null) {
        delete anyTarget[agentKey];
      } else {
        anyTarget[agentKey] = {
          preCommand: body.launchConfigOverride.preCommand?.trim() ?? '',
          flags: normalizeAgentLaunchFlags(body.launchConfigOverride.flags)
        };
      }
      if (Object.keys(anyTarget).length > 0) launchConfigs['*'] = anyTarget;
      else delete launchConfigs['*'];
      fields.push('launch_config_json = ?');
      setParams.push(Object.keys(launchConfigs).length > 0 ? JSON.stringify(launchConfigs) : null);
      changed.push('launch_config_json');
    }
    if (fields.length === 0) {
      return { objective: toObjectiveDto(existing), regenerateTitle: false };
    }

    const now = nowIso();
    const revision = existing.revision + 1;
    if (body.state === 'draft') {
      const otherDrafts = (await tx.all(
        `SELECT id, revision, position FROM objectives
           WHERE mission_id = ? AND workspace_id = ? AND state = 'draft'
             AND id <> ? AND deleted_at IS NULL`,
        [existing.mission_id, workspaceId, id]
      )) as Array<{ id: string; revision: number; position: number }>;

      for (const draft of otherDrafts) {
        const draftRevision = draft.revision + 1;
        await tx.run(
          `UPDATE objectives SET state = 'future', updated_at = ?, revision = ?
           WHERE id = ? AND workspace_id = ?`,
          [now, draftRevision, draft.id, workspaceId]
        );

        await recordChange(
          {
            entityType: 'objective',
            entityId: draft.id,
            operation: 'update',
            entityRevision: draftRevision,
            projectId: existing.project_id,
            missionId: existing.mission_id,
            objectiveId: draft.id,
            changedFields: ['state'],
            workspaceId
          },
          tx
        );
      }

      if (existing.state === 'future' && otherDrafts.length > 0) {
        const draftSlotPosition = Math.min(...otherDrafts.map(draft => draft.position));
        if (existing.position > draftSlotPosition) {
          const missionRows = (await tx.all(
            `SELECT * FROM objectives
               WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
            [existing.mission_id, workspaceId]
          )) as ObjectiveRow[];
          const positionById = new Map<string, number>();
          for (const row of missionRows) {
            if (row.id === id) {
              positionById.set(row.id, draftSlotPosition);
              continue;
            }
            if (row.position >= draftSlotPosition && row.position < existing.position) {
              positionById.set(row.id, row.position + 1);
            }
          }
          await applyObjectivePositionUpdates(tx, {
            workspaceId,
            missionId: existing.mission_id,
            projectId: existing.project_id,
            rows: missionRows,
            positionById,
            now
          });
        }
      }
    }

    await tx.run(
      `UPDATE objectives SET ${fields.join(', ')}, updated_at = ?, revision = ?
         WHERE id = ? AND workspace_id = ?`,
      [...setParams, now, revision, id, workspaceId]
    );

    await recordChange(
      {
        entityType: 'objective',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        projectId: existing.project_id,
        missionId: existing.mission_id,
        objectiveId: id,
        changedFields: changed,
        workspaceId
      },
      tx
    );

    if (
      body.state !== undefined &&
      body.state !== existing.state &&
      (body.state === 'executing' || body.state === 'complete' || existing.state === 'executing')
    ) {
      // Entering execution may also need to *start* the activity; every other
      // transition only refreshes one that is already on screen.
      if (body.state === 'executing') {
        await enqueueLiveActivityStartForMission({
          db: tx,
          workspaceId,
          missionId: existing.mission_id,
          now
        });
        await emitNotification({
          db: tx,
          workspaceId,
          missionId: existing.mission_id,
          objectiveId: id,
          type: 'agent_started',
          now
        });
      } else {
        await enqueueLiveActivityRefreshForMission({
          db: tx,
          workspaceId,
          missionId: existing.mission_id,
          now
        });
      }
    }

    if (
      body.state === 'executing' &&
      body.state !== existing.state &&
      (existing.state === 'draft' ||
        existing.state === 'future' ||
        existing.state === 'submitted' ||
        existing.state === 'launching')
    ) {
      await ensureDraftSlotAfterObjectiveLeavesQueue(tx, {
        workspaceId,
        missionId: existing.mission_id,
        projectId: existing.project_id,
        now
      });
    }

    const disconnectingToQueue =
      (body.state === 'draft' || body.state === 'submitted') &&
      body.state !== existing.state &&
      DISCONNECT_FROM_STATES.includes(existing.state as (typeof DISCONNECT_FROM_STATES)[number]);

    // When a user manually moves an objective out of the launch pipeline
    // (completing it, disconnecting it back to submitted, or parking to future),
    // the runner must stop seeing it: clear queued work and end open sessions.
    if (
      body.state !== undefined &&
      body.state !== existing.state &&
      (disconnectingToQueue || !LAUNCHABLE_STATES.includes(body.state))
    ) {
      await dequeueObjective({
        objectiveId: id,
        projectId: existing.project_id,
        missionId: existing.mission_id,
        workspaceId,
        workspaceUserId,
        reason: body.state === 'complete' ? 'completed' : 'disconnected',
        newState: body.state,
        now,
        tx
      });
    }

    // REST and Protocol retain `autoAdvance` as a compatibility input, but the
    // Run Queue is the only sequencer. Keep the legacy column write above during
    // the staged retirement and materialize/remove live membership here.
    if (body.autoAdvance !== undefined) {
      if (body.autoAdvance) {
        await enqueueObjectiveAfterLastQueuedSibling(tx, existing.project_id, id, workspaceUserId);
      } else {
        await removeRunQueueEntryForObjective(tx, existing.project_id, id);
      }
    }

    // Fixing what a hold was waiting on — assigning an agent, writing the
    // instructions, moving the objective back into a launchable state, pointing
    // it at a connected resource — has to ask for a tick. Without this the
    // dispatcher only noticed on the next 60 s sweep, so the queue looked stuck
    // for a minute after the user had already done the thing it asked for.
    if (RUN_QUEUE_DISPATCH_FIELDS.some(field => changed.includes(field))) {
      const liveEntry = await tx.get<{ id: string }>(
        'SELECT id FROM run_queue_entries WHERE project_id = ? AND objective_id = ? AND deleted_at IS NULL',
        [existing.project_id, id]
      );
      if (liveEntry) await enqueueRunQueueDispatch(tx, existing.project_id, workspaceId);
    }

    const row = (await tx.get(
      `SELECT o.*, m.display_id AS mission_display_id
         FROM objectives o
         JOIN missions m ON m.id = o.mission_id
        WHERE o.id = ?`,
      [id]
    )) as ObjectiveRow;
    const objective = toObjectiveDto(row);

    return {
      objective,
      regenerateTitle: instructionChanged && body.title === undefined
    };
  });
}

export async function updateObjective(
  id: string,
  body: UpdateObjectiveBody
): Promise<ObjectiveDto> {
  const { objective, regenerateTitle } = await updateObjectiveTx(id, body);

  if (regenerateTitle) {
    scheduleObjectiveTitleGeneration({
      objectiveId: objective.id,
      projectId: objective.projectId,
      missionId: objective.missionId,
      instructionText: objective.instructionText
    });
  }

  return objective;
}

export async function deleteObjective(idRef: string): Promise<void> {
  await deleteObjectives([idRef]);
}

// ---- Profile -------------------------------------------------------------
//
// This build runs as a single trusted local operator, so "the profile" is the
// operator's row in the `profiles` table. The avatar URL has no dedicated
// column in the core schema, so it lives in `profiles.metadata_json.avatarUrl`.

interface UserRow {
  id: string;
  kind: string;
  display_name: string;
  handle: string | null;
  email: string | null;
  metadata_json: string;
  created_at: string;
  revision: number;
}

/**
 * Resolve the caller's `profiles` row: the authenticated profile — or the one
 * behind the attributed workspace member — falling back to the oldest active
 * human user so a local operator with neither still resolves an identity.
 */
async function loadOperatorUserRow(db: DatabaseClient = requireDatabaseClient()): Promise<UserRow> {
  // Session and USER_TOKEN requests authenticate a profile without attributing
  // an ambient workspace member, so the authenticated profile is the authority.
  // The oldest-profile fallback below exists only for the loopback/local
  // operator and direct-service callers, which never establish one; letting it
  // answer for an authenticated caller would hand them another account.
  const profileId = await resolveActiveProfileId(db);
  if (profileId) {
    const row = (await db.get(
      `SELECT p.id, p.kind, p.display_name, p.handle, p.email,
                p.metadata_json, p.created_at, p.revision
           FROM profiles p
          WHERE p.id = ? AND p.deleted_at IS NULL`,
      [profileId]
    )) as UserRow | undefined;
    if (row) return row;
  }
  const fallback = (await db.get(
    `SELECT id, kind, display_name, handle, email,
              metadata_json, created_at, revision
         FROM profiles
        WHERE kind = 'human' AND status = 'active' AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`
  )) as UserRow | undefined;
  if (!fallback) throw new ApiError(409, 'No local user profile exists');
  return fallback;
}

function parseProfileMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function avatarUrlFromMetadata(metadataJson: string): string | null {
  const avatarUrl = parseProfileMetadata(metadataJson).avatarUrl;
  return typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl : null;
}

function agentInstructionsFromMetadata(metadataJson: string): string | null {
  const agentInstructions = parseProfileMetadata(metadataJson).agentInstructions;
  return typeof agentInstructions === 'string' && agentInstructions.trim()
    ? agentInstructions.trim()
    : null;
}

function editorSchemeFromMetadata(metadataJson: string): string | null {
  const editorScheme = parseProfileMetadata(metadataJson).editorScheme;
  return typeof editorScheme === 'string' && editorScheme.trim() ? editorScheme.trim() : null;
}

/** Merge profile metadata without dropping unrelated keys. */
function mergeProfileMetadataJson({
  metadataJson,
  avatarUrl,
  agentInstructions,
  editorScheme
}: {
  metadataJson: string;
  avatarUrl?: string | null;
  agentInstructions?: string | null;
  editorScheme?: string | null;
}): string {
  const parsed = parseProfileMetadata(metadataJson);
  if (avatarUrl) parsed.avatarUrl = avatarUrl;
  else if (avatarUrl !== undefined) delete parsed.avatarUrl;

  if (agentInstructions !== undefined) {
    const trimmed = agentInstructions?.trim() ?? '';
    if (trimmed) parsed.agentInstructions = trimmed;
    else delete parsed.agentInstructions;
  }

  if (editorScheme !== undefined) {
    const trimmed = editorScheme?.trim() ?? '';
    if (trimmed) parsed.editorScheme = trimmed;
    else delete parsed.editorScheme;
  }

  return JSON.stringify(parsed);
}

async function toProfileDto(row: UserRow): Promise<ProfileDto> {
  const authorized = getAuthorizedWorkspacesContext();
  const roles = authorized
    ? [...new Set(authorized.workspaces.flatMap(workspace => workspace.roleKeys))].sort()
    : await loadActorRoles({
        workspaceId: getBootstrapWorkspaceIdOrNull() ?? '',
        workspaceUserId: getActorWorkspaceUserId()
      });
  return {
    userId: row.id,
    displayName: row.display_name,
    handle: row.handle,
    email: row.email,
    avatarUrl: avatarUrlFromMetadata(row.metadata_json),
    agentInstructions: agentInstructionsFromMetadata(row.metadata_json),
    editorScheme: editorSchemeFromMetadata(row.metadata_json),
    kind: row.kind,
    authProvider: 'better-auth',
    roles,
    createdAt: row.created_at
  };
}

export async function getProfile(): Promise<ProfileDto> {
  return toProfileDto(await loadOperatorUserRow());
}

const DEFAULT_PROJECT_PREFERENCE_NAMESPACE = 'overlord';
const DEFAULT_PROJECT_PREFERENCE_KEY = 'defaultProject';

type ProjectPreferenceRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  workspace_user_id: string;
  preferences_json: string;
  revision: number;
};

function parseProjectPreferenceJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hasDefaultProjectMarker(preferences: Record<string, unknown>): boolean {
  const namespace = preferences[DEFAULT_PROJECT_PREFERENCE_NAMESPACE];
  return (
    namespace !== null &&
    typeof namespace === 'object' &&
    !Array.isArray(namespace) &&
    (namespace as Record<string, unknown>)[DEFAULT_PROJECT_PREFERENCE_KEY] === true
  );
}

function withDefaultProjectMarker(
  preferences: Record<string, unknown>,
  isDefault: boolean
): Record<string, unknown> {
  const next = { ...preferences };
  const existingNamespace = next[DEFAULT_PROJECT_PREFERENCE_NAMESPACE];
  const namespace =
    existingNamespace !== null &&
    typeof existingNamespace === 'object' &&
    !Array.isArray(existingNamespace)
      ? { ...(existingNamespace as Record<string, unknown>) }
      : {};
  if (isDefault) namespace[DEFAULT_PROJECT_PREFERENCE_KEY] = true;
  else delete namespace[DEFAULT_PROJECT_PREFERENCE_KEY];
  if (Object.keys(namespace).length === 0) delete next[DEFAULT_PROJECT_PREFERENCE_NAMESPACE];
  else next[DEFAULT_PROJECT_PREFERENCE_NAMESPACE] = namespace;
  return next;
}

async function listProjectPreferenceRowsForProfile(
  profileId: string,
  db: DatabaseClient
): Promise<ProjectPreferenceRow[]> {
  return (await db.all(
    `SELECT pup.id, pup.workspace_id, pup.project_id, pup.workspace_user_id,
            pup.preferences_json, pup.revision
       FROM project_user_preferences pup
       JOIN workspace_users wu
         ON wu.id = pup.workspace_user_id
        AND wu.profile_id = ?
        AND wu.status = 'active'
        AND wu.deleted_at IS NULL
       JOIN workspaces w ON w.id = pup.workspace_id AND w.deleted_at IS NULL
      WHERE pup.deleted_at IS NULL`,
    [profileId]
  )) as ProjectPreferenceRow[];
}

/**
 * Read the account-wide default-project marker. A marker is navigation state,
 * not authority: an archived, deleted, or no-longer-readable project returns
 * `null` without mutating the stored preference.
 */
export async function getDefaultProjectPreference(): Promise<DefaultProjectPreferenceDto> {
  const db = requireDatabaseClient();
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) return { projectId: null };
  const rows = await listProjectPreferenceRowsForProfile(profileId, db);
  for (const row of rows) {
    if (!hasDefaultProjectMarker(parseProjectPreferenceJson(row.preferences_json))) continue;
    const project = await db.get<{ id: string }>(
      `SELECT p.id
         FROM projects p
         JOIN workspace_users wu
           ON wu.id = ?
          AND wu.workspace_id = p.workspace_id
          AND wu.profile_id = ?
          AND wu.status = 'active'
          AND wu.deleted_at IS NULL
        WHERE p.id = ? AND p.workspace_id = ? AND p.status = 'active' AND p.deleted_at IS NULL`,
      [row.workspace_user_id, profileId, row.project_id, row.workspace_id]
    );
    if (project) return { projectId: project.id };
  }
  return { projectId: null };
}

async function updateDefaultProjectPreference(
  projectId: string | null
): Promise<DefaultProjectPreferenceDto> {
  return requireDatabaseClient().transaction(async tx => {
    const profileId = await resolveActiveProfileId(tx);
    if (!profileId) throw new ApiError(401, 'Authentication required');

    let selectedScope: { workspaceId: string; workspaceUserId: string } | null = null;
    if (projectId) {
      selectedScope = await requireProjectPermission({
        projectId,
        permission: PERMISSIONS.PROJECT_READ,
        db: tx
      });
      const activeProject = await tx.get<{ id: string }>(
        `SELECT id FROM projects
          WHERE id = ? AND workspace_id = ? AND status = 'active' AND deleted_at IS NULL`,
        [projectId, selectedScope.workspaceId]
      );
      if (!activeProject) throw new ApiError(404, 'Project not found');
    }

    const now = nowIso();
    const rows = await listProjectPreferenceRowsForProfile(profileId, tx);
    let selectedRow = projectId
      ? rows.find(
          row =>
            row.project_id === projectId && row.workspace_user_id === selectedScope?.workspaceUserId
        )
      : undefined;

    for (const row of rows) {
      const shouldBeDefault =
        projectId !== null &&
        row.project_id === projectId &&
        row.workspace_user_id === selectedScope?.workspaceUserId;
      const preferences = parseProjectPreferenceJson(row.preferences_json);
      if (hasDefaultProjectMarker(preferences) === shouldBeDefault) continue;
      await tx.run(
        `UPDATE project_user_preferences
            SET preferences_json = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ?`,
        [
          JSON.stringify(withDefaultProjectMarker(preferences, shouldBeDefault)),
          now,
          row.id,
          row.revision
        ]
      );
    }

    if (projectId && selectedScope && !selectedRow) {
      selectedRow = {
        id: newId(),
        workspace_id: selectedScope.workspaceId,
        project_id: projectId,
        workspace_user_id: selectedScope.workspaceUserId,
        preferences_json: '{}',
        revision: 1
      };
      await tx.run(
        `INSERT INTO project_user_preferences
           (id, workspace_id, project_id, workspace_user_id, preferences_json,
            created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          selectedRow.id,
          selectedRow.workspace_id,
          selectedRow.project_id,
          selectedRow.workspace_user_id,
          JSON.stringify(withDefaultProjectMarker({}, true)),
          now,
          now,
          1
        ]
      );
    }

    return { projectId };
  });
}

export async function setDefaultProjectPreference(
  projectId: string
): Promise<DefaultProjectPreferenceDto> {
  const normalized = projectId.trim();
  if (!normalized) throw new ApiError(400, 'projectId is required');
  return updateDefaultProjectPreference(normalized);
}

export async function clearDefaultProjectPreference(): Promise<DefaultProjectPreferenceDto> {
  return updateDefaultProjectPreference(null);
}

export async function updateProfile(body: UpdateProfileBody): Promise<ProfileDto> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await loadOperatorUserRow(tx);

    const fields: string[] = [];
    const setParams: unknown[] = [];
    const changed: string[] = [];
    // `metadata_json` may be updated by several body fields; track its value and a
    // single placeholder so repeated edits compose instead of clobbering.
    let metadataJson: string | undefined;
    const setMetadata = (value: string): void => {
      metadataJson = value;
      if (!changed.includes('metadata_json')) changed.push('metadata_json');
    };

    if (body.displayName !== undefined) {
      const displayName = body.displayName.trim();
      if (!displayName) throw new ApiError(400, 'Display name cannot be empty');
      fields.push('display_name = ?');
      setParams.push(displayName);
      changed.push('display_name');
    }
    // `handle` is not directly editable: it mirrors the Better Auth account
    // name via the auth→profiles bridge trigger.
    // `email` is likewise not directly editable here: it is the primary
    // identifier and mirrors the Better Auth account email via the
    // auth→profiles bridge trigger. Email is changed through the Auth surface
    // (Account settings), not this profile patch.
    if (body.avatarUrl !== undefined) {
      const avatarUrl = body.avatarUrl?.trim() || null;
      // Accept absolute http(s) URLs or a server-relative path (e.g. an image
      // uploaded through the core upload service: `/api/storage/user-images/…`).
      if (avatarUrl && !/^(https?:\/\/|\/)/i.test(avatarUrl)) {
        throw new ApiError(400, 'Avatar URL must be an http(s) URL or an uploaded image path');
      }
      setMetadata(
        mergeProfileMetadataJson({
          metadataJson: existing.metadata_json,
          avatarUrl
        })
      );
    }
    if (body.agentInstructions !== undefined) {
      setMetadata(
        mergeProfileMetadataJson({
          metadataJson: metadataJson ?? existing.metadata_json,
          agentInstructions: body.agentInstructions
        })
      );
    }
    if (body.editorScheme !== undefined) {
      setMetadata(
        mergeProfileMetadataJson({
          metadataJson: metadataJson ?? existing.metadata_json,
          editorScheme: body.editorScheme
        })
      );
    }
    if (metadataJson !== undefined) {
      fields.push('metadata_json = ?');
      setParams.push(metadataJson);
    }
    if (fields.length === 0) return;

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE profiles SET ${fields.join(', ')}, updated_at = ?, revision = ?
       WHERE id = ?`,
      [...setParams, now, revision, existing.id]
    );

    const authorized = getAuthorizedWorkspacesContext();
    const changeScopes = authorized?.workspaces.length
      ? authorized.workspaces.map(workspace => ({
          workspaceId: workspace.workspaceId,
          workspaceUserId: workspace.workspaceUserId
        }))
      : getBootstrapWorkspaceIdOrNull()
        ? [
            {
              workspaceId: getBootstrapWorkspaceIdOrNull()!,
              workspaceUserId: getActorWorkspaceUserId()
            }
          ]
        : [];
    for (const scope of changeScopes) {
      await recordChange(
        {
          entityType: 'profile',
          entityId: existing.id,
          operation: 'update',
          entityRevision: revision,
          changedFields: changed,
          workspaceId: scope.workspaceId,
          actorWorkspaceUserId: scope.workspaceUserId
        },
        tx
      );
    }
  });

  return getProfile();
}

// ---- User tokens ---------------------------------------------------------
//
// `USER_TOKEN`s are long-lived credentials an authenticated user can mint for
// CLI, agent, runner, and future API use (see
// auth/docs/07-user-token-authentication.md). A token authenticates the user
// profile across workspaces; authorization is resolved from the active workspace
// membership on each request. We store only a hash of the secret plus a
// non-secret display prefix; the raw secret is returned exactly once at creation
// and never persisted or shown again. Secret format, hashing, and scope-grant
// reads live in `@overlord/auth` (the Auth Layer owns token creation and hash
// storage per CONTRACT.md); this module owns persistence and lifecycle state.

const USER_TOKEN_COLUMNS =
  'id, label, token_prefix, status, expires_at, last_used_at, revoked_at, created_at';

interface UserTokenRow {
  id: string;
  label: string;
  token_prefix: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface UserTokenMutableRow {
  id: string;
  workspace_id: string | null;
  workspace_user_id: string | null;
  status: string;
  revision: number;
}

interface OperatorIdentity {
  userId: string;
  workspaceUserId: string | null;
}

async function toUserTokenDto(db: DatabaseClient, row: UserTokenRow): Promise<UserTokenDto> {
  const scopeGrants = await listActiveTokenScopeGrants(db, row.id);
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    status: row.status as UserTokenDto['status'],
    scope: scopeGrants.length > 0 ? 'mission_lifecycle' : 'full',
    scopeGrants,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}

/**
 * Resolve the global user id that owns tokens plus the caller's active
 * workspace membership for audit attribution. Session and USER_TOKEN requests
 * carry no ambient workspace member, so the authenticated profile is the
 * authority; the operator-row fallback only serves the loopback/local and
 * direct-service callers that never establish one.
 */
async function loadOperatorIdentity(db: DatabaseClient): Promise<OperatorIdentity> {
  const user = await loadOperatorUserRow(db);
  return { userId: user.id, workspaceUserId: getActorWorkspaceUserId() };
}

interface TokenIssuanceConsent {
  /** Null only for a bootstrap/loopback caller; resolved from the issuance workspace. */
  organizationId: string | null;
  allWorkspaces: boolean;
  workspaceIds: string[];
  issuanceWorkspaceId: string;
  issuanceWorkspaceUserId: string;
}

/**
 * Consent for a token the signed-in user mints for themselves — `ovld login`
 * and the settings page. There is no third party to narrow access for, so the
 * token consents to every current and future workspace in the caller's
 * organization: `USER_TOKEN`s authenticate the account, and every request still
 * intersects that consent with live membership and per-workspace RBAC, so
 * joining or leaving a workspace takes effect immediately without reissuing the
 * token. Third-party OAuth clients pass explicit `consent` instead and are
 * narrowed to whatever the approval screen selected.
 *
 * The issuance workspace is audit attribution only — never an authorization
 * input — so a deterministic pick from the authorized snapshot is enough; the
 * route's `requireAnyWorkspacePermission` is the gate.
 */
function selfIssuedTokenConsent(): TokenIssuanceConsent {
  const authorized = getAuthorizedWorkspacesContext();
  if (authorized) {
    const issuance = [...authorized.workspaces].sort((a, b) =>
      a.workspaceId.localeCompare(b.workspaceId)
    )[0];
    if (!issuance) {
      throw new ApiError(409, 'No workspace membership is available for token issuance');
    }
    return {
      organizationId: authorized.organizationId,
      allWorkspaces: true,
      workspaceIds: [],
      issuanceWorkspaceId: issuance.workspaceId,
      issuanceWorkspaceUserId: issuance.workspaceUserId
    };
  }
  const workspaceId = getBootstrapWorkspaceIdOrNull();
  const workspaceUserId = getActorWorkspaceUserId();
  if (!workspaceId || !workspaceUserId) {
    throw new ApiError(409, 'No workspace membership is available for token issuance');
  }
  return {
    organizationId: null,
    allWorkspaces: true,
    workspaceIds: [],
    issuanceWorkspaceId: workspaceId,
    issuanceWorkspaceUserId: workspaceUserId
  };
}

async function loadUserTokenForUpdate(
  db: DatabaseClient,
  id: string
): Promise<UserTokenMutableRow> {
  const { userId } = await loadOperatorIdentity(db);
  const row = (await db.get(
    `SELECT id, workspace_id, workspace_user_id, status, revision FROM user_tokens
         WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    [id, userId]
  )) as UserTokenMutableRow | undefined;
  if (!row) throw new ApiError(404, 'Token not found');
  return row;
}

async function reloadUserToken(db: DatabaseClient, id: string): Promise<UserTokenRow> {
  return (await db.get(`SELECT ${USER_TOKEN_COLUMNS} FROM user_tokens WHERE id = ?`, [
    id
  ])) as UserTokenRow;
}

export async function listUserTokens(): Promise<UserTokenDto[]> {
  const client = requireDatabaseClient();
  const { userId } = await loadOperatorIdentity(client);
  const rows = (await client.all(
    `SELECT ${USER_TOKEN_COLUMNS} FROM user_tokens
         WHERE profile_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
    [userId]
  )) as UserTokenRow[];
  return Promise.all(rows.map(row => toUserTokenDto(client, row)));
}

export async function createUserToken(
  body: CreateUserTokenBody,
  consent?: {
    organizationId: string;
    allWorkspaces: boolean;
    workspaceIds: string[];
    issuanceWorkspaceId: string;
    issuanceWorkspaceUserId: string;
  }
): Promise<CreateUserTokenResultDto> {
  return requireDatabaseClient().transaction(async tx => {
    const label = body.label?.trim();
    if (!label) throw new ApiError(400, 'Token label cannot be empty');

    // Expiry resolution: an explicit value is validated and used; an explicit
    // `null` opts out (non-expiring); omitting the field defaults to 90 days so a
    // forgotten leaked token stops working on its own (security audit 2026-06-18).
    let expiresAt: string | null = null;
    if (body.expiresAt === undefined) {
      expiresAt = new Date(
        Date.now() + DEFAULT_USER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
    } else if (body.expiresAt !== null && String(body.expiresAt).trim()) {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) throw new ApiError(400, 'Expiry must be a valid date');
      if (parsed.getTime() <= Date.now()) throw new ApiError(400, 'Expiry must be in the future');
      expiresAt = parsed.toISOString();
    }

    const scope: TokenScope = body.scope ?? 'full';
    if (scope !== 'full' && scope !== 'mission_lifecycle') {
      throw new ApiError(400, `Unknown token scope: ${String(scope)}`);
    }
    const scopeGrants = scopeGrantsForPreset(scope);

    // An OAuth client supplies the consent its approval screen collected; a
    // token the user mints for themselves consents to their whole organization.
    const issuance: TokenIssuanceConsent = consent ?? selfIssuedTokenConsent();
    const { userId } = await loadOperatorIdentity(tx);
    if (!userId) throw new ApiError(401, 'Authentication required');
    const workspaceUserId = issuance.issuanceWorkspaceUserId;
    const workspaceId = issuance.issuanceWorkspaceId;
    const workspace = await tx.get<{ organization_id: string }>(
      `SELECT organization_id FROM workspaces WHERE id = ? AND deleted_at IS NULL`,
      [workspaceId]
    );
    if (!workspace) throw new ApiError(409, 'Active workspace no longer exists');
    const organizationId = issuance.organizationId ?? workspace.organization_id;
    if (workspace.organization_id !== organizationId) {
      throw new ApiError(400, 'Token consent organization does not match its issuance workspace');
    }
    if (!issuance.allWorkspaces && issuance.workspaceIds.length === 0) {
      throw new ApiError(400, 'Explicit token consent requires at least one workspace');
    }
    if (!issuance.allWorkspaces) {
      for (const consentedWorkspaceId of issuance.workspaceIds) {
        const consentedWorkspace = await tx.get<{ organization_id: string }>(
          `SELECT organization_id FROM workspaces WHERE id = ? AND deleted_at IS NULL`,
          [consentedWorkspaceId]
        );
        if (!consentedWorkspace || consentedWorkspace.organization_id !== organizationId) {
          throw new ApiError(400, 'Token consent workspaces must belong to its organization');
        }
      }
    }

    // Token prefixes are display/lookup metadata owned by the profile; retry on
    // the rare per-user clash.
    let generated: ReturnType<typeof generateUserTokenSecret> | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateUserTokenSecret();
      const clash = await tx.get(
        'SELECT 1 FROM user_tokens WHERE profile_id = ? AND token_prefix = ?',
        [userId, candidate.prefix]
      );
      if (!clash) {
        generated = candidate;
        break;
      }
    }
    if (!generated) throw new ApiError(409, 'Could not allocate a unique token prefix; try again');

    const id = newId();
    const now = nowIso();
    await tx.run(
      `INSERT INTO user_tokens (
         id, workspace_id, organization_id, all_workspaces, profile_id, workspace_user_id, label,
         token_prefix, token_hash, hash_algorithm, status, expires_at,
         last_used_context_json, metadata_json, created_at, updated_at, revision
       ) VALUES (?, ?, ?, false, ?, ?, ?, ?, ?, ?, 'active', ?, '{}', '{}', ?, ?, 1)`,
      [
        id,
        workspaceId,
        organizationId,
        userId,
        workspaceUserId,
        label,
        generated.prefix,
        generated.hash,
        USER_TOKEN_HASH_ALGORITHM,
        expiresAt,
        now,
        now
      ]
    );

    if (issuance.allWorkspaces) {
      await tx.run(`UPDATE user_tokens SET all_workspaces = true WHERE id = ?`, [id]);
    } else {
      for (const consentedWorkspaceId of issuance.workspaceIds) {
        await tx.run(
          `INSERT INTO user_token_workspaces (token_id, workspace_id, created_at)
           VALUES (?, ?, ?)`,
          [id, consentedWorkspaceId, now]
        );
      }
    }

    // A `full` token carries no scope rows (no token-level restriction). A scoped
    // token persists one grant pattern per row; auth-time enforcement intersects
    // these with the creating user's role grants.
    for (const permission of scopeGrants) {
      await tx.run(
        `INSERT INTO user_token_scopes (
         id, workspace_id, token_id, permission, resource_type, resource_id,
         created_at, updated_at, revision
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 1)`,
        [newId(), workspaceId, id, permission, now, now]
      );
    }

    await recordChange(
      {
        entityType: 'user_token',
        entityId: id,
        operation: 'insert',
        entityRevision: 1,
        workspaceId,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );

    return {
      token: await toUserTokenDto(tx, await reloadUserToken(tx, id)),
      secret: generated.secret
    };
  });
}

export async function renameUserToken(
  id: string,
  body: UpdateUserTokenBody
): Promise<UserTokenDto> {
  return requireDatabaseClient().transaction(async tx => {
    const existing = await loadUserTokenForUpdate(tx, id);
    if (!existing.workspace_id) throw new ApiError(409, 'Token has no issuance workspace');
    const label = body.label?.trim();
    if (!label) throw new ApiError(400, 'Token label cannot be empty');

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE user_tokens SET label = ?, updated_at = ?, revision = ?
         WHERE id = ? AND profile_id = ?`,
      [label, now, revision, id, (await loadOperatorIdentity(tx)).userId]
    );

    await recordChange(
      {
        entityType: 'user_token',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        changedFields: ['label'],
        workspaceId: existing.workspace_id
      },
      tx
    );

    return toUserTokenDto(tx, await reloadUserToken(tx, id));
  });
}

export async function revokeUserToken(id: string): Promise<UserTokenDto> {
  return requireDatabaseClient().transaction(async tx => {
    const existing = await loadUserTokenForUpdate(tx, id);
    if (!existing.workspace_id) throw new ApiError(409, 'Token has no issuance workspace');
    // Revocation is idempotent: revoking an already-revoked token is a no-op.
    if (existing.status === 'revoked') return toUserTokenDto(tx, await reloadUserToken(tx, id));

    const { userId } = await loadOperatorIdentity(tx);
    const workspaceUserId = await findActiveMembershipId(existing.workspace_id, userId, tx);
    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE user_tokens
        SET status = 'revoked', revoked_at = ?,
            revoked_by_workspace_user_id = ?,
            updated_at = ?, revision = ?
      WHERE id = ? AND profile_id = ?`,
      [now, workspaceUserId, now, revision, id, userId]
    );

    await recordChange(
      {
        entityType: 'user_token',
        entityId: id,
        operation: 'update',
        entityRevision: revision,
        changedFields: ['status', 'revoked_at'],
        workspaceId: existing.workspace_id,
        actorWorkspaceUserId: workspaceUserId
      },
      tx
    );

    return toUserTokenDto(tx, await reloadUserToken(tx, id));
  });
}

/**
 * Remove a token only after it has been revoked. The row remains a soft-delete
 * tombstone for audit and sync, while listUserTokens filters it from settings.
 */
export async function deleteRevokedUserToken(id: string): Promise<void> {
  await requireDatabaseClient().transaction(async tx => {
    const existing = await loadUserTokenForUpdate(tx, id);
    if (!existing.workspace_id) throw new ApiError(409, 'Token has no issuance workspace');
    if (existing.status !== 'revoked') {
      throw new ApiError(409, 'Only revoked tokens can be deleted');
    }

    const { userId } = await loadOperatorIdentity(tx);
    const now = nowIso();
    const revision = existing.revision + 1;
    const result = await tx.run(
      `UPDATE user_tokens
          SET deleted_at = ?, updated_at = ?, revision = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND revision = ?`,
      [now, now, revision, id, userId, existing.revision]
    );
    if (result.changes !== 1) throw new ApiError(409, 'Token changed; refresh and try again');

    await recordChange(
      {
        entityType: 'user_token',
        entityId: id,
        operation: 'delete',
        entityRevision: revision,
        changedFields: ['deleted_at'],
        workspaceId: existing.workspace_id
      },
      tx
    );
  });
}

export async function revokeUserTokenSecret(rawToken: string): Promise<boolean> {
  if (!rawToken.startsWith(USER_TOKEN_PREFIX)) return false;
  const tokenHash = hashUserTokenSecret(rawToken);

  return requireDatabaseClient().transaction(async tx => {
    const existing = (await tx.get(
      `SELECT id, workspace_id, workspace_user_id, status, revision
         FROM user_tokens
        WHERE token_hash = ? AND deleted_at IS NULL
        LIMIT 1`,
      [tokenHash]
    )) as
      | {
          id: string;
          workspace_id: string;
          workspace_user_id: string | null;
          status: string;
          revision: number;
        }
      | undefined;

    if (!existing || existing.status === 'revoked') return false;

    const now = nowIso();
    const revision = existing.revision + 1;
    await tx.run(
      `UPDATE user_tokens
        SET status = 'revoked', revoked_at = ?,
            revoked_by_workspace_user_id = COALESCE(?, revoked_by_workspace_user_id),
            updated_at = ?, revision = ?
      WHERE id = ? AND revision = ?`,
      [now, existing.workspace_user_id, now, revision, existing.id, existing.revision]
    );

    await recordChange(
      {
        entityType: 'user_token',
        entityId: existing.id,
        operation: 'update',
        entityRevision: revision,
        changedFields: ['status', 'revoked_at'],
        workspaceId: existing.workspace_id,
        actorWorkspaceUserId: existing.workspace_user_id
      },
      tx
    );

    return true;
  });
}
