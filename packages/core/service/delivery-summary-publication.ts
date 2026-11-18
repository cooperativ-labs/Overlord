import { formatObjectiveDisplayId } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';
import { createHash } from 'node:crypto';

import type { ServiceContext } from './context.js';
import { resolveMissionId } from './context.js';
import { canonicalJson, parseOperationId } from './delivery-finalization.js';
import { ServiceError } from './errors.js';
import {
  isSummaryEnabled,
  type PublicationSupersededReason,
  writeAgentNarrative
} from './mission-narrative.js';
import {
  type MissionSummaryBaseline,
  missionSummaryStyleWarnings,
  type MissionSummaryWarning,
  parseMissionSummaryInput,
  readMissionSummaryBaseline
} from './mission-summary-agent.js';
import { lockMissionObjectiveQueue } from './objective-queue.js';
import { hashSessionKey, nowIso } from './util.js';
import { lockMissionSummaryRow } from './worker-jobs.js';

/**
 * The narrow post-delivery narrative surface (coo:1297 phase 2, ADR 0076):
 * `delivery-summary-context` reads one accepted delivery's publication
 * opportunity and a fresh editing baseline; `publish-delivery-summary` writes
 * one reconciled headline and summary for it.
 *
 * Authority: live authentication, current workspace membership and project
 * scope (checked by the caller's ServiceContext and permission), the same
 * originating workspace member, and for a session-bound opportunity the
 * original session key of the session that delivered it. That session's
 * delivered, ended state is permitted for this operation only. A record-work
 * opportunity has no session and is bound to its originating member. One
 * successful publication per opportunity, never a timer: validity follows the
 * evidence basis, not elapsed time. No closes, report fields, objective
 * updates or execution rights.
 */

export const MISSION_SUMMARY_PUBLICATION_NOT_FOUND = 'mission_summary_publication_not_found';
export const MISSION_SUMMARY_PUBLICATION_SUPERSEDED = 'mission_summary_publication_superseded';
export const MISSION_SUMMARY_ALREADY_PUBLISHED = 'mission_summary_already_published';
export const MISSION_SUMMARY_CONFLICT = 'mission_summary_conflict';

export type PublicationState = 'outstanding' | 'published' | 'superseded' | 'ineligible';

export type DeliverySummaryPublication = {
  id: string;
  missionId: string;
  missionDisplayId: string;
  objectiveId: string;
  objectiveDisplayId: string | null;
  deliveryId: string;
  /** The evidence revision this opportunity is bound to. */
  evidenceRevision: number;
  /** True only while it can still be published. */
  available: boolean;
  state: PublicationState;
  supersededReason: PublicationSupersededReason | null;
  publishedAt: string | null;
  publishedContentRevision: number | null;
};

export type DeliverySummaryContext = {
  publication: DeliverySummaryPublication;
  /** Fresh editing baseline; null for an ineligible mission. */
  baseline: MissionSummaryBaseline | null;
  instruction: string;
};

export type PublishDeliverySummaryResult = {
  publication: DeliverySummaryPublication;
  operationId: string;
  contentRevision: number;
  evidenceRevision: number;
  publishedAt: string;
  warnings: MissionSummaryWarning[];
  instruction: string;
  /** True when this response is the stored result of an earlier identical publication. */
  replayed?: true;
};

type PublicationRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
  delivery_id: string;
  actor_workspace_user_id: string | null;
  session_id: string | null;
  evidence_revision: number | string;
  published_at: unknown;
  published_content_revision: number | string | null;
  publish_operation_id: string | null;
  publish_request_digest: string | null;
  superseded_at: unknown;
  superseded_reason: PublicationSupersededReason | null;
};

const PUBLICATION_COLUMNS = `id, workspace_id, project_id, mission_id, objective_id, delivery_id,
  actor_workspace_user_id, session_id, evidence_revision, published_at,
  published_content_revision, publish_operation_id, publish_request_digest, superseded_at,
  superseded_reason`;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value instanceof Date ? value : String(value)).toISOString();
}

function notFound(): ServiceError {
  return new ServiceError(
    'Mission summary publication not found',
    MISSION_SUMMARY_PUBLICATION_NOT_FOUND,
    404
  );
}

type Bound = {
  mission: { id: string; displayId: string; projectId: string };
  row: PublicationRow;
  objectiveDisplayId: string | null;
  sessionModel: string | null;
};

/**
 * Resolves the caller's own publication and verifies its binding. Every
 * failure of identity, scope or source existence is the same not-found, so a
 * publication or delivery id never reveals a foreign record.
 */
async function bindPublication(
  ctx: ServiceContext,
  db: DatabaseClient,
  {
    missionId,
    deliveryId,
    publicationId,
    sessionKey,
    lock = false
  }: {
    missionId: string;
    deliveryId?: string | null;
    publicationId?: string | null;
    sessionKey?: string | null;
    lock?: boolean;
  }
): Promise<Bound> {
  if (!deliveryId === !publicationId) {
    throw new ServiceError('Name exactly one of deliveryId or publicationId', 'invalid_input', 400);
  }
  const actor = ctx.actorWorkspaceUserId;
  if (!actor) throw notFound();
  let mission: Bound['mission'];
  try {
    mission = await resolveMissionId({ ...ctx, db }, missionId);
  } catch {
    throw notFound();
  }
  const lockClause = lock && db.dialect === 'postgres' ? 'FOR UPDATE' : '';
  const row = await db.get<PublicationRow>(
    `SELECT ${PUBLICATION_COLUMNS} FROM delivery_summary_publications
      WHERE workspace_id = ? AND mission_id = ? AND ${publicationId ? 'id' : 'delivery_id'} = ?
      ${lockClause}`,
    [ctx.workspace.id, mission.id, publicationId ?? deliveryId]
  );
  if (!row || row.actor_workspace_user_id !== actor) throw notFound();
  // A moved mission no longer matches the scope the opportunity was bound to.
  if (row.project_id !== mission.projectId) throw notFound();
  const source = await db.get<{ id: string; display_key: string | null }>(
    `SELECT d.id, o.display_key FROM deliveries d
       JOIN objectives o ON o.id = d.objective_id AND o.deleted_at IS NULL
      WHERE d.id = ? AND d.mission_id = ? AND d.deleted_at IS NULL`,
    [row.delivery_id, mission.id]
  );
  if (!source) throw notFound();

  let sessionModel: string | null = null;
  if (row.session_id !== null) {
    if (!sessionKey) {
      throw new ServiceError(
        'sessionKey is required: send the session key of the session that delivered',
        'invalid_input',
        400
      );
    }
    const session = await db.get<{
      id: string;
      mission_id: string;
      objective_id: string;
      delivery_state: string | null;
      ended_at: unknown;
      model_identifier: string | null;
    }>(
      `SELECT id, mission_id, objective_id, delivery_state, ended_at, model_identifier
         FROM agent_sessions
        WHERE workspace_id = ? AND session_key_hash = ? AND deleted_at IS NULL`,
      [ctx.workspace.id, hashSessionKey(sessionKey)]
    );
    // Only the delivered session itself; an ended non-delivered or deleted
    // session never publishes.
    if (
      !session ||
      session.id !== row.session_id ||
      session.mission_id !== mission.id ||
      session.objective_id !== row.objective_id ||
      session.delivery_state !== 'delivered'
    ) {
      throw new ServiceError('Invalid or expired session key', 'invalid_session', 401);
    }
    sessionModel = session.model_identifier;
  }
  return {
    mission,
    row,
    objectiveDisplayId: source.display_key
      ? formatObjectiveDisplayId({
          missionDisplayId: mission.displayId,
          displayKey: source.display_key
        })
      : null,
    sessionModel
  };
}

/** Current availability, rechecked inside the publication transaction. */
async function publicationState(
  db: DatabaseClient,
  bound: Bound
): Promise<{ state: PublicationState; supersededReason: PublicationSupersededReason | null }> {
  const { row, mission } = bound;
  if (row.published_at !== null) return { state: 'published', supersededReason: null };
  if (row.superseded_at !== null) {
    return { state: 'superseded', supersededReason: row.superseded_reason };
  }
  const missionRow = await db.get<{ summary_enabled: unknown }>(
    `SELECT summary_enabled FROM missions WHERE id = ?`,
    [mission.id]
  );
  if (!isSummaryEnabled(missionRow?.summary_enabled)) {
    return { state: 'ineligible', supersededReason: null };
  }
  const summary = await db.get<{ evidence_revision: number | string }>(
    `SELECT evidence_revision FROM mission_summaries WHERE mission_id = ?`,
    [mission.id]
  );
  const objective = await db.get<{ state: string }>(`SELECT state FROM objectives WHERE id = ?`, [
    row.objective_id
  ]);
  // Defensive: every basis change supersedes eagerly; a newer basis or a
  // source objective back in execution still never leaves it available.
  if (
    Number(summary?.evidence_revision ?? 0) !== Number(row.evidence_revision) ||
    objective?.state !== 'complete'
  ) {
    return { state: 'superseded', supersededReason: null };
  }
  return { state: 'outstanding', supersededReason: null };
}

function toPublication(
  bound: Bound,
  state: { state: PublicationState; supersededReason: PublicationSupersededReason | null },
  published?: { at: string; contentRevision: number }
): DeliverySummaryPublication {
  const { row, mission } = bound;
  return {
    id: row.id,
    missionId: mission.id,
    missionDisplayId: mission.displayId,
    objectiveId: row.objective_id,
    objectiveDisplayId: bound.objectiveDisplayId,
    deliveryId: row.delivery_id,
    evidenceRevision: Number(row.evidence_revision),
    available: state.state === 'outstanding',
    state: state.state,
    supersededReason: state.supersededReason,
    publishedAt: published?.at ?? iso(row.published_at),
    publishedContentRevision:
      published?.contentRevision ??
      (row.published_content_revision === null ? null : Number(row.published_content_revision))
  };
}

export type PublicationInstructionStyle = 'cli' | 'mcp';

/** What the agent does next, worded for its connection method. */
export function publicationInstruction(
  style: PublicationInstructionStyle,
  publication: Pick<
    DeliverySummaryPublication,
    'state' | 'missionDisplayId' | 'deliveryId' | 'available'
  >
): string {
  if (publication.state === 'published') {
    return 'The mission summary for this delivery is published. Stop; do not deliver again or resume execution.';
  }
  if (!publication.available) {
    return 'This delivery can no longer publish the mission summary: newer work, a follow-up or a reopen changed the mission, or the mission has no summary. Do not deliver again or resume execution only to update it; tell the user the mission summary is missing or outdated.';
  }
  const command =
    style === 'mcp'
      ? `call \`overlord_publish_delivery_summary\` with missionId ${publication.missionDisplayId}, deliveryId ${publication.deliveryId}, your session key, a new operationId, baseContentRevision and baseEvidenceRevision from that baseline, and the headline and summary`
      : `run \`ovld protocol publish-delivery-summary --mission-id ${publication.missionDisplayId} --delivery-id ${publication.deliveryId} --session-key <key> --operation-id <new id> --payload-file <file>\` with { "baseContentRevision", "baseEvidenceRevision", "headline", "summary" } from that baseline`;
  return `Reconcile the mission summary for the whole mission from this baseline and ${command}. Keep the operationId for a retry of the same publication. On a conflict, read the returned baseline and try once more; then stop and say the summary is not updated. Do not deliver again or resume execution.`;
}

export async function readDeliverySummaryContext({
  ctx,
  missionId,
  deliveryId,
  publicationId,
  sessionKey,
  style = 'cli'
}: {
  ctx: ServiceContext;
  missionId: string;
  deliveryId?: string | null;
  publicationId?: string | null;
  sessionKey?: string | null;
  style?: PublicationInstructionStyle;
}): Promise<DeliverySummaryContext> {
  const bound = await bindPublication(ctx, ctx.db, {
    missionId,
    deliveryId,
    publicationId,
    sessionKey
  });
  const state = await publicationState(ctx.db, bound);
  const publication = toPublication(bound, state);
  return {
    publication,
    baseline:
      state.state === 'ineligible'
        ? null
        : await readMissionSummaryBaseline(ctx.db, bound.mission.id),
    instruction: publicationInstruction(style, publication)
  };
}

function publishDigest(publicationId: string, semantic: unknown): string {
  return `v1:${createHash('sha256')
    .update(canonicalJson({ kind: 'publish_delivery_summary', publicationId, semantic }))
    .digest('hex')}`;
}

/**
 * Publishes one reconciled mission narrative for an accepted delivery. Same
 * operation id and content after success replays the result; any other
 * second publication is refused. Stale bases consume nothing and return
 * 409 `mission_summary_conflict` with the current baseline; a superseded
 * opportunity is 409 `mission_summary_publication_superseded`.
 */
export async function publishDeliverySummary({
  ctx,
  missionId,
  deliveryId,
  publicationId,
  sessionKey,
  operationId: rawOperationId,
  narrative: rawNarrative,
  style = 'cli',
  now = nowIso()
}: {
  ctx: ServiceContext;
  missionId: string;
  deliveryId?: string | null;
  publicationId?: string | null;
  sessionKey?: string | null;
  operationId: unknown;
  narrative: unknown;
  style?: PublicationInstructionStyle;
  now?: string;
}): Promise<PublishDeliverySummaryResult> {
  const operationId = parseOperationId(rawOperationId);
  if (!operationId) {
    throw new ServiceError(
      'operationId is required: choose one before sending and reuse it for every retry of this publication',
      'invalid_input',
      400
    );
  }
  if (!rawNarrative || typeof rawNarrative !== 'object' || Array.isArray(rawNarrative)) {
    throw new ServiceError(
      'Send { baseContentRevision, baseEvidenceRevision, headline, summary }',
      'invalid_input',
      400
    );
  }
  if ('closeItems' in rawNarrative) {
    throw new ServiceError(
      'publish-delivery-summary accepts no closeItems; close items while you work or at delivery',
      'invalid_input',
      400
    );
  }
  const parsed = parseMissionSummaryInput(rawNarrative, { requireBase: true });
  if (!parsed?.narrative) {
    throw new ServiceError('headline and summary are required', 'invalid_input', 400);
  }
  if (parsed.baseContentRevision === null || parsed.baseEvidenceRevision === null) {
    throw new ServiceError(
      'baseContentRevision and baseEvidenceRevision are required; read them with delivery-summary-context',
      'invalid_input',
      400
    );
  }
  const narrative = parsed.narrative;
  const bases = {
    content: parsed.baseContentRevision,
    evidence: parsed.baseEvidenceRevision
  };

  // Authorization and binding before any lock; rechecked under the locks.
  const preliminary = await bindPublication(ctx, ctx.db, {
    missionId,
    deliveryId,
    publicationId,
    sessionKey
  });
  const digest = publishDigest(preliminary.row.id, {
    headline: narrative.headline,
    summary: narrative.summary,
    baseContentRevision: bases.content,
    baseEvidenceRevision: bases.evidence
  });

  const outcome = await ctx.db.transaction(async tx => {
    // Same lock order as delivery: mission, then summary row, then publication.
    await lockMissionObjectiveQueue(tx, preliminary.mission.id);
    await lockMissionSummaryRow(tx, preliminary.mission.id);
    const bound = await bindPublication(ctx, tx, {
      missionId: preliminary.mission.id,
      publicationId: preliminary.row.id,
      sessionKey,
      lock: true
    });
    const { row, mission } = bound;
    if (row.published_at !== null) {
      if (row.publish_operation_id === operationId && row.publish_request_digest === digest) {
        return { replay: true as const, bound };
      }
      throw new ServiceError(
        'The mission summary for this delivery was already published. A publication cannot be changed; newer work needs its own delivery.',
        MISSION_SUMMARY_ALREADY_PUBLISHED,
        409,
        { publication: toPublication(bound, { state: 'published', supersededReason: null }) }
      );
    }
    const state = await publicationState(tx, bound);
    if (state.state !== 'outstanding') {
      const publication = toPublication(bound, state);
      throw new ServiceError(
        'This delivery can no longer publish the mission summary: the mission changed after it (newer delivery, follow-up or reopen), or it has no summary.',
        MISSION_SUMMARY_PUBLICATION_SUPERSEDED,
        409,
        { publication, instruction: publicationInstruction(style, publication) }
      );
    }
    const current = await lockMissionSummaryRow(tx, mission.id);
    if (
      !current ||
      current.content_revision !== bases.content ||
      current.evidence_revision !== bases.evidence
    ) {
      const publication = toPublication(bound, state);
      throw new ServiceError(
        `The mission summary changed since your baseline (content ${bases.content} → ${current?.content_revision ?? 0}, evidence ${bases.evidence} → ${current?.evidence_revision ?? 0}). Nothing was published. Reconcile from details.missionSummary and publish once more with its revisions.`,
        MISSION_SUMMARY_CONFLICT,
        409,
        {
          publication,
          missionSummary: await readMissionSummaryBaseline(tx, mission.id),
          instruction: publicationInstruction(style, publication)
        }
      );
    }
    const written = await writeAgentNarrative(tx, {
      mission: { id: mission.id, workspaceId: ctx.workspace.id, projectId: mission.projectId },
      narrative,
      deliveryId: row.delivery_id,
      objectiveId: row.objective_id,
      model: bound.sessionModel,
      evidenceRevision: Number(row.evidence_revision),
      publicationId: row.id,
      publishOperation: { operationId, digest },
      attribution: {
        actorWorkspaceUserId: ctx.actorWorkspaceUserId,
        actorTokenId: ctx.actorTokenId ?? null,
        source: ctx.source
      },
      now
    });
    return { written, bound };
  });

  const bound = outcome.bound;
  const publishedState = { state: 'published' as const, supersededReason: null };
  if ('replay' in outcome) {
    const publication = toPublication(bound, publishedState);
    return {
      publication,
      operationId,
      contentRevision: publication.publishedContentRevision ?? 0,
      evidenceRevision: publication.evidenceRevision,
      publishedAt: publication.publishedAt ?? '',
      warnings: missionSummaryStyleWarnings(narrative),
      instruction: publicationInstruction(style, publication),
      replayed: true
    };
  }
  const publication = toPublication(bound, publishedState, {
    at: outcome.written.publishedAt,
    contentRevision: outcome.written.contentRevision
  });
  return {
    publication,
    operationId,
    contentRevision: outcome.written.contentRevision,
    evidenceRevision: publication.evidenceRevision,
    publishedAt: outcome.written.publishedAt,
    warnings: missionSummaryStyleWarnings(narrative),
    instruction: publicationInstruction(style, publication)
  };
}
