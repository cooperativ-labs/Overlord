import { firstDraft, nextUpDraft, sortObjectivesByLifecycleOrder } from '@overlord/automations';
import {
  CAPTURE_GAP_CODES,
  type CaptureBindingState,
  type FileChangeSource,
  MAX_CAPTURE_HEALTH_CODES,
  type ReportDraftAttachBaselineV1
} from '@overlord/contract';
import { type DatabaseClient, UPDATE_EVENT_TYPES, UPDATE_PHASES } from '@overlord/database';
import { createHash } from 'node:crypto';

import {
  bindChannelToSession,
  ensureProtocolChannelForSession,
  findBindableChannelForMission
} from './agent-session/channels.js';
import {
  hasControlCharacters,
  isExactEvidencePath,
  isOverlordManagedEvidencePath
} from './agent-session/pure/evidence-path.js';
import { type AgentRequestOption, createRequest } from './agent-session/requests.js';
import { emitNotification } from './notifications/notifications.js';
import { recordChange } from './change-feed.js';
import { listObjectiveFileChanges } from './changes.js';
import type { ServiceContext } from './context.js';
import { resolveMissionId, resolveObjectiveRef, resolveProjectId } from './context.js';
import {
  applyDeferredWorkEligibility,
  deriveDeterministicActionCandidates
} from './delivery-compose.js';
import {
  assertReplayMatches,
  deliveryAlreadyAcceptedError,
  type FinalizationReceiptRow,
  finalizationRequestDigest,
  findReceiptByOperation,
  findReceiptBySession,
  historicalSessionDeliveryId,
  insertFinalizationReceipt,
  isUniqueViolation,
  parseOperationId,
  receiptResult
} from './delivery-finalization.js';
import {
  buildDeliveryReport,
  deferredWorkInputProblem,
  markDeliveryPresentationPending
} from './delivery-report.js';
import { publicationInstruction } from './delivery-summary-publication.js';
import { ServiceError } from './errors.js';
import { linkExecutionRequestToSession } from './execution-requests.js';
import { findActingDeviceExecutionTargetId } from './execution-targets.js';
import { bindProviderSessionAgentSession } from './latch-provider-session.js';
import {
  enqueueLiveActivityRefreshForMission,
  enqueueLiveActivityStartForMission
} from './live-activity-jobs.js';
import { canCloseForeignItems, withMissionItemLocks } from './mission-item-locks.js';
import {
  insertDeliveryMissionItems,
  listMissionItems,
  type MissionItemChangeAttribution
} from './mission-items.js';
import { advanceMissionNarrativeEvidence } from './mission-narrative.js';
import {
  applyMissionSummaryWrite,
  type MissionSummaryBaseline,
  type MissionSummaryWriteResult,
  parseMissionSummaryInput,
  type PreparedMissionSummaryWrite,
  prepareMissionSummaryWrite,
  readMissionSummaryBaseline
} from './mission-summary-agent.js';
import {
  type ArtifactSummary,
  type AttachmentSummary,
  createMissionWithObjectives,
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
import { lockMissionObjectiveQueue } from './objective-queue.js';
import { loadAgentInstructionsForWorkspaceUser } from './profiles.js';
import {
  countOtherMissionOpenItems,
  listProjectItemCandidates,
  type ProjectItemOptions
} from './project-items.js';
import {
  buildProjectResourceManifest,
  formatProjectResourcesInstructions,
  type ProjectResourceManifestEntry
} from './project-resource-manifest.js';
import { findPrimaryProjectResource, findProjectResourceByKey } from './projects.js';
import {
  activeCountsOf,
  activeEntryInputs,
  applyDraftOperations,
  assertBatchReplayMatches,
  findDraftBatch,
  insertDraftBatchReceipt,
  loadDraftEntries,
  loadSessionDraft,
  mergeDraftEvidence,
  type ParsedReportDraftWrite,
  parseReportDraftInput,
  readReportDraftAttachBaseline,
  replayedBatch,
  REPORT_DRAFT_FORBIDDEN,
  reportDraftBatchDigest,
  type ReportDraftBatchResult,
  reportDraftConflict,
  reportDraftSealedError,
  sealDraft
} from './report-draft.js';
import { enqueueRunQueueDispatch, retireEmptyRunQueues } from './run-queue.js';
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

export type MissionContextResponse = {
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
  /**
   * The mission summary editing baseline (attach and resume-follow-up only,
   * summary-enabled missions only). Never on load-context or connect.
   */
  missionSummary?: MissionSummaryBaseline;
  /**
   * Compact report-draft baseline (attach and resume-follow-up only, ADR 0078):
   * this execution's own open draft on re-attach, and abandoned drafts of the
   * objective it may import from. Omitted when there is neither.
   */
  reportDraft?: ReportDraftAttachBaselineV1;
};

/** Compact execution context; ordinary objective and load-context reads stay full. */
const COMPLETED_INSTRUCTION_LIMIT = 600;
const TRUNCATION_MARKER = '… [truncated]';

export type AttachObjective = Pick<ObjectiveSummary, 'displayId' | 'state' | 'objective'>;
export type AttachResponse = Omit<
  MissionContextResponse,
  'previousObjectives' | 'futureObjectives' | 'history'
> & {
  objectives: AttachObjective[];
  directives: MissionEventSummary[];
};

type SessionRow = {
  id: string;
  mission_id: string;
  objective_id: string;
  phase: string;
  delivery_state: string;
  ended_at: string | null;
  external_session_id: string | null;
  connection_method: string | null;
};

/**
 * Which tool vocabulary the attach rules are written in (plan coo:1294 D7). A
 * caller on MCP has Overlord tools and payload fields, not `ovld` commands and
 * flags, so it must never be told to run a CLI command it does not have.
 */
export type InstructionStyle = 'cli' | 'mcp';

/** `--connection-method` values a caller may declare on attach and resume-follow-up. */
export const ATTACH_CONNECTION_METHODS = ['cli', 'mcp'] as const;

export function instructionStyleFor(connectionMethod: string | null | undefined): InstructionStyle {
  return connectionMethod === 'mcp' ? 'mcp' : 'cli';
}

const INSTRUCTIONS_PRECEDENCE =
  'These instructions are authoritative for this session. Where an installed Overlord skill or plugin says otherwise, follow these.';

const DELIVERY_EVIDENCE_RULES = `
  Human actions are only concrete work a human must perform outside completed agent work; never
  include Git actions or routine review/testing.
  Tradeoffs must describe an implementation decision, alternatives considered, and why it was chosen.
  Deferred work is only a recommended new objective that is not part of this mission (for
  example an out-of-scope bug). Each item is an object { title, change, location, doneWhen }:
  an imperative title, only the specific change needed, where to find it in the code, and
  the observable result in one sentence; no how-to, background, or rationale. Never list
  work already in this mission's future objectives, leftover slices of the current
  objective, or human follow-up such as deploy, secrets, or migrations (those belong in
  humanActions).`;

const CLI_PROTOCOL_WORKFLOW = `
1. Read the current objective from the top-level \`objective\` field in this JSON response, then immediately begin executing it. This is an execution session: do not wait for more instructions or ask for confirmation.
2. Post progress with \`ovld protocol update\` or liveness with \`ovld protocol heartbeat\`.
3. Ask blocking questions with \`ovld protocol ask\` and stop work only when no safe progress remains.
4. Deliver with \`ovld protocol deliver\` when work is complete. A summary is the only required
   delivery input; explain the outcome by behavior or component, not file by file.
5. Do not stage or commit changes unless explicitly instructed to do so.
6. Do not continue implementation after delivery; the deliver response says how to begin
   follow-up work.

Changed files:
  Overlord records the files you change; the list is not a Git diff. Before delivering, read it
  once with \`ovld protocol changes --objective-id <id>\` and follow its \`instruction\` if
  present. Never diff or status-scan the shared worktree, and never send changed-file,
  observed-dirty-path, or no-file-change inputs.

Delivery evidence:
  Every delivery should also provide a \`deliveryReport.agentReport\` in \`--payload-json\` or
  \`--payload-file\`: \`humanActions\`, \`tradeoffsMade\`, \`knownRisks\`, \`deferredWork\`, and
  \`assumptions\`. Use empty arrays when none apply.${DELIVERY_EVIDENCE_RULES}`;

const MCP_PROTOCOL_WORKFLOW = `
1. Read the current objective from the top-level \`objective\` field in this response, then immediately begin executing it. This is an execution session: do not wait for more instructions or ask for confirmation.
2. Pass \`session.sessionKey\` from this response as \`sessionKey\` on every session tool call.
3. Post progress with \`overlord_update_session\`.
4. If you are blocked, ask the user in this conversation, and stop work only when no safe progress remains.
5. Deliver with \`overlord_deliver_session\` when work is complete. \`summary\` is the only required
   field; explain the outcome by behavior or component, not file by file.
6. Do not stage or commit changes unless explicitly instructed to do so.
7. Do not continue implementation after delivery; the deliver response says what to do if more
   work is needed.

Changed files:
  Overlord records the files you change; the list is not a Git diff. Before delivering, read it
  once with \`overlord_changes\` (\`objectiveId\`) and follow its \`instruction\` if present.
  Never diff or status-scan a shared worktree.

Delivery evidence:
  Every delivery should also send \`humanActions\`, \`tradeoffsMade\`, \`knownRisks\`,
  \`deferredWork\`, and \`assumptions\` on \`overlord_deliver_session\`. Use empty arrays when
  none apply.${DELIVERY_EVIDENCE_RULES}`;

/**
 * The post-delivery rule, returned as `instruction` on the deliver response
 * (plan coo:1294 D6) instead of in every attach. MCP tools cannot begin
 * follow-up work, so an MCP caller is told to hand it back to the user.
 */
export function postDeliveryInstruction({
  style,
  missionDisplayId,
  objectiveDisplayId
}: {
  style: InstructionStyle;
  missionDisplayId: string;
  objectiveDisplayId: string;
}): string {
  return `Delivered; this session has ended. Do not continue implementation. ${followUpRecoveryInstruction({ style, missionDisplayId, objectiveDisplayId })}`;
}

function followUpRecoveryInstruction({
  style,
  missionDisplayId,
  objectiveDisplayId
}: {
  style: InstructionStyle;
  missionDisplayId: string;
  objectiveDisplayId: string;
}): string {
  if (style === 'mcp') {
    return 'If the user asks for more work on this objective, ask them to start follow-up work from Overlord.';
  }
  return `If the user asks for more work on this objective, first run \`ovld protocol resume-follow-up --mission-id ${missionDisplayId} --objective-id ${objectiveDisplayId} --summary "<what you will do>"\`, use the session key it returns, and deliver again when done.`;
}

function protocolWorkflow(style: InstructionStyle): string {
  return style === 'mcp' ? MCP_PROTOCOL_WORKFLOW : CLI_PROTOCOL_WORKFLOW;
}

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

  // No active objective. Attach is an explicit execution order, so an
  // objective an agent already submitted for discussion wins (discuss → attach),
  // then the next runnable draft (skips blank drafts), then the first draft,
  // then any unfinished objective — each by position, created_at, id (coo:1274).
  const ordered = sortObjectivesByLifecycleOrder(objectives);
  const active =
    ordered.find(o => o.state === 'submitted') ??
    nextUpDraft(objectives) ??
    firstDraft(objectives) ??
    ordered.find(o => o.state !== 'complete');

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
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id,
            connection_method
       FROM agent_sessions
       WHERE workspace_id = ? AND session_key_hash = ? AND deleted_at IS NULL ${endedFilter}
       ORDER BY started_at DESC LIMIT 1`,
    [ctx.workspace.id, hash]
  )) as SessionRow | undefined;
}

async function getSessionByKey(
  ctx: ServiceContext,
  sessionKey: string,
  mission: { id: string; displayId: string }
): Promise<SessionRow> {
  const row = await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true });

  if (!row || row.ended_at) {
    if (row?.mission_id === mission.id && row.delivery_state === 'delivered') {
      const objective = (await listObjectives({ ctx, missionId: mission.id })).find(
        candidate => candidate.id === row.objective_id
      );
      if (objective?.state === 'complete') {
        throw new ServiceError(
          `This protocol session ended at delivery. ${followUpRecoveryInstruction({
            style: instructionStyleFor(row.connection_method),
            missionDisplayId: mission.displayId,
            objectiveDisplayId: objective.displayId
          })}`,
          'invalid_session',
          401
        );
      }
    }
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
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id,
            connection_method
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
    `SELECT id, mission_id, objective_id, phase, delivery_state, ended_at, external_session_id,
            connection_method
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
 * the top-level `objective`). The split is purely positional: `previousObjectives`
 * are positioned before the current objective and `futureObjectives` after it.
 * Neither is a lifecycle state — objectives can launch out of order, so a
 * lower-position draft may still be unexecuted. Objectives with empty instructions are excluded from both:
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

/**
 * The Mission summary block of attach instructions (plan coo:1294 step 1).
 * Present only when the response carries the `missionSummary` baseline. Only
 * the sending line differs by connection method.
 */
export function missionSummaryInstructions(style: InstructionStyle): string {
  const send =
    style === 'mcp'
      ? 'Send them as `missionSummary` on `overlord_deliver_session`:'
      : 'Send them as `missionSummary` in the delivery payload (`--payload-file` or `--mission-summary-file`):';
  return `At delivery, update the mission summary for the whole mission, not only this objective. The
current text, its \`contentRevision\` and \`evidenceRevision\`, and the open items with their ids
are in the top-level \`missionSummary\` field of this response. Only agents write this summary;
nothing generates it for you.

1. Check every item in \`missionSummary.openItems\` against the work you verified. Close it as
   \`done\` if the work is complete, or \`dismissed\` if it no longer applies, with a reason of at
   most 280 characters. Leave it open if you are not sure. Objective instructions state intent;
   they do not prove completion.
2. Do not report a risk or suggestion that is already open or that you closed.
3. Rewrite \`headline\` (one sentence, 140 characters) and \`summary\` (Markdown, 1,200 characters)
   so they are true now. Organise by what the mission provides, not by objective. Keep earlier
   outcomes that still hold and remove claims that later work replaced. Say whether each claim is
   implemented, tested or deployed. State only durable limits; do not repeat open items.
4. ${send}
   { "baseContentRevision": <missionSummary.contentRevision>,
     "baseEvidenceRevision": <missionSummary.evidenceRevision>, "headline": "...", "summary": "...",
     "closeItems": [{ "id": "<item id>", "status": "done" | "dismissed", "reason": "..." }] }
   \`closeItems\` (at most 50) may be sent alone. If other work changed the mission since your
   baseline, the delivery is still accepted but your headline and summary are withheld; the
   response then tells you how to publish once for this delivery.

For full detail or overflow, ${
    style === 'mcp'
      ? 'call `overlord_mission_items` with `missionId`, `sessionKey`, `limit` and `offset`; follow `nextOffset` until null. Close verified items with `overlord_close_items` (`missionId`, `sessionKey`, `closeItems`).'
      : 'run `ovld protocol mission-items --mission-id <id> --limit 60 --offset 0`; follow `nextOffset` until null. Close verified items with `ovld protocol close-items --mission-id <id> --close-items-file <path|->`.'
  }
If delivery returns a mission-summary error or warning, follow the steps in its message.`;
}

function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Download rule for the current objective's attachments. The launch prompt
 * used to carry these commands; attach is now the only channel (plan coo:1294,
 * step 5), so the rule arrives on every launch path and only when files exist.
 */
function attachmentsInstructions({
  mission,
  objective,
  attachments,
  style
}: {
  mission: MissionSummary;
  objective: ObjectiveSummary;
  attachments: AttachmentSummary[];
  style: InstructionStyle;
}): string | null {
  if (attachments.length === 0) return null;
  if (style === 'mcp') {
    return [
      'The user attached files to this objective; they are listed in `attachments`. No Overlord MCP',
      'tool downloads them. If you need a file to do the work, say so in a session update.'
    ].join('\n');
  }
  const lines = attachments.map(attachment => {
    const base = attachment.filename.split(/[\\/]/).pop() || 'attachment';
    const output = `./.overlord/tmp/attachment-${attachment.id}-${base}`;
    return `- ${attachment.filename}: \`ovld protocol attachment-download-url --mission-id ${shellArg(mission.displayId)} --objective-id ${shellArg(objective.displayId)} --attachment-id ${shellArg(attachment.id)} --output ${shellArg(output)}\``;
  });
  return [
    'The user attached files to this objective (listed in `attachments`). Their URLs need Overlord',
    'authentication; download with these commands, which use the CLI credentials:',
    ...lines,
    `Files attached to other objectives: \`ovld protocol attachment-list --mission-id ${shellArg(mission.displayId)}\`.`
  ].join('\n');
}

/** The CLI wording of the Mission summary block, kept as a constant for tests and docs. */
export const MISSION_SUMMARY_INSTRUCTIONS = missionSummaryInstructions('cli');

function assembleAgentInstructions({
  mission,
  objective,
  projectName,
  agentInstructions,
  projectResourcesSection = null,
  missionSummary = false,
  otherMissionOpenItems = 0,
  attachments = [],
  style = 'cli',
  compactContext = false
}: {
  mission: MissionSummary;
  objective: ObjectiveSummary;
  projectName: string;
  agentInstructions: string | null;
  projectResourcesSection?: string | null;
  missionSummary?: boolean;
  otherMissionOpenItems?: number;
  attachments?: AttachmentSummary[];
  style?: InstructionStyle;
  compactContext?: boolean;
}): string {
  const objectiveLabel = objective.title?.trim() || `Objective ${objective.position + 1}`;
  const mcp = style === 'mcp';
  const attachmentsSection = attachmentsInstructions({ mission, objective, attachments, style });

  return [
    `# Overlord Agent Instructions`,
    `You are attached to mission **${mission.displayId}** via Overlord.`,
    INSTRUCTIONS_PRECEDENCE,
    ``,
    mcp
      ? `Mission ID: ${mission.displayId}  <- pass as \`missionId\` on Overlord tool calls`
      : `Mission ID: ${mission.displayId}  <- pass this to every \`ovld protocol ... --mission-id\` call`,
    mcp
      ? `Objective ID: ${objective.displayId}  <- pass as \`objectiveId\`; never as \`missionId\``
      : `Objective ID: ${objective.displayId}  <- pass as --objective-id on attach; never as --mission-id`,
    `Objective: ${objectiveLabel}`,
    `Project: ${projectName}`,
    '',
    '## Temporary Files',
    'When working in a writable project checkout, use `OVERLORD_TMPDIR` for task scratch files if it points to an available directory under that checkout’s `.overlord/tmp/`. Otherwise, create and use `.overlord/tmp/` at the checkout root. Pass that directory explicitly to tools that default to a system temp folder.',
    '',
    '## Context Location',
    '- The current task body is in the top-level `objective.objective` field.',
    compactContext
      ? '- Sibling work is in `objectives` in mission order; check each state. Completed instructions may be truncated.'
      : '- Previous and future work are in `previousObjectives` and `futureObjectives`.',
    compactContext
      ? '- Current-objective user directions and decisions are in `directives` (newest 10). Attachments, artifacts and shared context have their own fields.'
      : '- History, attachments, artifacts, and shared context are in their structured top-level fields.',
    '',
    projectResourcesSection ? '' : null,
    projectResourcesSection,
    attachmentsSection ? '## Attachments' : null,
    attachmentsSection,
    attachmentsSection ? '' : null,
    `## Required Protocol Workflow`,
    protocolWorkflow(style),
    '',
    missionSummary ? '## Mission summary' : null,
    missionSummary ? missionSummaryInstructions(style) : null,
    missionSummary ? '' : null,
    otherMissionOpenItems > 0
      ? `Other missions in this project have ${otherMissionOpenItems} open items. Before delivery, run ${mcp ? 'overlord_project_items' : '`ovld protocol project-items`'} once. Verify in code that work resolved or obsoleted each item before closing; similarity is insufficient. Give a reason naming the verified change. Close with ${mcp ? 'overlord_close_items' : '`close-items`'} while working or delivery missionSummary.closeItems. Retain the same delivery operation id and semantic body for uncertain-response replay. Accepted withheld prose uses ${mcp ? 'overlord_delivery_summary_context and overlord_publish_delivery_summary' : '`delivery-summary-context` and `publish-delivery-summary`'} with fresh content/evidence bases and a separate retained publication operation id; never resend closes to publication.`
      : null,
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

type ContextOptions = {
  ctx: ServiceContext;
  mission: MissionSummary;
  objective: ObjectiveSummary;
  executionTargetId?: string | null;
  includeMissionSummary?: boolean;
  style?: InstructionStyle;
};

function contextForObjective(
  options: ContextOptions & { includeMissionSummary: true }
): Promise<Omit<AttachResponse, 'session'>>;
// eslint-disable-next-line no-redeclare -- TypeScript overload.
function contextForObjective(
  options: ContextOptions & { includeMissionSummary?: false }
): Promise<Omit<MissionContextResponse, 'session'>>;
// eslint-disable-next-line no-redeclare -- TypeScript overload implementation.
async function contextForObjective({
  ctx,
  mission,
  objective,
  executionTargetId = null,
  includeMissionSummary = false,
  style = 'cli'
}: ContextOptions): Promise<
  Omit<AttachResponse, 'session'> | Omit<MissionContextResponse, 'session'>
> {
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  // Filter before LIMIT: busy runner activity must never hide a user directive.
  const directives = includeMissionSummary
    ? await ctx.db.all<{
        id: string;
        type: string;
        phase: string | null;
        summary: string;
        createdAt: string;
        objectiveId: string;
      }>(
        `SELECT id, type, phase, summary, created_at AS "createdAt", objective_id AS "objectiveId"
       FROM mission_events WHERE mission_id = ? AND objective_id = ?
       AND type IN ('user_follow_up', 'decision', 'discussion_summary')
       ORDER BY created_at DESC, id DESC LIMIT 10`,
        [mission.id, objective.id]
      )
    : [];
  const history = includeMissionSummary
    ? []
    : await listMissionEvents({ ctx, missionId: mission.id });
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
  const missionSummary = includeMissionSummary
    ? await readMissionSummaryBaseline(ctx.db, mission.id)
    : null;

  const otherMissionOpenItems = includeMissionSummary
    ? await countOtherMissionOpenItems(ctx.db, {
        workspaceId: ctx.workspace.id,
        projectId: mission.projectId,
        missionId: mission.id
      })
    : 0;

  // `agentInstructions` is the first key so a harness that cuts long tool
  // output still shows the rules (plan coo:1294, condition 2). Callers spread
  // this object first, so overriding a later key keeps this order.
  return {
    agentInstructions: assembleAgentInstructions({
      mission,
      objective,
      projectName: project.name,
      agentInstructions,
      projectResourcesSection,
      missionSummary: missionSummary !== null,
      otherMissionOpenItems,
      attachments,
      style,
      compactContext: includeMissionSummary
    }),
    mission,
    objective,
    ...(includeMissionSummary
      ? {
          objectives: objectives
            .filter(candidate => candidate.id !== objective.id && hasInstruction(candidate))
            .map(({ displayId, state, objective: text }) => ({
              displayId,
              state,
              objective:
                state === 'complete' && text.length > COMPLETED_INSTRUCTION_LIMIT
                  ? text.slice(0, COMPLETED_INSTRUCTION_LIMIT - TRUNCATION_MARKER.length) +
                    TRUNCATION_MARKER
                  : text
            })),
          directives
        }
      : { previousObjectives, futureObjectives, history }),
    artifacts,
    attachments,
    sharedState,
    ...(projectResources.length > 0 ? { projectResources } : {}),
    ...(missionSummary ? { missionSummary: { ...missionSummary, otherMissionOpenItems } } : {})
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
}): Promise<Omit<MissionContextResponse, 'session'>> {
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
  objectiveId = null,
  captureBindingState = 'unknown'
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
  /**
   * Declared capture binding observed by the attaching client: `bound` when its
   * explicit objective environment matches, `unbound` when absent or mismatched,
   * `unknown` for hosted attaches with no local information. Configuration
   * evidence only — it never claims a hook is installed or has run.
   */
  captureBindingState?: CaptureBindingState;
}): Promise<AttachResponse & { sessionKey: string }> {
  if (!CAPTURE_BINDING_STATES.includes(captureBindingState)) {
    throw new ServiceError(
      'captureBindingState must be bound, unbound, or unknown',
      'validation_error',
      400
    );
  }
  const mission = await getMissionSummary({ ctx, missionId });
  const objectives = await listObjectives({ ctx, missionId: mission.id });
  const explicitPin = Boolean(objectiveId?.trim() || executionRequestId?.trim());
  // A live session already knows its objective. Re-attach must not rediscover
  // via mission state — with two executing siblings that 409s as ambiguous.
  let resolvedObjectiveId = objectiveId;
  if (existingSessionKey?.trim() && !explicitPin) {
    const existing = await getSessionByKey(ctx, existingSessionKey, mission);
    if (existing.mission_id !== mission.id) {
      throw new ServiceError('Session key belongs to a different mission', 'invalid_session', 401);
    }
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
  // Assemble execution context after session state is refreshed, once.
  const context = { mission, objective };

  if (existingSessionKey) {
    const existing = await getSessionByKey(ctx, existingSessionKey, mission);
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
    if (captureBindingState !== 'unknown') {
      await ctx.db.transaction(async tx => {
        await writeCaptureDiagnostics({
          ctx: { ...ctx, db: tx },
          mission: context.mission,
          session: existing,
          diagnostics: { bindingState: captureBindingState, health: [] },
          now: nowIso()
        });
      });
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
      executionTargetId: resolvedTargetId,
      includeMissionSummary: true,
      style: instructionStyleFor(connectionMethod)
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
    const reattachDraft = await readReportDraftAttachBaseline(ctx.db, {
      workspaceId: ctx.workspace.id,
      objectiveId: existing.objective_id,
      sessionId: existing.id
    });
    return {
      ...refreshedContext,
      ...(reattachDraft ? { reportDraft: reattachDraft } : {}),
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
    const updated = await txCtx.db.run(
      `UPDATE objectives
         SET state = 'executing',
             assigned_agent = COALESCE(assigned_agent, ?),
             ${OBJECTIVE_LAUNCHED_AT_ASSIGNMENT},
             ${OBJECTIVE_STARTED_AT_ASSIGNMENT},
             updated_at = ?,
             revision = revision + 1
         WHERE id = ? AND mission_id = ? AND state <> 'complete' AND deleted_at IS NULL`,
      [inheritedDraftAgent || null, now, now, now, objective.id, context.mission.id]
    );
    if (updated.changes === 0) {
      const linked = executionRequestId
        ? await tx.get(
            `SELECT launched_session_id FROM execution_requests
              WHERE id = ? AND workspace_id = ? AND mission_id = ? AND objective_id = ?
                AND deleted_at IS NULL AND launched_session_id IS NOT NULL`,
            [executionRequestId, ctx.workspace.id, mission.id, objective.id]
          )
        : undefined;
      const reason = linked
        ? 'Execution request is already linked to another session and this objective is complete.'
        : 'No active objective at this reference. This objective has already been completed.';
      throw new ServiceError(
        `${reason} ${followUpRecoveryInstruction({
          style: instructionStyleFor(connectionMethod),
          missionDisplayId: mission.displayId,
          objectiveDisplayId: objective.displayId
        })}`,
        linked ? 'execution_request_already_linked' : 'no_active_objective',
        409
      );
    }
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

    await moveMissionToExecute({ ctx: txCtx, missionId: context.mission.id });

    await txCtx.db.run(
      `INSERT INTO agent_sessions
           (id, workspace_id, project_id, mission_id, objective_id,
            session_key_prefix, session_key_hash, agent_identifier, model_identifier,
            connection_method, external_session_id, phase, delivery_state, started_at, last_heartbeat_at,
            metadata_json, capture_binding_state, created_by_workspace_user_id, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'execute', 'not_delivered', ?, ?, '{}', ?, ?, ?, ?, 1)`,
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
        captureBindingState,
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
  const refreshedContext = await contextForObjective({
    ctx,
    mission: refreshedMission,
    objective: refreshedObjective,
    executionTargetId: resolvedTargetId,
    includeMissionSummary: true,
    style: instructionStyleFor(connectionMethod)
  });

  const abandonedDrafts = await readReportDraftAttachBaseline(ctx.db, {
    workspaceId: ctx.workspace.id,
    objectiveId: objective.id,
    sessionId: null
  });
  return {
    ...refreshedContext,
    ...(abandonedDrafts ? { reportDraft: abandonedDrafts } : {}),
    mission: refreshedMission,
    objective: refreshedObjective,
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
  const { rawKey, prefix, hash } = generateSessionKey();
  const now = nowIso();
  const sessionId = newId();
  const eventId = newId();

  const selectedObjective = await ctx.db.transaction(async tx => {
    const txCtx = { ...ctx, db: tx };
    // Mission lock first, as delivery and publication take it (ADR 0076).
    await lockMissionObjectiveQueue(tx, mission.id);
    const objectives = await listObjectives({ ctx: txCtx, missionId: mission.id });
    const resolvedObjectiveId = objectiveId
      ? (await resolveObjectiveRef({ ctx: txCtx, ref: objectiveId, missionId: mission.id })).id
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

    // Explicit follow-up starts a new basis: the objective's accepted
    // delivery can no longer publish mission prose (ADR 0076).
    await advanceMissionNarrativeEvidence(tx, {
      mission: { id: mission.id },
      reason: 'follow_up',
      attribution: missionItemAttribution(ctx),
      now
    });

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
    return selectedObjective;
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
    }),
    includeMissionSummary: true,
    style: instructionStyleFor(connectionMethod)
  });

  // A follow-up session starts a fresh draft; abandoned earlier drafts stay importable.
  const followUpDrafts = await readReportDraftAttachBaseline(ctx.db, {
    workspaceId: ctx.workspace.id,
    objectiveId: selectedObjective.id,
    sessionId: null
  });
  return {
    ...context,
    ...(followUpDrafts ? { reportDraft: followUpDrafts } : {}),
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
  const session = await getSessionByKey(ctx, sessionKey, mission);
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
const MAX_HOOK_HEALTH_LENGTH = 160;
const MAX_SYNC_KEYS_PER_FILE = 32;
const MAX_DECLARED_PATHS = 100;
const MAX_PROTOCOL_EVIDENCE_WARNINGS = 12;
const MAX_CAPTURE_HEALTH_ITEMS = 32;
const HOOK_HEALTH_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/i;
const SYNC_CHANGE_ALLOWED_KEYS = new Set([
  'filePath',
  'idempotencyKey',
  'source',
  'observedAt',
  'hookHealth'
]);
const CAPTURE_BINDING_STATES: readonly CaptureBindingState[] = ['bound', 'unbound', 'unknown'];
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const DECLARED_PATH_HEALTH = 'agent_declared';

export type ChangeEvidenceSource = FileChangeSource;

type SyncChangeInput = {
  filePath?: unknown;
  idempotencyKey?: unknown;
  source?: unknown;
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
  /** Null for declarations, which are naturally idempotent (they only refresh `observedAt`). */
  idempotencyKey: string | null;
  source: ChangeEvidenceSource;
  observedAt?: string;
  hookHealth?: string;
};

/** Native evidence outranks a declaration; unknown historical provenance outranks nothing. */
function sourceStrength(source: string | null): number {
  if (source === 'declared_edit') return 2;
  if (source === 'agent_declared') return 1;
  return 0;
}

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

function normalizeHealthCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_HOOK_HEALTH_LENGTH ||
    hasControlCharacters(trimmed) ||
    !HOOK_HEALTH_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/** Canonical millisecond UTC ISO string (the storage format), or null when malformed. */
function normalizeObservedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !ISO_UTC_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
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
  | { change: ValidSyncChange & { idempotencyKey: string } }
  | { warning: string; filePath: string | null; idempotencyKey: string | null } {
  const identity = readSyncChangeIdentity(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...identity, warning: 'change evidence must be an object' };
  }
  const input = value as SyncChangeInput;
  if (Object.keys(input).some(key => !SYNC_CHANGE_ALLOWED_KEYS.has(key))) {
    return {
      ...identity,
      warning:
        'change evidence contains unsupported fields (quality, overlap, and toolWindowId are retired)'
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
  if (isOverlordManagedEvidencePath(filePath)) {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'filePath is excluded from change reporting'
    };
  }
  if (!idempotencyKey) {
    return { ...identity, filePath, warning: 'idempotencyKey must be a bounded string' };
  }
  if (input.source !== 'declared_edit' && input.source !== 'agent_declared') {
    return {
      ...identity,
      filePath,
      idempotencyKey,
      warning: 'source must be declared_edit or agent_declared'
    };
  }
  let observedAt: string | undefined;
  if (input.observedAt !== undefined) {
    const normalized = normalizeObservedAt(input.observedAt);
    if (!normalized) {
      return {
        ...identity,
        filePath,
        idempotencyKey,
        warning: 'observedAt must be a bounded UTC ISO timestamp'
      };
    }
    observedAt = normalized;
  }
  let hookHealth: string | undefined;
  if (input.hookHealth !== undefined) {
    const code = normalizeHealthCode(input.hookHealth);
    if (!code) {
      return {
        ...identity,
        filePath,
        idempotencyKey,
        warning: 'hookHealth must be a bounded string'
      };
    }
    hookHealth = code;
  }
  return {
    change: {
      filePath,
      idempotencyKey,
      source: input.source,
      ...(observedAt ? { observedAt } : {}),
      ...(hookHealth ? { hookHealth } : {})
    }
  };
}

function parseStoredSyncKeys(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (key): key is string =>
          typeof key === 'string' &&
          key.length > 0 &&
          key.length <= MAX_SYNC_KEY_LENGTH &&
          !hasControlCharacters(key)
      )
      .slice(-MAX_SYNC_KEYS_PER_FILE);
  } catch {
    return [];
  }
}

/**
 * Upsert one validated observation inside the caller's transaction. Identity is
 * objective + resolved resource + path; the resource comes from the authorized
 * session (or is null for sessionless declarations), never from the caller.
 */
async function upsertChangedFileObservation({
  ctx,
  mission,
  objectiveId,
  sessionId,
  resourceId,
  change,
  now
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string };
  objectiveId: string;
  sessionId: string | null;
  resourceId: string | null;
  change: ValidSyncChange;
  now: string;
}): Promise<'accepted' | 'ignored'> {
  const observedAt = change.observedAt && change.observedAt <= now ? change.observedAt : now;
  const changedFileId = newId();
  const syncKeys = change.idempotencyKey ? [change.idempotencyKey] : [];
  const inserted = await ctx.db.run(
    `INSERT INTO changed_files
         (id, workspace_id, project_id, mission_id, objective_id, session_id, resource_id,
          file_path, source, hook_health, sync_keys_json, first_observed_at, last_observed_at,
          last_observed_event_id, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1)
       ON CONFLICT (objective_id, (COALESCE(resource_id, '')), file_path)
         WHERE deleted_at IS NULL
       DO NOTHING`,
    [
      changedFileId,
      ctx.workspace.id,
      mission.projectId,
      mission.id,
      objectiveId,
      sessionId,
      resourceId,
      change.filePath,
      change.source,
      change.hookHealth ?? null,
      JSON.stringify(syncKeys),
      observedAt,
      observedAt,
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
      objectiveId
    });
    return 'accepted';
  }

  const lockClause = ctx.db.dialect === 'postgres' ? ' FOR UPDATE' : '';
  const existing = (await ctx.db.get(
    `SELECT id, source, hook_health, sync_keys_json, revision FROM changed_files
       WHERE objective_id = ? AND COALESCE(resource_id, '') = ? AND file_path = ?
         AND deleted_at IS NULL${lockClause}`,
    [objectiveId, resourceId ?? '', change.filePath]
  )) as
    | {
        id: string;
        source: string | null;
        hook_health: string | null;
        sync_keys_json: string | null;
        revision: number;
      }
    | undefined;
  if (!existing) throw new Error('Objective changed-file row disappeared during upsert');

  const existingKeys = parseStoredSyncKeys(existing.sync_keys_json);
  if (change.idempotencyKey && existingKeys.includes(change.idempotencyKey)) return 'ignored';
  // Native evidence is never downgraded by a later declaration; the health code
  // follows whichever observation currently defines the displayed source.
  const incomingWins = sourceStrength(change.source) >= sourceStrength(existing.source);
  const nextSource = incomingWins ? change.source : existing.source;
  const nextHealth = incomingWins
    ? (change.hookHealth ?? existing.hook_health)
    : existing.hook_health;
  const nextKeys = change.idempotencyKey
    ? [...existingKeys, change.idempotencyKey].slice(-MAX_SYNC_KEYS_PER_FILE)
    : existingKeys;
  await ctx.db.run(
    `UPDATE changed_files
       SET session_id = ?, source = ?, hook_health = ?, sync_keys_json = ?,
           first_observed_at = CASE WHEN first_observed_at > ? THEN ? ELSE first_observed_at END,
           last_observed_at = CASE WHEN last_observed_at < ? THEN ? ELSE last_observed_at END,
           last_observed_event_id = NULL, updated_at = ?, revision = revision + 1
       WHERE id = ?`,
    [
      sessionId,
      nextSource,
      nextHealth,
      JSON.stringify(nextKeys),
      observedAt,
      observedAt,
      observedAt,
      observedAt,
      now,
      existing.id
    ]
  );
  await recordChange({
    ctx,
    entityType: 'changed_file',
    entityId: existing.id,
    operation: 'update',
    entityRevision: existing.revision + 1,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId,
    changedFields: ['session_id', 'source', 'hook_health', 'last_observed_at']
  });
  return 'accepted';
}

/**
 * Validate an agent-declared path list (shell/script/generator outputs, deletes,
 * renames, `record-work`). Absent targets are valid; only unsafe, ignored or
 * Overlord-managed paths are dropped, with a bounded warning.
 */
function normalizeDeclaredPaths(input: unknown): { paths: string[]; warnings: string[] } {
  const paths: string[] = [];
  const warnings: string[] = [];
  const warn = (message: string): void => {
    if (warnings.length < MAX_PROTOCOL_EVIDENCE_WARNINGS) warnings.push(message);
  };
  if (input === undefined || input === null) return { paths, warnings };
  if (!Array.isArray(input)) {
    warn('Ignored declaredPaths: expected an array of path strings.');
    return { paths, warnings };
  }
  if (input.length > MAX_DECLARED_PATHS) {
    warn(`Ignored ${input.length - MAX_DECLARED_PATHS} excess declaredPaths item(s).`);
  }
  const seen = new Set<string>();
  input.slice(0, MAX_DECLARED_PATHS).forEach((value, index) => {
    const filePath = normalizeRepoRelativePath(value);
    if (!filePath) {
      warn(`Ignored declaredPaths[${index}]: path must be canonical and repository-relative.`);
      return;
    }
    if (isOverlordManagedEvidencePath(filePath)) {
      warn(`Ignored declaredPaths[${index}]: path is excluded from change reporting.`);
      return;
    }
    if (seen.has(filePath)) return;
    seen.add(filePath);
    paths.push(filePath);
  });
  return { paths, warnings };
}

/** Record declared paths inside the caller's transaction. Never blocks the host operation. */
async function applyDeclaredPaths({
  ctx,
  mission,
  objectiveId,
  sessionId,
  resourceId,
  paths,
  now
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string };
  objectiveId: string;
  sessionId: string | null;
  resourceId: string | null;
  paths: string[];
  now: string;
}): Promise<void> {
  for (const filePath of paths) {
    await upsertChangedFileObservation({
      ctx,
      mission,
      objectiveId,
      sessionId,
      resourceId,
      change: {
        filePath,
        idempotencyKey: null,
        source: 'agent_declared',
        hookHealth: DECLARED_PATH_HEALTH
      },
      now
    });
  }
}

type CaptureDiagnosticsInput = {
  bindingState?: unknown;
  callbackObservedAt?: unknown;
  health?: unknown;
};

type NormalizedCaptureDiagnostics = {
  bindingState?: CaptureBindingState;
  callbackObservedAt?: string;
  health: Array<{ code: string; at: string }>;
};

function normalizeCaptureDiagnostics(
  input: unknown,
  now: string
): { value: NormalizedCaptureDiagnostics; warning?: string } {
  const empty: NormalizedCaptureDiagnostics = { health: [] };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { value: empty, warning: 'capture must be an object' };
  }
  const candidate = input as CaptureDiagnosticsInput;
  if (
    Object.keys(candidate).some(
      key => !['bindingState', 'callbackObservedAt', 'health'].includes(key)
    )
  ) {
    return { value: empty, warning: 'capture contains unsupported fields' };
  }
  const value: NormalizedCaptureDiagnostics = { health: [] };
  if (candidate.bindingState !== undefined) {
    if (!CAPTURE_BINDING_STATES.includes(candidate.bindingState as CaptureBindingState)) {
      return { value: empty, warning: 'capture.bindingState must be bound, unbound, or unknown' };
    }
    value.bindingState = candidate.bindingState as CaptureBindingState;
  }
  if (candidate.callbackObservedAt !== undefined && candidate.callbackObservedAt !== null) {
    const observed = normalizeObservedAt(candidate.callbackObservedAt);
    if (!observed) {
      return { value: empty, warning: 'capture.callbackObservedAt must be a UTC ISO timestamp' };
    }
    value.callbackObservedAt = observed <= now ? observed : now;
  }
  if (candidate.health !== undefined) {
    if (!Array.isArray(candidate.health)) {
      return { value: empty, warning: 'capture.health must be an array' };
    }
    for (const entry of candidate.health.slice(0, MAX_CAPTURE_HEALTH_ITEMS)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const record = entry as { code?: unknown; at?: unknown };
      const code = normalizeHealthCode(record.code);
      const at = normalizeObservedAt(record.at);
      if (code && at) value.health.push({ code, at: at <= now ? at : now });
    }
  }
  return { value };
}

type StoredCaptureHealth = Record<string, { firstAt: string; lastAt: string }>;

function parseStoredCaptureHealth(value: string | null | undefined): StoredCaptureHealth {
  try {
    const parsed = JSON.parse(value ?? '{}') as { health?: unknown };
    const out: StoredCaptureHealth = {};
    if (typeof parsed.health !== 'object' || parsed.health === null) return out;
    for (const [code, entry] of Object.entries(parsed.health as Record<string, unknown>)) {
      const record = entry as { firstAt?: unknown; lastAt?: unknown } | null;
      if (
        normalizeHealthCode(code) &&
        typeof record?.firstAt === 'string' &&
        typeof record.lastAt === 'string'
      ) {
        out[code] = { firstAt: record.firstAt, lastAt: record.lastAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Fold incoming health codes into the per-code aggregate. A known gap code is
 * sticky: when the bounded map is full, the oldest non-gap code is evicted first
 * and a gap code is never displaced by a non-gap code.
 */
function mergeCaptureHealth(
  existing: StoredCaptureHealth,
  incoming: Array<{ code: string; at: string }>
): StoredCaptureHealth {
  const merged: StoredCaptureHealth = { ...existing };
  const isGap = (code: string): boolean => (CAPTURE_GAP_CODES as readonly string[]).includes(code);
  for (const { code, at } of incoming) {
    const current = merged[code];
    if (current) {
      merged[code] = {
        firstAt: current.firstAt < at ? current.firstAt : at,
        lastAt: current.lastAt > at ? current.lastAt : at
      };
      continue;
    }
    if (Object.keys(merged).length >= MAX_CAPTURE_HEALTH_CODES) {
      const evictable = Object.entries(merged)
        .filter(([candidate]) => !isGap(candidate))
        .sort((left, right) => left[1].lastAt.localeCompare(right[1].lastAt))[0];
      if (!evictable) continue;
      if (!isGap(code) && evictable[1].lastAt >= at) continue;
      delete merged[evictable[0]];
    }
    merged[code] = { firstAt: at, lastAt: at };
  }
  return merged;
}

/**
 * Persist bounded capture diagnostics for the authorized session and emit a
 * session refresh in the same transaction. Binding is configuration evidence;
 * the earliest accepted callback is retained; health aggregates are idempotent.
 */
async function writeCaptureDiagnostics({
  ctx,
  mission,
  session,
  diagnostics,
  now
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string };
  session: { id: string; objective_id: string };
  diagnostics: NormalizedCaptureDiagnostics;
  now: string;
}): Promise<'accepted' | 'ignored'> {
  const lockClause = ctx.db.dialect === 'postgres' ? ' FOR UPDATE' : '';
  const current = (await ctx.db.get(
    `SELECT capture_binding_state, capture_callback_observed_at, capture_health_json, revision
       FROM agent_sessions WHERE id = ? AND workspace_id = ?${lockClause}`,
    [session.id, ctx.workspace.id]
  )) as
    | {
        capture_binding_state: string;
        capture_callback_observed_at: string | Date | null;
        capture_health_json: string | Record<string, unknown> | null;
        revision: number;
      }
    | undefined;
  if (!current) throw new ServiceError('Session not found', 'invalid_session', 401);

  const storedHealth = parseStoredCaptureHealth(
    typeof current.capture_health_json === 'string'
      ? current.capture_health_json
      : JSON.stringify(current.capture_health_json ?? {})
  );
  const nextHealth = mergeCaptureHealth(storedHealth, diagnostics.health);
  const currentCallback = current.capture_callback_observed_at
    ? new Date(current.capture_callback_observed_at).toISOString()
    : null;
  const nextCallback =
    diagnostics.callbackObservedAt &&
    (!currentCallback || diagnostics.callbackObservedAt < currentCallback)
      ? diagnostics.callbackObservedAt
      : currentCallback;
  const nextBinding = diagnostics.bindingState ?? current.capture_binding_state;
  const nextHealthJson = JSON.stringify({ health: nextHealth });
  const changedFields: string[] = [];
  if (nextBinding !== current.capture_binding_state) changedFields.push('capture_binding_state');
  if (nextCallback !== currentCallback) changedFields.push('capture_callback_observed_at');
  if (JSON.stringify({ health: storedHealth }) !== nextHealthJson) {
    changedFields.push('capture_health_json');
  }
  if (changedFields.length === 0) return 'ignored';

  await ctx.db.run(
    `UPDATE agent_sessions
        SET capture_binding_state = ?, capture_callback_observed_at = ?, capture_health_json = ?,
            updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ?`,
    [nextBinding, nextCallback, nextHealthJson, now, session.id, ctx.workspace.id]
  );
  await recordChange({
    ctx,
    entityType: 'agent_session',
    entityId: session.id,
    operation: 'update',
    entityRevision: current.revision + 1,
    projectId: mission.projectId,
    missionId: mission.id,
    objectiveId: session.objective_id,
    changedFields
  });
  return 'accepted';
}

/**
 * Persist objective-ledger observations and bounded capture diagnostics without
 * ever making delivery depend on them. Every item has its own transaction so
 * malformed siblings cannot roll back valid metadata-only evidence.
 */
export async function syncChanges({
  ctx,
  missionId,
  sessionKey,
  changes,
  capture
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  changes: unknown[];
  capture?: unknown;
}): Promise<{
  outcomes: SyncChangeOutcome[];
  capture?: { status: 'accepted' | 'ignored' | 'warning'; warning?: string };
}> {
  const mission = await resolveMissionId(ctx, missionId);
  // Delivery is non-blocking even when the ledger drain fails. Permit only
  // evidence recovery on delivered sessions; lifecycle writers still require
  // an active key and all callers retain the normal authorization boundary.
  const session = await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true });
  if (!session || (session.ended_at && session.delivery_state !== 'delivered')) {
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
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
          objectiveId: session.objective_id,
          sessionId: session.id,
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

  if (capture === undefined) return { outcomes };
  const now = nowIso();
  const normalized = normalizeCaptureDiagnostics(capture, now);
  if (normalized.warning) {
    return { outcomes, capture: { status: 'warning', warning: normalized.warning } };
  }
  try {
    const status = await ctx.db.transaction(async tx =>
      writeCaptureDiagnostics({
        ctx: { ...ctx, db: tx },
        mission,
        session,
        diagnostics: normalized.value,
        now
      })
    );
    return { outcomes, capture: { status } };
  } catch {
    return {
      outcomes,
      capture: { status: 'warning', warning: 'unable to persist capture diagnostics' }
    };
  }
}

export type UpdateSessionResult = {
  eventId: string;
  /** Present when the update carried a reportDraft batch (ADR 0078). */
  reportDraft?: ReportDraftBatchResult;
};

export async function updateSession({
  ctx,
  missionId,
  sessionKey,
  summary,
  phase,
  eventType = 'update',
  payloadJson: rawPayloadJson,
  externalUrl,
  externalSessionId,
  beginFollowUpWork = false,
  followUpIntent,
  declaredPaths,
  reportDraft
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
  /** Known shell/script outputs, deletes, or renames the native hook could not name. */
  declaredPaths?: unknown;
  /** Optional draft evidence batch `{ operationId, expectedRevision, operations }` (ADR 0078). */
  reportDraft?: unknown;
}): Promise<UpdateSessionResult> {
  // reportDraft may also arrive inside the payload; it is never stored in the event payload.
  const { reportDraft: payloadReportDraft, ...payloadRest } = rawPayloadJson ?? {};
  const payloadJson = rawPayloadJson ? payloadRest : rawPayloadJson;
  if (reportDraft !== undefined && payloadReportDraft !== undefined) {
    throw new ServiceError(
      'Send reportDraft once: as the reportDraft input or inside the payload, not both',
      'invalid_input',
      400
    );
  }
  const draftWrite = parseReportDraftInput(reportDraft ?? payloadReportDraft, 'update');
  const trimmedSummary = summary.trim();
  if (!trimmedSummary && !draftWrite) {
    throw new ServiceError('Update summary is required', 'validation_error');
  }
  if (draftWrite && beginFollowUpWork) {
    throw new ServiceError(
      'reportDraft cannot be combined with begin-follow-up-work; a follow-up session records its own draft',
      'invalid_input',
      400
    );
  }

  const mission = await resolveMissionId(ctx, missionId);
  if (draftWrite) {
    return await updateSessionWithDraft({
      ctx,
      mission,
      sessionKey,
      summary: trimmedSummary,
      phase,
      eventType,
      payloadJson,
      externalUrl,
      externalSessionId,
      declaredPaths,
      write: draftWrite
    });
  }
  const session = await getSessionByKey(ctx, sessionKey, mission);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  if (session.delivery_state === 'delivered' && !beginFollowUpWork) {
    throw deliveryBoundaryError();
  }
  assertUpdatePhaseAndType(phase, eventType);

  const now = nowIso();
  const eventId = newId();
  const declared = normalizeDeclaredPaths(declaredPaths);
  const declaredResourceId =
    declared.paths.length > 0 ? await resolveSessionResourceId({ ctx, session, mission }) : null;

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
    await writeUpdateEvent(txCtx, {
      mission,
      session,
      eventId,
      summary: trimmedSummary,
      phase,
      eventType,
      payload: {
        ...(payloadJson ?? {}),
        ...(followUpIntent ? { followUpIntent } : {})
      },
      declared,
      declaredResourceId,
      externalUrl,
      externalSessionId,
      now
    });
  });
  return { eventId };
}

function deliveryBoundaryError(): ServiceError {
  return new ServiceError(
    'Mission was delivered. Use --begin-follow-up-work before posting execution updates.',
    'delivery_boundary',
    409
  );
}

function assertUpdatePhaseAndType(
  phase: string | null | undefined,
  eventType: string | null | undefined
): void {
  if (phase && !UPDATE_PHASES.includes(phase as (typeof UPDATE_PHASES)[number])) {
    throw new ServiceError(`Invalid phase: ${phase}`, 'validation_error');
  }
  if (eventType && !UPDATE_EVENT_TYPES.includes(eventType as (typeof UPDATE_EVENT_TYPES)[number])) {
    throw new ServiceError(`Invalid event type: ${eventType}`, 'validation_error');
  }
}

/** The attributable update event and its ordinary side effects, inside the caller's transaction. */
async function writeUpdateEvent(
  txCtx: ServiceContext,
  {
    mission,
    session,
    eventId,
    summary,
    phase,
    eventType,
    payload,
    declared,
    declaredResourceId,
    externalUrl,
    externalSessionId,
    now
  }: {
    mission: { id: string; projectId: string };
    session: SessionRow;
    eventId: string;
    summary: string;
    phase?: string | null;
    eventType?: string | null;
    payload: Record<string, unknown>;
    declared: { paths: string[]; warnings: string[] };
    declaredResourceId: string | null;
    externalUrl?: string | null;
    externalSessionId?: string | null;
    now: string;
  }
): Promise<void> {
  await txCtx.db.run(
    `INSERT INTO mission_events
         (id, workspace_id, project_id, mission_id, objective_id, session_id,
          type, phase, summary, payload_json, external_url, source,
          actor_workspace_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      txCtx.workspace.id,
      mission.projectId,
      mission.id,
      session.objective_id,
      session.id,
      eventType ?? 'update',
      phase ?? null,
      summary,
      JSON.stringify({
        ...payload,
        ...(declared.warnings.length > 0 ? { declaredPathWarnings: declared.warnings } : {})
      }),
      externalUrl ?? null,
      txCtx.source,
      txCtx.actorWorkspaceUserId,
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

  await applyDeclaredPaths({
    ctx: txCtx,
    mission,
    objectiveId: session.objective_id,
    sessionId: session.id,
    resourceId: declaredResourceId,
    paths: declared.paths,
    now
  });

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
}

function draftEventSummary(applied: {
  upserted: string[];
  withdrawn: string[];
  imported: string[];
}): string {
  const parts = [
    applied.upserted.length ? `${applied.upserted.length} recorded` : '',
    applied.withdrawn.length ? `${applied.withdrawn.length} withdrawn` : '',
    applied.imported.length ? `${applied.imported.length} imported` : ''
  ].filter(Boolean);
  return `Draft report evidence: ${parts.join(', ') || 'no change'}.`;
}

/**
 * `update` with a reportDraft batch (ADR 0078). The batch receipt is looked up
 * before the session must still be live and before the revision check, so a
 * lost-response retry returns its original receipt (also after sealing or
 * session end) without writing, overwriting a later batch or duplicating its
 * event. New batches are applied under the mission lock, which also
 * serializes them with deliver's seal.
 */
async function updateSessionWithDraft({
  ctx,
  mission,
  sessionKey,
  summary,
  phase,
  eventType,
  payloadJson,
  externalUrl,
  externalSessionId,
  declaredPaths,
  write
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string; displayId: string };
  sessionKey: string;
  summary: string;
  phase?: string | null;
  eventType?: string | null;
  payloadJson?: Record<string, unknown> | null;
  externalUrl?: string | null;
  externalSessionId?: string | null;
  declaredPaths?: unknown;
  write: ParsedReportDraftWrite;
}): Promise<UpdateSessionResult> {
  const operationId = write.operationId as string;
  const actor = ctx.actorWorkspaceUserId;
  if (!actor) {
    throw new ServiceError(
      'reportDraft requires an authenticated workspace member',
      'invalid_input',
      400
    );
  }
  const session = await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true });
  if (!session) {
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }
  assertUpdatePhaseAndType(phase, eventType);
  const declared = normalizeDeclaredPaths(declaredPaths);
  const digest = reportDraftBatchDigest({
    sessionId: session.id,
    summary,
    phase: phase ?? null,
    eventType: eventType ?? 'update',
    payload: payloadJson ?? null,
    declaredPaths: declared.paths,
    externalUrl: externalUrl ?? null,
    expectedRevision: write.expectedRevision,
    operations: write.operations
  });
  const replayFrom = async (db: DatabaseClient) => {
    const draft = await loadSessionDraft(db, session.id);
    if (!draft) return undefined;
    const batch = await findDraftBatch(db, draft.id, operationId);
    if (!batch) return undefined;
    assertBatchReplayMatches(batch, digest);
    return replayedBatch(batch, draft);
  };

  // A replay is a currently authorized receipt read; it never regains update rights.
  const earlier = await replayFrom(ctx.db);
  if (earlier) return earlier;
  if (session.ended_at) {
    if (session.delivery_state === 'delivered') throw deliveryBoundaryError();
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
  if (session.delivery_state === 'delivered') throw deliveryBoundaryError();

  const declaredResourceId =
    declared.paths.length > 0 ? await resolveSessionResourceId({ ctx, session, mission }) : null;
  const now = nowIso();
  const eventId = newId();
  try {
    return await ctx.db.transaction(async tx => {
      const txCtx = { ...ctx, db: tx };
      await lockMissionObjectiveQueue(tx, mission.id);
      const concurrent = await replayFrom(tx);
      if (concurrent) return concurrent;
      const live = await tx.get<{
        ended_at: string | null;
        delivery_state: string | null;
        created_by_workspace_user_id: string | null;
      }>(
        `SELECT ended_at, delivery_state, created_by_workspace_user_id
           FROM agent_sessions WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [session.id, ctx.workspace.id]
      );
      if (!live) throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
      if (live.delivery_state === 'delivered') throw deliveryBoundaryError();
      if (live.ended_at) {
        throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
      }

      const draft = await loadSessionDraft(tx, session.id);
      if (draft?.sealed_at) throw reportDraftSealedError(draft);
      const owner = draft?.owner_workspace_user_id ?? live.created_by_workspace_user_id ?? actor;
      if (owner !== actor) {
        throw new ServiceError(
          'Only the workspace member who owns this session may write its report draft',
          REPORT_DRAFT_FORBIDDEN,
          403
        );
      }
      const currentRevision = draft ? Number(draft.revision) : 0;
      if (write.expectedRevision !== currentRevision) {
        throw await reportDraftConflict(
          tx,
          draft,
          `reportDraft.expectedRevision ${write.expectedRevision} does not match the current draft revision ${currentRevision}. Nothing was applied: read report-draft, rebase the batch and send it again.`
        );
      }

      const applied = await applyDraftOperations(tx, {
        ctx: txCtx,
        scope: {
          workspaceId: ctx.workspace.id,
          projectId: mission.projectId,
          missionId: mission.id,
          objectiveId: session.objective_id,
          sessionId: session.id,
          ownerWorkspaceUserId: owner
        },
        draft,
        operations: write.operations,
        eventId,
        countBatch: true,
        now
      });
      await insertDraftBatchReceipt(tx, {
        draft: applied.draft,
        operationId,
        digest,
        eventId,
        operationCount: write.operations.length,
        now
      });
      await writeUpdateEvent(txCtx, {
        mission,
        session,
        eventId,
        summary: summary || draftEventSummary(applied),
        phase,
        eventType,
        // Bounded operation metadata only; entry text lives in the draft, not the event.
        payload: {
          ...(payloadJson ?? {}),
          reportDraft: {
            draftId: applied.draft.id,
            operationId,
            revision: Number(applied.draft.revision),
            upserted: applied.upserted,
            withdrawn: applied.withdrawn,
            imported: applied.imported
          }
        },
        declared,
        declaredResourceId,
        externalUrl,
        externalSessionId,
        now
      });
      return {
        eventId,
        reportDraft: {
          draftId: applied.draft.id,
          operationId,
          revision: Number(applied.draft.revision),
          activeCounts: activeCountsOf(applied.entries)
        }
      };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await replayFrom(ctx.db);
    if (winner) return winner;
    throw error;
  }
}

export async function askQuestion({
  ctx,
  missionId,
  sessionKey,
  question,
  options = [],
  allowsFreeText = true
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  question: string;
  options?: AgentRequestOption[];
  allowsFreeText?: boolean;
}): Promise<{ eventId: string }> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new ServiceError('Question is required', 'validation_error');
  }
  if (!allowsFreeText && options.length === 0) {
    throw new ServiceError(
      'A no-free-text question requires at least one option',
      'validation_error'
    );
  }

  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey, mission);
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
    // A launched session has no adapter channel (launch stopped minting them), so the ask
    // opens the session's correlation-only channel on first need. Without it there is no
    // `agent_requests` row, and the question can be read but never answered (ADR 0065).
    const channel = await ensureProtocolChannelForSession({
      ctx: txCtx,
      session,
      projectId: mission.projectId
    });
    if (channel) {
      const request = await createRequest({
        ctx: txCtx,
        channel,
        kind: !allowsFreeText && options.length > 0 ? 'choice' : 'question',
        summary: trimmed,
        options,
        allowsFreeText,
        // `source_event_id` references `agent_session_events`; an ask is a
        // `mission_events` row, so the link lives in `details.missionEventId`
        // one way and in the event's `payload_json.agentRequestId` the other.
        sourceEventId: null,
        windowExpiresAt: null,
        details: { missionEventId: eventId }
      });
      await txCtx.db.run(
        `UPDATE mission_events SET payload_json = ? WHERE id = ? AND workspace_id = ?`,
        [JSON.stringify({ agentRequestId: request.id }), eventId, ctx.workspace.id]
      );
    }
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
    // The Live Activity leads with a pending ask (the watch Smart Stack card
    // turns amber), so an ask is a transition that must reach the device now.
    await enqueueLiveActivityRefreshForMission({
      db: txCtx.db,
      workspaceId: ctx.workspace.id,
      missionId: mission.id,
      now
    });

    await moveMissionToReview({ ctx: txCtx, missionId: mission.id });
  });

  return { eventId };
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

/** Deferred work is strict (contract v166): a string or malformed item rejects the delivery. */
function assertDeferredWorkInput(deliveryReport: unknown): void {
  const problem = deferredWorkInputProblem(deliveryReport);
  if (problem) throw new ServiceError(problem, 'invalid_input', 400);
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

/** Change attribution for the mission items a protocol write produces. */
function missionItemAttribution(ctx: ServiceContext): MissionItemChangeAttribution {
  return {
    actorWorkspaceUserId: ctx.actorWorkspaceUserId,
    actorTokenId: ctx.actorTokenId ?? null,
    source: ctx.source
  };
}

/**
 * Applies the prepared summary write and, for an eligible delivery, attaches
 * the fresh post-acceptance baseline the agent reconciles from. Returns
 * undefined when there is nothing to report (ineligible mission, no input).
 */
async function finishMissionSummaryWrite(
  tx: DatabaseClient,
  args: Parameters<typeof applyMissionSummaryWrite>[1]
): Promise<MissionSummaryWriteResult | undefined> {
  const result = await applyMissionSummaryWrite(tx, args);
  if (!result.publication) {
    return args.prepared.input ? result : undefined;
  }
  return {
    ...result,
    ...(result.publication.available
      ? { baseline: (await readMissionSummaryBaseline(tx, args.mission.id)) ?? undefined }
      : {})
  };
}

/** Appends the narrow publication step when an accepted delivery's prose was not published. */
function withPublicationInstruction(
  instruction: string,
  summary: MissionSummaryWriteResult | undefined,
  {
    style,
    missionDisplayId,
    deliveryId
  }: { style: InstructionStyle; missionDisplayId: string; deliveryId: string }
): string {
  if (!summary?.publication?.available) return instruction;
  const lead =
    summary.publication.withheldReason === 'absent'
      ? 'Delivery accepted without a mission summary.'
      : 'Delivery accepted; your mission summary was not published because the mission changed since your baseline.';
  return `${lead} ${publicationInstruction(style, {
    state: 'outstanding',
    available: true,
    missionDisplayId,
    deliveryId
  })} ${instruction}`;
}

export type DeliverSessionResult = {
  deliveryId: string;
  eventId: string;
  /** The caller's operation id, echoed when one was sent. */
  operationId?: string;
  missionSummary?: MissionSummaryWriteResult;
  /** What to do after delivery, worded for the session's connection method. */
  instruction: string;
  /** True when this response is the stored receipt of an earlier acceptance. */
  replayed?: true;
  /** The report draft this delivery sealed, with each active entry's accepted V1 reference. */
  reportDraft?: {
    draftId: string;
    revision: number;
    sealed: true;
    activeEntries: number;
    refs: Array<{ entryId: string; ref: string | null }>;
  };
};

/**
 * Draft-aware part of deliver, inside the finalization transaction (ADR 0078).
 * Undefined for a session without a draft and without reportDraft input,
 * which keeps the full-report behavior unchanged.
 */
async function prepareDraftDelivery(
  tx: DatabaseClient,
  {
    ctx,
    mission,
    session,
    draftFinal,
    legacyDeliveryReport,
    eventId,
    now
  }: {
    ctx: ServiceContext;
    mission: { id: string; projectId: string };
    session: SessionRow;
    draftFinal: ParsedReportDraftWrite | undefined;
    legacyDeliveryReport: unknown;
    eventId: string;
    now: string;
  }
) {
  let draft = await loadSessionDraft(tx, session.id);
  if (!draft && !draftFinal) return undefined;
  if (draft?.sealed_at) throw reportDraftSealedError(draft);
  const currentRevision = draft ? Number(draft.revision) : 0;
  if (!draftFinal) {
    throw await reportDraftConflict(
      tx,
      draft,
      `This session has a report draft at revision ${currentRevision}. Read report-draft, then deliver with reportDraft.expectedRevision ${currentRevision} so no recorded evidence is silently ignored.`
    );
  }
  if (draftFinal.expectedRevision !== currentRevision) {
    throw await reportDraftConflict(
      tx,
      draft,
      `reportDraft.expectedRevision ${draftFinal.expectedRevision} does not match the current draft revision ${currentRevision}. Nothing was delivered: read report-draft and deliver again.`
    );
  }
  let entries = draft ? await loadDraftEntries(tx, draft.id) : [];
  if (draftFinal.operations.length > 0) {
    const actor = ctx.actorWorkspaceUserId;
    const owner = draft?.owner_workspace_user_id ?? actor;
    if (!actor || owner !== actor) {
      throw new ServiceError(
        'Only the workspace member who owns this session may write its report draft',
        REPORT_DRAFT_FORBIDDEN,
        403
      );
    }
    const applied = await applyDraftOperations(tx, {
      ctx,
      scope: {
        workspaceId: ctx.workspace.id,
        projectId: mission.projectId,
        missionId: mission.id,
        objectiveId: session.objective_id,
        sessionId: session.id,
        ownerWorkspaceUserId: owner
      },
      draft,
      operations: draftFinal.operations,
      eventId,
      countBatch: false,
      now
    });
    draft = applied.draft;
    entries = applied.entries;
  }
  return {
    draft,
    entries,
    merge: mergeDraftEvidence(activeEntryInputs(entries), legacyDeliveryReport)
  };
}

/** 409 naming the accepted delivery of a session that already finalized. */
async function alreadyAcceptedForSession(
  db: DatabaseClient,
  sessionId: string
): Promise<ServiceError> {
  const receipt = await findReceiptBySession(db, sessionId);
  return deliveryAlreadyAcceptedError(
    receipt?.delivery_id ?? (await historicalSessionDeliveryId(db, sessionId))
  );
}

function replayedDelivery(receipt: FinalizationReceiptRow): DeliverSessionResult {
  return { ...receiptResult<DeliverSessionResult>(receipt), replayed: true };
}

export async function deliverSession({
  ctx,
  missionId,
  sessionKey,
  summary,
  artifacts = [],
  declaredPaths,
  payloadJson: rawPayloadJson,
  verificationSummary,
  followUpNotes,
  missionSummary,
  operationId: rawOperationId,
  reportDraft
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  summary: string;
  artifacts?: unknown[];
  /** Known shell/script outputs, deletes, or renames the native hook could not name. */
  declaredPaths?: unknown;
  payloadJson?: Record<string, unknown> | null;
  verificationSummary?: string | null;
  followUpNotes?: string | null;
  /** Optional agent-authored summary write (plan 3.3); validated before any write. */
  missionSummary?: unknown;
  /**
   * Caller-retained logical operation id (ADR 0075). A retry with the same id
   * and the same request returns the accepted receipt, even after the session ended.
   */
  operationId?: unknown;
  /**
   * Draft-aware delivery (ADR 0078): `{ expectedRevision, operations? }`. Required
   * when the session has a report draft; the draft is sealed on acceptance.
   */
  reportDraft?: unknown;
}): Promise<DeliverSessionResult> {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    throw new ServiceError('Delivery summary is required', 'validation_error');
  }
  // reportDraft may also arrive inside the payload envelope; it is never stored there.
  const { reportDraft: payloadReportDraft, ...payloadRest } = rawPayloadJson ?? {};
  const payloadJson = rawPayloadJson ? payloadRest : rawPayloadJson;
  if (reportDraft !== undefined && payloadReportDraft !== undefined) {
    throw new ServiceError(
      'Send reportDraft once: as the reportDraft input or inside the payload, not both',
      'invalid_input',
      400
    );
  }
  assertDeferredWorkInput(payloadJson?.deliveryReport);
  const draftFinal = parseReportDraftInput(reportDraft ?? payloadReportDraft, 'deliver');
  const summaryInput = parseMissionSummaryInput(missionSummary, { requireBase: true });
  const operationId = parseOperationId(rawOperationId);
  const actor = ctx.actorWorkspaceUserId;
  if (operationId && !actor) {
    throw new ServiceError(
      'operationId requires an authenticated workspace member',
      'invalid_input',
      400
    );
  }

  const mission = await resolveMissionId(ctx, missionId);
  // An ended session is resolved too: an accepted operation replays after the
  // session ended, before any requirement that execution is still live.
  const session = await getSessionByKeyMaybeEnded(ctx, sessionKey, { includeEnded: true });
  if (!session) {
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }

  const declared = normalizeDeclaredPaths(declaredPaths);
  const normalizedArtifacts = validateProtocolArtifacts(artifacts);
  const digest = finalizationRequestDigest('deliver', {
    missionId: mission.id,
    objectiveId: session.objective_id,
    sessionId: session.id,
    summary: trimmedSummary,
    artifacts: normalizedArtifacts,
    declaredPaths: declared.paths,
    payload: payloadJson ?? null,
    verificationSummary: verificationSummary ?? null,
    followUpNotes: followUpNotes ?? null,
    missionSummary: summaryInput ?? null,
    ...(draftFinal ? { reportDraft: draftFinal } : {})
  });
  const findOwnReceipt = (db: DatabaseClient) =>
    operationId && actor
      ? findReceiptByOperation(db, {
          workspaceId: ctx.workspace.id,
          actorWorkspaceUserId: actor,
          kind: 'deliver',
          operationId
        })
      : Promise.resolve(undefined);

  const earlier = await findOwnReceipt(ctx.db);
  if (earlier) {
    assertReplayMatches(earlier, { digest, missionId: mission.id, sessionId: session.id });
    return replayedDelivery(earlier);
  }
  if (session.ended_at) {
    if (session.delivery_state === 'delivered') {
      throw await alreadyAcceptedForSession(ctx.db, session.id);
    }
    throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
  }

  const declaredResourceId =
    declared.paths.length > 0 ? await resolveSessionResourceId({ ctx, session, mission }) : null;
  const missionObjectives = await listObjectives({ ctx, missionId: mission.id });
  const currentObjectiveRow = missionObjectives.find(
    objective => objective.id === session.objective_id
  );
  const plannedObjectives = missionObjectives
    .filter(
      objective =>
        objective.id !== session.objective_id &&
        objective.state !== 'complete' &&
        hasInstruction(objective)
    )
    .map(objective => ({ title: objective.title, instruction: objective.objective }));

  const now = nowIso();
  const deliveryId = newId();
  const eventId = newId();
  const missionScope = {
    id: mission.id,
    workspaceId: ctx.workspace.id,
    projectId: mission.projectId
  };
  const sessionModel = summaryInput?.narrative
    ? ((
        await ctx.db.get<{ model_identifier: string | null }>(
          `SELECT model_identifier FROM agent_sessions WHERE id = ?`,
          [session.id]
        )
      )?.model_identifier ?? null)
    : null;
  const instruction = postDeliveryInstruction({
    style: instructionStyleFor(session.connection_method),
    missionDisplayId: mission.displayId,
    objectiveDisplayId: currentObjectiveRow?.displayId ?? session.objective_id
  });

  let outcome: { replay: FinalizationReceiptRow } | { result: DeliverSessionResult };
  try {
    outcome = await withMissionItemLocks(
      ctx,
      {
        missionId: mission.id,
        projectId: mission.projectId,
        sessionId: session.id,
        itemIds: summaryInput?.closeItems.map(e => e.id) ?? []
      },
      async tx => {
        const txCtx = { ...ctx, db: tx };
        // The outer boundary holds the complete, globally ordered mission set.
        // Everything that decides acceptance is rechecked under the lock: a
        // concurrent finalization of this operation or this session has
        // either committed (and is visible now) or has not started.
        const inScope = await resolveMissionId(txCtx, mission.id);
        if (inScope.projectId !== mission.projectId) {
          throw new ServiceError(`Mission not found: ${missionId}`, 'mission_not_found', 404);
        }
        const concurrent = await findOwnReceipt(tx);
        if (concurrent) {
          assertReplayMatches(concurrent, {
            digest,
            missionId: mission.id,
            sessionId: session.id
          });
          return { replay: concurrent };
        }
        const live = await tx.get<{
          mission_id: string;
          objective_id: string;
          ended_at: string | null;
          delivery_state: string | null;
        }>(
          `SELECT mission_id, objective_id, ended_at, delivery_state
             FROM agent_sessions WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
          [session.id, ctx.workspace.id]
        );
        if (!live || live.mission_id !== mission.id || live.objective_id !== session.objective_id) {
          throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
        }
        if (live.ended_at) {
          if (live.delivery_state === 'delivered') {
            throw await alreadyAcceptedForSession(tx, session.id);
          }
          throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
        }

        // Both narrative bases are compared with the pre-delivery state under
        // the summary row lock before anything is written (ADR 0076). Stale,
        // legacy or absent prose never rejects the delivery; it is withheld.
        const preparedSummary: PreparedMissionSummaryWrite = await prepareMissionSummaryWrite(tx, {
          mission: missionScope,
          input: summaryInput,
          mode: 'deliver',
          now
        });
        // A session with a report draft must deliver against the revision it
        // inspected; final operations apply here, then the active entries merge
        // with any legacy final arrays. Nothing is sealed unless this commits.
        const draftDelivery = await prepareDraftDelivery(tx, {
          ctx: txCtx,
          mission,
          session,
          draftFinal,
          legacyDeliveryReport: payloadJson?.deliveryReport,
          eventId,
          now
        });
        const deliveryReport = appendDeliveryWarnings(
          markDeliveryPresentationPending(
            buildDeliveryReport({
              summary: trimmedSummary,
              deliveryReport: draftDelivery
                ? draftDelivery.merge.deliveryReport
                : payloadJson?.deliveryReport
            })
          ),
          [...declared.warnings, ...(draftDelivery?.merge.warnings ?? [])]
        );
        // Declarations are evidence, not a delivery gate; they land before the
        // deterministic operator actions are derived from the objective's paths.
        await applyDeclaredPaths({
          ctx: txCtx,
          mission,
          objectiveId: session.objective_id,
          sessionId: session.id,
          resourceId: declaredResourceId,
          paths: declared.paths,
          now: nowIso()
        });
        const objectiveChangedFiles = (await txCtx.db.all(
          `SELECT file_path FROM changed_files
           WHERE objective_id = ? AND deleted_at IS NULL`,
          [session.objective_id]
        )) as Array<{ file_path: string }>;
        const eligibleDeliveryReport = applyDeferredWorkEligibility({
          report: deliveryReport,
          currentObjective: currentObjectiveRow
            ? { title: currentObjectiveRow.title, instruction: currentObjectiveRow.objective }
            : null,
          plannedObjectives,
          candidateActions: deriveDeterministicActionCandidates({
            filePaths: objectiveChangedFiles.map(row => row.file_path)
          })
        });

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
              deliveryReport: eligibleDeliveryReport
            }),
            verificationSummary ?? null,
            followUpNotes ?? null,
            now,
            ctx.actorWorkspaceUserId,
            now,
            now
          ]
        );

        // The delivery's risks, human actions and suggestions become open
        // mission items; the objective's earlier open human actions are superseded.
        await insertDeliveryMissionItems(txCtx.db, {
          delivery: {
            id: deliveryId,
            workspaceId: ctx.workspace.id,
            projectId: mission.projectId,
            missionId: mission.id,
            objectiveId: session.objective_id,
            deliveredAt: now
          },
          report: eligibleDeliveryReport,
          attribution: missionItemAttribution(ctx),
          now
        });
        const sealed = draftDelivery?.draft
          ? await sealDraft(tx, {
              ctx: txCtx,
              draft: draftDelivery.draft,
              refs: draftDelivery.merge.refs,
              entries: draftDelivery.entries,
              deliveryId,
              now
            })
          : undefined;
        const summaryResult = await finishMissionSummaryWrite(tx, {
          canCloseForeign: await canCloseForeignItems(txCtx),
          prepared: preparedSummary,
          mission: missionScope,
          objectiveId: session.objective_id,
          deliveryId,
          sessionId: session.id,
          model: sessionModel,
          attribution: missionItemAttribution(ctx),
          now
        });

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
            JSON.stringify({ deliveryId, ...(operationId ? { operationId } : {}) }),
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
        // A completed queue no longer needs to exist.
        await retireEmptyRunQueues(txCtx.db, mission.projectId);
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

        // Required follow-on scheduling is handed off durably in this same
        // transaction (ADR 0075): it exists exactly when the delivery does, a
        // replay writes none of it again, and nothing after commit can turn
        // an accepted delivery into an apparent rejection.
        await scheduleDeliveryFollowOn({
          ctx: txCtx,
          mission,
          deliveredObjectiveId: session.objective_id,
          missionNowIdle: remainingActive === 0
        });

        const result: DeliverSessionResult = {
          deliveryId,
          eventId,
          ...(operationId ? { operationId } : {}),
          ...(summaryResult ? { missionSummary: summaryResult } : {}),
          ...(sealed ? { reportDraft: { ...sealed, sealed: true as const } } : {}),
          instruction: withPublicationInstruction(instruction, summaryResult, {
            style: instructionStyleFor(session.connection_method),
            missionDisplayId: mission.displayId,
            deliveryId
          })
        };
        if (actor) {
          await insertFinalizationReceipt(tx, {
            workspaceId: ctx.workspace.id,
            projectId: mission.projectId,
            missionId: mission.id,
            objectiveId: session.objective_id,
            deliveryId,
            actorWorkspaceUserId: actor,
            sessionId: session.id,
            kind: 'deliver',
            operationId: operationId ?? null,
            digest,
            result,
            acceptedAt: now
          });
        }
        return { result };
      }
    );
  } catch (error) {
    // A concurrent writer won a uniqueness race that the mission lock did not
    // serialize (same operation id on another mission, or SQLite/Postgres
    // backstop). This transaction rolled back completely; answer from the winner.
    if (!isUniqueViolation(error)) throw error;
    const winner = await findOwnReceipt(ctx.db);
    if (winner) {
      assertReplayMatches(winner, { digest, missionId: mission.id, sessionId: session.id });
      return replayedDelivery(winner);
    }
    if (await findReceiptBySession(ctx.db, session.id)) {
      throw await alreadyAcceptedForSession(ctx.db, session.id);
    }
    throw error;
  }

  if ('replay' in outcome) return replayedDelivery(outcome.replay);
  return outcome.result;
}

/**
 * Follow-on work of an accepted delivery, written inside its finalization
 * transaction: the project's durable Run Queue dispatch job, the awaiting
 * approval event for the next runnable draft, and the awaiting-review
 * notification (whose fan-out is its own durable job). Queue selection and
 * the parallel-objective rule are unchanged; only the timing moved inside.
 */
async function scheduleDeliveryFollowOn({
  ctx,
  mission,
  deliveredObjectiveId,
  missionNowIdle
}: {
  ctx: ServiceContext;
  mission: { id: string; projectId: string };
  deliveredObjectiveId: string;
  missionNowIdle: boolean;
}): Promise<void> {
  // Run Queue membership is authoritative; its durable project-deduped worker
  // owns target/config resolution and launch retries.
  await enqueueRunQueueDispatch(ctx.db, mission.projectId, ctx.workspace.id);

  // The next runnable draft (`nextUpDraft`): the first live draft with
  // instruction text, wherever it sits relative to the delivered objective —
  // objectives can launch out of order (coo:1274). Submitted objectives and
  // blank drafts are skipped; Run Queue membership stays authoritative.
  const nextObjective = await ctx.db.get<{ id: string; title: string }>(
    `SELECT id, title
       FROM objectives
       WHERE mission_id = ? AND deleted_at IS NULL
         AND state = 'draft' AND TRIM(COALESCE(instruction_text, '')) <> ''
       ORDER BY position ASC, created_at ASC, id ASC LIMIT 1`,
    [mission.id]
  );
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

  if (missionNowIdle) {
    await emitNotification({
      db: ctx.db,
      workspaceId: ctx.workspace.id,
      missionId: mission.id,
      type: 'mission_awaiting_review',
      objectiveId: deliveredObjectiveId
    });
  }
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
    instructions: string;
    title?: string | null;
    /** Authored human-facing summary (ADR 0057); never part of the agent context. */
    summary?: string | null;
    autoAdvance?: boolean;
    /** Explicit launch selection for this objective; omitted keeps project defaulting. */
    agent?: string | null;
    /** Model for `agent`; rejected without a non-empty agent. */
    model?: string | null;
    resourceKey?: string | null;
  }>;
  title?: string | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
}): Promise<{ mission: MissionSummary; objectives: ObjectiveSummary[] }> {
  if (!projectId) {
    throw new ServiceError(
      'Mission creation requires an explicit project ID',
      'project_id_required',
      400
    );
  }
  const resolvedProjectId = await resolveProjectId(ctx, projectId);
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
    instructions: string;
    title?: string | null;
    /** Authored human-facing summary (ADR 0057); never part of the agent context. */
    summary?: string | null;
    autoAdvance?: boolean;
    /** Explicit launch selection for this objective; omitted keeps project defaulting. */
    agent?: string | null;
    /** Model for `agent`; rejected without a non-empty agent. */
    model?: string | null;
    resourceKey?: string | null;
  }>;
  title?: string | null;
  agentIdentifier?: string;
  externalSessionId?: string | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
}): Promise<AttachResponse & { sessionKey: string }> {
  if (!projectId) {
    throw new ServiceError(
      'Mission prompt requires an explicit project ID',
      'project_id_required',
      400
    );
  }
  const resolvedProjectId = await resolveProjectId(ctx, projectId);
  const assignedWorkspaceUserId = await resolveAgentMissionAssignee({ ctx, assignedTo });
  const created = await createMissionWithObjectives({
    ctx,
    projectId: resolvedProjectId,
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

export type RecordWorkResult = {
  mission: MissionSummary;
  deliveryId: string;
  /** The caller's operation id, echoed when one was sent. */
  operationId?: string;
  missionSummary?: MissionSummaryWriteResult;
  /** Present when the new mission's summary can still be published for this delivery. */
  instruction?: string;
  /** True when this response is the stored receipt of an earlier acceptance. */
  replayed?: true;
};

export async function recordWork({
  ctx,
  projectId,
  summary,
  objective,
  title,
  artifacts = [],
  declaredPaths,
  payloadJson,
  assignedTo,
  missionSummary,
  operationId: rawOperationId
}: {
  ctx: ServiceContext;
  projectId?: string | null;
  summary: string;
  objective: string;
  title?: string | null;
  artifacts?: unknown[];
  /** Explicit paths for the already-completed work; stored as `agent_declared`, sessionless. */
  declaredPaths?: unknown;
  payloadJson?: Record<string, unknown> | null;
  /** Explicit `--assigned-to` member ref; when omitted, the §7.1 default chain applies. */
  assignedTo?: string | null;
  /** Optional agent-authored summary; a new mission has no base revision to check. */
  missionSummary?: unknown;
  /**
   * Caller-retained logical operation id (ADR 0075). The same id and request
   * returns the one mission and delivery it created; without an id the server
   * cannot tell a retry from intentionally separate identical work.
   */
  operationId?: unknown;
}): Promise<RecordWorkResult> {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) {
    throw new ServiceError('Summary is required for record-work', 'validation_error');
  }
  if (payloadJson && Object.prototype.hasOwnProperty.call(payloadJson, 'reportDraft')) {
    // Record-work is sessionless: it has no draft to seal (ADR 0078).
    throw new ServiceError(
      'record-work does not accept reportDraft; send the final deliveryReport arrays instead',
      'invalid_input',
      400
    );
  }
  assertDeferredWorkInput(payloadJson?.deliveryReport);
  const summaryInput = parseMissionSummaryInput(missionSummary, { requireBase: false });
  const operationId = parseOperationId(rawOperationId);
  const actor = ctx.actorWorkspaceUserId;
  if (operationId && !actor) {
    throw new ServiceError(
      'operationId requires an authenticated workspace member',
      'invalid_input',
      400
    );
  }
  const declared = normalizeDeclaredPaths(declaredPaths);
  const normalizedArtifacts = validateProtocolArtifacts(artifacts);
  const deliveryReport = appendDeliveryWarnings(
    markDeliveryPresentationPending(
      applyDeferredWorkEligibility({
        report: buildDeliveryReport({
          summary: trimmedSummary,
          deliveryReport: payloadJson?.deliveryReport
        }),
        currentObjective: { title: title ?? null, instruction: objective },
        plannedObjectives: [],
        candidateActions: deriveDeterministicActionCandidates({ filePaths: declared.paths })
      })
    ),
    declared.warnings
  );

  if (!projectId) {
    throw new ServiceError(
      'record-work requires an explicit project ID',
      'project_id_required',
      400
    );
  }
  const resolvedProjectId = await resolveProjectId(ctx, projectId);
  const digest = finalizationRequestDigest('record_work', {
    projectId: resolvedProjectId,
    objective,
    title: title ?? null,
    summary: trimmedSummary,
    artifacts: normalizedArtifacts,
    declaredPaths: declared.paths,
    payload: payloadJson ?? null,
    assignedTo: assignedTo ?? null,
    missionSummary: summaryInput ?? null
  });
  const findOwnReceipt = (db: DatabaseClient) =>
    operationId && actor
      ? findReceiptByOperation(db, {
          workspaceId: ctx.workspace.id,
          actorWorkspaceUserId: actor,
          kind: 'record_work',
          operationId
        })
      : Promise.resolve(undefined);
  /** Replays a stored acceptance after rechecking the caller's current access. */
  const replay = async (receipt: FinalizationReceiptRow): Promise<RecordWorkResult> => {
    assertReplayMatches(receipt, { digest });
    try {
      await resolveMissionId(ctx, receipt.mission_id);
    } catch {
      throw new ServiceError('Delivery receipt not found', 'delivery_receipt_not_found', 404);
    }
    return { ...receiptResult<RecordWorkResult>(receipt), replayed: true };
  };

  const earlier = await findOwnReceipt(ctx.db);
  if (earlier) return await replay(earlier);

  const assignedWorkspaceUserId = await resolveAgentMissionAssignee({ ctx, assignedTo });

  let outcome: { replay: FinalizationReceiptRow } | { result: RecordWorkResult };
  try {
    // Mission, completed objective, source report and receipt commit together.
    // There is no mission to lock before it exists: a concurrent request with
    // the same operation id serializes on the receipt's unique index, and the
    // loser's whole creation rolls back below.
    outcome = await withMissionItemLocks(
      ctx,
      { projectId: resolvedProjectId, itemIds: summaryInput?.closeItems.map(e => e.id) ?? [] },
      async tx => {
        const txCtx = { ...ctx, db: tx };
        const concurrent = await findOwnReceipt(tx);
        if (concurrent) return { replay: concurrent };

        const created = await createMissionWithObjectives({
          ctx: txCtx,
          projectId: resolvedProjectId,
          objectives: [{ instructions: objective }],
          statusType: 'review',
          assignedWorkspaceUserId,
          ...(title !== undefined ? { title } : {})
        });

        const now = nowIso();
        const deliveryId = newId();
        const objectiveId = created.objectives[0]?.id;
        if (!objectiveId) {
          throw new ServiceError(
            'Failed to create objective for record-work',
            'internal_error',
            500
          );
        }

        const missionScope = {
          id: created.mission.id,
          workspaceId: ctx.workspace.id,
          projectId: resolvedProjectId
        };
        await lockMissionObjectiveQueue(tx, created.mission.id);
        // A new mission has no earlier basis: record-work prose publishes at
        // creation without a base (ADR 0076 keeps this exception).
        const preparedSummary: PreparedMissionSummaryWrite = await prepareMissionSummaryWrite(tx, {
          mission: missionScope,
          input: summaryInput,
          mode: 'record_work',
          now
        });
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
        await insertDeliveryMissionItems(txCtx.db, {
          delivery: {
            id: deliveryId,
            workspaceId: ctx.workspace.id,
            projectId: resolvedProjectId,
            missionId: created.mission.id,
            objectiveId,
            deliveredAt: now
          },
          report: deliveryReport,
          attribution: missionItemAttribution(ctx),
          now
        });
        const summaryResult = await finishMissionSummaryWrite(tx, {
          canCloseForeign: await canCloseForeignItems(txCtx),
          prepared: preparedSummary,
          mission: missionScope,
          objectiveId,
          deliveryId,
          sessionId: null,
          model: null,
          attribution: missionItemAttribution(ctx),
          now
        });

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

        // record-work has no attached session, so its explicit paths are sessionless
        // declarations with no resolved resource. They never claim native capture.
        await applyDeclaredPaths({
          ctx: txCtx,
          mission: { id: created.mission.id, projectId: resolvedProjectId },
          objectiveId,
          sessionId: null,
          resourceId: null,
          paths: declared.paths,
          now
        });

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
            JSON.stringify({
              deliveryId,
              recordWork: true,
              ...(operationId ? { operationId } : {})
            }),
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

        const result: RecordWorkResult = {
          mission: created.mission,
          deliveryId,
          ...(operationId ? { operationId } : {}),
          ...(summaryResult ? { missionSummary: summaryResult } : {}),
          ...(summaryResult?.publication?.available
            ? {
                instruction: publicationInstruction('cli', {
                  state: 'outstanding',
                  available: true,
                  missionDisplayId: created.mission.displayId,
                  deliveryId
                }).replace(' --session-key <key>', '')
              }
            : {})
        };
        if (actor) {
          await insertFinalizationReceipt(tx, {
            workspaceId: ctx.workspace.id,
            projectId: resolvedProjectId,
            missionId: created.mission.id,
            objectiveId,
            deliveryId,
            actorWorkspaceUserId: actor,
            sessionId: null,
            kind: 'record_work',
            operationId: operationId ?? null,
            digest,
            result,
            acceptedAt: now
          });
        }
        return { result };
      }
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findOwnReceipt(ctx.db);
    if (!winner) throw error;
    return await replay(winner);
  }

  if ('replay' in outcome) return await replay(outcome.replay);
  return outcome.result;
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

/** Full open-item detail for an attached agent, without loading mission history. */
export async function readAgentMissionItems({
  ctx,
  missionId,
  sessionKey,
  limit = 60,
  offset = 0
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  limit?: number;
  offset?: number;
}) {
  const mission = await resolveMissionId(ctx, missionId);
  const session = await getSessionByKey(ctx, sessionKey, mission);
  if (session.mission_id !== mission.id) {
    throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new ServiceError(
      'limit must be 1..200 and offset a non-negative integer',
      'invalid_input',
      400
    );
  }
  return ctx.db.transaction(async tx => {
    const page = await listMissionItems(tx, {
      missionId: mission.id,
      workspaceId: ctx.workspace.id,
      limit,
      offset,
      order: 'blocking'
    });
    return {
      missionId: mission.id,
      ...page,
      limit,
      offset,
      nextOffset: page.truncated ? offset + page.items.length : null
    };
  });
}

/** The same validated close entries and warnings as delivery, without ending the session. */
export async function closeAgentMissionItems({
  ctx,
  missionId,
  sessionKey,
  closeItems
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  closeItems: unknown;
}): Promise<MissionSummaryWriteResult> {
  const input = parseMissionSummaryInput({ closeItems }, { requireBase: true });
  if (!input) throw new ServiceError('closeItems must contain 1..50 entries', 'invalid_input', 400);
  const source = await resolveMissionId(ctx, missionId);
  return withMissionItemLocks(
    ctx,
    { missionId: source.id, projectId: source.projectId, itemIds: input.closeItems.map(e => e.id) },
    async tx => {
      const txCtx = { ...ctx, db: tx };
      const mission = await resolveMissionId(txCtx, missionId);
      const session = await getSessionByKey(txCtx, sessionKey, mission);
      if (session.mission_id !== mission.id) {
        throw new ServiceError('Session key does not match mission', 'invalid_session', 401);
      }
      if (session.delivery_state === 'delivered') {
        throw new ServiceError(
          'Resume follow-up work before closing items',
          'delivery_boundary',
          409
        );
      }
      if (mission.projectId !== source.projectId) {
        throw new ServiceError('Mission not found', 'mission_not_found', 404);
      }
      const scope = { ...mission, workspaceId: ctx.workspace.id };
      const prepared = await prepareMissionSummaryWrite(tx, {
        mission: scope,
        input,
        mode: 'close_only'
      });
      return applyMissionSummaryWrite(tx, {
        canCloseForeign: await canCloseForeignItems(txCtx),
        sessionId: session.id,
        prepared,
        mission: scope,
        objectiveId: session.objective_id,
        deliveryId: null,
        model: null,
        attribution: missionItemAttribution(ctx)
      });
    }
  );
}

/** Discovery never uses publication's ended-session exception. */
export async function readAgentProjectItems({
  ctx,
  missionId,
  sessionKey,
  objectiveId,
  ...options
}: {
  ctx: ServiceContext;
  missionId: string;
  sessionKey: string;
  objectiveId?: string;
} & Omit<ProjectItemOptions, 'workspaceId' | 'projectId' | 'missionId'>) {
  return ctx.db.transaction(async db => {
    const txCtx = { ...ctx, db };
    const mission = await resolveMissionId(txCtx, missionId);
    const session = await getSessionByKey(txCtx, sessionKey, mission);
    if (session.mission_id !== mission.id || session.delivery_state === 'delivered') {
      throw new ServiceError(
        'Discovery requires a live matching attached session',
        'invalid_session',
        401
      );
    }
    if (objectiveId) {
      const objective = await resolveObjectiveRef({
        ctx: txCtx,
        missionId: mission.id,
        ref: objectiveId
      });
      if (objective.id !== session.objective_id)
        throw new ServiceError('Objective does not match session', 'invalid_session', 401);
    }
    const ledger = await listObjectiveFileChanges({
      ctx: txCtx,
      missionId: mission.id,
      objectiveId: session.objective_id
    });
    return listProjectItemCandidates(
      db,
      {
        ...options,
        workspaceId: ctx.workspace.id,
        projectId: mission.projectId,
        missionId: mission.id
      },
      {
        paths: ledger.items.map(i => i.filePath),
        captureGap: ledger.capture.warnings.length > 0 || ledger.truncated
      }
    );
  });
}
