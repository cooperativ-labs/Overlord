import type { DeliveryReportPayloadV1 } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import type { Selectable } from 'kysely';

import type { Deliveries } from '../types/db.js';

import { type EntityChangeFields, insertEntityChange } from './change-feed.js';
import type { DeferredWorkObjectiveRef } from './delivery-compose.js';
import { reconcileDeliveryMissionItems } from './mission-items.js';
import { lockMissionObjectiveQueue } from './objective-queue.js';
import { nowIso } from './util.js';

type DeliveryRow = Pick<
  Selectable<Deliveries>,
  | 'workspace_id'
  | 'project_id'
  | 'mission_id'
  | 'objective_id'
  | 'summary'
  | 'verification_summary'
  | 'follow_up_notes'
  | 'payload_json'
  | 'revision'
> & { id: string; delivered_at: string };

export type DeliveryComposeContext = {
  delivery: DeliveryRow;
  report: DeliveryReportPayloadV1;
  filePaths: string[];
  objective: DeferredWorkObjectiveRef;
  plannedObjectives: DeferredWorkObjectiveRef[];
  recentEvents: Array<{ type: string; summary: string }>;
};

/** Loads the persisted report and the bounded evidence used to compose it. */
export async function readDeliveryComposeContext(
  db: DatabaseClient,
  deliveryId: string
): Promise<DeliveryComposeContext | null> {
  const delivery = await db.get<DeliveryRow>(
    `SELECT id, workspace_id, project_id, mission_id, objective_id, summary,
            verification_summary, follow_up_notes, payload_json, revision, delivered_at
       FROM deliveries
      WHERE id = ? AND deleted_at IS NULL`,
    [deliveryId]
  );
  if (!delivery) return null;

  let report: DeliveryReportPayloadV1 | null = null;
  try {
    const payload = JSON.parse(delivery.payload_json) as {
      deliveryReport?: DeliveryReportPayloadV1;
    };
    if (payload.deliveryReport?.schemaVersion === 1 && payload.deliveryReport.agentReport) {
      report = payload.deliveryReport;
    }
  } catch {
    report = null;
  }
  if (!report) return null;

  const filePathRows = await db.all<{ file_path: string }>(
    `SELECT file_path FROM changed_files
      WHERE objective_id = ? AND deleted_at IS NULL
      ORDER BY last_observed_at DESC, id DESC
      LIMIT 40`,
    [delivery.objective_id]
  );
  const objective = await db.get<{ title: string | null; instruction_text: string | null }>(
    'SELECT title, instruction_text FROM objectives WHERE id = ?',
    [delivery.objective_id]
  );
  const siblingObjectives = await db.all<{
    title: string | null;
    instruction_text: string | null;
    state: string;
  }>(
    `SELECT title, instruction_text, state
       FROM objectives
      WHERE mission_id = ? AND id != ? AND deleted_at IS NULL`,
    [delivery.mission_id, delivery.objective_id]
  );
  const recentEvents = await db.all<{ type: string; summary: string }>(
    `SELECT type, summary FROM mission_events
      WHERE objective_id = ?
      ORDER BY created_at DESC
      LIMIT 12`,
    [delivery.objective_id]
  );

  return {
    delivery,
    report,
    filePaths: filePathRows.map(row => row.file_path),
    objective: {
      title: objective?.title ?? null,
      instruction: objective?.instruction_text ?? null
    },
    plannedObjectives: siblingObjectives
      .filter(row => row.state !== 'complete' && Boolean(row.instruction_text?.trim()))
      .map(row => ({ title: row.title, instruction: row.instruction_text })),
    recentEvents: recentEvents.map(event => ({ type: event.type, summary: event.summary }))
  };
}

/**
 * Persists a composed or fallback presentation with its change, its mission
 * items and its summary trigger atomically. The delivery's `mission_items` rows
 * are reconciled with the new presentation (new items such as
 * `deterministic_rule` actions are inserted, reworded ones updated, open ones it
 * no longer lists deleted), so the table and the delivery card cannot disagree.
 */
export async function persistDeliveryPresentation({
  db,
  delivery,
  nextReport,
  changedFields,
  resolveChangeAttribution
}: {
  db: DatabaseClient;
  delivery: DeliveryRow;
  nextReport: DeliveryReportPayloadV1;
  changedFields: string[];
  /** The caller resolves its actor/source in the same transaction as the write. */
  resolveChangeAttribution: (
    tx: DatabaseClient
  ) => Promise<Pick<EntityChangeFields, 'actorWorkspaceUserId' | 'actorTokenId' | 'source'>>;
}): Promise<void> {
  const now = nowIso();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(delivery.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  payload.deliveryReport = nextReport;

  await db.transaction(async tx => {
    // Same mission-first order as delivery and operator resolution.
    await lockMissionObjectiveQueue(tx, delivery.mission_id);
    const updated = await tx.run(
      `UPDATE deliveries
           SET payload_json = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [JSON.stringify(payload), now, delivery.id, delivery.revision]
    );
    if (updated.changes === 0) return;

    const attribution = await resolveChangeAttribution(tx);
    await insertEntityChange(tx, {
      entityType: 'delivery',
      entityId: delivery.id,
      operation: 'update',
      entityRevision: delivery.revision + 1,
      projectId: delivery.project_id,
      missionId: delivery.mission_id,
      objectiveId: delivery.objective_id,
      changedFields,
      workspaceId: delivery.workspace_id,
      ...attribution
    });
    await reconcileDeliveryMissionItems(tx, {
      delivery: {
        id: delivery.id,
        workspaceId: delivery.workspace_id,
        projectId: delivery.project_id,
        missionId: delivery.mission_id,
        objectiveId: delivery.objective_id,
        deliveredAt: delivery.delivered_at
      },
      report: nextReport,
      attribution,
      now
    });
  });
}
