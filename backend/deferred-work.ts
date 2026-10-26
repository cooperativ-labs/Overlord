import type {
  DeferredWorkV1,
  DeliveryDeferredWorkItemDto,
  DeliveryReportPayloadV1,
  HumanActionResolutionDto,
  HumanActionResolutionOutcome,
  HumanActionResolutionStatus
} from '@overlord/contract';

import { sqlPlaceholders } from '../packages/core/service/util.ts';

import { requireDatabaseClient } from './db.ts';

/**
 * Addressing and resolution state for the deferred-work items of a delivery
 * (coo:971, coo:1045, contract v166). The delivery report is the only place an
 * item's text lives. Each item carries its stable `DeferredWorkV1.id`, which
 * the delivery card uses to record the operator's decision in
 * `human_action_resolutions`.
 */

export const RESOLUTION_STATUSES: ReadonlySet<string> = new Set(['done', 'dismissed']);
export const RESOLUTION_OUTCOMES: ReadonlySet<string> = new Set([
  'mission_created',
  'objective_added'
]);

export type DeferredWorkEntry = DeferredWorkV1;

export interface ResolutionRow {
  delivery_id: string;
  action_id: string;
  status: string;
  outcome: string | null;
  outcome_ref: string | null;
  resolved_at: string;
  resolved_by_workspace_user_id: string | null;
}

/** One entry per `presentation.deferredWork` item, in presentation order. */
export function deferredWorkEntries(report: DeliveryReportPayloadV1): DeferredWorkEntry[] {
  return report.presentation.deferredWork;
}

/** Resolutions of the given deliveries, keyed `<deliveryId>:<actionId>`. */
export async function loadResolutions(deliveryIds: string[]): Promise<Map<string, ResolutionRow>> {
  if (deliveryIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT delivery_id, action_id, status, outcome, outcome_ref, resolved_at,
            resolved_by_workspace_user_id
       FROM human_action_resolutions
      WHERE delivery_id IN (${sqlPlaceholders(deliveryIds.length)})`,
    deliveryIds
  )) as ResolutionRow[];
  return new Map(rows.map(row => [`${row.delivery_id}:${row.action_id}`, row]));
}

/** The resolution recorded under an entry's id. */
export function findResolution(
  resolutions: Map<string, ResolutionRow>,
  deliveryId: string,
  entry: { id: string }
): ResolutionRow | undefined {
  return resolutions.get(`${deliveryId}:${entry.id}`);
}

export function toResolution(row: ResolutionRow | undefined): HumanActionResolutionDto | null {
  if (!row || !RESOLUTION_STATUSES.has(row.status)) return null;
  return {
    status: row.status as HumanActionResolutionStatus,
    resolvedAt: row.resolved_at,
    resolvedByWorkspaceUserId: row.resolved_by_workspace_user_id,
    outcome:
      row.outcome && RESOLUTION_OUTCOMES.has(row.outcome)
        ? (row.outcome as HumanActionResolutionOutcome)
        : null,
    outcomeRef: row.outcome_ref ?? null
  };
}

/** The `DeliveryDeferredWorkItemDto` of one entry: the agent's fields verbatim plus its resolution. */
export function deferredWorkItemDto(
  entry: DeferredWorkEntry,
  row: ResolutionRow | undefined
): DeliveryDeferredWorkItemDto {
  return {
    actionId: entry.id,
    title: entry.title,
    change: entry.change,
    location: entry.location,
    doneWhen: entry.doneWhen,
    resolution: toResolution(row)
  };
}
