import { PERMISSIONS } from '@overlord/auth';

import { enqueueMissionSummaryComposeJob } from '../packages/core/service/worker-jobs.ts';
import type {
  DeliveryDeferredWorkItemDto,
  HumanActionResolutionOutcome,
  HumanActionResolutionStatus,
  ResolveHumanActionBody
} from '../webapp/shared/contract.ts';

import {
  findActiveMembershipId,
  nowIso,
  recordChange,
  requireDatabaseClient,
  resolveActiveProfileId,
  restMissionSummaryTriggerContext
} from './db.ts';
import {
  deferredWorkEntries,
  type DeferredWorkEntry,
  deferredWorkItemDto,
  findResolution,
  loadResolutions,
  RESOLUTION_OUTCOMES,
  RESOLUTION_STATUSES
} from './deferred-work.ts';
import { ApiError } from './errors.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { deliveryReportFromPayload } from './repository.ts';

/**
 * Operator decisions on the deferred-work items of a delivery (coo:971,
 * coo:1045). The delivery report is the only place an item's text lives; this
 * module records the operator's decision per item in `human_action_resolutions`
 * and returns the refreshed `DeliveryDeferredWorkItemDto` the delivery card
 * renders.
 */

/** Bound on the display id a promotion records; real display ids are far shorter. */
const OUTCOME_REF_MAX_LENGTH = 64;

interface DeliveryRow {
  delivery_id: string;
  delivery_summary: string;
  payload_json: string | null;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
}

async function loadDelivery(deliveryId: string): Promise<DeliveryRow | undefined> {
  return (await requireDatabaseClient().get(
    `SELECT d.id AS delivery_id, d.summary AS delivery_summary, d.payload_json,
            d.workspace_id, d.project_id, d.mission_id, d.objective_id
       FROM deliveries d
      WHERE d.id = ? AND d.deleted_at IS NULL`,
    [deliveryId]
  )) as DeliveryRow | undefined;
}

async function requireDeferredWorkEntry(
  deliveryId: string,
  actionId: string
): Promise<{ row: DeliveryRow; entry: DeferredWorkEntry; workspaceUserId: string }> {
  const row = await loadDelivery(deliveryId);
  if (!row) throw new ApiError(404, 'Delivery not found');
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission: PERMISSIONS.MISSION_UPDATE,
    notFoundMessage: 'Delivery not found'
  });
  const report = deliveryReportFromPayload(row.payload_json, row.delivery_summary);
  const entry = deferredWorkEntries(report).find(candidate => candidate.id === actionId);
  if (!entry) throw new ApiError(404, 'Deferred work item not found');
  return { row, entry, workspaceUserId };
}

async function currentItem(
  row: DeliveryRow,
  entry: DeferredWorkEntry
): Promise<DeliveryDeferredWorkItemDto> {
  const resolutions = await loadResolutions([row.delivery_id]);
  return deferredWorkItemDto(entry, findResolution(resolutions, row.delivery_id, entry));
}

async function actorWorkspaceUserId(workspaceId: string, fallback: string): Promise<string> {
  const profileId = await resolveActiveProfileId();
  if (!profileId) return fallback;
  return (await findActiveMembershipId(workspaceId, profileId)) ?? fallback;
}

interface ParsedResolution {
  status: HumanActionResolutionStatus;
  outcome: HumanActionResolutionOutcome | null;
  outcomeRef: string | null;
}

function parseResolution(body: unknown): ParsedResolution {
  const input = body && typeof body === 'object' ? (body as Partial<ResolveHumanActionBody>) : {};
  const { status, outcome, outcomeRef } = input;
  if (typeof status !== 'string' || !RESOLUTION_STATUSES.has(status)) {
    throw new ApiError(400, "status must be 'done' or 'dismissed'");
  }
  if (outcome !== undefined && (typeof outcome !== 'string' || !RESOLUTION_OUTCOMES.has(outcome))) {
    throw new ApiError(400, "outcome must be 'mission_created' or 'objective_added'");
  }
  if (outcome !== undefined && status !== 'done') {
    throw new ApiError(400, "outcome requires status 'done'");
  }
  if (outcomeRef !== undefined) {
    if (outcome === undefined) throw new ApiError(400, 'outcomeRef requires outcome');
    if (
      typeof outcomeRef !== 'string' ||
      !outcomeRef.trim() ||
      outcomeRef.length > OUTCOME_REF_MAX_LENGTH
    ) {
      throw new ApiError(400, 'outcomeRef must be a non-empty display id');
    }
  }
  return {
    status: status as HumanActionResolutionStatus,
    outcome: (outcome as HumanActionResolutionOutcome | undefined) ?? null,
    outcomeRef: outcomeRef?.trim() ?? null
  };
}

/** Records the operator's decision on one deferred-work item. Re-resolving overwrites the earlier decision. */
export async function resolveDeferredWork(
  deliveryId: string,
  actionId: string,
  body: unknown
): Promise<DeliveryDeferredWorkItemDto> {
  const { status, outcome, outcomeRef } = parseResolution(body);
  const { row, entry, workspaceUserId } = await requireDeferredWorkEntry(deliveryId, actionId);
  const db = requireDatabaseClient();
  const resolvedBy = await actorWorkspaceUserId(row.workspace_id, workspaceUserId);
  const now = nowIso();

  await db.transaction(async tx => {
    await tx.run(
      `INSERT INTO human_action_resolutions
         (delivery_id, action_id, workspace_id, mission_id, objective_id, status,
          outcome, outcome_ref, resolved_by_workspace_user_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (delivery_id, action_id) DO UPDATE SET
         status = excluded.status,
         outcome = excluded.outcome,
         outcome_ref = excluded.outcome_ref,
         resolved_by_workspace_user_id = excluded.resolved_by_workspace_user_id,
         resolved_at = excluded.resolved_at`,
      [
        row.delivery_id,
        entry.id,
        row.workspace_id,
        row.mission_id,
        row.objective_id,
        status,
        outcome,
        outcomeRef,
        resolvedBy,
        now
      ]
    );
    await recordChange(
      {
        entityType: 'human_action_resolution',
        entityId: `${row.delivery_id}:${entry.id}`,
        operation: 'update',
        projectId: row.project_id,
        missionId: row.mission_id,
        objectiveId: row.objective_id,
        workspaceId: row.workspace_id,
        changedFields: outcome === null ? ['status'] : ['status', 'outcome', 'outcome_ref'],
        actorWorkspaceUserId: resolvedBy
      },
      tx
    );
    await enqueueMissionSummaryComposeJob({
      ctx: restMissionSummaryTriggerContext(tx, row.workspace_id, resolvedBy),
      missionId: row.mission_id,
      reason: 'deferred_work_resolved',
      now
    });
  });

  return currentItem(row, entry);
}

/** Reopens a deferred-work item by forgetting its resolution. A no-op on an already-open item. */
export async function reopenDeferredWork(
  deliveryId: string,
  actionId: string
): Promise<DeliveryDeferredWorkItemDto> {
  const { row, entry, workspaceUserId } = await requireDeferredWorkEntry(deliveryId, actionId);
  const db = requireDatabaseClient();
  const existing = await db.get(
    `SELECT 1 FROM human_action_resolutions WHERE delivery_id = ? AND action_id = ?`,
    [row.delivery_id, entry.id]
  );
  if (existing) {
    const actor = await actorWorkspaceUserId(row.workspace_id, workspaceUserId);
    await db.transaction(async tx => {
      await tx.run(`DELETE FROM human_action_resolutions WHERE delivery_id = ? AND action_id = ?`, [
        row.delivery_id,
        entry.id
      ]);
      await recordChange(
        {
          entityType: 'human_action_resolution',
          entityId: `${row.delivery_id}:${entry.id}`,
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
      await enqueueMissionSummaryComposeJob({
        ctx: restMissionSummaryTriggerContext(tx, row.workspace_id, actor),
        missionId: row.mission_id,
        reason: 'deferred_work_reopened'
      });
    });
  }
  return currentItem(row, entry);
}
