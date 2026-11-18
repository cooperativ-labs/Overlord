import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { readDeliveryReport } from './delivery-report.js';
import { listMissionItems, type MissionItem } from './mission-items.js';

/**
 * Retained mission summary evidence helpers (coo:1202; ADR 0076 removed the
 * automatic narrative composer and kept these): the narrative and display
 * limits, the current-run delivery rule, and the database readers used by the
 * operator summary read and the agent baseline. Deliveries are selected in the
 * database by current-run eligibility before any limit, then split in memory
 * by {@link splitMissionSummaryRuns}, for source history only. Item
 * supersession is stored by the item service.
 */

/** Agent narrative bounds and operator display caps. */
export const MISSION_SUMMARY_LIMITS = {
  headline: 140,
  summary: 1_200,
  risks: 8,
  suggestions: 50
} as const;

export interface MissionSummaryObjectiveEvidence {
  id: string;
  reopenedAt: string | null;
}

export interface MissionSummaryDeliveryEvidence {
  id: string;
  objectiveId: string;
  deliveredAt: string;
  summary: string;
  report: DeliveryReportPayloadV1;
}

export interface MissionSummaryRuns {
  /** Every current-run delivery, newest first. */
  currentRun: MissionSummaryDeliveryEvidence[];
  /** The latest current-run delivery of each objective, newest first. */
  latestByObjective: MissionSummaryDeliveryEvidence[];
  /** Deliveries that contribute nothing: before a reopen, or replaced by a newer one. */
  superseded: MissionSummaryDeliveryEvidence[];
}

function newestFirst(
  left: MissionSummaryDeliveryEvidence,
  right: MissionSummaryDeliveryEvidence
): number {
  const byTime = Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt);
  if (byTime !== 0) return byTime;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

/**
 * SQL form of the reopenedAt rule, for selecting current-run deliveries in the
 * database before any limit. `delivery` and `objective` are the aliases of
 * `deliveries` and its LEFT JOINed objective; they are interpolated verbatim
 * and must be trusted identifiers. A delivery whose objective row is gone has
 * no boundary. {@link splitMissionSummaryRuns} applies the same rule in memory.
 */
export function currentRunDeliveryPredicateSql(delivery = 'd', objective = 'o'): string {
  return `(${objective}.reopened_at IS NULL OR ${delivery}.delivered_at >= ${objective}.reopened_at)`;
}

/** Splits deliveries into current-run and superseded per the reopenedAt rule. */
export function splitMissionSummaryRuns({
  objectives,
  deliveries
}: {
  objectives: MissionSummaryObjectiveEvidence[];
  deliveries: MissionSummaryDeliveryEvidence[];
}): MissionSummaryRuns {
  const reopenedAt = new Map(objectives.map(objective => [objective.id, objective.reopenedAt]));
  const sorted = [...deliveries].sort(newestFirst);
  const currentRun: MissionSummaryDeliveryEvidence[] = [];
  const latestByObjective: MissionSummaryDeliveryEvidence[] = [];
  const superseded: MissionSummaryDeliveryEvidence[] = [];
  const seenObjectives = new Set<string>();
  for (const delivery of sorted) {
    const boundary = reopenedAt.get(delivery.objectiveId) ?? null;
    if (boundary !== null && Date.parse(delivery.deliveredAt) < Date.parse(boundary)) {
      superseded.push(delivery);
      continue;
    }
    currentRun.push(delivery);
    if (seenObjectives.has(delivery.objectiveId)) {
      superseded.push(delivery);
    } else {
      seenObjectives.add(delivery.objectiveId);
      latestByObjective.push(delivery);
    }
  }
  return { currentRun, latestByObjective, superseded };
}

type ObjectiveRow = { id: string; reopened_at: string | null };

/** Every objective of the mission, deleted ones included: they keep their run boundary. */
function readObjectiveRows(db: DatabaseClient, missionId: string): Promise<ObjectiveRow[]> {
  return db.all<ObjectiveRow>(`SELECT id, reopened_at FROM objectives WHERE mission_id = ?`, [
    missionId
  ]);
}

function reportFromPayload(payloadJson: string | null, summary: string) {
  let deliveryReport: unknown;
  try {
    deliveryReport = payloadJson
      ? (JSON.parse(payloadJson) as { deliveryReport?: unknown }).deliveryReport
      : undefined;
  } catch {
    deliveryReport = undefined;
  }
  return readDeliveryReport({ summary, deliveryReport });
}

async function readRuns(
  db: DatabaseClient,
  missionId: string,
  objectives: MissionSummaryObjectiveEvidence[],
  workspaceId: string | undefined
): Promise<MissionSummaryRuns> {
  const workspaceGuard = workspaceId === undefined ? '' : ' AND d.workspace_id = ?';
  const deliveryRows = await db.all<{
    id: string;
    objective_id: string;
    delivered_at: string;
    summary: string;
    payload_json: string | null;
  }>(
    `SELECT d.id, d.objective_id, d.delivered_at, d.summary, d.payload_json
       FROM deliveries d
       LEFT JOIN objectives o ON o.id = d.objective_id
      WHERE d.mission_id = ?${workspaceGuard} AND d.deleted_at IS NULL
        AND ${currentRunDeliveryPredicateSql()}
      ORDER BY d.delivered_at DESC, d.id DESC`,
    workspaceId === undefined ? [missionId] : [missionId, workspaceId]
  );
  const deliveries: MissionSummaryDeliveryEvidence[] = deliveryRows.map(row => ({
    id: row.id,
    objectiveId: row.objective_id,
    deliveredAt: row.delivered_at,
    summary: row.summary,
    report: reportFromPayload(row.payload_json, row.summary)
  }));
  return splitMissionSummaryRuns({ objectives, deliveries });
}

/**
 * Every current-run delivery of the mission, split into runs. `workspaceId`
 * additionally scopes deliveries to one workspace. Authorization is the
 * caller's.
 */
export async function readMissionSummaryRuns(
  db: DatabaseClient,
  missionId: string,
  { workspaceId }: { workspaceId?: string } = {}
): Promise<MissionSummaryRuns> {
  const objectives = (await readObjectiveRows(db, missionId)).map(row => ({
    id: row.id,
    reopenedAt: row.reopened_at
  }));
  return readRuns(db, missionId, objectives, workspaceId);
}

/** Read every open item before display dedupe and caps, so a busy delivery cannot hide others. */
export async function readMissionSummaryOpenItems(
  db: DatabaseClient,
  missionId: string,
  workspaceId?: string
): Promise<MissionItem[]> {
  const items: MissionItem[] = [];
  for (;;) {
    const page = await listMissionItems(db, {
      missionId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      limit: 1_000,
      offset: items.length
    });
    items.push(...page.items);
    if (!page.truncated) return items;
  }
}
