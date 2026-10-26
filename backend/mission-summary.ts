import { PERMISSIONS } from '@overlord/auth';
import {
  type HumanActionV1,
  type MarkMissionSummarySeenBody,
  MISSION_SUMMARY_EVIDENCE_LIMIT,
  type MissionSummaryActionDto,
  type MissionSummaryDto,
  type MissionSummaryEvidenceDto,
  type MissionSummaryResponse,
  type MissionSummaryRiskDto,
  type MissionSummarySeenResponse,
  type MissionSummarySourceDto,
  type MissionSummaryStatus,
  type MissionSummarySuggestionDto
} from '@overlord/contract';

import {
  type MissionSummaryDeliveryEvidence,
  type MissionSummaryRuns
} from '../packages/core/service/mission-summary-compose.ts';
import { readMissionSummaryRuns } from '../packages/core/service/mission-summary-evidence.ts';

import { requireDatabaseClient } from './db.ts';
import {
  deferredWorkEntries,
  findResolution,
  loadResolutions,
  toResolution
} from './deferred-work.ts';
import { ApiError } from './errors.ts';
import { requireMissionPermission } from './rbac.ts';

/**
 * Read side of the mission summary (coo:1202, contract v166): the summary row,
 * the evidence selected for it, and the caller's seen watermark.
 *
 * Operator surface only. Nothing here is reachable from `load-context`, the
 * mission packet, MCP tools, or CLI protocol commands; the REST routes are
 * exempt from MCP parity for that reason.
 *
 * A delivery is *current-run* when it is live and was delivered at or after its
 * objective's `reopened_at`; core's mission summary evidence reader owns that
 * rule for the worker and this route alike. Evidence is selected in the
 * database before any limit: the latest current-run delivery of every objective
 * (including deleted objectives, whose deliveries clients render as the
 * unassigned row), so a busy objective can never push another objective's
 * current delivery out of view.
 * Risks and suggestions stored on the summary row are references; they are
 * projected here from current-run deliveries only, so a reference whose source
 * stopped being current disappears even while a recompose is pending.
 */

interface MissionScope {
  missionId: string;
  workspaceId: string;
  workspaceUserId: string;
  eligible: boolean;
}

interface MissionSummaryRow {
  mission_id: string;
  revision: number;
  status: string;
  headline: string;
  summary_markdown: string;
  risks_json: string;
  suggestions_json: string;
  source_delivery_id: string | null;
  generated_by: string;
  generated_at: string | null;
  model: string | null;
}

interface RiskRef {
  deliveryId: string;
  objectiveId: string;
  text: string;
}

interface SuggestionRef {
  deliveryId: string;
  objectiveId: string;
  actionId: string;
}

async function resolveMissionScope(missionRef: string): Promise<MissionScope> {
  const scope = await requireMissionPermission({
    missionRef,
    permission: PERMISSIONS.MISSION_READ
  });
  const row = (await requireDatabaseClient().get(
    `SELECT summary_enabled FROM missions WHERE id = ? AND workspace_id = ?`,
    [scope.missionId, scope.workspaceId]
  )) as { summary_enabled: number | boolean } | undefined;
  if (!row) throw new ApiError(404, 'Mission not found');
  return {
    missionId: scope.missionId,
    workspaceId: scope.workspaceId,
    workspaceUserId: scope.workspaceUserId,
    // SQLite stores 0/1; PostgreSQL returns a boolean.
    eligible: row.summary_enabled === true || Number(row.summary_enabled) === 1
  };
}

/** Newest `created_at` of the mission's open question and choice requests. */
async function latestOpenQuestionAt(scope: MissionScope): Promise<string | null> {
  const row = (await requireDatabaseClient().get(
    `SELECT created_at FROM agent_requests
      WHERE mission_id = ? AND deleted_at IS NULL AND status = 'open'
        AND kind IN ('question', 'choice')
      ORDER BY created_at DESC
      LIMIT 1`,
    [scope.missionId]
  )) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (latest === null || Date.parse(value) > Date.parse(latest)) latest = value;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/** Sources are the latest current-run delivery of every objective, newest first. */
function buildEvidence(runs: MissionSummaryRuns) {
  const sources = runs.latestByObjective;
  const actions: Array<MissionSummaryActionDto & { order: number }> = [];
  for (const source of sources) {
    source.report.presentation.humanActions.forEach((action: HumanActionV1) => {
      const { id, ...fields } = action;
      actions.push({
        ...fields,
        deliveryId: source.id,
        objectiveId: source.objectiveId,
        actionId: id,
        deliveredAt: source.deliveredAt,
        order: actions.length
      });
    });
  }
  // Blocking first; otherwise keep newest delivery first, then report order.
  actions.sort(
    (left, right) =>
      Number(right.blocking === true) - Number(left.blocking === true) || left.order - right.order
  );
  const sourceDtos: MissionSummarySourceDto[] = sources.map(source => ({
    objectiveId: source.objectiveId,
    deliveryId: source.id,
    deliveredAt: source.deliveredAt
  }));
  const evidence: MissionSummaryEvidenceDto = {
    actions: actions
      .slice(0, MISSION_SUMMARY_EVIDENCE_LIMIT)
      .map(({ order: _order, ...action }) => action),
    sources: sourceDtos.slice(0, MISSION_SUMMARY_EVIDENCE_LIMIT),
    totals: {
      actions: actions.length,
      sources: sourceDtos.length,
      currentRunDeliveries: runs.currentRun.length
    },
    truncated: {
      actions: actions.length > MISSION_SUMMARY_EVIDENCE_LIMIT,
      sources: sourceDtos.length > MISSION_SUMMARY_EVIDENCE_LIMIT
    }
  };
  return evidence;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseRiskRefs(value: unknown): RiskRef[] {
  return parseJsonArray(value).flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const { deliveryId, objectiveId, text } = item as Record<string, unknown>;
    return isNonEmptyString(deliveryId) && isNonEmptyString(objectiveId) && isNonEmptyString(text)
      ? [{ deliveryId, objectiveId, text }]
      : [];
  });
}

function parseSuggestionRefs(value: unknown): SuggestionRef[] {
  return parseJsonArray(value).flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const { deliveryId, objectiveId, actionId } = item as Record<string, unknown>;
    return isNonEmptyString(deliveryId) &&
      isNonEmptyString(objectiveId) &&
      isNonEmptyString(actionId)
      ? [{ deliveryId, objectiveId, actionId }]
      : [];
  });
}

/**
 * Projects the row's risk and suggestion references onto current-run
 * deliveries. Dismissed suggestions are omitted; promoted ones keep only their
 * identity, title, and resolution.
 */
async function projectSummary(
  row: MissionSummaryRow,
  runs: MissionSummaryRuns
): Promise<MissionSummaryDto> {
  const riskRefs = parseRiskRefs(row.risks_json);
  const suggestionRefs = parseSuggestionRefs(row.suggestions_json);
  const deliveries = new Map<string, MissionSummaryDeliveryEvidence>(
    runs.currentRun.map(delivery => [delivery.id, delivery])
  );
  const resolutions = await loadResolutions([
    ...new Set(suggestionRefs.map(ref => ref.deliveryId).filter(id => deliveries.has(id)))
  ]);

  const risks: MissionSummaryRiskDto[] = riskRefs
    .filter(ref => deliveries.get(ref.deliveryId)?.objectiveId === ref.objectiveId)
    .map(({ deliveryId, objectiveId, text }) => ({
      deliveryId,
      objectiveId,
      deliveredAt: deliveries.get(deliveryId)!.deliveredAt,
      text
    }));

  const suggestions: MissionSummarySuggestionDto[] = [];
  for (const ref of suggestionRefs) {
    const delivery = deliveries.get(ref.deliveryId);
    if (!delivery || delivery.objectiveId !== ref.objectiveId) continue;
    const entry = deferredWorkEntries(delivery.report).find(
      candidate => candidate.id === ref.actionId
    );
    if (!entry) continue;
    const resolution = toResolution(findResolution(resolutions, delivery.id, entry));
    if (resolution?.status === 'dismissed') continue;
    const identity = {
      deliveryId: delivery.id,
      objectiveId: delivery.objectiveId,
      deliveredAt: delivery.deliveredAt,
      actionId: entry.id,
      title: entry.title
    };
    suggestions.push(
      resolution
        ? { ...identity, state: 'resolved', resolution }
        : {
            ...identity,
            state: 'open',
            change: entry.change,
            location: entry.location,
            doneWhen: entry.doneWhen,
            resolution: null
          }
    );
  }

  return {
    missionId: row.mission_id,
    revision: Number(row.revision),
    status: row.status as MissionSummaryStatus,
    headline: row.headline,
    summary: row.summary_markdown,
    risks,
    suggestions,
    sourceDeliveryId: row.source_delivery_id,
    generatedBy: row.generated_by === 'gemini' ? 'gemini' : 'deterministic',
    generatedAt: row.generated_at,
    model: row.model
  };
}

async function loadSeenAt(scope: MissionScope): Promise<string | null> {
  const row = (await requireDatabaseClient().get(
    `SELECT seen_at FROM mission_summary_seen WHERE mission_id = ? AND workspace_user_id = ?`,
    [scope.missionId, scope.workspaceUserId]
  )) as { seen_at: string } | undefined;
  return row?.seen_at ?? null;
}

/** `GET /api/missions/:id/summary`. Mission read authorization. */
export async function getMissionSummary(missionRef: string): Promise<MissionSummaryResponse> {
  const scope = await resolveMissionScope(missionRef);
  if (!scope.eligible) {
    return { eligible: false, summary: null, evidence: null, watermark: null, seenAt: null };
  }
  const db = requireDatabaseClient();
  const [runs, openQuestionAt, summaryRow, seenAt] = await Promise.all([
    readMissionSummaryRuns(db, scope.missionId, { workspaceId: scope.workspaceId }),
    latestOpenQuestionAt(scope),
    db.get(
      `SELECT mission_id, revision, status, headline, summary_markdown, risks_json,
              suggestions_json, source_delivery_id, generated_by, generated_at, model
         FROM mission_summaries
        WHERE mission_id = ? AND workspace_id = ?`,
      [scope.missionId, scope.workspaceId]
    ) as Promise<MissionSummaryRow | undefined>,
    loadSeenAt(scope)
  ]);
  return {
    eligible: true,
    summary: summaryRow ? await projectSummary(summaryRow, runs) : null,
    evidence: buildEvidence(runs),
    // Every current-run delivery the response draws on is no newer than the
    // newest source, which is always the first (uncapped) source row.
    watermark: latestTimestamp(runs.latestByObjective[0]?.deliveredAt, openQuestionAt),
    seenAt
  };
}

/**
 * Upper bound a seen watermark may take: the newest evidence that could have
 * been displayed. Uses every live delivery and every question or choice request
 * of the mission, whatever its current status, so a request answered or a
 * delivery superseded after the read does not reject the acknowledgement of
 * what was shown, while evidence that does not exist yet can never be
 * acknowledged.
 */
async function evidenceUpperBound(scope: MissionScope): Promise<string | null> {
  const db = requireDatabaseClient();
  const delivery = (await db.get(
    `SELECT delivered_at FROM deliveries
      WHERE mission_id = ? AND workspace_id = ? AND deleted_at IS NULL
      ORDER BY delivered_at DESC
      LIMIT 1`,
    [scope.missionId, scope.workspaceId]
  )) as { delivered_at: string } | undefined;
  const request = (await db.get(
    `SELECT created_at FROM agent_requests
      WHERE mission_id = ? AND deleted_at IS NULL AND kind IN ('question', 'choice')
      ORDER BY created_at DESC
      LIMIT 1`,
    [scope.missionId]
  )) as { created_at: string } | undefined;
  return latestTimestamp(delivery?.delivered_at, request?.created_at);
}

function invalidInput(message: string): ApiError {
  return new ApiError(400, message, undefined, 'invalid_input');
}

/**
 * `PUT /api/missions/:id/summary/seen`. Stores `max(existing, watermark)` for
 * the calling workspace user and records no entity change.
 */
export async function markMissionSummarySeen(
  missionRef: string,
  body: unknown
): Promise<MissionSummarySeenResponse> {
  const scope = await resolveMissionScope(missionRef);
  const watermark =
    body && typeof body === 'object'
      ? (body as Partial<MarkMissionSummarySeenBody>).watermark
      : undefined;
  if (typeof watermark !== 'string' || !Number.isFinite(Date.parse(watermark))) {
    throw invalidInput('watermark must be an ISO-8601 timestamp');
  }
  if (!scope.eligible) throw invalidInput('This mission has no summary');
  const seenAt = new Date(watermark).toISOString();
  const upperBound = await evidenceUpperBound(scope);
  if (upperBound === null || Date.parse(seenAt) > Date.parse(upperBound)) {
    throw invalidInput('watermark is later than the newest mission evidence');
  }

  const db = requireDatabaseClient();
  await db.run(
    `INSERT INTO mission_summary_seen (mission_id, workspace_user_id, seen_at)
     VALUES (?, ?, ?)
     ON CONFLICT (mission_id, workspace_user_id) DO UPDATE SET
       seen_at = CASE
         WHEN excluded.seen_at > mission_summary_seen.seen_at THEN excluded.seen_at
         ELSE mission_summary_seen.seen_at
       END`,
    [scope.missionId, scope.workspaceUserId, seenAt]
  );
  const stored = await loadSeenAt(scope);
  return { seenAt: stored ?? seenAt };
}
