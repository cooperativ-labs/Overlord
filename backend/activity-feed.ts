import { PERMISSIONS } from '@overlord/auth';
import { sortObjectivesForMissionDisplay } from '@overlord/automations';
import { type DatabaseClient, formatObjectiveDisplayId } from '@overlord/database';

import type {
  ActivityFeedDto,
  ActivityFeedItemDto,
  ActivityFeedMissionItemDto,
  ActivityFeedMissionObjectiveDto,
  ActivityFeedQuestionItemDto,
  CreatedByKind,
  ObjectiveState
} from '../webapp/shared/contract.ts';

import { requireDatabaseClient } from './db.ts';
import { ApiError } from './errors.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { callerMembershipsInActiveOrganization, readProjectColor } from './repository.ts';

/**
 * Bounds. The feed is a glance surface, not a history: a card the operator will
 * never scroll to costs a row read and buys nothing (coo:757).
 */
const MISSION_LIMIT = 25;
const QUESTION_LIMIT = 10;
/** The live feed only surfaces recent asks; older unseen questions stay on the mission. */
const QUESTION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const FEED_LIMIT = 40;
const INSTRUCTION_PREVIEW_CHARS = 400;
const EVENT_SUMMARY_CHARS = 240;
/** First page, and each scroll page, of delivered missions. */
const DELIVERED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Objective states that make a mission live work worth a feed card. */
const RUNNING_STATES = ['launching', 'executing', 'pending_delivery'] as const;

function truncate(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** Extract a scalar JSON field on either supported database adapter. */
function jsonTextFieldSql(
  column: string,
  field: string,
  dialect: DatabaseClient['dialect']
): string {
  return dialect === 'postgres'
    ? `${column}->>'${field}'`
    : `json_extract(${column}, '$.${field}')`;
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
  created_by_kind: string | null;
  created_by_agent: string | null;
}

/** One running objective, carrying the chrome of the mission it belongs to. */
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
  launched_at: string | null;
  started_at: string | null;
  session_agent_identifier: string | null;
  session_model_identifier: string | null;
  session_started_at: string | null;
  request_created_at: string | null;
}

/** Every objective of a running mission, for the list under its card. */
interface MissionObjectiveRow {
  mission_id: string;
  mission_display_id: string;
  objective_id: string;
  display_key: string;
  title: string | null;
  instruction_text: string | null;
  state: string;
  position: number;
  assigned_agent: string | null;
  auto_advance: number;
  created_at: string;
  launched_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface LatestEventRow {
  objective_id: string;
  summary: string;
  created_at: string;
}

interface QuestionRow extends FeedContextRow {
  event_id: string;
  agent_request_id: string | null;
  delivery_mode: 'latch' | 'read_only';
  objective_id: string | null;
  objective_display_key: string | null;
  summary: string;
  created_at: string;
  agent_identifier: string | null;
}

/** Latest delivery of a mission that is not currently running. */
interface DeliveredRow extends FeedContextRow {
  delivery_id: string;
  delivery_summary: string;
  delivered_at: string;
  objective_id: string;
  objective_display_key: string;
  objective_title: string | null;
  instruction_text: string | null;
  branch: string | null;
  resource_key: string | null;
  assigned_agent: string | null;
  model: string | null;
  session_agent_identifier: string | null;
  session_model_identifier: string | null;
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

/**
 * A feed card is the mission, so its origin mark is the *mission's* provenance —
 * "an agent filed this work" — not the authorship of whichever objective happens
 * to be running. Asks re-alias these off the objective, where the mark still
 * means the objective the agent is blocked on.
 */
const MISSION_PROVENANCE_COLUMNS = `m.created_by_kind, m.created_by_agent`;
const OBJECTIVE_PROVENANCE_COLUMNS = `o.created_by_kind, o.created_by_agent`;

/**
 * Every objective that is live right now, newest activity first.
 *
 * Read at the objective level and grouped into missions afterwards: a mission
 * can legally run several objectives at once (parallel objectives), and the
 * primary-objective choice needs all of them.
 */
async function loadRuns(workspaceIds: string[]): Promise<RunRow[]> {
  return (await requireDatabaseClient().all(
    `SELECT ${CONTEXT_COLUMNS}, ${MISSION_PROVENANCE_COLUMNS},
            o.id AS objective_id, o.display_key AS objective_display_key,
            o.title AS objective_title, o.instruction_text, o.state, o.position,
            o.branch, o.resource_key, o.assigned_agent, o.model,
            o.updated_at AS objective_updated_at, o.launched_at, o.started_at,
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
        AND o.state IN (${placeholders(RUNNING_STATES.length)})
        AND o.workspace_id IN (${placeholders(workspaceIds.length)})
      ORDER BY o.updated_at DESC, o.id ASC`,
    [...RUNNING_STATES, ...workspaceIds]
  )) as RunRow[];
}

/**
 * Every objective of the given missions — done, running, and planned alike.
 *
 * The card lists a mission's whole plan, so this is deliberately unfiltered by
 * state. Ordering into the mission-panel display order happens in JS with the
 * shared `sortObjectivesForMissionDisplay` rule rather than in SQL, so the feed
 * cannot drift from the panel it is modelled on.
 */
async function loadMissionObjectives(
  missionIds: string[]
): Promise<Map<string, MissionObjectiveRow[]>> {
  if (missionIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT o.mission_id, m.display_id AS mission_display_id, o.id AS objective_id,
            o.display_key, o.title, o.instruction_text, o.state, o.position,
            o.assigned_agent, o.auto_advance, o.created_at,
            o.launched_at, o.started_at, o.completed_at
       FROM objectives o
       JOIN missions m ON m.id = o.mission_id AND m.deleted_at IS NULL
      WHERE o.deleted_at IS NULL
        AND o.mission_id IN (${placeholders(missionIds.length)})
      ORDER BY o.mission_id ASC, o.position ASC`,
    missionIds
  )) as MissionObjectiveRow[];

  const byMission = new Map<string, MissionObjectiveRow[]>();
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
async function loadLatestEvents(objectiveIds: string[]): Promise<Map<string, LatestEventRow>> {
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

// `mission_events` carries its own `workspace_id` / `project_id` / `mission_id`, and
// its objective join is a LEFT join that can be null — so the shared column list,
// written against an `o.`-prefixed objective row, is re-aliased onto the event row.
const QUESTION_CONTEXT_COLUMNS = CONTEXT_COLUMNS.replace(/\bo\./g, 'e.');

/**
 * Blocking questions the operator has not acknowledged yet. `mission_events` has no
 * linked request has no later answer event. The feed further limits to asks from
 * the past three days so stale blockers do not crowd the page (coo:757.rqtb).
 */
async function loadQuestions(workspaceIds: string[]): Promise<QuestionRow[]> {
  const askedAfter = new Date(Date.now() - QUESTION_MAX_AGE_MS).toISOString();
  const db = requireDatabaseClient();
  const requestProvider = jsonTextFieldSql('er.metadata_json', 'provider', db.dialect);
  const answerRequestId = jsonTextFieldSql('answer.payload_json', 'agentRequestId', db.dialect);
  return (await db.all(
    `SELECT ${QUESTION_CONTEXT_COLUMNS}, ${OBJECTIVE_PROVENANCE_COLUMNS},
            e.id AS event_id, e.objective_id, o.display_key AS objective_display_key,
            ar.id AS agent_request_id,
            CASE WHEN ar.id IS NOT NULL AND ar.status = 'open' AND EXISTS (
              SELECT 1 FROM execution_requests er
               WHERE er.launched_session_id = e.session_id
                 AND er.deleted_at IS NULL
                 AND ${requestProvider} = 'latch'
            ) THEN 'latch' ELSE 'read_only' END AS delivery_mode,
            e.summary, e.created_at, s.agent_identifier
       FROM mission_events e
       LEFT JOIN objectives o ON o.id = e.objective_id AND o.deleted_at IS NULL
       JOIN missions m ON m.id = e.mission_id AND m.deleted_at IS NULL
       JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
       JOIN workspaces w ON w.id = e.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN agent_sessions s ON s.id = e.session_id AND s.deleted_at IS NULL
       LEFT JOIN agent_requests ar ON ar.source_event_id = e.id AND ar.deleted_at IS NULL
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
        AND NOT EXISTS (
          SELECT 1 FROM mission_events answer
           WHERE answer.mission_id = e.mission_id
             AND answer.type = 'answer'
             AND ar.id IS NOT NULL
             AND ${answerRequestId} = ar.id
        )
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?`,
    [...workspaceIds, askedAfter, QUESTION_LIMIT]
  )) as QuestionRow[];
}

function twoWeeksBefore(iso: string): string {
  return new Date(Date.parse(iso) - DELIVERED_WINDOW_MS).toISOString();
}

function parseFeedBefore(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!ISO_UTC.test(trimmed)) {
    throw new ApiError(400, 'before must be an ISO-8601 UTC timestamp');
  }
  return trimmed;
}

/**
 * The latest live delivery row for each mission whose most recent delivery
 * falls in `(windowStart, windowEnd]`, excluding missions that still have live
 * work — those already have a `mission_run` card.
 */
async function loadDelivered({
  workspaceIds,
  windowStart,
  windowEnd
}: {
  workspaceIds: string[];
  windowStart: string;
  windowEnd: string;
}): Promise<DeliveredRow[]> {
  return (await requireDatabaseClient().all(
    `SELECT ${CONTEXT_COLUMNS}, ${MISSION_PROVENANCE_COLUMNS},
            d.id AS delivery_id, d.summary AS delivery_summary, d.delivered_at,
            o.id AS objective_id, o.display_key AS objective_display_key,
            o.title AS objective_title, o.instruction_text,
            o.branch, o.resource_key, o.assigned_agent, o.model,
            s.agent_identifier AS session_agent_identifier,
            s.model_identifier AS session_model_identifier
       FROM deliveries d
       JOIN objectives o ON o.id = d.objective_id AND o.deleted_at IS NULL
       ${CONTEXT_JOIN}
       LEFT JOIN agent_sessions s ON s.id = d.session_id AND s.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND d.workspace_id IN (${placeholders(workspaceIds.length)})
        AND d.delivered_at > ?
        AND d.delivered_at <= ?
        AND d.id = (
          SELECT x.id FROM deliveries x
           WHERE x.mission_id = d.mission_id
             AND x.deleted_at IS NULL
           ORDER BY x.delivered_at DESC, x.id DESC
           LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM objectives live
           WHERE live.mission_id = d.mission_id
             AND live.deleted_at IS NULL
             AND live.state IN (${placeholders(RUNNING_STATES.length)})
        )
      ORDER BY d.delivered_at DESC, d.id DESC`,
    [...workspaceIds, windowStart, windowEnd, ...RUNNING_STATES]
  )) as DeliveredRow[];
}

async function latestDeliveredAtOnOrBefore({
  workspaceIds,
  onOrBefore
}: {
  workspaceIds: string[];
  onOrBefore: string;
}): Promise<string | null> {
  const row = (await requireDatabaseClient().get(
    `SELECT MAX(d.delivered_at) AS latest
       FROM deliveries d
      WHERE d.deleted_at IS NULL
        AND d.workspace_id IN (${placeholders(workspaceIds.length)})
        AND d.delivered_at <= ?
        AND d.id = (
          SELECT x.id FROM deliveries x
           WHERE x.mission_id = d.mission_id
             AND x.deleted_at IS NULL
           ORDER BY x.delivered_at DESC, x.id DESC
           LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM objectives live
           WHERE live.mission_id = d.mission_id
             AND live.deleted_at IS NULL
             AND live.state IN (${placeholders(RUNNING_STATES.length)})
        )`,
    [...workspaceIds, onOrBefore, ...RUNNING_STATES]
  )) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

async function hasOlderDelivered({
  workspaceIds,
  onOrBefore
}: {
  workspaceIds: string[];
  onOrBefore: string;
}): Promise<boolean> {
  return (await latestDeliveredAtOnOrBefore({ workspaceIds, onOrBefore })) !== null;
}

/**
 * One two-week window of delivered missions ending at `windowEnd`.
 *
 * The first page (`skipEmpty: false`) stays strictly inside that window even
 * when it is empty, so "the last two weeks" means that. A scroll page may jump
 * backward over an empty calendar hole so the operator actually sees missions.
 */
async function loadDeliveredPage({
  workspaceIds,
  windowEnd,
  skipEmpty
}: {
  workspaceIds: string[];
  windowEnd: string;
  skipEmpty: boolean;
}): Promise<{ rows: DeliveredRow[]; nextBefore: string | null }> {
  let end = windowEnd;
  let start = twoWeeksBefore(end);
  let rows = await loadDelivered({ workspaceIds, windowStart: start, windowEnd: end });
  if (rows.length === 0 && skipEmpty) {
    const olderAt = await latestDeliveredAtOnOrBefore({ workspaceIds, onOrBefore: start });
    if (!olderAt) return { rows: [], nextBefore: null };
    end = olderAt;
    start = twoWeeksBefore(end);
    rows = await loadDelivered({ workspaceIds, windowStart: start, windowEnd: end });
  }
  const older = await hasOlderDelivered({ workspaceIds, onOrBefore: start });
  return { rows, nextBefore: older ? start : null };
}

/**
 * The objective a mission card speaks for.
 *
 * A launching objective wins over a running one: "an agent is being handed this"
 * is the newer fact and the one the operator is waiting on. Within a group the
 * oldest moment wins, matching the mission panel's own ordering.
 */
function pickPrimaryRun(runs: RunRow[]): RunRow {
  const byMoment = (moment: (row: RunRow) => string | null) => (a: RunRow, b: RunRow) =>
    (moment(a) ?? a.objective_updated_at).localeCompare(moment(b) ?? b.objective_updated_at);
  const launching = runs
    .filter(run => run.state === 'launching')
    .sort(byMoment(r => r.launched_at));
  if (launching[0]) return launching[0];
  return [...runs].sort(byMoment(r => r.started_at))[0]!;
}

function toMissionObjective(row: MissionObjectiveRow): ActivityFeedMissionObjectiveDto {
  return {
    objectiveId: row.objective_id,
    displayId: objectiveDisplayId(row.mission_display_id, row.display_key) ?? row.objective_id,
    title: row.title,
    state: row.state as ObjectiveState,
    position: row.position,
    assignedAgent: row.assigned_agent,
    autoAdvance: row.auto_advance === 1
  };
}

function toMissionItem({
  runs,
  objectiveRows,
  latest
}: {
  runs: RunRow[];
  objectiveRows: MissionObjectiveRow[];
  latest: LatestEventRow | undefined;
}): ActivityFeedMissionItemDto {
  const primary = pickPrimaryRun(runs);
  const ordered = sortObjectivesForMissionDisplay(
    objectiveRows.map(row => ({
      id: row.objective_id,
      position: row.position,
      state: row.state,
      instructionText: row.instruction_text ?? '',
      autoAdvance: row.auto_advance === 1,
      assignedAgent: row.assigned_agent,
      createdAt: row.created_at,
      launchedAt: row.launched_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      row
    }))
  );

  return {
    id: `mission:${primary.mission_id}`,
    kind: 'mission_run',
    occurredAt: latest?.created_at ?? primary.objective_updated_at,
    ...baseFields(primary),
    objectiveId: primary.objective_id,
    objectiveDisplayId: objectiveDisplayId(
      primary.mission_display_id,
      primary.objective_display_key
    ),
    runState: primary.state === 'launching' ? 'launching' : 'executing',
    objectives: ordered.map(entry => toMissionObjective(entry.row)),
    activeObjectiveIds: runs.map(run => run.objective_id),
    objectiveTitle: primary.objective_title,
    instructionPreview: truncate(primary.instruction_text, INSTRUCTION_PREVIEW_CHARS),
    agentIdentifier: resolveAgentIdentifier(
      primary.session_agent_identifier,
      primary.assigned_agent
    ),
    modelIdentifier: primary.session_model_identifier ?? primary.model,
    branch: primary.branch,
    resourceKey: primary.resource_key?.trim() || null,
    startedAt: primary.session_started_at ?? primary.request_created_at,
    latestEventSummary: latest ? truncate(latest.summary, EVENT_SUMMARY_CHARS) : null,
    latestEventAt: latest?.created_at ?? null
  };
}

function toDeliveredMissionItem({
  row,
  objectiveRows
}: {
  row: DeliveredRow;
  objectiveRows: MissionObjectiveRow[];
}): ActivityFeedMissionItemDto {
  const ordered = sortObjectivesForMissionDisplay(
    objectiveRows.map(objective => ({
      id: objective.objective_id,
      position: objective.position,
      state: objective.state,
      instructionText: objective.instruction_text ?? '',
      autoAdvance: objective.auto_advance === 1,
      assignedAgent: objective.assigned_agent,
      createdAt: objective.created_at,
      launchedAt: objective.launched_at,
      startedAt: objective.started_at,
      completedAt: objective.completed_at,
      row: objective
    }))
  );

  return {
    id: `mission:${row.mission_id}`,
    kind: 'mission_delivered',
    occurredAt: row.delivered_at,
    ...baseFields(row),
    objectiveId: row.objective_id,
    objectiveDisplayId: objectiveDisplayId(row.mission_display_id, row.objective_display_key),
    runState: 'delivered',
    objectives: ordered.map(entry => toMissionObjective(entry.row)),
    activeObjectiveIds: [],
    objectiveTitle: row.objective_title,
    instructionPreview: truncate(row.instruction_text, INSTRUCTION_PREVIEW_CHARS),
    agentIdentifier: resolveAgentIdentifier(row.session_agent_identifier, row.assigned_agent),
    modelIdentifier: row.session_model_identifier ?? row.model,
    branch: row.branch,
    resourceKey: row.resource_key?.trim() || null,
    startedAt: null,
    latestEventSummary: truncate(row.delivery_summary, EVENT_SUMMARY_CHARS),
    latestEventAt: row.delivered_at
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
    agentRequestId: row.agent_request_id,
    delivery: { mode: row.delivery_mode },
    question: truncate(row.summary, EVENT_SUMMARY_CHARS * 2),
    agentIdentifier: resolveAgentIdentifier(row.agent_identifier),
    askedAt: row.created_at
  };
}

function newestFirst(a: ActivityFeedItemDto, b: ActivityFeedItemDto): number {
  if (a.occurredAt === b.occurredAt) return a.id < b.id ? 1 : -1;
  return a.occurredAt < b.occurredAt ? 1 : -1;
}

/**
 * One bounded read of live work, recent deliveries, and blocking questions
 * across every workspace the caller can read missions in.
 *
 * The first page is grouped rather than purely time-descending: launching
 * missions lead, then executing ones, then blocking questions, then delivered
 * missions whose most recent delivery is within the past two weeks. A launching
 * mission is the one thing on this page nobody is working on yet, so it is what
 * should be seen first. `before` pages drop live work and questions and return
 * the next older two-week window of delivered missions.
 */
export async function listActivityFeed({
  before
}: {
  before?: string | null;
} = {}): Promise<ActivityFeedDto> {
  const generatedAt = new Date().toISOString();
  const empty = {
    items: [] as ActivityFeedItemDto[],
    generatedAt,
    counts: { mission_run: 0, blocking_question: 0, mission_delivered: 0 },
    nextBefore: null as string | null
  };
  const workspaceIds = await readableWorkspaceIds();
  if (workspaceIds.length === 0) return empty;

  const parsedBefore = parseFeedBefore(before);
  const paging = parsedBefore !== null;
  const windowEnd = paging && parsedBefore < generatedAt ? parsedBefore : generatedAt;

  const deliveredPagePromise = loadDeliveredPage({
    workspaceIds,
    windowEnd,
    skipEmpty: paging
  });

  if (paging) {
    const deliveredPage = await deliveredPagePromise;
    const objectivesByMission = await loadMissionObjectives(
      deliveredPage.rows.map(row => row.mission_id)
    );
    const deliveredItems = deliveredPage.rows.map(row =>
      toDeliveredMissionItem({
        row,
        objectiveRows: objectivesByMission.get(row.mission_id) ?? []
      })
    );
    return {
      items: deliveredItems,
      generatedAt,
      counts: {
        mission_run: 0,
        blocking_question: 0,
        mission_delivered: deliveredPage.rows.length
      },
      nextBefore: deliveredPage.nextBefore
    };
  }

  const [allRuns, questions, deliveredPage] = await Promise.all([
    loadRuns(workspaceIds),
    loadQuestions(workspaceIds),
    deliveredPagePromise
  ]);

  // Group first, cap second: the bound is on cards, and one mission running three
  // objectives must not consume three of the operator's slots.
  const runsByMission = new Map<string, RunRow[]>();
  for (const run of allRuns) {
    const list = runsByMission.get(run.mission_id) ?? [];
    list.push(run);
    runsByMission.set(run.mission_id, list);
  }
  const missionCount = runsByMission.size;
  const missionIds = [...runsByMission.keys()].slice(0, MISSION_LIMIT);
  const deliveredMissionIds = deliveredPage.rows.map(row => row.mission_id);

  const primaryByMission = new Map(
    missionIds.map(missionId => [missionId, pickPrimaryRun(runsByMission.get(missionId)!)])
  );
  const [objectivesByMission, latestByObjective] = await Promise.all([
    loadMissionObjectives([...new Set([...missionIds, ...deliveredMissionIds])]),
    loadLatestEvents([...primaryByMission.values()].map(run => run.objective_id))
  ]);

  const missionItems = missionIds.map(missionId =>
    toMissionItem({
      runs: runsByMission.get(missionId)!,
      objectiveRows: objectivesByMission.get(missionId) ?? [],
      latest: latestByObjective.get(primaryByMission.get(missionId)!.objective_id)
    })
  );
  const deliveredItems = deliveredPage.rows.map(row =>
    toDeliveredMissionItem({
      row,
      objectiveRows: objectivesByMission.get(row.mission_id) ?? []
    })
  );

  const launching = missionItems.filter(item => item.runState === 'launching').sort(newestFirst);
  const executing = missionItems.filter(item => item.runState === 'executing').sort(newestFirst);
  const questionItems = questions.map(toQuestionItem).sort(newestFirst);

  return {
    items: [
      ...[...launching, ...executing, ...questionItems].slice(0, FEED_LIMIT),
      ...deliveredItems
    ],
    generatedAt,
    // Pre-truncation totals, so the client can say "7 of 12" instead of implying
    // the list is everything there is.
    counts: {
      mission_run: missionCount,
      blocking_question: questions.length,
      mission_delivered: deliveredPage.rows.length
    },
    nextBefore: deliveredPage.nextBefore
  };
}
