import type {
  DeferredWorkV1,
  DeliveryDeferredWorkItemDto,
  DeliveryReportPayloadV1,
  HumanActionResolutionDto,
  HumanActionResolutionStatus,
  MissionItemResolverDto
} from '@overlord/contract';

import {
  listDeliveryMissionItems,
  type MissionItem,
  type MissionItemResolver
} from '../packages/core/service/mission-items.ts';

import { requireDatabaseClient } from './db.ts';

/**
 * Addressing and resolution state for the deferred-work items of a delivery
 * (coo:971, coo:1045, contract v166; storage v173). The delivery report is the
 * record of what the agent reported; each item carries its stable
 * `DeferredWorkV1.id`, which is the `item_ref` of its `mission_items`
 * suggestion row. The row's status is the item's resolution, whether a person
 * or an agent closed it.
 */

export const RESOLUTION_STATUSES: ReadonlySet<string> = new Set(['done', 'dismissed']);
export const RESOLUTION_OUTCOMES: ReadonlySet<string> = new Set([
  'mission_created',
  'objective_added'
]);

export type DeferredWorkEntry = DeferredWorkV1;

/** One entry per `presentation.deferredWork` item, in presentation order. */
export function deferredWorkEntries(report: DeliveryReportPayloadV1): DeferredWorkEntry[] {
  return report.presentation.deferredWork;
}

/** The suggestion rows of the given deliveries, keyed `<deliveryId>:<actionId>`. */
export async function loadResolutions(deliveryIds: string[]): Promise<Map<string, MissionItem>> {
  const items = await listDeliveryMissionItems(requireDatabaseClient(), {
    deliveryIds,
    kinds: ['suggestion']
  });
  return new Map(items.map(item => [`${item.deliveryId}:${item.itemRef}`, item]));
}

/** The suggestion row stored under an entry's id. */
export function findResolution(
  resolutions: Map<string, MissionItem>,
  deliveryId: string,
  entry: { id: string }
): MissionItem | undefined {
  return resolutions.get(`${deliveryId}:${entry.id}`);
}

export function toResolverDto(resolver: MissionItemResolver): MissionItemResolverDto {
  return resolver.kind === 'person'
    ? {
        kind: 'person',
        workspaceUserId: resolver.workspaceUserId,
        objectiveId: null,
        deliveryId: null
      }
    : {
        kind: 'agent',
        workspaceUserId: null,
        objectiveId: resolver.objectiveId,
        deliveryId: resolver.deliveryId
      };
}

/**
 * The resolution of a suggestion row: set for `done` and `dismissed`, null for
 * an `open` or `superseded` row (a superseded suggestion is shown unresolved on
 * its delivery card, as before the table existed).
 */
export function toResolution(item: MissionItem | undefined): HumanActionResolutionDto | null {
  if (!item || !RESOLUTION_STATUSES.has(item.status) || !item.resolvedAt) return null;
  const resolvedBy: MissionItemResolver = item.resolvedBy ?? {
    kind: 'person',
    workspaceUserId: null
  };
  return {
    status: item.status as HumanActionResolutionStatus,
    resolvedAt: item.resolvedAt,
    resolvedByWorkspaceUserId: resolvedBy.kind === 'person' ? resolvedBy.workspaceUserId : null,
    outcome: item.outcome,
    outcomeRef: item.outcome === null ? null : item.outcomeRef,
    reason: item.statusReason,
    resolvedBy: toResolverDto(resolvedBy)
  };
}

/** The `DeliveryDeferredWorkItemDto` of one entry: the agent's fields verbatim plus its resolution. */
export function deferredWorkItemDto(
  entry: DeferredWorkEntry,
  item: MissionItem | undefined
): DeliveryDeferredWorkItemDto {
  return {
    actionId: entry.id,
    title: entry.title,
    change: entry.change,
    location: entry.location,
    doneWhen: entry.doneWhen,
    resolution: toResolution(item)
  };
}
