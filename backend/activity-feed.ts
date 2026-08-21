import { PERMISSIONS } from '@overlord/auth';
import { formatObjectiveDisplayId } from '@overlord/database';

import type {
  ActivityFeedDeliveryItemDto,
  ActivityFeedDto,
  ActivityFeedItemDto,
  ActivityFeedQuestionItemDto,
  ActivityFeedQueuedObjectiveDto,
  ActivityFeedRunItemDto,
  CreatedByKind
} from '../webapp/shared/contract.ts';

import { requireDatabaseClient } from './db.ts';
import { requireWorkspacePermission } from './rbac.ts';
import {
  callerMembershipsInActiveOrganization,
  deliveryReportFromPayload,
  readProjectColor
} from './repository.ts';

/**
 * Bounds. The feed is a glance surface, not a history: a card the operator will
 * never scroll to costs a row read and buys nothing, and an unbounded delivery
 * list would keep stale work on screen for days (coo:757).
 */
const RUN_LIMIT = 25;
const DELIVERY_LIMIT = 7;
const QUESTION_LIMIT = 10;
/** Inbox live feed only surfaces recent asks; older unseen questions stay on the mission. */
const QUESTION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const FEED_LIMIT = 40;
const INSTRUCTION_PREVIEW_CHARS = 400;
const EVENT_SUMMARY_CHARS = 240;

function truncate(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

interface FeedContextRow {
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
  project_settings_json: string;
  mission_id: string;
  mission_display_id: string;
  mission_title: string;
  /** Objective authorship; null only when the objective join itself is null. */
  created_by_kind: string | null;
  created_by_agent: string | null;
}

interface RunRow extends FeedContextRow {
  objective_id: string;
  objective_display_key: string;
  objective_title: string | null;
  instruction_text: string | null;
  state: string;
  position: number;
  branch: string | null;
  resource_key: string | null;
  assigned_agent: string | null;
  model: string | null;
  objective_updated_at: string;
  session_agent_identifier: string | null;
  session_model_identifier: string | null;
  session_started_at: string | null;
  request_created_at: string | null;
}

interface QueuedRow {
  mission_id: string;
  mission_display_id: string;
  objective_id: string;
  display_key: string;
  title: string | null;
  position: number;
  assigned_agent: string | null;
  auto_advance: number;
}

interface LatestEventRow {
  objective_id: string;
  summary: string;
  created_at: string;
}

interface DeliveryFeedRow extends FeedContextRow {
  delivery_id: string;
  objective_id: string;
  objective_display_key: string;
  objective_title: string | null;
  session_id: string | null;
  summary: string;
  verification_summary: string | null;
  follow_up_notes: string | null;
  payload_json: string | null;
  delivered_at: string;
  agent_identifier: string | null;
  model_identifier: string | null;
  assigned_agent: string | null;
}

interface QuestionRow extends FeedContextRow {
  event_id: string;
  objective_id: string | null;
  objective_display_key: string | null;
  summary: string;
  created_at: string;
  agent_identifier: string | null;
}

/**
 * Protocol defaults a missing `--agent` to the literal sentinel `unknown`. That
 * string is truthy, so `session ?? assigned` would permanently hide a real
 * assigned agent. Treat the sentinel (and blank) as absent.
 */
function resolveAgentIdentifier(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === 'unknown') continue;
    return trimmed;
  }
  return null;
}

function toCreatedByKind(value: string | null | undefined): CreatedByKind {
  return value === 'agent' || value === 'automation' ? value : 'human';
}

function baseFields(row: FeedContextRow) {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: readProjectColor(row.project_settings_json),
    missionId: row.mission_id,
    missionDisplayId: row.mission_display_id,
    missionTitle: row.mission_title,
    createdByKind: toCreatedByKind(row.created_by_kind),
    createdByAgent: row.created_by_agent ?? null
  };
}

function objectiveDisplayId(missionDisplayId: string, displayKey: string | null): string | null {
  if (!displayKey) return null;
  return formatObjectiveDisplayId({ missionDisplayId, displayKey });
}

/**
 * Workspaces the caller may read missions in. `callerMembershipsInActiveOrganization`
 * answers "where am I a member"; this narrows that to "where may I read", tolerating
 * a membership without the permission rather than failing the whole feed — one
 * restricted workspace must not blank out every other one.
 */
async function readableWorkspaceIds(): Promise<string[]> {
  const memberships = await callerMembershipsInActiveOrganization();
  const readable: string[] = [];
  for (const membership of memberships) {
    try {
      await requireWorkspacePermission({
        workspaceId: membership.workspaceId,
        permission: PERMISSIONS.MISSION_READ,
        notFoundMessage: 'Workspace not found'
      });
      readable.push(membership.workspaceId);
    } catch {
      // Not readable for this caller; other workspaces still are.
    }
  }
  return readable;
}

/** Shared join from an objective/mission row up to its project and workspace labels. */
const CONTEXT_JOIN = `
       JOIN missions m ON m.id = o.mission_id AND m.deleted_at IS NULL
       JOIN projects p ON p.id = o.project_id AND p.deleted_at IS NULL
       JOIN workspaces w ON w.id = o.workspace_id AND w.deleted_at IS NULL`;

const CONTEXT_COLUMNS = `
            o.workspace_id, w.name AS workspace_name,
            o.project_id, p.name AS project_name, p.settings_json AS project_settings_json,
            o.mission_id, m.display_id AS mission_display_id, m.title AS mission_title`;

/** Objective authorship — kept off CONTEXT_COLUMNS so the ask query can re-alias chrome without inventing columns on `mission_events`. */
const OBJECTIVE_PROVENANCE_COLUMNS = `o.created_by_kind, o.created_by_agent`;

async function loadRuns(workspaceIds: string[]): Promise<RunRow[]> {
  return (await requireDatabaseClient().all(
    `SELECT ${CONTEXT_COLUMNS}, ${OBJECTIVE_PROVENANCE_COLUMNS},
            o.id AS objective_id, o.display_key AS objective_display_key,
            o.title AS objective_title, o.instruction_text, o.state, o.position,
            o.branch, o.resource_key, o.assigned_agent, o.model,
            o.updated_at AS objective_updated_at,
            (SELECT s.agent_identifier FROM agent_sessions s
              WHERE s.objective_id = o.id AND s.deleted_at IS NULL
              ORDER BY s.started_at DESC, s.id DESC LIMIT 1) AS session_agent_identifier,
            (SELECT s.model_identifier FROM agent_sessions s
              WHERE s.objective_id = o.id AND s.deleted_at IS NULL
              ORDER BY s.started_at DESC, s.id DESC LIMIT 1) AS session_model_identifier,
            (SELECT s.started_at FROM agent_sessions s
              WHERE s.objective_id = o.id AND s.deleted_at IS NULL
              ORDER BY s.started_at DESC, s.id DESC LIMIT 1) AS session_started_at,
            (SELECT r.created_at FROM execution_requests r
              WHERE r.objective_id = o.id AND r.deleted_at IS NULL
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS request_created_at
       FROM objectives o${CONTEXT_JOIN}
      WHERE o.deleted_at IS NULL
        AND o.state IN ('launching', 'executing', 'pending_delivery')
        AND o.workspace_id IN (${placeholders(workspaceIds.length)})
      ORDER BY o.updated_at DESC, o.id ASC
      LIMIT ?`,
    [...workspaceIds, RUN_LIMIT]
  )) as RunRow[];
}

/**
 * Every objective positioned after a running one, so the caller can see what the
 * agent will pick up on its own. Loaded for all running missions at once; the
 * per-mission truncation at the first non-auto-advance objective happens in JS,
 * where "contiguous run" is expressible without a window function the SQLite and
 * Postgres adapters would have to agree on.
 */
async function loadQueued(runs: RunRow[]): Promise<Map<string, QueuedRow[]>> {
  const missionIds = [...new Set(runs.map(run => run.mission_id))];
  if (missionIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT o.mission_id, m.display_id AS mission_display_id, o.id AS objective_id,
            o.display_key, o.title, o.position, o.assigned_agent, o.auto_advance
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id AND m.deleted_at IS NULL
      WHERE o.deleted_at IS NULL
        AND o.state IN ('future', 'draft', 'submitted')
        AND o.mission_id IN (${placeholders(missionIds.length)})
      ORDER BY o.mission_id ASC, o.position ASC`,
    missionIds
  )) as QueuedRow[];

  const byMission = new Map<string, QueuedRow[]>();
  for (const row of rows) {
    const list = byMission.get(row.mission_id) ?? [];
    list.push(row);
    byMission.set(row.mission_id, list);
  }
  return byMission;
}

/**
 * The newest event per running objective, as a correlated `MAX(created_at)` rather
 * than a window function — the same statement has to run on both database adapters.
 */
async function loadLatestEvents(runs: RunRow[]): Promise<Map<string, LatestEventRow>> {
  const objectiveIds = runs.map(run => run.objective_id);
  if (objectiveIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT e.objective_id, e.summary, e.created_at
       FROM mission_events e
      WHERE e.objective_id IN (${placeholders(objectiveIds.length)})
        AND e.created_at = (SELECT MAX(x.created_at) FROM mission_events x
                             WHERE x.objective_id = e.objective_id)`,
    objectiveIds
  )) as LatestEventRow[];

  const byObjective = new Map<string, LatestEventRow>();
  for (const row of rows) {
    const existing = byObjective.get(row.objective_id);
    if (!existing || row.created_at > existing.created_at) byObjective.set(row.objective_id, row);
  }
  return byObjective;
}

async function loadDeliveries(workspaceIds: string[]): Promise<DeliveryFeedRow[]> {
  return (await requireDatabaseClient().all(
    `SELECT ${CONTEXT_COLUMNS}, ${OBJECTIVE_PROVENANCE_COLUMNS},
            d.id AS delivery_id, d.objective_id, o.display_key AS objective_display_key,
            o.title AS objective_title, d.session_id, d.summary, d.verification_summary,
            d.follow_up_notes, d.payload_json, d.delivered_at,
            s.agent_identifier, s.model_identifier, o.assigned_agent
       FROM deliveries d
       JOIN objectives o ON o.id = d.objective_id AND o.deleted_at IS NULL${CONTEXT_JOIN}
       LEFT JOIN agent_sessions s ON s.id = d.session_id AND s.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND d.workspace_id IN (${placeholders(workspaceIds.length)})
      ORDER BY d.delivered_at DESC, d.id DESC
      LIMIT ?`,
    [...workspaceIds, DELIVERY_LIMIT]
  )) as DeliveryFeedRow[];
}

// `mission_events` carries its own `workspace_id` / `project_id` / `mission_id`, and
// its objective join is a LEFT join that can be null — so the shared column list,
// written against an `o.`-prefixed objective row, is re-aliased onto the event row.
const QUESTION_CONTEXT_COLUMNS = CONTEXT_COLUMNS.replace(/\bo\./g, 'e.');

/**
 * Blocking questions the operator has not acknowledged yet. `mission_events` has no
 * answered-state of its own, so the existing `blocking_question` seen-marker — the
 * same predicate that drives the mission card indicator — is the only honest signal
 * for "still waiting on a person". The feed further limits to asks from the past
 * three days so stale blockers do not crowd the inbox (coo:757.rqtb).
 */
async function loadQuestions(workspaceIds: string[]): Promise<QuestionRow[]> {
  const askedAfter = new Date(Date.now() - QUESTION_MAX_AGE_MS).toISOString();
  return (await requireDatabaseClient().all(
    `SELECT ${QUESTION_CONTEXT_COLUMNS}, ${OBJECTIVE_PROVENANCE_COLUMNS},
            e.id AS event_id, e.objective_id, o.display_key AS objective_display_key,
            e.summary, e.created_at, s.agent_identifier
       FROM mission_events e
       LEFT JOIN objectives o ON o.id = e.objective_id AND o.deleted_at IS NULL
       JOIN missions m ON m.id = e.mission_id AND m.deleted_at IS NULL
       JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
       JOIN workspaces w ON w.id = e.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN agent_sessions s ON s.id = e.session_id AND s.deleted_at IS NULL
      WHERE e.type = 'ask'
        AND e.workspace_id IN (${placeholders(workspaceIds.length)})
        AND e.created_at >= ?
        AND (
          NOT EXISTS (SELECT 1 FROM mission_status_seen mss
                       WHERE mss.mission_id = e.mission_id
                         AND mss.status_id = 'blocking_question')
          OR e.created_at > (SELECT mss.seen_at FROM mission_status_seen mss
                              WHERE mss.mission_id = e.mission_id
                                AND mss.status_id = 'blocking_question')
        )
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?`,
    [...workspaceIds, askedAfter, QUESTION_LIMIT]
  )) as QuestionRow[];
}

function toRunItem(
  row: RunRow,
  queued: QueuedRow[] | undefined,
  latest: LatestEventRow | undefined
): ActivityFeedRunItemDto {
  const upcoming: ActivityFeedQueuedObjectiveDto[] = [];
  for (const candidate of queued ?? []) {
    if (candidate.position <= row.position) continue;
    // The first objective that will not advance on its own ends the chain: what
    // sits behind a manual gate is not "up next", and saying so would be a lie.
    if (candidate.auto_advance !== 1) break;
    upcoming.push({
      objectiveId: candidate.objective_id,
      displayId:
        objectiveDisplayId(candidate.mission_display_id, candidate.display_key) ??
        candidate.objective_id,
      title: candidate.title,
      position: candidate.position,
      assignedAgent: candidate.assigned_agent
    });
  }

  return {
    id: `run:${row.objective_id}`,
    kind: 'objective_run',
    occurredAt: latest?.created_at ?? row.objective_updated_at,
    ...baseFields(row),
    objectiveId: row.objective_id,
    objectiveDisplayId: objectiveDisplayId(row.mission_display_id, row.objective_display_key),
    state:
      row.state === 'launching'
        ? 'launching'
        : row.state === 'pending_delivery'
          ? 'pending_delivery'
          : 'executing',
    objectiveTitle: row.objective_title,
    instructionPreview: truncate(row.instruction_text, INSTRUCTION_PREVIEW_CHARS),
    agentIdentifier: resolveAgentIdentifier(row.session_agent_identifier, row.assigned_agent),
    modelIdentifier: row.session_model_identifier ?? row.model,
    branch: row.branch,
    resourceKey: row.resource_key?.trim() || null,
    startedAt: row.session_started_at ?? row.request_created_at,
    latestEventSummary: latest ? truncate(latest.summary, EVENT_SUMMARY_CHARS) : null,
    latestEventAt: latest?.created_at ?? null,
    upcoming
  };
}

function toDeliveryItem(row: DeliveryFeedRow): ActivityFeedDeliveryItemDto {
  return {
    id: `delivery:${row.delivery_id}`,
    kind: 'delivery',
    occurredAt: row.delivered_at,
    ...baseFields(row),
    objectiveId: row.objective_id,
    objectiveDisplayId: objectiveDisplayId(row.mission_display_id, row.objective_display_key),
    objectiveTitle: row.objective_title,
    delivery: {
      id: row.delivery_id,
      missionId: row.mission_id,
      objectiveId: row.objective_id,
      sessionId: row.session_id,
      summary: row.summary,
      verificationSummary: row.verification_summary,
      followUpNotes: row.follow_up_notes,
      report: deliveryReportFromPayload(row.payload_json, row.summary),
      deliveredAt: row.delivered_at,
      agentIdentifier: resolveAgentIdentifier(row.agent_identifier, row.assigned_agent),
      modelIdentifier: row.model_identifier
    }
  };
}

function toQuestionItem(row: QuestionRow): ActivityFeedQuestionItemDto {
  return {
    id: `ask:${row.event_id}`,
    kind: 'blocking_question',
    occurredAt: row.created_at,
    ...baseFields(row),
    objectiveId: row.objective_id,
    objectiveDisplayId: objectiveDisplayId(row.mission_display_id, row.objective_display_key),
    eventId: row.event_id,
    question: truncate(row.summary, EVENT_SUMMARY_CHARS * 2),
    agentIdentifier: resolveAgentIdentifier(row.agent_identifier),
    askedAt: row.created_at
  };
}

/**
 * One bounded, time-descending read of objective activity across every workspace
 * the caller can read missions in. Six indexed statements rather than one union:
 * the three sources have genuinely different shapes, and a lowest-common-
 * denominator projection would have to be re-parsed per row anyway.
 */
export async function listActivityFeed(): Promise<ActivityFeedDto> {
  const generatedAt = new Date().toISOString();
  const workspaceIds = await readableWorkspaceIds();
  if (workspaceIds.length === 0) {
    return {
      items: [],
      generatedAt,
      counts: { objective_run: 0, delivery: 0, blocking_question: 0 }
    };
  }

  const [runs, deliveries, questions] = await Promise.all([
    loadRuns(workspaceIds),
    loadDeliveries(workspaceIds),
    loadQuestions(workspaceIds)
  ]);
  const [queuedByMission, latestByObjective] = await Promise.all([
    loadQueued(runs),
    loadLatestEvents(runs)
  ]);

  const items: ActivityFeedItemDto[] = [
    ...runs.map(row =>
      toRunItem(row, queuedByMission.get(row.mission_id), latestByObjective.get(row.objective_id))
    ),
    ...deliveries.map(toDeliveryItem),
    ...questions.map(toQuestionItem)
  ];

  items.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) return a.id < b.id ? 1 : -1;
    return a.occurredAt < b.occurredAt ? 1 : -1;
  });

  return {
    items: items.slice(0, FEED_LIMIT),
    generatedAt,
    // Pre-truncation totals, so the client can say "7 of 12" instead of implying
    // the list is everything there is.
    counts: {
      objective_run: runs.length,
      delivery: deliveries.length,
      blocking_question: questions.length
    }
  };
}
