import { PERMISSIONS } from '@overlord/auth';
import type {
  HumanActionResolutionOutcome,
  HumanActionResolutionStatus,
  MissionItemDto,
  ResolveMissionItemBody
} from '@overlord/contract';
import { MISSION_ITEM_STATUS_REASON_MAX_LENGTH } from '@overlord/database';

import {
  closeMissionItem,
  getMissionItem,
  type MissionItem,
  type MissionItemWriteResult,
  restoreMissionItem
} from '../packages/core/service/mission-items.ts';
import { lockMissionObjectiveQueue } from '../packages/core/service/objective-queue.ts';

import {
  findActiveMembershipId,
  nowIso,
  requireDatabaseClient,
  resolveActiveProfileId,
  restChangeAttribution
} from './db.ts';
import { RESOLUTION_STATUSES, toResolverDto } from './deferred-work.ts';
import { ApiError } from './errors.ts';
import { requireMissionPermission } from './rbac.ts';

/**
 * A person's decisions on `mission_items` (coo:1260, contract v173): close an
 * item as `done` or `dismissed`, or restore it. The deferred-work resolution
 * routes of a delivery card and the item resolution routes both write through
 * here, so a decision made on either surface is the same row.
 */

/** The actor a person's decision is recorded under: the caller's membership in the workspace. */
async function personActor(workspaceId: string, fallback: string): Promise<string> {
  const profileId = await resolveActiveProfileId();
  if (!profileId) return fallback;
  return (await findActiveMembershipId(workspaceId, profileId)) ?? fallback;
}

function writeFailure(result: Extract<MissionItemWriteResult, { ok: false }>): ApiError {
  switch (result.problem) {
    case 'not_found':
    case 'other_mission':
    case 'forbidden':
    case 'restored_by_person':
      return new ApiError(404, 'Mission item not found');
    case 'superseded':
      return new ApiError(
        409,
        'A superseded item cannot be restored',
        undefined,
        'mission_item_superseded'
      );
    case 'not_open':
      return new ApiError(409, 'The item changed while this request ran. Reload it and try again.');
  }
}

export interface PersonCloseInput {
  itemId: string;
  workspaceId: string;
  /** The authorized membership; the decision is attributed to the caller's own membership when found. */
  workspaceUserId: string;
  status: HumanActionResolutionStatus;
  reason?: string | null;
  outcome?: HumanActionResolutionOutcome | null;
  outcomeRef?: string | null;
}

/** Closes an item as a person's decision and requests a fresh mission summary in the same transaction. */
export async function closeMissionItemAsPerson(input: PersonCloseInput): Promise<MissionItem> {
  const actor = await personActor(input.workspaceId, input.workspaceUserId);
  const now = nowIso();
  return requireDatabaseClient().transaction(async tx => {
    const item = await getMissionItem(tx, input.itemId);
    if (!item) throw new ApiError(404, 'Mission item not found');
    // Delivery locks the mission before summary/items; use that order here too.
    await lockMissionObjectiveQueue(tx, item.missionId);
    const result = await closeMissionItem(tx, {
      itemId: input.itemId,
      status: input.status,
      reason: input.reason ?? null,
      resolver: { kind: 'person', workspaceUserId: actor },
      outcome: input.outcome ?? null,
      outcomeRef: input.outcomeRef ?? null,
      attribution: await restChangeAttribution(input.workspaceId, tx, actor),
      now
    });
    if (!result.ok) throw writeFailure(result);
    return result.item;
  });
}

/**
 * Restores a closed item as a person. An open item is returned unchanged. A
 * superseded item answers 409 `mission_item_superseded`, or with
 * `supersededUnchanged` is returned unchanged (the delivery card's reopen,
 * which has always been a no-op on an unresolved item).
 */
export async function restoreMissionItemAsPerson({
  itemId,
  workspaceId,
  workspaceUserId,
  supersededUnchanged = false
}: {
  itemId: string;
  workspaceId: string;
  workspaceUserId: string;
  supersededUnchanged?: boolean;
}): Promise<MissionItem> {
  const actor = await personActor(workspaceId, workspaceUserId);
  const now = nowIso();
  return requireDatabaseClient().transaction(async tx => {
    const item = await getMissionItem(tx, itemId);
    if (!item) throw new ApiError(404, 'Mission item not found');
    await lockMissionObjectiveQueue(tx, item.missionId);
    const result = await restoreMissionItem(tx, {
      itemId,
      attribution: await restChangeAttribution(workspaceId, tx, actor),
      now
    });
    if (!result.ok) {
      if (supersededUnchanged && result.problem === 'superseded' && result.item) {
        return result.item;
      }
      throw writeFailure(result);
    }
    return result.item;
  });
}

export function toMissionItemDto(item: MissionItem): MissionItemDto {
  return {
    id: item.id,
    missionId: item.missionId,
    objectiveId: item.objectiveId,
    deliveryId: item.deliveryId,
    kind: item.kind,
    text: item.text,
    status: item.status,
    reason: item.statusReason,
    resolvedBy: item.resolvedBy ? toResolverDto(item.resolvedBy, item.missionId) : null,
    resolvedAt: item.resolvedAt,
    outcome: item.outcome,
    outcomeRef: item.outcome === null ? null : item.outcomeRef,
    reportedAt: item.reportedAt,
    revision: item.revision
  };
}

/**
 * Loads an item a person may change: it exists, its delivery is live, and the
 * caller holds `mission:update` on its mission (a project token only within
 * its projects). Every refusal short of a permission denial answers 404.
 */
async function requireWritableItem(
  itemId: string
): Promise<{ item: MissionItem; workspaceId: string; workspaceUserId: string }> {
  const db = requireDatabaseClient();
  const item = typeof itemId === 'string' && itemId ? await getMissionItem(db, itemId) : null;
  const liveDelivery =
    item &&
    (await db.get(`SELECT 1 FROM deliveries WHERE id = ? AND deleted_at IS NULL`, [
      item.deliveryId
    ]));
  if (!item || !liveDelivery) throw new ApiError(404, 'Mission item not found');
  try {
    const scope = await requireMissionPermission({
      missionRef: item.missionId,
      permission: PERMISSIONS.MISSION_UPDATE,
      db
    });
    return { item, workspaceId: scope.workspaceId, workspaceUserId: scope.workspaceUserId };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(404, 'Mission item not found');
    }
    throw error;
  }
}

function parseItemResolution(body: unknown): {
  status: HumanActionResolutionStatus;
  reason: string | null;
} {
  const input = body && typeof body === 'object' ? (body as Partial<ResolveMissionItemBody>) : {};
  const { status, reason } = input;
  if (typeof status !== 'string' || !RESOLUTION_STATUSES.has(status)) {
    throw new ApiError(400, "status must be 'done' or 'dismissed'");
  }
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw new ApiError(400, 'reason must be a string');
  }
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length > MISSION_ITEM_STATUS_REASON_MAX_LENGTH) {
    throw new ApiError(
      400,
      `reason must be at most ${MISSION_ITEM_STATUS_REASON_MAX_LENGTH} characters`
    );
  }
  return { status: status as HumanActionResolutionStatus, reason: trimmed || null };
}

/** `PUT /api/mission-items/:id/resolution`: a person closes any item. */
export async function resolveMissionItem(itemId: string, body: unknown): Promise<MissionItemDto> {
  const { status, reason } = parseItemResolution(body);
  const { item, workspaceId, workspaceUserId } = await requireWritableItem(itemId);
  return toMissionItemDto(
    await closeMissionItemAsPerson({
      itemId: item.id,
      workspaceId,
      workspaceUserId,
      status,
      reason
    })
  );
}

/** `DELETE /api/mission-items/:id/resolution`: a person restores a closed item. */
export async function restoreMissionItemResolution(itemId: string): Promise<MissionItemDto> {
  const { item, workspaceId, workspaceUserId } = await requireWritableItem(itemId);
  return toMissionItemDto(
    await restoreMissionItemAsPerson({ itemId: item.id, workspaceId, workspaceUserId })
  );
}
