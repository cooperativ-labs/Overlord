import type { DatabaseClient } from '@overlord/database';

import type { MissionItemChangeAttribution } from './mission-items.js';
import { newId, nowIso, toIsoOrNull } from './util.js';
import { lockMissionSummaryRow, recordMissionSummaryChange } from './worker-jobs.js';

/**
 * Agent-only mission narrative state (coo:1297 phase 2, contract ADR 0076).
 *
 * Only an agent with execution context writes a mission headline and summary.
 * `mission_summaries.evidence_revision` names the delivery/execution basis the
 * prose must cover. It advances under the mission lock on every accepted
 * delivery, explicit follow-up start and objective reopen; item decisions,
 * questions, presentation rewrites and liveness never move it. Each accepted
 * delivery of an eligible mission gets one `delivery_summary_publications`
 * row: its publication opportunity, valid while its evidence revision is
 * current, with no deadline. A newer basis supersedes it. Nothing here
 * generates prose.
 */

/** Server-derived narrative freshness. Not an objective status. */
export type NarrativeState = 'absent' | 'current' | 'outdated' | 'legacy';

/** Why inline prose of an accepted delivery was not published. */
export type NarrativeWithheldReason =
  | 'absent'
  | 'stale_content'
  | 'stale_evidence'
  | 'missing_evidence_base';

/** Why an outstanding publication opportunity ended without publication. */
export type PublicationSupersededReason =
  | 'newer_delivery'
  | 'follow_up'
  | 'reopened'
  | 'source_deleted';

/** What advanced the evidence basis. */
export type NarrativeEvidenceReason = 'delivery' | 'follow_up' | 'reopened' | 'source_deleted';

/** The `narrative` envelope on summary reads, attach baselines and publication context. */
export type MissionNarrative = {
  state: NarrativeState;
  evidenceRevision: number;
  /** The basis the current prose was published against; null for absent or legacy prose. */
  publishedEvidenceRevision: number | null;
  /** The delivery whose author wrote the current prose; null when unknown. */
  deliveryId: string | null;
  objectiveId: string | null;
  /** When the current prose was published through this boundary; null for legacy prose. */
  publishedAt: string | null;
  /** Last narrative text or basis change; the `narrativeWatermark`. */
  changedAt: string | null;
  /** The delivery whose publication opportunity is still open, if any. */
  outstandingDeliveryId: string | null;
};

type MissionScope = { id: string; workspaceId: string; projectId: string };

export function isSummaryEnabled(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

/**
 * A server-issued narrative timestamp strictly after the previous narrative
 * change at millisecond precision, so equal-timestamp writes never hide a
 * change from a seen marker. Display ordering only; revisions decide races.
 */
export function nextNarrativeTimestamp(previous: string | null, now: string = nowIso()): string {
  const at = Date.parse(now);
  const floor = previous === null ? Number.NEGATIVE_INFINITY : Date.parse(previous) + 1;
  return new Date(Math.max(at, floor)).toISOString();
}

/**
 * Inserts the empty state row of an eligible mission when none exists. An
 * empty row is not authored text: it carries no prose and no exposed author.
 * The insert serializes two first writers on the primary key.
 */
export async function ensureMissionSummaryRow(
  tx: DatabaseClient,
  mission: MissionScope,
  now: string = nowIso()
): Promise<{ created: boolean }> {
  const inserted = await tx.run(
    `INSERT INTO mission_summaries
         (mission_id, workspace_id, project_id, revision, requested_generation,
          completed_generation, status, headline, summary_markdown,
          source_delivery_id, generated_by, generated_at, model, created_at, updated_at)
       VALUES (?, ?, ?, 1, 0, 0, 'composed', '', '', NULL, 'agent', NULL, NULL, ?, ?)
       ON CONFLICT (mission_id) DO NOTHING`,
    [mission.id, mission.workspaceId, mission.projectId, now, now]
  );
  return { created: inserted.changes > 0 };
}

const SUPERSEDED_BY: Record<NarrativeEvidenceReason, PublicationSupersededReason> = {
  delivery: 'newer_delivery',
  follow_up: 'follow_up',
  reopened: 'reopened',
  source_deleted: 'source_deleted'
};

/**
 * Advances the mission's narrative evidence basis. Call inside the
 * transaction of the write it follows, after the canonical mission lock.
 * Supersedes every outstanding publication opportunity of the mission (a
 * fulfilled one is never superseded; its prose simply becomes outdated) and
 * moves `narrative_changed_at`. Returns null for an ineligible or missing
 * mission, which has no narrative basis.
 */
export async function advanceMissionNarrativeEvidence(
  tx: DatabaseClient,
  {
    mission: missionRef,
    reason,
    attribution,
    now = nowIso()
  }: {
    mission: { id: string };
    reason: NarrativeEvidenceReason;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<{ evidenceRevision: number; revision: number } | null> {
  const mission = await tx.get<{
    workspace_id: string;
    project_id: string;
    summary_enabled: unknown;
  }>(
    `SELECT workspace_id, project_id, summary_enabled FROM missions
      WHERE id = ? AND deleted_at IS NULL`,
    [missionRef.id]
  );
  if (!mission || !isSummaryEnabled(mission.summary_enabled)) return null;
  const scope = {
    id: missionRef.id,
    workspaceId: mission.workspace_id,
    projectId: mission.project_id
  };
  const { created } = await ensureMissionSummaryRow(tx, scope, now);
  const current = await lockMissionSummaryRow(tx, scope.id);
  const changedAt = nextNarrativeTimestamp(current?.narrative_changed_at ?? null, now);

  await tx.run(
    `UPDATE delivery_summary_publications
        SET superseded_at = ?, superseded_reason = ?, revision = revision + 1, updated_at = ?
      WHERE mission_id = ? AND published_at IS NULL AND superseded_at IS NULL`,
    [now, SUPERSEDED_BY[reason], now, scope.id]
  );
  const updated = await tx.get<{ revision: number | string; evidence_revision: number | string }>(
    `UPDATE mission_summaries
        SET evidence_revision = evidence_revision + 1, revision = revision + 1,
            narrative_changed_at = ?, updated_at = ?
      WHERE mission_id = ?
      RETURNING revision, evidence_revision`,
    [changedAt, now, scope.id]
  );
  if (!updated) return null;
  const revision = Number(updated.revision);
  await recordMissionSummaryChange(tx, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    missionId: scope.id,
    revision,
    operation: created ? 'insert' : 'update',
    changedFields: ['evidence_revision', 'narrative_changed_at'],
    actorWorkspaceUserId: attribution.actorWorkspaceUserId,
    actorTokenId: attribution.actorTokenId ?? null,
    source: attribution.source
  });
  return { evidenceRevision: Number(updated.evidence_revision), revision };
}

/**
 * Creates the publication row of one accepted delivery, bound to its
 * originating member, optional session and the evidence revision the
 * delivery advanced to. The original inline proposal is immutable source.
 */
export async function createDeliveryPublication(
  tx: DatabaseClient,
  {
    mission,
    objectiveId,
    deliveryId,
    actorWorkspaceUserId,
    sessionId,
    evidenceRevision,
    proposal,
    withheldReason,
    now = nowIso()
  }: {
    mission: MissionScope;
    objectiveId: string;
    deliveryId: string;
    actorWorkspaceUserId: string | null;
    sessionId: string | null;
    evidenceRevision: number;
    proposal: { headline: string; summary: string } | null;
    withheldReason: NarrativeWithheldReason | null;
    now?: string;
  }
): Promise<{ id: string }> {
  const id = newId();
  await tx.run(
    `INSERT INTO delivery_summary_publications
       (id, workspace_id, project_id, mission_id, objective_id, delivery_id,
        actor_workspace_user_id, session_id, evidence_revision, proposed_headline,
        proposed_summary, withheld_reason, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      mission.workspaceId,
      mission.projectId,
      mission.id,
      objectiveId,
      deliveryId,
      actorWorkspaceUserId,
      sessionId,
      evidenceRevision,
      proposal?.headline ?? null,
      proposal?.summary ?? null,
      withheldReason,
      now,
      now
    ]
  );
  return { id };
}

/**
 * The only writer of mission headline and summary text. The caller holds the
 * mission and summary row locks and has already checked both bases and the
 * publication's validity. Publishes against `evidenceRevision`, fulfils the
 * publication row (its text becomes immutable) and records the change.
 */
export async function writeAgentNarrative(
  tx: DatabaseClient,
  {
    mission,
    narrative,
    deliveryId,
    objectiveId,
    model,
    evidenceRevision,
    publicationId,
    publishOperation,
    attribution,
    created = false,
    now = nowIso()
  }: {
    mission: MissionScope;
    narrative: { headline: string; summary: string };
    deliveryId: string;
    objectiveId: string;
    model: string | null;
    evidenceRevision: number;
    publicationId: string;
    /** The narrow publication operation; null for inline publication at delivery. */
    publishOperation: { operationId: string; digest: string } | null;
    attribution: MissionItemChangeAttribution;
    created?: boolean;
    now?: string;
  }
): Promise<{ contentRevision: number; publishedAt: string; revision: number }> {
  const current = await lockMissionSummaryRow(tx, mission.id);
  const publishedAt = nextNarrativeTimestamp(current?.narrative_changed_at ?? null, now);
  const updated = await tx.get<{ revision: number | string; content_revision: number | string }>(
    `UPDATE mission_summaries
        SET status = 'composed', headline = ?, summary_markdown = ?,
            source_delivery_id = ?, generated_by = 'agent', generated_at = ?, model = ?,
            narrative_delivery_id = ?, narrative_objective_id = ?,
            content_revision = content_revision + 1, revision = revision + 1,
            completed_generation = requested_generation,
            published_evidence_revision = ?, narrative_published_at = ?,
            narrative_changed_at = ?, updated_at = ?
      WHERE mission_id = ?
      RETURNING revision, content_revision`,
    [
      narrative.headline,
      narrative.summary,
      deliveryId,
      publishedAt,
      model,
      deliveryId,
      objectiveId,
      evidenceRevision,
      publishedAt,
      publishedAt,
      now,
      mission.id
    ]
  );
  if (!updated) throw new Error(`mission summary row missing for ${mission.id}`);
  const contentRevision = Number(updated.content_revision);
  await tx.run(
    `UPDATE delivery_summary_publications
        SET published_headline = ?, published_summary = ?, published_content_revision = ?,
            published_at = ?, publish_operation_id = ?, publish_request_digest = ?,
            revision = revision + 1, updated_at = ?
      WHERE id = ?`,
    [
      narrative.headline,
      narrative.summary,
      contentRevision,
      publishedAt,
      publishOperation?.operationId ?? null,
      publishOperation?.digest ?? null,
      now,
      publicationId
    ]
  );
  const revision = Number(updated.revision);
  await recordMissionSummaryChange(tx, {
    workspaceId: mission.workspaceId,
    projectId: mission.projectId,
    missionId: mission.id,
    revision,
    operation: created ? 'insert' : 'update',
    changedFields: [
      'status',
      'headline',
      'summary_markdown',
      'generated_by',
      'content_revision',
      'narrative_delivery_id',
      'narrative_objective_id',
      'published_evidence_revision',
      'narrative_published_at',
      'narrative_changed_at'
    ],
    actorWorkspaceUserId: attribution.actorWorkspaceUserId,
    actorTokenId: attribution.actorTokenId ?? null,
    source: attribution.source
  });
  return { contentRevision, publishedAt, revision };
}

export const ABSENT_NARRATIVE: MissionNarrative = {
  state: 'absent',
  evidenceRevision: 0,
  publishedEvidenceRevision: null,
  deliveryId: null,
  objectiveId: null,
  publishedAt: null,
  changedAt: null,
  outstandingDeliveryId: null
};

/**
 * The narrative envelope of one mission. `current` requires agent prose
 * published through this boundary against the present basis, from a delivery
 * that still exists; prose without a recorded basis is `legacy`.
 */
export async function readMissionNarrative(
  db: DatabaseClient,
  missionId: string
): Promise<MissionNarrative> {
  const row = await db.get<{
    headline: string;
    summary_markdown: string;
    evidence_revision: number | string;
    published_evidence_revision: number | string | null;
    narrative_delivery_id: string | null;
    narrative_objective_id: string | null;
    narrative_published_at: unknown;
    narrative_changed_at: unknown;
  }>(
    `SELECT headline, summary_markdown, evidence_revision, published_evidence_revision,
            narrative_delivery_id, narrative_objective_id, narrative_published_at,
            narrative_changed_at
       FROM mission_summaries WHERE mission_id = ?`,
    [missionId]
  );
  if (!row) return ABSENT_NARRATIVE;
  const evidenceRevision = Number(row.evidence_revision);
  const published =
    row.published_evidence_revision === null ? null : Number(row.published_evidence_revision);
  const hasProse = Boolean(row.headline.trim() || row.summary_markdown.trim());
  let state: NarrativeState;
  if (!hasProse) state = 'absent';
  else if (published === null) state = 'legacy';
  else if (published === evidenceRevision) state = 'current';
  else state = 'outdated';
  if (state === 'current' && row.narrative_delivery_id) {
    const source = await db.get<{ id: string }>(
      `SELECT id FROM deliveries WHERE id = ? AND deleted_at IS NULL`,
      [row.narrative_delivery_id]
    );
    if (!source) state = 'outdated';
  }
  const outstanding = await db.get<{ delivery_id: string }>(
    `SELECT p.delivery_id FROM delivery_summary_publications p
       JOIN deliveries d ON d.id = p.delivery_id AND d.deleted_at IS NULL
      WHERE p.mission_id = ? AND p.published_at IS NULL AND p.superseded_at IS NULL
        AND p.evidence_revision = ?
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1`,
    [missionId, evidenceRevision]
  );
  return {
    state,
    evidenceRevision,
    publishedEvidenceRevision: hasProse ? published : null,
    deliveryId: hasProse ? row.narrative_delivery_id : null,
    objectiveId: hasProse ? row.narrative_objective_id : null,
    publishedAt: hasProse && published !== null ? toIsoOrNull(row.narrative_published_at) : null,
    changedAt: toIsoOrNull(row.narrative_changed_at),
    outstandingDeliveryId: outstanding?.delivery_id ?? null
  };
}
