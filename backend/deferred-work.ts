import { createHash } from 'node:crypto';

import { matchDeferredWorkAgentIndex } from '../packages/core/service/delivery-compose.ts';
import type {
  DeliveryReportPayloadV1,
  HumanActionResolutionDto,
  HumanActionResolutionOutcome,
  HumanActionResolutionStatus
} from '../webapp/shared/contract.ts';

import { requireDatabaseClient } from './db.ts';

/**
 * Stable addressing and resolution state for the deferred-work items of a
 * delivery (coo:971, coo:1045). The delivery report is the only place an item's
 * text lives; this module derives the id every surface (Feed rail, delivery
 * card) uses to record the operator's decision in `human_action_resolutions`.
 */

export const RESOLUTION_STATUSES: ReadonlySet<string> = new Set(['done', 'dismissed']);
export const RESOLUTION_OUTCOMES: ReadonlySet<string> = new Set([
  'mission_created',
  'objective_added'
]);

export interface DeferredWorkEntry {
  id: string;
  /**
   * The pre-composition deferred-work id. It remains readable during the
   * identifier migration, but mutation paths always write `id`.
   */
  legacyId: string;
  action: string;
}

export interface ResolutionRow {
  delivery_id: string;
  action_id: string;
  status: string;
  outcome: string | null;
  outcome_ref: string | null;
  resolved_at: string;
  resolved_by_workspace_user_id: string | null;
}

function legacyDeferredWorkId(text: string, occurrence: number): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  return `deferred-work-${digest}-${occurrence}`;
}

function agentDeferredWorkId(index: number, agentText: string | undefined): string {
  if (!agentText) return `deferred-work-${index}-composed`;
  const digest = createHash('sha256').update(agentText).digest('hex').slice(0, 16);
  return `deferred-work-${index}-${digest}`;
}

/** One entry per `presentation.deferredWork` item, in presentation order. */
export function deferredWorkEntries(report: DeliveryReportPayloadV1): DeferredWorkEntry[] {
  const { presentation, agentReport } = report;
  const occurrences = new Map<string, number>();
  const usedAgentIndexes = new Set<number>();
  return presentation.deferredWork.map((action, index) => {
    const occurrence = (occurrences.get(action) ?? 0) + 1;
    occurrences.set(action, occurrence);
    const agentIndex = matchDeferredWorkAgentIndex({
      presentationItem: action,
      agentItems: agentReport.deferredWork,
      usedIndexes: usedAgentIndexes
    });
    if (agentIndex !== null) usedAgentIndexes.add(agentIndex);
    return {
      id:
        agentIndex === null
          ? agentDeferredWorkId(index, undefined)
          : agentDeferredWorkId(agentIndex, agentReport.deferredWork[agentIndex]),
      legacyId: legacyDeferredWorkId(action, occurrence),
      action
    };
  });
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** Resolutions of the given deliveries, keyed `<deliveryId>:<actionId>`. */
export async function loadResolutions(deliveryIds: string[]): Promise<Map<string, ResolutionRow>> {
  if (deliveryIds.length === 0) return new Map();
  const rows = (await requireDatabaseClient().all(
    `SELECT delivery_id, action_id, status, outcome, outcome_ref, resolved_at,
            resolved_by_workspace_user_id
       FROM human_action_resolutions
      WHERE delivery_id IN (${placeholders(deliveryIds.length)})`,
    deliveryIds
  )) as ResolutionRow[];
  return new Map(rows.map(row => [`${row.delivery_id}:${row.action_id}`, row]));
}

/** The resolution recorded under an entry's id, falling back to its legacy id. */
export function findResolution(
  resolutions: Map<string, ResolutionRow>,
  deliveryId: string,
  entry: { id: string; legacyId?: string }
): ResolutionRow | undefined {
  return (
    resolutions.get(`${deliveryId}:${entry.id}`) ??
    (entry.legacyId ? resolutions.get(`${deliveryId}:${entry.legacyId}`) : undefined)
  );
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
