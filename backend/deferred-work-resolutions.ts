import { PERMISSIONS } from '@overlord/auth';
import type {
  DeliveryDeferredWorkItemDto,
  HumanActionResolutionOutcome,
  HumanActionResolutionStatus,
  ResolveHumanActionBody
} from '@overlord/contract';

import {
  listDeliveryMissionItems,
  type MissionItem
} from '../packages/core/service/mission-items.ts';

import { requireDatabaseClient } from './db.ts';
import {
  deferredWorkEntries,
  type DeferredWorkEntry,
  deferredWorkItemDto,
  RESOLUTION_OUTCOMES,
  RESOLUTION_STATUSES
} from './deferred-work.ts';
import { ApiError } from './errors.ts';
import {
  closeMissionItemAsPerson,
  restoreMissionItemAsPerson
} from './mission-item-resolutions.ts';
import { requireWorkspacePermission } from './rbac.ts';
import { deliveryReportFromPayload } from './repository.ts';

/**
 * Operator decisions on the deferred-work items of a delivery (coo:971,
 * coo:1045; storage contract v173). Each item is the `mission_items` suggestion
 * row whose `item_ref` is its `DeferredWorkV1.id`; a decision closes or
 * restores that row through the same person-resolution path as
 * `/api/mission-items/:id/resolution`, and the refreshed
 * `DeliveryDeferredWorkItemDto` the delivery card renders is returned.
 */

/** Bound on the display id a promotion records; real display ids are far shorter. */
const OUTCOME_REF_MAX_LENGTH = 64;

interface DeliveryRow {
  delivery_id: string;
  delivery_summary: string;
  payload_json: string | null;
  workspace_id: string;
}

async function loadDelivery(deliveryId: string): Promise<DeliveryRow | undefined> {
  return (await requireDatabaseClient().get(
    `SELECT d.id AS delivery_id, d.summary AS delivery_summary, d.payload_json, d.workspace_id
       FROM deliveries d
      WHERE d.id = ? AND d.deleted_at IS NULL`,
    [deliveryId]
  )) as DeliveryRow | undefined;
}

async function suggestionItem(
  deliveryId: string,
  actionId: string
): Promise<MissionItem | undefined> {
  const items = await listDeliveryMissionItems(requireDatabaseClient(), {
    deliveryIds: [deliveryId],
    kinds: ['suggestion']
  });
  return items.find(item => item.itemRef === actionId);
}

async function requireDeferredWorkEntry(
  deliveryId: string,
  actionId: string
): Promise<{
  row: DeliveryRow;
  entry: DeferredWorkEntry;
  item: MissionItem;
  workspaceUserId: string;
}> {
  const row = await loadDelivery(deliveryId);
  if (!row) throw new ApiError(404, 'Delivery not found');
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: row.workspace_id,
    permission: PERMISSIONS.MISSION_UPDATE,
    notFoundMessage: 'Delivery not found'
  });
  const report = deliveryReportFromPayload(row.payload_json, row.delivery_summary);
  const entry = deferredWorkEntries(report).find(candidate => candidate.id === actionId);
  const item = entry ? await suggestionItem(row.delivery_id, entry.id) : undefined;
  if (!entry || !item) throw new ApiError(404, 'Deferred work item not found');
  return { row, entry, item, workspaceUserId };
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
  const { row, entry, item, workspaceUserId } = await requireDeferredWorkEntry(
    deliveryId,
    actionId
  );
  const closed = await closeMissionItemAsPerson({
    itemId: item.id,
    workspaceId: row.workspace_id,
    workspaceUserId,
    status,
    outcome,
    outcomeRef
  });
  return deferredWorkItemDto(entry, closed);
}

/** Reopens a deferred-work item by restoring its row. A no-op on an unresolved item. */
export async function reopenDeferredWork(
  deliveryId: string,
  actionId: string
): Promise<DeliveryDeferredWorkItemDto> {
  const { row, entry, item, workspaceUserId } = await requireDeferredWorkEntry(
    deliveryId,
    actionId
  );
  const restored = await restoreMissionItemAsPerson({
    itemId: item.id,
    workspaceId: row.workspace_id,
    workspaceUserId,
    supersededUnchanged: true
  });
  return deferredWorkItemDto(entry, restored);
}
