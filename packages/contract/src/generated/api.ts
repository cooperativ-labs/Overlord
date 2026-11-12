// Generated from contract/api/openapi.yaml by scripts/generate-api-contract.mjs (`yarn api:generate`).
// Do not edit by hand: change the OpenAPI description and regenerate.
// Lenient formats (default): `format: uuid` and `format: date-time` accept any string (ADR 0050).
/* eslint-disable */
import { z } from 'zod';

/** The contract version (contract/VERSION) this API description belongs to. */
export const contractVersion = "169.1.1";

/** The API description's own version (OpenAPI `info.version`). */
export const apiVersion = "2.1.1";

/** A non-JSON request or response body: raw bytes (G3). */
export type BinaryBody = Uint8Array | ArrayBuffer | Blob;

function isBinaryBody(value: unknown): value is BinaryBody {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function hasUniqueItems(items: readonly unknown[]): boolean {
  return new Set(items.map(item => JSON.stringify(item))).size === items.length;
}

/** Raw bytes: the schema of every `contentMediaType` string (uploads and downloads). */
export const binaryBodySchema: z.ZodType<BinaryBody> = z.custom<BinaryBody>(isBinaryBody, {
  error: 'Expected a binary body'
});

// ---- Component schemas ----

/**
 * Any JSON value. Used where the code passes through arbitrary JSON (artifact `contentJson`, shared-context values, ServiceError `details`, repository-read `data`).
 */
export type JsonValue = unknown;
export const jsonValueSchema: z.ZodType<JsonValue> = z.unknown();

/**
 * The one JSON error body of every route that forwards errors to `apiErrorHandler` (backend/errors.ts), and of the authentication middleware and the project-automation route guard. `error` is always present. Which other members appear depends on the error's origin: an ApiError writes `detail` and `code` when set; a service-layer ServiceError writes `code` and, when present, `details`; the body parser's 413 writes `code: body_too_large`; a JSON body that does not parse writes `code: invalid_json`; a request the boundary refuses (ADR 0051) writes `code: invalid_request`, `detail` (the first issues, as `<location>.<member>: <message>`) and `details: { issues: [{ in, path, code, message }] }`, where `in` is `path`, `query`, `header` or `body`, `path` is the dotted member path and no submitted value is echoed; a SQLite constraint failure writes `detail` (the driver message) and no `code`; an unexpected failure (500) writes `detail` equal to `error`. Clients branch on `code` and HTTP status, never on `error` text.
 */
export interface ErrorEnvelope {
  /**
   * Human-readable message.
   */
  error: string;
  /**
   * Machine-readable code when the error carries one (open vocabulary, for example `validation_error`, `not_found`, `invalid_input`, `invalid_json`, `invalid_request`, `body_too_large`, `no_execution_target_registered`, `BRANCH_NOT_PREPARED`).
   */
  code?: string;
  /**
   * Additional human-readable detail (ApiError detail, driver message, or the 500 message).
   */
  detail?: string;
  details?: JsonValue;
}
export const errorEnvelopeSchema: z.ZodType<ErrorEnvelope> = z.object({ "error": z.string(), "code": z.exactOptional(z.string()), "detail": z.exactOptional(z.string()), "details": z.exactOptional(jsonValueSchema) });

/**
 * Acknowledgement written by `handle()` when a handler returns nothing, or returned explicitly.
 */
export interface OkResponse {
  ok: true;
}
export const okResponseSchema: z.ZodType<OkResponse> = z.object({ "ok": z.literal(true) });

/**
 * ISO-8601 timestamp. Postgres values are normalized to UTC `…Z`; SQLite values are stored as written (`nowIso()` writes UTC `…Z`).
 */
export type DateTime = string;
export const dateTimeSchema: z.ZodType<DateTime> = z.string();

export type StatusType = "draft" | "next" | "execute" | "review" | "complete" | "blocked" | "cancelled";
export const statusTypeSchema: z.ZodType<StatusType> = z.enum(["draft", "next", "execute", "review", "complete", "blocked", "cancelled"]);

export type MissionPriority = "low" | "normal" | "high" | "urgent";
export const missionPrioritySchema: z.ZodType<MissionPriority> = z.enum(["low", "normal", "high", "urgent"]);

export type ObjectiveState = "future" | "draft" | "submitted" | "launching" | "executing" | "pending_delivery" | "complete";
export const objectiveStateSchema: z.ZodType<ObjectiveState> = z.enum(["future", "draft", "submitted", "launching", "executing", "pending_delivery", "complete"]);

/**
 * Rows predating creation provenance report `human`.
 */
export type CreatedByKind = "human" | "agent" | "automation";
export const createdByKindSchema: z.ZodType<CreatedByKind> = z.enum(["human", "agent", "automation"]);

export type ProjectLifecycle = "active" | "archived";
export const projectLifecycleSchema: z.ZodType<ProjectLifecycle> = z.enum(["active", "archived"]);

export type ProjectListLifecycle = "active" | "archived" | "all";
export const projectListLifecycleSchema: z.ZodType<ProjectListLifecycle> = z.enum(["active", "archived", "all"]);

export interface AgentLaunchFlagDto {
  /**
   * CLI flag token, usually starting with `--`.
   */
  name: string;
  /**
   * Positional value after the flag; absent or null for a boolean flag.
   */
  value?: string | null;
}
export const agentLaunchFlagDtoSchema: z.ZodType<AgentLaunchFlagDto> = z.object({ "name": z.string(), "value": z.exactOptional(z.string().nullable()) });

/**
 * A launch flag as accepted on input: a structured flag, or flag text (`--x`, `--x v`, `--x=v`) that the server parses. Entries without a non-blank name are dropped.
 */
export type AgentLaunchFlagInput = string | {
  name: string;
  value?: string | null;
};
export const agentLaunchFlagInputSchema: z.ZodType<AgentLaunchFlagInput> = z.union([z.string(), z.object({ "name": z.string(), "value": z.exactOptional(z.string().nullable()) })]);

export interface AgentLaunchConfigDto {
  preCommand: string;
  flags: AgentLaunchFlagDto[];
}
export const agentLaunchConfigDtoSchema: z.ZodType<AgentLaunchConfigDto> = z.object({ "preCommand": z.string(), "flags": z.array(agentLaunchFlagDtoSchema) });

/**
 * Launch mechanics as accepted on input; omitted members default to empty.
 */
export interface AgentLaunchConfigInput {
  preCommand?: string;
  flags?: AgentLaunchFlagInput[];
}
export const agentLaunchConfigInputSchema: z.ZodType<AgentLaunchConfigInput> = z.object({ "preCommand": z.exactOptional(z.string()), "flags": z.exactOptional(z.array(agentLaunchFlagInputSchema)) });

export interface ProjectDto {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  /**
   * Lower-case `#rrggbb` from project settings, or null.
   */
  color: string | null;
  /**
   * Configured base branch for mission branches; null falls back to `main`.
   */
  defaultBranch: string | null;
  status: ProjectLifecycle;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
  missionCount: number;
  /**
   * 1-based sidebar order within the workspace; 0 for a legacy row without one.
   */
  position: number;
  preLaunchCommands: string[];
  launchEnvVars: { [key: string]: string };
}
export const projectDtoSchema: z.ZodType<ProjectDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "slug": z.string(), "name": z.string(), "description": z.string().nullable(), "color": z.string().nullable(), "defaultBranch": z.string().nullable(), "status": projectLifecycleSchema, "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1), "missionCount": z.int().min(0), "position": z.int().min(0), "preLaunchCommands": z.array(z.string()), "launchEnvVars": z.record(z.string(), z.string()) });

export interface ProjectStatusDto {
  id: string;
  workspaceId: string;
  projectId: string;
  key: string;
  name: string;
  type: StatusType;
  position: number;
  isDefault: boolean;
  isTerminal: boolean;
}
export const projectStatusDtoSchema: z.ZodType<ProjectStatusDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "key": z.string(), "name": z.string(), "type": statusTypeSchema, "position": z.int().min(0), "isDefault": z.boolean(), "isTerminal": z.boolean() });

export interface ProjectTagDto {
  id: string;
  projectId: string;
  label: string;
  /**
   * Free-form trimmed color text (not validated), or null.
   */
  color: string | null;
  active: boolean;
}
export const projectTagDtoSchema: z.ZodType<ProjectTagDto> = z.object({ "id": z.string(), "projectId": z.string(), "label": z.string(), "color": z.string().nullable(), "active": z.boolean() });

export type ProjectResourceAccessMode = "read" | "read_write";
export const projectResourceAccessModeSchema: z.ZodType<ProjectResourceAccessMode> = z.enum(["read", "read_write"]);

export interface ProjectResourceSourceDto {
  id: string;
  /**
   * The target this source materializes on; null for a project-global source.
   */
  executionTargetId: string | null;
  /**
   * Open vocabulary; the REST surface writes `local_checkout` and `git`.
   */
  sourceKind: string;
  /**
   * The stored descriptor object (`path` for a checkout, `url` for git, plus `launchDefaults` when set); `{}` when the stored JSON is not an object.
   */
  descriptor: { [key: string]: unknown };
  /**
   * Per-agent launch defaults; `{}` when none.
   */
  launchDefaults: { [key: string]: AgentLaunchConfigDto };
  observedRevision: string | null;
  observedContentDigest: string | null;
}
export const projectResourceSourceDtoSchema: z.ZodType<ProjectResourceSourceDto> = z.object({ "id": z.string(), "executionTargetId": z.string().nullable(), "sourceKind": z.string(), "descriptor": z.record(z.string(), z.unknown()), "launchDefaults": z.record(z.string(), agentLaunchConfigDtoSchema), "observedRevision": z.string().nullable(), "observedContentDigest": z.string().nullable() });

export interface ProjectResourceDto {
  id: string;
  workspaceId: string;
  projectId: string;
  /**
   * Target of the representative source (the first `local_checkout` source, else the first source); null when none.
   */
  executionTargetId: string | null;
  resourceKey: string;
  /**
   * `local_directory` when the representative source is `local_checkout`, otherwise that source's kind (`git`, …), or `remote_directory` when the resource has no source. The TypeScript type lists `local_directory`, `remote_directory`, `git`, `source_bundle`.
   */
  type: string;
  label: string | null;
  /**
   * The checkout path of a `local_checkout` representative source, else empty.
   */
  path: string;
  isPrimary: boolean;
  accessMode: ProjectResourceAccessMode;
  status: "active" | "missing" | "archived";
  /**
   * When the representative source's target last reported this resource; null otherwise.
   */
  observedAt: DateTime | null;
  /**
   * `client` when `observedAt` is set, else null.
   */
  observationSource: "client" | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
  sources: ProjectResourceSourceDto[];
}
export const projectResourceDtoSchema: z.ZodType<ProjectResourceDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "executionTargetId": z.string().nullable(), "resourceKey": z.string(), "type": z.string(), "label": z.string().nullable(), "path": z.string(), "isPrimary": z.boolean(), "accessMode": projectResourceAccessModeSchema, "status": z.enum(["active", "missing", "archived"]), "observedAt": dateTimeSchema.nullable(), "observationSource": z.literal("client").nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1), "sources": z.array(projectResourceSourceDtoSchema) });

export interface MissionCreatorTokenDto {
  tokenId: string;
  label: string;
}
export const missionCreatorTokenDtoSchema: z.ZodType<MissionCreatorTokenDto> = z.object({ "tokenId": z.string(), "label": z.string() });

export interface ObjectiveRunQueueEntryDto {
  id: string;
  queueId: string;
  queueName: string;
  position: number;
  state: "waiting" | "blocked" | "dispatched" | "running";
  blockedReason: string | null;
  waitingReason: ("mission_busy" | "resource_disconnected" | "retry_pending") | null;
  waitingOnObjectiveId: string | null;
  waitingOnObjectiveDisplayId: string | null;
  attemptCount: number;
  /**
   * Always null in objective projections.
   */
  precededBy: null;
}
export const objectiveRunQueueEntryDtoSchema: z.ZodType<ObjectiveRunQueueEntryDto> = z.object({ "id": z.string(), "queueId": z.string(), "queueName": z.string(), "position": z.int().min(1), "state": z.enum(["waiting", "blocked", "dispatched", "running"]), "blockedReason": z.string().nullable(), "waitingReason": z.enum(["mission_busy", "resource_disconnected", "retry_pending"]).nullable(), "waitingOnObjectiveId": z.string().nullable(), "waitingOnObjectiveDisplayId": z.string().nullable(), "attemptCount": z.int().min(0), "precededBy": z.null() });

export interface ObjectiveDto {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  position: number;
  title: string | null;
  instructionText: string;
  state: ObjectiveState;
  /**
   * Deprecated; derived from live queue membership when the read joins it.
   */
  autoAdvance: boolean;
  /**
   * Live Run Queue membership; null when not queued or when the read does not join queue state (create and update responses).
   */
  queueEntry: ObjectiveRunQueueEntryDto | null;
  assignedAgent: string | null;
  model: string | null;
  reasoningEffort: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  launchedAt: DateTime | null;
  startedAt: DateTime | null;
  completedAt: DateTime | null;
  reopenedAt: DateTime | null;
  revision: number;
  /**
   * Native harness session id of the latest agent session; null where the read does not join sessions.
   */
  externalSessionId: string | null;
  branch: string | null;
  resourceKey: string | null;
  displayKey: string;
  /**
   * `{mission.displayId}.{displayKey}`, for example `coo:756.k7xm`.
   */
  displayId: string;
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  createdByWorkspaceUserId: string | null;
  /**
   * Explicit overrides keyed by execution target id (`*` = any target), then agent key; `{}` when none.
   */
  launchConfigOverrides: { [key: string]: { [key: string]: AgentLaunchConfigDto } };
}
export const objectiveDtoSchema: z.ZodType<ObjectiveDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "missionId": z.string(), "position": z.int().min(0), "title": z.string().nullable(), "instructionText": z.string(), "state": objectiveStateSchema, "autoAdvance": z.boolean(), "queueEntry": objectiveRunQueueEntryDtoSchema.nullable(), "assignedAgent": z.string().nullable(), "model": z.string().nullable(), "reasoningEffort": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "launchedAt": dateTimeSchema.nullable(), "startedAt": dateTimeSchema.nullable(), "completedAt": dateTimeSchema.nullable(), "reopenedAt": dateTimeSchema.nullable(), "revision": z.int().min(1), "externalSessionId": z.string().nullable(), "branch": z.string().nullable(), "resourceKey": z.string().nullable(), "displayKey": z.string(), "displayId": z.string(), "createdByKind": createdByKindSchema, "createdByAgent": z.string().nullable(), "createdByWorkspaceUserId": z.string().nullable(), "launchConfigOverrides": z.record(z.string(), z.record(z.string(), agentLaunchConfigDtoSchema)) });

export interface MissionDto {
  id: string;
  workspaceId: string;
  projectId: string;
  /**
   * Human-readable id, `<workspace prefix>:<sequence>` (for example `coo:756`).
   */
  displayId: string;
  sequenceNumber: number;
  title: string;
  statusId: string;
  statusType: StatusType;
  boardPosition: number;
  priority: MissionPriority | null;
  assignedWorkspaceUserId: string | null;
  /**
   * Human-only notes; never sent to agents.
   */
  notes: string | null;
  scheduleId: string | null;
  dueDatetime: DateTime | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
  objectiveCount: number;
  completedObjectiveCount: number;
  /**
   * True while an objective is `executing` or `pending_delivery`.
   */
  hasExecutingObjective: boolean;
  hasCompletedObjective: boolean;
  hasPendingObjectiveWithInstructions: boolean;
  hasUnseenBlockingQuestion: boolean;
  hasUnseenReturnedToExecute: boolean;
  allowParallelObjectives: boolean;
  draftObjectiveResourceKey: string | null;
  tags: ProjectTagDto[];
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  createdByWorkspaceUserId: string | null;
  createdByToken: MissionCreatorTokenDto | null;
  /**
   * Present only on `GET /api/projects/{id}/missions?includeObjectives=1`.
   */
  objectives?: ObjectiveDto[];
}
const missionDtoShape = { "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "displayId": z.string(), "sequenceNumber": z.int().min(1), "title": z.string(), "statusId": z.string(), "statusType": statusTypeSchema, "boardPosition": z.int(), "priority": missionPrioritySchema.nullable(), "assignedWorkspaceUserId": z.string().nullable(), "notes": z.string().nullable(), "scheduleId": z.string().nullable(), "dueDatetime": dateTimeSchema.nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1), "objectiveCount": z.int().min(0), "completedObjectiveCount": z.int().min(0), "hasExecutingObjective": z.boolean(), "hasCompletedObjective": z.boolean(), "hasPendingObjectiveWithInstructions": z.boolean(), "hasUnseenBlockingQuestion": z.boolean(), "hasUnseenReturnedToExecute": z.boolean(), "allowParallelObjectives": z.boolean(), "draftObjectiveResourceKey": z.string().nullable(), "tags": z.array(projectTagDtoSchema), "createdByKind": createdByKindSchema, "createdByAgent": z.string().nullable(), "createdByWorkspaceUserId": z.string().nullable(), "createdByToken": missionCreatorTokenDtoSchema.nullable(), "objectives": z.exactOptional(z.array(objectiveDtoSchema)) };
export const missionDtoSchema: z.ZodType<MissionDto> = z.object(missionDtoShape);

export interface ExecutionRequestDto {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string | null;
  objectiveId: string | null;
  executionTargetId: string | null;
  requestedAgent: string | null;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  launchConfig: AgentLaunchConfigDto;
  status: "queued" | "claimed" | "launching" | "launched" | "failed" | "cleared" | "cancelled" | "expired";
  requestedSource: string;
  localTargetMutationKind: ("branch_action" | "worktree_purge" | "capability_call") | null;
  lastError: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}
export const executionRequestDtoSchema: z.ZodType<ExecutionRequestDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "executionTargetId": z.string().nullable(), "requestedAgent": z.string().nullable(), "requestedModel": z.string().nullable(), "requestedReasoningEffort": z.string().nullable(), "launchConfig": agentLaunchConfigDtoSchema, "status": z.enum(["queued", "claimed", "launching", "launched", "failed", "cleared", "cancelled", "expired"]), "requestedSource": z.string(), "localTargetMutationKind": z.enum(["branch_action", "worktree_purge", "capability_call"]).nullable(), "lastError": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema });

export interface TerminalSessionDto {
  executionRequestId: string;
  objectiveId: string;
  provider: "latch";
  providerSessionId: string;
  sessionName: string;
  executionTargetId: string | null;
  deviceLabel: string | null;
  agentSessionId: string | null;
  executable: string;
  viewerKind: string;
  viewerOpenAs: "window" | "tab";
  createdAt: DateTime;
  lastObservedState: "running" | "exited" | "stopping" | "lost";
}
export const terminalSessionDtoSchema: z.ZodType<TerminalSessionDto> = z.object({ "executionRequestId": z.string(), "objectiveId": z.string(), "provider": z.literal("latch"), "providerSessionId": z.string(), "sessionName": z.string(), "executionTargetId": z.string().nullable(), "deviceLabel": z.string().nullable(), "agentSessionId": z.string().nullable(), "executable": z.string(), "viewerKind": z.string(), "viewerOpenAs": z.enum(["window", "tab"]), "createdAt": dateTimeSchema, "lastObservedState": z.enum(["running", "exited", "stopping", "lost"]) });

/**
 * `pending`: no branch prepared yet (the planner-predicted name is shown). `created`: cut from the base, not pushed. `published`: pushed to `origin`, not merged. `merged_unpushed`: merged into the local base, which has not been pushed yet. `merged`: the branch's commits are in the remote base (`origin/<base>`).
 */
export type MissionBranchStatus = "pending" | "created" | "published" | "merged_unpushed" | "merged";
export const missionBranchStatusSchema: z.ZodType<MissionBranchStatus> = z.enum(["pending", "created", "published", "merged_unpushed", "merged"]);

/**
 * Per-mission override of the workspace worktree-automation setting. `worktree`: prepare a branch and a worktree even when the workspace setting is off. `branch`: prepare a branch without a dedicated worktree (checked out in the project's primary repository). Null (no override) inherits the workspace setting.
 */
export type MissionWorktreePreference = "worktree" | "branch";
export const missionWorktreePreferenceSchema: z.ZodType<MissionWorktreePreference> = z.enum(["worktree", "branch"]);

export interface MissionBranchDto {
  name: string;
  baseBranch: string | null;
  worktreePath: string | null;
  status: MissionBranchStatus;
  dirty: boolean;
  /**
   * Never written by the REST read today (see schema-disagreements.md).
   */
  hasUnpushedCommits?: boolean;
  overrideBranch: string | null;
  worktreeAutomationEnabled: boolean;
  worktreePreference: MissionWorktreePreference | null;
  willPrepareBranch: boolean;
  willUseWorktree: boolean;
  /**
   * Present only once a local target observed the branch.
   */
  observedAt?: DateTime;
  /**
   * Present (`client`) only together with `observedAt`.
   */
  observationSource?: "client";
}
export const missionBranchDtoSchema: z.ZodType<MissionBranchDto> = z.object({ "name": z.string(), "baseBranch": z.string().nullable(), "worktreePath": z.string().nullable(), "status": missionBranchStatusSchema, "dirty": z.boolean(), "hasUnpushedCommits": z.exactOptional(z.boolean()), "overrideBranch": z.string().nullable(), "worktreeAutomationEnabled": z.boolean(), "worktreePreference": missionWorktreePreferenceSchema.nullable(), "willPrepareBranch": z.boolean(), "willUseWorktree": z.boolean(), "observedAt": z.exactOptional(dateTimeSchema), "observationSource": z.exactOptional(z.literal("client")) });

export interface MissionCreatedFromDto {
  sessionId: string;
  missionId: string;
  missionDisplayId: string;
  agentIdentifier: string;
}
export const missionCreatedFromDtoSchema: z.ZodType<MissionCreatedFromDto> = z.object({ "sessionId": z.string(), "missionId": z.string(), "missionDisplayId": z.string(), "agentIdentifier": z.string() });

/**
 * `MissionDto` (without `objectives` as an opt-in) plus the mission page projections.
 */
export type MissionDetailDto = MissionDto & {
  objectives: ObjectiveDto[];
  statuses: ProjectStatusDto[];
  /**
   * Active (queued, claimed, launching) requests, newest first.
   */
  executionRequests: ExecutionRequestDto[];
  terminalSessions: TerminalSessionDto[];
  /**
   * Always an object from this read; nullable in the TypeScript type.
   */
  branch: MissionBranchDto | null;
  createdFrom: MissionCreatedFromDto | null;
};
export const missionDetailDtoSchema: z.ZodType<MissionDetailDto> = z.object({ ...missionDtoShape, "objectives": z.array(objectiveDtoSchema), "statuses": z.array(projectStatusDtoSchema), "executionRequests": z.array(executionRequestDtoSchema), "terminalSessions": z.array(terminalSessionDtoSchema), "branch": missionBranchDtoSchema.nullable(), "createdFrom": missionCreatedFromDtoSchema.nullable() });

export interface ObjectiveAttachmentDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  missionId: string | null;
  objectiveId: string | null;
  /**
   * Set while the file belongs to an unpromoted Inbox item; null otherwise.
   */
  inboxItemId: string | null;
  bucketKey: "attachments";
  storageKey: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadStatus: "prepared" | "uploaded" | "available" | "failed" | "deleted";
  /**
   * Server-relative URL serving the bytes (`/api/storage/attachments/<storageKey>`).
   */
  url: string;
  createdAt: DateTime;
}
export const objectiveAttachmentDtoSchema: z.ZodType<ObjectiveAttachmentDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string().nullable(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "inboxItemId": z.string().nullable(), "bucketKey": z.literal("attachments"), "storageKey": z.string(), "filename": z.string(), "contentType": z.string().nullable(), "sizeBytes": z.int().min(1).nullable(), "uploadStatus": z.enum(["prepared", "uploaded", "available", "failed", "deleted"]), "url": z.string(), "createdAt": dateTimeSchema });

export type ObjectiveAttachmentList = ObjectiveAttachmentDto[];
export const objectiveAttachmentListSchema: z.ZodType<ObjectiveAttachmentList> = z.array(objectiveAttachmentDtoSchema);

/**
 * The file's raw bytes as the request body (no multipart). Any Content-Type is accepted and recorded as the attachment's media type. An empty body is refused (400).
 */
export type RawUploadBody = BinaryBody;
export const rawUploadBodySchema: z.ZodType<RawUploadBody> = binaryBodySchema;

export interface CreateProjectBody {
  /**
   * Trimmed; must not be blank.
   */
  name: string;
  /**
   * Target workspace. Required in practice: a session or token request has no implicit workspace, so omitting it answers 400 `workspaceId is required when creating a project`.
   */
  workspaceId?: string;
  /**
   * Slugified; derived from `name` when omitted or blank.
   */
  slug?: string;
  description?: string | null;
  /**
   * Six hex digits with or without `#`; stored lower-case with `#`. Other text answers 400.
   */
  color?: string;
  primaryResource?: {
    /**
     * A blank path skips resource creation.
     */
    directoryPath: string;
    /**
     * An existing target in the workspace (404 otherwise); null for a project-global source; omitted to declare the calling machine, which needs a machine-local identity or answers 409 `no_execution_target_registered`.
     */
    executionTargetId?: string | null;
  } | null;
}
export const createProjectBodySchema: z.ZodType<CreateProjectBody> = z.object({ "name": z.string(), "workspaceId": z.exactOptional(z.string()), "slug": z.exactOptional(z.string()), "description": z.exactOptional(z.string().nullable()), "color": z.exactOptional(z.string()), "primaryResource": z.exactOptional(z.object({ "directoryPath": z.string(), "executionTargetId": z.exactOptional(z.string().nullable()) }).nullable()) });

export interface InitializeProjectBody {
  workspaceId: string;
  /**
   * Generated once by the client and reused on retry (at most 200 characters after trimming). A repeat with the same key for the same profile returns the first initialization and only retries pending or failed GitHub provisioning.
   */
  idempotencyKey: string;
  /**
   * Project name and first mission title; must not be blank.
   */
  name: string;
  /**
   * Project description and first objective; must not be blank.
   */
  description: string;
  /**
   * Only `true` requests provisioning.
   */
  createGitHubRepository?: boolean;
  /**
   * Required exactly when `createGitHubRepository` is true (400 otherwise).
   */
  githubOwnerLogin?: string;
}
export const initializeProjectBodySchema: z.ZodType<InitializeProjectBody> = z.object({ "workspaceId": z.string(), "idempotencyKey": z.string().max(200), "name": z.string(), "description": z.string(), "createGitHubRepository": z.exactOptional(z.boolean()), "githubOwnerLogin": z.exactOptional(z.string()) });

export interface InitializeProjectResultDto {
  project: ProjectDto;
  mission: MissionDetailDto;
  repositoryProvisioning: {
    status: "not_requested" | "pending" | "failed" | "succeeded";
    /**
     * True while `status` is `pending` or `failed`; retry with the same idempotency key.
     */
    retryable: boolean;
    ownerLogin: string | null;
    repository: {
      id: string;
      fullName: string;
      defaultBranch: string;
      private: true;
      cloneUrl: string;
    } | null;
    /**
     * The read-only `git` resource recorded for the clone URL, once provisioning succeeded.
     */
    resource: ProjectResourceDto | null;
    /**
     * The provisioning failure message (generic unless the provider raised an ApiError).
     */
    error: string | null;
  };
}
export const initializeProjectResultDtoSchema: z.ZodType<InitializeProjectResultDto> = z.object({ "project": projectDtoSchema, "mission": missionDetailDtoSchema, "repositoryProvisioning": z.object({ "status": z.enum(["not_requested", "pending", "failed", "succeeded"]), "retryable": z.boolean(), "ownerLogin": z.string().nullable(), "repository": z.object({ "id": z.string(), "fullName": z.string(), "defaultBranch": z.string(), "private": z.literal(true), "cloneUrl": z.string() }).nullable(), "resource": projectResourceDtoSchema.nullable(), "error": z.string().nullable() }) });

export interface ReorderProjectsBody {
  /**
   * Every non-deleted project of one workspace (active and archived), top to bottom.
   */
  orderedProjectIds: string[];
}
export const reorderProjectsBodySchema: z.ZodType<ReorderProjectsBody> = z.object({ "orderedProjectIds": z.array(z.string()).min(1).refine(hasUniqueItems, { error: 'Expected unique items' }) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateProjectBody {
  /**
   * Trimmed; must not be blank.
   */
  name?: string;
  /**
   * Blank or null clears it.
   */
  description?: string | null;
  status?: ProjectLifecycle;
  /**
   * Six hex digits with or without `#`; an empty string or null clears it.
   */
  color?: string | null;
  /**
   * A valid git branch name; blank or null clears it (falls back to `main`).
   */
  defaultBranch?: string | null;
  /**
   * Replaces the stored list; blank lines are dropped.
   */
  preLaunchCommands?: string[];
  /**
   * Replaces the stored map; entries with a blank name are dropped.
   */
  launchEnvVars?: { [key: string]: string };
}
export const updateProjectBodySchema: z.ZodType<UpdateProjectBody> = z.object({ "name": z.exactOptional(z.string()), "description": z.exactOptional(z.string().nullable()), "status": z.exactOptional(projectLifecycleSchema), "color": z.exactOptional(z.string().nullable()), "defaultBranch": z.exactOptional(z.string().nullable()), "preLaunchCommands": z.exactOptional(z.array(z.string())), "launchEnvVars": z.exactOptional(z.record(z.string(), z.string())) });

export interface RepositoryEntryDto {
  path: string;
  name: string;
  type: "file" | "directory";
  parentPath: string | null;
  depth: number;
}
export const repositoryEntryDtoSchema: z.ZodType<RepositoryEntryDto> = z.object({ "path": z.string(), "name": z.string(), "type": z.enum(["file", "directory"]), "parentPath": z.string().nullable(), "depth": z.int().min(0) });

export interface ProjectRepositoryDto {
  projectId: string;
  /**
   * The `executionTargetId` query parameter echoed back, or null.
   */
  executionTargetId: string | null;
  resource: ProjectResourceDto | null;
  status: "ready" | "no_resource" | "not_git_repository" | "unsupported_resource" | "unreadable";
  rootPath: string | null;
  gitRoot: string | null;
  branch: string | null;
  commit: string | null;
  entries: RepositoryEntryDto[];
  truncated: boolean;
  scannedAt: DateTime;
  message: string | null;
}
export const projectRepositoryDtoSchema: z.ZodType<ProjectRepositoryDto> = z.object({ "projectId": z.string(), "executionTargetId": z.string().nullable(), "resource": projectResourceDtoSchema.nullable(), "status": z.enum(["ready", "no_resource", "not_git_repository", "unsupported_resource", "unreadable"]), "rootPath": z.string().nullable(), "gitRoot": z.string().nullable(), "branch": z.string().nullable(), "commit": z.string().nullable(), "entries": z.array(repositoryEntryDtoSchema), "truncated": z.boolean(), "scannedAt": dateTimeSchema, "message": z.string().nullable() });

export interface CreateProjectTagBody {
  /**
   * Trimmed; must not be blank and must be unique among the project's live tags.
   */
  label: string;
  /**
   * Free-form; blank or null stores null.
   */
  color?: string | null;
}
export const createProjectTagBodySchema: z.ZodType<CreateProjectTagBody> = z.object({ "label": z.string(), "color": z.exactOptional(z.string().nullable()) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateProjectTagBody {
  /**
   * Trimmed; must not be blank and must stay unique among the project's live tags.
   */
  label?: string;
  color?: string | null;
  /**
   * Inactive tags stay on missions but are hidden from the create picker.
   */
  active?: boolean;
}
export const updateProjectTagBodySchema: z.ZodType<UpdateProjectTagBody> = z.object({ "label": z.exactOptional(z.string()), "color": z.exactOptional(z.string().nullable()), "active": z.exactOptional(z.boolean()) });

export interface ReorderBoardColumnBody {
  /**
   * A live status of this project (409 otherwise).
   */
  statusId: string;
  /**
   * Mission UUIDs that should occupy the column, top to bottom. A mission from another column moves into it (its status changes). Each must be a live mission of this project (404 otherwise).
   */
  orderedMissionIds: string[];
}
export const reorderBoardColumnBodySchema: z.ZodType<ReorderBoardColumnBody> = z.object({ "statusId": z.string(), "orderedMissionIds": z.array(z.string()).refine(hasUniqueItems, { error: 'Expected unique items' }) });

export type RepositoryReadOperation = "observe" | "tree" | "branches" | "worktrees" | "git_status" | "diff" | "read_file" | "search_text";
export const repositoryReadOperationSchema: z.ZodType<RepositoryReadOperation> = z.enum(["observe", "tree", "branches", "worktrees", "git_status", "diff", "read_file", "search_text"]);

/**
 * One bounded, read-only repository read on a registered resource binding. Every variant carries the binding (`executionTargetId`, `projectId`, `resourceKey`) and an `operationId` matching `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`, reused on retry. Paths are repository-relative; absolute or escaping paths answer 400.
 */
export type RepositoryReadRequest = {
  operation: "observe" | "branches" | "worktrees" | "git_status";
  operationId: string;
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
} | {
  operation: "tree";
  operationId: string;
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
  relativePath?: string | null;
  maxEntries?: number | null;
} | {
  operation: "diff";
  operationId: string;
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
  scope: "unstaged" | "staged" | "all";
  relativePaths?: string[] | null;
} | {
  operation: "read_file";
  operationId: string;
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
  relativePath: string;
  startLine?: number | null;
  /**
   * Must not precede `startLine`.
   */
  endLine?: number | null;
} | {
  operation: "search_text";
  operationId: string;
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
  /**
   * One line; no NUL, CR or LF.
   */
  query: string;
  relativePath?: string | null;
  caseSensitive?: boolean;
};
export const repositoryReadRequestSchema: z.ZodType<RepositoryReadRequest> = z.union([z.object({ "operation": z.enum(["observe", "branches", "worktrees", "git_status"]), "operationId": z.string().min(8).max(128), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string() }), z.object({ "operation": z.literal("tree"), "operationId": z.string().min(8).max(128), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string(), "relativePath": z.exactOptional(z.string().nullable()), "maxEntries": z.exactOptional(z.int().min(1).nullable()) }), z.object({ "operation": z.literal("diff"), "operationId": z.string().min(8).max(128), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string(), "scope": z.enum(["unstaged", "staged", "all"]), "relativePaths": z.exactOptional(z.array(z.string()).max(50).nullable()) }), z.object({ "operation": z.literal("read_file"), "operationId": z.string().min(8).max(128), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string(), "relativePath": z.string(), "startLine": z.exactOptional(z.int().min(1).nullable()), "endLine": z.exactOptional(z.int().min(1).nullable()) }), z.object({ "operation": z.literal("search_text"), "operationId": z.string().min(8).max(128), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string(), "query": z.string().min(1).max(256), "relativePath": z.exactOptional(z.string().nullable()), "caseSensitive": z.exactOptional(z.boolean()) })]);

export interface RepositoryReadResult {
  operationId: string;
  operation: RepositoryReadOperation;
  binding: {
    executionTargetId: string;
    projectId: string;
    resourceKey: string;
  };
  outcome: "ok" | "unavailable" | "target_offline" | "timeout" | "denied" | "binary" | "oversized" | "not_found";
  head: string | null;
  branch: string | null;
  observedAt: DateTime;
  bytes: number;
  truncated: boolean;
  /**
   * Operation-specific bounded payload (packages/contract/src/chat.ts `RepositoryGitStatusData`, `RepositoryDiffData`, `RepositoryFileData`, `RepositorySearchData`, or the capability payload); non-`ok` outcomes carry `{ message }`.
   */
  data: JsonValue;
}
export const repositoryReadResultSchema: z.ZodType<RepositoryReadResult> = z.object({ "operationId": z.string(), "operation": repositoryReadOperationSchema, "binding": z.object({ "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string() }), "outcome": z.enum(["ok", "unavailable", "target_offline", "timeout", "denied", "binary", "oversized", "not_found"]), "head": z.string().nullable(), "branch": z.string().nullable(), "observedAt": dateTimeSchema, "bytes": z.int().min(0), "truncated": z.boolean(), "data": jsonValueSchema });

export interface CreateProjectStatusBody {
  /**
   * Trimmed; must not be blank and must be unique among the project's live statuses (409).
   */
  name: string;
  type: StatusType;
  /**
   * Only a `draft` or `next` status may be the default (400); setting it clears the previous default.
   */
  isDefault?: boolean;
}
export const createProjectStatusBodySchema: z.ZodType<CreateProjectStatusBody> = z.object({ "name": z.string(), "type": statusTypeSchema, "isDefault": z.exactOptional(z.boolean()) });

/**
 * Partial update; a status's type cannot change.
 */
export interface UpdateProjectStatusBody {
  /**
   * Trimmed; must not be blank and must stay unique (409).
   */
  name?: string;
  /**
   * `true` makes a `draft` or `next` status the default (400 for other types); `false` on the current default answers 409 (choose another default instead).
   */
  isDefault?: boolean;
}
export const updateProjectStatusBodySchema: z.ZodType<UpdateProjectStatusBody> = z.object({ "name": z.exactOptional(z.string()), "isDefault": z.exactOptional(z.boolean()) });

export interface ReorderProjectStatusesBody {
  /**
   * Every live status of the project, top to bottom; positions become 0, 1, 2, ….
   */
  orderedStatusIds: string[];
}
export const reorderProjectStatusesBodySchema: z.ZodType<ReorderProjectStatusesBody> = z.object({ "orderedStatusIds": z.array(z.string()).min(1) });

export type ProjectStatusList = ProjectStatusDto[];
export const projectStatusListSchema: z.ZodType<ProjectStatusList> = z.array(projectStatusDtoSchema);

export type ProjectList = ProjectDto[];
export const projectListSchema: z.ZodType<ProjectList> = z.array(projectDtoSchema);

export type ProjectTagList = ProjectTagDto[];
export const projectTagListSchema: z.ZodType<ProjectTagList> = z.array(projectTagDtoSchema);

export type MissionList = MissionDto[];
export const missionListSchema: z.ZodType<MissionList> = z.array(missionDtoSchema);

export type ProjectResourceList = ProjectResourceDto[];
export const projectResourceListSchema: z.ZodType<ProjectResourceList> = z.array(projectResourceDtoSchema);

/**
 * Exactly one source: `directoryPath` (or its alias `path`) for a `local_checkout` source, or `sourceUrl` for a `git` source; when both are given `sourceUrl` wins. A resource with the derived `resourceKey` that already exists gains or updates the source instead of a new resource being created.
 */
export interface CreateProjectResourceBody {
  /**
   * Checkout path on the execution target.
   */
  directoryPath?: string;
  /**
   * Alias of `directoryPath` read when `directoryPath` is absent.
   */
  path?: string;
  /**
   * An `http(s)://` or `git@host:path` Git URL (400 otherwise).
   */
  sourceUrl?: string;
  /**
   * Slugified; derived from `label`, then from the path's basename, when blank.
   */
  resourceKey?: string | null;
  label?: string | null;
  /**
   * Defaults to true (only an explicit `false` creates a non-primary resource); a new primary clears the previous one.
   */
  isPrimary?: boolean;
  /**
   * For a checkout: an existing target of the workspace (404 otherwise), null for a pathless global source, or omitted to declare the calling machine (409 `no_execution_target_registered` without a machine-local identity). For a `sourceUrl` it is stored as given without validation.
   */
  executionTargetId?: string | null;
  /**
   * A primary resource is always `read_write`; a non-primary one defaults to `read`.
   */
  accessMode?: ProjectResourceAccessMode;
}
export const createProjectResourceBodySchema: z.ZodType<CreateProjectResourceBody> = z.object({ "directoryPath": z.exactOptional(z.string()), "path": z.exactOptional(z.string()), "sourceUrl": z.exactOptional(z.string()), "resourceKey": z.exactOptional(z.string().nullable()), "label": z.exactOptional(z.string().nullable()), "isPrimary": z.exactOptional(z.boolean()), "executionTargetId": z.exactOptional(z.string().nullable()), "accessMode": z.exactOptional(projectResourceAccessModeSchema) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateProjectResourceBody {
  /**
   * Slugified; a blank or null value re-derives the key from the label or the current key.
   */
  resourceKey?: string | null;
  /**
   * Only `true` has an effect (it promotes the resource and forces `read_write`); `false` is ignored.
   */
  isPrimary?: boolean;
  /**
   * Ignored for a primary resource.
   */
  accessMode?: ProjectResourceAccessMode;
}
export const updateProjectResourceBodySchema: z.ZodType<UpdateProjectResourceBody> = z.object({ "resourceKey": z.exactOptional(z.string().nullable()), "isPrimary": z.exactOptional(z.boolean()), "accessMode": z.exactOptional(projectResourceAccessModeSchema) });

export interface UpdateProjectResourceSourceBody {
  /**
   * Replaces the per-agent defaults keyed by agent key. Entries with a blank key, a non-object value, or neither a pre-command nor flags are dropped; `{}` clears them.
   */
  launchDefaults: { [key: string]: AgentLaunchConfigInput };
}
export const updateProjectResourceSourceBodySchema: z.ZodType<UpdateProjectResourceSourceBody> = z.object({ "launchDefaults": z.record(z.string(), agentLaunchConfigInputSchema) });

export type MissionSearchDateField = "createdAt" | "updatedAt" | "dueDatetime";
export const missionSearchDateFieldSchema: z.ZodType<MissionSearchDateField> = z.enum(["createdAt", "updatedAt", "dueDatetime"]);

export type MissionSearchMatchKind = "title" | "displayId" | "objective" | "event" | "delivery" | "constraints" | "notes";
export const missionSearchMatchKindSchema: z.ZodType<MissionSearchMatchKind> = z.enum(["title", "displayId", "objective", "event", "delivery", "constraints", "notes"]);

export interface MissionSearchAppliedFilters {
  query: string | null;
  mode: "display_id" | "any" | "all" | "phrase" | "fallback";
  projectIds: string[];
  resourceKeys: string[];
  statusTypes: string[];
  dateField: MissionSearchDateField | null;
  from: string | null;
  to: string | null;
  coverageFloor: number | null;
}
const missionSearchAppliedFiltersShape = { "query": z.string().nullable(), "mode": z.enum(["display_id", "any", "all", "phrase", "fallback"]), "projectIds": z.array(z.string()), "resourceKeys": z.array(z.string()), "statusTypes": z.array(z.string()), "dateField": missionSearchDateFieldSchema.nullable(), "from": z.string().nullable(), "to": z.string().nullable(), "coverageFloor": z.int().min(1).nullable() };
export const missionSearchAppliedFiltersSchema: z.ZodType<MissionSearchAppliedFilters> = z.object(missionSearchAppliedFiltersShape);

export interface MissionSearchWorkspaceCount {
  workspaceId: string;
  matched: number;
  returned: number;
}
export const missionSearchWorkspaceCountSchema: z.ZodType<MissionSearchWorkspaceCount> = z.object({ "workspaceId": z.string(), "matched": z.int().min(0), "returned": z.int().min(0) });

export interface MissionSearchResultV2 {
  id: string;
  displayId: string;
  title: string;
  statusType: string;
  statusId: string;
  priority: string | null;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  createdAt: DateTime;
  updatedAt: DateTime;
  dueDatetime: DateTime | null;
  objectiveCount: number;
  /**
   * Deterministic fused score (text rank fused with recency, exact display id and title first); not a raw engine score.
   */
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  matchedIn: MissionSearchMatchKind[];
}
const missionSearchResultV2Shape = { "id": z.string(), "displayId": z.string(), "title": z.string(), "statusType": z.string(), "statusId": z.string(), "priority": z.string().nullable(), "projectId": z.string(), "projectName": z.string(), "workspaceId": z.string(), "workspaceName": z.string(), "workspaceSlug": z.string(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "dueDatetime": dateTimeSchema.nullable(), "objectiveCount": z.int().min(0), "relevance": z.number(), "snippet": z.string().nullable(), "matchedTerms": z.array(z.string()), "matchedIn": z.array(missionSearchMatchKindSchema) };
export const missionSearchResultV2Schema: z.ZodType<MissionSearchResultV2> = z.object(missionSearchResultV2Shape);

export interface SearchMissionsResponseV2 {
  version: 2;
  results: MissionSearchResultV2[];
  appliedFilters: MissionSearchAppliedFilters;
  totalMatchedBeforeLimit: number;
  workspaceCounts: MissionSearchWorkspaceCount[];
}
export const searchMissionsResponseV2Schema: z.ZodType<SearchMissionsResponseV2> = z.object({ "version": z.literal(2), "results": z.array(missionSearchResultV2Schema), "appliedFilters": missionSearchAppliedFiltersSchema, "totalMatchedBeforeLimit": z.int().min(0), "workspaceCounts": z.array(missionSearchWorkspaceCountSchema) });

export interface MissionSearchV1Response {
  missions: MissionDto[];
}
export const missionSearchV1ResponseSchema: z.ZodType<MissionSearchV1Response> = z.object({ "missions": z.array(missionDtoSchema) });

export interface SearchMatch {
  entityType: "objective" | "delivery";
  id: string;
  /**
   * The objective display id; null for a delivery.
   */
  displayId: string | null;
  /**
   * Objective title, or the delivery's first line.
   */
  title: string;
  objectiveId: string | null;
  objectiveState: ObjectiveState | null;
  relevance: number;
  snippet: string | null;
  matchedTerms: string[];
  createdAt: DateTime;
  updatedAt: DateTime;
}
export const searchMatchSchema: z.ZodType<SearchMatch> = z.object({ "entityType": z.enum(["objective", "delivery"]), "id": z.string(), "displayId": z.string().nullable(), "title": z.string(), "objectiveId": z.string().nullable(), "objectiveState": objectiveStateSchema.nullable(), "relevance": z.number(), "snippet": z.string().nullable(), "matchedTerms": z.array(z.string()), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema });

export type SearchResultV3 = MissionSearchResultV2 & {
  /**
   * True when nothing on the mission record itself matched; it only anchors child matches.
   */
  anchorOnly: boolean;
  matches: SearchMatch[];
  /**
   * Matching documents for this mission before `matchesPerResult` capping.
   */
  matchCounts: {
    objective: number;
    delivery: number;
    event: number;
  };
};
export const searchResultV3Schema: z.ZodType<SearchResultV3> = z.object({ ...missionSearchResultV2Shape, "anchorOnly": z.boolean(), "matches": z.array(searchMatchSchema).max(10), "matchCounts": z.object({ "objective": z.int().min(0), "delivery": z.int().min(0), "event": z.int().min(0) }) });

export type SearchAppliedFiltersV3 = MissionSearchAppliedFilters & {
  entityTypes: Array<"mission" | "objective" | "delivery">;
  objectiveStates: ObjectiveState[];
  matchesPerResult: number;
};
export const searchAppliedFiltersV3Schema: z.ZodType<SearchAppliedFiltersV3> = z.object({ ...missionSearchAppliedFiltersShape, "entityTypes": z.array(z.enum(["mission", "objective", "delivery"])), "objectiveStates": z.array(objectiveStateSchema), "matchesPerResult": z.int().min(1).max(10) });

export interface SearchResponseV3 {
  version: 3;
  results: SearchResultV3[];
  appliedFilters: SearchAppliedFiltersV3;
  totalMatchedBeforeLimit: number;
  entityCounts: {
    mission: number;
    objective: number;
    delivery: number;
    event: number;
  };
  workspaceCounts: MissionSearchWorkspaceCount[];
  /**
   * True when a workspace hit the 500-document candidate cap; counts are then lower bounds.
   */
  truncatedCandidates: boolean;
}
export const searchResponseV3Schema: z.ZodType<SearchResponseV3> = z.object({ "version": z.literal(3), "results": z.array(searchResultV3Schema), "appliedFilters": searchAppliedFiltersV3Schema, "totalMatchedBeforeLimit": z.int().min(0), "entityCounts": z.object({ "mission": z.int().min(0), "objective": z.int().min(0), "delivery": z.int().min(0), "event": z.int().min(0) }), "workspaceCounts": z.array(missionSearchWorkspaceCountSchema), "truncatedCandidates": z.boolean() });

/**
 * At least one of `title`, `firstObjective` and `objectives` must carry text (400 otherwise). `objectives` wins over `firstObjective`; the first objective is created `draft`, the rest `future`.
 */
export interface CreateMissionBody {
  /**
   * Target project UUID; requires `mission:create` there.
   */
  projectId: string;
  /**
   * Trimmed. When blank or omitted the mission is titled from the first instruction and a better title is generated asynchronously.
   */
  title?: string;
  /**
   * Defaults to `normal`.
   */
  priority?: MissionPriority;
  /**
   * Checked only with `Date.parse` (400 when unparsable). SQLite stores only the canonical `YYYY-MM-DDTHH:mm:ss.sssZ` form (other text answers 409 `Database constraint violation.`); Postgres normalizes it. Null or omitted leaves it unset.
   */
  dueDatetime?: string | null;
  /**
   * A live status of the project (409 otherwise); omitted uses the project's default status.
   */
  statusId?: string;
  /**
   * An active member of the project's workspace (400 otherwise), or null for unassigned. Omitted assigns the creator, except for a project_automation token, which leaves the mission unassigned.
   */
  assignedWorkspaceUserId?: string | null;
  firstObjective?: string;
  objectives?: Array<{
    /**
     * Instruction text; must not be blank.
     */
    objective: string;
    title?: string | null;
    /**
     * Deprecated queue hint; defaults to false.
     */
    autoAdvance?: boolean;
    /**
     * Explicit launch agent; omitted keeps project launch-preference defaulting.
     */
    agent?: string | null;
    /**
     * Requires a non-empty `agent` (400 `validation_error` otherwise).
     */
    model?: string | null;
    resourceKey?: string | null;
  }>;
  /**
   * Live tags of the project (400 otherwise).
   */
  tagIds?: string[];
}
export const createMissionBodySchema: z.ZodType<CreateMissionBody> = z.object({ "projectId": z.string(), "title": z.exactOptional(z.string()), "priority": z.exactOptional(missionPrioritySchema), "dueDatetime": z.exactOptional(z.string().nullable()), "statusId": z.exactOptional(z.string()), "assignedWorkspaceUserId": z.exactOptional(z.string().nullable()), "firstObjective": z.exactOptional(z.string()), "objectives": z.exactOptional(z.array(z.object({ "objective": z.string(), "title": z.exactOptional(z.string().nullable()), "autoAdvance": z.exactOptional(z.boolean()), "agent": z.exactOptional(z.string().nullable()), "model": z.exactOptional(z.string().nullable()), "resourceKey": z.exactOptional(z.string().nullable()) }))), "tagIds": z.exactOptional(z.array(z.string())) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateMissionBody {
  /**
   * Trimmed; must not be blank.
   */
  title?: string;
  priority?: MissionPriority | null;
  /**
   * Move to another live project of the same workspace (404 otherwise). The status maps to `statusId` if given, else the target's status with the same key, then the same name, then the target's default (409 when none).
   */
  projectId?: string;
  /**
   * A live status of the (target) project (409 otherwise). A real change moves the mission to the top of the column.
   */
  statusId?: string;
  /**
   * An active member of the mission's workspace (400 otherwise); null or blank unassigns.
   */
  assignedWorkspaceUserId?: string | null;
  /**
   * Blank or null clears them.
   */
  notes?: string | null;
  /**
   * Pin the next launch's branch; blank or null clears the pin.
   */
  branchOverride?: string | null;
  worktreePreference?: MissionWorktreePreference | null;
  allowParallelObjectives?: boolean;
  /**
   * Only `true` acts; it clears the prepared branch and its observations (400 when none is prepared).
   */
  resetActiveBranch?: boolean;
  /**
   * Replaces the mission's tags; each must be a live tag of its project (400 otherwise). `[]` clears them.
   */
  tagIds?: string[];
  /**
   * Checked only with `Date.parse` (400 when unparsable); SQLite accepts only the canonical `YYYY-MM-DDTHH:mm:ss.sssZ` form (409 otherwise). Null clears it. The linked schedule is unchanged.
   */
  dueDatetime?: string | null;
}
export const updateMissionBodySchema: z.ZodType<UpdateMissionBody> = z.object({ "title": z.exactOptional(z.string()), "priority": z.exactOptional(missionPrioritySchema.nullable()), "projectId": z.exactOptional(z.string()), "statusId": z.exactOptional(z.string()), "assignedWorkspaceUserId": z.exactOptional(z.string().nullable()), "notes": z.exactOptional(z.string().nullable()), "branchOverride": z.exactOptional(z.string().nullable()), "worktreePreference": z.exactOptional(missionWorktreePreferenceSchema.nullable()), "allowParallelObjectives": z.exactOptional(z.boolean()), "resetActiveBranch": z.exactOptional(z.boolean()), "tagIds": z.exactOptional(z.array(z.string())), "dueDatetime": z.exactOptional(z.string().nullable()) });

export type ObjectiveList = ObjectiveDto[];
export const objectiveListSchema: z.ZodType<ObjectiveList> = z.array(objectiveDtoSchema);

export interface ReorderFutureObjectivesBody {
  /**
   * Objective UUIDs, each a `future` objective of the mission (400 otherwise), top to bottom.
   */
  orderedObjectiveIds: string[];
}
export const reorderFutureObjectivesBodySchema: z.ZodType<ReorderFutureObjectivesBody> = z.object({ "orderedObjectiveIds": z.array(z.string()).refine(hasUniqueItems, { error: 'Expected unique items' }) });

export interface MissionEventActorDto {
  workspaceUserId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
}
export const missionEventActorDtoSchema: z.ZodType<MissionEventActorDto> = z.object({ "workspaceUserId": z.string(), "displayName": z.string(), "handle": z.string().nullable(), "avatarUrl": z.string().nullable() });

export interface MissionEventDto {
  id: string;
  missionId: string;
  objectiveId: string | null;
  /**
   * `mission_events.type`: update, user_follow_up, alert, discussion_summary, decision, ask, answer, permission_request, delivery, execution_requested, awaiting_approval, status_change. Clients render unknown values neutrally.
   */
  type: string;
  phase: string | null;
  summary: string;
  source: string;
  actorWorkspaceUserId: string | null;
  actor: MissionEventActorDto | null;
  externalUrl: string | null;
  /**
   * Present only on `delivery` events; null when the payload names no delivery.
   */
  deliveryId?: string | null;
  createdAt: DateTime;
}
export const missionEventDtoSchema: z.ZodType<MissionEventDto> = z.object({ "id": z.string(), "missionId": z.string(), "objectiveId": z.string().nullable(), "type": z.string(), "phase": z.string().nullable(), "summary": z.string(), "source": z.string(), "actorWorkspaceUserId": z.string().nullable(), "actor": missionEventActorDtoSchema.nullable(), "externalUrl": z.string().nullable(), "deliveryId": z.exactOptional(z.string().nullable()), "createdAt": dateTimeSchema });

export type MissionEventList = MissionEventDto[];
export const missionEventListSchema: z.ZodType<MissionEventList> = z.array(missionEventDtoSchema);

export type HumanActionCategory = "environment" | "database" | "deployment" | "codegen" | "packaging" | "external_service" | "other";
export const humanActionCategorySchema: z.ZodType<HumanActionCategory> = z.enum(["environment", "database", "deployment", "codegen", "packaging", "external_service", "other"]);

export interface HumanActionV1 {
  id: string;
  action: string;
  reason?: string;
  category: HumanActionCategory;
  blocking?: boolean;
  command?: string;
  verify?: string;
  link?: string;
  source: "agent" | "deterministic_rule";
  sourceRef?: string;
}
export const humanActionV1Schema: z.ZodType<HumanActionV1> = z.strictObject({ "id": z.string(), "action": z.string(), "reason": z.exactOptional(z.string()), "category": humanActionCategorySchema, "blocking": z.exactOptional(z.boolean()), "command": z.exactOptional(z.string()), "verify": z.exactOptional(z.string()), "link": z.exactOptional(z.string()), "source": z.enum(["agent", "deterministic_rule"]), "sourceRef": z.exactOptional(z.string()) });

export interface TradeoffMadeV1 {
  id: string;
  decision: string;
  alternativesConsidered: string[];
  rationale: string;
  impact?: string;
  source: "agent";
  sourceRef?: string;
}
export const tradeoffMadeV1Schema: z.ZodType<TradeoffMadeV1> = z.strictObject({ "id": z.string(), "decision": z.string(), "alternativesConsidered": z.array(z.string()).max(6), "rationale": z.string(), "impact": z.exactOptional(z.string()), "source": z.literal("agent"), "sourceRef": z.exactOptional(z.string()) });

export interface DeferredWorkV1 {
  /**
   * `deferred-work-<index>-<digest>`, stable per delivery.
   */
  id: string;
  title: string;
  change: string;
  location: string;
  doneWhen: string;
}
export const deferredWorkV1Schema: z.ZodType<DeferredWorkV1> = z.strictObject({ "id": z.string(), "title": z.string().max(80), "change": z.string().max(400), "location": z.string().max(200), "doneWhen": z.string().max(200) });

export interface DeliveryAgentReportV1 {
  humanActions: HumanActionV1[];
  tradeoffsMade: TradeoffMadeV1[];
  knownRisks: string[];
  deferredWork: DeferredWorkV1[];
  assumptions: string[];
}
export const deliveryAgentReportV1Schema: z.ZodType<DeliveryAgentReportV1> = z.strictObject({ "humanActions": z.array(humanActionV1Schema).max(12), "tradeoffsMade": z.array(tradeoffMadeV1Schema).max(12), "knownRisks": z.array(z.string()).max(12), "deferredWork": z.array(deferredWorkV1Schema).max(12), "assumptions": z.array(z.string()).max(12) });

export interface DeliveryPresentationV1 {
  status: "deterministic" | "pending" | "composed" | "fallback";
  markdown: string;
  humanActions: HumanActionV1[];
  tradeoffsMade: TradeoffMadeV1[];
  knownRisks: string[];
  deferredWork: DeferredWorkV1[];
  assumptions: string[];
  generatedBy: "deterministic" | "gemini";
  generatedAt?: string;
  model?: string;
}
export const deliveryPresentationV1Schema: z.ZodType<DeliveryPresentationV1> = z.strictObject({ "status": z.enum(["deterministic", "pending", "composed", "fallback"]), "markdown": z.string(), "humanActions": z.array(humanActionV1Schema).max(12), "tradeoffsMade": z.array(tradeoffMadeV1Schema).max(12), "knownRisks": z.array(z.string()).max(12), "deferredWork": z.array(deferredWorkV1Schema).max(12), "assumptions": z.array(z.string()).max(12), "generatedBy": z.enum(["deterministic", "gemini"]), "generatedAt": z.exactOptional(z.string()), "model": z.exactOptional(z.string()) });

/**
 * The normalized versioned report. A missing or malformed stored report is synthesized deterministically at read time; the raw payload is never exposed.
 */
export interface DeliveryReportPayloadV1 {
  schemaVersion: 1;
  agentReport: DeliveryAgentReportV1;
  warnings?: string[];
  presentation: DeliveryPresentationV1;
}
export const deliveryReportPayloadV1Schema: z.ZodType<DeliveryReportPayloadV1> = z.strictObject({ "schemaVersion": z.literal(1), "agentReport": deliveryAgentReportV1Schema, "warnings": z.exactOptional(z.array(z.string()).max(12)), "presentation": deliveryPresentationV1Schema });

export interface HumanActionResolutionDto {
  status: "done" | "dismissed";
  resolvedAt: DateTime;
  resolvedByWorkspaceUserId: string | null;
  outcome: ("mission_created" | "objective_added") | null;
  outcomeRef: string | null;
}
export const humanActionResolutionDtoSchema: z.ZodType<HumanActionResolutionDto> = z.object({ "status": z.enum(["done", "dismissed"]), "resolvedAt": dateTimeSchema, "resolvedByWorkspaceUserId": z.string().nullable(), "outcome": z.enum(["mission_created", "objective_added"]).nullable(), "outcomeRef": z.string().nullable() });

export interface DeliveryDeferredWorkItemDto {
  /**
   * The item's `DeferredWorkV1.id`, the `actionId` of the resolution routes.
   */
  actionId: string;
  title: string;
  change: string;
  location: string;
  doneWhen: string;
  resolution: HumanActionResolutionDto | null;
}
export const deliveryDeferredWorkItemDtoSchema: z.ZodType<DeliveryDeferredWorkItemDto> = z.object({ "actionId": z.string(), "title": z.string(), "change": z.string(), "location": z.string(), "doneWhen": z.string(), "resolution": humanActionResolutionDtoSchema.nullable() });

export interface DeliveryDto {
  id: string;
  missionId: string;
  objectiveId: string;
  sessionId: string | null;
  summary: string;
  verificationSummary: string | null;
  followUpNotes: string | null;
  report: DeliveryReportPayloadV1;
  deliveredAt: DateTime;
  agentIdentifier: string | null;
  modelIdentifier: string | null;
  /**
   * One entry per `report.presentation.deferredWork` item, in order.
   */
  deferredWorkItems: DeliveryDeferredWorkItemDto[];
}
export const deliveryDtoSchema: z.ZodType<DeliveryDto> = z.object({ "id": z.string(), "missionId": z.string(), "objectiveId": z.string(), "sessionId": z.string().nullable(), "summary": z.string(), "verificationSummary": z.string().nullable(), "followUpNotes": z.string().nullable(), "report": deliveryReportPayloadV1Schema, "deliveredAt": dateTimeSchema, "agentIdentifier": z.string().nullable(), "modelIdentifier": z.string().nullable(), "deferredWorkItems": z.array(deliveryDeferredWorkItemDtoSchema) });

export interface MissionDeliveriesDto {
  /**
   * Newest first.
   */
  items: DeliveryDto[];
  /**
   * Matching deliveries before the cap.
   */
  total: number;
  /**
   * The applied cap (200).
   */
  limit: number;
}
export const missionDeliveriesDtoSchema: z.ZodType<MissionDeliveriesDto> = z.object({ "items": z.array(deliveryDtoSchema).max(200), "total": z.int().min(0), "limit": z.int() });

export type MissionSummaryStatus = "pending" | "composed" | "fallback";
export const missionSummaryStatusSchema: z.ZodType<MissionSummaryStatus> = z.enum(["pending", "composed", "fallback"]);

export interface MissionSummaryRiskDto {
  deliveryId: string;
  objectiveId: string;
  deliveredAt: DateTime;
  text: string;
}
export const missionSummaryRiskDtoSchema: z.ZodType<MissionSummaryRiskDto> = z.object({ "deliveryId": z.string(), "objectiveId": z.string(), "deliveredAt": dateTimeSchema, "text": z.string() });

/**
 * A deferred-work suggestion projected at read time; dismissed items are omitted, promoted ones reduced to identity, title and resolution.
 */
export type MissionSummarySuggestionDto = {
  deliveryId: string;
  objectiveId: string;
  deliveredAt: DateTime;
  actionId: string;
  title: string;
  state: "open";
  change: string;
  location: string;
  doneWhen: string;
  resolution: null;
} | {
  deliveryId: string;
  objectiveId: string;
  deliveredAt: DateTime;
  actionId: string;
  title: string;
  state: "resolved";
  resolution: HumanActionResolutionDto;
};
export const missionSummarySuggestionDtoSchema: z.ZodType<MissionSummarySuggestionDto> = z.union([z.object({ "deliveryId": z.string(), "objectiveId": z.string(), "deliveredAt": dateTimeSchema, "actionId": z.string(), "title": z.string(), "state": z.literal("open"), "change": z.string(), "location": z.string(), "doneWhen": z.string(), "resolution": z.null() }), z.object({ "deliveryId": z.string(), "objectiveId": z.string(), "deliveredAt": dateTimeSchema, "actionId": z.string(), "title": z.string(), "state": z.literal("resolved"), "resolution": humanActionResolutionDtoSchema })]);

export interface MissionSummaryDto {
  missionId: string;
  revision: number;
  status: MissionSummaryStatus;
  /**
   * One sentence; empty in the first pending shell.
   */
  headline: string;
  /**
   * Markdown, two to five sentences; empty in the first pending shell.
   */
  summary: string;
  risks: MissionSummaryRiskDto[];
  suggestions: MissionSummarySuggestionDto[];
  sourceDeliveryId: string | null;
  generatedBy: "deterministic" | "gemini";
  generatedAt: DateTime | null;
  model: string | null;
}
export const missionSummaryDtoSchema: z.ZodType<MissionSummaryDto> = z.object({ "missionId": z.string(), "revision": z.int().min(1), "status": missionSummaryStatusSchema, "headline": z.string(), "summary": z.string(), "risks": z.array(missionSummaryRiskDtoSchema), "suggestions": z.array(missionSummarySuggestionDtoSchema), "sourceDeliveryId": z.string().nullable(), "generatedBy": z.enum(["deterministic", "gemini"]), "generatedAt": dateTimeSchema.nullable(), "model": z.string().nullable() });

export interface MissionSummaryActionDto {
  deliveryId: string;
  /**
   * May name a deleted objective.
   */
  objectiveId: string;
  actionId: string;
  deliveredAt: DateTime;
  action: string;
  reason?: string;
  category: HumanActionCategory;
  blocking?: boolean;
  command?: string;
  verify?: string;
  link?: string;
  source: "agent" | "deterministic_rule";
  sourceRef?: string;
}
export const missionSummaryActionDtoSchema: z.ZodType<MissionSummaryActionDto> = z.object({ "deliveryId": z.string(), "objectiveId": z.string(), "actionId": z.string(), "deliveredAt": dateTimeSchema, "action": z.string(), "reason": z.exactOptional(z.string()), "category": humanActionCategorySchema, "blocking": z.exactOptional(z.boolean()), "command": z.exactOptional(z.string()), "verify": z.exactOptional(z.string()), "link": z.exactOptional(z.string()), "source": z.enum(["agent", "deterministic_rule"]), "sourceRef": z.exactOptional(z.string()) });

export interface MissionSummarySourceDto {
  objectiveId: string;
  deliveryId: string;
  deliveredAt: DateTime;
}
export const missionSummarySourceDtoSchema: z.ZodType<MissionSummarySourceDto> = z.object({ "objectiveId": z.string(), "deliveryId": z.string(), "deliveredAt": dateTimeSchema });

export interface MissionSummaryEvidenceDto {
  /**
   * Blocking first, then newest delivery first, then report order.
   */
  actions: MissionSummaryActionDto[];
  /**
   * Newest first, one per objective, deleted objectives included.
   */
  sources: MissionSummarySourceDto[];
  totals: {
    actions: number;
    sources: number;
    currentRunDeliveries: number;
  };
  truncated: {
    actions: boolean;
    sources: boolean;
  };
}
export const missionSummaryEvidenceDtoSchema: z.ZodType<MissionSummaryEvidenceDto> = z.object({ "actions": z.array(missionSummaryActionDtoSchema).max(100), "sources": z.array(missionSummarySourceDtoSchema).max(100), "totals": z.object({ "actions": z.int().min(0), "sources": z.int().min(0), "currentRunDeliveries": z.int().min(0) }), "truncated": z.object({ "actions": z.boolean(), "sources": z.boolean() }) });

export type MissionSummaryResponse = {
  eligible: false;
  summary: null;
  evidence: null;
  watermark: null;
  seenAt: null;
} | {
  eligible: true;
  summary: MissionSummaryDto | null;
  evidence: MissionSummaryEvidenceDto;
  /**
   * Newest `deliveredAt` of the current-run deliveries drawn on, or `createdAt` of an open question or choice request.
   */
  watermark: DateTime | null;
  seenAt: DateTime | null;
};
export const missionSummaryResponseSchema: z.ZodType<MissionSummaryResponse> = z.union([z.object({ "eligible": z.literal(false), "summary": z.null(), "evidence": z.null(), "watermark": z.null(), "seenAt": z.null() }), z.object({ "eligible": z.literal(true), "summary": missionSummaryDtoSchema.nullable(), "evidence": missionSummaryEvidenceDtoSchema, "watermark": dateTimeSchema.nullable(), "seenAt": dateTimeSchema.nullable() })]);

export interface MarkMissionSummarySeenBody {
  /**
   * A `watermark` from a summary read; any `Date.parse`-able text, stored normalized to UTC.
   */
  watermark: string;
}
export const markMissionSummarySeenBodySchema: z.ZodType<MarkMissionSummarySeenBody> = z.object({ "watermark": z.string() });

export interface MissionSummarySeenResponse {
  seenAt: DateTime;
}
export const missionSummarySeenResponseSchema: z.ZodType<MissionSummarySeenResponse> = z.object({ "seenAt": dateTimeSchema });

export interface ArtifactDto {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string | null;
  sessionId: string | null;
  deliveryId: string | null;
  /**
   * test_results, next_steps, note, url, decision, migration, or a namespaced (dotted) extension value.
   */
  type: string;
  label: string;
  contentText: string | null;
  /**
   * Structured content, null when none.
   */
  contentJson: JsonValue;
  externalUrl: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const artifactDtoSchema: z.ZodType<ArtifactDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "missionId": z.string(), "objectiveId": z.string().nullable(), "sessionId": z.string().nullable(), "deliveryId": z.string().nullable(), "type": z.string(), "label": z.string(), "contentText": z.string().nullable(), "contentJson": jsonValueSchema, "externalUrl": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export type ArtifactList = ArtifactDto[];
export const artifactListSchema: z.ZodType<ArtifactList> = z.array(artifactDtoSchema);

/**
 * At least one of `contentText` and `externalUrl` must be non-blank (400).
 */
export interface CreateArtifactBody {
  /**
   * Trimmed; one of the six core types or a dotted namespaced value (400 otherwise; a namespaced value the deployment's CHECK constraint lacks answers 409).
   */
  type: string;
  /**
   * Trimmed; must not be blank.
   */
  label: string;
  /**
   * Stored verbatim; blank stores null.
   */
  contentText?: string | null;
  /**
   * An http(s) URL (400 otherwise); blank stores null.
   */
  externalUrl?: string | null;
  /**
   * Objective UUID or display id on this mission (404 otherwise). Ignored when `sessionKey` is given.
   */
  objectiveId?: string | null;
  /**
   * Agent session UUID on this mission (404 otherwise); supplies `objectiveId` when that is absent.
   */
  sessionId?: string | null;
  /**
   * A live session key of this mission; stamps `sessionId` and `objectiveId`. An unknown or ended key answers 401, another mission's key 400.
   */
  sessionKey?: string | null;
}
export const createArtifactBodySchema: z.ZodType<CreateArtifactBody> = z.object({ "type": z.string(), "label": z.string(), "contentText": z.exactOptional(z.string().nullable()), "externalUrl": z.exactOptional(z.string().nullable()), "objectiveId": z.exactOptional(z.string().nullable()), "sessionId": z.exactOptional(z.string().nullable()), "sessionKey": z.exactOptional(z.string().nullable()) });

/**
 * At least one of `label`, `contentText` and `externalUrl` (400 otherwise). The artifact must keep text, structured content or a URL (400).
 */
export interface UpdateArtifactBody {
  /**
   * The artifact's current revision; a different value answers 409.
   */
  expectedRevision: number;
  /**
   * Trimmed; must not be blank.
   */
  label?: string;
  /**
   * Blank or null clears it.
   */
  contentText?: string | null;
  /**
   * An http(s) URL (400 otherwise); blank or null clears it.
   */
  externalUrl?: string | null;
}
export const updateArtifactBodySchema: z.ZodType<UpdateArtifactBody> = z.object({ "expectedRevision": z.int().min(1), "label": z.exactOptional(z.string()), "contentText": z.exactOptional(z.string().nullable()), "externalUrl": z.exactOptional(z.string().nullable()) });

export interface SharedContextEntryDto {
  id: string;
  missionId: string;
  key: string;
  /**
   * The parsed JSON object or array when `valueKind` is `json`, else the stored string.
   */
  value: JsonValue;
  valueKind: "string" | "json";
  /**
   * Always empty from REST.
   */
  tags: string[];
  updatedAt: DateTime;
  revision: number;
}
export const sharedContextEntryDtoSchema: z.ZodType<SharedContextEntryDto> = z.object({ "id": z.string(), "missionId": z.string(), "key": z.string(), "value": jsonValueSchema, "valueKind": z.enum(["string", "json"]), "tags": z.array(z.string()), "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export type SharedContextEntryList = SharedContextEntryDto[];
export const sharedContextEntryListSchema: z.ZodType<SharedContextEntryList> = z.array(sharedContextEntryDtoSchema);

export interface UpsertSharedContextBody {
  /**
   * Trimmed; must not be blank.
   */
  key: string;
  /**
   * Any JSON value. An object or array is stored as JSON; any other value, `null` included, is stored as its string form (`5` reads back as `"5"`, `null` as `"null"`).
   */
  value: JsonValue;
}
export const upsertSharedContextBodySchema: z.ZodType<UpsertSharedContextBody> = z.object({ "key": z.string(), "value": jsonValueSchema });

export interface FileChangeDto {
  id: string;
  missionId: string;
  objectiveId: string;
  resourceKey: string | null;
  /**
   * Repository-relative path.
   */
  filePath: string;
  /**
   * `declared_edit` (a native observation), `agent_declared` (declaration only), or null (unknown provenance).
   */
  source: ("declared_edit" | "agent_declared") | null;
  observedAt: DateTime;
  hookHealth: string | null;
}
export const fileChangeDtoSchema: z.ZodType<FileChangeDto> = z.object({ "id": z.string(), "missionId": z.string(), "objectiveId": z.string(), "resourceKey": z.string().nullable(), "filePath": z.string(), "source": z.enum(["declared_edit", "agent_declared"]).nullable(), "observedAt": dateTimeSchema, "hookHealth": z.string().nullable() });

export interface MissionFileChangesDto {
  /**
   * Newest observation first. A truncated page must not be partitioned by objective.
   */
  items: FileChangeDto[];
  /**
   * Matching rows before the cap.
   */
  total: number;
  /**
   * The applied cap (200).
   */
  limit: number;
}
export const missionFileChangesDtoSchema: z.ZodType<MissionFileChangesDto> = z.strictObject({ "items": z.array(fileChangeDtoSchema).max(200), "total": z.int().min(0), "limit": z.int() });

export interface CaptureHealthEntryDto {
  code: string;
  firstAt: DateTime;
  lastAt: DateTime;
}
export const captureHealthEntryDtoSchema: z.ZodType<CaptureHealthEntryDto> = z.object({ "code": z.string(), "firstAt": dateTimeSchema, "lastAt": dateTimeSchema });

export interface CaptureSessionDto {
  sessionId: string;
  startedAt: DateTime;
  bindingState: "bound" | "unbound" | "unknown";
  callbackObservedAt: DateTime | null;
  health: CaptureHealthEntryDto[];
}
export const captureSessionDtoSchema: z.ZodType<CaptureSessionDto> = z.object({ "sessionId": z.string(), "startedAt": dateTimeSchema, "bindingState": z.enum(["bound", "unbound", "unknown"]), "callbackObservedAt": dateTimeSchema.nullable(), "health": z.array(captureHealthEntryDtoSchema).max(16) });

export interface ObjectiveFileChangesDto {
  scope: "server_objective";
  missionId: string;
  objectiveId: string;
  /**
   * Ordered by resource key then path.
   */
  items: FileChangeDto[];
  total: number;
  limit: number;
  truncated: boolean;
  capture: {
    sessions: CaptureSessionDto[];
    warnings: Array<"unbound" | "bound_no_callback" | "unknown_binding" | "tool_activity_uncaptured">;
  };
}
export const objectiveFileChangesDtoSchema: z.ZodType<ObjectiveFileChangesDto> = z.object({ "scope": z.literal("server_objective"), "missionId": z.string(), "objectiveId": z.string(), "items": z.array(fileChangeDtoSchema).max(200), "total": z.int().min(0), "limit": z.int(), "truncated": z.boolean(), "capture": z.object({ "sessions": z.array(captureSessionDtoSchema), "warnings": z.array(z.enum(["unbound", "bound_no_callback", "unknown_binding", "tool_activity_uncaptured"])) }) });

export interface ScheduleWeekDayDto {
  dayNum: number;
  /**
   * `HH:mm` or `HH:mm:ss`, local to the schedule timezone.
   */
  times: string[];
}
export const scheduleWeekDayDtoSchema: z.ZodType<ScheduleWeekDayDto> = z.object({ "dayNum": z.int().min(0).max(6), "times": z.array(z.string()) });

export interface ScheduleDto {
  id: string;
  workspaceId: string;
  name: string | null;
  periodType: "d" | "w" | "m";
  periodInterval: number;
  weeksOfMonth: number[];
  /**
   * 1-31, or 32 for the last day of the month.
   */
  daysOfMonth: number[];
  daysOfWeek: ScheduleWeekDayDto[];
  timezone: string;
  startDate: string | null;
  nextStatusKey: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const scheduleDtoSchema: z.ZodType<ScheduleDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "name": z.string().nullable(), "periodType": z.enum(["d", "w", "m"]), "periodInterval": z.int().min(1), "weeksOfMonth": z.array(z.int().min(1).max(5)), "daysOfMonth": z.array(z.int().min(1).max(32)), "daysOfWeek": z.array(scheduleWeekDayDtoSchema), "timezone": z.string(), "startDate": z.string().nullable(), "nextStatusKey": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

/**
 * Validated by the scheduling engine; a rule it cannot evaluate answers 400 `validation_error` (for example, daily and weekly schedules require `daysOfWeek`).
 */
export interface ScheduleInput {
  name?: string | null;
  periodType: "d" | "w" | "m";
  periodInterval: number;
  weeksOfMonth?: number[];
  daysOfMonth?: number[];
  daysOfWeek?: ScheduleWeekDayDto[];
  /**
   * IANA timezone.
   */
  timezone: string;
  startDate?: string | null;
  /**
   * A live status key of the mission's project (409 `validation_error` otherwise); null uses the project default.
   */
  nextStatusKey?: string | null;
}
export const scheduleInputSchema: z.ZodType<ScheduleInput> = z.object({ "name": z.exactOptional(z.string().nullable()), "periodType": z.enum(["d", "w", "m"]), "periodInterval": z.int().min(1), "weeksOfMonth": z.exactOptional(z.array(z.int())), "daysOfMonth": z.exactOptional(z.array(z.int())), "daysOfWeek": z.exactOptional(z.array(scheduleWeekDayDtoSchema)), "timezone": z.string(), "startDate": z.exactOptional(z.string().nullable()), "nextStatusKey": z.exactOptional(z.string().nullable()) });

export interface MissionScheduleDto {
  dueDatetime: DateTime | null;
  schedule: ScheduleDto | null;
}
export const missionScheduleDtoSchema: z.ZodType<MissionScheduleDto> = z.object({ "dueDatetime": dateTimeSchema.nullable(), "schedule": scheduleDtoSchema.nullable() });

export interface PreviewScheduleBody {
  schedule: ScheduleInput;
  /**
   * Current due date used as the recurrence anchor.
   */
  itemDueDatetime?: string | null;
}
export const previewScheduleBodySchema: z.ZodType<PreviewScheduleBody> = z.object({ "schedule": scheduleInputSchema, "itemDueDatetime": z.exactOptional(z.string().nullable()) });

export interface SchedulePreviewDto {
  dueDatetime: DateTime;
}
export const schedulePreviewDtoSchema: z.ZodType<SchedulePreviewDto> = z.object({ "dueDatetime": dateTimeSchema });

export interface MissionBranchListDto {
  /**
   * The current branch alone, or empty; full ref lists come from the desktop local-target bridge.
   */
  branches: string[];
  /**
   * The prepared branch, else the pinned override, else null.
   */
  current: string | null;
}
export const missionBranchListDtoSchema: z.ZodType<MissionBranchListDto> = z.object({ "branches": z.array(z.string()).max(1), "current": z.string().nullable() });

export interface BranchActionBody {
  action: "integrate" | "commit" | "push_parent" | "publish";
  /**
   * Commit message for `commit`; the target refuses an empty one (`BRANCH_COMMIT_MESSAGE_REQUIRED`).
   */
  message?: string;
  /**
   * Resource to act on; blank uses the project primary.
   */
  resourceKey?: string;
  /**
   * Only `true` proceeds while an objective of the mission is executing.
   */
  confirmBusy?: boolean;
  /**
   * Only `true` means git already ran on the client; the server records `summary` only.
   */
  clientExecuted?: boolean;
  /**
   * Required (non-blank) when `clientExecuted` is true.
   */
  summary?: string;
}
export const branchActionBodySchema: z.ZodType<BranchActionBody> = z.object({ "action": z.enum(["integrate", "commit", "push_parent", "publish"]), "message": z.exactOptional(z.string()), "resourceKey": z.exactOptional(z.string()), "confirmBusy": z.exactOptional(z.boolean()), "clientExecuted": z.exactOptional(z.boolean()), "summary": z.exactOptional(z.string()) });

export interface GenerateCommitMessageBody {
  /**
   * Diff text gathered by the client. Required in practice; without it the route answers 409 `LOCAL_FILESYSTEM_UNAVAILABLE`.
   */
  diff?: string;
}
export const generateCommitMessageBodySchema: z.ZodType<GenerateCommitMessageBody> = z.object({ "diff": z.exactOptional(z.string()) });

export interface GenerateCommitMessageResultDto {
  message: string;
}
export const generateCommitMessageResultDtoSchema: z.ZodType<GenerateCommitMessageResultDto> = z.object({ "message": z.string() });

export interface BranchPreparedBody {
  /**
   * The execution request the branch was prepared for; stamps it and records the branch on its objective (404 when unknown).
   */
  requestId?: string | null;
  branchAutomation: {
    /**
     * Must not be blank.
     */
    branchName: string;
    /**
     * Must not be blank.
     */
    baseBranch: string;
    /**
     * Must not be blank.
     */
    worktreePath: string;
    /**
     * Must not be blank.
     */
    resourceKey: string;
    action: "create" | "reuse" | "new_cycle";
    /**
     * Defaults to 1.
     */
    cycle?: number;
    /**
     * Only `true` marks a per-objective branch, which leaves the mission's active branch alone.
     */
    isolated?: boolean;
  };
}
export const branchPreparedBodySchema: z.ZodType<BranchPreparedBody> = z.object({ "requestId": z.exactOptional(z.string().nullable()), "branchAutomation": z.object({ "branchName": z.string(), "baseBranch": z.string(), "worktreePath": z.string(), "resourceKey": z.string(), "action": z.enum(["create", "reuse", "new_cycle"]), "cycle": z.exactOptional(z.number()), "isolated": z.exactOptional(z.boolean()) }) });

export interface ForgetTerminalSessionBody {
  /**
   * Must not be blank.
   */
  providerSessionId: string;
  /**
   * Narrows the match to one execution request.
   */
  executionRequestId?: string | null;
}
export const forgetTerminalSessionBodySchema: z.ZodType<ForgetTerminalSessionBody> = z.object({ "providerSessionId": z.string(), "executionRequestId": z.exactOptional(z.string().nullable()) });

export interface ForgetTerminalSessionResultDto {
  /**
   * False when no execution request of the mission maps that session.
   */
  forgotten: boolean;
  executionRequestId: string | null;
}
export const forgetTerminalSessionResultDtoSchema: z.ZodType<ForgetTerminalSessionResultDto> = z.object({ "forgotten": z.boolean(), "executionRequestId": z.string().nullable() });

export interface CreateObjectiveBody {
  /**
   * Mission UUID or display id; requires `objective:update` there.
   */
  missionId: string;
  /**
   * Trimmed; may be blank only for a `draft` or `future` objective.
   */
  instructionText: string;
  /**
   * Blank or omitted derives a title from the instruction and generates a better one asynchronously.
   */
  title?: string | null;
  /**
   * Defaults to `draft`; a `draft` request becomes `future` when the mission already has a draft.
   */
  state?: ObjectiveState;
  /**
   * Deprecated queue hint; defaults to false.
   */
  autoAdvance?: boolean;
  /**
   * A resource key linked to the mission's project (409 `project_resource_key_not_found` otherwise); blank or null inherits the primary.
   */
  resourceKey?: string | null;
}
export const createObjectiveBodySchema: z.ZodType<CreateObjectiveBody> = z.object({ "missionId": z.string(), "instructionText": z.string(), "title": z.exactOptional(z.string().nullable()), "state": z.exactOptional(objectiveStateSchema), "autoAdvance": z.exactOptional(z.boolean()), "resourceKey": z.exactOptional(z.string().nullable()) });

/**
 * Partial update; a body with no recognized member returns the objective unchanged.
 */
export interface UpdateObjectiveBody {
  /**
   * Trimmed; may be blank only when the resulting state is `draft` or `future`. Refused (400) once the objective is `executing`, `pending_delivery` or `complete`.
   */
  instructionText?: string;
  /**
   * Blank or null clears it.
   */
  title?: string | null;
  /**
   * `complete` cannot move back to `future` (400). Moving an executed objective back to `draft` reopens it (a new run); leaving an active state dequeues it and clears its active execution requests.
   */
  state?: ObjectiveState;
  /**
   * Deprecated; adds the objective to, or removes it from, its mission's Run Queue.
   */
  autoAdvance?: boolean;
  position?: number;
  assignedAgent?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  resourceKey?: string | null;
  /**
   * Saves (or, with null, removes) the any-target override for `launchConfigAgent`.
   */
  launchConfigOverride?: AgentLaunchConfigInput | null;
  /**
   * Required (non-blank) with `launchConfigOverride` (400 otherwise).
   */
  launchConfigAgent?: string;
}
export const updateObjectiveBodySchema: z.ZodType<UpdateObjectiveBody> = z.object({ "instructionText": z.exactOptional(z.string()), "title": z.exactOptional(z.string().nullable()), "state": z.exactOptional(objectiveStateSchema), "autoAdvance": z.exactOptional(z.boolean()), "position": z.exactOptional(z.int().min(0)), "assignedAgent": z.exactOptional(z.string().nullable()), "model": z.exactOptional(z.string().nullable()), "reasoningEffort": z.exactOptional(z.string().nullable()), "resourceKey": z.exactOptional(z.string().nullable()), "launchConfigOverride": z.exactOptional(agentLaunchConfigInputSchema.nullable()), "launchConfigAgent": z.exactOptional(z.string()) });

export interface LaunchObjectiveBody {
  /**
   * Agent key; must not be blank. `manual` answers 400 `manual_agent_not_launchable`.
   */
  agent: string;
  model?: string | null;
  reasoningEffort?: string | null;
  /**
   * An eligible target of the project for the caller (reachable, primary resource connected; 400 `execution_target_not_eligible` otherwise). Omitted or blank uses the project's selected target.
   */
  executionTargetId?: string | null;
  /**
   * Saved onto the objective for this target (or `*`) and agent before the request is queued.
   */
  launchConfigOverride?: AgentLaunchConfigInput | null;
}
export const launchObjectiveBodySchema: z.ZodType<LaunchObjectiveBody> = z.object({ "agent": z.string(), "model": z.exactOptional(z.string().nullable()), "reasoningEffort": z.exactOptional(z.string().nullable()), "executionTargetId": z.exactOptional(z.string().nullable()), "launchConfigOverride": z.exactOptional(agentLaunchConfigInputSchema.nullable()) });

export interface ObjectivePromptDto {
  objectiveId: string;
  missionId: string;
  prompt: string;
}
export const objectivePromptDtoSchema: z.ZodType<ObjectivePromptDto> = z.object({ "objectiveId": z.string(), "missionId": z.string(), "prompt": z.string() });

export interface ObjectiveLaunchCommandDto {
  objectiveId: string;
  missionId: string;
  /**
   * A paste-ready `ovld launch` command line.
   */
  command: string;
}
export const objectiveLaunchCommandDtoSchema: z.ZodType<ObjectiveLaunchCommandDto> = z.object({ "objectiveId": z.string(), "missionId": z.string(), "command": z.string() });

export interface ObjectiveEffectiveLaunchConfigDto {
  objectiveId: string;
  missionId: string;
  /**
   * The target used to resolve target- and resource-scoped defaults.
   */
  executionTargetId: string | null;
  launchConfig: AgentLaunchConfigDto;
  source: "objective" | "resource_source" | "user_target" | "workspace" | "none";
}
export const objectiveEffectiveLaunchConfigDtoSchema: z.ZodType<ObjectiveEffectiveLaunchConfigDto> = z.object({ "objectiveId": z.string(), "missionId": z.string(), "executionTargetId": z.string().nullable(), "launchConfig": agentLaunchConfigDtoSchema, "source": z.enum(["objective", "resource_source", "user_target", "workspace", "none"]) });

export interface ResolveHumanActionBody {
  status: "done" | "dismissed";
  /**
   * Only with `status` `done` (400 otherwise).
   */
  outcome?: "mission_created" | "objective_added";
  /**
   * Display id of the created mission or objective; requires `outcome` and must not be blank (400).
   */
  outcomeRef?: string;
}
export const resolveHumanActionBodySchema: z.ZodType<ResolveHumanActionBody> = z.object({ "status": z.enum(["done", "dismissed"]), "outcome": z.exactOptional(z.enum(["mission_created", "objective_added"])), "outcomeRef": z.exactOptional(z.string().max(64)) });

export interface ActivityFeedMissionObjectiveDto {
  objectiveId: string;
  /**
   * The objective display id (the objective UUID when it has no display key).
   */
  displayId: string;
  title: string | null;
  state: ObjectiveState;
  position: number;
  assignedAgent: string | null;
  autoAdvance: boolean;
  /**
   * True while an open question or choice request waits on a human for this objective.
   */
  blocked: boolean;
}
export const activityFeedMissionObjectiveDtoSchema: z.ZodType<ActivityFeedMissionObjectiveDto> = z.object({ "objectiveId": z.string(), "displayId": z.string(), "title": z.string().nullable(), "state": objectiveStateSchema, "position": z.int().min(0), "assignedAgent": z.string().nullable(), "autoAdvance": z.boolean(), "blocked": z.boolean() });

/**
 * A mission card: live work (`mission_run`) or a mission whose most recent live delivery falls in the page's two-week window (`mission_delivered`). Chrome fields describe the primary objective: the launching one, else the oldest active one, else the objective behind the latest delivery.
 */
export interface ActivityFeedMissionItemDto {
  /**
   * `mission:<missionId>`.
   */
  id: string;
  kind: "mission_run" | "mission_delivered";
  occurredAt: DateTime;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  objectiveId: string | null;
  objectiveDisplayId: string | null;
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  runState: "launching" | "executing" | "delivered";
  /**
   * Every objective of the mission, in mission-panel display order.
   */
  objectives: ActivityFeedMissionObjectiveDto[];
  /**
   * Objectives that are launching, executing or pending delivery; empty for `delivered`.
   */
  activeObjectiveIds: string[];
  objectiveTitle: string | null;
  /**
   * Server-truncated instruction preview of the primary objective.
   */
  instructionPreview: string;
  agentIdentifier: string | null;
  modelIdentifier: string | null;
  branch: string | null;
  resourceKey: string | null;
  /**
   * Session start, or the execution request's creation while launching; null for `delivered`.
   */
  startedAt: DateTime | null;
  latestEventSummary: string | null;
  latestEventAt: DateTime | null;
}
export const activityFeedMissionItemDtoSchema: z.ZodType<ActivityFeedMissionItemDto> = z.object({ "id": z.string(), "kind": z.enum(["mission_run", "mission_delivered"]), "occurredAt": dateTimeSchema, "workspaceId": z.string(), "workspaceName": z.string(), "projectId": z.string(), "projectName": z.string(), "projectColor": z.string().nullable(), "missionId": z.string(), "missionDisplayId": z.string(), "missionTitle": z.string(), "objectiveId": z.string().nullable(), "objectiveDisplayId": z.string().nullable(), "createdByKind": createdByKindSchema, "createdByAgent": z.string().nullable(), "runState": z.enum(["launching", "executing", "delivered"]), "objectives": z.array(activityFeedMissionObjectiveDtoSchema), "activeObjectiveIds": z.array(z.string()), "objectiveTitle": z.string().nullable(), "instructionPreview": z.string(), "agentIdentifier": z.string().nullable(), "modelIdentifier": z.string().nullable(), "branch": z.string().nullable(), "resourceKey": z.string().nullable(), "startedAt": dateTimeSchema.nullable(), "latestEventSummary": z.string().nullable(), "latestEventAt": dateTimeSchema.nullable() });

/**
 * An unseen `ask` mission event from the past three days; the agent is blocked on it.
 */
export interface ActivityFeedQuestionItemDto {
  /**
   * `ask:<eventId>`.
   */
  id: string;
  kind: "blocking_question";
  occurredAt: DateTime;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  objectiveId: string | null;
  objectiveDisplayId: string | null;
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  eventId: string;
  agentRequestId: string | null;
  delivery: {
    mode: "latch" | "read_only";
  };
  /**
   * Server-truncated question text.
   */
  question: string;
  agentIdentifier: string | null;
  askedAt: DateTime;
}
export const activityFeedQuestionItemDtoSchema: z.ZodType<ActivityFeedQuestionItemDto> = z.object({ "id": z.string(), "kind": z.literal("blocking_question"), "occurredAt": dateTimeSchema, "workspaceId": z.string(), "workspaceName": z.string(), "projectId": z.string(), "projectName": z.string(), "projectColor": z.string().nullable(), "missionId": z.string(), "missionDisplayId": z.string(), "missionTitle": z.string(), "objectiveId": z.string().nullable(), "objectiveDisplayId": z.string().nullable(), "createdByKind": createdByKindSchema, "createdByAgent": z.string().nullable(), "eventId": z.string(), "agentRequestId": z.string().nullable(), "delivery": z.object({ "mode": z.enum(["latch", "read_only"]) }), "question": z.string(), "agentIdentifier": z.string().nullable(), "askedAt": dateTimeSchema });

export interface ActivityFeedDto {
  /**
   * Grouped: launching mission runs, executing mission runs, blocking questions (those three capped together), then delivered missions; newest first within each group. A page loaded with `before` holds only delivered missions.
   */
  items: Array<ActivityFeedMissionItemDto | ActivityFeedQuestionItemDto>;
  generatedAt: DateTime;
  /**
   * Per-kind totals before truncation.
   */
  counts: {
    mission_run: number;
    blocking_question: number;
    mission_delivered: number;
  };
  /**
   * Pass as `before` for the next older two-week delivered window; null when none is older.
   */
  nextBefore: DateTime | null;
}
export const activityFeedDtoSchema: z.ZodType<ActivityFeedDto> = z.object({ "items": z.array(z.union([activityFeedMissionItemDtoSchema, activityFeedQuestionItemDtoSchema])), "generatedAt": dateTimeSchema, "counts": z.object({ "mission_run": z.int().min(0), "blocking_question": z.int().min(0), "mission_delivered": z.int().min(0) }), "nextBefore": dateTimeSchema.nullable() });

export interface ObjectiveTranscriptItemDto {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  missionRevision: number;
  statusType: StatusType;
  projectName: string;
  projectColor: string | null;
  projectRevision: number;
  title: string | null;
  instructionText: string;
  state: ObjectiveState;
  assignedAgent: string | null;
  resourceKey: string | null;
  createdByKind: CreatedByKind;
  createdByAgent: string | null;
  createdByWorkspaceUserId: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const objectiveTranscriptItemDtoSchema: z.ZodType<ObjectiveTranscriptItemDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "missionId": z.string(), "missionDisplayId": z.string(), "missionTitle": z.string(), "missionRevision": z.int().min(1), "statusType": statusTypeSchema, "projectName": z.string(), "projectColor": z.string().nullable(), "projectRevision": z.int().min(1), "title": z.string().nullable(), "instructionText": z.string(), "state": objectiveStateSchema, "assignedAgent": z.string().nullable(), "resourceKey": z.string().nullable(), "createdByKind": createdByKindSchema, "createdByAgent": z.string().nullable(), "createdByWorkspaceUserId": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export interface ObjectiveTranscriptPageDto {
  items: ObjectiveTranscriptItemDto[];
  /**
   * Cursor for the next older page; set only on a `before`-style read with more rows.
   */
  nextBefore: string | null;
  /**
   * On an `after` read, the cursor to continue from (the last item's, or the given cursor when the page is empty); null otherwise.
   */
  nextAfter: string | null;
  /**
   * Cursor of the newest item on the page, or null when it is empty.
   */
  newestCursor: string | null;
  /**
   * Always false for an `ids` read.
   */
  hasMore: boolean;
}
export const objectiveTranscriptPageDtoSchema: z.ZodType<ObjectiveTranscriptPageDto> = z.object({ "items": z.array(objectiveTranscriptItemDtoSchema).max(100), "nextBefore": z.string().nullable(), "nextAfter": z.string().nullable(), "newestCursor": z.string().nullable(), "hasMore": z.boolean() });

export interface InboxItemDto {
  id: string;
  title: string;
  objectives: string[];
  /**
   * The stored due date, or null. Create and update echo the request's text rather than re-reading the row, so on Postgres (which normalizes the stored value) the response can differ from a later read.
   */
  dueDatetime: string | null;
  priority: MissionPriority | null;
  attachmentCount: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}
export const inboxItemDtoSchema: z.ZodType<InboxItemDto> = z.object({ "id": z.string(), "title": z.string(), "objectives": z.array(z.string()).min(1).max(1), "dueDatetime": z.string().nullable(), "priority": missionPrioritySchema.nullable(), "attachmentCount": z.int().min(0), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema });

export type InboxItemList = InboxItemDto[];
export const inboxItemListSchema: z.ZodType<InboxItemList> = z.array(inboxItemDtoSchema);

export interface CreateInboxItemBody {
  /**
   * Trimmed; must not be blank.
   */
  title: string;
  /**
   * Exactly one non-blank instruction (trimmed); non-string items count as blank.
   */
  objectives: string[];
  /**
   * Checked only with `Date.parse` (400 when unparsable); SQLite accepts only the canonical `YYYY-MM-DDTHH:mm:ss.sssZ` form (409 `Database constraint violation.` otherwise). Null leaves it unset.
   */
  dueDatetime?: string | null;
  priority?: MissionPriority | null;
}
export const createInboxItemBodySchema: z.ZodType<CreateInboxItemBody> = z.object({ "title": z.string(), "objectives": z.array(z.string()).min(1).max(1), "dueDatetime": z.exactOptional(z.string().nullable()), "priority": z.exactOptional(missionPrioritySchema.nullable()) });

/**
 * Partial update; omitted members keep their stored value and the merged item is validated as on create. `title: null` and `objectives: null` also keep the stored value.
 */
export interface UpdateInboxItemBody {
  title?: string;
  objectives?: string[];
  dueDatetime?: string | null;
  priority?: MissionPriority | null;
}
export const updateInboxItemBodySchema: z.ZodType<UpdateInboxItemBody> = z.object({ "title": z.exactOptional(z.string()), "objectives": z.exactOptional(z.array(z.string()).min(1).max(1)), "dueDatetime": z.exactOptional(z.string().nullable()), "priority": z.exactOptional(missionPrioritySchema.nullable()) });

export interface PromoteInboxItemBody {
  /**
   * Destination project; requires `mission:create` there. Missing or unknown answers 404.
   */
  projectId: string;
}
export const promoteInboxItemBodySchema: z.ZodType<PromoteInboxItemBody> = z.object({ "projectId": z.string() });

export type InboxMissionDto = MissionDto & {
  projectName: string;
  projectColor: string | null;
  /**
   * Why the mission is listed: `overdue` (due before today, UTC), `due_soon` (due today or tomorrow, UTC; exclusive with `overdue`), `agent_next` (agent-authored, status type `next`), and the label-only `recent` (created in the past seven days).
   */
  reasons: Array<"overdue" | "due_soon" | "agent_next" | "recent">;
};
export const inboxMissionDtoSchema: z.ZodType<InboxMissionDto> = z.object({ ...missionDtoShape, "projectName": z.string(), "projectColor": z.string().nullable(), "reasons": z.array(z.enum(["overdue", "due_soon", "agent_next", "recent"])) });

export interface InboxMissionsResponse {
  generatedAt: DateTime;
  /**
   * Overdue (latest due first), then due soon (soonest first), then agent Next (newest first); each slice capped at 60.
   */
  missions: InboxMissionDto[];
}
export const inboxMissionsResponseSchema: z.ZodType<InboxMissionsResponse> = z.object({ "generatedAt": dateTimeSchema, "missions": z.array(inboxMissionDtoSchema) });

/**
 * The caller's profile (`profiles` row plus metadata projections).
 */
export interface ProfileDto {
  /**
   * `profiles.id` (Better Auth user id, not a UUID).
   */
  userId: string;
  displayName: string;
  /**
   * Mirrors the Better Auth account name; read-only here.
   */
  handle: string | null;
  /**
   * Mirrors the Better Auth account email; read-only here.
   */
  email: string | null;
  /**
   * `metadata_json.avatarUrl` when a non-blank string (returned as stored), else null.
   */
  avatarUrl: string | null;
  /**
   * `metadata_json.agentInstructions`, trimmed, when non-blank; else null.
   */
  agentInstructions: string | null;
  /**
   * `metadata_json.editorScheme`, trimmed, when non-blank; else null (clients default to VS Code).
   */
  editorScheme: string | null;
  /**
   * Open vocabulary (`human`, `service`).
   */
  kind: string;
  /**
   * Always `better-auth` from this route (typed nullable in packages/contract).
   */
  authProvider: string | null;
  /**
   * Distinct role keys across the selected organization's authorized workspaces, sorted.
   */
  roles: string[];
  createdAt: DateTime;
}
export const profileDtoSchema: z.ZodType<ProfileDto> = z.object({ "userId": z.string(), "displayName": z.string(), "handle": z.string().nullable(), "email": z.string().nullable(), "avatarUrl": z.string().nullable(), "agentInstructions": z.string().nullable(), "editorScheme": z.string().nullable(), "kind": z.string(), "authProvider": z.string().nullable(), "roles": z.array(z.string()), "createdAt": dateTimeSchema });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateProfileBody {
  /**
   * Trimmed; blank answers 400.
   */
  displayName?: string;
  /**
   * Trimmed; blank or null clears it. Otherwise must start with `http://`, `https://` or `/` (an uploaded image path such as `/api/storage/user-images/…`), else 400.
   */
  avatarUrl?: string | null;
  /**
   * Trimmed; blank or null clears it.
   */
  agentInstructions?: string | null;
  /**
   * Trimmed; blank or null clears it. Not validated against a vocabulary.
   */
  editorScheme?: string | null;
}
export const updateProfileBodySchema: z.ZodType<UpdateProfileBody> = z.object({ "displayName": z.exactOptional(z.string()), "avatarUrl": z.exactOptional(z.string().nullable()), "agentInstructions": z.exactOptional(z.string().nullable()), "editorScheme": z.exactOptional(z.string().nullable()) });

export interface DefaultProjectPreferenceDto {
  projectId: string | null;
}
export const defaultProjectPreferenceDtoSchema: z.ZodType<DefaultProjectPreferenceDto> = z.object({ "projectId": z.string().nullable() });

/**
 * `projectId` is read as `String(projectId ?? '')` and trimmed; blank or absent answers 400 `projectId is required`. An unknown, foreign or archived project answers 404.
 */
export interface SetDefaultProjectBody {
  projectId: string;
}
export const setDefaultProjectBodySchema: z.ZodType<SetDefaultProjectBody> = z.object({ "projectId": z.string() });

/**
 * The `user_tokens.status` CHECK vocabulary. Lifecycle routes write only `active` and `revoked`; an expired token keeps `active` with a past `expiresAt`.
 */
export type UserTokenStatus = "active" | "revoked" | "expired" | "rotated";
export const userTokenStatusSchema: z.ZodType<UserTokenStatus> = z.enum(["active", "revoked", "expired", "rotated"]);

export type TokenScope = "full" | "mission_lifecycle" | "project_automation";
export const tokenScopeSchema: z.ZodType<TokenScope> = z.enum(["full", "mission_lifecycle", "project_automation"]);

export interface UserTokenProjectDto {
  id: string;
  /**
   * The project's current name.
   */
  name: string;
}
export const userTokenProjectDtoSchema: z.ZodType<UserTokenProjectDto> = z.object({ "id": z.string(), "name": z.string() });

/**
 * A personal token as listed to its owner; never the secret or its hash.
 */
export interface UserTokenDto {
  id: string;
  label: string;
  /**
   * Non-secret display prefix, `out_…`.
   */
  tokenPrefix: string;
  status: UserTokenStatus;
  scope: TokenScope;
  /**
   * Active scope grant patterns (RBAC actions); empty for a `full` token.
   */
  scopeGrants: string[];
  /**
   * The live projects a `project_automation` token was issued for, by name; empty for other scopes and once every selected project is deleted.
   */
  projects: UserTokenProjectDto[];
  expiresAt: DateTime | null;
  lastUsedAt: DateTime | null;
  revokedAt: DateTime | null;
  createdAt: DateTime;
}
export const userTokenDtoSchema: z.ZodType<UserTokenDto> = z.object({ "id": z.string(), "label": z.string(), "tokenPrefix": z.string(), "status": userTokenStatusSchema, "scope": tokenScopeSchema, "scopeGrants": z.array(z.string()), "projects": z.array(userTokenProjectDtoSchema), "expiresAt": dateTimeSchema.nullable(), "lastUsedAt": dateTimeSchema.nullable(), "revokedAt": dateTimeSchema.nullable(), "createdAt": dateTimeSchema });

export type UserTokenList = UserTokenDto[];
export const userTokenListSchema: z.ZodType<UserTokenList> = z.array(userTokenDtoSchema);

export interface CreateUserTokenBody {
  /**
   * Trimmed; blank or absent answers 400.
   */
  label: string;
  /**
   * Absent: 90 days from now. `null` or blank: never expires. Otherwise parsed with `new Date()` (a number is read as epoch milliseconds); unparseable or not in the future answers 400. Stored normalized to ISO-8601 UTC.
   */
  expiresAt?: string | null;
  /**
   * Defaults to `full` when absent or null; any other value answers 400.
   */
  scope?: TokenScope | null;
  /**
   * Required, non-empty and unique when `scope` is `project_automation` (each a 36-character hex-and-dash id; 400 otherwise); present with any other scope answers 400. Every project must exist (404) and grant the caller `project:read` and `mission:create` (403/404).
   */
  projectIds?: string[];
}
export const createUserTokenBodySchema: z.ZodType<CreateUserTokenBody> = z.object({ "label": z.string(), "expiresAt": z.exactOptional(z.string().nullable()), "scope": z.exactOptional(tokenScopeSchema.nullable()), "projectIds": z.exactOptional(z.array(z.string()).min(1).refine(hasUniqueItems, { error: 'Expected unique items' })) });

export interface CreateUserTokenResultDto {
  token: UserTokenDto;
  /**
   * The raw `out_…` secret; returned only once.
   */
  secret: string;
}
export const createUserTokenResultDtoSchema: z.ZodType<CreateUserTokenResultDto> = z.object({ "token": userTokenDtoSchema, "secret": z.string() });

export interface UpdateUserTokenBody {
  /**
   * Trimmed; blank or absent answers 400.
   */
  label: string;
}
export const updateUserTokenBodySchema: z.ZodType<UpdateUserTokenBody> = z.object({ "label": z.string() });

export interface OrganizationDto {
  id: string;
  name: string;
  /**
   * `settings_json.logoUrl`, trimmed, when non-blank; else null.
   */
  logoUrl: string | null;
  /**
   * Live workspaces in the organization.
   */
  workspaceCount: number;
  /**
   * Whether this is the request's selected organization (the token's organization, or a session's only organization). Always written although optional in packages/contract.
   */
  isActive: boolean;
  createdAt: DateTime;
}
export const organizationDtoSchema: z.ZodType<OrganizationDto> = z.object({ "id": z.string(), "name": z.string(), "logoUrl": z.string().nullable(), "workspaceCount": z.int().min(0), "isActive": z.boolean(), "createdAt": dateTimeSchema });

export type OrganizationList = OrganizationDto[];
export const organizationListSchema: z.ZodType<OrganizationList> = z.array(organizationDtoSchema);

export interface WorkspaceDto {
  id: string;
  organizationId: string;
  /**
   * Unique within the organization; `[a-z0-9-]`, at most 48 characters.
   */
  slug: string;
  name: string;
  /**
   * Open vocabulary; workspaces created through REST are `local`.
   */
  kind: string;
  /**
   * Whether this is the request's ambient workspace. Authenticated REST requests carry none, so it is `false` for every session and token caller.
   */
  isActive: boolean;
  /**
   * Non-deleted projects (archived included).
   */
  projectCount: number;
  /**
   * Active, non-deleted memberships.
   */
  memberCount: number;
  /**
   * The workspace's stored boolean setting, else the server's configured default.
   */
  sqlStudioEnabled: boolean;
  createdAt: DateTime;
}
export const workspaceDtoSchema: z.ZodType<WorkspaceDto> = z.object({ "id": z.string(), "organizationId": z.string(), "slug": z.string(), "name": z.string(), "kind": z.string(), "isActive": z.boolean(), "projectCount": z.int().min(0), "memberCount": z.int().min(0), "sqlStudioEnabled": z.boolean(), "createdAt": dateTimeSchema });

export type WorkspaceList = WorkspaceDto[];
export const workspaceListSchema: z.ZodType<WorkspaceList> = z.array(workspaceDtoSchema);

/**
 * The caller's organizations and the selected organization's workspaces (`buildMeta`, backend/http/meta.ts). Shared by `GET /api/meta`, which adds server metadata, and `POST /api/onboarding`.
 */
export interface MetaDto {
  /**
   * The selected organization; null when none is selected (several organizations, or none).
   */
  organization: OrganizationDto | null;
  /**
   * Every organization the profile has an active membership in (as `GET /api/organizations`).
   */
  organizations: OrganizationDto[];
  /**
   * The profile's active workspaces in the selected organization; empty when none is selected.
   */
  workspaces: WorkspaceDto[];
  /**
   * The ambient workspace; always null for authenticated REST callers.
   */
  workspace: WorkspaceDto | null;
  /**
   * As `GET /api/profile/default-project`.
   */
  defaultProjectId: string | null;
}
const metaDtoShape = { "organization": organizationDtoSchema.nullable(), "organizations": z.array(organizationDtoSchema), "workspaces": z.array(workspaceDtoSchema), "workspace": workspaceDtoSchema.nullable(), "defaultProjectId": z.string().nullable() };
export const metaDtoSchema: z.ZodType<MetaDto> = z.object(metaDtoShape);

export interface CreateOrganizationOnboardingBody {
  /**
   * Trimmed; blank or absent answers 400.
   */
  organizationName: string;
  /**
   * Trimmed; blank or absent becomes `general`.
   */
  workspaceName?: string;
  /**
   * Lowercased, runs of other characters become `-`, trimmed of `-`, cut to 48 characters (`workspace` if nothing remains). Absent or blank derives the first three letters and digits of the workspace name. A taken slug gets a `-2`, `-3`, … suffix.
   */
  workspaceSlug?: string;
}
export const createOrganizationOnboardingBodySchema: z.ZodType<CreateOrganizationOnboardingBody> = z.object({ "organizationName": z.string(), "workspaceName": z.exactOptional(z.string()), "workspaceSlug": z.exactOptional(z.string()) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateOrganizationBody {
  /**
   * Trimmed; blank answers 400.
   */
  name?: string;
  /**
   * Trimmed; blank or null clears it. Otherwise must start with `http://`, `https://` or `/` (an uploaded `/api/storage/organization-images/…` path), else 400.
   */
  logoUrl?: string | null;
}
export const updateOrganizationBodySchema: z.ZodType<UpdateOrganizationBody> = z.object({ "name": z.exactOptional(z.string()), "logoUrl": z.exactOptional(z.string().nullable()) });

export interface OrganizationAdminDto {
  /**
   * `profiles.id`.
   */
  userId: string;
  displayName: string;
  handle: string | null;
  email: string | null;
  /**
   * `metadata_json.avatarUrl`, trimmed, when non-blank; else null.
   */
  avatarUrl: string | null;
}
export const organizationAdminDtoSchema: z.ZodType<OrganizationAdminDto> = z.object({ "userId": z.string(), "displayName": z.string(), "handle": z.string().nullable(), "email": z.string().nullable(), "avatarUrl": z.string().nullable() });

export type OrganizationAdminList = OrganizationAdminDto[];
export const organizationAdminListSchema: z.ZodType<OrganizationAdminList> = z.array(organizationAdminDtoSchema);

export interface AddOrganizationAdminBody {
  /**
   * Profile id, trimmed; blank or absent answers 400, an unknown profile 404.
   */
  userId: string;
}
export const addOrganizationAdminBodySchema: z.ZodType<AddOrganizationAdminBody> = z.object({ "userId": z.string() });

export interface CreateWorkspaceBody {
  /**
   * Trimmed; blank or absent answers 400.
   */
  organizationId: string;
  /**
   * Trimmed; blank or absent answers 400.
   */
  name: string;
  /**
   * Normalized as `CreateOrganizationOnboardingBody.workspaceSlug`; absent or blank derives the first three letters and digits of the name. Uniquified within the organization.
   */
  slug?: string;
}
export const createWorkspaceBodySchema: z.ZodType<CreateWorkspaceBody> = z.object({ "organizationId": z.string(), "name": z.string(), "slug": z.exactOptional(z.string()) });

/**
 * Partial update; omitted members are unchanged. A `MANAGER` may set either member.
 */
export interface UpdateWorkspaceBody {
  /**
   * Trimmed; blank answers 400.
   */
  name?: string;
  /**
   * Stored as given without a type check; a non-boolean value is stored and then reads back as the server default. Changing it on the server's bootstrap workspace starts or stops SQL Studio.
   */
  sqlStudioEnabled?: boolean;
}
export const updateWorkspaceBodySchema: z.ZodType<UpdateWorkspaceBody> = z.object({ "name": z.exactOptional(z.string()), "sqlStudioEnabled": z.exactOptional(z.boolean()) });

export type WorkspaceRoleKey = "ADMIN" | "MANAGER" | "MEMBER";
export const workspaceRoleKeySchema: z.ZodType<WorkspaceRoleKey> = z.enum(["ADMIN", "MANAGER", "MEMBER"]);

export interface WorkspaceMemberDto {
  /**
   * `workspace_users.id`.
   */
  workspaceUserId: string;
  /**
   * `profiles.id`.
   */
  userId: string;
  displayName: string;
  handle: string | null;
  email: string | null;
  /**
   * Open vocabulary (`human`, `service`).
   */
  kind: string;
  /**
   * Active workspace-level role keys, sorted.
   */
  roleKeys: string[];
  /**
   * Whether `roleKeys` contains `ADMIN`.
   */
  isAdmin: boolean;
  /**
   * Whether the membership belongs to the caller.
   */
  isOperator: boolean;
  joinedAt: DateTime;
  /**
   * `metadata_json.avatarUrl`, trimmed, when non-blank; else null.
   */
  avatarUrl: string | null;
}
export const workspaceMemberDtoSchema: z.ZodType<WorkspaceMemberDto> = z.object({ "workspaceUserId": z.string(), "userId": z.string(), "displayName": z.string(), "handle": z.string().nullable(), "email": z.string().nullable(), "kind": z.string(), "roleKeys": z.array(z.string()), "isAdmin": z.boolean(), "isOperator": z.boolean(), "joinedAt": dateTimeSchema, "avatarUrl": z.string().nullable() });

export type WorkspaceMemberList = WorkspaceMemberDto[];
export const workspaceMemberListSchema: z.ZodType<WorkspaceMemberList> = z.array(workspaceMemberDtoSchema);

export interface UpdateWorkspaceMemberRoleBody {
  /**
   * Trimmed and uppercased, then one of `ADMIN`, `MANAGER`, `MEMBER`; anything else (or absent) answers 400.
   */
  roleKey: string;
}
export const updateWorkspaceMemberRoleBodySchema: z.ZodType<UpdateWorkspaceMemberRoleBody> = z.object({ "roleKey": z.string() });

export type WorkspaceInvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export const workspaceInvitationStatusSchema: z.ZodType<WorkspaceInvitationStatus> = z.enum(["pending", "accepted", "revoked", "expired"]);

export interface WorkspaceInvitationDto {
  id: string;
  workspaceId: string;
  /**
   * Lowercased.
   */
  email: string;
  roleKey: WorkspaceRoleKey;
  status: WorkspaceInvitationStatus;
  /**
   * Non-secret display prefix, `inv_…`.
   */
  tokenPrefix: string;
  expiresAt: DateTime;
  createdAt: DateTime;
}
export const workspaceInvitationDtoSchema: z.ZodType<WorkspaceInvitationDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "email": z.string(), "roleKey": workspaceRoleKeySchema, "status": workspaceInvitationStatusSchema, "tokenPrefix": z.string(), "expiresAt": dateTimeSchema, "createdAt": dateTimeSchema });

export type WorkspaceInvitationList = WorkspaceInvitationDto[];
export const workspaceInvitationListSchema: z.ZodType<WorkspaceInvitationList> = z.array(workspaceInvitationDtoSchema);

export interface InviteWorkspaceMemberBody {
  /**
   * Trimmed and lowercased; must contain `@` (400 otherwise).
   */
  email: string;
  /**
   * Trimmed and uppercased; defaults to `MEMBER`. Must be `ADMIN`, `MANAGER` or `MEMBER` (400 otherwise).
   */
  roleKey?: string;
}
export const inviteWorkspaceMemberBodySchema: z.ZodType<InviteWorkspaceMemberBody> = z.object({ "email": z.string(), "roleKey": z.exactOptional(z.string()) });

export interface InviteWorkspaceMemberResultDto {
  invitation: WorkspaceInvitationDto;
  /**
   * Present only when no email provider is configured: the web accept page with the raw token, `<site>/accept-invite?token=…`.
   */
  acceptUrl?: string;
}
export const inviteWorkspaceMemberResultDtoSchema: z.ZodType<InviteWorkspaceMemberResultDto> = z.object({ "invitation": workspaceInvitationDtoSchema, "acceptUrl": z.exactOptional(z.string()) });

export interface AcceptWorkspaceInvitationBody {
  /**
   * The raw `inv_…` token, trimmed; blank or absent answers 400.
   */
  token: string;
}
export const acceptWorkspaceInvitationBodySchema: z.ZodType<AcceptWorkspaceInvitationBody> = z.object({ "token": z.string() });

export interface AuthProvidersDto {
  email: true;
  github: boolean;
}
export const authProvidersDtoSchema: z.ZodType<AuthProvidersDto> = z.object({ "email": z.literal(true), "github": z.boolean() });

/**
 * `GET /api/meta`: `MetaDto` plus server configuration.
 */
export type ServerMetaDto = MetaDto & {
  /**
   * The resolved SQLite file path (also present, and meaningless, on Postgres).
   */
  databasePath: string;
  /**
   * `cloud` on Postgres; otherwise `backend_mode` from overlord.toml (default `local`).
   */
  backendMode: "local" | "cloud";
  web: {
    /**
     * The bind host.
     */
    host: string;
    port: number;
    /**
     * `http://<host>:<port>`, with `0.0.0.0` shown as `127.0.0.1`.
     */
    url: string;
  };
  sqlStudio: {
    /**
     * Whether this process is serving SQL Studio.
     */
    enabled: boolean;
    url: string | null;
  };
  authProviders: AuthProvidersDto;
  capabilities: {
    projects: true;
    missions: true;
    objectives: true;
    realtime: true;
    sqlStudio: boolean;
    launchAgents: true;
    executionTargets: false;
    /**
     * `in_process_server` only on SQLite with `OVERLORD_DEV_IN_PROCESS_LOCAL_TARGET=true`.
     */
    localTarget: "in_process_server" | "unavailable";
    /**
     * Whether `/mcp` is registered (`OVERLORD_MCP_ENABLED=true`).
     */
    mcp: boolean;
  };
};
export const serverMetaDtoSchema: z.ZodType<ServerMetaDto> = z.object({ ...metaDtoShape, "databasePath": z.string(), "backendMode": z.enum(["local", "cloud"]), "web": z.object({ "host": z.string(), "port": z.int().min(0).max(65535), "url": z.string() }), "sqlStudio": z.object({ "enabled": z.boolean(), "url": z.string().nullable() }), "authProviders": authProvidersDtoSchema, "capabilities": z.object({ "projects": z.literal(true), "missions": z.literal(true), "objectives": z.literal(true), "realtime": z.literal(true), "sqlStudio": z.boolean(), "launchAgents": z.literal(true), "executionTargets": z.literal(false), "localTarget": z.enum(["in_process_server", "unavailable"]), "mcp": z.boolean() }) });

export interface AuthorizedWorkspaceDto {
  workspaceId: string;
  workspaceUserId: string;
  organizationId: string;
  slug: string;
  name: string;
  kind: string;
  /**
   * Active role keys in that workspace, sorted.
   */
  roleKeys: string[];
}
export const authorizedWorkspaceDtoSchema: z.ZodType<AuthorizedWorkspaceDto> = z.object({ "workspaceId": z.string(), "workspaceUserId": z.string(), "organizationId": z.string(), "slug": z.string(), "name": z.string(), "kind": z.string(), "roleKeys": z.array(z.string()) });

export interface AuthorizedWorkspaceDiscoveryDto {
  organizationId: string | null;
  organizations: OrganizationDto[];
  workspaces: AuthorizedWorkspaceDto[];
  /**
   * True only for a session whose profile belongs to more than one organization.
   */
  selectionRequired: boolean;
}
export const authorizedWorkspaceDiscoveryDtoSchema: z.ZodType<AuthorizedWorkspaceDiscoveryDto> = z.object({ "organizationId": z.string().nullable(), "organizations": z.array(organizationDtoSchema), "workspaces": z.array(authorizedWorkspaceDtoSchema), "selectionRequired": z.boolean() });

export interface StaleBackendHostExecutionTargetDto {
  executionTargetId: string;
  label: string;
  deviceLabel: string | null;
  deviceFingerprint: string;
}
export const staleBackendHostExecutionTargetDtoSchema: z.ZodType<StaleBackendHostExecutionTargetDto> = z.object({ "executionTargetId": z.string(), "label": z.string(), "deviceLabel": z.string().nullable(), "deviceFingerprint": z.string() });

export interface ExecutionTargetMigrationDiagnosticsDto {
  hostedBackend: boolean;
  backendHostFingerprint: string;
  staleBackendHostTargets: StaleBackendHostExecutionTargetDto[];
  staleQueuedExecutionRequestCount: number;
}
export const executionTargetMigrationDiagnosticsDtoSchema: z.ZodType<ExecutionTargetMigrationDiagnosticsDto> = z.object({ "hostedBackend": z.boolean(), "backendHostFingerprint": z.string(), "staleBackendHostTargets": z.array(staleBackendHostExecutionTargetDtoSchema), "staleQueuedExecutionRequestCount": z.int().min(0) });

/**
 * The `{ message }` error body of the sign-in handoff exchanges, and Better Auth's `{ message, code }` passed through by `/api/auth/desktop/github`. Not an `ErrorEnvelope`.
 */
export interface MessageErrorBody {
  message: string;
  code?: string;
}
export const messageErrorBodySchema: z.ZodType<MessageErrorBody> = z.object({ "message": z.string(), "code": z.exactOptional(z.string()) });

export interface OAuthHandoffExchangeBody {
  /**
   * The one-time ticket (32–128 characters of `[A-Za-z0-9_-]`). A missing, non-string or malformed value answers 401, not 400.
   */
  ticket: string;
}
export const oAuthHandoffExchangeBodySchema: z.ZodType<OAuthHandoffExchangeBody> = z.object({ "ticket": z.string() });

export interface OAuthHandoffExchangeResultDto {
  /**
   * The Better Auth session token, for `Authorization: Bearer`.
   */
  token: string;
}
export const oAuthHandoffExchangeResultDtoSchema: z.ZodType<OAuthHandoffExchangeResultDto> = z.object({ "token": z.string() });

export type NotificationType = "mission_awaiting_review" | "agent_question" | "mission_complete" | "mission_failed" | "agent_started" | "returned_to_execute";
export const notificationTypeSchema: z.ZodType<NotificationType> = z.enum(["mission_awaiting_review", "agent_question", "mission_complete", "mission_failed", "agent_started", "returned_to_execute"]);

/**
 * A mission notification type or one of the two assistant conversation types.
 */
export type NotificationPreferenceType = "mission_awaiting_review" | "agent_question" | "mission_complete" | "mission_failed" | "agent_started" | "returned_to_execute" | "chat_needs_answer" | "chat_finished";
export const notificationPreferenceTypeSchema: z.ZodType<NotificationPreferenceType> = z.enum(["mission_awaiting_review", "agent_question", "mission_complete", "mission_failed", "agent_started", "returned_to_execute", "chat_needs_answer", "chat_finished"]);

/**
 * `agent_started` and `returned_to_execute` are not eligible for `apns`.
 */
export type NotificationTransport = "apns" | "realtime" | "in_app";
export const notificationTransportSchema: z.ZodType<NotificationTransport> = z.enum(["apns", "realtime", "in_app"]);

export type NotificationMode = "alert" | "silent" | "off";
export const notificationModeSchema: z.ZodType<NotificationMode> = z.enum(["alert", "silent", "off"]);

/**
 * The APNs-eligible mission notification types.
 */
export type PushNotificationCategory = "mission_awaiting_review" | "agent_question" | "mission_complete" | "mission_failed";
export const pushNotificationCategorySchema: z.ZodType<PushNotificationCategory> = z.enum(["mission_awaiting_review", "agent_question", "mission_complete", "mission_failed"]);

export interface NotificationDto {
  id: string;
  workspaceId: string;
  type: NotificationType;
  missionId: string;
  objectiveId: string | null;
  createdAt: DateTime;
  readAt: DateTime | null;
  revision: number;
  presentation: {
    /**
     * Bounded text built from the mission display id and title (or the objective's) and the type's fixed verb; recomputed on read, never stored.
     */
    body: string;
  };
}
export const notificationDtoSchema: z.ZodType<NotificationDto> = z.object({ "id": z.string(), "workspaceId": z.string(), "type": notificationTypeSchema, "missionId": z.string(), "objectiveId": z.string().nullable(), "createdAt": dateTimeSchema, "readAt": dateTimeSchema.nullable(), "revision": z.int().min(1), "presentation": z.object({ "body": z.string() }) });

export type NotificationList = NotificationDto[];
export const notificationListSchema: z.ZodType<NotificationList> = z.array(notificationDtoSchema);

export interface NotificationRevisionBody {
  /**
   * The notification's current `revision`; a non-integer or value below 1 answers 400.
   */
  expectedRevision: number;
}
export const notificationRevisionBodySchema: z.ZodType<NotificationRevisionBody> = z.object({ "expectedRevision": z.int().min(1) });

export interface NotificationPreferenceDto {
  type: NotificationPreferenceType;
  transport: NotificationTransport;
  mode: NotificationMode;
}
export const notificationPreferenceDtoSchema: z.ZodType<NotificationPreferenceDto> = z.object({ "type": notificationPreferenceTypeSchema, "transport": notificationTransportSchema, "mode": notificationModeSchema });

export interface NotificationPreferencesDto {
  /**
   * The master switch; false only when it was explicitly turned off.
   */
  enabled: boolean;
  /**
   * Every type with each of its eligible transports, in catalog order.
   */
  preferences: NotificationPreferenceDto[];
  /**
   * APNs-only projection for released iOS builds (absent rows read `alert`).
   */
  categories: Array<{
    category: PushNotificationCategory;
    mode: NotificationMode;
  }>;
}
export const notificationPreferencesDtoSchema: z.ZodType<NotificationPreferencesDto> = z.object({ "enabled": z.boolean(), "preferences": z.array(notificationPreferenceDtoSchema), "categories": z.array(z.object({ "category": pushNotificationCategorySchema, "mode": notificationModeSchema })) });

/**
 * Partial; every member is optional and the three are applied in order.
 */
export interface UpdateNotificationPreferencesBody {
  /**
   * Sets the master switch (stored as `all`/`all` with `alert` or `off`); a non-boolean answers 400.
   */
  enabled?: boolean;
  /**
   * Each entry must name a known type, an eligible transport for it and a known mode (400 otherwise).
   */
  preferences?: NotificationPreferenceDto[];
  /**
   * Deprecated APNs-only alias; each entry sets that category's `apns` mode.
   */
  categories?: Array<{
    category: PushNotificationCategory;
    mode: NotificationMode;
  }>;
}
export const updateNotificationPreferencesBodySchema: z.ZodType<UpdateNotificationPreferencesBody> = z.object({ "enabled": z.exactOptional(z.boolean()), "preferences": z.exactOptional(z.array(notificationPreferenceDtoSchema)), "categories": z.exactOptional(z.array(z.object({ "category": pushNotificationCategorySchema, "mode": notificationModeSchema }))) });

/**
 * Trimmed before comparison; anything else answers 400.
 */
export type ApnsEnvironment = "sandbox" | "production";
export const apnsEnvironmentSchema: z.ZodType<ApnsEnvironment> = z.enum(["sandbox", "production"]);

export interface RegisterLiveActivityPushTokenBody {
  /**
   * The opaque ActivityKit update token, trimmed; blank answers 400, longer than 4096 characters 400.
   */
  pushToken: string;
  environment: ApnsEnvironment;
  /**
   * Trimmed; blank answers 400, longer than 255 characters 400.
   */
  bundleId: string;
  /**
   * True when APNs started the activity remotely (push-to-start handoff); a non-boolean answers 400.
   */
  startedByPush?: boolean;
}
export const registerLiveActivityPushTokenBodySchema: z.ZodType<RegisterLiveActivityPushTokenBody> = z.object({ "pushToken": z.string(), "environment": apnsEnvironmentSchema, "bundleId": z.string(), "startedByPush": z.exactOptional(z.boolean()) });

export interface RegisterLiveActivityStartTokenBody {
  /**
   * The opaque push-to-start token, trimmed; blank or longer than 512 characters answers 400.
   */
  startToken: string;
  environment: ApnsEnvironment;
  /**
   * Trimmed; blank or longer than 255 characters answers 400.
   */
  bundleId: string;
  /**
   * Trimmed; longer than 128 characters answers 400; absent or blank means `OverlordActivityAttributes`.
   */
  activityType?: string;
  /**
   * Trimmed; longer than 64 characters answers 400; absent or blank stores null.
   */
  appVersion?: string;
}
export const registerLiveActivityStartTokenBodySchema: z.ZodType<RegisterLiveActivityStartTokenBody> = z.object({ "startToken": z.string(), "environment": apnsEnvironmentSchema, "bundleId": z.string(), "activityType": z.exactOptional(z.string()), "appVersion": z.exactOptional(z.string()) });

export interface RevokeLiveActivityStartTokenBody {
  /**
   * Trimmed; blank or longer than 512 characters answers 400.
   */
  startToken: string;
}
export const revokeLiveActivityStartTokenBodySchema: z.ZodType<RevokeLiveActivityStartTokenBody> = z.object({ "startToken": z.string() });

export interface RegisterDevicePushTokenBody {
  /**
   * The opaque APNs device token, trimmed; blank or longer than 512 characters answers 400.
   */
  deviceToken: string;
  environment: ApnsEnvironment;
  /**
   * Trimmed; blank or longer than 255 characters answers 400.
   */
  bundleId: string;
  /**
   * Trimmed; longer than 64 characters answers 400; absent or blank stores null.
   */
  appVersion?: string;
}
export const registerDevicePushTokenBodySchema: z.ZodType<RegisterDevicePushTokenBody> = z.object({ "deviceToken": z.string(), "environment": apnsEnvironmentSchema, "bundleId": z.string(), "appVersion": z.exactOptional(z.string()) });

export interface RevokeDevicePushTokenBody {
  /**
   * Trimmed; blank or longer than 512 characters answers 400.
   */
  deviceToken: string;
}
export const revokeDevicePushTokenBodySchema: z.ZodType<RevokeDevicePushTokenBody> = z.object({ "deviceToken": z.string() });

export type WebhookEventType = "mission.delivered" | "mission.status_changed" | "objective.completed" | "mission.blocked" | "mission.unblocked";
export const webhookEventTypeSchema: z.ZodType<WebhookEventType> = z.enum(["mission.delivered", "mission.status_changed", "objective.completed", "mission.blocked", "mission.unblocked"]);

export type WebhookPayloadMode = "thin" | "full";
export const webhookPayloadModeSchema: z.ZodType<WebhookPayloadMode> = z.enum(["thin", "full"]);

export type WebhookDisabledReason = "manual" | "failures" | "owner_revoked";
export const webhookDisabledReasonSchema: z.ZodType<WebhookDisabledReason> = z.enum(["manual", "failures", "owner_revoked"]);

export interface WebhookSubscriptionDto {
  id: string;
  /**
   * The project the subscription is limited to, or null for the whole workspace.
   */
  projectId: string | null;
  name: string;
  /**
   * The normalized endpoint URL.
   */
  endpointUrl: string;
  /**
   * Whether the endpoint host is internal (evaluated on read).
   */
  isInternal: boolean;
  /**
   * Stored types that are still known; unknown stored values are dropped.
   */
  eventTypes: WebhookEventType[];
  payloadMode: WebhookPayloadMode;
  enabled: boolean;
  disabledReason: WebhookDisabledReason | null;
  consecutiveFailures: number;
  lastSuccessAt: DateTime | null;
  lastFailureAt: DateTime | null;
  createdByWorkspaceUserId: string;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const webhookSubscriptionDtoSchema: z.ZodType<WebhookSubscriptionDto> = z.object({ "id": z.string(), "projectId": z.string().nullable(), "name": z.string(), "endpointUrl": z.string(), "isInternal": z.boolean(), "eventTypes": z.array(webhookEventTypeSchema), "payloadMode": webhookPayloadModeSchema, "enabled": z.boolean(), "disabledReason": webhookDisabledReasonSchema.nullable(), "consecutiveFailures": z.int().min(0), "lastSuccessAt": dateTimeSchema.nullable(), "lastFailureAt": dateTimeSchema.nullable(), "createdByWorkspaceUserId": z.string(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export type WebhookSubscriptionList = WebhookSubscriptionDto[];
export const webhookSubscriptionListSchema: z.ZodType<WebhookSubscriptionList> = z.array(webhookSubscriptionDtoSchema);

export interface CreateWebhookSubscriptionBody {
  /**
   * The owning workspace when `projectId` is absent (400 when both are missing).
   */
  workspaceId?: string;
  /**
   * Limits the subscription to one project and selects its workspace. An unknown project answers 400; a project outside the caller's authorized workspaces 404. Null or absent subscribes the whole workspace.
   */
  projectId?: string | null;
  /**
   * Trimmed; blank or absent answers 400.
   */
  name: string;
  /**
   * Absolute URL; unparseable answers 400, as does `http://` to a host that is not internal.
   */
  endpointUrl: string;
  /**
   * Non-empty; duplicates are removed; an unknown type answers 400.
   */
  eventTypes: WebhookEventType[];
  /**
   * Defaults to `full` for an internal host and `thin` otherwise; another value answers 400.
   */
  payloadMode?: WebhookPayloadMode | null;
}
export const createWebhookSubscriptionBodySchema: z.ZodType<CreateWebhookSubscriptionBody> = z.object({ "workspaceId": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string().nullable()), "name": z.string(), "endpointUrl": z.string(), "eventTypes": z.array(webhookEventTypeSchema).min(1), "payloadMode": z.exactOptional(webhookPayloadModeSchema.nullable()) });

/**
 * Partial update; omitted members are unchanged.
 */
export interface UpdateWebhookSubscriptionBody {
  /**
   * Trimmed; blank answers 400.
   */
  name?: string;
  /**
   * Validated as on create.
   */
  endpointUrl?: string;
  /**
   * A project of the subscription's workspace (400 otherwise), or null to widen it to the whole workspace.
   */
  projectId?: string | null;
  /**
   * Replaces the list; validated as on create.
   */
  eventTypes?: WebhookEventType[];
  payloadMode?: WebhookPayloadMode;
  /**
   * Not type-checked; any truthy value enables.
   */
  enabled?: boolean;
}
export const updateWebhookSubscriptionBodySchema: z.ZodType<UpdateWebhookSubscriptionBody> = z.object({ "name": z.exactOptional(z.string()), "endpointUrl": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string().nullable()), "eventTypes": z.exactOptional(z.array(webhookEventTypeSchema).min(1)), "payloadMode": z.exactOptional(webhookPayloadModeSchema), "enabled": z.exactOptional(z.boolean()) });

export interface CreateWebhookSubscriptionResultDto {
  subscription: WebhookSubscriptionDto;
  /**
   * The HMAC signing secret, `whsec_…`; shown only here.
   */
  secret: string;
}
export const createWebhookSubscriptionResultDtoSchema: z.ZodType<CreateWebhookSubscriptionResultDto> = z.object({ "subscription": webhookSubscriptionDtoSchema, "secret": z.string() });

export interface WebhookTestResultDto {
  ok: true;
  /**
   * The endpoint's 2xx status.
   */
  responseStatus: number;
}
export const webhookTestResultDtoSchema: z.ZodType<WebhookTestResultDto> = z.object({ "ok": z.literal(true), "responseStatus": z.int() });

export interface WebhookDeliveryAttemptDto {
  id: string;
  outboxMessageId: string;
  /**
   * A webhook event type, or `webhook.ping` for a test delivery.
   */
  eventType: string;
  attemptNumber: number;
  responseStatus: number | null;
  /**
   * A redacted prefix of the endpoint's response body (null for test pings).
   */
  responseSnippet: string | null;
  error: string | null;
  durationMs: number | null;
  attemptedAt: DateTime;
}
export const webhookDeliveryAttemptDtoSchema: z.ZodType<WebhookDeliveryAttemptDto> = z.object({ "id": z.string(), "outboxMessageId": z.string(), "eventType": z.string(), "attemptNumber": z.int().min(1), "responseStatus": z.int().nullable(), "responseSnippet": z.string().nullable(), "error": z.string().nullable(), "durationMs": z.int().min(0).nullable(), "attemptedAt": dateTimeSchema });

export interface WebhookDeliveryAttemptsPageDto {
  attempts: WebhookDeliveryAttemptDto[];
  hasMore: boolean;
}
export const webhookDeliveryAttemptsPageDtoSchema: z.ZodType<WebhookDeliveryAttemptsPageDto> = z.object({ "attempts": z.array(webhookDeliveryAttemptDtoSchema), "hasMore": z.boolean() });

export type StorageBucketKey = "user-images" | "workspace-images" | "organization-images" | "attachments";
export const storageBucketKeySchema: z.ZodType<StorageBucketKey> = z.enum(["user-images", "workspace-images", "organization-images", "attachments"]);

/**
 * The image's raw bytes as the request body. The request `Content-Type` (parameters ignored, case insensitive) must be `image/png`, `image/jpeg`, `image/gif` or `image/webp`. An empty body answers 400.
 */
export type RawImageUploadBody = BinaryBody;
export const rawImageUploadBodySchema: z.ZodType<RawImageUploadBody> = binaryBodySchema;

/**
 * The stored object's raw bytes.
 */
export type BinaryDownload = BinaryBody;
export const binaryDownloadSchema: z.ZodType<BinaryDownload> = binaryBodySchema;

export interface StoredImageDto {
  /**
   * The metadata row id (for an organization image, an id with no row).
   */
  id: string;
  bucketKey: StorageBucketKey;
  /**
   * The backend key: `user-images/<profile id>/<id><ext>`, `workspace-files/<workspace id>/images/<id><ext>` or `organization-files/<organization id>/images/<id><ext>`.
   */
  storageKey: string;
  filename: string;
  contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  sizeBytes: number;
  /**
   * Server-relative `/api/storage/<bucket>/<percent-encoded key>`.
   */
  url: string;
  createdAt: DateTime;
}
export const storedImageDtoSchema: z.ZodType<StoredImageDto> = z.object({ "id": z.string(), "bucketKey": storageBucketKeySchema, "storageKey": z.string(), "filename": z.string(), "contentType": z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]), "sizeBytes": z.int().min(1).max(8388608), "url": z.string(), "createdAt": dateTimeSchema });

export type EntityChangeOperation = "insert" | "update" | "delete" | "restore";
export const entityChangeOperationSchema: z.ZodType<EntityChangeOperation> = z.enum(["insert", "update", "delete", "restore"]);

export interface EntityChangeDto {
  seq: number;
  workspaceId: string;
  /**
   * Open vocabulary (`mission`, `objective`, `project`, `workspace_user`, …).
   */
  entityType: string;
  entityId: string;
  operation: EntityChangeOperation;
  projectId: string | null;
  missionId: string | null;
  objectiveId: string | null;
  /**
   * Column names parsed from `changed_fields_json`; empty when none were recorded.
   */
  changedFields: string[];
  occurredAt: DateTime;
}
export const entityChangeDtoSchema: z.ZodType<EntityChangeDto> = z.object({ "seq": z.int().min(1), "workspaceId": z.string(), "entityType": z.string(), "entityId": z.string(), "operation": entityChangeOperationSchema, "projectId": z.string().nullable(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "changedFields": z.array(z.string()), "occurredAt": dateTimeSchema });

export interface SyncChangesDto {
  changes: EntityChangeDto[];
  /**
   * The next `after`; the last returned `seq` when `hasMore`, else the scanned high-water mark.
   */
  cursor: number;
  hasMore: boolean;
}
export const syncChangesDtoSchema: z.ZodType<SyncChangesDto> = z.object({ "changes": z.array(entityChangeDtoSchema), "cursor": z.int().min(0), "hasMore": z.boolean() });

export interface RealtimeChangeEventDto {
  type: "change";
  changes: EntityChangeDto[];
  cursor: number;
}
export const realtimeChangeEventDtoSchema: z.ZodType<RealtimeChangeEventDto> = z.object({ "type": z.literal("change"), "changes": z.array(entityChangeDtoSchema), "cursor": z.int().min(0) });

/**
 * The JSON `data` of one stream event. The stream itself is `text/event-stream` framing (`event:`, `id:`, `data:` lines and `: ping` comments), not JSON.
 */
export type RealtimeStreamEvent = {
  type: "hello";
  cursor: number;
} | RealtimeChangeEventDto | {
  type: "refresh";
};
export const realtimeStreamEventSchema: z.ZodType<RealtimeStreamEvent> = z.union([z.object({ "type": z.literal("hello"), "cursor": z.int().min(0) }), realtimeChangeEventDtoSchema, z.object({ "type": z.literal("refresh") })]);

export type OAuthScope = "overlord.workspace.read" | "overlord.mission.read" | "overlord.mission.write" | "overlord.session.write";
export const oAuthScopeSchema: z.ZodType<OAuthScope> = z.enum(["overlord.workspace.read", "overlord.mission.read", "overlord.mission.write", "overlord.session.write"]);

export interface OAuthProtectedResourceMetadata {
  /**
   * `<base URL>/mcp`.
   */
  resource: string;
  /**
   * The issuer, `<base URL>`.
   */
  authorization_servers: string[];
  bearer_methods_supported: Array<"header">;
  resource_documentation: string;
  scopes_supported: OAuthScope[];
}
export const oAuthProtectedResourceMetadataSchema: z.ZodType<OAuthProtectedResourceMetadata> = z.object({ "resource": z.string(), "authorization_servers": z.array(z.string()), "bearer_methods_supported": z.array(z.literal("header")), "resource_documentation": z.string(), "scopes_supported": z.array(oAuthScopeSchema) });

export interface OAuthAuthorizationServerMetadata {
  issuer: string;
  /**
   * `<base URL>/oauth/approve` (the web approval page).
   */
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: Array<"code">;
  grant_types_supported: Array<"authorization_code">;
  code_challenge_methods_supported: Array<"S256">;
  token_endpoint_auth_methods_supported: Array<"none">;
  scopes_supported: OAuthScope[];
}
export const oAuthAuthorizationServerMetadataSchema: z.ZodType<OAuthAuthorizationServerMetadata> = z.object({ "issuer": z.string(), "authorization_endpoint": z.string(), "token_endpoint": z.string(), "registration_endpoint": z.string(), "revocation_endpoint": z.string(), "response_types_supported": z.array(z.literal("code")), "grant_types_supported": z.array(z.literal("authorization_code")), "code_challenge_methods_supported": z.array(z.literal("S256")), "token_endpoint_auth_methods_supported": z.array(z.literal("none")), "scopes_supported": z.array(oAuthScopeSchema) });

/**
 * An RFC 6749 error. `error` is an OAuth error code, not a message.
 */
export interface OAuthErrorBody {
  error: string;
  error_description: string;
}
export const oAuthErrorBodySchema: z.ZodType<OAuthErrorBody> = z.object({ "error": z.string(), "error_description": z.string() });

export interface OAuthClientRegistrationBody {
  /**
   * Entries that are not strings, not URLs, or not `https:` (or `http:` to `localhost` / `127.0.0.1`) are dropped; none left answers 400 `invalid_redirect_uri`.
   */
  redirect_uris: string[];
  /**
   * Trimmed and cut to 120 characters; absent or blank becomes `MCP client`.
   */
  client_name?: string;
}
export const oAuthClientRegistrationBodySchema: z.ZodType<OAuthClientRegistrationBody> = z.object({ "redirect_uris": z.array(z.string()), "client_name": z.exactOptional(z.string()) });

export interface OAuthClientRegistrationDto {
  /**
   * `ovlc_<payload>.<signature>`.
   */
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: Array<"authorization_code">;
  response_types: Array<"code">;
  token_endpoint_auth_method: "none";
  /**
   * Unix seconds.
   */
  client_id_issued_at: number;
}
export const oAuthClientRegistrationDtoSchema: z.ZodType<OAuthClientRegistrationDto> = z.object({ "client_id": z.string(), "client_name": z.string(), "redirect_uris": z.array(z.string()), "grant_types": z.array(z.literal("authorization_code")), "response_types": z.array(z.literal("code")), "token_endpoint_auth_method": z.literal("none"), "client_id_issued_at": z.int() });

/**
 * Every value is read as a trimmed string; a missing one is empty.
 */
export interface OAuthTokenRequestBody {
  grant_type: "authorization_code";
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
  /**
   * Must equal the authorization's resource (`<base URL>/mcp`); an absent value does not match.
   */
  resource: string;
}
export const oAuthTokenRequestBodySchema: z.ZodType<OAuthTokenRequestBody> = z.object({ "grant_type": z.literal("authorization_code"), "code": z.string(), "client_id": z.string(), "redirect_uri": z.string(), "code_verifier": z.string(), "resource": z.string() });

export interface OAuthTokenResponseDto {
  /**
   * An `out_…` user token.
   */
  access_token: string;
  token_type: "Bearer";
  expires_in: 7776000;
  /**
   * The granted scopes, space-separated.
   */
  scope: string;
}
export const oAuthTokenResponseDtoSchema: z.ZodType<OAuthTokenResponseDto> = z.object({ "access_token": z.string(), "token_type": z.literal("Bearer"), "expires_in": z.literal(7776000), "scope": z.string() });

export interface OAuthRevokeBody {
  /**
   * The `out_…` token to revoke.
   */
  token?: string;
}
export const oAuthRevokeBodySchema: z.ZodType<OAuthRevokeBody> = z.object({ "token": z.exactOptional(z.string()) });

/**
 * The OAuth authorization request parameters (each read from the body, else the query string, as a trimmed string).
 */
export interface OAuthAuthorizationRequestBody {
  /**
   * Anything else answers 400 `unsupported_response_type`.
   */
  response_type?: "code";
  /**
   * A client id from registration; otherwise 400 `invalid_client`.
   */
  client_id?: string;
  /**
   * One of the client's redirect URIs; otherwise 400 `invalid_request`.
   */
  redirect_uri?: string;
  code_challenge_method?: "S256";
  /**
   * Required (400 `invalid_request`).
   */
  code_challenge?: string;
  /**
   * Defaults to `<base URL>/mcp`; any other value answers 400 `invalid_target`.
   */
  resource?: string;
  /**
   * Space-separated; defaults to every scope; an unknown scope answers 400 `invalid_scope`.
   */
  scope?: string;
  /**
   * Echoed back.
   */
  state?: string;
}
const oAuthAuthorizationRequestBodyShape = { "response_type": z.exactOptional(z.literal("code")), "client_id": z.exactOptional(z.string()), "redirect_uri": z.exactOptional(z.string()), "code_challenge_method": z.exactOptional(z.literal("S256")), "code_challenge": z.exactOptional(z.string()), "resource": z.exactOptional(z.string()), "scope": z.exactOptional(z.string()), "state": z.exactOptional(z.string()) };
export const oAuthAuthorizationRequestBodySchema: z.ZodType<OAuthAuthorizationRequestBody> = z.object(oAuthAuthorizationRequestBodyShape);

export interface OAuthConsentWorkspaceDto {
  workspaceId: string;
  workspaceUserId: string;
  slug: string;
  name: string;
  kind: string;
  roleKeys: string[];
}
export const oAuthConsentWorkspaceDtoSchema: z.ZodType<OAuthConsentWorkspaceDto> = z.object({ "workspaceId": z.string(), "workspaceUserId": z.string(), "slug": z.string(), "name": z.string(), "kind": z.string(), "roleKeys": z.array(z.string()) });

export interface OAuthConsentOrganizationDto {
  id: string;
  name: string;
  workspaces: OAuthConsentWorkspaceDto[];
}
export const oAuthConsentOrganizationDtoSchema: z.ZodType<OAuthConsentOrganizationDto> = z.object({ "id": z.string(), "name": z.string(), "workspaces": z.array(oAuthConsentWorkspaceDtoSchema) });

export interface OAuthAuthorizationRequestInfoDto {
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  resource: string;
  scopes: OAuthScope[];
  /**
   * The request's `state`, or empty.
   */
  state: string;
  /**
   * Every organization and workspace in which the profile has an active membership.
   */
  organizations: OAuthConsentOrganizationDto[];
}
export const oAuthAuthorizationRequestInfoDtoSchema: z.ZodType<OAuthAuthorizationRequestInfoDto> = z.object({ "clientName": z.string(), "redirectUri": z.string(), "redirectHost": z.string(), "resource": z.string(), "scopes": z.array(oAuthScopeSchema), "state": z.string(), "organizations": z.array(oAuthConsentOrganizationDtoSchema) });

/**
 * The authorization request parameters plus the decision and consent.
 */
export type OAuthApproveBody = OAuthAuthorizationRequestBody & {
  /**
   * Anything else answers 400 `invalid_request`.
   */
  decision: "approve" | "deny";
  /**
   * Required when the profile belongs to several organizations (400 otherwise).
   */
  organizationId?: string;
  /**
   * Only `true` selects all current and future workspaces.
   */
  allWorkspaces?: boolean;
  /**
   * Live workspaces of the organization (400 otherwise); required unless `allWorkspaces` or the organization has one workspace.
   */
  workspaceIds?: string[];
};
export const oAuthApproveBodySchema: z.ZodType<OAuthApproveBody> = z.object({ ...oAuthAuthorizationRequestBodyShape, "decision": z.enum(["approve", "deny"]), "organizationId": z.exactOptional(z.string()), "allWorkspaces": z.exactOptional(z.boolean()), "workspaceIds": z.exactOptional(z.array(z.string())) });

export interface OAuthApproveResultDto {
  /**
   * The client's redirect URI with `code` and `state`, or with `error=access_denied`, `error_description` and `state`.
   */
  redirectTo: string;
}
export const oAuthApproveResultDtoSchema: z.ZodType<OAuthApproveResultDto> = z.object({ "redirectTo": z.string() });

export interface McpServerInfoDto {
  name: "overlord";
  /**
   * The MCP protocol revision, currently `2025-11-25`.
   */
  protocolVersion: string;
  /**
   * `<request protocol>://<Host>/mcp`.
   */
  endpoint: string;
  capabilities: {
    /**
     * Tool definitions as `tools/list` returns them (generated tool catalog).
     */
    tools: JsonValue[];
    /**
     * Widget resources as `resources/list` returns them.
     */
    resources: JsonValue[];
  };
  instructions: string;
}
export const mcpServerInfoDtoSchema: z.ZodType<McpServerInfoDto> = z.object({ "name": z.literal("overlord"), "protocolVersion": z.string(), "endpoint": z.string(), "capabilities": z.object({ "tools": z.array(jsonValueSchema), "resources": z.array(jsonValueSchema) }), "instructions": z.string() });

export type JsonRpcId = string | number | null;
export const jsonRpcIdSchema: z.ZodType<JsonRpcId> = z.union([z.string(), z.number(), z.null()]);

/**
 * A JSON-RPC 2.0 request or notification. A non-object item is answered `-32600`.
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonValue;
}
export const jsonRpcRequestSchema: z.ZodType<JsonRpcRequest> = z.object({ "jsonrpc": z.literal("2.0"), "id": z.exactOptional(jsonRpcIdSchema), "method": z.string(), "params": z.exactOptional(jsonValueSchema) });

/**
 * A JSON-RPC 2.0 result or error; `id` is null when the request had none.
 */
export type JsonRpcResponse = ({
  jsonrpc: "2.0";
  id?: JsonRpcId;
  result: JsonValue;
}) | ({
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: -32600 | -32601 | -32000;
    message: string;
  };
});
export const jsonRpcResponseSchema: z.ZodType<JsonRpcResponse> = z.union([z.strictObject({ "jsonrpc": z.literal("2.0"), "id": z.exactOptional(jsonRpcIdSchema), "result": jsonValueSchema }), z.strictObject({ "jsonrpc": z.literal("2.0"), "id": jsonRpcIdSchema, "error": z.object({ "code": z.literal([-32600, -32601, -32000]), "message": z.string() }) })]);

export type AccountConnectionProvider = "knowledgebase" | "everhour" | "github";
export const accountConnectionProviderSchema: z.ZodType<AccountConnectionProvider> = z.enum(["knowledgebase", "everhour", "github"]);

export type AccountConnectionScope = "organization" | "profile";
export const accountConnectionScopeSchema: z.ZodType<AccountConnectionScope> = z.enum(["organization", "profile"]);

export type AccountConnectionCredentialKind = "oauth" | "api_key";
export const accountConnectionCredentialKindSchema: z.ZodType<AccountConnectionCredentialKind> = z.enum(["oauth", "api_key"]);

export type AccountConnectionState = "pending" | "connected" | "reauthorization_required" | "disconnected";
export const accountConnectionStateSchema: z.ZodType<AccountConnectionState> = z.enum(["pending", "connected", "reauthorization_required", "disconnected"]);

export type AccountConnectionAssistantWriteScope = "per_request" | "all_workspaces";
export const accountConnectionAssistantWriteScopeSchema: z.ZodType<AccountConnectionAssistantWriteScope> = z.enum(["per_request", "all_workspaces"]);

export type AccountConnectionUnavailableReason = "not_offered_on_edition" | "not_configured" | "encryption_not_configured";
export const accountConnectionUnavailableReasonSchema: z.ZodType<AccountConnectionUnavailableReason> = z.enum(["not_offered_on_edition", "not_configured", "encryption_not_configured"]);

/**
 * Non-secret connection metadata; credentials never leave the connections module.
 */
export interface AccountConnectionDto {
  id: string;
  provider: AccountConnectionProvider;
  /**
   * Null exactly when `scope` is `profile`.
   */
  organizationId: string | null;
  scope: AccountConnectionScope;
  credentialKind: AccountConnectionCredentialKind;
  /**
   * The upstream account, when any of its fields is known.
   */
  account: {
    id: string | null;
    label: string | null;
    avatarUrl: string | null;
  } | null;
  /**
   * Granted OAuth scopes; empty for API keys.
   */
  scopes: string[];
  lastValidatedAt: DateTime | null;
  serverUrl: string;
  state: AccountConnectionState;
  /**
   * Provider workspaces the grant can read (Knowledgebase slugs).
   */
  authorizedWorkspaces: string[];
  /**
   * Always `per_request` for providers other than `knowledgebase`.
   */
  assistantWriteScope: AccountConnectionAssistantWriteScope;
  toolPolicyVersion: number;
  lastErrorCode: string | null;
  connectedAt: DateTime | null;
  updatedAt: DateTime;
  revision: number;
}
export const accountConnectionDtoSchema: z.ZodType<AccountConnectionDto> = z.object({ "id": z.string(), "provider": accountConnectionProviderSchema, "organizationId": z.string().nullable(), "scope": accountConnectionScopeSchema, "credentialKind": accountConnectionCredentialKindSchema, "account": z.object({ "id": z.string().nullable(), "label": z.string().nullable(), "avatarUrl": z.string().nullable() }).nullable(), "scopes": z.array(z.string()), "lastValidatedAt": dateTimeSchema.nullable(), "serverUrl": z.string(), "state": accountConnectionStateSchema, "authorizedWorkspaces": z.array(z.string()), "assistantWriteScope": accountConnectionAssistantWriteScopeSchema, "toolPolicyVersion": z.int(), "lastErrorCode": z.string().nullable(), "connectedAt": dateTimeSchema.nullable(), "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export interface AccountConnectionProviderStatusDto {
  provider: AccountConnectionProvider;
  scope: AccountConnectionScope;
  credentialKind: AccountConnectionCredentialKind;
  available: boolean;
  reason: AccountConnectionUnavailableReason | null;
}
export const accountConnectionProviderStatusDtoSchema: z.ZodType<AccountConnectionProviderStatusDto> = z.object({ "provider": accountConnectionProviderSchema, "scope": accountConnectionScopeSchema, "credentialKind": accountConnectionCredentialKindSchema, "available": z.boolean(), "reason": accountConnectionUnavailableReasonSchema.nullable() });

export interface AccountConnectionListResponse {
  items: AccountConnectionDto[];
  /**
   * Present only with `scope=all`; Knowledgebase first, then each profile provider.
   */
  providers?: AccountConnectionProviderStatusDto[];
}
export const accountConnectionListResponseSchema: z.ZodType<AccountConnectionListResponse> = z.object({ "items": z.array(accountConnectionDtoSchema), "providers": z.exactOptional(z.array(accountConnectionProviderStatusDtoSchema)) });

export interface StartAccountConnectionBody {
  provider: AccountConnectionProvider;
  /**
   * Where the callback sends the browser; anything else answers 400 `invalid_request`.
   */
  returnTo: "mobile" | "web";
  /**
   * GitHub with `returnTo: web` only (400 otherwise): a relative web path starting with `/`, not `//`, without backslashes or control characters, at most 512 characters. Defaults to `/settings/connections`. Ignored by the Knowledgebase path.
   */
  returnPath?: string | null;
}
export const startAccountConnectionBodySchema: z.ZodType<StartAccountConnectionBody> = z.object({ "provider": accountConnectionProviderSchema, "returnTo": z.enum(["mobile", "web"]), "returnPath": z.exactOptional(z.string().max(512).nullable()) });

export interface StartAccountConnectionResponse {
  connectionId: string;
  /**
   * The provider's authorization URL with state and PKCE challenge.
   */
  authorizeUrl: string;
  expiresAt: DateTime;
}
export const startAccountConnectionResponseSchema: z.ZodType<StartAccountConnectionResponse> = z.object({ "connectionId": z.string(), "authorizeUrl": z.string(), "expiresAt": dateTimeSchema });

export interface SetAccountConnectionApiKeyBody {
  /**
   * An API-key provider offered here (`everhour`); anything else answers 404 `provider_not_available`.
   */
  provider: AccountConnectionProvider;
  /**
   * Trimmed; blank or longer than 512 characters answers 400 `invalid_request`.
   */
  apiKey: string;
}
export const setAccountConnectionApiKeyBodySchema: z.ZodType<SetAccountConnectionApiKeyBody> = z.object({ "provider": accountConnectionProviderSchema, "apiKey": z.string().max(512) });

export interface UpdateAccountConnectionBody {
  expectedRevision: number;
  assistantWriteScope: AccountConnectionAssistantWriteScope;
}
export const updateAccountConnectionBodySchema: z.ZodType<UpdateAccountConnectionBody> = z.strictObject({ "expectedRevision": z.int().min(1), "assistantWriteScope": accountConnectionAssistantWriteScopeSchema });

export interface KnowledgebaseClientMetadataDto {
  /**
   * This document's own URL.
   */
  client_id: string;
  client_name: "Overlord";
  client_uri: string;
  redirect_uris: string[];
  grant_types: Array<"authorization_code" | "refresh_token">;
  response_types: Array<"code">;
  token_endpoint_auth_method: "none";
  scope: string;
}
export const knowledgebaseClientMetadataDtoSchema: z.ZodType<KnowledgebaseClientMetadataDto> = z.object({ "client_id": z.string(), "client_name": z.literal("Overlord"), "client_uri": z.string(), "redirect_uris": z.array(z.string()), "grant_types": z.array(z.enum(["authorization_code", "refresh_token"])), "response_types": z.array(z.literal("code")), "token_endpoint_auth_method": z.literal("none"), "scope": z.string() });

/**
 * Closed four-value entry state machine (contract/conformance.md).
 */
export type RunQueueEntryState = "waiting" | "blocked" | "dispatched" | "running";
export const runQueueEntryStateSchema: z.ZodType<RunQueueEntryState> = z.enum(["waiting", "blocked", "dispatched", "running"]);

/**
 * Why a `waiting` entry is not eligible right now; each clears on its own.
 */
export type RunQueueWaitingReason = "mission_busy" | "resource_disconnected" | "retry_pending";
export const runQueueWaitingReasonSchema: z.ZodType<RunQueueWaitingReason> = z.enum(["mission_busy", "resource_disconnected", "retry_pending"]);

export type ExecutionRequestStatus = "queued" | "claimed" | "launching" | "launched" | "failed" | "cleared" | "cancelled" | "expired";
export const executionRequestStatusSchema: z.ZodType<ExecutionRequestStatus> = z.enum(["queued", "claimed", "launching", "launched", "failed", "cleared", "cancelled", "expired"]);

/**
 * One queue entry (packages/core/service/run-queue.ts `entryDto`).
 */
export interface RunQueueEntryDto {
  id: string;
  queueId: string;
  /**
   * 1-based rank within the queue (not the stored position).
   */
  position: number;
  state: RunQueueEntryState;
  /**
   * What a human must fix; set while `blocked`.
   */
  blockedReason: string | null;
  waitingReason: RunQueueWaitingReason | null;
  waitingOnObjectiveId: string | null;
  waitingOnObjectiveDisplayId: string | null;
  /**
   * Dispatch attempts already spent; the ceiling is 3.
   */
  attemptCount: number;
  objectiveId: string;
  /**
   * `<mission display id>.<objective key>`.
   */
  objectiveDisplayId: string;
  objectiveTitle: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  assignedAgent: string | null;
  /**
   * The objective's resource key, trimmed; blank is null.
   */
  resourceKey: string | null;
  enqueuedAt: DateTime;
  executionRequestId: string | null;
  /**
   * State diagnostics of the linked execution request; null when the entry links none or the request is deleted.
   */
  executionRequest: {
    status: ExecutionRequestStatus;
    lastError: string | null;
    claimedByDeviceId: string | null;
    claimedByExecutionTargetId: string | null;
    executionTargetId: string | null;
    createdAt: DateTime;
    claimedAt: DateTime | null;
    launchStartedAt: DateTime | null;
    launchCompletedAt: DateTime | null;
    updatedAt: DateTime;
  } | null;
  /**
   * A detected impossible queue/request state pair, if any.
   */
  diagnosticCode: ("terminal_request_dispatched" | "running_without_live_request") | null;
}
export const runQueueEntryDtoSchema: z.ZodType<RunQueueEntryDto> = z.object({ "id": z.string(), "queueId": z.string(), "position": z.int().min(1), "state": runQueueEntryStateSchema, "blockedReason": z.string().nullable(), "waitingReason": runQueueWaitingReasonSchema.nullable(), "waitingOnObjectiveId": z.string().nullable(), "waitingOnObjectiveDisplayId": z.string().nullable(), "attemptCount": z.int().min(0), "objectiveId": z.string(), "objectiveDisplayId": z.string(), "objectiveTitle": z.string().nullable(), "missionId": z.string(), "missionDisplayId": z.string(), "missionTitle": z.string(), "assignedAgent": z.string().nullable(), "resourceKey": z.string().nullable(), "enqueuedAt": dateTimeSchema, "executionRequestId": z.string().nullable(), "executionRequest": z.object({ "status": executionRequestStatusSchema, "lastError": z.string().nullable(), "claimedByDeviceId": z.string().nullable(), "claimedByExecutionTargetId": z.string().nullable(), "executionTargetId": z.string().nullable(), "createdAt": dateTimeSchema, "claimedAt": dateTimeSchema.nullable(), "launchStartedAt": dateTimeSchema.nullable(), "launchCompletedAt": dateTimeSchema.nullable(), "updatedAt": dateTimeSchema }).nullable(), "diagnosticCode": z.enum(["terminal_request_dispatched", "running_without_live_request"]).nullable() });

export interface RunQueueDto {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  /**
   * The mission of a mission-scoped queue; null for a free-standing queue.
   */
  missionId: string | null;
  missionDisplayId: string | null;
  paused: boolean;
  /**
   * Stored sort position (multiples of 1000).
   */
  position: number;
  entries: RunQueueEntryDto[];
  /**
   * The first `dispatched` or `running` entry, or null.
   */
  running: RunQueueEntryDto | null;
}
export const runQueueDtoSchema: z.ZodType<RunQueueDto> = z.object({ "id": z.string(), "projectId": z.string(), "name": z.string(), "isDefault": z.boolean(), "missionId": z.string().nullable(), "missionDisplayId": z.string().nullable(), "paused": z.boolean(), "position": z.number(), "entries": z.array(runQueueEntryDtoSchema), "running": runQueueEntryDtoSchema.nullable() });

export interface ProjectRunQueuesDto {
  projectId: string;
  queues: RunQueueDto[];
}
export const projectRunQueuesDtoSchema: z.ZodType<ProjectRunQueuesDto> = z.object({ "projectId": z.string(), "queues": z.array(runQueueDtoSchema) });

export interface CreateRunQueueBody {
  /**
   * Trimmed; blank or absent answers 400 `invalid_queue_name`. Not type-checked: a non-string answers 500. Unique per project case-insensitively (a duplicate answers 409 from the database constraint).
   */
  name: string;
  /**
   * Mission UUID of this project for a mission-scoped queue.
   */
  missionId?: string | null;
}
export const createRunQueueBodySchema: z.ZodType<CreateRunQueueBody> = z.object({ "name": z.string(), "missionId": z.exactOptional(z.string().nullable()) });

export interface ReorderProjectRunQueuesBody {
  orderedQueueIds: string[];
}
export const reorderProjectRunQueuesBodySchema: z.ZodType<ReorderProjectRunQueuesBody> = z.object({ "orderedQueueIds": z.array(z.string()) });

export interface EnqueueRunQueueEntryBody {
  /**
   * Objective UUID of an objective in this project; anything else (absent, a display id, another project's objective) answers 404 `objective_not_found`.
   */
  objectiveId: string;
  /**
   * A live queue of this project (404 `run_queue_not_found` otherwise).
   */
  queueId?: string;
  /**
   * Place the entry directly after this entry of the destination queue (404 `run_queue_entry_not_found` otherwise).
   */
  afterEntryId?: string;
  /**
   * Explicit stored position, used when `afterEntryId` is absent; not validated.
   */
  position?: number;
  /**
   * `false` queues only this objective; default true.
   */
  cascade?: boolean;
}
export const enqueueRunQueueEntryBodySchema: z.ZodType<EnqueueRunQueueEntryBody> = z.object({ "objectiveId": z.string(), "queueId": z.exactOptional(z.string()), "afterEntryId": z.exactOptional(z.string()), "position": z.exactOptional(z.number()), "cascade": z.exactOptional(z.boolean()) });

export interface UpdateRunQueueBody {
  /**
   * Trimmed; blank answers 400 `invalid_queue_name`; a non-string answers 500.
   */
  name?: string;
  /**
   * Not type-checked; on SQLite any truthy value pauses.
   */
  paused?: boolean;
}
export const updateRunQueueBodySchema: z.ZodType<UpdateRunQueueBody> = z.object({ "name": z.exactOptional(z.string()), "paused": z.exactOptional(z.boolean()) });

export interface DeleteRunQueueBody {
  /**
   * Destination queue UUID for the queue's remaining entries.
   */
  moveEntriesTo?: string;
}
export const deleteRunQueueBodySchema: z.ZodType<DeleteRunQueueBody> = z.object({ "moveEntriesTo": z.exactOptional(z.string()) });

export interface ReorderRunQueueBody {
  orderedEntryIds: string[];
}
export const reorderRunQueueBodySchema: z.ZodType<ReorderRunQueueBody> = z.object({ "orderedEntryIds": z.array(z.string()) });

export interface UpdateRunQueueEntryBody {
  /**
   * `true` retries the entry instead of moving it.
   */
  retry?: boolean;
  queueId?: string;
  afterEntryId?: string;
  position?: number;
}
export const updateRunQueueEntryBodySchema: z.ZodType<UpdateRunQueueEntryBody> = z.object({ "retry": z.exactOptional(z.boolean()), "queueId": z.exactOptional(z.string()), "afterEntryId": z.exactOptional(z.string()), "position": z.exactOptional(z.number()) });

export interface DeleteRunQueueEntryBody {
  /**
   * Only `true` forces; any other value is a plain removal.
   */
  force?: boolean;
}
export const deleteRunQueueEntryBodySchema: z.ZodType<DeleteRunQueueEntryBody> = z.object({ "force": z.exactOptional(z.boolean()) });

export interface RunQueueRemovalDto {
  removed: true;
  projectId: string;
}
export const runQueueRemovalDtoSchema: z.ZodType<RunQueueRemovalDto> = z.object({ "removed": z.literal(true), "projectId": z.string() });

export interface RunQueueEntryRemovalDto {
  removed: true;
  forced: boolean;
  objectiveId: string;
  /**
   * The entry's state at removal; `dispatched` or `running` means it was in flight.
   */
  previousState: RunQueueEntryState;
  /**
   * A forced removal reset a stuck `launching` objective to `draft`.
   */
  objectiveReset: boolean;
  /**
   * Active execution requests a forced removal cleared (0 otherwise).
   */
  clearedExecutionRequests: number;
  /**
   * Non-default queue retired because this removal emptied it.
   */
  removedEmptyQueueId: string | null;
}
export const runQueueEntryRemovalDtoSchema: z.ZodType<RunQueueEntryRemovalDto> = z.object({ "removed": z.literal(true), "forced": z.boolean(), "objectiveId": z.string(), "previousState": runQueueEntryStateSchema, "objectiveReset": z.boolean(), "clearedExecutionRequests": z.int().min(0), "removedEmptyQueueId": z.string().nullable() });

/**
 * A runner instance registered against an execution target (`listRunnerRegistrations`).
 */
export interface ExecutionTargetRunnerRegistrationDto {
  id: string;
  executionTargetId: string;
  runnerInstanceId: string;
  relation: "native" | "adopted";
  label: string | null;
  runnerVersion: string | null;
  /**
   * Agent keys from the stored JSON list; non-strings are dropped and malformed JSON reads as empty.
   */
  supportedAgents: string[];
  /**
   * Open vocabulary reported by the runner.
   */
  health: string;
  lastHeartbeatAt: DateTime | null;
  lastErrorCode: string | null;
}
export const executionTargetRunnerRegistrationDtoSchema: z.ZodType<ExecutionTargetRunnerRegistrationDto> = z.object({ "id": z.string(), "executionTargetId": z.string(), "runnerInstanceId": z.string(), "relation": z.enum(["native", "adopted"]), "label": z.string().nullable(), "runnerVersion": z.string().nullable(), "supportedAgents": z.array(z.string()), "health": z.string(), "lastHeartbeatAt": dateTimeSchema.nullable(), "lastErrorCode": z.string().nullable() });

/**
 * Safe workspace-settings projection of an execution target (`listWorkspaceExecutionTargets`).
 */
export interface WorkspaceExecutionTargetDto {
  id: string;
  /**
   * `local` or `virtual`.
   */
  type: string;
  label: string;
  status: "active" | "disabled" | "unavailable";
  ownerDisplayName: string | null;
  reachable: boolean;
  lastSeenAt: DateTime | null;
  activeMemberAccessCount: number;
  /**
   * Whether the caller has active access and so can select it for project launches.
   */
  hasCurrentUserAccess: boolean;
  /**
   * Human-readable reason the target cannot run work now (disabled, awaiting its first runner heartbeat, or no healthy runner); null when reachable and active.
   */
  unavailableReason: string | null;
  runnerRegistrations: ExecutionTargetRunnerRegistrationDto[];
}
export const workspaceExecutionTargetDtoSchema: z.ZodType<WorkspaceExecutionTargetDto> = z.object({ "id": z.string(), "type": z.string(), "label": z.string(), "status": z.enum(["active", "disabled", "unavailable"]), "ownerDisplayName": z.string().nullable(), "reachable": z.boolean(), "lastSeenAt": dateTimeSchema.nullable(), "activeMemberAccessCount": z.int().min(0), "hasCurrentUserAccess": z.boolean(), "unavailableReason": z.string().nullable(), "runnerRegistrations": z.array(executionTargetRunnerRegistrationDtoSchema) });

export type WorkspaceExecutionTargetList = WorkspaceExecutionTargetDto[];
export const workspaceExecutionTargetListSchema: z.ZodType<WorkspaceExecutionTargetList> = z.array(workspaceExecutionTargetDtoSchema);

export interface RegisterExecutionTargetBody {
  /**
   * Display name for the target, trimmed; a non-string or blank value keeps the device label.
   */
  label?: string;
}
export const registerExecutionTargetBodySchema: z.ZodType<RegisterExecutionTargetBody> = z.object({ "label": z.exactOptional(z.string()) });

export interface UpdateWorkspaceExecutionTargetBody {
  /**
   * New label, trimmed; blank answers 400. A non-string is ignored.
   */
  label?: string;
  /**
   * Any other value is ignored.
   */
  status?: "active" | "disabled";
}
export const updateWorkspaceExecutionTargetBodySchema: z.ZodType<UpdateWorkspaceExecutionTargetBody> = z.object({ "label": z.exactOptional(z.string()), "status": z.exactOptional(z.enum(["active", "disabled"])) });

export interface EligibleExecutionTargetDto {
  executionTargetId: string;
  type: string;
  label: string;
  deviceLabel: string | null;
  reachable: boolean;
  /**
   * Whether the project's primary resource on this target is not `missing`.
   */
  primaryResourceConnected: boolean;
}
export const eligibleExecutionTargetDtoSchema: z.ZodType<EligibleExecutionTargetDto> = z.object({ "executionTargetId": z.string(), "type": z.string(), "label": z.string(), "deviceLabel": z.string().nullable(), "reachable": z.boolean(), "primaryResourceConnected": z.boolean() });

export interface ProjectExecutionTargetDto {
  selectedExecutionTargetId: string | null;
  eligibleTargets: EligibleExecutionTargetDto[];
}
export const projectExecutionTargetDtoSchema: z.ZodType<ProjectExecutionTargetDto> = z.object({ "selectedExecutionTargetId": z.string().nullable(), "eligibleTargets": z.array(eligibleExecutionTargetDtoSchema) });

export interface UpdateProjectExecutionTargetBody {
  /**
   * Target to select, trimmed; null, absent or blank clears the choice. A non-string answers 500.
   */
  executionTargetId?: string | null;
}
export const updateProjectExecutionTargetBodySchema: z.ZodType<UpdateProjectExecutionTargetBody> = z.object({ "executionTargetId": z.exactOptional(z.string().nullable()) });

/**
 * A resource's availability as one execution target last observed it. It is target-scoped and time-sensitive, distinct from the backend-owned resource lifecycle (`active`, `archived`).
 */
export type TargetObservationState = "available" | "missing" | "unreachable" | "permission_denied" | "not_git_repository" | "unknown";
export const targetObservationStateSchema: z.ZodType<TargetObservationState> = z.enum(["available", "missing", "unreachable", "permission_denied", "not_git_repository", "unknown"]);

export interface ReportResourceObservationsBody {
  /**
   * A missing, non-array or empty list answers 400.
   */
  observations: Array<{
    /**
     * Project resource UUID, trimmed; blank answers 400.
     */
    resourceId: string;
    /**
     * Trimmed; any other value answers 400.
     */
    state: TargetObservationState;
    /**
     * Null, absent or any other non-string is stored as null.
     */
    gitRoot?: string | null;
    /**
     * Null, absent or any other non-string is stored as null.
     */
    branch?: string | null;
    /**
     * Null, absent or any other non-string is stored as null.
     */
    commit?: string | null;
    /**
     * Trimmed and stored as given (not parsed); blank answers 400.
     */
    observedAt: string;
  }>;
}
export const reportResourceObservationsBodySchema: z.ZodType<ReportResourceObservationsBody> = z.object({ "observations": z.array(z.object({ "resourceId": z.string(), "state": targetObservationStateSchema, "gitRoot": z.exactOptional(z.string().nullable()), "branch": z.exactOptional(z.string().nullable()), "commit": z.exactOptional(z.string().nullable()), "observedAt": z.string() })).min(1) });

export interface ReportMissionBranchObservationsBody {
  /**
   * A missing, non-array or empty list answers 400.
   */
  observations: Array<{
    /**
     * Mission UUID, trimmed; blank answers 400.
     */
    missionId: string;
    /**
     * Trimmed; blank answers 400.
     */
    resourceKey: string;
    /**
     * Trimmed; any other value answers 400.
     */
    status: "created" | "published" | "merged_unpushed" | "merged";
    /**
     * A non-boolean answers 400.
     */
    dirty: boolean;
    /**
     * Null, absent or any other non-string is stored as null.
     */
    worktreePath?: string | null;
    /**
     * Trimmed and stored as given (not parsed); blank answers 400.
     */
    observedAt: string;
  }>;
}
export const reportMissionBranchObservationsBodySchema: z.ZodType<ReportMissionBranchObservationsBody> = z.object({ "observations": z.array(z.object({ "missionId": z.string(), "resourceKey": z.string(), "status": z.enum(["created", "published", "merged_unpushed", "merged"]), "dirty": z.boolean(), "worktreePath": z.exactOptional(z.string().nullable()), "observedAt": z.string() })).min(1) });

export interface RecordedObservationsDto {
  recorded: number;
}
export const recordedObservationsDtoSchema: z.ZodType<RecordedObservationsDto> = z.object({ "recorded": z.int().min(1) });

export interface AgentCatalogModelDto {
  id: string;
  /**
   * Defaults to the id.
   */
  displayName: string;
  /**
   * Reasoning or thinking levels selectable for this model; empty means none.
   */
  reasoningOptions: string[];
  /**
   * When false the model is kept in the catalog but not offered for selection.
   */
  enabled: boolean;
}
export const agentCatalogModelDtoSchema: z.ZodType<AgentCatalogModelDto> = z.object({ "id": z.string(), "displayName": z.string(), "reasoningOptions": z.array(z.string()), "enabled": z.boolean() });

export interface AgentCatalogAgentDto {
  /**
   * Stable connector key (`claude`, `codex`, `cursor`, …).
   */
  key: string;
  label: string;
  availableByDefault: boolean;
  models: AgentCatalogModelDto[];
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
  /**
   * Column heading for the reasoning options; defaults to `Thinking`.
   */
  reasoningLabel: string;
}
export const agentCatalogAgentDtoSchema: z.ZodType<AgentCatalogAgentDto> = z.object({ "key": z.string(), "label": z.string(), "availableByDefault": z.boolean(), "models": z.array(agentCatalogModelDtoSchema), "defaultModel": z.string().nullable(), "defaultReasoningEffort": z.string().nullable(), "reasoningLabel": z.string() });

export interface AgentCatalogDto {
  agents: AgentCatalogAgentDto[];
  /**
   * The instance default from overlord.toml, used when no preference is stored.
   */
  defaultAgent: string;
  defaultModel: string | null;
}
export const agentCatalogDtoSchema: z.ZodType<AgentCatalogDto> = z.object({ "agents": z.array(agentCatalogAgentDtoSchema), "defaultAgent": z.string(), "defaultModel": z.string().nullable() });

/**
 * Each agent needs a non-blank `key` and `label` (trimmed) and a non-empty `models` list; each model needs a non-blank `id`, unique within the agent; a non-null `defaultModel` must name one of them; a non-null `defaultReasoningEffort` must be one of the default model's reasoning options when it has any. Each failure answers 400. A non-string `key`, `label`, model `id` or `displayName`, or a non-object agent or model, answers 500. A later agent with the same key replaces an earlier one.
 */
export interface UpdateAgentCatalogBody {
  /**
   * A missing or non-array value answers 400 `agents array is required`.
   */
  agents: Array<{
    key: string;
    label: string;
    /**
     * Only `false` turns it off.
     */
    availableByDefault?: boolean;
    models: Array<{
      id: string;
      /**
       * Trimmed; blank defaults to the id.
       */
      displayName?: string;
      /**
       * Non-string and blank entries are dropped.
       */
      reasoningOptions?: string[];
      /**
       * Only `false` disables.
       */
      enabled?: boolean;
    }>;
    defaultModel?: string | null;
    defaultReasoningEffort?: string | null;
    /**
     * Trimmed; blank defaults to `Thinking`.
     */
    reasoningLabel?: string;
  }>;
}
export const updateAgentCatalogBodySchema: z.ZodType<UpdateAgentCatalogBody> = z.object({ "agents": z.array(z.object({ "key": z.string(), "label": z.string(), "availableByDefault": z.exactOptional(z.boolean()), "models": z.array(z.object({ "id": z.string(), "displayName": z.exactOptional(z.string()), "reasoningOptions": z.exactOptional(z.array(z.string())), "enabled": z.exactOptional(z.boolean()) })).min(1), "defaultModel": z.exactOptional(z.string().nullable()), "defaultReasoningEffort": z.exactOptional(z.string().nullable()), "reasoningLabel": z.exactOptional(z.string()) })) });

export interface ExecutionProviderDto {
  kind: "direct" | "latch";
  /**
   * Latch CLI to invoke; kept while `direct` so switching back is lossless.
   */
  executable: string;
}
export const executionProviderDtoSchema: z.ZodType<ExecutionProviderDto> = z.object({ "kind": z.enum(["direct", "latch"]), "executable": z.string() });

export interface TerminalProfileDto {
  /**
   * Built-in launcher (`iTerm2`, `Terminal`) or a prefix command; null runs inline.
   */
  launcher: string | null;
  /**
   * `window`, `tab` or `chord` on a read; the terminal-profile update echoes the submitted value.
   */
  placement: string;
  /**
   * Typed shortcut such as `cmd+d` when placement is `chord`.
   */
  chord: string | null;
  /**
   * Open the terminal without taking keyboard focus (macOS; ignored for `chord`).
   */
  background: boolean;
  /**
   * This target's provider override; null inherits the user default.
   */
  executionProvider: ExecutionProviderDto | null;
  /**
   * This target's viewer-on-launch override; null inherits the user default.
   */
  openViewerOnLaunch: boolean | null;
}
export const terminalProfileDtoSchema: z.ZodType<TerminalProfileDto> = z.object({ "launcher": z.string().nullable(), "placement": z.string(), "chord": z.string().nullable(), "background": z.boolean(), "executionProvider": executionProviderDtoSchema.nullable(), "openViewerOnLaunch": z.boolean().nullable() });

export interface LaunchSessionDefaultsDto {
  executionProvider: ExecutionProviderDto;
  openViewerOnLaunch: boolean;
  /**
   * Whether launches prepare a per-mission branch and worktree before spawn.
   */
  worktreeBranchAutomationEnabled: boolean;
}
export const launchSessionDefaultsDtoSchema: z.ZodType<LaunchSessionDefaultsDto> = z.object({ "executionProvider": executionProviderDtoSchema, "openViewerOnLaunch": z.boolean(), "worktreeBranchAutomationEnabled": z.boolean() });

/**
 * Whether an effective value came from the target override or the user default.
 */
export type LaunchSessionSource = "target" | "user_default";
export const launchSessionSourceSchema: z.ZodType<LaunchSessionSource> = z.enum(["target", "user_default"]);

export interface ResolvedLaunchSessionDto {
  version: 1;
  executionProvider: ExecutionProviderDto;
  viewer: {
    kind: "iterm" | "terminal" | "inline" | "custom";
    launcher: string | null;
    openOnLaunch: boolean;
    /**
     * Projected from the profile's placement.
     */
    openAs: "window" | "tab";
    background: boolean;
  };
  executionProviderSource: LaunchSessionSource;
  viewerOpenSource: LaunchSessionSource;
}
export const resolvedLaunchSessionDtoSchema: z.ZodType<ResolvedLaunchSessionDto> = z.object({ "version": z.literal(1), "executionProvider": executionProviderDtoSchema, "viewer": z.object({ "kind": z.enum(["iterm", "terminal", "inline", "custom"]), "launcher": z.string().nullable(), "openOnLaunch": z.boolean(), "openAs": z.enum(["window", "tab"]), "background": z.boolean() }), "executionProviderSource": launchSessionSourceSchema, "viewerOpenSource": launchSessionSourceSchema });

export interface LaunchSettingsDto {
  /**
   * The acting machine's execution target in this workspace, or null when it has none.
   */
  executionTargetId: string | null;
  deviceLabel: string | null;
  /**
   * The caller's launch mechanics for this target, keyed by agent key.
   */
  agentConfigs: { [key: string]: AgentLaunchConfigDto };
  terminalProfile: TerminalProfileDto;
  launchSessionDefaults: LaunchSessionDefaultsDto;
  /**
   * The effective provider and viewer for this machine; null when it has no target.
   */
  resolvedLaunchSession: ResolvedLaunchSessionDto | null;
  /**
   * Mirrors `launchSessionDefaults.worktreeBranchAutomationEnabled`.
   */
  worktreeBranchAutomationEnabled: boolean;
}
export const launchSettingsDtoSchema: z.ZodType<LaunchSettingsDto> = z.object({ "executionTargetId": z.string().nullable(), "deviceLabel": z.string().nullable(), "agentConfigs": z.record(z.string(), agentLaunchConfigDtoSchema), "terminalProfile": terminalProfileDtoSchema, "launchSessionDefaults": launchSessionDefaultsDtoSchema, "resolvedLaunchSession": resolvedLaunchSessionDtoSchema.nullable(), "worktreeBranchAutomationEnabled": z.boolean() });

export interface UpdateAgentLaunchConfigBody {
  /**
   * Trimmed. A non-string answers 500.
   */
  preCommand?: string;
  /**
   * Normalized; a non-array value stores an empty list.
   */
  flags?: AgentLaunchFlagInput[];
}
export const updateAgentLaunchConfigBodySchema: z.ZodType<UpdateAgentLaunchConfigBody> = z.object({ "preCommand": z.exactOptional(z.string()), "flags": z.exactOptional(z.array(agentLaunchFlagInputSchema)) });

export interface UpdateTerminalProfileBody {
  launcher?: string | null;
  placement?: "window" | "tab" | "chord";
  chord?: string | null;
  background?: boolean;
  /**
   * Absent keeps the stored override, null clears it. An object sets it: `kind` other than `latch` reads as `direct`, and a blank `executable` defaults to the Latch CLI; a non-object clears it.
   */
  executionProvider?: ExecutionProviderDto | null;
  /**
   * Absent keeps the stored override, null clears it; a non-boolean clears it.
   */
  openViewerOnLaunch?: boolean | null;
}
export const updateTerminalProfileBodySchema: z.ZodType<UpdateTerminalProfileBody> = z.object({ "launcher": z.exactOptional(z.string().nullable()), "placement": z.exactOptional(z.enum(["window", "tab", "chord"])), "chord": z.exactOptional(z.string().nullable()), "background": z.exactOptional(z.boolean()), "executionProvider": z.exactOptional(executionProviderDtoSchema.nullable()), "openViewerOnLaunch": z.exactOptional(z.boolean().nullable()) });

export interface UpdateLaunchSessionDefaultsBody {
  /**
   * Null resets to the default `direct` provider; an object is normalized as for the terminal profile, and a non-object also resets to the default.
   */
  executionProvider?: ExecutionProviderDto | null;
  /**
   * Null keeps the stored value. Not type-checked.
   */
  openViewerOnLaunch?: boolean | null;
  /**
   * Null keeps the stored value. Not type-checked.
   */
  worktreeBranchAutomationEnabled?: boolean | null;
}
export const updateLaunchSessionDefaultsBodySchema: z.ZodType<UpdateLaunchSessionDefaultsBody> = z.object({ "executionProvider": z.exactOptional(executionProviderDtoSchema.nullable()), "openViewerOnLaunch": z.exactOptional(z.boolean().nullable()), "worktreeBranchAutomationEnabled": z.exactOptional(z.boolean().nullable()) });

export interface UpdateWorktreeBranchAutomationBody {
  /**
   * Only `true` turns automation on.
   */
  enabled?: boolean;
}
export const updateWorktreeBranchAutomationBodySchema: z.ZodType<UpdateWorktreeBranchAutomationBody> = z.object({ "enabled": z.exactOptional(z.boolean()) });

export interface LaunchPreferenceDto {
  selectedAgent: string | null;
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
}
export const launchPreferenceDtoSchema: z.ZodType<LaunchPreferenceDto> = z.object({ "selectedAgent": z.string().nullable(), "selectedModel": z.string().nullable(), "selectedReasoningEffort": z.string().nullable() });

export interface UpdateLaunchPreferenceBody {
  selectedAgent?: string | null;
  selectedModel?: string | null;
  selectedReasoningEffort?: string | null;
}
export const updateLaunchPreferenceBodySchema: z.ZodType<UpdateLaunchPreferenceBody> = z.object({ "selectedAgent": z.exactOptional(z.string().nullable()), "selectedModel": z.exactOptional(z.string().nullable()), "selectedReasoningEffort": z.exactOptional(z.string().nullable()) });

/**
 * One capability call. `capability` and `input` must both be present and truthy (400 `A local-target capability call is required.`).
 */
export interface LocalTargetBridgeCallBody {
  /**
   * `readRepositoryTree`, `listBranches`, `observeResource`, `listWorktrees`, `deriveBranchStatus`, `performBranchAction`, `removeWorktree`, `purgeMergedWorktrees`, `generateCommitMessageFromLocalDiff`, `writeProjectMetadata`, `discoverLatch`, `inspectLatchSession`, `openLatchSession`, `stopLatchSession` or `sendLatchMessage`.
   */
  capability: string;
  /**
   * The capability's input object.
   */
  input: JsonValue;
}
export const localTargetBridgeCallBodySchema: z.ZodType<LocalTargetBridgeCallBody> = z.object({ "capability": z.string(), "input": jsonValueSchema });

export interface CapabilityTargetMetadataDto {
  executionTargetId: string | null;
  deviceLabel: string | null;
  transport: "in_process" | "desktop_bridge" | "runner_queue" | "fake";
}
export const capabilityTargetMetadataDtoSchema: z.ZodType<CapabilityTargetMetadataDto> = z.object({ "executionTargetId": z.string().nullable(), "deviceLabel": z.string().nullable(), "transport": z.enum(["in_process", "desktop_bridge", "runner_queue", "fake"]) });

/**
 * Stable error code of a local-target capability (packages/core/service/local-target/types.ts); it never carries raw filesystem or Git error text. `LOCAL_TARGET_REQUIRED`: no selected or eligible target can serve the capability. `LOCAL_TARGET_UNREACHABLE`: a target is selected but not reachable now. `RESOURCE_MISSING`: the linked directory does not exist on the target. `NOT_GIT_REPOSITORY`: the path is not a Git repository. `PERMISSION_DENIED`: the target cannot access the path. `GIT_COMMAND_FAILED`: a git or worktree command failed on the target. `CAPABILITY_NOT_IMPLEMENTED`: the resolved transport does not implement the capability. `LOCAL_TARGET_TIMEOUT`: the queued call was accepted but no result arrived before the caller's deadline; the job is still live on the target, so callers show it as running and never re-queue it. `LOCAL_TARGET_UNSUPPORTED`: the runner will not execute the capability off the device (an unknown name, or `launchAgent`). `TARGET_OPERATION_FAILED`: a failure with no more specific code. `LATCH_SESSION_ABSENT`: Latch has no metadata for the session (pruned or removed) although the device is reachable. `UNKNOWN`: anything else.
 */
export type LocalTargetErrorCode = "LOCAL_TARGET_REQUIRED" | "LOCAL_TARGET_UNREACHABLE" | "RESOURCE_MISSING" | "NOT_GIT_REPOSITORY" | "PERMISSION_DENIED" | "GIT_COMMAND_FAILED" | "CAPABILITY_NOT_IMPLEMENTED" | "LOCAL_TARGET_TIMEOUT" | "LOCAL_TARGET_UNSUPPORTED" | "TARGET_OPERATION_FAILED" | "LATCH_SESSION_ABSENT" | "UNKNOWN";
export const localTargetErrorCodeSchema: z.ZodType<LocalTargetErrorCode> = z.enum(["LOCAL_TARGET_REQUIRED", "LOCAL_TARGET_UNREACHABLE", "RESOURCE_MISSING", "NOT_GIT_REPOSITORY", "PERMISSION_DENIED", "GIT_COMMAND_FAILED", "CAPABILITY_NOT_IMPLEMENTED", "LOCAL_TARGET_TIMEOUT", "LOCAL_TARGET_UNSUPPORTED", "TARGET_OPERATION_FAILED", "LATCH_SESSION_ABSENT", "UNKNOWN"]);

/**
 * A local-target capability result (packages/core/service/local-target/types.ts `CapabilityResult`).
 */
export type CapabilityResultDto = {
  ok: true;
  /**
   * The capability's value.
   */
  value: JsonValue;
  target: CapabilityTargetMetadataDto;
} | {
  ok: false;
  code: LocalTargetErrorCode;
  message: string;
  /**
   * Present when the failure carries details.
   */
  details?: JsonValue;
  target: CapabilityTargetMetadataDto;
};
export const capabilityResultDtoSchema: z.ZodType<CapabilityResultDto> = z.union([z.object({ "ok": z.literal(true), "value": jsonValueSchema, "target": capabilityTargetMetadataDtoSchema }), z.object({ "ok": z.literal(false), "code": localTargetErrorCodeSchema, "message": z.string(), "details": z.exactOptional(jsonValueSchema), "target": capabilityTargetMetadataDtoSchema })]);

/**
 * A managed worktree as the local-target bridge reports it (packages/contract `WorktreeDto`).
 */
export interface WorktreeDto {
  path: string;
  branch: string | null;
  projectId: string;
  projectName: string;
  missionId: string | null;
  missionDisplayId: string | null;
  status: MissionBranchStatus | null;
  merged: boolean;
  dirty: boolean;
  sizeBytes: number | null;
  lastModifiedAt: DateTime | null;
}
export const worktreeDtoSchema: z.ZodType<WorktreeDto> = z.object({ "path": z.string(), "branch": z.string().nullable(), "projectId": z.string(), "projectName": z.string(), "missionId": z.string().nullable(), "missionDisplayId": z.string().nullable(), "status": missionBranchStatusSchema.nullable(), "merged": z.boolean(), "dirty": z.boolean(), "sizeBytes": z.int().min(0).nullable(), "lastModifiedAt": dateTimeSchema.nullable() });

export type WorktreeList = WorktreeDto[];
export const worktreeListSchema: z.ZodType<WorktreeList> = z.array(worktreeDtoSchema).max(0);

export interface RemoveWorktreeBody {
  /**
   * Worktree path, trimmed and resolved; blank or non-string answers 400.
   */
  path: string;
  /**
   * Only `true` removes a dirty worktree.
   */
  force?: boolean;
  /**
   * Primary repository path; required with `clientExecuted` and on a target.
   */
  primaryRepoPath?: string;
  /**
   * `true` acknowledges a removal the client already ran.
   */
  clientExecuted?: boolean;
  /**
   * Project UUID that owns the worktree; selects the target the removal is queued to.
   */
  projectId?: string;
  executionTargetId?: string | null;
}
export const removeWorktreeBodySchema: z.ZodType<RemoveWorktreeBody> = z.object({ "path": z.string(), "force": z.exactOptional(z.boolean()), "primaryRepoPath": z.exactOptional(z.string()), "clientExecuted": z.exactOptional(z.boolean()), "projectId": z.exactOptional(z.string()), "executionTargetId": z.exactOptional(z.string().nullable()) });

export interface PurgeMergedWorktreesBody {
  projectId?: string;
  executionTargetId?: string | null;
  primaryRepoPath?: string;
  /**
   * Where the target looks for managed worktrees; the target's default when absent or blank.
   */
  worktreeRoot?: string;
}
export const purgeMergedWorktreesBodySchema: z.ZodType<PurgeMergedWorktreesBody> = z.object({ "projectId": z.exactOptional(z.string()), "executionTargetId": z.exactOptional(z.string().nullable()), "primaryRepoPath": z.exactOptional(z.string()), "worktreeRoot": z.exactOptional(z.string()) });

export interface PurgeWorktreesResultDto {
  removed: string[];
  skipped: Array<{
    path: string;
    reason: string;
  }>;
  worktrees: WorktreeDto[];
}
export const purgeWorktreesResultDtoSchema: z.ZodType<PurgeWorktreesResultDto> = z.object({ "removed": z.array(z.string()), "skipped": z.array(z.object({ "path": z.string(), "reason": z.string() })), "worktrees": z.array(worktreeDtoSchema).max(0) });

/**
 * An execution request as the runner sees it (backend/execution/runner.ts `serviceSummaryToDto`).
 */
export interface RunnerExecutionRequestDto {
  id: string;
  workspaceId: string;
  projectId: string;
  /**
   * Null for a mission-less capability call.
   */
  missionId: string | null;
  objectiveId: string | null;
  /**
   * The target that claimed the request, else the target it was stamped with.
   */
  executionTargetId: string | null;
  requestedAgent: string | null;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  launchConfig: AgentLaunchConfigDto;
  /**
   * The request's stored metadata object (malformed JSON reads as empty), for example `launchConfigSource`, `launchSession` (frozen at claim) and `providerSession`.
   */
  metadata: { [key: string]: JsonValue };
  status: ExecutionRequestStatus;
  requestedSource: string;
  /**
   * The resolved working directory; null until resolved.
   */
  workingDirectory: string | null;
  lastError: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}
const runnerExecutionRequestDtoShape = { "id": z.string(), "workspaceId": z.string(), "projectId": z.string(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "executionTargetId": z.string().nullable(), "requestedAgent": z.string().nullable(), "requestedModel": z.string().nullable(), "requestedReasoningEffort": z.string().nullable(), "launchConfig": agentLaunchConfigDtoSchema, "metadata": z.record(z.string(), jsonValueSchema), "status": executionRequestStatusSchema, "requestedSource": z.string(), "workingDirectory": z.string().nullable(), "lastError": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema };
export const runnerExecutionRequestDtoSchema: z.ZodType<RunnerExecutionRequestDto> = z.object(runnerExecutionRequestDtoShape);

export interface RunnerStatusDto {
  queue: RunnerExecutionRequestDto[];
  /**
   * The length of `queue`.
   */
  activeCount: number;
}
export const runnerStatusDtoSchema: z.ZodType<RunnerStatusDto> = z.object({ "queue": z.array(runnerExecutionRequestDtoSchema), "activeCount": z.int().min(0) });

/**
 * A claimed request with the project's launch preparation settings.
 */
export type RunnerClaimedRequestDto = RunnerExecutionRequestDto & {
  /**
   * The project's pre-launch commands, in order.
   */
  preLaunchCommands: string[];
  /**
   * The project's launch environment variables.
   */
  launchEnvVars: { [key: string]: string };
};
export const runnerClaimedRequestDtoSchema: z.ZodType<RunnerClaimedRequestDto> = z.object({ ...runnerExecutionRequestDtoShape, "preLaunchCommands": z.array(z.string()), "launchEnvVars": z.record(z.string(), z.string()) });

export interface RunnerClaimResponse {
  request: RunnerClaimedRequestDto | null;
  /**
   * True on Postgres, where the long-poll wait is available; false on SQLite, where the runner keeps its polling cadence.
   */
  longPoll: boolean;
}
export const runnerClaimResponseSchema: z.ZodType<RunnerClaimResponse> = z.object({ "request": runnerClaimedRequestDtoSchema.nullable(), "longPoll": z.boolean() });

/**
 * Every member is optional; non-string values are ignored.
 */
export interface RunnerClaimBody {
  /**
   * Project UUID or reference limiting the claim to one project.
   */
  projectId?: string;
  /**
   * The claiming machine on a hosted backend.
   */
  deviceFingerprint?: string;
  deviceLabel?: string;
  devicePlatform?: string;
  /**
   * An already-declared target this runner serves (with `runnerRelation`).
   */
  executionTargetId?: string;
  /**
   * Stable runner instance id; registers a heartbeat.
   */
  runnerInstanceId?: string;
  /**
   * Any other value is ignored.
   */
  runnerRelation?: "native" | "adopted";
  runnerLabel?: string;
  runnerVersion?: string;
  /**
   * Runner capability flags (an object; other values are ignored).
   */
  capabilities?: { [key: string]: JsonValue };
  /**
   * Agent keys; non-strings are dropped.
   */
  supportedAgents?: string[];
}
export const runnerClaimBodySchema: z.ZodType<RunnerClaimBody> = z.object({ "projectId": z.exactOptional(z.string()), "deviceFingerprint": z.exactOptional(z.string()), "deviceLabel": z.exactOptional(z.string()), "devicePlatform": z.exactOptional(z.string()), "executionTargetId": z.exactOptional(z.string()), "runnerInstanceId": z.exactOptional(z.string()), "runnerRelation": z.exactOptional(z.enum(["native", "adopted"])), "runnerLabel": z.exactOptional(z.string()), "runnerVersion": z.exactOptional(z.string()), "capabilities": z.exactOptional(z.record(z.string(), jsonValueSchema)), "supportedAgents": z.exactOptional(z.array(z.string())) });

export interface RunnerClearBody {
  /**
   * Objective UUID or display id; non-strings are ignored.
   */
  objectiveId?: string;
  /**
   * Project UUID or reference; non-strings are ignored.
   */
  projectId?: string;
}
export const runnerClearBodySchema: z.ZodType<RunnerClearBody> = z.object({ "objectiveId": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string()) });

export interface RunnerClearResultDto {
  cleared: number;
}
export const runnerClearResultDtoSchema: z.ZodType<RunnerClearResultDto> = z.object({ "cleared": z.int().min(0) });

export interface RunnerLaunchedBody {
  /**
   * The Latch session the launch opened; ignored unless `provider` is `latch` with a non-blank `providerSessionId`.
   */
  providerSession?: {
    provider: "latch";
    providerSessionId: string;
    sessionName?: string;
    executionTargetId?: string;
    agentSessionId?: string;
    createdAt?: string;
    /**
     * Defaults to `running`.
     */
    lastObservedState?: string;
  };
}
export const runnerLaunchedBodySchema: z.ZodType<RunnerLaunchedBody> = z.object({ "providerSession": z.exactOptional(z.object({ "provider": z.literal("latch"), "providerSessionId": z.string(), "sessionName": z.exactOptional(z.string()), "executionTargetId": z.exactOptional(z.string()), "agentSessionId": z.exactOptional(z.string()), "createdAt": z.exactOptional(z.string()), "lastObservedState": z.exactOptional(z.string()) })) });

export interface RunnerFailedBody {
  /**
   * Failure message stored as `lastError`; a non-string uses `Launch failed`.
   */
  error?: string;
}
export const runnerFailedBodySchema: z.ZodType<RunnerFailedBody> = z.object({ "error": z.exactOptional(z.string()) });

export interface RunnerCompletedBody {
  mutationResult: CapabilityResultDto;
}
export const runnerCompletedBodySchema: z.ZodType<RunnerCompletedBody> = z.object({ "mutationResult": capabilityResultDtoSchema });

/**
 * The envelope `ovld protocol` posts (backend/protocol/flags.ts `ProtocolRequestBody`). Which flags and positionals a subcommand reads is specified by contract/protocol-commands.yaml. An absent body is treated as empty.
 */
export interface ProtocolRequestBody {
  /**
   * The raw command-line arguments after the subcommand.
   */
  args?: string[];
  /**
   * Positional arguments.
   */
  positional?: string[];
  /**
   * Flags keyed by their long name including the dashes (`--mission-id`); a string value, or `true` for a boolean flag.
   */
  flags?: { [key: string]: string | boolean };
  /**
   * File payloads keyed by the `--*-file` flag that named them.
   */
  fileInputs?: { [key: string]: string };
  externalSessionId?: string | null;
}
export const protocolRequestBodySchema: z.ZodType<ProtocolRequestBody> = z.object({ "args": z.exactOptional(z.array(z.string())), "positional": z.exactOptional(z.array(z.string())), "flags": z.exactOptional(z.record(z.string(), z.union([z.string(), z.boolean()]))), "fileInputs": z.exactOptional(z.record(z.string(), z.string())), "externalSessionId": z.exactOptional(z.string().nullable()) });

export type AgentSessionChannelState = "preparing" | "online" | "degraded" | "ended" | "lost";
export const agentSessionChannelStateSchema: z.ZodType<AgentSessionChannelState> = z.enum(["preparing", "online", "degraded", "ended", "lost"]);

export type AgentRequestKind = "question" | "permission" | "choice" | "retry";
export const agentRequestKindSchema: z.ZodType<AgentRequestKind> = z.enum(["question", "permission", "choice", "retry"]);

export type AgentRequestStatus = "open" | "resolved" | "released_to_terminal" | "expired" | "cancelled";
export const agentRequestStatusSchema: z.ZodType<AgentRequestStatus> = z.enum(["open", "resolved", "released_to_terminal", "expired", "cancelled"]);

export interface AgentSessionChannelSelfDto {
  channelId: string;
  state: AgentSessionChannelState;
  /**
   * Whether the channel is bound to an agent session.
   */
  bound: boolean;
  missionId: string;
  adapterKey: string | null;
  capabilities: JsonValue;
  leaseExpiresAt: DateTime | null;
}
export const agentSessionChannelSelfDtoSchema: z.ZodType<AgentSessionChannelSelfDto> = z.object({ "channelId": z.string(), "state": agentSessionChannelStateSchema, "bound": z.boolean(), "missionId": z.string(), "adapterKey": z.string().nullable(), "capabilities": jsonValueSchema, "leaseExpiresAt": dateTimeSchema.nullable() });

export interface AgentSessionHeartbeatBody {
  /**
   * Only `degraded` is honoured; anything else is `online`.
   */
  state?: "online" | "degraded";
  /**
   * Replaces the stored capabilities when present and truthy.
   */
  capabilities?: { [key: string]: JsonValue };
  nativeSessionId?: string;
  adapterVersion?: string;
}
export const agentSessionHeartbeatBodySchema: z.ZodType<AgentSessionHeartbeatBody> = z.object({ "state": z.exactOptional(z.enum(["online", "degraded"])), "capabilities": z.exactOptional(z.record(z.string(), jsonValueSchema)), "nativeSessionId": z.exactOptional(z.string()), "adapterVersion": z.exactOptional(z.string()) });

export interface AgentSessionHeartbeatDto {
  ok: true;
  leaseExpiresAt: DateTime;
  credentialExpiresAt: DateTime;
}
export const agentSessionHeartbeatDtoSchema: z.ZodType<AgentSessionHeartbeatDto> = z.object({ "ok": z.literal(true), "leaseExpiresAt": dateTimeSchema, "credentialExpiresAt": dateTimeSchema });

export interface AgentSessionEventInput {
  /**
   * Producer event id, unique per channel and adapter; at most 200 characters.
   */
  eventId: string;
  /**
   * At most 200 characters.
   */
  kind: string;
  producerSequence?: number;
  /**
   * Parsed as a date; unparseable or future values use the server time.
   */
  occurredAt?: string;
  severity?: string;
  actionability?: string;
  nativeEvent?: string;
  nativeTurnId?: string;
  nativeCallId?: string;
  subagentId?: string;
  correlationId?: string;
  origin?: string;
  summary?: string;
  /**
   * At most 8 KiB serialized.
   */
  payload?: { [key: string]: JsonValue };
}
export const agentSessionEventInputSchema: z.ZodType<AgentSessionEventInput> = z.object({ "eventId": z.string(), "kind": z.string(), "producerSequence": z.exactOptional(z.number()), "occurredAt": z.exactOptional(z.string()), "severity": z.exactOptional(z.string()), "actionability": z.exactOptional(z.string()), "nativeEvent": z.exactOptional(z.string()), "nativeTurnId": z.exactOptional(z.string()), "nativeCallId": z.exactOptional(z.string()), "subagentId": z.exactOptional(z.string()), "correlationId": z.exactOptional(z.string()), "origin": z.exactOptional(z.string()), "summary": z.exactOptional(z.string()), "payload": z.exactOptional(z.record(z.string(), jsonValueSchema)) });

/**
 * One event, or a batch in `events`. A body whose `events` is an array is a batch (any other members are ignored); any other body is one event. The members are therefore `anyOf`, tried in that order.
 */
export type AppendAgentSessionEventsBody = {
  events: AgentSessionEventInput[];
} | AgentSessionEventInput;
export const appendAgentSessionEventsBodySchema: z.ZodType<AppendAgentSessionEventsBody> = z.union([z.object({ "events": z.array(agentSessionEventInputSchema).max(100) }), agentSessionEventInputSchema]);

export interface AppendAgentSessionEventsDto {
  accepted: Array<{
    id: string;
    channelSequence: number;
    duplicate: boolean;
  }>;
}
export const appendAgentSessionEventsDtoSchema: z.ZodType<AppendAgentSessionEventsDto> = z.object({ "accepted": z.array(z.object({ "id": z.string(), "channelSequence": z.int().min(1), "duplicate": z.boolean() })) });

export interface AgentRequestOption {
  optionId: string;
  label: string;
  kind: string;
}
export const agentRequestOptionSchema: z.ZodType<AgentRequestOption> = z.object({ "optionId": z.string(), "label": z.string(), "kind": z.string() });

export interface CreateAgentRequestBody {
  /**
   * Defaults to `question`.
   */
  kind?: AgentRequestKind;
  summary?: string;
  details?: { [key: string]: JsonValue };
  /**
   * At most 12 are kept.
   */
  options?: AgentRequestOption[];
  /**
   * Only `true` allows a free-text answer.
   */
  allowsFreeText?: boolean;
  nativeRequestId?: string;
  nativeCallId?: string;
  windowExpiresAt?: string;
  windowBasis?: string;
}
export const createAgentRequestBodySchema: z.ZodType<CreateAgentRequestBody> = z.object({ "kind": z.exactOptional(agentRequestKindSchema), "summary": z.exactOptional(z.string()), "details": z.exactOptional(z.record(z.string(), jsonValueSchema)), "options": z.exactOptional(z.array(agentRequestOptionSchema)), "allowsFreeText": z.exactOptional(z.boolean()), "nativeRequestId": z.exactOptional(z.string()), "nativeCallId": z.exactOptional(z.string()), "windowExpiresAt": z.exactOptional(z.string()), "windowBasis": z.exactOptional(z.string()) });

export interface CreatedAgentRequestDto {
  requestId: string;
  status: AgentRequestStatus;
  revision: number;
  windowExpiresAt: string | null;
}
export const createdAgentRequestDtoSchema: z.ZodType<CreatedAgentRequestDto> = z.object({ "requestId": z.string(), "status": agentRequestStatusSchema, "revision": z.int().min(1), "windowExpiresAt": z.string().nullable() });

/**
 * An agent request (backend/agent-session-routes.ts `requestDto`).
 */
export interface AgentRequestDto {
  id: string;
  channelId: string;
  missionId: string | null;
  objectiveId: string | null;
  kind: AgentRequestKind;
  summary: string;
  /**
   * The stored options. Every option is normalized on write to string `optionId`, `label` and `kind` (`boundedOptions`, packages/core/service/agent-session/requests.ts).
   */
  options: AgentRequestOption[];
  allowsFreeText: boolean;
  status: AgentRequestStatus;
  /**
   * The stored resolution object; null while unresolved.
   */
  resolution: JsonValue;
  revision: number;
  windowExpiresAt: string | null;
  /**
   * `timeout`, `local_activity`, `policy`, `interrupt`, `channel_ended` or `channel_lost`.
   */
  releasedReason: string | null;
  /**
   * `pending` until recorded, then `emitted`, `applied`, `not_applied` or `unknown`.
   */
  applicationState: string;
  resolvedAt: DateTime | null;
  createdAt: DateTime;
}
const agentRequestDtoShape = { "id": z.string(), "channelId": z.string(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "kind": agentRequestKindSchema, "summary": z.string(), "options": z.array(agentRequestOptionSchema), "allowsFreeText": z.boolean(), "status": agentRequestStatusSchema, "resolution": jsonValueSchema, "revision": z.int().min(1), "windowExpiresAt": z.string().nullable(), "releasedReason": z.string().nullable(), "applicationState": z.string(), "resolvedAt": dateTimeSchema.nullable(), "createdAt": dateTimeSchema };
export const agentRequestDtoSchema: z.ZodType<AgentRequestDto> = z.object(agentRequestDtoShape);

export interface AgentRequestDeliveryDto {
  mode: "latch" | "read_only";
  reason: ("no_latch_session" | "latch_session_exited" | "target_offline" | "request_closed") | null;
  state: ("emitted" | "applied" | "not_applied" | "unknown") | null;
  observedAt: DateTime | null;
}
export const agentRequestDeliveryDtoSchema: z.ZodType<AgentRequestDeliveryDto> = z.object({ "mode": z.enum(["latch", "read_only"]), "reason": z.enum(["no_latch_session", "latch_session_exited", "target_offline", "request_closed"]).nullable(), "state": z.enum(["emitted", "applied", "not_applied", "unknown"]).nullable(), "observedAt": dateTimeSchema.nullable() });

/**
 * A request with its delivery mode, as the human routes return it.
 */
export type HumanAgentRequestDto = AgentRequestDto & {
  delivery: AgentRequestDeliveryDto;
};
export const humanAgentRequestDtoSchema: z.ZodType<HumanAgentRequestDto> = z.object({ ...agentRequestDtoShape, "delivery": agentRequestDeliveryDtoSchema });

export interface AgentRequestListResponse {
  requests: HumanAgentRequestDto[];
}
export const agentRequestListResponseSchema: z.ZodType<AgentRequestListResponse> = z.object({ "requests": z.array(humanAgentRequestDtoSchema) });

export interface AgentRequestLeaseBody {
  /**
   * The lease to renew; blank or absent acquires a new one.
   */
  leaseId?: string;
}
export const agentRequestLeaseBodySchema: z.ZodType<AgentRequestLeaseBody> = z.object({ "leaseId": z.exactOptional(z.string()) });

export interface AgentRequestLeaseDto {
  leaseId: string;
  leaseExpiresAt: DateTime;
  status: AgentRequestStatus;
  revision: number;
  resolution: JsonValue;
}
export const agentRequestLeaseDtoSchema: z.ZodType<AgentRequestLeaseDto> = z.object({ "leaseId": z.string(), "leaseExpiresAt": dateTimeSchema, "status": agentRequestStatusSchema, "revision": z.int().min(1), "resolution": jsonValueSchema });

export interface ReleaseAgentRequestBody {
  /**
   * `timeout`, `local_activity`, `policy` or `interrupt`. Any other string, including `channel_ended`, is accepted and recorded as `timeout`.
   */
  reason?: string;
}
export const releaseAgentRequestBodySchema: z.ZodType<ReleaseAgentRequestBody> = z.object({ "reason": z.exactOptional(z.string()) });

export interface ReleasedAgentRequestDto {
  released: boolean;
  status: AgentRequestStatus;
  resolution: JsonValue;
}
export const releasedAgentRequestDtoSchema: z.ZodType<ReleasedAgentRequestDto> = z.object({ "released": z.boolean(), "status": agentRequestStatusSchema, "resolution": jsonValueSchema });

export interface RecordAgentRequestApplicationBody {
  /**
   * `emitted`, `applied`, `not_applied` or `unknown`. Any other string is accepted and recorded as `unknown`.
   */
  applicationState?: string;
}
export const recordAgentRequestApplicationBodySchema: z.ZodType<RecordAgentRequestApplicationBody> = z.object({ "applicationState": z.exactOptional(z.string()) });

export interface AgentRequestResolvedElsewhereDto {
  changed: boolean;
  status: AgentRequestStatus;
  releasedReason: string | null;
}
export const agentRequestResolvedElsewhereDtoSchema: z.ZodType<AgentRequestResolvedElsewhereDto> = z.object({ "changed": z.boolean(), "status": agentRequestStatusSchema, "releasedReason": z.string().nullable() });

export type AgentSessionInputKind = "instruction" | "retry" | "continue";
export const agentSessionInputKindSchema: z.ZodType<AgentSessionInputKind> = z.enum(["instruction", "retry", "continue"]);

export type AgentSessionInputStatus = "queued" | "leased" | "emitted" | "acknowledged" | "failed" | "expired" | "cancelled";
export const agentSessionInputStatusSchema: z.ZodType<AgentSessionInputStatus> = z.enum(["queued", "leased", "emitted", "acknowledged", "failed", "expired", "cancelled"]);

export interface ClaimedAgentSessionInputDto {
  input: {
    id: string;
    kind: AgentSessionInputKind;
    body: string;
    leaseId: string;
    leaseExpiresAt: DateTime;
  } | null;
}
export const claimedAgentSessionInputDtoSchema: z.ZodType<ClaimedAgentSessionInputDto> = z.object({ "input": z.object({ "id": z.string(), "kind": agentSessionInputKindSchema, "body": z.string(), "leaseId": z.string(), "leaseExpiresAt": dateTimeSchema }).nullable() });

export interface MarkAgentSessionInputEmittedBody {
  leaseId: string;
  /**
   * `delivered`, `queued_turn_boundary`, `queued_next_turn` or `unsupported`. Any other string is accepted and stored as null.
   */
  deliveryOutcome?: string;
}
export const markAgentSessionInputEmittedBodySchema: z.ZodType<MarkAgentSessionInputEmittedBody> = z.object({ "leaseId": z.string(), "deliveryOutcome": z.exactOptional(z.string()) });

export interface MarkAgentSessionInputFailedBody {
  /**
   * Defaults to `adapter_error`.
   */
  errorCode?: string;
}
export const markAgentSessionInputFailedBodySchema: z.ZodType<MarkAgentSessionInputFailedBody> = z.object({ "errorCode": z.exactOptional(z.string()) });

export interface EndAgentSessionChannelBody {
  /**
   * Defaults to `session_ended`.
   */
  reason?: string;
  /**
   * A non-number is stored as null.
   */
  exitCode?: number;
}
export const endAgentSessionChannelBodySchema: z.ZodType<EndAgentSessionChannelBody> = z.object({ "reason": z.exactOptional(z.string()), "exitCode": z.exactOptional(z.number()) });

export interface ResolveAgentRequestBody {
  /**
   * The request revision the answer was made against.
   */
  expectedRevision: number;
  /**
   * `text` and/or `optionId`; stored as given.
   */
  resolution: {
    /**
     * Trimmed; refused unless the request allows free text.
     */
    text?: string;
    /**
     * Trimmed; must name one of the request's options.
     */
    optionId?: string;
  } & { [key: string]: JsonValue };
}
export const resolveAgentRequestBodySchema: z.ZodType<ResolveAgentRequestBody> = z.object({ "expectedRevision": z.int(), "resolution": z.object({ "text": z.exactOptional(z.string()), "optionId": z.exactOptional(z.string()) }).catchall(jsonValueSchema) });

export interface ResolveAgentRequestResultDto {
  resolved: boolean;
  request: HumanAgentRequestDto;
}
export const resolveAgentRequestResultDtoSchema: z.ZodType<ResolveAgentRequestResultDto> = z.object({ "resolved": z.boolean(), "request": humanAgentRequestDtoSchema });

export interface AgentSessionInputDto {
  id: string;
  channelId: string;
  missionId: string | null;
  objectiveId: string | null;
  sessionId: string | null;
  kind: AgentSessionInputKind;
  body: string;
  status: AgentSessionInputStatus;
  deliveryOutcome: ("delivered" | "queued_turn_boundary" | "queued_next_turn" | "unsupported") | null;
  /**
   * Display label, for example `Delivered`, `Queued (turn boundary)`, `Sent to harness`.
   */
  deliveryLabel: string;
  attemptCount: number;
  lastErrorCode: string | null;
  emittedAt: DateTime | null;
  acknowledgedAt: DateTime | null;
  createdAt: DateTime;
  revision: number;
}
export const agentSessionInputDtoSchema: z.ZodType<AgentSessionInputDto> = z.object({ "id": z.string(), "channelId": z.string(), "missionId": z.string().nullable(), "objectiveId": z.string().nullable(), "sessionId": z.string().nullable(), "kind": agentSessionInputKindSchema, "body": z.string(), "status": agentSessionInputStatusSchema, "deliveryOutcome": z.enum(["delivered", "queued_turn_boundary", "queued_next_turn", "unsupported"]).nullable(), "deliveryLabel": z.string(), "attemptCount": z.int().min(0), "lastErrorCode": z.string().nullable(), "emittedAt": dateTimeSchema.nullable(), "acknowledgedAt": dateTimeSchema.nullable(), "createdAt": dateTimeSchema, "revision": z.int().min(1) });

export interface AgentSessionChannelSnapshotDto {
  id: string;
  state: AgentSessionChannelState;
  agentIdentifier: string | null;
  adapterKey: string | null;
  capabilities: JsonValue;
  lastHeartbeatAt: DateTime | null;
  endedAt: DateTime | null;
  endReason: string | null;
}
export const agentSessionChannelSnapshotDtoSchema: z.ZodType<AgentSessionChannelSnapshotDto> = z.object({ "id": z.string(), "state": agentSessionChannelStateSchema, "agentIdentifier": z.string().nullable(), "adapterKey": z.string().nullable(), "capabilities": jsonValueSchema, "lastHeartbeatAt": dateTimeSchema.nullable(), "endedAt": dateTimeSchema.nullable(), "endReason": z.string().nullable() });

/**
 * `liveChannelId` and `liveChannel` are absent (not null) when the caller has no active workspace membership, which answers `{ inputs: [] }`.
 */
export interface AgentSessionInputListResponse {
  /**
   * The latest channel's id while it is `preparing`, `online` or `degraded`; null otherwise.
   */
  liveChannelId?: string | null;
  /**
   * The mission's (or objective's) most recent channel, live or not; null when it never had one.
   */
  liveChannel?: AgentSessionChannelSnapshotDto | null;
  inputs: AgentSessionInputDto[];
}
export const agentSessionInputListResponseSchema: z.ZodType<AgentSessionInputListResponse> = z.object({ "liveChannelId": z.exactOptional(z.string().nullable()), "liveChannel": z.exactOptional(agentSessionChannelSnapshotDtoSchema.nullable()), "inputs": z.array(agentSessionInputDtoSchema) });

export interface ChatThreadDto {
  id: string;
  organizationId: string;
  /**
   * `''` until the first message titles the thread; at most 80 characters once set.
   */
  title: string;
  titleSource: "pending" | "generated" | "user";
  archivedAt: DateTime | null;
  lastActivityAt: DateTime;
  /**
   * The state of the thread's unfinished run, or null.
   */
  activeRunState: ("queued" | "running" | "waiting_user") | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const chatThreadDtoSchema: z.ZodType<ChatThreadDto> = z.object({ "id": z.string(), "organizationId": z.string(), "title": z.string(), "titleSource": z.enum(["pending", "generated", "user"]), "archivedAt": dateTimeSchema.nullable(), "lastActivityAt": dateTimeSchema, "activeRunState": z.enum(["queued", "running", "waiting_user"]).nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export interface ChatThreadListResponse {
  items: ChatThreadDto[];
  /**
   * Opaque cursor for the next page, or null on the last page.
   */
  nextCursor: string | null;
}
export const chatThreadListResponseSchema: z.ZodType<ChatThreadListResponse> = z.object({ "items": z.array(chatThreadDtoSchema).max(50), "nextCursor": z.string().nullable() });

export interface ChatTextBlockDto {
  id: string;
  kind: "text";
  /**
   * Markdown. Citations reference `evidenceIds`.
   */
  text: string;
  fallbackText: string;
  evidenceIds: string[];
}
export const chatTextBlockDtoSchema: z.ZodType<ChatTextBlockDto> = z.object({ "id": z.string(), "kind": z.literal("text"), "text": z.string(), "fallbackText": z.string(), "evidenceIds": z.array(z.string()) });

/**
 * Where an evidence reference came from. Never an absolute path or credential.
 */
export type ChatSourceLocatorDto = {
  kind: "knowledgebase";
  connectionId: string;
  workspace: string;
  nodeId: string;
  path: string | null;
} | {
  kind: "overlord";
  entityType: "project" | "mission" | "delivery";
  entityId: string;
  projectId: string;
} | {
  kind: "repository";
  executionTargetId: string;
  projectId: string;
  resourceKey: string;
  /**
   * Repository-relative path, or null for resource-level observations.
   */
  relativePath: string | null;
  head: string | null;
};
export const chatSourceLocatorDtoSchema: z.ZodType<ChatSourceLocatorDto> = z.union([z.object({ "kind": z.literal("knowledgebase"), "connectionId": z.string(), "workspace": z.string(), "nodeId": z.string(), "path": z.string().nullable() }), z.object({ "kind": z.literal("overlord"), "entityType": z.enum(["project", "mission", "delivery"]), "entityId": z.string(), "projectId": z.string() }), z.object({ "kind": z.literal("repository"), "executionTargetId": z.string(), "projectId": z.string(), "resourceKey": z.string(), "relativePath": z.string().nullable(), "head": z.string().nullable() })]);

export interface ChatEvidenceDto {
  id: string;
  source: ChatSourceLocatorDto;
  sourceRevision: string | null;
  observedAt: DateTime;
  label: string;
  excerpt: string | null;
  truncated: boolean;
  /**
   * True when the observation is more than 15 minutes old when attached.
   */
  stale: boolean;
}
export const chatEvidenceDtoSchema: z.ZodType<ChatEvidenceDto> = z.object({ "id": z.string(), "source": chatSourceLocatorDtoSchema, "sourceRevision": z.string().nullable(), "observedAt": dateTimeSchema, "label": z.string(), "excerpt": z.string().nullable(), "truncated": z.boolean(), "stale": z.boolean() });

export interface ChatEvidenceBlockDto {
  id: string;
  kind: "evidence";
  evidence: ChatEvidenceDto[];
  fallbackText: string;
}
export const chatEvidenceBlockDtoSchema: z.ZodType<ChatEvidenceBlockDto> = z.object({ "id": z.string(), "kind": z.literal("evidence"), "evidence": z.array(chatEvidenceDtoSchema), "fallbackText": z.string() });

export interface ChatProposalBlockDto {
  id: string;
  kind: "proposal";
  proposalId: string;
  revision: number;
  fallbackText: string;
}
export const chatProposalBlockDtoSchema: z.ZodType<ChatProposalBlockDto> = z.object({ "id": z.string(), "kind": z.literal("proposal"), "proposalId": z.string(), "revision": z.int().min(1), "fallbackText": z.string() });

/**
 * Replaces every block of a message whose sources are no longer authorized.
 */
export interface ChatUnavailableBlockDto {
  id: "unavailable";
  kind: "unavailable";
  reason: "source_access_lost";
  regenerable: true;
  fallbackText: string;
}
export const chatUnavailableBlockDtoSchema: z.ZodType<ChatUnavailableBlockDto> = z.object({ "id": z.literal("unavailable"), "kind": z.literal("unavailable"), "reason": z.literal("source_access_lost"), "regenerable": z.literal(true), "fallbackText": z.string() });

/**
 * One block of a message. The server writes these four kinds; the TypeScript union also declares `question` and `mission` blocks, which no writer produces (see schema-disagreements.md).
 */
export type ChatBlockDto = ChatTextBlockDto | ChatEvidenceBlockDto | ChatProposalBlockDto | ChatUnavailableBlockDto;
export const chatBlockDtoSchema: z.ZodType<ChatBlockDto> = z.union([chatTextBlockDtoSchema, chatEvidenceBlockDtoSchema, chatProposalBlockDtoSchema, chatUnavailableBlockDtoSchema]);

export interface ChatMessageDto {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  state: "streaming" | "complete" | "interrupted";
  blocks: ChatBlockDto[];
  runId: string | null;
  /**
   * Set on a user message that answered a question.
   */
  answersQuestionId: string | null;
  /**
   * The submitting client's request id on user messages; null on assistant messages.
   */
  clientRequestId: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  revision: number;
}
export const chatMessageDtoSchema: z.ZodType<ChatMessageDto> = z.object({ "id": z.string(), "threadId": z.string(), "role": z.enum(["user", "assistant"]), "state": z.enum(["streaming", "complete", "interrupted"]), "blocks": z.array(chatBlockDtoSchema), "runId": z.string().nullable(), "answersQuestionId": z.string().nullable(), "clientRequestId": z.string().nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "revision": z.int().min(1) });

export interface ChatRunUsageDto {
  toolCalls: number;
  activeProcessingMs: number;
  gatheredContentBytes: number;
}
export const chatRunUsageDtoSchema: z.ZodType<ChatRunUsageDto> = z.object({ "toolCalls": z.int().min(0), "activeProcessingMs": z.int().min(0), "gatheredContentBytes": z.int().min(0) });

/**
 * A per-request grant for the assistant to write to one Knowledgebase workspace through one of the caller's connections.
 */
export interface ChatKnowledgebaseWriteDto {
  /**
   * A UUID (any letter case on input; answered in lower case).
   */
  connectionId: string;
  /**
   * A Knowledgebase workspace slug (`^[a-z0-9][a-z0-9-]{0,62}$`).
   */
  workspace: string;
}
export const chatKnowledgebaseWriteDtoSchema: z.ZodType<ChatKnowledgebaseWriteDto> = z.strictObject({ "connectionId": z.string(), "workspace": z.string() });

export interface ChatRunDto {
  id: string;
  threadId: string;
  triggerMessageId: string;
  state: "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  /**
   * Set on `completed` runs.
   */
  outcome: ("answered" | "allowance_exhausted") | null;
  /**
   * Set on `failed` runs.
   */
  failureCode: ("provider_unavailable" | "rate_limited" | "context_limit" | "unsupported_capability" | "interrupted" | "provider_error" | "source_access_lost") | null;
  /**
   * True on a run that completed `allowance_exhausted`: in the `run.updated` event that ended it, and on a snapshot's `latestRun` while no run is unfinished and none continues it. False everywhere else.
   */
  continueAvailable: boolean;
  continuedFromRunId: string | null;
  /**
   * The Knowledgebase write grant of this run; null for research only.
   */
  knowledgebaseWrite: ChatKnowledgebaseWriteDto | null;
  usage: ChatRunUsageDto;
  cancelRequestedAt: DateTime | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  completedAt: DateTime | null;
  revision: number;
}
export const chatRunDtoSchema: z.ZodType<ChatRunDto> = z.object({ "id": z.string(), "threadId": z.string(), "triggerMessageId": z.string(), "state": z.enum(["queued", "running", "waiting_user", "completed", "failed", "cancelled"]), "outcome": z.enum(["answered", "allowance_exhausted"]).nullable(), "failureCode": z.enum(["provider_unavailable", "rate_limited", "context_limit", "unsupported_capability", "interrupted", "provider_error", "source_access_lost"]).nullable(), "continueAvailable": z.boolean(), "continuedFromRunId": z.string().nullable(), "knowledgebaseWrite": chatKnowledgebaseWriteDtoSchema.nullable(), "usage": chatRunUsageDtoSchema, "cancelRequestedAt": dateTimeSchema.nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema, "completedAt": dateTimeSchema.nullable(), "revision": z.int().min(1) });

export interface ChatQuestionOptionDto {
  id: string;
  label: string;
}
export const chatQuestionOptionDtoSchema: z.ZodType<ChatQuestionOptionDto> = z.object({ "id": z.string(), "label": z.string() });

export interface ChatQuestionDto {
  id: string;
  threadId: string;
  runId: string;
  /**
   * 1-based ordinal of the question within its run.
   */
  ordinal: number;
  state: "open" | "answered" | "superseded" | "cancelled";
  prompt: string;
  options: ChatQuestionOptionDto[];
  allowFreeText: boolean;
  answerMessageId: string | null;
  createdAt: DateTime;
  answeredAt: DateTime | null;
  revision: number;
}
export const chatQuestionDtoSchema: z.ZodType<ChatQuestionDto> = z.object({ "id": z.string(), "threadId": z.string(), "runId": z.string(), "ordinal": z.int().min(1), "state": z.enum(["open", "answered", "superseded", "cancelled"]), "prompt": z.string(), "options": z.array(chatQuestionOptionDtoSchema).max(20), "allowFreeText": z.boolean(), "answerMessageId": z.string().nullable(), "createdAt": dateTimeSchema, "answeredAt": dateTimeSchema.nullable(), "revision": z.int().min(1) });

/**
 * The agent selection frozen when the proposal revision was prepared.
 */
export interface ChatAssignmentDto {
  agent: string;
  /**
   * Always a model enabled in the workspace catalog when the revision was prepared.
   */
  model: string;
  reasoningEffort: string | null;
  source: "project_default" | "assistant_selection";
}
export const chatAssignmentDtoSchema: z.ZodType<ChatAssignmentDto> = z.object({ "agent": z.string(), "model": z.string(), "reasoningEffort": z.string().nullable(), "source": z.enum(["project_default", "assistant_selection"]) });

export interface ChatProposalObjectiveDto {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  resourceKey: string;
  assignment: ChatAssignmentDto;
  evidenceIds: string[];
}
export const chatProposalObjectiveDtoSchema: z.ZodType<ChatProposalObjectiveDto> = z.object({ "title": z.string(), "objective": z.string(), "acceptanceCriteria": z.array(z.string()).max(50), "resourceKey": z.string(), "assignment": chatAssignmentDtoSchema, "evidenceIds": z.array(z.string()).max(100) });

export interface ChatProposalMissionDto {
  /**
   * Stable within a proposal across revisions.
   */
  key: string;
  projectId: string;
  /**
   * Snapshot for display; authorization is by `projectId`.
   */
  projectName: string;
  workspaceId: string;
  title: string;
  objectives: ChatProposalObjectiveDto[];
  /**
   * Keys of other missions in this proposal.
   */
  dependencies: string[];
  /**
   * Always set by the server to a fixed reminder that drafts are visible to the destination project's members.
   */
  audienceWarning: string | null;
}
export const chatProposalMissionDtoSchema: z.ZodType<ChatProposalMissionDto> = z.object({ "key": z.string(), "projectId": z.string(), "projectName": z.string(), "workspaceId": z.string(), "title": z.string(), "objectives": z.array(chatProposalObjectiveDtoSchema).min(1).max(20), "dependencies": z.array(z.string()).max(10), "audienceWarning": z.string().nullable() });

export interface ChatProposalRevisionDto {
  revision: number;
  /**
   * Empty when `invalidated`.
   */
  missions: ChatProposalMissionDto[];
  responsibleProfileId: string;
  /**
   * True when the revision's sources are no longer authorized.
   */
  invalidated: boolean;
  createdAt: DateTime;
}
export const chatProposalRevisionDtoSchema: z.ZodType<ChatProposalRevisionDto> = z.object({ "revision": z.int().min(1), "missions": z.array(chatProposalMissionDtoSchema).max(10), "responsibleProfileId": z.string(), "invalidated": z.boolean(), "createdAt": dateTimeSchema });

export interface ChatCreatedMissionDto {
  missionId: string;
  /**
   * `''` when the mission no longer exists.
   */
  missionDisplayId: string;
  projectId: string;
  objectiveIds: string[];
}
export const chatCreatedMissionDtoSchema: z.ZodType<ChatCreatedMissionDto> = z.object({ "missionId": z.string(), "missionDisplayId": z.string(), "projectId": z.string(), "objectiveIds": z.array(z.string()) });

export interface ChatCreationReceiptDto {
  id: string;
  proposalId: string;
  revision: number;
  missions: ChatCreatedMissionDto[];
  createdAt: DateTime;
}
export const chatCreationReceiptDtoSchema: z.ZodType<ChatCreationReceiptDto> = z.object({ "id": z.string(), "proposalId": z.string(), "revision": z.int().min(1), "missions": z.array(chatCreatedMissionDtoSchema), "createdAt": dateTimeSchema });

export interface ChatProposalDto {
  id: string;
  threadId: string;
  state: "open" | "created" | "cancelled";
  currentRevision: number;
  current: ChatProposalRevisionDto;
  receipt: ChatCreationReceiptDto | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}
export const chatProposalDtoSchema: z.ZodType<ChatProposalDto> = z.object({ "id": z.string(), "threadId": z.string(), "state": z.enum(["open", "created", "cancelled"]), "currentRevision": z.int().min(1), "current": chatProposalRevisionDtoSchema, "receipt": chatCreationReceiptDtoSchema.nullable(), "createdAt": dateTimeSchema, "updatedAt": dateTimeSchema });

export interface ChatThreadSnapshotDto {
  thread: ChatThreadDto;
  /**
   * Oldest first.
   */
  messages: ChatMessageDto[];
  hasEarlierMessages: boolean;
  /**
   * The unfinished run, or null.
   */
  activeRun: ChatRunDto | null;
  /**
   * The most recent `completed`, `failed` or `cancelled` run, or null.
   */
  latestRun: ChatRunDto | null;
  /**
   * The open question while its sources are authorized, else null.
   */
  openQuestion: ChatQuestionDto | null;
  openProposals: ChatProposalDto[];
  /**
   * Non-open proposals named by a proposal block in `messages`.
   */
  referencedProposals: ChatProposalDto[];
  /**
   * The thread's last event sequence; subscribe with `after = eventCursor`.
   */
  eventCursor: number;
  /**
   * Oldest replayable sequence; `after` below `retainedFromSeq - 1` is `snapshot_required`.
   */
  retainedFromSeq: number;
}
export const chatThreadSnapshotDtoSchema: z.ZodType<ChatThreadSnapshotDto> = z.object({ "thread": chatThreadDtoSchema, "messages": z.array(chatMessageDtoSchema).max(100), "hasEarlierMessages": z.boolean(), "activeRun": chatRunDtoSchema.nullable(), "latestRun": chatRunDtoSchema.nullable(), "openQuestion": chatQuestionDtoSchema.nullable(), "openProposals": z.array(chatProposalDtoSchema), "referencedProposals": z.array(chatProposalDtoSchema), "eventCursor": z.int().min(0), "retainedFromSeq": z.int().min(1) });

/**
 * One persisted thread event. Every kind carries `threadId`, `seq` (strictly increasing per thread, gap-free in storage) and `createdAt`.
 */
export type ChatEventDto = {
  kind: "thread.updated";
  thread: ChatThreadDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "message.created";
  message: ChatMessageDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "message.delta";
  messageId: string;
  blockId: string;
  /**
   * Text appended to the block.
   */
  text: string;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "message.completed";
  message: ChatMessageDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "run.updated";
  run: ChatRunDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "tool.updated";
  runId: string;
  toolCallId: string;
  /**
   * Sanitized, user-facing progress label.
   */
  label: string;
  state: "requested" | "executing" | "completed" | "failed" | "cancelled";
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "question.opened";
  question: ChatQuestionDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "question.closed";
  question: ChatQuestionDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "proposal.revised";
  proposal: ChatProposalDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "proposal.created";
  proposal: ChatProposalDto;
  threadId: string;
  seq: number;
  createdAt: DateTime;
} | {
  kind: "content.invalidated";
  /**
   * Replace these messages from a fresh snapshot.
   */
  messageIds: string[];
  proposalIds: string[];
  threadId: string;
  seq: number;
  createdAt: DateTime;
};
export const chatEventDtoSchema: z.ZodType<ChatEventDto> = z.union([z.object({ "kind": z.literal("thread.updated"), "thread": chatThreadDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("message.created"), "message": chatMessageDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("message.delta"), "messageId": z.string(), "blockId": z.string(), "text": z.string(), "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("message.completed"), "message": chatMessageDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("run.updated"), "run": chatRunDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("tool.updated"), "runId": z.string(), "toolCallId": z.string(), "label": z.string(), "state": z.enum(["requested", "executing", "completed", "failed", "cancelled"]), "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("question.opened"), "question": chatQuestionDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("question.closed"), "question": chatQuestionDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("proposal.revised"), "proposal": chatProposalDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("proposal.created"), "proposal": chatProposalDtoSchema, "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema }), z.object({ "kind": z.literal("content.invalidated"), "messageIds": z.array(z.string()), "proposalIds": z.array(z.string()), "threadId": z.string(), "seq": z.int().min(1), "createdAt": dateTimeSchema })]);

/**
 * The JSON of one `data:` frame on the event stream. The stream itself is `text/event-stream` framing, not JSON.
 */
export type ChatStreamFrameDto = {
  type: "event";
  event: ChatEventDto;
} | {
  type: "snapshot_required";
  retainedFromSeq: number;
} | {
  type: "heartbeat";
  at: DateTime;
};
export const chatStreamFrameDtoSchema: z.ZodType<ChatStreamFrameDto> = z.union([z.object({ "type": z.literal("event"), "event": chatEventDtoSchema }), z.object({ "type": z.literal("snapshot_required"), "retainedFromSeq": z.int().min(1) }), z.object({ "type": z.literal("heartbeat"), "at": dateTimeSchema })]);

export interface ChatEventPageDto {
  events: ChatEventDto[];
  /**
   * The last returned `seq`, or the request's `after` when none; pass it as `after` next.
   */
  cursor: number;
  hasMore: boolean;
}
export const chatEventPageDtoSchema: z.ZodType<ChatEventPageDto> = z.object({ "events": z.array(chatEventDtoSchema).max(200), "cursor": z.int().min(0), "hasMore": z.boolean() });

export interface SubmitChatMessageBody {
  /**
   * Non-blank; idempotency key per thread.
   */
  clientRequestId: string;
  /**
   * Non-blank. Not validated on a replay.
   */
  text: string;
  /**
   * An option of the open question, when answering through a card option.
   */
  optionId?: string;
  /**
   * Authorizes Knowledgebase writes for the run this message starts or resumes.
   */
  knowledgebaseWrite?: ChatKnowledgebaseWriteDto | null;
}
export const submitChatMessageBodySchema: z.ZodType<SubmitChatMessageBody> = z.object({ "clientRequestId": z.string().max(200), "text": z.string().max(16000), "optionId": z.exactOptional(z.string()), "knowledgebaseWrite": z.exactOptional(chatKnowledgebaseWriteDtoSchema.nullable()) });

export interface CreateChatThreadBody {
  /**
   * Optional first message.
   */
  message?: SubmitChatMessageBody;
}
export const createChatThreadBodySchema: z.ZodType<CreateChatThreadBody> = z.object({ "message": z.exactOptional(submitChatMessageBodySchema) });

export interface CreateChatThreadResponse {
  thread: ChatThreadDto;
  message: ChatMessageDto | null;
  run: ChatRunDto | null;
}
export const createChatThreadResponseSchema: z.ZodType<CreateChatThreadResponse> = z.object({ "thread": chatThreadDtoSchema, "message": chatMessageDtoSchema.nullable(), "run": chatRunDtoSchema.nullable() });

/**
 * At least one of `title` and `archived` is required.
 */
export interface UpdateChatThreadBody {
  expectedRevision: number;
  /**
   * Non-blank; stored trimmed.
   */
  title?: string;
  archived?: boolean;
}
export const updateChatThreadBodySchema: z.ZodType<UpdateChatThreadBody> = z.object({ "expectedRevision": z.int().min(1), "title": z.exactOptional(z.string().max(80)), "archived": z.exactOptional(z.boolean()) });

export interface SubmitChatMessageResponse {
  message: ChatMessageDto;
  run: ChatRunDto;
  /**
   * True when an earlier submission with the same `clientRequestId` was answered.
   */
  replayed: boolean;
}
export const submitChatMessageResponseSchema: z.ZodType<SubmitChatMessageResponse> = z.object({ "message": chatMessageDtoSchema, "run": chatRunDtoSchema, "replayed": z.boolean() });

/**
 * `text`, or an `optionId` whose label becomes the text, is required.
 */
export interface AnswerChatQuestionBody {
  clientRequestId: string;
  expectedRevision: number;
  optionId?: string;
  text?: string;
}
export const answerChatQuestionBodySchema: z.ZodType<AnswerChatQuestionBody> = z.object({ "clientRequestId": z.string().max(200), "expectedRevision": z.int().min(1), "optionId": z.exactOptional(z.string()), "text": z.exactOptional(z.string().max(16000)) });

export interface CancelChatRunBody {
  clientRequestId: string;
}
export const cancelChatRunBodySchema: z.ZodType<CancelChatRunBody> = z.object({ "clientRequestId": z.string().max(200) });

export interface ContinueChatRunBody {
  clientRequestId: string;
}
export const continueChatRunBodySchema: z.ZodType<ContinueChatRunBody> = z.object({ "clientRequestId": z.string().max(200) });

export interface ContinueChatRunResponse {
  run: ChatRunDto;
  /**
   * True when a run already continued the addressed run.
   */
  replayed: boolean;
}
export const continueChatRunResponseSchema: z.ZodType<ContinueChatRunResponse> = z.object({ "run": chatRunDtoSchema, "replayed": z.boolean() });

export interface CreateFromChatProposalBody {
  /**
   * Non-blank; unique per owner across proposals.
   */
  clientRequestId: string;
  expectedRevision: number;
}
export const createFromChatProposalBodySchema: z.ZodType<CreateFromChatProposalBody> = z.object({ "clientRequestId": z.string().max(200), "expectedRevision": z.int().min(1) });

export interface CreateFromChatProposalResponse {
  proposal: ChatProposalDto;
  receipt: ChatCreationReceiptDto;
  replayed: boolean;
}
export const createFromChatProposalResponseSchema: z.ZodType<CreateFromChatProposalResponse> = z.object({ "proposal": chatProposalDtoSchema, "receipt": chatCreationReceiptDtoSchema, "replayed": z.boolean() });

export interface UpdateChatPresenceBody {
  clientId: string;
  platform: "ios" | "web" | "desktop";
  state: "foreground" | "released";
}
export const updateChatPresenceBodySchema: z.ZodType<UpdateChatPresenceBody> = z.object({ "clientId": z.string().max(200), "platform": z.enum(["ios", "web", "desktop"]), "state": z.enum(["foreground", "released"]) });

export interface ChatPresenceDto {
  clientId: string;
  expiresAt: DateTime | null;
}
export const chatPresenceDtoSchema: z.ZodType<ChatPresenceDto> = z.object({ "clientId": z.string(), "expiresAt": dateTimeSchema.nullable() });

export interface AckChatEventsBody {
  clientId: string;
  /**
   * At most the thread's last event sequence.
   */
  seq: number;
}
export const ackChatEventsBodySchema: z.ZodType<AckChatEventsBody> = z.object({ "clientId": z.string().max(200), "seq": z.int().min(0) });

export interface ChatAckDto {
  clientId: string;
  ackedSeq: number;
  suppressedNotificationIds: string[];
}
export const chatAckDtoSchema: z.ZodType<ChatAckDto> = z.object({ "clientId": z.string(), "ackedSeq": z.int().min(0), "suppressedNotificationIds": z.array(z.string()) });

export interface ChatProviderReadinessDto {
  provider: "gemini";
  model: string;
  state: "ready" | "not_configured" | "unavailable" | "rate_limited";
  checkedAt: DateTime;
}
export const chatProviderReadinessDtoSchema: z.ZodType<ChatProviderReadinessDto> = z.object({ "provider": z.literal("gemini"), "model": z.string(), "state": z.enum(["ready", "not_configured", "unavailable", "rate_limited"]), "checkedAt": dateTimeSchema });

export interface ChatProvidersResponse {
  providers: ChatProviderReadinessDto[];
  /**
   * The caller's organization-scoped connections in the selected organization.
   */
  connections: AccountConnectionDto[];
}
export const chatProvidersResponseSchema: z.ZodType<ChatProvidersResponse> = z.object({ "providers": z.array(chatProviderReadinessDtoSchema).min(1).max(1), "connections": z.array(accountConnectionDtoSchema) });

export interface ChatNotificationDto {
  id: string;
  type: "chat_needs_answer" | "chat_finished";
  organizationId: string;
  threadId: string;
  runId: string;
  questionId: string | null;
  /**
   * The thread title captured at dispatch (`''` when none).
   */
  threadTitle: string;
  createdAt: DateTime;
  dispatchedAt: DateTime;
  readAt: DateTime | null;
  revision: number;
}
export const chatNotificationDtoSchema: z.ZodType<ChatNotificationDto> = z.object({ "id": z.string(), "type": z.enum(["chat_needs_answer", "chat_finished"]), "organizationId": z.string(), "threadId": z.string(), "runId": z.string(), "questionId": z.string().nullable(), "threadTitle": z.string(), "createdAt": dateTimeSchema, "dispatchedAt": dateTimeSchema, "readAt": dateTimeSchema.nullable(), "revision": z.int().min(1) });

export interface ChatNotificationListResponse {
  items: ChatNotificationDto[];
  /**
   * Every unread dispatched notification in the selected organization.
   */
  unreadCount: number;
}
export const chatNotificationListResponseSchema: z.ZodType<ChatNotificationListResponse> = z.object({ "items": z.array(chatNotificationDtoSchema).max(100), "unreadCount": z.int().min(0) });

export interface MarkChatNotificationReadBody {
  expectedRevision: number;
}
export const markChatNotificationReadBodySchema: z.ZodType<MarkChatNotificationReadBody> = z.object({ "expectedRevision": z.int().min(1) });

export interface ChatDiagnosticDto {
  seq: number;
  threadId: string;
  runId: string | null;
  attemptId: string | null;
  /**
   * An event kind, `http.exchange`, or a provider observation kind.
   */
  kind: string;
  createdAt: DateTime;
  /**
   * Unredacted observation.
   */
  payload: JsonValue;
}
export const chatDiagnosticDtoSchema: z.ZodType<ChatDiagnosticDto> = z.object({ "seq": z.int().min(1), "threadId": z.string(), "runId": z.string().nullable(), "attemptId": z.string().nullable(), "kind": z.string(), "createdAt": dateTimeSchema, "payload": jsonValueSchema });

export interface ChatDiagnosticPageDto {
  entries: ChatDiagnosticDto[];
  /**
   * The last returned `seq`, or the request's `after` when none.
   */
  nextCursor: number;
  hasMore: boolean;
}
export const chatDiagnosticPageDtoSchema: z.ZodType<ChatDiagnosticPageDto> = z.object({ "entries": z.array(chatDiagnosticDtoSchema).max(100), "nextCursor": z.int().min(0), "hasMore": z.boolean() });

/**
 * The caller's Everhour connection state (never includes the key).
 */
export interface EverhourUserConnectionDto {
  connected: boolean;
  /**
   * The Everhour user's name when known; null when not connected.
   */
  accountName: string | null;
}
export const everhourUserConnectionDtoSchema: z.ZodType<EverhourUserConnectionDto> = z.object({ "connected": z.boolean(), "accountName": z.string().nullable() });

export interface UpdateEverhourIntegrationBody {
  /**
   * The caller's personal Everhour API key; coerced to a string and trimmed, never echoed.
   */
  apiKey: string;
}
export const updateEverhourIntegrationBodySchema: z.ZodType<UpdateEverhourIntegrationBody> = z.object({ "apiKey": z.string() });

export interface ProjectEverhourLinkDto {
  projectId: string;
  /**
   * The name submitted when linking.
   */
  everhourProjectName: string | null;
  everhourProjectId: string | null;
}
export const projectEverhourLinkDtoSchema: z.ZodType<ProjectEverhourLinkDto> = z.object({ "projectId": z.string(), "everhourProjectName": z.string().nullable(), "everhourProjectId": z.string().nullable() });

export interface LinkProjectEverhourBody {
  /**
   * A name to find or create; missing, null or blank unlinks.
   */
  everhourProjectName?: string | null;
}
export const linkProjectEverhourBodySchema: z.ZodType<LinkProjectEverhourBody> = z.object({ "everhourProjectName": z.exactOptional(z.string().nullable()) });

export interface EverhourTimeRecordDto {
  /**
   * Everhour's record id as a string; records without an id are dropped.
   */
  id: string;
  timeSeconds: number;
  /**
   * `YYYY-MM-DD` as reported by Everhour (`''` when Everhour gives none).
   */
  date: string;
  comment: string | null;
}
export const everhourTimeRecordDtoSchema: z.ZodType<EverhourTimeRecordDto> = z.object({ "id": z.string(), "timeSeconds": z.number(), "date": z.string(), "comment": z.string().nullable() });

export interface EverhourTimerDto {
  taskId: string;
  /**
   * Everhour's start time as reported (`YYYY-MM-DD HH:MM:SS`), not ISO-8601.
   */
  startedAt: string | null;
  durationSeconds: number;
  comment: string | null;
}
export const everhourTimerDtoSchema: z.ZodType<EverhourTimerDto> = z.object({ "taskId": z.string(), "startedAt": z.string().nullable(), "durationSeconds": z.number(), "comment": z.string().nullable() });

export interface MissionEverhourStateDto {
  /**
   * True when the caller's Everhour key could be read.
   */
  connected: boolean;
  projectLinked: boolean;
  taskId: string | null;
  /**
   * Newest date first; empty without a connection or task.
   */
  records: EverhourTimeRecordDto[];
  totalSeconds: number;
  /**
   * The caller's running timer when it is on this mission's task, else null.
   */
  runningTimer: EverhourTimerDto | null;
}
export const missionEverhourStateDtoSchema: z.ZodType<MissionEverhourStateDto> = z.object({ "connected": z.boolean(), "projectLinked": z.boolean(), "taskId": z.string().nullable(), "records": z.array(everhourTimeRecordDtoSchema), "totalSeconds": z.number(), "runningTimer": everhourTimerDtoSchema.nullable() });

export interface ProjectEverhourStateDto {
  /**
   * True when the caller's Everhour key could be read.
   */
  connected: boolean;
  projectLinked: boolean;
  /**
   * The project's `general` task, or null before one is created.
   */
  taskId: string | null;
  /**
   * Newest date first; empty without a connection or task.
   */
  records: EverhourTimeRecordDto[];
  totalSeconds: number;
  /**
   * The caller's running timer when it is on the `general` task, else null.
   */
  runningTimer: EverhourTimerDto | null;
  /**
   * True when the caller's running timer is on the `general` task or any of the project's mission tasks.
   */
  hasRunningTimerInProject: boolean;
}
export const projectEverhourStateDtoSchema: z.ZodType<ProjectEverhourStateDto> = z.object({ "connected": z.boolean(), "projectLinked": z.boolean(), "taskId": z.string().nullable(), "records": z.array(everhourTimeRecordDtoSchema), "totalSeconds": z.number(), "runningTimer": everhourTimerDtoSchema.nullable(), "hasRunningTimerInProject": z.boolean() });

export interface CreateEverhourTimeBody {
  /**
   * Greater than 0; rounded to whole seconds.
   */
  timeSeconds: number;
  /**
   * `YYYY-MM-DD`; defaults to today's UTC date when missing or blank.
   */
  date?: string;
  /**
   * Omitted when null or blank.
   */
  comment?: string | null;
}
export const createEverhourTimeBodySchema: z.ZodType<CreateEverhourTimeBody> = z.object({ "timeSeconds": z.number(), "date": z.exactOptional(z.string()), "comment": z.exactOptional(z.string().nullable()) });

export interface UpdateEverhourTimeBody {
  /**
   * Greater than 0; rounded to whole seconds.
   */
  timeSeconds: number;
  /**
   * When present, replaces the comment (trimmed); null clears it.
   */
  comment?: string | null;
}
export const updateEverhourTimeBodySchema: z.ZodType<UpdateEverhourTimeBody> = z.object({ "timeSeconds": z.number(), "comment": z.exactOptional(z.string().nullable()) });

export interface GitHubUserAccountDto {
  id: string;
  login: string;
  avatarUrl: string | null;
}
export const gitHubUserAccountDtoSchema: z.ZodType<GitHubUserAccountDto> = z.object({ "id": z.string(), "login": z.string(), "avatarUrl": z.string().nullable() });

export interface GitHubUserConnectionDto {
  configured: boolean;
  connected: boolean;
  /**
   * Set while connected and the account's id and login are known.
   */
  account: GitHubUserAccountDto | null;
  /**
   * Granted OAuth scopes; empty unless connected.
   */
  scopes: string[];
}
export const gitHubUserConnectionDtoSchema: z.ZodType<GitHubUserConnectionDto> = z.object({ "configured": z.boolean(), "connected": z.boolean(), "account": gitHubUserAccountDtoSchema.nullable(), "scopes": z.array(z.string()) });

export interface GitHubUserAuthorizationDto {
  authorizationUrl: string;
}
export const gitHubUserAuthorizationDtoSchema: z.ZodType<GitHubUserAuthorizationDto> = z.object({ "authorizationUrl": z.string() });

export interface BeginGitHubUserAuthorizationBody {
  /**
   * `overlord://github/callback` or an `http(s)` URL on an allowed browser origin.
   */
  returnTo?: string;
}
export const beginGitHubUserAuthorizationBodySchema: z.ZodType<BeginGitHubUserAuthorizationBody> = z.object({ "returnTo": z.exactOptional(z.string()) });

export interface GitHubRepositoryOwnerDto {
  login: string;
  type: "personal" | "organization";
  avatarUrl: string | null;
  canCreateRepositories: true;
}
export const gitHubRepositoryOwnerDtoSchema: z.ZodType<GitHubRepositoryOwnerDto> = z.object({ "login": z.string(), "type": z.enum(["personal", "organization"]), "avatarUrl": z.string().nullable(), "canCreateRepositories": z.literal(true) });

/**
 * The personal account first, then organizations by login.
 */
export type GitHubRepositoryOwnerList = GitHubRepositoryOwnerDto[];
export const gitHubRepositoryOwnerListSchema: z.ZodType<GitHubRepositoryOwnerList> = z.array(gitHubRepositoryOwnerDtoSchema).min(1);

export interface GitHubIntegrationDto {
  /**
   * Whether the GitHub App is configured on this server.
   */
  configured: boolean;
  /**
   * Whether the workspace has a live installation record.
   */
  connected: boolean;
  accountLogin: string | null;
  accountType: string | null;
  /**
   * The workspace's name (never null; `''` if the workspace was deleted).
   */
  workspaceName: string;
}
export const gitHubIntegrationDtoSchema: z.ZodType<GitHubIntegrationDto> = z.object({ "configured": z.boolean(), "connected": z.boolean(), "accountLogin": z.string().nullable(), "accountType": z.string().nullable(), "workspaceName": z.string() });

export interface GitHubInstallUrlDto {
  installUrl: string;
}
export const gitHubInstallUrlDtoSchema: z.ZodType<GitHubInstallUrlDto> = z.object({ "installUrl": z.string() });

export interface GitHubRepoSummaryDto {
  id: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}
export const gitHubRepoSummaryDtoSchema: z.ZodType<GitHubRepoSummaryDto> = z.object({ "id": z.string(), "fullName": z.string(), "defaultBranch": z.string(), "private": z.boolean() });

export type GitHubRepoSummaryList = GitHubRepoSummaryDto[];
export const gitHubRepoSummaryListSchema: z.ZodType<GitHubRepoSummaryList> = z.array(gitHubRepoSummaryDtoSchema).max(100);

export interface ProjectGitHubLinkDto {
  projectId: string;
  repo: GitHubRepoSummaryDto | null;
}
export const projectGitHubLinkDtoSchema: z.ZodType<ProjectGitHubLinkDto> = z.object({ "projectId": z.string(), "repo": gitHubRepoSummaryDtoSchema.nullable() });

export interface LinkProjectGitHubBody {
  /**
   * `owner/name`; missing, null, non-string or blank unlinks.
   */
  repoFullName?: string | null;
}
export const linkProjectGitHubBodySchema: z.ZodType<LinkProjectGitHubBody> = z.object({ "repoFullName": z.exactOptional(z.string().nullable()) });

export interface GitHubPullRequestDto {
  number: number;
  url: string;
  /**
   * The state GitHub reported when the pull request was opened.
   */
  state: "open" | "closed";
  headBranch: string;
  baseBranch: string;
}
export const gitHubPullRequestDtoSchema: z.ZodType<GitHubPullRequestDto> = z.object({ "number": z.int().min(1), "url": z.string(), "state": z.enum(["open", "closed"]), "headBranch": z.string(), "baseBranch": z.string() });

export interface CreateGitHubPullRequestBody {
  /**
   * Defaults to the mission title when missing or blank.
   */
  title?: string;
  /**
   * Omitted when missing or blank.
   */
  body?: string;
  /**
   * Coerced to a boolean; default false.
   */
  draft?: boolean;
}
export const createGitHubPullRequestBodySchema: z.ZodType<CreateGitHubPullRequestBody> = z.object({ "title": z.exactOptional(z.string()), "body": z.exactOptional(z.string()), "draft": z.exactOptional(z.boolean()) });

// ---- Operation schemas ----

/**
 * How a body is carried. `json` and `form` bodies are parsed into `schema`;
 * `text` bodies are strings; `event-stream` responses are Server-Sent Events
 * whose `data` is `event`; `binary` bodies are raw bytes.
 */
export type ApiMediaDescriptor =
  | { readonly kind: 'json' | 'form' | 'text' | 'binary'; readonly schema: z.ZodType }
  | { readonly kind: 'event-stream'; readonly event: z.ZodType };

/** A response: its header names and its bodies by media type (none for 204 or a redirect). */
export interface ApiResponseDescriptor {
  readonly headers: readonly string[];
  readonly content: { readonly [mediaType: string]: ApiMediaDescriptor };
}

/** One operation of the REST surface (ADRs 0006, 0048). */
export interface ApiOperationDescriptor {
  readonly operationId: string;
  readonly method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'PATCH' | 'TRACE';
  readonly path: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  readonly permission: string;
  readonly permissionCandidates: readonly string[];
  readonly edition: string;
  readonly consumers: readonly string[];
  readonly extension: string | null;
  /** Alternative requirements; an empty object means the operation also runs unauthenticated. */
  readonly security: readonly { readonly [scheme: string]: readonly string[] }[];
  /** Parameter schemas by location; header names are lower case. */
  readonly parameters: {
    readonly path: z.ZodType | null;
    readonly query: z.ZodType | null;
    readonly header: z.ZodType | null;
  };
  readonly requestBody: {
    readonly required: boolean;
    readonly content: { readonly [mediaType: string]: ApiMediaDescriptor };
  } | null;
  readonly responses: { readonly [status: string]: ApiResponseDescriptor };
}

export type GetAuthDesktopGithubResponse503Text = string;
export const getAuthDesktopGithubResponse503TextSchema: z.ZodType<GetAuthDesktopGithubResponse503Text> = z.string();

export interface GetAuthDesktopCallbackQueryParams {
  /**
   * An OAuth error code from Better Auth or GitHub; its presence selects the error path.
   */
  error?: string;
}
export const getAuthDesktopCallbackQueryParamsSchema: z.ZodType<GetAuthDesktopCallbackQueryParams> = z.object({ "error": z.exactOptional(z.string()) });

export type GetAuthDesktopCallbackResponse400Text = string;
export const getAuthDesktopCallbackResponse400TextSchema: z.ZodType<GetAuthDesktopCallbackResponse400Text> = z.string();

export interface GetAuthBrowserCallbackQueryParams {
  /**
   * An absolute URL; only its origin is used, and it must be one of the server's allowed browser origins (400 otherwise).
   */
  returnTo: string;
}
export const getAuthBrowserCallbackQueryParamsSchema: z.ZodType<GetAuthBrowserCallbackQueryParams> = z.object({ "returnTo": z.string() });

export type GetAuthBrowserCallbackResponse400Text = string;
export const getAuthBrowserCallbackResponse400TextSchema: z.ZodType<GetAuthBrowserCallbackResponse400Text> = z.string();

export type GetAuthBrowserCallbackResponse401Text = string;
export const getAuthBrowserCallbackResponse401TextSchema: z.ZodType<GetAuthBrowserCallbackResponse401Text> = z.string();

export interface GetAuthCallbackGithubRepositoryQueryParams {
  /**
   * The authorization code GitHub issued.
   */
  code?: string;
  /**
   * The state minted when the connection started; unknown, used or expired answers `expired`.
   */
  state?: string;
  /**
   * GitHub's error code (`access_denied` reports `denied`).
   */
  error?: string;
}
export const getAuthCallbackGithubRepositoryQueryParamsSchema: z.ZodType<GetAuthCallbackGithubRepositoryQueryParams> = z.object({ "code": z.exactOptional(z.string()), "state": z.exactOptional(z.string()), "error": z.exactOptional(z.string()) });

export type GetAuthCallbackGithubRepositoryResponse200Text = string;
export const getAuthCallbackGithubRepositoryResponse200TextSchema: z.ZodType<GetAuthCallbackGithubRepositoryResponse200Text> = z.string();

export type GetAuthCallbackGithubRepositoryResponse400Text = string;
export const getAuthCallbackGithubRepositoryResponse400TextSchema: z.ZodType<GetAuthCallbackGithubRepositoryResponse400Text> = z.string();

export type PostOauthRegisterResponse400 = OAuthErrorBody | ErrorEnvelope;
export const postOauthRegisterResponse400Schema: z.ZodType<PostOauthRegisterResponse400> = z.union([oAuthErrorBodySchema, errorEnvelopeSchema]);

export type PostOauthTokenResponse400 = OAuthErrorBody | ErrorEnvelope;
export const postOauthTokenResponse400Schema: z.ZodType<PostOauthTokenResponse400> = z.union([oAuthErrorBodySchema, errorEnvelopeSchema]);

export type PostMcpRequestBody = JsonRpcRequest | JsonRpcRequest[];
export const postMcpRequestBodySchema: z.ZodType<PostMcpRequestBody> = z.union([jsonRpcRequestSchema, z.array(jsonRpcRequestSchema)]);

export type PostMcpResponse200 = JsonRpcResponse | JsonRpcResponse[];
export const postMcpResponse200Schema: z.ZodType<PostMcpResponse200> = z.union([jsonRpcResponseSchema, z.array(jsonRpcResponseSchema)]);

export interface GetAgentSessionChannelsV1RequestsByIdPathParams {
  /**
   * Agent request UUID. A request of another channel, or an unknown one, answers 404 `request_not_found`.
   */
  id: string;
}
export const getAgentSessionChannelsV1RequestsByIdPathParamsSchema: z.ZodType<GetAgentSessionChannelsV1RequestsByIdPathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1RequestsByIdLeasePathParams {
  /**
   * Agent request UUID. A request of another channel, or an unknown one, answers 404 `request_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1RequestsByIdLeasePathParamsSchema: z.ZodType<PostAgentSessionChannelsV1RequestsByIdLeasePathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1RequestsByIdReleasePathParams {
  /**
   * Agent request UUID. A request of another channel, or an unknown one, answers 404 `request_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1RequestsByIdReleasePathParamsSchema: z.ZodType<PostAgentSessionChannelsV1RequestsByIdReleasePathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1RequestsByIdApplicationPathParams {
  /**
   * Agent request UUID. A request of another channel, or an unknown one, answers 404 `request_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1RequestsByIdApplicationPathParamsSchema: z.ZodType<PostAgentSessionChannelsV1RequestsByIdApplicationPathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1RequestsByIdResolvedElsewherePathParams {
  /**
   * Agent request UUID. A request of another channel, or an unknown one, answers 404 `request_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1RequestsByIdResolvedElsewherePathParamsSchema: z.ZodType<PostAgentSessionChannelsV1RequestsByIdResolvedElsewherePathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1InputsByIdEmittedPathParams {
  /**
   * Session input UUID. An input of another channel, or an unknown one, answers 404 `input_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1InputsByIdEmittedPathParamsSchema: z.ZodType<PostAgentSessionChannelsV1InputsByIdEmittedPathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1InputsByIdEmittedResponse200 {
  emitted: boolean;
}
export const postAgentSessionChannelsV1InputsByIdEmittedResponse200Schema: z.ZodType<PostAgentSessionChannelsV1InputsByIdEmittedResponse200> = z.object({ "emitted": z.boolean() });

export interface PostAgentSessionChannelsV1InputsByIdAcknowledgedPathParams {
  /**
   * Session input UUID. An input of another channel, or an unknown one, answers 404 `input_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1InputsByIdAcknowledgedPathParamsSchema: z.ZodType<PostAgentSessionChannelsV1InputsByIdAcknowledgedPathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1InputsByIdAcknowledgedResponse200 {
  acknowledged: boolean;
}
export const postAgentSessionChannelsV1InputsByIdAcknowledgedResponse200Schema: z.ZodType<PostAgentSessionChannelsV1InputsByIdAcknowledgedResponse200> = z.object({ "acknowledged": z.boolean() });

export interface PostAgentSessionChannelsV1InputsByIdFailedPathParams {
  /**
   * Session input UUID. An input of another channel, or an unknown one, answers 404 `input_not_found`.
   */
  id: string;
}
export const postAgentSessionChannelsV1InputsByIdFailedPathParamsSchema: z.ZodType<PostAgentSessionChannelsV1InputsByIdFailedPathParams> = z.object({ "id": z.string() });

export interface PostAgentSessionChannelsV1InputsByIdFailedResponse200 {
  failed: boolean;
}
export const postAgentSessionChannelsV1InputsByIdFailedResponse200Schema: z.ZodType<PostAgentSessionChannelsV1InputsByIdFailedResponse200> = z.object({ "failed": z.boolean() });

export interface GetConnectionsKnowledgebaseCallbackQueryParams {
  /**
   * The authorization code.
   */
  code?: string;
  /**
   * The state minted by `POST /api/connections`.
   */
  state?: string;
  /**
   * The authorization server's error code.
   */
  error?: string;
}
export const getConnectionsKnowledgebaseCallbackQueryParamsSchema: z.ZodType<GetConnectionsKnowledgebaseCallbackQueryParams> = z.object({ "code": z.exactOptional(z.string()), "state": z.exactOptional(z.string()), "error": z.exactOptional(z.string()) });

export type GetConnectionsKnowledgebaseCallbackResponse200Text = string;
export const getConnectionsKnowledgebaseCallbackResponse200TextSchema: z.ZodType<GetConnectionsKnowledgebaseCallbackResponse200Text> = z.string();

export type GetConnectionsKnowledgebaseCallbackResponse400Text = string;
export const getConnectionsKnowledgebaseCallbackResponse400TextSchema: z.ZodType<GetConnectionsKnowledgebaseCallbackResponse400Text> = z.string();

export interface GetChatThreadsQueryParams {
  /**
   * `1` includes archived threads; any other value excludes them.
   */
  archived?: string;
  /**
   * The opaque `nextCursor` of the previous page. A value that does not decode to a cursor answers 400 `invalid_request`.
   */
  cursor?: string;
}
export const getChatThreadsQueryParamsSchema: z.ZodType<GetChatThreadsQueryParams> = z.object({ "archived": z.exactOptional(z.string()), "cursor": z.exactOptional(z.string()) });

export interface GetChatThreadsByIdPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const getChatThreadsByIdPathParamsSchema: z.ZodType<GetChatThreadsByIdPathParams> = z.object({ "id": z.string() });

export interface GetChatThreadsByIdQueryParams {
  /**
   * A message id of this thread: answers the 100 messages before it instead of the newest. An id that is not a message of the thread yields an empty `messages` page.
   */
  before?: string;
}
export const getChatThreadsByIdQueryParamsSchema: z.ZodType<GetChatThreadsByIdQueryParams> = z.object({ "before": z.exactOptional(z.string()) });

export interface PatchChatThreadsByIdPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const patchChatThreadsByIdPathParamsSchema: z.ZodType<PatchChatThreadsByIdPathParams> = z.object({ "id": z.string() });

export interface GetChatThreadsByIdDiagnosticsPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const getChatThreadsByIdDiagnosticsPathParamsSchema: z.ZodType<GetChatThreadsByIdDiagnosticsPathParams> = z.object({ "id": z.string() });

export interface GetChatThreadsByIdDiagnosticsQueryParams {
  /**
   * Return entries with `seq` greater than this; decimal digits only, default `0` (400 `invalid_request` otherwise).
   */
  after?: string;
}
export const getChatThreadsByIdDiagnosticsQueryParamsSchema: z.ZodType<GetChatThreadsByIdDiagnosticsQueryParams> = z.object({ "after": z.exactOptional(z.string()) });

export interface PostChatThreadsByIdMessagesPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const postChatThreadsByIdMessagesPathParamsSchema: z.ZodType<PostChatThreadsByIdMessagesPathParams> = z.object({ "id": z.string() });

export interface PutChatThreadsByIdPresencePathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const putChatThreadsByIdPresencePathParamsSchema: z.ZodType<PutChatThreadsByIdPresencePathParams> = z.object({ "id": z.string() });

export interface PostChatThreadsByIdAckPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const postChatThreadsByIdAckPathParamsSchema: z.ZodType<PostChatThreadsByIdAckPathParams> = z.object({ "id": z.string() });

export interface PostChatNotificationsByIdReadPathParams {
  /**
   * Conversation notification UUID. Only the caller's dispatched, non-dismissed notifications in the selected organization resolve; any other id answers 404 `not_found`.
   */
  id: string;
}
export const postChatNotificationsByIdReadPathParamsSchema: z.ZodType<PostChatNotificationsByIdReadPathParams> = z.object({ "id": z.string() });

export interface PostChatProposalsByIdCreatePathParams {
  /**
   * Work proposal UUID. A proposal in another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const postChatProposalsByIdCreatePathParamsSchema: z.ZodType<PostChatProposalsByIdCreatePathParams> = z.object({ "id": z.string() });

export interface PostChatQuestionsByIdAnswerPathParams {
  /**
   * Question UUID. An unknown id, or a question in another owner's or organization's thread, answers 404 `not_found`.
   */
  id: string;
}
export const postChatQuestionsByIdAnswerPathParamsSchema: z.ZodType<PostChatQuestionsByIdAnswerPathParams> = z.object({ "id": z.string() });

export interface PostChatRunsByIdCancelPathParams {
  /**
   * Run UUID. An unknown id, or a run in another owner's or organization's thread, answers 404 `not_found`.
   */
  id: string;
}
export const postChatRunsByIdCancelPathParamsSchema: z.ZodType<PostChatRunsByIdCancelPathParams> = z.object({ "id": z.string() });

export interface PostChatRunsByIdContinuePathParams {
  /**
   * Run UUID. An unknown id, or a run in another owner's or organization's thread, answers 404 `not_found`.
   */
  id: string;
}
export const postChatRunsByIdContinuePathParamsSchema: z.ZodType<PostChatRunsByIdContinuePathParams> = z.object({ "id": z.string() });

export interface GetChatThreadsByIdEventsPathParams {
  /**
   * Chat thread UUID. Another owner's or organization's thread, or an unknown id, answers 404 `not_found`.
   */
  id: string;
}
export const getChatThreadsByIdEventsPathParamsSchema: z.ZodType<GetChatThreadsByIdEventsPathParams> = z.object({ "id": z.string() });

export interface GetChatThreadsByIdEventsQueryParams {
  /**
   * The last sequence already applied (a snapshot's `eventCursor`), decimal digits. Missing, malformed, or greater than the thread's last event sequence answers 400 `invalid_request`; below `retainedFromSeq - 1` answers 409 `snapshot_required`.
   */
  after: string;
  /**
   * `1` answers one JSON page instead of a stream.
   */
  poll?: string;
}
export const getChatThreadsByIdEventsQueryParamsSchema: z.ZodType<GetChatThreadsByIdEventsQueryParams> = z.object({ "after": z.string(), "poll": z.exactOptional(z.string()) });

export interface GetConnectionsQueryParams {
  /**
   * `all` selects the combined listing; any other value is the default listing.
   */
  scope?: string;
}
export const getConnectionsQueryParamsSchema: z.ZodType<GetConnectionsQueryParams> = z.object({ "scope": z.exactOptional(z.string()) });

export interface DeleteConnectionsByIdPathParams {
  /**
   * The connection id; another owner's or organization's id answers 404 `not_found`.
   */
  id: string;
}
export const deleteConnectionsByIdPathParamsSchema: z.ZodType<DeleteConnectionsByIdPathParams> = z.object({ "id": z.string() });

export interface PatchConnectionsByIdPathParams {
  /**
   * The connection id; another owner's or organization's id answers 404 `not_found`.
   */
  id: string;
}
export const patchConnectionsByIdPathParamsSchema: z.ZodType<PatchConnectionsByIdPathParams> = z.object({ "id": z.string() });

export interface GetDiagnosticsExecutionTargetMigrationQueryParams {
  /**
   * Workspace UUID, trimmed; blank or absent answers 400.
   */
  workspaceId: string;
}
export const getDiagnosticsExecutionTargetMigrationQueryParamsSchema: z.ZodType<GetDiagnosticsExecutionTargetMigrationQueryParams> = z.object({ "workspaceId": z.string() });

export interface PatchOrganizationsByIdPathParams {
  /**
   * Organization UUID; an unknown or deleted organization answers 404.
   */
  id: string;
}
export const patchOrganizationsByIdPathParamsSchema: z.ZodType<PatchOrganizationsByIdPathParams> = z.object({ "id": z.string() });

export interface GetOrganizationsByIdAdminsPathParams {
  /**
   * Organization UUID; an unknown or deleted organization answers 404.
   */
  id: string;
}
export const getOrganizationsByIdAdminsPathParamsSchema: z.ZodType<GetOrganizationsByIdAdminsPathParams> = z.object({ "id": z.string() });

export interface PostOrganizationsByIdAdminsPathParams {
  /**
   * Organization UUID; an unknown or deleted organization answers 404.
   */
  id: string;
}
export const postOrganizationsByIdAdminsPathParamsSchema: z.ZodType<PostOrganizationsByIdAdminsPathParams> = z.object({ "id": z.string() });

export interface DeleteOrganizationsByIdAdminsByUserIdPathParams {
  /**
   * Organization UUID; an unknown or deleted organization answers 404.
   */
  id: string;
  /**
   * Profile id of the admin to remove; a profile that is not an organization admin answers 404.
   */
  userId: string;
}
export const deleteOrganizationsByIdAdminsByUserIdPathParamsSchema: z.ZodType<DeleteOrganizationsByIdAdminsByUserIdPathParams> = z.object({ "id": z.string(), "userId": z.string() });

export interface DeleteWorkspacesByIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const deleteWorkspacesByIdPathParamsSchema: z.ZodType<DeleteWorkspacesByIdPathParams> = z.object({ "id": z.string() });

export interface PatchWorkspacesByIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const patchWorkspacesByIdPathParamsSchema: z.ZodType<PatchWorkspacesByIdPathParams> = z.object({ "id": z.string() });

export interface GetWorkspacesByIdMembersPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const getWorkspacesByIdMembersPathParamsSchema: z.ZodType<GetWorkspacesByIdMembersPathParams> = z.object({ "id": z.string() });

export interface DeleteWorkspacesByIdMembersByWorkspaceUserIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * The member's `workspace_users` id in that workspace; an unknown or inactive one answers 404.
   */
  workspaceUserId: string;
}
export const deleteWorkspacesByIdMembersByWorkspaceUserIdPathParamsSchema: z.ZodType<DeleteWorkspacesByIdMembersByWorkspaceUserIdPathParams> = z.object({ "id": z.string(), "workspaceUserId": z.string() });

export interface PatchWorkspacesByIdMembersByWorkspaceUserIdRolePathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * The member's `workspace_users` id in that workspace; an unknown or inactive one answers 404.
   */
  workspaceUserId: string;
}
export const patchWorkspacesByIdMembersByWorkspaceUserIdRolePathParamsSchema: z.ZodType<PatchWorkspacesByIdMembersByWorkspaceUserIdRolePathParams> = z.object({ "id": z.string(), "workspaceUserId": z.string() });

export interface GetWorkspacesByIdInvitationsPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const getWorkspacesByIdInvitationsPathParamsSchema: z.ZodType<GetWorkspacesByIdInvitationsPathParams> = z.object({ "id": z.string() });

export interface PostWorkspacesByIdInvitationsPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const postWorkspacesByIdInvitationsPathParamsSchema: z.ZodType<PostWorkspacesByIdInvitationsPathParams> = z.object({ "id": z.string() });

export interface DeleteWorkspacesByIdInvitationsByInvitationIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * Invitation UUID in that workspace; an unknown or deleted one answers 404.
   */
  invitationId: string;
}
export const deleteWorkspacesByIdInvitationsByInvitationIdPathParamsSchema: z.ZodType<DeleteWorkspacesByIdInvitationsByInvitationIdPathParams> = z.object({ "id": z.string(), "invitationId": z.string() });

export interface GetWorkspacesByIdObjectivesCsvPathParams {
  /**
   * Workspace UUID; an unknown workspace, or one the caller is not an active member of, answers 404.
   */
  id: string;
}
export const getWorkspacesByIdObjectivesCsvPathParamsSchema: z.ZodType<GetWorkspacesByIdObjectivesCsvPathParams> = z.object({ "id": z.string() });

export type GetWorkspacesByIdObjectivesCsvResponse200Text = string;
export const getWorkspacesByIdObjectivesCsvResponse200TextSchema: z.ZodType<GetWorkspacesByIdObjectivesCsvResponse200Text> = z.string();

export interface GetWorkspacesByIdProjectsPathParams {
  /**
   * Workspace UUID.
   */
  id: string;
}
export const getWorkspacesByIdProjectsPathParamsSchema: z.ZodType<GetWorkspacesByIdProjectsPathParams> = z.object({ "id": z.string() });

export interface GetWorkspacesByIdProjectsQueryParams {
  /**
   * Lifecycle filter; the first value is used when repeated. Defaults to `active`.
   */
  lifecycle?: ProjectListLifecycle;
}
export const getWorkspacesByIdProjectsQueryParamsSchema: z.ZodType<GetWorkspacesByIdProjectsQueryParams> = z.object({ "lifecycle": z.exactOptional(projectListLifecycleSchema) });

export interface GetWorkspacesByIdProjectStatusesPathParams {
  /**
   * Workspace UUID.
   */
  id: string;
}
export const getWorkspacesByIdProjectStatusesPathParamsSchema: z.ZodType<GetWorkspacesByIdProjectStatusesPathParams> = z.object({ "id": z.string() });

export interface GetWorkspacesByIdExecutionTargetsPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const getWorkspacesByIdExecutionTargetsPathParamsSchema: z.ZodType<GetWorkspacesByIdExecutionTargetsPathParams> = z.object({ "id": z.string() });

export interface PostWorkspacesByIdExecutionTargetsPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const postWorkspacesByIdExecutionTargetsPathParamsSchema: z.ZodType<PostWorkspacesByIdExecutionTargetsPathParams> = z.object({ "id": z.string() });

export interface PostWorkspacesByIdExecutionTargetsHeaderParams {
  /**
   * The calling machine's fingerprint. On a hosted (Postgres) backend this identifies the acting machine; a co-located Local (SQLite) backend ignores it and acts as its own host. A browser pseudo-device or the backend host's own fingerprint never resolves to a target.
   */
  "x-overlord-device-fingerprint"?: string;
  /**
   * Display label for a machine registered by this request.
   */
  "x-overlord-device-label"?: string;
  /**
   * Platform name of the calling machine (`browser` marks a browser pseudo-device).
   */
  "x-overlord-device-platform"?: string;
}
export const postWorkspacesByIdExecutionTargetsHeaderParamsSchema: z.ZodType<PostWorkspacesByIdExecutionTargetsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()), "x-overlord-device-label": z.exactOptional(z.string()), "x-overlord-device-platform": z.exactOptional(z.string()) });

export interface DeleteWorkspacesByIdExecutionTargetsByTargetIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * Execution target id in that workspace; an unknown or deleted target answers 404.
   */
  targetId: string;
}
export const deleteWorkspacesByIdExecutionTargetsByTargetIdPathParamsSchema: z.ZodType<DeleteWorkspacesByIdExecutionTargetsByTargetIdPathParams> = z.object({ "id": z.string(), "targetId": z.string() });

export interface PatchWorkspacesByIdExecutionTargetsByTargetIdPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * Execution target id in that workspace; an unknown or deleted target answers 404.
   */
  targetId: string;
}
export const patchWorkspacesByIdExecutionTargetsByTargetIdPathParamsSchema: z.ZodType<PatchWorkspacesByIdExecutionTargetsByTargetIdPathParams> = z.object({ "id": z.string(), "targetId": z.string() });

export interface GetWorkspacesByIdAgentCatalogPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const getWorkspacesByIdAgentCatalogPathParamsSchema: z.ZodType<GetWorkspacesByIdAgentCatalogPathParams> = z.object({ "id": z.string() });

export interface PutWorkspacesByIdAgentCatalogPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const putWorkspacesByIdAgentCatalogPathParamsSchema: z.ZodType<PutWorkspacesByIdAgentCatalogPathParams> = z.object({ "id": z.string() });

export interface PostWorkspacesByIdAgentCatalogRefreshPathParams {
  /**
   * Workspace UUID; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const postWorkspacesByIdAgentCatalogRefreshPathParamsSchema: z.ZodType<PostWorkspacesByIdAgentCatalogRefreshPathParams> = z.object({ "id": z.string() });

export interface DeleteUserTokensByIdPathParams {
  /**
   * Token id (any string); a token another profile owns, or a deleted one, answers 404.
   */
  id: string;
}
export const deleteUserTokensByIdPathParamsSchema: z.ZodType<DeleteUserTokensByIdPathParams> = z.object({ "id": z.string() });

export interface PatchUserTokensByIdPathParams {
  /**
   * Token id (any string); a token another profile owns, or a deleted one, answers 404.
   */
  id: string;
}
export const patchUserTokensByIdPathParamsSchema: z.ZodType<PatchUserTokensByIdPathParams> = z.object({ "id": z.string() });

export interface PostUserTokensByIdRevokePathParams {
  /**
   * Token id (any string); a token another profile owns, or a deleted one, answers 404.
   */
  id: string;
}
export const postUserTokensByIdRevokePathParamsSchema: z.ZodType<PostUserTokensByIdRevokePathParams> = z.object({ "id": z.string() });

export interface GetWebhooksQueryParams {
  /**
   * Workspace UUID, trimmed; blank or absent answers 400.
   */
  workspaceId: string;
}
export const getWebhooksQueryParamsSchema: z.ZodType<GetWebhooksQueryParams> = z.object({ "workspaceId": z.string() });

export interface DeleteWebhooksByIdPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
}
export const deleteWebhooksByIdPathParamsSchema: z.ZodType<DeleteWebhooksByIdPathParams> = z.object({ "id": z.string() });

export interface PatchWebhooksByIdPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
}
export const patchWebhooksByIdPathParamsSchema: z.ZodType<PatchWebhooksByIdPathParams> = z.object({ "id": z.string() });

export interface PostWebhooksByIdRotateSecretPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
}
export const postWebhooksByIdRotateSecretPathParamsSchema: z.ZodType<PostWebhooksByIdRotateSecretPathParams> = z.object({ "id": z.string() });

export interface PostWebhooksByIdTestPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
}
export const postWebhooksByIdTestPathParamsSchema: z.ZodType<PostWebhooksByIdTestPathParams> = z.object({ "id": z.string() });

export interface GetWebhooksByIdDeliveriesPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
}
export const getWebhooksByIdDeliveriesPathParamsSchema: z.ZodType<GetWebhooksByIdDeliveriesPathParams> = z.object({ "id": z.string() });

export interface GetWebhooksByIdDeliveriesQueryParams {
  /**
   * Only attempts with `attemptedAt` lexically before this value (not validated; pass a previous `attemptedAt`).
   */
  before?: string;
  /**
   * Page size, default 25, clamped to 1–100. Read with `Number()`; a value that is not an integer (`abc`, `2.5`) answers 500 `datatype mismatch` on SQLite (see schema-disagreements.md).
   */
  limit?: string;
}
export const getWebhooksByIdDeliveriesQueryParamsSchema: z.ZodType<GetWebhooksByIdDeliveriesQueryParams> = z.object({ "before": z.exactOptional(z.string()), "limit": z.exactOptional(z.string()) });

export interface PostWebhooksByIdDeliveriesByOutboxIdRedeliverPathParams {
  /**
   * Subscription UUID; an unknown, deleted or foreign subscription answers 404.
   */
  id: string;
  /**
   * The `outboxMessageId` of a delivery attempt of this subscription.
   */
  outboxId: string;
}
export const postWebhooksByIdDeliveriesByOutboxIdRedeliverPathParamsSchema: z.ZodType<PostWebhooksByIdDeliveriesByOutboxIdRedeliverPathParams> = z.object({ "id": z.string(), "outboxId": z.string() });

export interface PostUploadsByBucketKeyPathParams {
  /**
   * `user-images`, `workspace-images` or `organization-images`; any other value answers 404.
   */
  bucketKey: string;
}
export const postUploadsByBucketKeyPathParamsSchema: z.ZodType<PostUploadsByBucketKeyPathParams> = z.object({ "bucketKey": z.string() });

export interface PostUploadsByBucketKeyQueryParams {
  /**
   * Workspace UUID, trimmed. Required for `workspace-images` (400 without it); optional for `user-images`; ignored for `organization-images`. Authorized as above (404 outside the caller's authorized workspaces).
   */
  workspaceId?: string;
}
export const postUploadsByBucketKeyQueryParamsSchema: z.ZodType<PostUploadsByBucketKeyQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PostUploadsByBucketKeyHeaderParams {
  /**
   * The original filename, percent-encoded; defaults to `upload`, and a blank value to `image<ext>`. A malformed encoding answers 500.
   */
  "x-upload-filename"?: string;
}
export const postUploadsByBucketKeyHeaderParamsSchema: z.ZodType<PostUploadsByBucketKeyHeaderParams> = z.object({ "x-upload-filename": z.exactOptional(z.string()) });

export interface GetStorageByBucketKeyByStorageKeyPathParams {
  /**
   * `user-images`, `workspace-images`, `organization-images` or `attachments`; any other value answers 404.
   */
  bucketKey: string;
  /**
   * The object's backend key, percent-encoded as one segment (its `/` as `%2F`), exactly as in a stored object's `url`.
   */
  storageKey: string;
}
export const getStorageByBucketKeyByStorageKeyPathParamsSchema: z.ZodType<GetStorageByBucketKeyByStorageKeyPathParams> = z.object({ "bucketKey": z.string(), "storageKey": z.string() });

export interface GetStreamQueryParams {
  /**
   * Resume cursor (an `entity_changes.seq`). A non-negative number (floored); anything else is ignored and `Last-Event-ID` is tried.
   */
  after?: string;
}
export const getStreamQueryParamsSchema: z.ZodType<GetStreamQueryParams> = z.object({ "after": z.exactOptional(z.string()) });

export interface GetStreamHeaderParams {
  /**
   * The EventSource resume header, read like `after` when `after` is absent or invalid.
   */
  "last-event-id"?: string;
}
export const getStreamHeaderParamsSchema: z.ZodType<GetStreamHeaderParams> = z.object({ "last-event-id": z.exactOptional(z.string()) });

export interface GetRealtimeQueryParams {
  /**
   * Resume cursor (an `entity_changes.seq`). A non-negative number (floored); anything else is ignored and `Last-Event-ID` is tried.
   */
  after?: string;
}
export const getRealtimeQueryParamsSchema: z.ZodType<GetRealtimeQueryParams> = z.object({ "after": z.exactOptional(z.string()) });

export interface GetRealtimeHeaderParams {
  /**
   * The EventSource resume header, read like `after` when `after` is absent or invalid.
   */
  "last-event-id"?: string;
}
export const getRealtimeHeaderParamsSchema: z.ZodType<GetRealtimeHeaderParams> = z.object({ "last-event-id": z.exactOptional(z.string()) });

export interface GetSyncChangesQueryParams {
  /**
   * The cursor to read after (`0` for the beginning). Must be a non-negative number (floored); absent, blank, negative or non-numeric answers 400 `{ error }`.
   */
  after: string;
}
export const getSyncChangesQueryParamsSchema: z.ZodType<GetSyncChangesQueryParams> = z.object({ "after": z.string() });

export interface GetProjectsQueryParams {
  /**
   * Lifecycle filter; the first value is used when repeated. Defaults to `active`.
   */
  lifecycle?: ProjectListLifecycle;
}
export const getProjectsQueryParamsSchema: z.ZodType<GetProjectsQueryParams> = z.object({ "lifecycle": z.exactOptional(projectListLifecycleSchema) });

export interface GetProjectsByIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const getProjectsByIdPathParamsSchema: z.ZodType<GetProjectsByIdPathParams> = z.object({ "id": z.string() });

export interface DeleteProjectsByIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const deleteProjectsByIdPathParamsSchema: z.ZodType<DeleteProjectsByIdPathParams> = z.object({ "id": z.string() });

export interface PatchProjectsByIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const patchProjectsByIdPathParamsSchema: z.ZodType<PatchProjectsByIdPathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdRunQueuesPathParams {
  /**
   * Project UUID (display names are not accepted); an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const getProjectsByIdRunQueuesPathParamsSchema: z.ZodType<GetProjectsByIdRunQueuesPathParams> = z.object({ "id": z.string() });

export interface PostProjectsByIdRunQueuesPathParams {
  /**
   * Project UUID (display names are not accepted); an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const postProjectsByIdRunQueuesPathParamsSchema: z.ZodType<PostProjectsByIdRunQueuesPathParams> = z.object({ "id": z.string() });

export interface PatchProjectsByIdRunQueuesOrderPathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const patchProjectsByIdRunQueuesOrderPathParamsSchema: z.ZodType<PatchProjectsByIdRunQueuesOrderPathParams> = z.object({ "id": z.string() });

export interface PostProjectsByIdRunQueuesEntriesPathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const postProjectsByIdRunQueuesEntriesPathParamsSchema: z.ZodType<PostProjectsByIdRunQueuesEntriesPathParams> = z.object({ "id": z.string() });

export interface DeleteRunQueuesByQueueIdPathParams {
  /**
   * Run Queue UUID. A live queue in a project the caller cannot reach answers 404 `Project not found`; an unknown or deleted queue id answers 500 with `error: 'Run Queue not found'`.
   */
  queueId: string;
}
export const deleteRunQueuesByQueueIdPathParamsSchema: z.ZodType<DeleteRunQueuesByQueueIdPathParams> = z.object({ "queueId": z.string() });

export interface PatchRunQueuesByQueueIdPathParams {
  /**
   * Run Queue UUID. A live queue in a project the caller cannot reach answers 404 `Project not found`; an unknown or deleted queue id answers 500 with `error: 'Run Queue not found'`.
   */
  queueId: string;
}
export const patchRunQueuesByQueueIdPathParamsSchema: z.ZodType<PatchRunQueuesByQueueIdPathParams> = z.object({ "queueId": z.string() });

export interface PatchRunQueuesByQueueIdOrderPathParams {
  /**
   * Run Queue UUID. A live queue in a project the caller cannot reach answers 404 `Project not found`; an unknown or deleted queue id answers 500 with `error: 'Run Queue not found'`.
   */
  queueId: string;
}
export const patchRunQueuesByQueueIdOrderPathParamsSchema: z.ZodType<PatchRunQueuesByQueueIdOrderPathParams> = z.object({ "queueId": z.string() });

export interface DeleteRunQueuesEntriesByEntryIdPathParams {
  /**
   * Run Queue entry UUID. A live entry in a project the caller cannot reach answers 404 `Project not found`; an unknown or removed entry id answers 500 with `error: 'Run Queue entry not found'`.
   */
  entryId: string;
}
export const deleteRunQueuesEntriesByEntryIdPathParamsSchema: z.ZodType<DeleteRunQueuesEntriesByEntryIdPathParams> = z.object({ "entryId": z.string() });

export interface PatchRunQueuesEntriesByEntryIdPathParams {
  /**
   * Run Queue entry UUID. A live entry in a project the caller cannot reach answers 404 `Project not found`; an unknown or removed entry id answers 500 with `error: 'Run Queue entry not found'`.
   */
  entryId: string;
}
export const patchRunQueuesEntriesByEntryIdPathParamsSchema: z.ZodType<PatchRunQueuesEntriesByEntryIdPathParams> = z.object({ "entryId": z.string() });

export interface GetProjectsByIdStatusesPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const getProjectsByIdStatusesPathParamsSchema: z.ZodType<GetProjectsByIdStatusesPathParams> = z.object({ "id": z.string() });

export interface PostProjectsByIdStatusesPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const postProjectsByIdStatusesPathParamsSchema: z.ZodType<PostProjectsByIdStatusesPathParams> = z.object({ "id": z.string() });

export interface PatchProjectsByIdStatusesReorderPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const patchProjectsByIdStatusesReorderPathParamsSchema: z.ZodType<PatchProjectsByIdStatusesReorderPathParams> = z.object({ "id": z.string() });

export interface DeleteProjectsByIdStatusesByStatusIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project status UUID.
   */
  statusId: string;
}
export const deleteProjectsByIdStatusesByStatusIdPathParamsSchema: z.ZodType<DeleteProjectsByIdStatusesByStatusIdPathParams> = z.object({ "id": z.string(), "statusId": z.string() });

export interface PatchProjectsByIdStatusesByStatusIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project status UUID.
   */
  statusId: string;
}
export const patchProjectsByIdStatusesByStatusIdPathParamsSchema: z.ZodType<PatchProjectsByIdStatusesByStatusIdPathParams> = z.object({ "id": z.string(), "statusId": z.string() });

export interface GetActivityFeedQueryParams {
  /**
   * `YYYY-MM-DDTHH:mm:ss.sssZ` exactly (400 otherwise; blank is ignored). Selects the two-week delivered window ending there and omits live runs and questions.
   */
  before?: string;
}
export const getActivityFeedQueryParamsSchema: z.ZodType<GetActivityFeedQueryParams> = z.object({ "before": z.exactOptional(z.string()) });

export interface GetObjectiveTranscriptQueryParams {
  /**
   * Decimal 1-100 without leading zeros, default 50. Not allowed with `ids`.
   */
  limit?: string;
  /**
   * An opaque cursor from `nextBefore` or `newestCursor` (base64url, at most 256 characters).
   */
  before?: string;
  /**
   * An opaque cursor; returns objectives created after it, ascending.
   */
  after?: string;
  /**
   * Comma-separated distinct objective UUIDs, at most 100 (and 3699 characters).
   */
  ids?: string;
}
export const getObjectiveTranscriptQueryParamsSchema: z.ZodType<GetObjectiveTranscriptQueryParams> = z.object({ "limit": z.exactOptional(z.string()), "before": z.exactOptional(z.string()), "after": z.exactOptional(z.string()), "ids": z.exactOptional(z.string()) });

export interface PutDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParams {
  /**
   * Delivery UUID.
   */
  deliveryId: string;
  /**
   * A deferred-work id of that delivery (`DeferredWorkV1.id`, `deferred-work-<index>-<digest>`).
   */
  actionId: string;
}
export const putDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParamsSchema: z.ZodType<PutDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParams> = z.object({ "deliveryId": z.string(), "actionId": z.string() });

export interface DeleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParams {
  /**
   * Delivery UUID.
   */
  deliveryId: string;
  /**
   * A deferred-work id of that delivery (`DeferredWorkV1.id`, `deferred-work-<index>-<digest>`).
   */
  actionId: string;
}
export const deleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParamsSchema: z.ZodType<DeleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParams> = z.object({ "deliveryId": z.string(), "actionId": z.string() });

export interface PutMobileLiveActivitiesByActivityIdPushTokenPathParams {
  /**
   * The ActivityKit activity id, trimmed; blank answers 400, longer than 255 characters 400 (on `PUT`).
   */
  activityId: string;
}
export const putMobileLiveActivitiesByActivityIdPushTokenPathParamsSchema: z.ZodType<PutMobileLiveActivitiesByActivityIdPushTokenPathParams> = z.object({ "activityId": z.string() });

export interface DeleteMobileLiveActivitiesByActivityIdPushTokenPathParams {
  /**
   * The ActivityKit activity id, trimmed; blank answers 400, longer than 255 characters 400 (on `PUT`).
   */
  activityId: string;
}
export const deleteMobileLiveActivitiesByActivityIdPushTokenPathParamsSchema: z.ZodType<DeleteMobileLiveActivitiesByActivityIdPushTokenPathParams> = z.object({ "activityId": z.string() });

export interface PatchNotificationsByIdReadPathParams {
  /**
   * Notification id; one addressed to another profile, or dismissed, answers 404.
   */
  id: string;
}
export const patchNotificationsByIdReadPathParamsSchema: z.ZodType<PatchNotificationsByIdReadPathParams> = z.object({ "id": z.string() });

export interface DeleteNotificationsByIdPathParams {
  /**
   * Notification id; one addressed to another profile, or dismissed, answers 404.
   */
  id: string;
}
export const deleteNotificationsByIdPathParamsSchema: z.ZodType<DeleteNotificationsByIdPathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdTagsPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const getProjectsByIdTagsPathParamsSchema: z.ZodType<GetProjectsByIdTagsPathParams> = z.object({ "id": z.string() });

export interface PostProjectsByIdTagsPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const postProjectsByIdTagsPathParamsSchema: z.ZodType<PostProjectsByIdTagsPathParams> = z.object({ "id": z.string() });

export interface DeleteProjectsByIdTagsByTagIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project tag UUID.
   */
  tagId: string;
}
export const deleteProjectsByIdTagsByTagIdPathParamsSchema: z.ZodType<DeleteProjectsByIdTagsByTagIdPathParams> = z.object({ "id": z.string(), "tagId": z.string() });

export interface PatchProjectsByIdTagsByTagIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project tag UUID.
   */
  tagId: string;
}
export const patchProjectsByIdTagsByTagIdPathParamsSchema: z.ZodType<PatchProjectsByIdTagsByTagIdPathParams> = z.object({ "id": z.string(), "tagId": z.string() });

export interface GetProjectsByIdResourcesPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const getProjectsByIdResourcesPathParamsSchema: z.ZodType<GetProjectsByIdResourcesPathParams> = z.object({ "id": z.string() });

export interface PostProjectsByIdResourcesPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const postProjectsByIdResourcesPathParamsSchema: z.ZodType<PostProjectsByIdResourcesPathParams> = z.object({ "id": z.string() });

export interface DeleteProjectsByIdResourcesByResourceIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project resource UUID.
   */
  resourceId: string;
}
export const deleteProjectsByIdResourcesByResourceIdPathParamsSchema: z.ZodType<DeleteProjectsByIdResourcesByResourceIdPathParams> = z.object({ "id": z.string(), "resourceId": z.string() });

export interface PatchProjectsByIdResourcesByResourceIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project resource UUID.
   */
  resourceId: string;
}
export const patchProjectsByIdResourcesByResourceIdPathParamsSchema: z.ZodType<PatchProjectsByIdResourcesByResourceIdPathParams> = z.object({ "id": z.string(), "resourceId": z.string() });

export interface DeleteProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project resource UUID.
   */
  resourceId: string;
  /**
   * Project resource source UUID.
   */
  sourceId: string;
}
export const deleteProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParamsSchema: z.ZodType<DeleteProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParams> = z.object({ "id": z.string(), "resourceId": z.string(), "sourceId": z.string() });

export interface PatchProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
  /**
   * Project resource UUID.
   */
  resourceId: string;
  /**
   * Project resource source UUID.
   */
  sourceId: string;
}
export const patchProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParamsSchema: z.ZodType<PatchProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParams> = z.object({ "id": z.string(), "resourceId": z.string(), "sourceId": z.string() });

export interface PostProjectsByIdRepositoryReadsPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const postProjectsByIdRepositoryReadsPathParamsSchema: z.ZodType<PostProjectsByIdRepositoryReadsPathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdRepositoryPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const getProjectsByIdRepositoryPathParamsSchema: z.ZodType<GetProjectsByIdRepositoryPathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdRepositoryQueryParams {
  /**
   * Target whose source is preferred; blank is treated as absent.
   */
  executionTargetId?: string;
  /**
   * Resource to describe; blank or unknown falls back to the primary.
   */
  resourceKey?: string;
}
export const getProjectsByIdRepositoryQueryParamsSchema: z.ZodType<GetProjectsByIdRepositoryQueryParams> = z.object({ "executionTargetId": z.exactOptional(z.string()), "resourceKey": z.exactOptional(z.string()) });

export interface GetProjectsByIdMissionsPathParams {
  /**
   * Project UUID.
   */
  id: string;
}
export const getProjectsByIdMissionsPathParamsSchema: z.ZodType<GetProjectsByIdMissionsPathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdMissionsQueryParams {
  /**
   * Present and not `0`/`false` embeds every mission's objectives (a bare `?includeObjectives` counts).
   */
  includeObjectives?: string;
  /**
   * Present and not `0`/`false` lifts the 21-day window on completed missions.
   */
  includeAllCompleted?: string;
}
export const getProjectsByIdMissionsQueryParamsSchema: z.ZodType<GetProjectsByIdMissionsQueryParams> = z.object({ "includeObjectives": z.exactOptional(z.string()), "includeAllCompleted": z.exactOptional(z.string()) });

export interface GetExtEverhourProjectsByProjectIdLinkPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const getExtEverhourProjectsByProjectIdLinkPathParamsSchema: z.ZodType<GetExtEverhourProjectsByProjectIdLinkPathParams> = z.object({ "projectId": z.string() });

export interface PutExtEverhourProjectsByProjectIdLinkPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const putExtEverhourProjectsByProjectIdLinkPathParamsSchema: z.ZodType<PutExtEverhourProjectsByProjectIdLinkPathParams> = z.object({ "projectId": z.string() });

export interface GetExtEverhourProjectsByProjectIdPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const getExtEverhourProjectsByProjectIdPathParamsSchema: z.ZodType<GetExtEverhourProjectsByProjectIdPathParams> = z.object({ "projectId": z.string() });

export interface PostExtEverhourProjectsByProjectIdTimerStartPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const postExtEverhourProjectsByProjectIdTimerStartPathParamsSchema: z.ZodType<PostExtEverhourProjectsByProjectIdTimerStartPathParams> = z.object({ "projectId": z.string() });

export interface PostExtEverhourProjectsByProjectIdTimerStopPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const postExtEverhourProjectsByProjectIdTimerStopPathParamsSchema: z.ZodType<PostExtEverhourProjectsByProjectIdTimerStopPathParams> = z.object({ "projectId": z.string() });

export interface PostExtEverhourProjectsByProjectIdTimePathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const postExtEverhourProjectsByProjectIdTimePathParamsSchema: z.ZodType<PostExtEverhourProjectsByProjectIdTimePathParams> = z.object({ "projectId": z.string() });

export interface DeleteExtEverhourProjectsByProjectIdTimeByRecordIdPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
  /**
   * Everhour time-record id, passed to Everhour as given; Everhour decides whether the caller's key may change it.
   */
  recordId: string;
}
export const deleteExtEverhourProjectsByProjectIdTimeByRecordIdPathParamsSchema: z.ZodType<DeleteExtEverhourProjectsByProjectIdTimeByRecordIdPathParams> = z.object({ "projectId": z.string(), "recordId": z.string() });

export interface PatchExtEverhourProjectsByProjectIdTimeByRecordIdPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
  /**
   * Everhour time-record id, passed to Everhour as given; Everhour decides whether the caller's key may change it.
   */
  recordId: string;
}
export const patchExtEverhourProjectsByProjectIdTimeByRecordIdPathParamsSchema: z.ZodType<PatchExtEverhourProjectsByProjectIdTimeByRecordIdPathParams> = z.object({ "projectId": z.string(), "recordId": z.string() });

export interface GetExtEverhourMissionsByMissionIdPathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the Everhour service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const getExtEverhourMissionsByMissionIdPathParamsSchema: z.ZodType<GetExtEverhourMissionsByMissionIdPathParams> = z.object({ "missionId": z.string() });

export interface PostExtEverhourMissionsByMissionIdTimerStartPathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the Everhour service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const postExtEverhourMissionsByMissionIdTimerStartPathParamsSchema: z.ZodType<PostExtEverhourMissionsByMissionIdTimerStartPathParams> = z.object({ "missionId": z.string() });

export interface PostExtEverhourMissionsByMissionIdTimerStopPathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the Everhour service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const postExtEverhourMissionsByMissionIdTimerStopPathParamsSchema: z.ZodType<PostExtEverhourMissionsByMissionIdTimerStopPathParams> = z.object({ "missionId": z.string() });

export interface PostExtEverhourMissionsByMissionIdTimePathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the Everhour service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const postExtEverhourMissionsByMissionIdTimePathParamsSchema: z.ZodType<PostExtEverhourMissionsByMissionIdTimePathParams> = z.object({ "missionId": z.string() });

export interface DeleteExtEverhourMissionsByMissionIdTimeByRecordIdPathParams {
  /**
   * Mission UUID (see the mission routes).
   */
  missionId: string;
  /**
   * Everhour time-record id, passed to Everhour as given; Everhour decides whether the caller's key may change it.
   */
  recordId: string;
}
export const deleteExtEverhourMissionsByMissionIdTimeByRecordIdPathParamsSchema: z.ZodType<DeleteExtEverhourMissionsByMissionIdTimeByRecordIdPathParams> = z.object({ "missionId": z.string(), "recordId": z.string() });

export interface PatchExtEverhourMissionsByMissionIdTimeByRecordIdPathParams {
  /**
   * Mission UUID (see the mission routes).
   */
  missionId: string;
  /**
   * Everhour time-record id, passed to Everhour as given; Everhour decides whether the caller's key may change it.
   */
  recordId: string;
}
export const patchExtEverhourMissionsByMissionIdTimeByRecordIdPathParamsSchema: z.ZodType<PatchExtEverhourMissionsByMissionIdTimeByRecordIdPathParams> = z.object({ "missionId": z.string(), "recordId": z.string() });

export interface GetExtGithubIntegrationQueryParams {
  /**
   * The workspace. Missing or blank answers 400 `workspaceId query parameter is required`.
   */
  workspaceId: string;
}
export const getExtGithubIntegrationQueryParamsSchema: z.ZodType<GetExtGithubIntegrationQueryParams> = z.object({ "workspaceId": z.string() });

export interface DeleteExtGithubIntegrationQueryParams {
  /**
   * The workspace. Missing or blank answers 400 `workspaceId query parameter is required`.
   */
  workspaceId: string;
}
export const deleteExtGithubIntegrationQueryParamsSchema: z.ZodType<DeleteExtGithubIntegrationQueryParams> = z.object({ "workspaceId": z.string() });

export interface PostExtGithubInstallQueryParams {
  /**
   * The workspace. Missing or blank answers 400 `workspaceId query parameter is required`.
   */
  workspaceId: string;
}
export const postExtGithubInstallQueryParamsSchema: z.ZodType<PostExtGithubInstallQueryParams> = z.object({ "workspaceId": z.string() });

export interface GetExtGithubCallbackQueryParams {
  /**
   * GitHub's installation id; decimal digits (400 otherwise).
   */
  installation_id: string;
  /**
   * The signed state from `POST /ext/github/install`.
   */
  state: string;
}
export const getExtGithubCallbackQueryParamsSchema: z.ZodType<GetExtGithubCallbackQueryParams> = z.object({ "installation_id": z.string(), "state": z.string() });

export interface GetExtGithubCallbackResponse200 {
  connected: true;
}
export const getExtGithubCallbackResponse200Schema: z.ZodType<GetExtGithubCallbackResponse200> = z.object({ "connected": z.literal(true) });

export interface GetExtGithubReposQueryParams {
  /**
   * The workspace. Missing or blank answers 400 `workspaceId query parameter is required`.
   */
  workspaceId: string;
  /**
   * Case-insensitive substring of `owner/name`.
   */
  q?: string;
}
export const getExtGithubReposQueryParamsSchema: z.ZodType<GetExtGithubReposQueryParams> = z.object({ "workspaceId": z.string(), "q": z.exactOptional(z.string()) });

export interface GetExtGithubProjectsByProjectIdLinkPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const getExtGithubProjectsByProjectIdLinkPathParamsSchema: z.ZodType<GetExtGithubProjectsByProjectIdLinkPathParams> = z.object({ "projectId": z.string() });

export interface PutExtGithubProjectsByProjectIdLinkPathParams {
  /**
   * Project UUID (404 for an unknown, deleted or foreign project).
   */
  projectId: string;
}
export const putExtGithubProjectsByProjectIdLinkPathParamsSchema: z.ZodType<PutExtGithubProjectsByProjectIdLinkPathParams> = z.object({ "projectId": z.string() });

export interface GetExtGithubMissionsByMissionIdPullRequestPathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the GitHub service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const getExtGithubMissionsByMissionIdPullRequestPathParamsSchema: z.ZodType<GetExtGithubMissionsByMissionIdPullRequestPathParams> = z.object({ "missionId": z.string() });

export type GetExtGithubMissionsByMissionIdPullRequestResponse200 = GitHubPullRequestDto | ({
  ok: true;
});
export const getExtGithubMissionsByMissionIdPullRequestResponse200Schema: z.ZodType<GetExtGithubMissionsByMissionIdPullRequestResponse200> = z.union([gitHubPullRequestDtoSchema, z.strictObject({ "ok": z.literal(true) })]);

export interface PostExtGithubMissionsByMissionIdPullRequestPathParams {
  /**
   * Mission UUID. A display id passes authorization but is not found by the GitHub service (404); an ambiguous display id answers 409.
   */
  missionId: string;
}
export const postExtGithubMissionsByMissionIdPullRequestPathParamsSchema: z.ZodType<PostExtGithubMissionsByMissionIdPullRequestPathParams> = z.object({ "missionId": z.string() });

export interface PatchProjectsByIdBoardReorderPathParams {
  /**
   * Project UUID (display names and slugs are not accepted).
   */
  id: string;
}
export const patchProjectsByIdBoardReorderPathParamsSchema: z.ZodType<PatchProjectsByIdBoardReorderPathParams> = z.object({ "id": z.string() });

export interface GetInboxByIdPathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const getInboxByIdPathParamsSchema: z.ZodType<GetInboxByIdPathParams> = z.object({ "id": z.string() });

export interface DeleteInboxByIdPathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const deleteInboxByIdPathParamsSchema: z.ZodType<DeleteInboxByIdPathParams> = z.object({ "id": z.string() });

export interface PatchInboxByIdPathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const patchInboxByIdPathParamsSchema: z.ZodType<PatchInboxByIdPathParams> = z.object({ "id": z.string() });

export interface PostInboxByIdPromotePathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const postInboxByIdPromotePathParamsSchema: z.ZodType<PostInboxByIdPromotePathParams> = z.object({ "id": z.string() });

export interface GetMissionsSearchQueryParams {
  /**
   * Query text; empty or stop-word-only uses the fallback ordering.
   */
  q?: string;
  /**
   * One project id (any string; an unknown or unreadable project answers 404).
   */
  projectId?: string;
  /**
   * Comma-separated status types; values are not validated (an unknown type matches nothing).
   */
  statusTypes?: string;
  /**
   * Integer result cap, default 25. Not bounded above; negative values give no results. Across workspaces it is split `floor(limit / workspaces)` per workspace with the remainder to the lowest workspace ids.
   */
  limit?: string;
}
export const getMissionsSearchQueryParamsSchema: z.ZodType<GetMissionsSearchQueryParams> = z.object({ "q": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string()), "statusTypes": z.exactOptional(z.string()), "limit": z.exactOptional(z.string()) });

export interface GetMissionsSearchV2QueryParams {
  /**
   * Query text; a display id short-circuits; empty or stop-word-only uses `fallback` mode.
   */
  q?: string;
  /**
   * Comma-separated project UUIDs (non-UUID values answer 400). `projectId` is read as an alias when `projectIds` is absent.
   */
  projectIds?: string;
  /**
   * Alias of `projectIds`.
   */
  projectId?: string;
  /**
   * Comma-separated status types; values are not validated (an unknown type matches nothing).
   */
  statusTypes?: string;
  /**
   * Comma-separated resource keys; missions with an objective on one of them. `resourceKey` (single) is read when absent.
   */
  resourceKeys?: string;
  /**
   * Alias for a single resource key.
   */
  resourceKey?: string;
  /**
   * Column for `from`/`to`; defaults to `updatedAt` when a bound is given. An empty value answers 400. A `dueDatetime` range excludes missions without a due date.
   */
  dateField?: MissionSearchDateField;
  /**
   * Inclusive ISO-8601 bound with a timezone (`…Z` or `±hh:mm`); must precede `to`.
   */
  from?: string;
  /**
   * Exclusive ISO-8601 bound with a timezone.
   */
  to?: string;
  /**
   * Integer result cap, default 25. Not bounded above; negative values give no results. Across workspaces it is split `floor(limit / workspaces)` per workspace with the remainder to the lowest workspace ids.
   */
  limit?: string;
}
export const getMissionsSearchV2QueryParamsSchema: z.ZodType<GetMissionsSearchV2QueryParams> = z.object({ "q": z.exactOptional(z.string()), "projectIds": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string()), "statusTypes": z.exactOptional(z.string()), "resourceKeys": z.exactOptional(z.string()), "resourceKey": z.exactOptional(z.string()), "dateField": z.exactOptional(missionSearchDateFieldSchema), "from": z.exactOptional(z.string()), "to": z.exactOptional(z.string()), "limit": z.exactOptional(z.string()) });

export interface GetSearchV3QueryParams {
  /**
   * Query text; a display id short-circuits; empty or stop-word-only uses `fallback` mode.
   */
  q?: string;
  /**
   * Comma-separated project UUIDs (non-UUID values answer 400). `projectId` is read as an alias when `projectIds` is absent.
   */
  projectIds?: string;
  /**
   * Alias of `projectIds`.
   */
  projectId?: string;
  /**
   * Comma-separated status types; values are not validated (an unknown type matches nothing).
   */
  statusTypes?: string;
  /**
   * Comma-separated resource keys; missions with an objective on one of them. `resourceKey` (single) is read when absent.
   */
  resourceKeys?: string;
  /**
   * Alias for a single resource key.
   */
  resourceKey?: string;
  /**
   * Column for `from`/`to`; defaults to `updatedAt` when a bound is given. An empty value answers 400. A `dueDatetime` range excludes missions without a due date.
   */
  dateField?: MissionSearchDateField;
  /**
   * Inclusive ISO-8601 bound with a timezone (`…Z` or `±hh:mm`); must precede `to`.
   */
  from?: string;
  /**
   * Exclusive ISO-8601 bound with a timezone.
   */
  to?: string;
  /**
   * Integer result cap, default 25. Not bounded above; negative values give no results. Across workspaces it is split `floor(limit / workspaces)` per workspace with the remainder to the lowest workspace ids.
   */
  limit?: string;
  /**
   * Comma-separated subset of `mission`, `objective`, `delivery` (default all three); `event` answers 400.
   */
  entityTypes?: string;
  /**
   * Comma-separated objective states that returnable objective matches must be in.
   */
  objectiveStates?: string;
  /**
   * Integer 1-10, default 3; not divided across workspaces.
   */
  matchesPerResult?: string;
}
export const getSearchV3QueryParamsSchema: z.ZodType<GetSearchV3QueryParams> = z.object({ "q": z.exactOptional(z.string()), "projectIds": z.exactOptional(z.string()), "projectId": z.exactOptional(z.string()), "statusTypes": z.exactOptional(z.string()), "resourceKeys": z.exactOptional(z.string()), "resourceKey": z.exactOptional(z.string()), "dateField": z.exactOptional(missionSearchDateFieldSchema), "from": z.exactOptional(z.string()), "to": z.exactOptional(z.string()), "limit": z.exactOptional(z.string()), "entityTypes": z.exactOptional(z.string()), "objectiveStates": z.exactOptional(z.string()), "matchesPerResult": z.exactOptional(z.string()) });

export interface GetMissionsByIdPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdPathParamsSchema: z.ZodType<GetMissionsByIdPathParams> = z.object({ "id": z.string() });

export interface DeleteMissionsByIdPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const deleteMissionsByIdPathParamsSchema: z.ZodType<DeleteMissionsByIdPathParams> = z.object({ "id": z.string() });

export interface PatchMissionsByIdPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const patchMissionsByIdPathParamsSchema: z.ZodType<PatchMissionsByIdPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdGenerateTitlePathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postMissionsByIdGenerateTitlePathParamsSchema: z.ZodType<PostMissionsByIdGenerateTitlePathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdGenerateCommitMessagePathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postMissionsByIdGenerateCommitMessagePathParamsSchema: z.ZodType<PostMissionsByIdGenerateCommitMessagePathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdObjectivesPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdObjectivesPathParamsSchema: z.ZodType<GetMissionsByIdObjectivesPathParams> = z.object({ "id": z.string() });

export interface PatchMissionsByIdObjectivesReorderPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const patchMissionsByIdObjectivesReorderPathParamsSchema: z.ZodType<PatchMissionsByIdObjectivesReorderPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdSessionChannelPathParams {
  /**
   * Mission reference; not read (the route always answers 410).
   */
  id: string;
}
export const postMissionsByIdSessionChannelPathParamsSchema: z.ZodType<PostMissionsByIdSessionChannelPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdTerminalSessionsForgetPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postMissionsByIdTerminalSessionsForgetPathParamsSchema: z.ZodType<PostMissionsByIdTerminalSessionsForgetPathParams> = z.object({ "id": z.string() });

export interface GetAgentRequestsQueryParams {
  /**
   * Mission UUID or display id.
   */
  missionId?: string;
  /**
   * Objective UUID (with `missionId`) or full display id.
   */
  objectiveId?: string;
}
export const getAgentRequestsQueryParamsSchema: z.ZodType<GetAgentRequestsQueryParams> = z.object({ "missionId": z.exactOptional(z.string()), "objectiveId": z.exactOptional(z.string()) });

export interface PostAgentRequestsByIdResolvePathParams {
  /**
   * Agent request UUID; an unknown or deleted request, or one in a workspace the caller is not an active member of, answers 404.
   */
  id: string;
}
export const postAgentRequestsByIdResolvePathParamsSchema: z.ZodType<PostAgentRequestsByIdResolvePathParams> = z.object({ "id": z.string() });

export interface PostAgentRequestsByIdReleasePathParams {
  /**
   * Agent request id; not read (the route always answers 410).
   */
  id: string;
}
export const postAgentRequestsByIdReleasePathParamsSchema: z.ZodType<PostAgentRequestsByIdReleasePathParams> = z.object({ "id": z.string() });

export interface GetAgentSessionInputsQueryParams {
  /**
   * Mission UUID or display id; required unless `objectiveId` is a display id.
   */
  missionId?: string;
  /**
   * Objective UUID (with `missionId`) or full display id.
   */
  objectiveId?: string;
}
export const getAgentSessionInputsQueryParamsSchema: z.ZodType<GetAgentSessionInputsQueryParams> = z.object({ "missionId": z.exactOptional(z.string()), "objectiveId": z.exactOptional(z.string()) });

export interface PostAgentSessionInputsByIdCancelPathParams {
  /**
   * Session input id; not read (the route always answers 410).
   */
  id: string;
}
export const postAgentSessionInputsByIdCancelPathParamsSchema: z.ZodType<PostAgentSessionInputsByIdCancelPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdEventsPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdEventsPathParamsSchema: z.ZodType<GetMissionsByIdEventsPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdDeliveriesPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdDeliveriesPathParamsSchema: z.ZodType<GetMissionsByIdDeliveriesPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdSummaryPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdSummaryPathParamsSchema: z.ZodType<GetMissionsByIdSummaryPathParams> = z.object({ "id": z.string() });

export interface PutMissionsByIdSummarySeenPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const putMissionsByIdSummarySeenPathParamsSchema: z.ZodType<PutMissionsByIdSummarySeenPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdArtifactsPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdArtifactsPathParamsSchema: z.ZodType<GetMissionsByIdArtifactsPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdArtifactsPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postMissionsByIdArtifactsPathParamsSchema: z.ZodType<PostMissionsByIdArtifactsPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdContextPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdContextPathParamsSchema: z.ZodType<GetMissionsByIdContextPathParams> = z.object({ "id": z.string() });

export interface PutMissionsByIdContextPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const putMissionsByIdContextPathParamsSchema: z.ZodType<PutMissionsByIdContextPathParams> = z.object({ "id": z.string() });

export interface PatchMissionsByIdArtifactsByArtifactIdPathParams {
  /**
   * Mission UUID or display id.
   */
  id: string;
  /**
   * Artifact UUID.
   */
  artifactId: string;
}
export const patchMissionsByIdArtifactsByArtifactIdPathParamsSchema: z.ZodType<PatchMissionsByIdArtifactsByArtifactIdPathParams> = z.object({ "id": z.string(), "artifactId": z.string() });

export interface GetMissionsByIdFileChangesPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdFileChangesPathParamsSchema: z.ZodType<GetMissionsByIdFileChangesPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdFileChangesQueryParams {
  /**
   * Objective UUID or display id on this mission; blank or repeated answers 400.
   */
  objectiveId?: string;
}
export const getMissionsByIdFileChangesQueryParamsSchema: z.ZodType<GetMissionsByIdFileChangesQueryParams> = z.object({ "objectiveId": z.exactOptional(z.string()) });

export type GetMissionsByIdFileChangesResponse200 = MissionFileChangesDto | ObjectiveFileChangesDto;
export const getMissionsByIdFileChangesResponse200Schema: z.ZodType<GetMissionsByIdFileChangesResponse200> = z.union([missionFileChangesDtoSchema, objectiveFileChangesDtoSchema]);

export interface GetMissionsByIdSchedulePathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdSchedulePathParamsSchema: z.ZodType<GetMissionsByIdSchedulePathParams> = z.object({ "id": z.string() });

export interface PutMissionsByIdSchedulePathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const putMissionsByIdSchedulePathParamsSchema: z.ZodType<PutMissionsByIdSchedulePathParams> = z.object({ "id": z.string() });

export interface DeleteMissionsByIdSchedulePathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const deleteMissionsByIdSchedulePathParamsSchema: z.ZodType<DeleteMissionsByIdSchedulePathParams> = z.object({ "id": z.string() });

export interface DeleteObjectivesByIdPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const deleteObjectivesByIdPathParamsSchema: z.ZodType<DeleteObjectivesByIdPathParams> = z.object({ "id": z.string() });

export interface PatchObjectivesByIdPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const patchObjectivesByIdPathParamsSchema: z.ZodType<PatchObjectivesByIdPathParams> = z.object({ "id": z.string() });

export interface PostObjectivesByIdLaunchPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postObjectivesByIdLaunchPathParamsSchema: z.ZodType<PostObjectivesByIdLaunchPathParams> = z.object({ "id": z.string() });

export interface GetObjectivesByIdPromptPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getObjectivesByIdPromptPathParamsSchema: z.ZodType<GetObjectivesByIdPromptPathParams> = z.object({ "id": z.string() });

export interface GetObjectivesByIdLaunchCommandPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getObjectivesByIdLaunchCommandPathParamsSchema: z.ZodType<GetObjectivesByIdLaunchCommandPathParams> = z.object({ "id": z.string() });

export interface GetObjectivesByIdLaunchCommandQueryParams {
  /**
   * Agent key; missing or blank answers 400.
   */
  agent: string;
  model?: string;
  reasoningEffort?: string;
  /**
   * An eligible target (400 `execution_target_not_eligible` otherwise); omitted uses the project's selected target.
   */
  executionTargetId?: string;
}
export const getObjectivesByIdLaunchCommandQueryParamsSchema: z.ZodType<GetObjectivesByIdLaunchCommandQueryParams> = z.object({ "agent": z.string(), "model": z.exactOptional(z.string()), "reasoningEffort": z.exactOptional(z.string()), "executionTargetId": z.exactOptional(z.string()) });

export interface GetObjectivesByIdEffectiveLaunchConfigPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getObjectivesByIdEffectiveLaunchConfigPathParamsSchema: z.ZodType<GetObjectivesByIdEffectiveLaunchConfigPathParams> = z.object({ "id": z.string() });

export interface GetObjectivesByIdEffectiveLaunchConfigQueryParams {
  /**
   * Agent key; missing or blank answers 400.
   */
  agent: string;
  /**
   * An eligible target (400 `execution_target_not_eligible` otherwise); omitted uses the project's selected target.
   */
  executionTargetId?: string;
}
export const getObjectivesByIdEffectiveLaunchConfigQueryParamsSchema: z.ZodType<GetObjectivesByIdEffectiveLaunchConfigQueryParams> = z.object({ "agent": z.string(), "executionTargetId": z.exactOptional(z.string()) });

export interface GetObjectivesByIdAttachmentsPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getObjectivesByIdAttachmentsPathParamsSchema: z.ZodType<GetObjectivesByIdAttachmentsPathParams> = z.object({ "id": z.string() });

export interface PostObjectivesByIdAttachmentsPathParams {
  /**
   * Objective UUID, or full display id (`coo:756.k7xm`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postObjectivesByIdAttachmentsPathParamsSchema: z.ZodType<PostObjectivesByIdAttachmentsPathParams> = z.object({ "id": z.string() });

export interface PostObjectivesByIdAttachmentsHeaderParams {
  /**
   * The original filename, percent-encoded (`encodeURIComponent`); defaults to `attachment`. A malformed encoding answers 500.
   */
  "x-upload-filename"?: string;
}
export const postObjectivesByIdAttachmentsHeaderParamsSchema: z.ZodType<PostObjectivesByIdAttachmentsHeaderParams> = z.object({ "x-upload-filename": z.exactOptional(z.string()) });

export interface DeleteObjectivesByIdAttachmentsByAttachmentIdPathParams {
  /**
   * Objective UUID or full display id.
   */
  id: string;
  /**
   * Attachment UUID.
   */
  attachmentId: string;
}
export const deleteObjectivesByIdAttachmentsByAttachmentIdPathParamsSchema: z.ZodType<DeleteObjectivesByIdAttachmentsByAttachmentIdPathParams> = z.object({ "id": z.string(), "attachmentId": z.string() });

export interface GetInboxByIdAttachmentsPathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const getInboxByIdAttachmentsPathParamsSchema: z.ZodType<GetInboxByIdAttachmentsPathParams> = z.object({ "id": z.string() });

export interface PostInboxByIdAttachmentsPathParams {
  /**
   * Inbox item UUID; an item owned by another profile answers 404.
   */
  id: string;
}
export const postInboxByIdAttachmentsPathParamsSchema: z.ZodType<PostInboxByIdAttachmentsPathParams> = z.object({ "id": z.string() });

export interface PostInboxByIdAttachmentsHeaderParams {
  /**
   * The original filename, percent-encoded; defaults to `attachment`. A malformed encoding answers 500.
   */
  "x-upload-filename"?: string;
}
export const postInboxByIdAttachmentsHeaderParamsSchema: z.ZodType<PostInboxByIdAttachmentsHeaderParams> = z.object({ "x-upload-filename": z.exactOptional(z.string()) });

export interface DeleteInboxByIdAttachmentsByAttachmentIdPathParams {
  /**
   * Inbox item UUID owned by the caller.
   */
  id: string;
  /**
   * Attachment UUID.
   */
  attachmentId: string;
}
export const deleteInboxByIdAttachmentsByAttachmentIdPathParamsSchema: z.ZodType<DeleteInboxByIdAttachmentsByAttachmentIdPathParams> = z.object({ "id": z.string(), "attachmentId": z.string() });

export interface GetAgentCatalogQueryParams {
  /**
   * Target workspace UUID (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const getAgentCatalogQueryParamsSchema: z.ZodType<GetAgentCatalogQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PutAgentCatalogQueryParams {
  /**
   * Target workspace UUID (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const putAgentCatalogQueryParamsSchema: z.ZodType<PutAgentCatalogQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PostAgentCatalogRefreshQueryParams {
  /**
   * Target workspace UUID (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const postAgentCatalogRefreshQueryParamsSchema: z.ZodType<PostAgentCatalogRefreshQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface GetLaunchSettingsQueryParams {
  /**
   * Workspace UUID the operation is authorized and stored through (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const getLaunchSettingsQueryParamsSchema: z.ZodType<GetLaunchSettingsQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface GetLaunchSettingsHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const getLaunchSettingsHeaderParamsSchema: z.ZodType<GetLaunchSettingsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsAgentsByAgentKeyPathParams {
  /**
   * Agent key (`claude`, `codex`, …), trimmed; blank answers 400. Not checked against the catalog.
   */
  agentKey: string;
}
export const patchLaunchSettingsAgentsByAgentKeyPathParamsSchema: z.ZodType<PatchLaunchSettingsAgentsByAgentKeyPathParams> = z.object({ "agentKey": z.string() });

export interface PatchLaunchSettingsAgentsByAgentKeyQueryParams {
  /**
   * Workspace UUID the operation is authorized and stored through (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const patchLaunchSettingsAgentsByAgentKeyQueryParamsSchema: z.ZodType<PatchLaunchSettingsAgentsByAgentKeyQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsAgentsByAgentKeyHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchLaunchSettingsAgentsByAgentKeyHeaderParamsSchema: z.ZodType<PatchLaunchSettingsAgentsByAgentKeyHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsTerminalProfileQueryParams {
  /**
   * Workspace UUID the operation is authorized and stored through (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const patchLaunchSettingsTerminalProfileQueryParamsSchema: z.ZodType<PatchLaunchSettingsTerminalProfileQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsTerminalProfileHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchLaunchSettingsTerminalProfileHeaderParamsSchema: z.ZodType<PatchLaunchSettingsTerminalProfileHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsSessionDefaultsQueryParams {
  /**
   * Workspace UUID the operation is authorized and stored through (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const patchLaunchSettingsSessionDefaultsQueryParamsSchema: z.ZodType<PatchLaunchSettingsSessionDefaultsQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsSessionDefaultsHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchLaunchSettingsSessionDefaultsHeaderParamsSchema: z.ZodType<PatchLaunchSettingsSessionDefaultsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsWorktreeBranchAutomationQueryParams {
  /**
   * Workspace UUID the operation is authorized and stored through (404 `Workspace not found or no active membership` for a workspace the caller is not an active member of). Authenticated requests carry no ambient workspace, so without it the route answers 400 `workspaceId is required`; it is required in practice.
   */
  workspaceId?: string;
}
export const patchLaunchSettingsWorktreeBranchAutomationQueryParamsSchema: z.ZodType<PatchLaunchSettingsWorktreeBranchAutomationQueryParams> = z.object({ "workspaceId": z.exactOptional(z.string()) });

export interface PatchLaunchSettingsWorktreeBranchAutomationHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchLaunchSettingsWorktreeBranchAutomationHeaderParamsSchema: z.ZodType<PatchLaunchSettingsWorktreeBranchAutomationHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface GetWorkspacesByIdLaunchSettingsPathParams {
  /**
   * Workspace UUID the operation is authorized and stored through; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const getWorkspacesByIdLaunchSettingsPathParamsSchema: z.ZodType<GetWorkspacesByIdLaunchSettingsPathParams> = z.object({ "id": z.string() });

export interface GetWorkspacesByIdLaunchSettingsHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const getWorkspacesByIdLaunchSettingsHeaderParamsSchema: z.ZodType<GetWorkspacesByIdLaunchSettingsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchWorkspacesByIdLaunchSettingsAgentsByAgentKeyPathParams {
  /**
   * Workspace UUID the operation is authorized and stored through; a workspace the caller is not an active member of answers 404.
   */
  id: string;
  /**
   * Agent key (`claude`, `codex`, …), trimmed; blank answers 400. Not checked against the catalog.
   */
  agentKey: string;
}
export const patchWorkspacesByIdLaunchSettingsAgentsByAgentKeyPathParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsAgentsByAgentKeyPathParams> = z.object({ "id": z.string(), "agentKey": z.string() });

export interface PatchWorkspacesByIdLaunchSettingsAgentsByAgentKeyHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchWorkspacesByIdLaunchSettingsAgentsByAgentKeyHeaderParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsAgentsByAgentKeyHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchWorkspacesByIdLaunchSettingsTerminalProfilePathParams {
  /**
   * Workspace UUID the operation is authorized and stored through; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const patchWorkspacesByIdLaunchSettingsTerminalProfilePathParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsTerminalProfilePathParams> = z.object({ "id": z.string() });

export interface PatchWorkspacesByIdLaunchSettingsTerminalProfileHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchWorkspacesByIdLaunchSettingsTerminalProfileHeaderParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsTerminalProfileHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchWorkspacesByIdLaunchSettingsSessionDefaultsPathParams {
  /**
   * Workspace UUID the operation is authorized and stored through; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const patchWorkspacesByIdLaunchSettingsSessionDefaultsPathParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsSessionDefaultsPathParams> = z.object({ "id": z.string() });

export interface PatchWorkspacesByIdLaunchSettingsSessionDefaultsHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchWorkspacesByIdLaunchSettingsSessionDefaultsHeaderParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsSessionDefaultsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface PatchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationPathParams {
  /**
   * Workspace UUID the operation is authorized and stored through; a workspace the caller is not an active member of answers 404.
   */
  id: string;
}
export const patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationPathParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationPathParams> = z.object({ "id": z.string() });

export interface PatchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationHeaderParams {
  /**
   * The calling machine's fingerprint, which selects the execution target the settings belong to on a hosted (Postgres) backend. A co-located Local (SQLite) backend ignores it and uses its own host. A browser pseudo-device or the backend host's fingerprint resolves to no target.
   */
  "x-overlord-device-fingerprint"?: string;
}
export const patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationHeaderParamsSchema: z.ZodType<PatchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()) });

export interface GetProjectsByIdLaunchPreferencePathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const getProjectsByIdLaunchPreferencePathParamsSchema: z.ZodType<GetProjectsByIdLaunchPreferencePathParams> = z.object({ "id": z.string() });

export interface PutProjectsByIdLaunchPreferencePathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const putProjectsByIdLaunchPreferencePathParamsSchema: z.ZodType<PutProjectsByIdLaunchPreferencePathParams> = z.object({ "id": z.string() });

export interface GetProjectsByIdExecutionTargetPathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const getProjectsByIdExecutionTargetPathParamsSchema: z.ZodType<GetProjectsByIdExecutionTargetPathParams> = z.object({ "id": z.string() });

export interface PutProjectsByIdExecutionTargetPathParams {
  /**
   * Project UUID; an unknown, deleted or foreign project answers 404.
   */
  id: string;
}
export const putProjectsByIdExecutionTargetPathParamsSchema: z.ZodType<PutProjectsByIdExecutionTargetPathParams> = z.object({ "id": z.string() });

export interface PostExecutionTargetsByIdObservationsPathParams {
  /**
   * Execution target id; an unknown or deleted target, or one in a workspace the caller is not an active member of, answers 404.
   */
  id: string;
}
export const postExecutionTargetsByIdObservationsPathParamsSchema: z.ZodType<PostExecutionTargetsByIdObservationsPathParams> = z.object({ "id": z.string() });

export interface PostExecutionTargetsByIdObservationsHeaderParams {
  /**
   * The calling machine's fingerprint. On a hosted (Postgres) backend this identifies the acting machine; a co-located Local (SQLite) backend ignores it and acts as its own host. A browser pseudo-device or the backend host's own fingerprint never resolves to a target.
   */
  "x-overlord-device-fingerprint"?: string;
  /**
   * Display label for a machine registered by this request.
   */
  "x-overlord-device-label"?: string;
  /**
   * Platform name of the calling machine (`browser` marks a browser pseudo-device).
   */
  "x-overlord-device-platform"?: string;
}
export const postExecutionTargetsByIdObservationsHeaderParamsSchema: z.ZodType<PostExecutionTargetsByIdObservationsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()), "x-overlord-device-label": z.exactOptional(z.string()), "x-overlord-device-platform": z.exactOptional(z.string()) });

export interface PostExecutionTargetsByIdMissionBranchObservationsPathParams {
  /**
   * Execution target id; an unknown or deleted target, or one in a workspace the caller is not an active member of, answers 404.
   */
  id: string;
}
export const postExecutionTargetsByIdMissionBranchObservationsPathParamsSchema: z.ZodType<PostExecutionTargetsByIdMissionBranchObservationsPathParams> = z.object({ "id": z.string() });

export interface PostExecutionTargetsByIdMissionBranchObservationsHeaderParams {
  /**
   * The calling machine's fingerprint. On a hosted (Postgres) backend this identifies the acting machine; a co-located Local (SQLite) backend ignores it and acts as its own host. A browser pseudo-device or the backend host's own fingerprint never resolves to a target.
   */
  "x-overlord-device-fingerprint"?: string;
  /**
   * Display label for a machine registered by this request.
   */
  "x-overlord-device-label"?: string;
  /**
   * Platform name of the calling machine (`browser` marks a browser pseudo-device).
   */
  "x-overlord-device-platform"?: string;
}
export const postExecutionTargetsByIdMissionBranchObservationsHeaderParamsSchema: z.ZodType<PostExecutionTargetsByIdMissionBranchObservationsHeaderParams> = z.object({ "x-overlord-device-fingerprint": z.exactOptional(z.string()), "x-overlord-device-label": z.exactOptional(z.string()), "x-overlord-device-platform": z.exactOptional(z.string()) });

export interface PostProtocolBySubcommandPathParams {
  /**
   * A backend protocol subcommand listed in contract/protocol-commands.yaml (`search` is an alias of `search-missions`). An unknown name answers 404 `Unknown protocol subcommand: <name>` with the supported names in `detail`.
   */
  subcommand: string;
}
export const postProtocolBySubcommandPathParamsSchema: z.ZodType<PostProtocolBySubcommandPathParams> = z.object({ "subcommand": z.string() });

export interface GetRunnerStatusQueryParams {
  /**
   * Project UUID or reference (slug or name), trimmed; blank is ignored.
   */
  projectId?: string;
}
export const getRunnerStatusQueryParamsSchema: z.ZodType<GetRunnerStatusQueryParams> = z.object({ "projectId": z.exactOptional(z.string()) });

export interface PostRunnerRequestsByIdLaunchingPathParams {
  /**
   * Execution request UUID; an unknown or deleted request, or one in a workspace the caller is not an active member of, answers 404 `Execution request not found`.
   */
  id: string;
}
export const postRunnerRequestsByIdLaunchingPathParamsSchema: z.ZodType<PostRunnerRequestsByIdLaunchingPathParams> = z.object({ "id": z.string() });

export interface PostRunnerRequestsByIdLaunchedPathParams {
  /**
   * Execution request UUID; an unknown or deleted request, or one in a workspace the caller is not an active member of, answers 404 `Execution request not found`.
   */
  id: string;
}
export const postRunnerRequestsByIdLaunchedPathParamsSchema: z.ZodType<PostRunnerRequestsByIdLaunchedPathParams> = z.object({ "id": z.string() });

export interface PostRunnerRequestsByIdFailedPathParams {
  /**
   * Execution request UUID; an unknown or deleted request, or one in a workspace the caller is not an active member of, answers 404 `Execution request not found`.
   */
  id: string;
}
export const postRunnerRequestsByIdFailedPathParamsSchema: z.ZodType<PostRunnerRequestsByIdFailedPathParams> = z.object({ "id": z.string() });

export interface PostRunnerRequestsByIdCompletedPathParams {
  /**
   * Execution request UUID; an unknown or deleted request, or one in a workspace the caller is not an active member of, answers 404 `Execution request not found`.
   */
  id: string;
}
export const postRunnerRequestsByIdCompletedPathParamsSchema: z.ZodType<PostRunnerRequestsByIdCompletedPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdBranchPreparedPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an unknown or foreign reference answers 404 and an ambiguous display id 409.
   */
  id: string;
}
export const postMissionsByIdBranchPreparedPathParamsSchema: z.ZodType<PostMissionsByIdBranchPreparedPathParams> = z.object({ "id": z.string() });

export interface PostMissionsByIdBranchActionPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const postMissionsByIdBranchActionPathParamsSchema: z.ZodType<PostMissionsByIdBranchActionPathParams> = z.object({ "id": z.string() });

export interface GetMissionsByIdBranchesPathParams {
  /**
   * Mission UUID, or display id (`coo:756`) resolved within the caller's organization; an ambiguous display id answers 409.
   */
  id: string;
}
export const getMissionsByIdBranchesPathParamsSchema: z.ZodType<GetMissionsByIdBranchesPathParams> = z.object({ "id": z.string() });

/** Shared responses (components.responses). */
export const apiResponses = {
  BadRequest: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  Unauthorized: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  Forbidden: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  NotFound: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  Conflict: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  PayloadTooLarge: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  TooManyRequests: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  BadGateway: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  InternalError: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  UnsupportedMediaType: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  ServiceUnavailable: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } },
  UnprocessableContent: { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }
} as const satisfies { readonly [name: string]: ApiResponseDescriptor };

/** Every operation of the REST surface, keyed by operationId. */
export const apiOperations = {
  /**
   * GET /api/auth/desktop/github: Start native GitHub sign-in in the system browser
   */
  getAuthDesktopGithub: {
    operationId: "getAuthDesktopGithub",
    method: "GET",
    path: "/api/auth/desktop/github",
    tags: ["auth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "302": { headers: ["Location", "Set-Cookie"], content: {} }, "404": { headers: [], content: { "application/json": { kind: "json", schema: messageErrorBodySchema } } }, "500": apiResponses.InternalError, "503": { headers: [], content: { "text/plain": { kind: "text", schema: getAuthDesktopGithubResponse503TextSchema } } } }
  },
  /**
   * GET /api/auth/desktop/callback: Finish native GitHub sign-in and hand off to the app
   */
  getAuthDesktopCallback: {
    operationId: "getAuthDesktopCallback",
    method: "GET",
    path: "/api/auth/desktop/callback",
    tags: ["auth"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{}],
    parameters: { path: null, query: getAuthDesktopCallbackQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "302": { headers: ["Location"], content: {} }, "400": { headers: [], content: { "text/plain": { kind: "text", schema: getAuthDesktopCallbackResponse400TextSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/auth/browser/callback: Finish hosted-web sign-in and hand off to the web client
   */
  getAuthBrowserCallback: {
    operationId: "getAuthBrowserCallback",
    method: "GET",
    path: "/api/auth/browser/callback",
    tags: ["auth"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{}],
    parameters: { path: null, query: getAuthBrowserCallbackQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "302": { headers: ["Location"], content: {} }, "400": { headers: [], content: { "text/html": { kind: "text", schema: getAuthBrowserCallbackResponse400TextSchema } } }, "401": { headers: [], content: { "text/html": { kind: "text", schema: getAuthBrowserCallbackResponse401TextSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/auth/desktop/exchange: Exchange a native sign-in ticket for a session token
   */
  postAuthDesktopExchange: {
    operationId: "postAuthDesktopExchange",
    method: "POST",
    path: "/api/auth/desktop/exchange",
    tags: ["auth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["desktop","mobile"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: oAuthHandoffExchangeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthHandoffExchangeResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: messageErrorBodySchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/auth/browser/exchange: Exchange a hosted-web sign-in ticket for a session token
   */
  postAuthBrowserExchange: {
    operationId: "postAuthBrowserExchange",
    method: "POST",
    path: "/api/auth/browser/exchange",
    tags: ["auth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: oAuthHandoffExchangeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthHandoffExchangeResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: messageErrorBodySchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/auth/callback/github/repository: GitHub repository-access OAuth callback
   */
  getAuthCallbackGithubRepository: {
    operationId: "getAuthCallbackGithubRepository",
    method: "GET",
    path: "/api/auth/callback/github/repository",
    tags: ["auth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: getAuthCallbackGithubRepositoryQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "text/html": { kind: "text", schema: getAuthCallbackGithubRepositoryResponse200TextSchema } } }, "302": { headers: ["Location"], content: {} }, "400": { headers: [], content: { "text/html": { kind: "text", schema: getAuthCallbackGithubRepositoryResponse400TextSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/auth-providers: Login providers this server offers
   */
  getAuthProviders: {
    operationId: "getAuthProviders",
    method: "GET",
    path: "/api/auth-providers",
    tags: ["auth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: authProvidersDtoSchema } } }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/health: Liveness probe
   */
  getHealth: {
    operationId: "getHealth",
    method: "GET",
    path: "/api/health",
    tags: ["meta"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","desktop"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * GET /.well-known/oauth-protected-resource: OAuth protected-resource metadata (RFC 9728)
   */
  getWellKnownOauthProtectedResource: {
    operationId: "getWellKnownOauthProtectedResource",
    method: "GET",
    path: "/.well-known/oauth-protected-resource",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthProtectedResourceMetadataSchema } } }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * GET /.well-known/oauth-protected-resource/mcp: OAuth protected-resource metadata for /mcp (path-inserted form)
   */
  getWellKnownOauthProtectedResourceMcp: {
    operationId: "getWellKnownOauthProtectedResourceMcp",
    method: "GET",
    path: "/.well-known/oauth-protected-resource/mcp",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthProtectedResourceMetadataSchema } } }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * GET /.well-known/oauth-authorization-server: OAuth authorization-server metadata (RFC 8414)
   */
  getWellKnownOauthAuthorizationServer: {
    operationId: "getWellKnownOauthAuthorizationServer",
    method: "GET",
    path: "/.well-known/oauth-authorization-server",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthAuthorizationServerMetadataSchema } } }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * GET /oauth/authorize: Redirect an authorization request to the web approval page
   */
  getOauthAuthorize: {
    operationId: "getOauthAuthorize",
    method: "GET",
    path: "/oauth/authorize",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "302": { headers: ["Location"], content: {} }, "400": apiResponses.BadRequest, "500": apiResponses.InternalError }
  },
  /**
   * POST /oauth/register: Dynamic client registration (RFC 7591)
   */
  postOauthRegister: {
    operationId: "postOauthRegister",
    method: "POST",
    path: "/oauth/register",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: oAuthClientRegistrationBodySchema }, "application/x-www-form-urlencoded": { kind: "form", schema: oAuthClientRegistrationBodySchema } } },
    responses: { "201": { headers: [], content: { "application/json": { kind: "json", schema: oAuthClientRegistrationDtoSchema } } }, "400": { headers: [], content: { "application/json": { kind: "json", schema: postOauthRegisterResponse400Schema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /oauth/token: Exchange an authorization code for an access token
   */
  postOauthToken: {
    operationId: "postOauthToken",
    method: "POST",
    path: "/oauth/token",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/x-www-form-urlencoded": { kind: "form", schema: oAuthTokenRequestBodySchema }, "application/json": { kind: "json", schema: oAuthTokenRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthTokenResponseDtoSchema } } }, "400": { headers: [], content: { "application/json": { kind: "json", schema: postOauthTokenResponse400Schema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /oauth/revoke: Revoke an access token (RFC 7009)
   */
  postOauthRevoke: {
    operationId: "postOauthRevoke",
    method: "POST",
    path: "/oauth/revoke",
    tags: ["oauth"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/x-www-form-urlencoded": { kind: "form", schema: oAuthRevokeBodySchema }, "application/json": { kind: "json", schema: oAuthRevokeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /oauth/authorize/request: Validate an authorization request for the approval page
   */
  postOauthAuthorizeRequest: {
    operationId: "postOauthAuthorizeRequest",
    method: "POST",
    path: "/oauth/authorize/request",
    tags: ["oauth"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: oAuthAuthorizationRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthAuthorizationRequestInfoDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /oauth/authorize/approve: Approve or deny an authorization request
   */
  postOauthAuthorizeApprove: {
    operationId: "postOauthAuthorizeApprove",
    method: "POST",
    path: "/oauth/authorize/approve",
    tags: ["oauth"],
    deprecated: false,
    permission: "user_token:self:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: oAuthApproveBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: oAuthApproveResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /mcp: MCP server description
   */
  getMcp: {
    operationId: "getMcp",
    method: "GET",
    path: "/mcp",
    tags: ["mcp"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: mcpServerInfoDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: ["WWW-Authenticate"], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /mcp: MCP JSON-RPC transport
   */
  postMcp: {
    operationId: "postMcp",
    method: "POST",
    path: "/mcp",
    tags: ["mcp"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external","mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: postMcpRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: postMcpResponse200Schema } } }, "400": apiResponses.BadRequest, "401": { headers: ["WWW-Authenticate"], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/agent-session-channels/v1/self: Read the calling channel
   */
  getAgentSessionChannelsV1Self: {
    operationId: "getAgentSessionChannelsV1Self",
    method: "GET",
    path: "/api/agent-session-channels/v1/self",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentSessionChannelSelfDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/heartbeat: Renew the channel lease
   */
  postAgentSessionChannelsV1Heartbeat: {
    operationId: "postAgentSessionChannelsV1Heartbeat",
    method: "POST",
    path: "/api/agent-session-channels/v1/heartbeat",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: agentSessionHeartbeatBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentSessionHeartbeatDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/events: Append normalized session events
   */
  postAgentSessionChannelsV1Events: {
    operationId: "postAgentSessionChannelsV1Events",
    method: "POST",
    path: "/api/agent-session-channels/v1/events",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: appendAgentSessionEventsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: appendAgentSessionEventsDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/requests: Open an agent request on the channel
   */
  postAgentSessionChannelsV1Requests: {
    operationId: "postAgentSessionChannelsV1Requests",
    method: "POST",
    path: "/api/agent-session-channels/v1/requests",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createAgentRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createdAgentRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/agent-session-channels/v1/requests/{id}: Read one of the channel's requests
   */
  getAgentSessionChannelsV1RequestsById: {
    operationId: "getAgentSessionChannelsV1RequestsById",
    method: "GET",
    path: "/api/agent-session-channels/v1/requests/{id}",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: getAgentSessionChannelsV1RequestsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/requests/{id}/lease: Acquire or renew the waiter lease on a request
   */
  postAgentSessionChannelsV1RequestsByIdLease: {
    operationId: "postAgentSessionChannelsV1RequestsByIdLease",
    method: "POST",
    path: "/api/agent-session-channels/v1/requests/{id}/lease",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1RequestsByIdLeasePathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: agentRequestLeaseBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentRequestLeaseDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/requests/{id}/release: Release a request to the terminal
   */
  postAgentSessionChannelsV1RequestsByIdRelease: {
    operationId: "postAgentSessionChannelsV1RequestsByIdRelease",
    method: "POST",
    path: "/api/agent-session-channels/v1/requests/{id}/release",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1RequestsByIdReleasePathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: releaseAgentRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: releasedAgentRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/requests/{id}/application: Record whether a resolution was applied
   */
  postAgentSessionChannelsV1RequestsByIdApplication: {
    operationId: "postAgentSessionChannelsV1RequestsByIdApplication",
    method: "POST",
    path: "/api/agent-session-channels/v1/requests/{id}/application",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1RequestsByIdApplicationPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: recordAgentRequestApplicationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/requests/{id}/resolved-elsewhere: Report that a request was answered in the terminal
   */
  postAgentSessionChannelsV1RequestsByIdResolvedElsewhere: {
    operationId: "postAgentSessionChannelsV1RequestsByIdResolvedElsewhere",
    method: "POST",
    path: "/api/agent-session-channels/v1/requests/{id}/resolved-elsewhere",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1RequestsByIdResolvedElsewherePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentRequestResolvedElsewhereDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/inputs/claim: Lease the channel's next queued input
   */
  postAgentSessionChannelsV1InputsClaim: {
    operationId: "postAgentSessionChannelsV1InputsClaim",
    method: "POST",
    path: "/api/agent-session-channels/v1/inputs/claim",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: claimedAgentSessionInputDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/inputs/{id}/emitted: Mark a leased input emitted
   */
  postAgentSessionChannelsV1InputsByIdEmitted: {
    operationId: "postAgentSessionChannelsV1InputsByIdEmitted",
    method: "POST",
    path: "/api/agent-session-channels/v1/inputs/{id}/emitted",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1InputsByIdEmittedPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: markAgentSessionInputEmittedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: postAgentSessionChannelsV1InputsByIdEmittedResponse200Schema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/inputs/{id}/acknowledged: Mark an emitted input acknowledged
   */
  postAgentSessionChannelsV1InputsByIdAcknowledged: {
    operationId: "postAgentSessionChannelsV1InputsByIdAcknowledged",
    method: "POST",
    path: "/api/agent-session-channels/v1/inputs/{id}/acknowledged",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1InputsByIdAcknowledgedPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: postAgentSessionChannelsV1InputsByIdAcknowledgedResponse200Schema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/inputs/{id}/failed: Mark a queued or leased input failed
   */
  postAgentSessionChannelsV1InputsByIdFailed: {
    operationId: "postAgentSessionChannelsV1InputsByIdFailed",
    method: "POST",
    path: "/api/agent-session-channels/v1/inputs/{id}/failed",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: postAgentSessionChannelsV1InputsByIdFailedPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: markAgentSessionInputFailedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: postAgentSessionChannelsV1InputsByIdFailedResponse200Schema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-channels/v1/end: End the channel
   */
  postAgentSessionChannelsV1End: {
    operationId: "postAgentSessionChannelsV1End",
    method: "POST",
    path: "/api/agent-session-channels/v1/end",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "channel-credential",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"channelCredential":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: endAgentSessionChannelBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /oauth/clients/knowledgebase.json: Knowledgebase OAuth client metadata document
   */
  getOauthClientsKnowledgebaseJson: {
    operationId: "getOauthClientsKnowledgebaseJson",
    method: "GET",
    path: "/oauth/clients/knowledgebase.json",
    tags: ["connections"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: knowledgebaseClientMetadataDtoSchema } } }, "400": apiResponses.BadRequest, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/connections/knowledgebase/callback: Knowledgebase OAuth callback
   */
  getConnectionsKnowledgebaseCallback: {
    operationId: "getConnectionsKnowledgebaseCallback",
    method: "GET",
    path: "/api/connections/knowledgebase/callback",
    tags: ["connections"],
    deprecated: false,
    permission: "public",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["external"],
    extension: null,
    security: [],
    parameters: { path: null, query: getConnectionsKnowledgebaseCallbackQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "text/html": { kind: "text", schema: getConnectionsKnowledgebaseCallbackResponse200TextSchema } } }, "302": { headers: ["Location"], content: {} }, "400": { headers: [], content: { "text/html": { kind: "text", schema: getConnectionsKnowledgebaseCallbackResponse400TextSchema }, "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/chat/providers: Assistant engine readiness and the caller's organization connections
   */
  getChatProviders: {
    operationId: "getChatProviders",
    method: "GET",
    path: "/api/chat/providers",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatProvidersResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/chat/threads: List the caller's chat threads
   */
  getChatThreads: {
    operationId: "getChatThreads",
    method: "GET",
    path: "/api/chat/threads",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getChatThreadsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatThreadListResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/threads: Create a chat thread, optionally with its first message
   */
  postChatThreads: {
    operationId: "postChatThreads",
    method: "POST",
    path: "/api/chat/threads",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: createChatThreadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createChatThreadResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": apiResponses.TooManyRequests, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/chat/threads/{id}: Read a thread snapshot
   */
  getChatThreadsById: {
    operationId: "getChatThreadsById",
    method: "GET",
    path: "/api/chat/threads/{id}",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getChatThreadsByIdPathParamsSchema, query: getChatThreadsByIdQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatThreadSnapshotDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * PATCH /api/chat/threads/{id}: Rename or archive a chat thread
   */
  patchChatThreadsById: {
    operationId: "patchChatThreadsById",
    method: "PATCH",
    path: "/api/chat/threads/{id}",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchChatThreadsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateChatThreadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatThreadDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/chat/threads/{id}/diagnostics: Read a thread's diagnostic observations
   */
  getChatThreadsByIdDiagnostics: {
    operationId: "getChatThreadsByIdDiagnostics",
    method: "GET",
    path: "/api/chat/threads/{id}/diagnostics",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getChatThreadsByIdDiagnosticsPathParamsSchema, query: getChatThreadsByIdDiagnosticsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatDiagnosticPageDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/threads/{id}/messages: Submit a message
   */
  postChatThreadsByIdMessages: {
    operationId: "postChatThreadsByIdMessages",
    method: "POST",
    path: "/api/chat/threads/{id}/messages",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatThreadsByIdMessagesPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: submitChatMessageBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: submitChatMessageResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": apiResponses.TooManyRequests, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * PUT /api/chat/threads/{id}/presence: Renew or release a client's foreground presence
   */
  putChatThreadsByIdPresence: {
    operationId: "putChatThreadsByIdPresence",
    method: "PUT",
    path: "/api/chat/threads/{id}/presence",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putChatThreadsByIdPresencePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateChatPresenceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatPresenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/threads/{id}/ack: Acknowledge rendered events
   */
  postChatThreadsByIdAck: {
    operationId: "postChatThreadsByIdAck",
    method: "POST",
    path: "/api/chat/threads/{id}/ack",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatThreadsByIdAckPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: ackChatEventsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatAckDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/chat/notifications: List dispatched conversation notifications
   */
  getChatNotifications: {
    operationId: "getChatNotifications",
    method: "GET",
    path: "/api/chat/notifications",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatNotificationListResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/notifications/{id}/read: Mark a conversation notification read
   */
  postChatNotificationsByIdRead: {
    operationId: "postChatNotificationsByIdRead",
    method: "POST",
    path: "/api/chat/notifications/{id}/read",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatNotificationsByIdReadPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: markChatNotificationReadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatNotificationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/proposals/{id}/create: Create draft missions from a work proposal
   */
  postChatProposalsByIdCreate: {
    operationId: "postChatProposalsByIdCreate",
    method: "POST",
    path: "/api/chat/proposals/{id}/create",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatProposalsByIdCreatePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createFromChatProposalBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createFromChatProposalResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/questions/{id}/answer: Answer an open question from its card
   */
  postChatQuestionsByIdAnswer: {
    operationId: "postChatQuestionsByIdAnswer",
    method: "POST",
    path: "/api/chat/questions/{id}/answer",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatQuestionsByIdAnswerPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: answerChatQuestionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: submitChatMessageResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/runs/{id}/cancel: Cancel a run
   */
  postChatRunsByIdCancel: {
    operationId: "postChatRunsByIdCancel",
    method: "POST",
    path: "/api/chat/runs/{id}/cancel",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatRunsByIdCancelPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: cancelChatRunBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatRunDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /api/chat/runs/{id}/continue: Continue a run whose allowance ran out
   */
  postChatRunsByIdContinue: {
    operationId: "postChatRunsByIdContinue",
    method: "POST",
    path: "/api/chat/runs/{id}/continue",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postChatRunsByIdContinuePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: continueChatRunBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: continueChatRunResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": apiResponses.TooManyRequests, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/chat/threads/{id}/events: Replay and stream thread events
   */
  getChatThreadsByIdEvents: {
    operationId: "getChatThreadsByIdEvents",
    method: "GET",
    path: "/api/chat/threads/{id}/events",
    tags: ["chat"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getChatThreadsByIdEventsPathParamsSchema, query: getChatThreadsByIdEventsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: chatEventPageDtoSchema }, "text/event-stream": { kind: "event-stream", event: chatStreamFrameDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/connections: List the caller's account connections
   */
  getConnections: {
    operationId: "getConnections",
    method: "GET",
    path: "/api/connections",
    tags: ["connections"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getConnectionsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: accountConnectionListResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/connections: Start an OAuth account connection
   */
  postConnections: {
    operationId: "postConnections",
    method: "POST",
    path: "/api/connections",
    tags: ["connections"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: startAccountConnectionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: startAccountConnectionResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError, "503": apiResponses.ServiceUnavailable }
  },
  /**
   * POST /api/connections/api-keys: Connect or rotate an API-key account connection
   */
  postConnectionsApiKeys: {
    operationId: "postConnectionsApiKeys",
    method: "POST",
    path: "/api/connections/api-keys",
    tags: ["connections"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: setAccountConnectionApiKeyBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: accountConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "422": apiResponses.UnprocessableContent, "500": apiResponses.InternalError, "502": apiResponses.BadGateway, "503": apiResponses.ServiceUnavailable }
  },
  /**
   * DELETE /api/connections/{id}: Disconnect an account connection
   */
  deleteConnectionsById: {
    operationId: "deleteConnectionsById",
    method: "DELETE",
    path: "/api/connections/{id}",
    tags: ["connections"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteConnectionsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: accountConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/connections/{id}: Change a Knowledgebase connection's settings
   */
  patchConnectionsById: {
    operationId: "patchConnectionsById",
    method: "PATCH",
    path: "/api/connections/{id}",
    tags: ["connections"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "cloud",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchConnectionsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateAccountConnectionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: accountConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/meta: Caller and server metadata
   */
  getMeta: {
    operationId: "getMeta",
    method: "GET",
    path: "/api/meta",
    tags: ["meta"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: serverMetaDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/authorized-workspaces: The caller's authorization snapshot
   */
  getAuthorizedWorkspaces: {
    operationId: "getAuthorizedWorkspaces",
    method: "GET",
    path: "/api/authorized-workspaces",
    tags: ["meta"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: authorizedWorkspaceDiscoveryDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/diagnostics/execution-target-migration: Execution targets stamped with the backend host
   */
  getDiagnosticsExecutionTargetMigration: {
    operationId: "getDiagnosticsExecutionTargetMigration",
    method: "GET",
    path: "/api/diagnostics/execution-target-migration",
    tags: ["meta"],
    deprecated: false,
    permission: "workspace:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getDiagnosticsExecutionTargetMigrationQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: executionTargetMigrationDiagnosticsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/onboarding: Create the caller's first organization and workspace
   */
  postOnboarding: {
    operationId: "postOnboarding",
    method: "POST",
    path: "/api/onboarding",
    tags: ["organizations"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createOrganizationOnboardingBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: metaDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/organizations: List the caller's organizations
   */
  getOrganizations: {
    operationId: "getOrganizations",
    method: "GET",
    path: "/api/organizations",
    tags: ["organizations"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: organizationListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/organizations/{id}: Rename an organization or set its logo
   */
  patchOrganizationsById: {
    operationId: "patchOrganizationsById",
    method: "PATCH",
    path: "/api/organizations/{id}",
    tags: ["organizations"],
    deprecated: false,
    permission: "organization-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchOrganizationsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateOrganizationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: organizationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/organizations/{id}/admins: List an organization's admins
   */
  getOrganizationsByIdAdmins: {
    operationId: "getOrganizationsByIdAdmins",
    method: "GET",
    path: "/api/organizations/{id}/admins",
    tags: ["organizations"],
    deprecated: false,
    permission: "organization-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getOrganizationsByIdAdminsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: organizationAdminListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/organizations/{id}/admins: Make a member an organization admin
   */
  postOrganizationsByIdAdmins: {
    operationId: "postOrganizationsByIdAdmins",
    method: "POST",
    path: "/api/organizations/{id}/admins",
    tags: ["organizations"],
    deprecated: false,
    permission: "organization-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postOrganizationsByIdAdminsPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: addOrganizationAdminBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: organizationAdminListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/organizations/{id}/admins/{userId}: Remove an organization admin
   */
  deleteOrganizationsByIdAdminsByUserId: {
    operationId: "deleteOrganizationsByIdAdminsByUserId",
    method: "DELETE",
    path: "/api/organizations/{id}/admins/{userId}",
    tags: ["organizations"],
    deprecated: false,
    permission: "organization-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteOrganizationsByIdAdminsByUserIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: organizationAdminListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces: List the caller's workspaces
   */
  getWorkspaces: {
    operationId: "getWorkspaces",
    method: "GET",
    path: "/api/workspaces",
    tags: ["workspaces"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/workspaces: Create a workspace in an organization
   */
  postWorkspaces: {
    operationId: "postWorkspaces",
    method: "POST",
    path: "/api/workspaces",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createWorkspaceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/workspaces/{id}: Delete a workspace
   */
  deleteWorkspacesById: {
    operationId: "deleteWorkspacesById",
    method: "DELETE",
    path: "/api/workspaces/{id}",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-admin",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteWorkspacesByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}: Rename a workspace or toggle SQL Studio
   */
  patchWorkspacesById: {
    operationId: "patchWorkspacesById",
    method: "PATCH",
    path: "/api/workspaces/{id}",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWorkspaceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/members: List a workspace's members
   */
  getWorkspacesByIdMembers: {
    operationId: "getWorkspacesByIdMembers",
    method: "GET",
    path: "/api/workspaces/{id}/members",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-member",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdMembersPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceMemberListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/workspaces/{id}/members/{workspaceUserId}: Remove a member from a workspace
   */
  deleteWorkspacesByIdMembersByWorkspaceUserId: {
    operationId: "deleteWorkspacesByIdMembersByWorkspaceUserId",
    method: "DELETE",
    path: "/api/workspaces/{id}/members/{workspaceUserId}",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteWorkspacesByIdMembersByWorkspaceUserIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/members/{workspaceUserId}/role: Set a member's workspace role
   */
  patchWorkspacesByIdMembersByWorkspaceUserIdRole: {
    operationId: "patchWorkspacesByIdMembersByWorkspaceUserIdRole",
    method: "PATCH",
    path: "/api/workspaces/{id}/members/{workspaceUserId}/role",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdMembersByWorkspaceUserIdRolePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWorkspaceMemberRoleBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceMemberDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/invitations: List a workspace's invitations
   */
  getWorkspacesByIdInvitations: {
    operationId: "getWorkspacesByIdInvitations",
    method: "GET",
    path: "/api/workspaces/{id}/invitations",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdInvitationsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceInvitationListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/workspaces/{id}/invitations: Invite an email address to a workspace
   */
  postWorkspacesByIdInvitations: {
    operationId: "postWorkspacesByIdInvitations",
    method: "POST",
    path: "/api/workspaces/{id}/invitations",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWorkspacesByIdInvitationsPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: inviteWorkspaceMemberBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inviteWorkspaceMemberResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/workspaces/{id}/invitations/{invitationId}: Revoke an invitation
   */
  deleteWorkspacesByIdInvitationsByInvitationId: {
    operationId: "deleteWorkspacesByIdInvitationsByInvitationId",
    method: "DELETE",
    path: "/api/workspaces/{id}/invitations/{invitationId}",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace-manager",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteWorkspacesByIdInvitationsByInvitationIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/invitations/accept: Accept a workspace invitation
   */
  postInvitationsAccept: {
    operationId: "postInvitationsAccept",
    method: "POST",
    path: "/api/invitations/accept",
    tags: ["workspaces"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: acceptWorkspaceInvitationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/objectives.csv: Export a workspace's objectives as CSV
   */
  getWorkspacesByIdObjectivesCsv: {
    operationId: "getWorkspacesByIdObjectivesCsv",
    method: "GET",
    path: "/api/workspaces/{id}/objectives.csv",
    tags: ["workspaces"],
    deprecated: false,
    permission: "workspace:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdObjectivesCsvPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: ["Content-Disposition"], content: { "text/csv": { kind: "text", schema: getWorkspacesByIdObjectivesCsvResponse200TextSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/projects: List one workspace's projects
   */
  getWorkspacesByIdProjects: {
    operationId: "getWorkspacesByIdProjects",
    method: "GET",
    path: "/api/workspaces/{id}/projects",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdProjectsPathParamsSchema, query: getWorkspacesByIdProjectsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/project-statuses: List every project status of a workspace
   */
  getWorkspacesByIdProjectStatuses: {
    operationId: "getWorkspacesByIdProjectStatuses",
    method: "GET",
    path: "/api/workspaces/{id}/project-statuses",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "workspace:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdProjectStatusesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectStatusListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/execution-targets: List a workspace's execution targets
   */
  getWorkspacesByIdExecutionTargets: {
    operationId: "getWorkspacesByIdExecutionTargets",
    method: "GET",
    path: "/api/workspaces/{id}/execution-targets",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "workspace:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdExecutionTargetsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceExecutionTargetListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/workspaces/{id}/execution-targets: Register the calling machine as an execution target
   */
  postWorkspacesByIdExecutionTargets: {
    operationId: "postWorkspacesByIdExecutionTargets",
    method: "POST",
    path: "/api/workspaces/{id}/execution-targets",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWorkspacesByIdExecutionTargetsPathParamsSchema, query: null, header: postWorkspacesByIdExecutionTargetsHeaderParamsSchema },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: registerExecutionTargetBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceExecutionTargetDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/workspaces/{id}/execution-targets/{targetId}: Delete an execution target
   */
  deleteWorkspacesByIdExecutionTargetsByTargetId: {
    operationId: "deleteWorkspacesByIdExecutionTargetsByTargetId",
    method: "DELETE",
    path: "/api/workspaces/{id}/execution-targets/{targetId}",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "workspace:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteWorkspacesByIdExecutionTargetsByTargetIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/execution-targets/{targetId}: Rename, disable or enable an execution target
   */
  patchWorkspacesByIdExecutionTargetsByTargetId: {
    operationId: "patchWorkspacesByIdExecutionTargetsByTargetId",
    method: "PATCH",
    path: "/api/workspaces/{id}/execution-targets/{targetId}",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "workspace:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdExecutionTargetsByTargetIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWorkspaceExecutionTargetBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: workspaceExecutionTargetDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/agent-catalog: Read a workspace's agent catalog
   */
  getWorkspacesByIdAgentCatalog: {
    operationId: "getWorkspacesByIdAgentCatalog",
    method: "GET",
    path: "/api/workspaces/{id}/agent-catalog",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdAgentCatalogPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/workspaces/{id}/agent-catalog: Replace a workspace's agent catalog
   */
  putWorkspacesByIdAgentCatalog: {
    operationId: "putWorkspacesByIdAgentCatalog",
    method: "PUT",
    path: "/api/workspaces/{id}/agent-catalog",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putWorkspacesByIdAgentCatalogPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateAgentCatalogBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/workspaces/{id}/agent-catalog/refresh: Merge newly shipped agents and models into a workspace's catalog
   */
  postWorkspacesByIdAgentCatalogRefresh: {
    operationId: "postWorkspacesByIdAgentCatalogRefresh",
    method: "POST",
    path: "/api/workspaces/{id}/agent-catalog/refresh",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWorkspacesByIdAgentCatalogRefreshPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/profile: Read the caller's own profile
   */
  getProfile: {
    operationId: "getProfile",
    method: "GET",
    path: "/api/profile",
    tags: ["profile"],
    deprecated: false,
    permission: "profile:self:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: profileDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/profile: Edit the caller's own profile
   */
  patchProfile: {
    operationId: "patchProfile",
    method: "PATCH",
    path: "/api/profile",
    tags: ["profile"],
    deprecated: false,
    permission: "profile:self:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProfileBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: profileDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/profile/default-project: Read the caller's default project preference
   */
  getProfileDefaultProject: {
    operationId: "getProfileDefaultProject",
    method: "GET",
    path: "/api/profile/default-project",
    tags: ["profile"],
    deprecated: false,
    permission: "profile:self:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: defaultProjectPreferenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/profile/default-project: Set the caller's default project
   */
  putProfileDefaultProject: {
    operationId: "putProfileDefaultProject",
    method: "PUT",
    path: "/api/profile/default-project",
    tags: ["profile"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["profile:self:update","project:read"],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: setDefaultProjectBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: defaultProjectPreferenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/profile/default-project: Clear the caller's default project
   */
  deleteProfileDefaultProject: {
    operationId: "deleteProfileDefaultProject",
    method: "DELETE",
    path: "/api/profile/default-project",
    tags: ["profile"],
    deprecated: false,
    permission: "profile:self:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: defaultProjectPreferenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/user-tokens: List the caller's personal tokens
   */
  getUserTokens: {
    operationId: "getUserTokens",
    method: "GET",
    path: "/api/user-tokens",
    tags: ["user-tokens"],
    deprecated: false,
    permission: "user_token:self:list",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: userTokenListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/user-tokens: Mint a personal token
   */
  postUserTokens: {
    operationId: "postUserTokens",
    method: "POST",
    path: "/api/user-tokens",
    tags: ["user-tokens"],
    deprecated: false,
    permission: "user_token:self:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createUserTokenBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createUserTokenResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/user-tokens/{id}: Delete a revoked personal token
   */
  deleteUserTokensById: {
    operationId: "deleteUserTokensById",
    method: "DELETE",
    path: "/api/user-tokens/{id}",
    tags: ["user-tokens"],
    deprecated: false,
    permission: "user_token:self:revoke",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteUserTokensByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/user-tokens/{id}: Rename a personal token
   */
  patchUserTokensById: {
    operationId: "patchUserTokensById",
    method: "PATCH",
    path: "/api/user-tokens/{id}",
    tags: ["user-tokens"],
    deprecated: false,
    permission: "user_token:self:rotate",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchUserTokensByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateUserTokenBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: userTokenDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/user-tokens/{id}/revoke: Revoke a personal token
   */
  postUserTokensByIdRevoke: {
    operationId: "postUserTokensByIdRevoke",
    method: "POST",
    path: "/api/user-tokens/{id}/revoke",
    tags: ["user-tokens"],
    deprecated: false,
    permission: "user_token:self:revoke",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postUserTokensByIdRevokePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: userTokenDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/webhooks: List a workspace's webhook subscriptions
   */
  getWebhooks: {
    operationId: "getWebhooks",
    method: "GET",
    path: "/api/webhooks",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getWebhooksQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: webhookSubscriptionListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/webhooks: Create a webhook subscription
   */
  postWebhooks: {
    operationId: "postWebhooks",
    method: "POST",
    path: "/api/webhooks",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createWebhookSubscriptionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createWebhookSubscriptionResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/webhooks/{id}: Delete a webhook subscription
   */
  deleteWebhooksById: {
    operationId: "deleteWebhooksById",
    method: "DELETE",
    path: "/api/webhooks/{id}",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:delete",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteWebhooksByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/webhooks/{id}: Update a webhook subscription
   */
  patchWebhooksById: {
    operationId: "patchWebhooksById",
    method: "PATCH",
    path: "/api/webhooks/{id}",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWebhooksByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWebhookSubscriptionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: webhookSubscriptionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/webhooks/{id}/rotate-secret: Rotate a webhook signing secret
   */
  postWebhooksByIdRotateSecret: {
    operationId: "postWebhooksByIdRotateSecret",
    method: "POST",
    path: "/api/webhooks/{id}/rotate-secret",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWebhooksByIdRotateSecretPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: createWebhookSubscriptionResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/webhooks/{id}/test: Send a test delivery
   */
  postWebhooksByIdTest: {
    operationId: "postWebhooksByIdTest",
    method: "POST",
    path: "/api/webhooks/{id}/test",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWebhooksByIdTestPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: webhookTestResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError, "502": apiResponses.BadGateway }
  },
  /**
   * GET /api/webhooks/{id}/deliveries: A subscription's delivery attempt log
   */
  getWebhooksByIdDeliveries: {
    operationId: "getWebhooksByIdDeliveries",
    method: "GET",
    path: "/api/webhooks/{id}/deliveries",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWebhooksByIdDeliveriesPathParamsSchema, query: getWebhooksByIdDeliveriesQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: webhookDeliveryAttemptsPageDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/webhooks/{id}/deliveries/{outboxId}/redeliver: Re-queue a delivery
   */
  postWebhooksByIdDeliveriesByOutboxIdRedeliver: {
    operationId: "postWebhooksByIdDeliveriesByOutboxIdRedeliver",
    method: "POST",
    path: "/api/webhooks/{id}/deliveries/{outboxId}/redeliver",
    tags: ["webhooks"],
    deprecated: false,
    permission: "webhook:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postWebhooksByIdDeliveriesByOutboxIdRedeliverPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/uploads/{bucketKey}: Upload an image
   */
  postUploadsByBucketKey: {
    operationId: "postUploadsByBucketKey",
    method: "POST",
    path: "/api/uploads/{bucketKey}",
    tags: ["storage"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["user_image:self:create","workspace_image:create","organization_image:create"],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postUploadsByBucketKeyPathParamsSchema, query: postUploadsByBucketKeyQueryParamsSchema, header: postUploadsByBucketKeyHeaderParamsSchema },
    requestBody: { required: true, content: { "*/*": { kind: "binary", schema: rawImageUploadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: storedImageDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "415": apiResponses.UnsupportedMediaType, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/storage/{bucketKey}/{storageKey}: Download a stored object
   */
  getStorageByBucketKeyByStorageKey: {
    operationId: "getStorageByBucketKeyByStorageKey",
    method: "GET",
    path: "/api/storage/{bucketKey}/{storageKey}",
    tags: ["storage"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["user_image:read","workspace_image:read","organization_image:read","attachment:read"],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getStorageByBucketKeyByStorageKeyPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: ["Cache-Control", "Content-Disposition", "X-Content-Type-Options"], content: { "*/*": { kind: "binary", schema: binaryDownloadSchema } } }, "302": { headers: ["Location"], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/stream: Realtime change stream (compatibility alias of /realtime)
   */
  getStream: {
    operationId: "getStream",
    method: "GET",
    path: "/api/stream",
    tags: ["realtime"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getStreamQueryParamsSchema, header: getStreamHeaderParamsSchema },
    requestBody: null,
    responses: { "200": { headers: [], content: { "text/event-stream": { kind: "event-stream", event: realtimeStreamEventSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /realtime: Realtime change stream (Server-Sent Events)
   */
  getRealtime: {
    operationId: "getRealtime",
    method: "GET",
    path: "/realtime",
    tags: ["realtime"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getRealtimeQueryParamsSchema, header: getRealtimeHeaderParamsSchema },
    requestBody: null,
    responses: { "200": { headers: [], content: { "text/event-stream": { kind: "event-stream", event: realtimeStreamEventSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /sync/changes: Change feed catch-up
   */
  getSyncChanges: {
    operationId: "getSyncChanges",
    method: "GET",
    path: "/sync/changes",
    tags: ["realtime"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getSyncChangesQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: syncChangesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects: List readable projects across the caller's workspaces
   */
  getProjects: {
    operationId: "getProjects",
    method: "GET",
    path: "/api/projects",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getProjectsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects: Create a project
   */
  postProjects: {
    operationId: "postProjects",
    method: "POST",
    path: "/api/projects",
    tags: ["projects"],
    deprecated: false,
    permission: "project:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createProjectBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/initialize: Create a project, its first mission and optionally a private GitHub repository
   */
  postProjectsInitialize: {
    operationId: "postProjectsInitialize",
    method: "POST",
    path: "/api/projects/initialize",
    tags: ["projects"],
    deprecated: false,
    permission: "project:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: initializeProjectBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: initializeProjectResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/reorder: Reorder a workspace's projects
   */
  patchProjectsReorder: {
    operationId: "patchProjectsReorder",
    method: "PATCH",
    path: "/api/projects/reorder",
    tags: ["projects"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderProjectsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}: Read a project
   */
  getProjectsById: {
    operationId: "getProjectsById",
    method: "GET",
    path: "/api/projects/{id}",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/projects/{id}: Soft-delete a project
   */
  deleteProjectsById: {
    operationId: "deleteProjectsById",
    method: "DELETE",
    path: "/api/projects/{id}",
    tags: ["projects"],
    deprecated: false,
    permission: "project:delete",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteProjectsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}: Update a project
   */
  patchProjectsById: {
    operationId: "patchProjectsById",
    method: "PATCH",
    path: "/api/projects/{id}",
    tags: ["projects"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/run-queues: List a project's Run Queues
   */
  getProjectsByIdRunQueues: {
    operationId: "getProjectsByIdRunQueues",
    method: "GET",
    path: "/api/projects/{id}/run-queues",
    tags: ["run-queues"],
    deprecated: false,
    permission: "objective:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdRunQueuesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectRunQueuesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/run-queues: Create a Run Queue
   */
  postProjectsByIdRunQueues: {
    operationId: "postProjectsByIdRunQueues",
    method: "POST",
    path: "/api/projects/{id}/run-queues",
    tags: ["run-queues"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdRunQueuesPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createRunQueueBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/run-queues/order: Reorder a project's Run Queues
   */
  patchProjectsByIdRunQueuesOrder: {
    operationId: "patchProjectsByIdRunQueuesOrder",
    method: "PATCH",
    path: "/api/projects/{id}/run-queues/order",
    tags: ["run-queues"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdRunQueuesOrderPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderProjectRunQueuesBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectRunQueuesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/run-queues/entries: Queue an objective
   */
  postProjectsByIdRunQueuesEntries: {
    operationId: "postProjectsByIdRunQueuesEntries",
    method: "POST",
    path: "/api/projects/{id}/run-queues/entries",
    tags: ["run-queues"],
    deprecated: false,
    permission: "execution_request:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdRunQueuesEntriesPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: enqueueRunQueueEntryBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueEntryDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/run-queues/{queueId}: Delete a Run Queue
   */
  deleteRunQueuesByQueueId: {
    operationId: "deleteRunQueuesByQueueId",
    method: "DELETE",
    path: "/api/run-queues/{queueId}",
    tags: ["run-queues"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteRunQueuesByQueueIdPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: deleteRunQueueBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueRemovalDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/run-queues/{queueId}: Rename, pause or resume a Run Queue
   */
  patchRunQueuesByQueueId: {
    operationId: "patchRunQueuesByQueueId",
    method: "PATCH",
    path: "/api/run-queues/{queueId}",
    tags: ["run-queues"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchRunQueuesByQueueIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateRunQueueBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/run-queues/{queueId}/order: Reorder a Run Queue's entries
   */
  patchRunQueuesByQueueIdOrder: {
    operationId: "patchRunQueuesByQueueIdOrder",
    method: "PATCH",
    path: "/api/run-queues/{queueId}/order",
    tags: ["run-queues"],
    deprecated: false,
    permission: "execution_request:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchRunQueuesByQueueIdOrderPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderRunQueueBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/run-queues/entries/{entryId}: Remove a Run Queue entry
   */
  deleteRunQueuesEntriesByEntryId: {
    operationId: "deleteRunQueuesEntriesByEntryId",
    method: "DELETE",
    path: "/api/run-queues/entries/{entryId}",
    tags: ["run-queues"],
    deprecated: false,
    permission: "execution_request:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteRunQueuesEntriesByEntryIdPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: deleteRunQueueEntryBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueEntryRemovalDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/run-queues/entries/{entryId}: Move or retry a Run Queue entry
   */
  patchRunQueuesEntriesByEntryId: {
    operationId: "patchRunQueuesEntriesByEntryId",
    method: "PATCH",
    path: "/api/run-queues/entries/{entryId}",
    tags: ["run-queues"],
    deprecated: false,
    permission: "execution_request:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchRunQueuesEntriesByEntryIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateRunQueueEntryBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runQueueEntryDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/statuses: List a project's statuses
   */
  getProjectsByIdStatuses: {
    operationId: "getProjectsByIdStatuses",
    method: "GET",
    path: "/api/projects/{id}/statuses",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdStatusesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectStatusListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/statuses: Create a project status
   */
  postProjectsByIdStatuses: {
    operationId: "postProjectsByIdStatuses",
    method: "POST",
    path: "/api/projects/{id}/statuses",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdStatusesPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createProjectStatusBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectStatusDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/statuses/reorder: Reorder a project's statuses
   */
  patchProjectsByIdStatusesReorder: {
    operationId: "patchProjectsByIdStatusesReorder",
    method: "PATCH",
    path: "/api/projects/{id}/statuses/reorder",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdStatusesReorderPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderProjectStatusesBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectStatusListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/projects/{id}/statuses/{statusId}: Delete a project status
   */
  deleteProjectsByIdStatusesByStatusId: {
    operationId: "deleteProjectsByIdStatusesByStatusId",
    method: "DELETE",
    path: "/api/projects/{id}/statuses/{statusId}",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteProjectsByIdStatusesByStatusIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/statuses/{statusId}: Rename a status or make it the default
   */
  patchProjectsByIdStatusesByStatusId: {
    operationId: "patchProjectsByIdStatusesByStatusId",
    method: "PATCH",
    path: "/api/projects/{id}/statuses/{statusId}",
    tags: ["project-statuses"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdStatusesByStatusIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectStatusBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectStatusDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/activity-feed: Cross-workspace, mission-anchored activity feed
   */
  getActivityFeed: {
    operationId: "getActivityFeed",
    method: "GET",
    path: "/api/activity-feed",
    tags: ["activity"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getActivityFeedQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: activityFeedDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/objective-transcript: Full-text objective history across workspaces
   */
  getObjectiveTranscript: {
    operationId: "getObjectiveTranscript",
    method: "GET",
    path: "/api/objective-transcript",
    tags: ["activity"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["mission:read","objective:read"],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getObjectiveTranscriptQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: ["Cache-Control"], content: { "application/json": { kind: "json", schema: objectiveTranscriptPageDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/deliveries/{deliveryId}/deferred-work/{actionId}/resolution: Record the operator's decision on a deferred-work item
   */
  putDeliveriesByDeliveryIdDeferredWorkByActionIdResolution: {
    operationId: "putDeliveriesByDeliveryIdDeferredWorkByActionIdResolution",
    method: "PUT",
    path: "/api/deliveries/{deliveryId}/deferred-work/{actionId}/resolution",
    tags: ["deliveries"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: resolveHumanActionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: deliveryDeferredWorkItemDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/deliveries/{deliveryId}/deferred-work/{actionId}/resolution: Reopen a deferred-work item
   */
  deleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolution: {
    operationId: "deleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolution",
    method: "DELETE",
    path: "/api/deliveries/{deliveryId}/deferred-work/{actionId}/resolution",
    tags: ["deliveries"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteDeliveriesByDeliveryIdDeferredWorkByActionIdResolutionPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: deliveryDeferredWorkItemDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/inbox/missions: Cross-workspace Inbox triage missions
   */
  getInboxMissions: {
    operationId: "getInboxMissions",
    method: "GET",
    path: "/api/inbox/missions",
    tags: ["inbox"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inboxMissionsResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/mobile/live-activities/{activityId}/push-token: Register a Live Activity update token
   */
  putMobileLiveActivitiesByActivityIdPushToken: {
    operationId: "putMobileLiveActivitiesByActivityIdPushToken",
    method: "PUT",
    path: "/api/mobile/live-activities/{activityId}/push-token",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putMobileLiveActivitiesByActivityIdPushTokenPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: registerLiveActivityPushTokenBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/mobile/live-activities/{activityId}/push-token: Remove a Live Activity update token
   */
  deleteMobileLiveActivitiesByActivityIdPushToken: {
    operationId: "deleteMobileLiveActivitiesByActivityIdPushToken",
    method: "DELETE",
    path: "/api/mobile/live-activities/{activityId}/push-token",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteMobileLiveActivitiesByActivityIdPushTokenPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/mobile/live-activities/start-token: Register a Live Activity push-to-start token
   */
  putMobileLiveActivitiesStartToken: {
    operationId: "putMobileLiveActivitiesStartToken",
    method: "PUT",
    path: "/api/mobile/live-activities/start-token",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: registerLiveActivityStartTokenBodySchema } } },
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/mobile/live-activities/start-token/revoke: Withdraw a Live Activity push-to-start token
   */
  postMobileLiveActivitiesStartTokenRevoke: {
    operationId: "postMobileLiveActivitiesStartTokenRevoke",
    method: "POST",
    path: "/api/mobile/live-activities/start-token/revoke",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: revokeLiveActivityStartTokenBodySchema } } },
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/mobile/push/device-token: Register an APNs device token
   */
  putMobilePushDeviceToken: {
    operationId: "putMobilePushDeviceToken",
    method: "PUT",
    path: "/api/mobile/push/device-token",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: registerDevicePushTokenBodySchema } } },
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/mobile/push/device-token/revoke: Remove an APNs device token
   */
  postMobilePushDeviceTokenRevoke: {
    operationId: "postMobilePushDeviceTokenRevoke",
    method: "POST",
    path: "/api/mobile/push/device-token/revoke",
    tags: ["mobile"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: revokeDevicePushTokenBodySchema } } },
    responses: { "204": { headers: [], content: {} }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/profile/notification-preferences: Read the caller's notification preferences
   */
  getProfileNotificationPreferences: {
    operationId: "getProfileNotificationPreferences",
    method: "GET",
    path: "/api/profile/notification-preferences",
    tags: ["notifications"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: notificationPreferencesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/profile/notification-preferences: Update the caller's notification preferences
   */
  putProfileNotificationPreferences: {
    operationId: "putProfileNotificationPreferences",
    method: "PUT",
    path: "/api/profile/notification-preferences",
    tags: ["notifications"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateNotificationPreferencesBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: notificationPreferencesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/notifications: List the caller's notifications
   */
  getNotifications: {
    operationId: "getNotifications",
    method: "GET",
    path: "/api/notifications",
    tags: ["notifications"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: notificationListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/notifications/{id}/read: Mark a notification read
   */
  patchNotificationsByIdRead: {
    operationId: "patchNotificationsByIdRead",
    method: "PATCH",
    path: "/api/notifications/{id}/read",
    tags: ["notifications"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchNotificationsByIdReadPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: notificationRevisionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: notificationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/notifications/{id}: Dismiss a notification
   */
  deleteNotificationsById: {
    operationId: "deleteNotificationsById",
    method: "DELETE",
    path: "/api/notifications/{id}",
    tags: ["notifications"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteNotificationsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: notificationRevisionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/tags: List a project's tags
   */
  getProjectsByIdTags: {
    operationId: "getProjectsByIdTags",
    method: "GET",
    path: "/api/projects/{id}/tags",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdTagsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectTagListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/tags: Create a project tag
   */
  postProjectsByIdTags: {
    operationId: "postProjectsByIdTags",
    method: "POST",
    path: "/api/projects/{id}/tags",
    tags: ["projects"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdTagsPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createProjectTagBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectTagDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/projects/{id}/tags/{tagId}: Delete a project tag
   */
  deleteProjectsByIdTagsByTagId: {
    operationId: "deleteProjectsByIdTagsByTagId",
    method: "DELETE",
    path: "/api/projects/{id}/tags/{tagId}",
    tags: ["projects"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteProjectsByIdTagsByTagIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/tags/{tagId}: Update a project tag
   */
  patchProjectsByIdTagsByTagId: {
    operationId: "patchProjectsByIdTagsByTagId",
    method: "PATCH",
    path: "/api/projects/{id}/tags/{tagId}",
    tags: ["projects"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdTagsByTagIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectTagBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectTagDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/resources: List a project's resources
   */
  getProjectsByIdResources: {
    operationId: "getProjectsByIdResources",
    method: "GET",
    path: "/api/projects/{id}/resources",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdResourcesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectResourceListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/resources: Link a project resource or add a source to one
   */
  postProjectsByIdResources: {
    operationId: "postProjectsByIdResources",
    method: "POST",
    path: "/api/projects/{id}/resources",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdResourcesPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createProjectResourceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectResourceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/projects/{id}/resources/{resourceId}: Delete a project resource
   */
  deleteProjectsByIdResourcesByResourceId: {
    operationId: "deleteProjectsByIdResourcesByResourceId",
    method: "DELETE",
    path: "/api/projects/{id}/resources/{resourceId}",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteProjectsByIdResourcesByResourceIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/resources/{resourceId}: Update a project resource
   */
  patchProjectsByIdResourcesByResourceId: {
    operationId: "patchProjectsByIdResourcesByResourceId",
    method: "PATCH",
    path: "/api/projects/{id}/resources/{resourceId}",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdResourcesByResourceIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectResourceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectResourceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/projects/{id}/resources/{resourceId}/sources/{sourceId}: Disconnect one source from a project resource
   */
  deleteProjectsByIdResourcesByResourceIdSourcesBySourceId: {
    operationId: "deleteProjectsByIdResourcesByResourceIdSourcesBySourceId",
    method: "DELETE",
    path: "/api/projects/{id}/resources/{resourceId}/sources/{sourceId}",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/projects/{id}/resources/{resourceId}/sources/{sourceId}: Replace a resource source's launch defaults
   */
  patchProjectsByIdResourcesByResourceIdSourcesBySourceId: {
    operationId: "patchProjectsByIdResourcesByResourceIdSourcesBySourceId",
    method: "PATCH",
    path: "/api/projects/{id}/resources/{resourceId}/sources/{sourceId}",
    tags: ["project-resources"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdResourcesByResourceIdSourcesBySourceIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectResourceSourceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectResourceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/projects/{id}/repository-reads: Run a bounded read-only repository read on an execution target
   */
  postProjectsByIdRepositoryReads: {
    operationId: "postProjectsByIdRepositoryReads",
    method: "POST",
    path: "/api/projects/{id}/repository-reads",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProjectsByIdRepositoryReadsPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: repositoryReadRequestSchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: repositoryReadResultSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/repository: Describe the project's repository resource
   */
  getProjectsByIdRepository: {
    operationId: "getProjectsByIdRepository",
    method: "GET",
    path: "/api/projects/{id}/repository",
    tags: ["projects"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdRepositoryPathParamsSchema, query: getProjectsByIdRepositoryQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectRepositoryDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/local-target/invoke: Run a checkout-local capability on the backend host (development proxy)
   */
  postLocalTargetInvoke: {
    operationId: "postLocalTargetInvoke",
    method: "POST",
    path: "/api/local-target/invoke",
    tags: ["local-target"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "local",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: localTargetBridgeCallBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: capabilityResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/missions: List a project's board missions
   */
  getProjectsByIdMissions: {
    operationId: "getProjectsByIdMissions",
    method: "GET",
    path: "/api/projects/{id}/missions",
    tags: ["missions"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["mission:read","objective:read"],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdMissionsPathParamsSchema, query: getProjectsByIdMissionsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /ext/everhour/user-connection: The caller's Everhour connection (compatibility alias)
   */
  getExtEverhourUserConnection: {
    operationId: "getExtEverhourUserConnection",
    method: "GET",
    path: "/ext/everhour/user-connection",
    tags: ["everhour"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /ext/everhour/user-connection: Connect or rotate the caller's Everhour API key (compatibility alias)
   */
  putExtEverhourUserConnection: {
    operationId: "putExtEverhourUserConnection",
    method: "PUT",
    path: "/ext/everhour/user-connection",
    tags: ["everhour"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateEverhourIntegrationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * DELETE /ext/everhour/user-connection: Disconnect the caller's Everhour key (compatibility alias)
   */
  deleteExtEverhourUserConnection: {
    operationId: "deleteExtEverhourUserConnection",
    method: "DELETE",
    path: "/ext/everhour/user-connection",
    tags: ["everhour"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /ext/everhour/integration: The caller's Everhour connection (deprecated alias of /user-connection)
   * @deprecated
   */
  getExtEverhourIntegration: {
    operationId: "getExtEverhourIntegration",
    method: "GET",
    path: "/ext/everhour/integration",
    tags: ["everhour"],
    deprecated: true,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /ext/everhour/integration: Connect or rotate the caller's Everhour API key (deprecated alias of /user-connection)
   * @deprecated
   */
  putExtEverhourIntegration: {
    operationId: "putExtEverhourIntegration",
    method: "PUT",
    path: "/ext/everhour/integration",
    tags: ["everhour"],
    deprecated: true,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateEverhourIntegrationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * DELETE /ext/everhour/integration: Disconnect the caller's Everhour key (deprecated alias of /user-connection)
   * @deprecated
   */
  deleteExtEverhourIntegration: {
    operationId: "deleteExtEverhourIntegration",
    method: "DELETE",
    path: "/ext/everhour/integration",
    tags: ["everhour"],
    deprecated: true,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: everhourUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /ext/everhour/projects/{projectId}/link: Read a project's Everhour link
   */
  getExtEverhourProjectsByProjectIdLink: {
    operationId: "getExtEverhourProjectsByProjectIdLink",
    method: "GET",
    path: "/ext/everhour/projects/{projectId}/link",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getExtEverhourProjectsByProjectIdLinkPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourLinkDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * PUT /ext/everhour/projects/{projectId}/link: Link a project to an Everhour project by name, or unlink it
   */
  putExtEverhourProjectsByProjectIdLink: {
    operationId: "putExtEverhourProjectsByProjectIdLink",
    method: "PUT",
    path: "/ext/everhour/projects/{projectId}/link",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putExtEverhourProjectsByProjectIdLinkPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: linkProjectEverhourBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourLinkDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/everhour/projects/{projectId}: Read a project's Everhour time state
   */
  getExtEverhourProjectsByProjectId: {
    operationId: "getExtEverhourProjectsByProjectId",
    method: "GET",
    path: "/ext/everhour/projects/{projectId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getExtEverhourProjectsByProjectIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/projects/{projectId}/timer/start: Start the project's Everhour timer
   */
  postExtEverhourProjectsByProjectIdTimerStart: {
    operationId: "postExtEverhourProjectsByProjectIdTimerStart",
    method: "POST",
    path: "/ext/everhour/projects/{projectId}/timer/start",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourProjectsByProjectIdTimerStartPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/projects/{projectId}/timer/stop: Stop the caller's running Everhour timer
   */
  postExtEverhourProjectsByProjectIdTimerStop: {
    operationId: "postExtEverhourProjectsByProjectIdTimerStop",
    method: "POST",
    path: "/ext/everhour/projects/{projectId}/timer/stop",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourProjectsByProjectIdTimerStopPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/projects/{projectId}/time: Add time to the project's general task
   */
  postExtEverhourProjectsByProjectIdTime: {
    operationId: "postExtEverhourProjectsByProjectIdTime",
    method: "POST",
    path: "/ext/everhour/projects/{projectId}/time",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourProjectsByProjectIdTimePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createEverhourTimeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * DELETE /ext/everhour/projects/{projectId}/time/{recordId}: Delete an Everhour time record
   */
  deleteExtEverhourProjectsByProjectIdTimeByRecordId: {
    operationId: "deleteExtEverhourProjectsByProjectIdTimeByRecordId",
    method: "DELETE",
    path: "/ext/everhour/projects/{projectId}/time/{recordId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteExtEverhourProjectsByProjectIdTimeByRecordIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * PATCH /ext/everhour/projects/{projectId}/time/{recordId}: Change an Everhour time record
   */
  patchExtEverhourProjectsByProjectIdTimeByRecordId: {
    operationId: "patchExtEverhourProjectsByProjectIdTimeByRecordId",
    method: "PATCH",
    path: "/ext/everhour/projects/{projectId}/time/{recordId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchExtEverhourProjectsByProjectIdTimeByRecordIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateEverhourTimeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/everhour/missions/{missionId}: Read a mission's Everhour time state
   */
  getExtEverhourMissionsByMissionId: {
    operationId: "getExtEverhourMissionsByMissionId",
    method: "GET",
    path: "/ext/everhour/missions/{missionId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getExtEverhourMissionsByMissionIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/missions/{missionId}/timer/start: Start the mission's Everhour timer
   */
  postExtEverhourMissionsByMissionIdTimerStart: {
    operationId: "postExtEverhourMissionsByMissionIdTimerStart",
    method: "POST",
    path: "/ext/everhour/missions/{missionId}/timer/start",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourMissionsByMissionIdTimerStartPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/missions/{missionId}/timer/stop: Stop the caller's running Everhour timer
   */
  postExtEverhourMissionsByMissionIdTimerStop: {
    operationId: "postExtEverhourMissionsByMissionIdTimerStop",
    method: "POST",
    path: "/ext/everhour/missions/{missionId}/timer/stop",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourMissionsByMissionIdTimerStopPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * POST /ext/everhour/missions/{missionId}/time: Add time to the mission's Everhour task
   */
  postExtEverhourMissionsByMissionIdTime: {
    operationId: "postExtEverhourMissionsByMissionIdTime",
    method: "POST",
    path: "/ext/everhour/missions/{missionId}/time",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtEverhourMissionsByMissionIdTimePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createEverhourTimeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * DELETE /ext/everhour/missions/{missionId}/time/{recordId}: Delete an Everhour time record
   */
  deleteExtEverhourMissionsByMissionIdTimeByRecordId: {
    operationId: "deleteExtEverhourMissionsByMissionIdTimeByRecordId",
    method: "DELETE",
    path: "/ext/everhour/missions/{missionId}/time/{recordId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteExtEverhourMissionsByMissionIdTimeByRecordIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * PATCH /ext/everhour/missions/{missionId}/time/{recordId}: Change an Everhour time record
   */
  patchExtEverhourMissionsByMissionIdTimeByRecordId: {
    operationId: "patchExtEverhourMissionsByMissionIdTimeByRecordId",
    method: "PATCH",
    path: "/ext/everhour/missions/{missionId}/time/{recordId}",
    tags: ["everhour"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "everhour",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchExtEverhourMissionsByMissionIdTimeByRecordIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateEverhourTimeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEverhourStateDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/user-connection: The caller's GitHub repository authorization (compatibility alias)
   */
  getExtGithubUserConnection: {
    operationId: "getExtGithubUserConnection",
    method: "GET",
    path: "/ext/github/user-connection",
    tags: ["github"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /ext/github/user-connection: Disconnect the caller's GitHub repository authorization (compatibility alias)
   */
  deleteExtGithubUserConnection: {
    operationId: "deleteExtGithubUserConnection",
    method: "DELETE",
    path: "/ext/github/user-connection",
    tags: ["github"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubUserConnectionDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /ext/github/user-connection/authorize: Start GitHub repository authorization (compatibility alias)
   */
  postExtGithubUserConnectionAuthorize: {
    operationId: "postExtGithubUserConnectionAuthorize",
    method: "POST",
    path: "/ext/github/user-connection/authorize",
    tags: ["github"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: beginGitHubUserAuthorizationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubUserAuthorizationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/repository-owners: List the GitHub owners the caller can create private repositories under
   */
  getExtGithubRepositoryOwners: {
    operationId: "getExtGithubRepositoryOwners",
    method: "GET",
    path: "/ext/github/repository-owners",
    tags: ["github"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubRepositoryOwnerListSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": apiResponses.NotFound, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "503": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/integration: Read a workspace's GitHub App installation
   */
  getExtGithubIntegration: {
    operationId: "getExtGithubIntegration",
    method: "GET",
    path: "/ext/github/integration",
    tags: ["github"],
    deprecated: false,
    permission: "workspace:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getExtGithubIntegrationQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubIntegrationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /ext/github/integration: Disconnect a workspace's GitHub App installation
   */
  deleteExtGithubIntegration: {
    operationId: "deleteExtGithubIntegration",
    method: "DELETE",
    path: "/ext/github/integration",
    tags: ["github"],
    deprecated: false,
    permission: "workspace:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: deleteExtGithubIntegrationQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubIntegrationDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * POST /ext/github/install: Start a GitHub App installation for a workspace
   */
  postExtGithubInstall: {
    operationId: "postExtGithubInstall",
    method: "POST",
    path: "/ext/github/install",
    tags: ["github"],
    deprecated: false,
    permission: "workspace:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: postExtGithubInstallQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubInstallUrlDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * GET /ext/github/callback: Complete a GitHub App installation
   */
  getExtGithubCallback: {
    operationId: "getExtGithubCallback",
    method: "GET",
    path: "/ext/github/callback",
    tags: ["github"],
    deprecated: false,
    permission: "workspace:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["external"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getExtGithubCallbackQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: getExtGithubCallbackResponse200Schema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/repos: List repositories the workspace's GitHub App can access
   */
  getExtGithubRepos: {
    operationId: "getExtGithubRepos",
    method: "GET",
    path: "/ext/github/repos",
    tags: ["github"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getExtGithubReposQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubRepoSummaryListSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/projects/{projectId}/link: Read a project's GitHub repository link
   */
  getExtGithubProjectsByProjectIdLink: {
    operationId: "getExtGithubProjectsByProjectIdLink",
    method: "GET",
    path: "/ext/github/projects/{projectId}/link",
    tags: ["github"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getExtGithubProjectsByProjectIdLinkPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectGitHubLinkDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * PUT /ext/github/projects/{projectId}/link: Link a project to a GitHub repository, or unlink it
   */
  putExtGithubProjectsByProjectIdLink: {
    operationId: "putExtGithubProjectsByProjectIdLink",
    method: "PUT",
    path: "/ext/github/projects/{projectId}/link",
    tags: ["github"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putExtGithubProjectsByProjectIdLinkPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: linkProjectGitHubBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectGitHubLinkDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /ext/github/missions/{missionId}/pull-request: Read the pull request recorded for a mission
   */
  getExtGithubMissionsByMissionIdPullRequest: {
    operationId: "getExtGithubMissionsByMissionIdPullRequest",
    method: "GET",
    path: "/ext/github/missions/{missionId}/pull-request",
    tags: ["github"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getExtGithubMissionsByMissionIdPullRequestPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: getExtGithubMissionsByMissionIdPullRequestResponse200Schema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError }
  },
  /**
   * POST /ext/github/missions/{missionId}/pull-request: Open a pull request for a mission's branch
   */
  postExtGithubMissionsByMissionIdPullRequest: {
    operationId: "postExtGithubMissionsByMissionIdPullRequest",
    method: "POST",
    path: "/ext/github/missions/{missionId}/pull-request",
    tags: ["github"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: "github",
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExtGithubMissionsByMissionIdPullRequestPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: createGitHubPullRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: gitHubPullRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "404": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "409": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "429": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * PATCH /api/projects/{id}/board/reorder: Reorder (and move missions into) one board column
   */
  patchProjectsByIdBoardReorder: {
    operationId: "patchProjectsByIdBoardReorder",
    method: "PATCH",
    path: "/api/projects/{id}/board/reorder",
    tags: ["projects"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchProjectsByIdBoardReorderPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderBoardColumnBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/inbox: List the caller's Inbox captures
   */
  getInbox: {
    operationId: "getInbox",
    method: "GET",
    path: "/api/inbox",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inboxItemListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/inbox: Capture an Inbox item
   */
  postInbox: {
    operationId: "postInbox",
    method: "POST",
    path: "/api/inbox",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createInboxItemBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inboxItemDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/inbox/{id}: Read an owned Inbox item
   */
  getInboxById: {
    operationId: "getInboxById",
    method: "GET",
    path: "/api/inbox/{id}",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getInboxByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inboxItemDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/inbox/{id}: Delete an owned Inbox item
   */
  deleteInboxById: {
    operationId: "deleteInboxById",
    method: "DELETE",
    path: "/api/inbox/{id}",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteInboxByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/inbox/{id}: Edit an owned Inbox item
   */
  patchInboxById: {
    operationId: "patchInboxById",
    method: "PATCH",
    path: "/api/inbox/{id}",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchInboxByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateInboxItemBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: inboxItemDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/inbox/{id}/promote: Promote an Inbox item into a mission
   */
  postInboxByIdPromote: {
    operationId: "postInboxByIdPromote",
    method: "POST",
    path: "/api/inbox/{id}/promote",
    tags: ["inbox"],
    deprecated: false,
    permission: "mission:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postInboxByIdPromotePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: promoteInboxItemBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/search: Mission search, version 1 (frozen)
   */
  getMissionsSearch: {
    operationId: "getMissionsSearch",
    method: "GET",
    path: "/api/missions/search",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getMissionsSearchQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionSearchV1ResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/search/v2: Mission search, version 2
   */
  getMissionsSearchV2: {
    operationId: "getMissionsSearchV2",
    method: "GET",
    path: "/api/missions/search/v2",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getMissionsSearchV2QueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: searchMissionsResponseV2Schema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/search/v3: Mission-anchored search over missions, objectives and deliveries (version 3)
   */
  getSearchV3: {
    operationId: "getSearchV3",
    method: "GET",
    path: "/api/search/v3",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getSearchV3QueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: searchResponseV3Schema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions: Create a mission
   */
  postMissions: {
    operationId: "postMissions",
    method: "POST",
    path: "/api/missions",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createMissionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}: Read a mission's detail
   */
  getMissionsById: {
    operationId: "getMissionsById",
    method: "GET",
    path: "/api/missions/{id}",
    tags: ["missions"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["mission:read","objective:read"],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/missions/{id}: Soft-delete a mission
   */
  deleteMissionsById: {
    operationId: "deleteMissionsById",
    method: "DELETE",
    path: "/api/missions/{id}",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:delete",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteMissionsByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/missions/{id}: Update or move a mission
   */
  patchMissionsById: {
    operationId: "patchMissionsById",
    method: "PATCH",
    path: "/api/missions/{id}",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchMissionsByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateMissionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/generate-title: Regenerate a mission title
   */
  postMissionsByIdGenerateTitle: {
    operationId: "postMissionsByIdGenerateTitle",
    method: "POST",
    path: "/api/missions/{id}/generate-title",
    tags: ["missions"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["mission:update","mission:read","objective:read"],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdGenerateTitlePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError, "502": apiResponses.BadGateway }
  },
  /**
   * POST /api/missions/{id}/generate-commit-message: Draft a commit message from a client-supplied diff
   */
  postMissionsByIdGenerateCommitMessage: {
    operationId: "postMissionsByIdGenerateCommitMessage",
    method: "POST",
    path: "/api/missions/{id}/generate-commit-message",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdGenerateCommitMessagePathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: generateCommitMessageBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: generateCommitMessageResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError, "502": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } } }
  },
  /**
   * GET /api/missions/{id}/objectives: List a mission's objectives
   */
  getMissionsByIdObjectives: {
    operationId: "getMissionsByIdObjectives",
    method: "GET",
    path: "/api/missions/{id}/objectives",
    tags: ["missions"],
    deprecated: false,
    permission: "objective:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdObjectivesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/missions/{id}/objectives/reorder: Reorder a mission's future objectives
   */
  patchMissionsByIdObjectivesReorder: {
    operationId: "patchMissionsByIdObjectivesReorder",
    method: "PATCH",
    path: "/api/missions/{id}/objectives/reorder",
    tags: ["missions"],
    deprecated: false,
    permission: "objective:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchMissionsByIdObjectivesReorderPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reorderFutureObjectivesBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/session-channel: Prepare a session channel (retired)
   */
  postMissionsByIdSessionChannel: {
    operationId: "postMissionsByIdSessionChannel",
    method: "POST",
    path: "/api/missions/{id}/session-channel",
    tags: ["agent-session-channels"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdSessionChannelPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/terminal-sessions/forget: Forget a mission's mapped Latch terminal session
   */
  postMissionsByIdTerminalSessionsForget: {
    operationId: "postMissionsByIdTerminalSessionsForget",
    method: "POST",
    path: "/api/missions/{id}/terminal-sessions/forget",
    tags: ["missions"],
    deprecated: false,
    permission: "session:attach",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdTerminalSessionsForgetPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: forgetTerminalSessionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: forgetTerminalSessionResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/agent-requests: List agent requests
   */
  getAgentRequests: {
    operationId: "getAgentRequests",
    method: "GET",
    path: "/api/agent-requests",
    tags: ["agent-requests"],
    deprecated: false,
    permission: "session:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getAgentRequestsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentRequestListResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-requests/{id}/resolve: Answer an agent question
   */
  postAgentRequestsByIdResolve: {
    operationId: "postAgentRequestsByIdResolve",
    method: "POST",
    path: "/api/agent-requests/{id}/resolve",
    tags: ["agent-requests"],
    deprecated: false,
    permission: "session:attach",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postAgentRequestsByIdResolvePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: resolveAgentRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: resolveAgentRequestResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-requests/{id}/release: Release an agent request to the terminal (retired)
   */
  postAgentRequestsByIdRelease: {
    operationId: "postAgentRequestsByIdRelease",
    method: "POST",
    path: "/api/agent-requests/{id}/release",
    tags: ["agent-requests"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postAgentRequestsByIdReleasePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/agent-session-inputs: List a mission's session inputs and its latest channel
   */
  getAgentSessionInputs: {
    operationId: "getAgentSessionInputs",
    method: "GET",
    path: "/api/agent-session-inputs",
    tags: ["agent-session-inputs"],
    deprecated: false,
    permission: "session:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getAgentSessionInputsQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentSessionInputListResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-inputs: Queue a session input (retired)
   */
  postAgentSessionInputs: {
    operationId: "postAgentSessionInputs",
    method: "POST",
    path: "/api/agent-session-inputs",
    tags: ["agent-session-inputs"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-session-inputs/{id}/cancel: Cancel a session input (retired)
   */
  postAgentSessionInputsByIdCancel: {
    operationId: "postAgentSessionInputsByIdCancel",
    method: "POST",
    path: "/api/agent-session-inputs/{id}/cancel",
    tags: ["agent-session-inputs"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postAgentSessionInputsByIdCancelPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "410": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/events: List a mission's workflow events
   */
  getMissionsByIdEvents: {
    operationId: "getMissionsByIdEvents",
    method: "GET",
    path: "/api/missions/{id}/events",
    tags: ["missions"],
    deprecated: false,
    permission: "event:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdEventsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionEventListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/deliveries: List a mission's deliveries
   */
  getMissionsByIdDeliveries: {
    operationId: "getMissionsByIdDeliveries",
    method: "GET",
    path: "/api/missions/{id}/deliveries",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdDeliveriesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDeliveriesDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/summary: Read the operator mission summary
   */
  getMissionsByIdSummary: {
    operationId: "getMissionsByIdSummary",
    method: "GET",
    path: "/api/missions/{id}/summary",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdSummaryPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionSummaryResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/missions/{id}/summary/seen: Acknowledge displayed summary evidence
   */
  putMissionsByIdSummarySeen: {
    operationId: "putMissionsByIdSummarySeen",
    method: "PUT",
    path: "/api/missions/{id}/summary/seen",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putMissionsByIdSummarySeenPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: markMissionSummarySeenBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionSummarySeenResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/artifacts: List a mission's artifacts
   */
  getMissionsByIdArtifacts: {
    operationId: "getMissionsByIdArtifacts",
    method: "GET",
    path: "/api/missions/{id}/artifacts",
    tags: ["missions"],
    deprecated: false,
    permission: "artifact:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdArtifactsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: artifactListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/artifacts: Create a mission artifact without a delivery
   */
  postMissionsByIdArtifacts: {
    operationId: "postMissionsByIdArtifacts",
    method: "POST",
    path: "/api/missions/{id}/artifacts",
    tags: ["missions"],
    deprecated: false,
    permission: "artifact:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdArtifactsPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createArtifactBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: artifactDtoSchema } } }, "400": apiResponses.BadRequest, "401": { headers: [], content: { "application/json": { kind: "json", schema: errorEnvelopeSchema } } }, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/context: List a mission's shared context
   */
  getMissionsByIdContext: {
    operationId: "getMissionsByIdContext",
    method: "GET",
    path: "/api/missions/{id}/context",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdContextPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: sharedContextEntryListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/missions/{id}/context: Upsert one shared-context entry
   */
  putMissionsByIdContext: {
    operationId: "putMissionsByIdContext",
    method: "PUT",
    path: "/api/missions/{id}/context",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putMissionsByIdContextPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: upsertSharedContextBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: sharedContextEntryDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/missions/{id}/artifacts/{artifactId}: Edit an artifact's human-facing fields
   */
  patchMissionsByIdArtifactsByArtifactId: {
    operationId: "patchMissionsByIdArtifactsByArtifactId",
    method: "PATCH",
    path: "/api/missions/{id}/artifacts/{artifactId}",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchMissionsByIdArtifactsByArtifactIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateArtifactBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: artifactDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/file-changes: List a mission's or one objective's changed files
   */
  getMissionsByIdFileChanges: {
    operationId: "getMissionsByIdFileChanges",
    method: "GET",
    path: "/api/missions/{id}/file-changes",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdFileChangesPathParamsSchema, query: getMissionsByIdFileChangesQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: getMissionsByIdFileChangesResponse200Schema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/schedule/preview: Preview a schedule's next due date
   */
  postMissionsSchedulePreview: {
    operationId: "postMissionsSchedulePreview",
    method: "POST",
    path: "/api/missions/schedule/preview",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: previewScheduleBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: schedulePreviewDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/schedule: Read a mission's schedule
   */
  getMissionsByIdSchedule: {
    operationId: "getMissionsByIdSchedule",
    method: "GET",
    path: "/api/missions/{id}/schedule",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdSchedulePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionScheduleDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/missions/{id}/schedule: Create or replace a mission's schedule
   */
  putMissionsByIdSchedule: {
    operationId: "putMissionsByIdSchedule",
    method: "PUT",
    path: "/api/missions/{id}/schedule",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putMissionsByIdSchedulePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: scheduleInputSchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionScheduleDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/missions/{id}/schedule: Unlink a mission's schedule
   */
  deleteMissionsByIdSchedule: {
    operationId: "deleteMissionsByIdSchedule",
    method: "DELETE",
    path: "/api/missions/{id}/schedule",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteMissionsByIdSchedulePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/objectives: Add an objective to a mission
   */
  postObjectives: {
    operationId: "postObjectives",
    method: "POST",
    path: "/api/objectives",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: createObjectiveBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/objectives/{id}: Soft-delete an objective
   */
  deleteObjectivesById: {
    operationId: "deleteObjectivesById",
    method: "DELETE",
    path: "/api/objectives/{id}",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteObjectivesByIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/objectives/{id}: Update an objective
   */
  patchObjectivesById: {
    operationId: "patchObjectivesById",
    method: "PATCH",
    path: "/api/objectives/{id}",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchObjectivesByIdPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateObjectiveBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/objectives/{id}/launch: Queue an execution request for an objective
   */
  postObjectivesByIdLaunch: {
    operationId: "postObjectivesByIdLaunch",
    method: "POST",
    path: "/api/objectives/{id}/launch",
    tags: ["objectives"],
    deprecated: false,
    permission: "execution_request:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postObjectivesByIdLaunchPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: launchObjectiveBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: executionRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/objectives/{id}/prompt: Copyable prompt for running an objective manually
   */
  getObjectivesByIdPrompt: {
    operationId: "getObjectivesByIdPrompt",
    method: "GET",
    path: "/api/objectives/{id}/prompt",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getObjectivesByIdPromptPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectivePromptDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/objectives/{id}/launch-command: Paste-ready ovld launch command
   */
  getObjectivesByIdLaunchCommand: {
    operationId: "getObjectivesByIdLaunchCommand",
    method: "GET",
    path: "/api/objectives/{id}/launch-command",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getObjectivesByIdLaunchCommandPathParamsSchema, query: getObjectivesByIdLaunchCommandQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveLaunchCommandDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/objectives/{id}/effective-launch-config: Resolved launch mechanics for an objective
   */
  getObjectivesByIdEffectiveLaunchConfig: {
    operationId: "getObjectivesByIdEffectiveLaunchConfig",
    method: "GET",
    path: "/api/objectives/{id}/effective-launch-config",
    tags: ["objectives"],
    deprecated: false,
    permission: "objective:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getObjectivesByIdEffectiveLaunchConfigPathParamsSchema, query: getObjectivesByIdEffectiveLaunchConfigQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveEffectiveLaunchConfigDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/objectives/{id}/attachments: List an objective's attachments
   */
  getObjectivesByIdAttachments: {
    operationId: "getObjectivesByIdAttachments",
    method: "GET",
    path: "/api/objectives/{id}/attachments",
    tags: ["objectives"],
    deprecated: false,
    permission: "attachment:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getObjectivesByIdAttachmentsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/objectives/{id}/attachments: Upload a file to an objective
   */
  postObjectivesByIdAttachments: {
    operationId: "postObjectivesByIdAttachments",
    method: "POST",
    path: "/api/objectives/{id}/attachments",
    tags: ["objectives"],
    deprecated: false,
    permission: "attachment:create",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postObjectivesByIdAttachmentsPathParamsSchema, query: null, header: postObjectivesByIdAttachmentsHeaderParamsSchema },
    requestBody: { required: true, content: { "*/*": { kind: "binary", schema: rawUploadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/objectives/{id}/attachments/{attachmentId}: Delete an objective attachment
   */
  deleteObjectivesByIdAttachmentsByAttachmentId: {
    operationId: "deleteObjectivesByIdAttachmentsByAttachmentId",
    method: "DELETE",
    path: "/api/objectives/{id}/attachments/{attachmentId}",
    tags: ["objectives"],
    deprecated: false,
    permission: "attachment:delete",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteObjectivesByIdAttachmentsByAttachmentIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/inbox/{id}/attachments: List an owned Inbox item's attachments
   */
  getInboxByIdAttachments: {
    operationId: "getInboxByIdAttachments",
    method: "GET",
    path: "/api/inbox/{id}/attachments",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getInboxByIdAttachmentsPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/inbox/{id}/attachments: Upload a file to an owned Inbox item
   */
  postInboxByIdAttachments: {
    operationId: "postInboxByIdAttachments",
    method: "POST",
    path: "/api/inbox/{id}/attachments",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postInboxByIdAttachmentsPathParamsSchema, query: null, header: postInboxByIdAttachmentsHeaderParamsSchema },
    requestBody: { required: true, content: { "*/*": { kind: "binary", schema: rawUploadBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * DELETE /api/inbox/{id}/attachments/{attachmentId}: Delete an owned Inbox item's attachment
   */
  deleteInboxByIdAttachmentsByAttachmentId: {
    operationId: "deleteInboxByIdAttachmentsByAttachmentId",
    method: "DELETE",
    path: "/api/inbox/{id}/attachments/{attachmentId}",
    tags: ["inbox"],
    deprecated: false,
    permission: "owner",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: deleteInboxByIdAttachmentsByAttachmentIdPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: objectiveAttachmentListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/agent-catalog: Read an agent catalog (workspace in the query)
   */
  getAgentCatalog: {
    operationId: "getAgentCatalog",
    method: "GET",
    path: "/api/agent-catalog",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getAgentCatalogQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/agent-catalog: Replace an agent catalog (workspace in the query)
   */
  putAgentCatalog: {
    operationId: "putAgentCatalog",
    method: "PUT",
    path: "/api/agent-catalog",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: putAgentCatalogQueryParamsSchema, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateAgentCatalogBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/agent-catalog/refresh: Merge newly shipped agents and models (workspace in the query)
   */
  postAgentCatalogRefresh: {
    operationId: "postAgentCatalogRefresh",
    method: "POST",
    path: "/api/agent-catalog/refresh",
    tags: ["agent-catalog"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: postAgentCatalogRefreshQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: agentCatalogDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/launch-settings: Read the caller's launch settings (workspace in the query)
   */
  getLaunchSettings: {
    operationId: "getLaunchSettings",
    method: "GET",
    path: "/api/launch-settings",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getLaunchSettingsQueryParamsSchema, header: getLaunchSettingsHeaderParamsSchema },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/launch-settings/agents/{agentKey}: Set the caller's launch mechanics for one agent (workspace in the query)
   */
  patchLaunchSettingsAgentsByAgentKey: {
    operationId: "patchLaunchSettingsAgentsByAgentKey",
    method: "PATCH",
    path: "/api/launch-settings/agents/{agentKey}",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchLaunchSettingsAgentsByAgentKeyPathParamsSchema, query: patchLaunchSettingsAgentsByAgentKeyQueryParamsSchema, header: patchLaunchSettingsAgentsByAgentKeyHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateAgentLaunchConfigBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/launch-settings/terminal-profile: Set the caller's terminal profile (workspace in the query)
   */
  patchLaunchSettingsTerminalProfile: {
    operationId: "patchLaunchSettingsTerminalProfile",
    method: "PATCH",
    path: "/api/launch-settings/terminal-profile",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: patchLaunchSettingsTerminalProfileQueryParamsSchema, header: patchLaunchSettingsTerminalProfileHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateTerminalProfileBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/launch-settings/session-defaults: Set the caller's launch-session defaults (workspace in the query)
   */
  patchLaunchSettingsSessionDefaults: {
    operationId: "patchLaunchSettingsSessionDefaults",
    method: "PATCH",
    path: "/api/launch-settings/session-defaults",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: patchLaunchSettingsSessionDefaultsQueryParamsSchema, header: patchLaunchSettingsSessionDefaultsHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateLaunchSessionDefaultsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/launch-settings/worktree-branch-automation: Turn worktree and branch automation on or off (workspace in the query)
   */
  patchLaunchSettingsWorktreeBranchAutomation: {
    operationId: "patchLaunchSettingsWorktreeBranchAutomation",
    method: "PATCH",
    path: "/api/launch-settings/worktree-branch-automation",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: patchLaunchSettingsWorktreeBranchAutomationQueryParamsSchema, header: patchLaunchSettingsWorktreeBranchAutomationHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWorktreeBranchAutomationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/workspaces/{id}/launch-settings: Read the caller's launch settings
   */
  getWorkspacesByIdLaunchSettings: {
    operationId: "getWorkspacesByIdLaunchSettings",
    method: "GET",
    path: "/api/workspaces/{id}/launch-settings",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getWorkspacesByIdLaunchSettingsPathParamsSchema, query: null, header: getWorkspacesByIdLaunchSettingsHeaderParamsSchema },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/launch-settings/agents/{agentKey}: Set the caller's launch mechanics for one agent
   */
  patchWorkspacesByIdLaunchSettingsAgentsByAgentKey: {
    operationId: "patchWorkspacesByIdLaunchSettingsAgentsByAgentKey",
    method: "PATCH",
    path: "/api/workspaces/{id}/launch-settings/agents/{agentKey}",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdLaunchSettingsAgentsByAgentKeyPathParamsSchema, query: null, header: patchWorkspacesByIdLaunchSettingsAgentsByAgentKeyHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateAgentLaunchConfigBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/launch-settings/terminal-profile: Set the caller's terminal profile for the acting machine
   */
  patchWorkspacesByIdLaunchSettingsTerminalProfile: {
    operationId: "patchWorkspacesByIdLaunchSettingsTerminalProfile",
    method: "PATCH",
    path: "/api/workspaces/{id}/launch-settings/terminal-profile",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["cli","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdLaunchSettingsTerminalProfilePathParamsSchema, query: null, header: patchWorkspacesByIdLaunchSettingsTerminalProfileHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateTerminalProfileBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/launch-settings/session-defaults: Set the caller's launch-session defaults
   */
  patchWorkspacesByIdLaunchSettingsSessionDefaults: {
    operationId: "patchWorkspacesByIdLaunchSettingsSessionDefaults",
    method: "PATCH",
    path: "/api/workspaces/{id}/launch-settings/session-defaults",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdLaunchSettingsSessionDefaultsPathParamsSchema, query: null, header: patchWorkspacesByIdLaunchSettingsSessionDefaultsHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateLaunchSessionDefaultsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * PATCH /api/workspaces/{id}/launch-settings/worktree-branch-automation: Turn the caller's worktree and branch automation on or off
   */
  patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomation: {
    operationId: "patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomation",
    method: "PATCH",
    path: "/api/workspaces/{id}/launch-settings/worktree-branch-automation",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["unverified"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationPathParamsSchema, query: null, header: patchWorkspacesByIdLaunchSettingsWorktreeBranchAutomationHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateWorktreeBranchAutomationBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchSettingsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/launch-preference: Read the caller's launch preference for a project
   */
  getProjectsByIdLaunchPreference: {
    operationId: "getProjectsByIdLaunchPreference",
    method: "GET",
    path: "/api/projects/{id}/launch-preference",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdLaunchPreferencePathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchPreferenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/projects/{id}/launch-preference: Update the caller's launch preference for a project
   */
  putProjectsByIdLaunchPreference: {
    operationId: "putProjectsByIdLaunchPreference",
    method: "PUT",
    path: "/api/projects/{id}/launch-preference",
    tags: ["launch-settings"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putProjectsByIdLaunchPreferencePathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateLaunchPreferenceBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: launchPreferenceDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/projects/{id}/execution-target: Read the caller's execution target selection for a project
   */
  getProjectsByIdExecutionTarget: {
    operationId: "getProjectsByIdExecutionTarget",
    method: "GET",
    path: "/api/projects/{id}/execution-target",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "launch:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getProjectsByIdExecutionTargetPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectExecutionTargetDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * PUT /api/projects/{id}/execution-target: Set the caller's execution target for a project
   */
  putProjectsByIdExecutionTarget: {
    operationId: "putProjectsByIdExecutionTarget",
    method: "PUT",
    path: "/api/projects/{id}/execution-target",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "launch:configure",
    permissionCandidates: [],
    edition: "both",
    consumers: ["mobile","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: putProjectsByIdExecutionTargetPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: updateProjectExecutionTargetBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: projectExecutionTargetDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/execution-targets/{id}/observations: Report resource observations from an execution target
   */
  postExecutionTargetsByIdObservations: {
    operationId: "postExecutionTargetsByIdObservations",
    method: "POST",
    path: "/api/execution-targets/{id}/observations",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["launch:configure","execution_request:claim"],
    edition: "both",
    consumers: ["runner","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExecutionTargetsByIdObservationsPathParamsSchema, query: null, header: postExecutionTargetsByIdObservationsHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reportResourceObservationsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: recordedObservationsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/execution-targets/{id}/mission-branch-observations: Report mission branch observations from an execution target
   */
  postExecutionTargetsByIdMissionBranchObservations: {
    operationId: "postExecutionTargetsByIdMissionBranchObservations",
    method: "POST",
    path: "/api/execution-targets/{id}/mission-branch-observations",
    tags: ["execution-targets"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["launch:configure","execution_request:claim"],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postExecutionTargetsByIdMissionBranchObservationsPathParamsSchema, query: null, header: postExecutionTargetsByIdMissionBranchObservationsHeaderParamsSchema },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: reportMissionBranchObservationsBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: recordedObservationsDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/protocol/{subcommand}: Run an agent protocol subcommand
   */
  postProtocolBySubcommand: {
    operationId: "postProtocolBySubcommand",
    method: "POST",
    path: "/api/protocol/{subcommand}",
    tags: ["protocol"],
    deprecated: false,
    permission: "unknown",
    permissionCandidates: ["artifact:create","artifact:read","event:create","execution_request:claim","execution_request:create","mission:create","mission:read","mission:update","objective:read","objective:submit","objective:update","project:create","project:read","project:update","session:attach"],
    edition: "both",
    consumers: ["cli"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postProtocolBySubcommandPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: protocolRequestBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: jsonValueSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/runner/status: List active execution requests
   */
  getRunnerStatus: {
    operationId: "getRunnerStatus",
    method: "GET",
    path: "/api/runner/status",
    tags: ["runner"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: getRunnerStatusQueryParamsSchema, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerStatusDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/claim: Claim the next queued execution request
   */
  postRunnerClaim: {
    operationId: "postRunnerClaim",
    method: "POST",
    path: "/api/runner/claim",
    tags: ["runner"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: runnerClaimBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerClaimResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/clear: Clear active execution requests
   */
  postRunnerClear: {
    operationId: "postRunnerClear",
    method: "POST",
    path: "/api/runner/clear",
    tags: ["runner"],
    deprecated: false,
    permission: "authenticated",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner","webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: runnerClearBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerClearResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/requests/{id}/launching: Mark an execution request launching
   */
  postRunnerRequestsByIdLaunching: {
    operationId: "postRunnerRequestsByIdLaunching",
    method: "POST",
    path: "/api/runner/requests/{id}/launching",
    tags: ["runner"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postRunnerRequestsByIdLaunchingPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerExecutionRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/requests/{id}/launched: Mark an execution request launched
   */
  postRunnerRequestsByIdLaunched: {
    operationId: "postRunnerRequestsByIdLaunched",
    method: "POST",
    path: "/api/runner/requests/{id}/launched",
    tags: ["runner"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postRunnerRequestsByIdLaunchedPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: runnerLaunchedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerExecutionRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/requests/{id}/failed: Mark an execution request failed
   */
  postRunnerRequestsByIdFailed: {
    operationId: "postRunnerRequestsByIdFailed",
    method: "POST",
    path: "/api/runner/requests/{id}/failed",
    tags: ["runner"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postRunnerRequestsByIdFailedPathParamsSchema, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: runnerFailedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerExecutionRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/runner/requests/{id}/completed: Report the result of a local-target mutation
   */
  postRunnerRequestsByIdCompleted: {
    operationId: "postRunnerRequestsByIdCompleted",
    method: "POST",
    path: "/api/runner/requests/{id}/completed",
    tags: ["runner"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postRunnerRequestsByIdCompletedPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: runnerCompletedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: runnerExecutionRequestDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/branch-prepared: Record a runner-prepared branch
   */
  postMissionsByIdBranchPrepared: {
    operationId: "postMissionsByIdBranchPrepared",
    method: "POST",
    path: "/api/missions/{id}/branch-prepared",
    tags: ["missions"],
    deprecated: false,
    permission: "execution_request:claim",
    permissionCandidates: [],
    edition: "both",
    consumers: ["runner"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdBranchPreparedPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: branchPreparedBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: okResponseSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/missions/{id}/branch/action: Run an on-demand branch action
   */
  postMissionsByIdBranchAction: {
    operationId: "postMissionsByIdBranchAction",
    method: "POST",
    path: "/api/missions/{id}/branch/action",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: postMissionsByIdBranchActionPathParamsSchema, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: branchActionBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionDetailDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/missions/{id}/branches: The mission's selectable branches
   */
  getMissionsByIdBranches: {
    operationId: "getMissionsByIdBranches",
    method: "GET",
    path: "/api/missions/{id}/branches",
    tags: ["missions"],
    deprecated: false,
    permission: "mission:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: getMissionsByIdBranchesPathParamsSchema, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: missionBranchListDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "500": apiResponses.InternalError }
  },
  /**
   * GET /api/worktrees: List Overlord-managed worktrees
   */
  getWorktrees: {
    operationId: "getWorktrees",
    method: "GET",
    path: "/api/worktrees",
    tags: ["worktrees"],
    deprecated: false,
    permission: "project:read",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: null,
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: worktreeListSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/worktrees/remove: Remove one managed worktree
   */
  postWorktreesRemove: {
    operationId: "postWorktreesRemove",
    method: "POST",
    path: "/api/worktrees/remove",
    tags: ["worktrees"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: true, content: { "application/json": { kind: "json", schema: removeWorktreeBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: purgeWorktreesResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  },
  /**
   * POST /api/worktrees/purge-merged: Remove every clean, merged managed worktree of a project
   */
  postWorktreesPurgeMerged: {
    operationId: "postWorktreesPurgeMerged",
    method: "POST",
    path: "/api/worktrees/purge-merged",
    tags: ["worktrees"],
    deprecated: false,
    permission: "project:update",
    permissionCandidates: [],
    edition: "both",
    consumers: ["webapp"],
    extension: null,
    security: [{"sessionCookie":[]},{"sessionBearer":[]},{"userToken":[]}],
    parameters: { path: null, query: null, header: null },
    requestBody: { required: false, content: { "application/json": { kind: "json", schema: purgeMergedWorktreesBodySchema } } },
    responses: { "200": { headers: [], content: { "application/json": { kind: "json", schema: purgeWorktreesResultDtoSchema } } }, "400": apiResponses.BadRequest, "401": apiResponses.Unauthorized, "403": apiResponses.Forbidden, "404": apiResponses.NotFound, "409": apiResponses.Conflict, "413": apiResponses.PayloadTooLarge, "500": apiResponses.InternalError }
  }
} as const satisfies { readonly [operationId: string]: ApiOperationDescriptor };

export type ApiOperations = typeof apiOperations;
export type ApiOperationId = keyof ApiOperations;
