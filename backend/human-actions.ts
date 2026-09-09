import { PERMISSIONS } from '@overlord/auth';
import { formatObjectiveDisplayId } from '@overlord/database';
import { createHash } from 'node:crypto';

import type {
  HumanActionItemDto,
  HumanActionItemKind,
  HumanActionResolutionDto,
  HumanActionResolutionStatus,
  HumanActionsDto,
  HumanActionV1,
  ResolveHumanActionBody
} from '../webapp/shared/contract.ts';

import { readableWorkspaceIds } from './activity-feed.ts';
import {
  findActiveMembershipId,
  nowIso,
  recordChange,
  requireDatabaseClient,
  resolveActiveProfileId
} from './db.ts';
import { ApiError } from './errors.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { deliveryReportFromPayload, readProjectColor } from './repository.ts';

/**
 * Human follow-up actions and deferred work, collected across every mission the
 * operator can read (coo:963, coo:971). The delivery report is the only place an
 * item's text lives; this module projects those lists into one rail and records
 * the operator's decision per item in `human_action_resolutions`.
 */

/** How far back a delivery still contributes actions. An older unresolved action is stale by definition. */
const DELIVERY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Bound on deliveries scanned per read; the JSON prefilter keeps this to deliveries that carry actions. */
const DELIVERY_SCAN_LIMIT = 400;
/** Resolved actions are history; the rail shows only the most recent of them. */
const RESOLVED_LIMIT = 100;

const RESOLUTION_STATUSES: ReadonlySet<string> = new Set(['done', 'dismissed']);

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/**
 * SQL that is true when the delivery presentation carries at least one human
 * action or deferred-work item, so the read never parses deliveries that could
 * not contribute.
 */
function hasHumanActionItemsSql(dialect: 'postgres' | 'sqlite'): string {
  if (dialect === 'postgres') {
    return `((jsonb_typeof(d.payload_json #> '{deliveryReport,presentation,humanActions}') = 'array'
          AND jsonb_array_length(d.payload_json #> '{deliveryReport,presentation,humanActions}') > 0)
         OR (jsonb_typeof(d.payload_json #> '{deliveryReport,presentation,deferredWork}') = 'array'
          AND jsonb_array_length(d.payload_json #> '{deliveryReport,presentation,deferredWork}') > 0))`;
  }
  return `(COALESCE(json_array_length(d.payload_json, '$.deliveryReport.presentation.humanActions'), 0) > 0
       OR COALESCE(json_array_length(d.payload_json, '$.deliveryReport.presentation.deferredWork'), 0) > 0)`;
}

interface DeliveryActionRow {
  delivery_id: string;
  delivery_summary: string;
  payload_json: string | null;
  delivered_at: string;
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
  project_settings_json: string;
  mission_id: string;
  mission_display_id: string;
  mission_title: string;
  objective_id: string;
  objective_display_key: string;
  objective_title: string | null;
  assigned_agent: string | null;
  session_agent_identifier: string | null;
}

interface ResolutionRow {
  delivery_id: string;
  action_id: string;
  status: string;
  resolved_at: string;
  resolved_by_workspace_user_id: string | null;
}

const DELIVERY_SELECT = `
  SELECT d.id AS delivery_id, d.summary AS delivery_summary, d.payload_json, d.delivered_at,
         d.workspace_id, w.name AS workspace_name,
         d.project_id, p.name AS project_name, p.settings_json AS project_settings_json,
         d.mission_id, m.display_id AS mission_display_id, m.title AS mission_title,
         o.id AS objective_id, o.display_key AS objective_display_key, o.title AS objective_title,
         o.assigned_agent,
         s.agent_identifier AS session_agent_identifier
    FROM deliveries d
    JOIN objectives o ON o.id = d.objective_id AND o.deleted_at IS NULL
    JOIN missions m ON m.id = d.mission_id AND m.deleted_at IS NULL
    JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
    JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
    LEFT JOIN agent_sessions s ON s.id = d.session_id AND s.deleted_at IS NULL`;

/** Only the latest delivery of an objective speaks for it; an earlier list may be stale. */
const LATEST_PER_OBJECTIVE = `
     AND d.id = (
       SELECT x.id FROM deliveries x
        WHERE x.objective_id = d.objective_id AND x.deleted_at IS NULL
        ORDER BY x.delivered_at DESC, x.id DESC
        LIMIT 1
     )`;

async function loadDeliveriesWithActions(workspaceIds: string[]): Promise<DeliveryActionRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = requireDatabaseClient();
  const since = new Date(Date.now() - DELIVERY_WINDOW_MS).toISOString();
  return (await db.all(
    `${DELIVERY_SELECT}
   WHERE d.deleted_at IS NULL
     AND d.workspace_id IN (${placeholders(workspaceIds.length)})
     AND d.delivered_at >= ?
     AND ${hasHumanActionItemsSql(db.dialect)}
     ${LATEST_PER_OBJECTIVE}
   ORDER BY d.delivered_at DESC, d.id DESC
   LIMIT ?`,
    [...workspaceIds, since, DELIVERY_SCAN_LIMIT]
  )) as DeliveryActionRow[];
}

async function loadDelivery(deliveryId: string): Promise<DeliveryActionRow | undefined> {
  return (await requireDatabaseClient().get(
    `${DELIVERY_SELECT}
   WHERE d.id = ? AND d.deleted_at IS NULL`,
    [deliveryId]
  )) as DeliveryActionRow | undefined;
}

async function loadResolutions(deliveryIds: string[]): Promise<Map<string, ResolutionRow>> {
  if (deliveryIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT delivery_id, action_id, status, resolved_at, resolved_by_workspace_user_id
       FROM human_action_resolutions
      WHERE delivery_id IN (${placeholders(deliveryIds.length)})`,
    deliveryIds
  )) as ResolutionRow[];
  return new Map(rows.map(row => [`${row.delivery_id}:${row.action_id}`, row]));
}

function resolveAgentIdentifier(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || trimmed.toLowerCase() === 'unknown') continue;
    return trimmed;
  }
  return null;
}

function toResolution(row: ResolutionRow | undefined): HumanActionResolutionDto | null {
  if (!row || !RESOLUTION_STATUSES.has(row.status)) return null;
  return {
    status: row.status as HumanActionResolutionStatus,
    resolvedAt: row.resolved_at,
    resolvedByWorkspaceUserId: row.resolved_by_workspace_user_id
  };
}

interface HumanActionRailEntry extends HumanActionV1 {
  kind: HumanActionItemKind;
  /**
   * The pre-composition deferred-work id. It remains readable during the
   * identifier migration, but mutation paths always write `id`.
   */
  legacyId?: string;
}

function deferredWorkId(text: string, occurrence: number): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  return `deferred-work-${digest}-${occurrence}`;
}

function agentDeferredWorkId(index: number, agentText: string | undefined): string {
  if (!agentText) return `deferred-work-${index}-composed`;
  const digest = createHash('sha256').update(agentText).digest('hex').slice(0, 16);
  return `deferred-work-${index}-${digest}`;
}

function deliveryActions(row: DeliveryActionRow): HumanActionRailEntry[] {
  const report = deliveryReportFromPayload(row.payload_json, row.delivery_summary);
  const { presentation, agentReport } = report;
  const humanActions = presentation.humanActions.map(action => ({
    ...action,
    kind: action.blocking === true ? 'blocking_question' : 'follow_up'
  })) satisfies HumanActionRailEntry[];
  const occurrences = new Map<string, number>();
  const deferredWork = presentation.deferredWork.map((action, index) => {
    const occurrence = (occurrences.get(action) ?? 0) + 1;
    occurrences.set(action, occurrence);
    return {
      id: agentDeferredWorkId(index, agentReport.deferredWork[index]),
      legacyId: deferredWorkId(action, occurrence),
      kind: 'deferred_work',
      action,
      category: 'other',
      source: 'agent'
    } satisfies HumanActionRailEntry;
  });
  return [...humanActions, ...deferredWork];
}

function toItem(
  row: DeliveryActionRow,
  action: HumanActionRailEntry,
  resolution: ResolutionRow | undefined
): HumanActionItemDto {
  return {
    id: `human-action:${row.delivery_id}:${action.id}`,
    deliveryId: row.delivery_id,
    actionId: action.id,
    kind: action.kind,
    action: action.action,
    reason: action.reason ?? null,
    category: action.category,
    blocking: action.blocking === true,
    command: action.command ?? null,
    verify: action.verify ?? null,
    link: action.link ?? null,
    source: action.source,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: readProjectColor(row.project_settings_json),
    missionId: row.mission_id,
    missionDisplayId: row.mission_display_id,
    missionTitle: row.mission_title,
    objectiveId: row.objective_id,
    objectiveDisplayId: formatObjectiveDisplayId({
      missionDisplayId: row.mission_display_id,
      displayKey: row.objective_display_key
    }),
    objectiveTitle: row.objective_title,
    deliveredAt: row.delivered_at,
    agentIdentifier: resolveAgentIdentifier(row.session_agent_identifier, row.assigned_agent),
    resolution: toResolution(resolution)
  };
}

function openFirst(a: HumanActionItemDto, b: HumanActionItemDto): number {
  const kindRank: Record<HumanActionItemKind, number> = {
    blocking_question: 0,
    deferred_work: 1,
    follow_up: 2
  };
  if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind];
  if (a.deliveredAt !== b.deliveredAt) return a.deliveredAt < b.deliveredAt ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

function resolvedNewestFirst(a: HumanActionItemDto, b: HumanActionItemDto): number {
  const left = a.resolution?.resolvedAt ?? '';
  const right = b.resolution?.resolvedAt ?? '';
  if (left !== right) return left < right ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Every human action and deferred-work item from the latest delivery of each
 * objective delivered in the last 90 days, across every workspace the caller
 * can read missions in. Open items lead by kind; resolved ones follow only when
 * asked for.
 */
export async function listHumanActions({
  includeResolved = false
}: { includeResolved?: boolean } = {}): Promise<HumanActionsDto> {
  const generatedAt = new Date().toISOString();
  const workspaceIds = await readableWorkspaceIds();
  const rows = await loadDeliveriesWithActions(workspaceIds);
  const resolutions = await loadResolutions(rows.map(row => row.delivery_id));

  const open: HumanActionItemDto[] = [];
  const resolved: HumanActionItemDto[] = [];
  for (const row of rows) {
    for (const action of deliveryActions(row)) {
      const resolution =
        resolutions.get(`${row.delivery_id}:${action.id}`) ??
        (action.legacyId ? resolutions.get(`${row.delivery_id}:${action.legacyId}`) : undefined);
      const item = toItem(row, action, resolution);
      (item.resolution ? resolved : open).push(item);
    }
  }
  open.sort(openFirst);
  resolved.sort(resolvedNewestFirst);

  return {
    items: includeResolved ? [...open, ...resolved.slice(0, RESOLVED_LIMIT)] : open,
    generatedAt,
    counts: {
      open: open.length,
      blocking: open.filter(item => item.blocking).length,
      deferred: open.filter(item => item.kind === 'deferred_work').length,
      resolved: resolved.length
    }
  };
}

async function requireDeliveryAction(
  deliveryId: string,
  actionId: string
): Promise<{ row: DeliveryActionRow; action: HumanActionRailEntry; workspaceUserId: string }> {
  const row = await loadDelivery(deliveryId);
  if (!row) throw new ApiError(404, 'Delivery not found');
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission: PERMISSIONS.MISSION_UPDATE,
    notFoundMessage: 'Delivery not found'
  });
  const action = deliveryActions(row).find(
    candidate => candidate.id === actionId || candidate.legacyId === actionId
  );
  if (!action) throw new ApiError(404, 'Human action not found');
  return { row, action, workspaceUserId };
}

async function currentItem(
  row: DeliveryActionRow,
  action: HumanActionRailEntry
): Promise<HumanActionItemDto> {
  const resolutions = await loadResolutions([row.delivery_id]);
  const resolution =
    resolutions.get(`${row.delivery_id}:${action.id}`) ??
    (action.legacyId ? resolutions.get(`${row.delivery_id}:${action.legacyId}`) : undefined);
  return toItem(row, action, resolution);
}

async function actorWorkspaceUserId(workspaceId: string, fallback: string): Promise<string> {
  const profileId = await resolveActiveProfileId();
  if (!profileId) return fallback;
  return (await findActiveMembershipId(workspaceId, profileId)) ?? fallback;
}

function parseStatus(body: unknown): HumanActionResolutionStatus {
  const status =
    body && typeof body === 'object' ? (body as Partial<ResolveHumanActionBody>).status : undefined;
  if (typeof status !== 'string' || !RESOLUTION_STATUSES.has(status)) {
    throw new ApiError(400, "status must be 'done' or 'dismissed'");
  }
  return status as HumanActionResolutionStatus;
}

/** Records the operator's decision on one action. Re-resolving overwrites the earlier decision. */
export async function resolveHumanAction(
  deliveryId: string,
  actionId: string,
  body: unknown
): Promise<HumanActionItemDto> {
  const status = parseStatus(body);
  const { row, action, workspaceUserId } = await requireDeliveryAction(deliveryId, actionId);
  const db = requireDatabaseClient();
  const resolvedBy = await actorWorkspaceUserId(row.workspace_id, workspaceUserId);
  const now = nowIso();

  await db.transaction(async tx => {
    await tx.run(
      `INSERT INTO human_action_resolutions
         (delivery_id, action_id, workspace_id, mission_id, objective_id, status,
          resolved_by_workspace_user_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (delivery_id, action_id) DO UPDATE SET
         status = excluded.status,
         resolved_by_workspace_user_id = excluded.resolved_by_workspace_user_id,
         resolved_at = excluded.resolved_at`,
      [
        row.delivery_id,
        action.id,
        row.workspace_id,
        row.mission_id,
        row.objective_id,
        status,
        resolvedBy,
        now
      ]
    );
    await recordChange(
      {
        entityType: 'human_action_resolution',
        entityId: `${row.delivery_id}:${action.id}`,
        operation: 'update',
        projectId: row.project_id,
        missionId: row.mission_id,
        objectiveId: row.objective_id,
        workspaceId: row.workspace_id,
        changedFields: ['status'],
        actorWorkspaceUserId: resolvedBy
      },
      tx
    );
  });

  return currentItem(row, action);
}

/** Reopens an action by forgetting its resolution. A no-op on an already-open action. */
export async function reopenHumanAction(
  deliveryId: string,
  actionId: string
): Promise<HumanActionItemDto> {
  const { row, action, workspaceUserId } = await requireDeliveryAction(deliveryId, actionId);
  const db = requireDatabaseClient();
  const resolutionIds = [action.id, action.legacyId].filter(
    (candidate): candidate is string => candidate !== undefined
  );
  const existing = await db.get(
    `SELECT 1 FROM human_action_resolutions
      WHERE delivery_id = ? AND action_id IN (${placeholders(resolutionIds.length)})`,
    [row.delivery_id, ...resolutionIds]
  );
  if (existing) {
    const actor = await actorWorkspaceUserId(row.workspace_id, workspaceUserId);
    await db.transaction(async tx => {
      await tx.run(
        `DELETE FROM human_action_resolutions
          WHERE delivery_id = ? AND action_id IN (${placeholders(resolutionIds.length)})`,
        [row.delivery_id, ...resolutionIds]
      );
      await recordChange(
        {
          entityType: 'human_action_resolution',
          entityId: `${row.delivery_id}:${action.id}`,
          operation: 'delete',
          projectId: row.project_id,
          missionId: row.mission_id,
          objectiveId: row.objective_id,
          workspaceId: row.workspace_id,
          changedFields: ['status'],
          actorWorkspaceUserId: actor
        },
        tx
      );
    });
  }
  return currentItem(row, action);
}
