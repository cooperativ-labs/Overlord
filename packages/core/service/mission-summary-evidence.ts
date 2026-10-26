import { formatObjectiveDisplayId } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import { readDeliveryReport } from './delivery-report.js';
import {
  currentRunDeliveryPredicateSql,
  type MissionSummaryDeliveryEvidence,
  type MissionSummaryObjectiveEvidence,
  type MissionSummaryQuestionEvidence,
  type MissionSummaryRuns,
  splitMissionSummaryRuns
} from './mission-summary-compose.js';
import { readMissionSummaryGeneration } from './worker-jobs.js';

/**
 * Database half of the mission summary (coo:1202): the one reader of
 * current-run delivery evidence, shared by the compose worker and the
 * operator read route. Deliveries are selected in the database by current-run
 * eligibility before any limit (plan §4.4a), then split in memory by
 * {@link splitMissionSummaryRuns}, which stays the authority on supersession.
 */

/** Evidence for one compose pass, read together with the generation it serves. */
export type MissionSummaryEvidence = {
  generation: number;
  sourceDeliveryId: string | null;
  previous: { headline: string; summary: string } | null;
  mission: { title: string; statusType: string; displayId: string };
  objectives: MissionSummaryObjectiveEvidence[];
  runs: MissionSummaryRuns;
  openQuestions: MissionSummaryQuestionEvidence[];
  resolutionStatus: Map<string, string>;
  counts: { deliveries: number; filePaths: number };
};

type ObjectiveRow = {
  id: string;
  display_key: string;
  title: string | null;
  state: string;
  reopened_at: string | null;
  deleted_at: string | null;
};

/** Every objective of the mission, deleted ones included: they keep their run boundary. */
function readObjectiveRows(db: DatabaseClient, missionId: string): Promise<ObjectiveRow[]> {
  return db.all<ObjectiveRow>(
    `SELECT id, display_key, title, state, reopened_at, deleted_at
       FROM objectives WHERE mission_id = ?`,
    [missionId]
  );
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
  objectives: Array<Pick<MissionSummaryObjectiveEvidence, 'id' | 'reopenedAt'>>,
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

/**
 * Loads the evidence for one compose pass in a single transaction, so the
 * generation and the evidence form one consistent snapshot: every current-run
 * delivery of the mission, whose count is bounded by the run boundaries
 * rather than by a presentation page.
 */
export async function readMissionSummaryEvidence(
  db: DatabaseClient,
  missionId: string,
  { workspaceId }: { workspaceId?: string } = {}
): Promise<MissionSummaryEvidence | null> {
  return db.transaction(async tx => {
    const generation = await readMissionSummaryGeneration(tx, missionId);
    if (!generation) return null;
    const mission = await tx.get<{
      title: string;
      status_type: string;
      display_id: string;
      summary_enabled: unknown;
    }>(
      `SELECT title, status_type, display_id, summary_enabled FROM missions
        WHERE id = ? AND deleted_at IS NULL`,
      [missionId]
    );
    if (!mission) return null;

    const objectives: MissionSummaryObjectiveEvidence[] = (
      await readObjectiveRows(tx, missionId)
    ).map(row => ({
      id: row.id,
      key: formatObjectiveDisplayId({
        missionDisplayId: mission.display_id,
        displayKey: row.display_key
      }),
      title: row.title?.trim() || 'Untitled objective',
      state: row.state,
      reopenedAt: row.reopened_at,
      deleted: row.deleted_at !== null
    }));
    const runs = await readRuns(tx, missionId, objectives, workspaceId);

    const resolutionRows =
      runs.currentRun.length === 0
        ? []
        : await tx.all<{ delivery_id: string; action_id: string; status: string }>(
            `SELECT delivery_id, action_id, status FROM human_action_resolutions
              WHERE mission_id = ?`,
            [missionId]
          );
    const resolutionStatus = new Map(
      resolutionRows.map(row => [`${row.delivery_id}:${row.action_id}`, row.status])
    );

    const questionRows = await tx.all<{
      id: string;
      objective_id: string | null;
      summary: string;
      created_at: string;
    }>(
      `SELECT id, objective_id, summary, created_at FROM agent_requests
        WHERE mission_id = ? AND deleted_at IS NULL AND status = 'open'
          AND kind IN ('question', 'choice')
        ORDER BY created_at DESC
        LIMIT 20`,
      [missionId]
    );

    const filePathCount = await tx.get<{ total: number | string }>(
      `SELECT COUNT(DISTINCT file_path) AS total FROM changed_files
        WHERE mission_id = ? AND deleted_at IS NULL`,
      [missionId]
    );

    return {
      generation: generation.requestedGeneration,
      sourceDeliveryId: generation.sourceDeliveryId,
      previous: generation.previous,
      mission: {
        title: mission.title,
        statusType: mission.status_type,
        displayId: mission.display_id
      },
      objectives,
      runs,
      openQuestions: questionRows.map(row => ({
        requestId: row.id,
        objectiveId: row.objective_id,
        prompt: row.summary,
        createdAt: row.created_at
      })),
      resolutionStatus,
      counts: {
        deliveries: runs.currentRun.length,
        filePaths: Number(filePathCount?.total ?? 0)
      }
    };
  });
}
