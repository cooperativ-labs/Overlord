import { PERMISSIONS } from '@overlord/auth';
import {
  type MarkMissionSummarySeenBody,
  MISSION_SUMMARY_EVIDENCE_LIMIT,
  type MissionSummaryActionDto,
  type MissionSummaryDto,
  type MissionSummaryDuplicateDto,
  type MissionSummaryEvidenceDto,
  type MissionSummaryResponse,
  type MissionSummaryRiskDto,
  type MissionSummarySeenResponse,
  type MissionSummarySourceDto,
  type MissionSummaryStatus,
  type MissionSummarySuggestionDto
} from '@overlord/contract';

import { listMissionItems, type MissionItem } from '../packages/core/service/mission-items.ts';
import { readMissionNarrative } from '../packages/core/service/mission-narrative.ts';
import {
  MISSION_SUMMARY_LIMITS,
  type MissionSummaryRuns,
  readMissionSummaryOpenItems,
  readMissionSummaryRuns
} from '../packages/core/service/mission-summary-evidence.ts';

import { requireDatabaseClient } from './db.ts';
import { toResolverDto } from './deferred-work.ts';
import { ApiError } from './errors.ts';
import { requireMissionPermission } from './rbac.ts';

/**
 * Operator read projection: agent prose with its server-derived `narrative`
 * freshness (ADR 0076), live mission_items, and the seen watermarks. Nothing
 * here composes or repairs prose.
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
  content_revision: number;
  narrative_delivery_id: string | null;
  narrative_objective_id: string | null;
  source_delivery_id: string | null;
  generated_by: string;
  generated_at: string | null;
  model: string | null;
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

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * What makes two open records the same thing to close. A risk is its text. A
 * suggestion is its title together with the change, location and done-when it
 * asks for, so two suggestions with one title and different scope stay apart.
 */
function groupKey(item: MissionItem): string {
  const text = normalizeText(item.text);
  if (item.kind !== 'suggestion') return text;
  return JSON.stringify(
    [text, item.detail.change, item.detail.location, item.detail.doneWhen].map(part =>
      normalizeText(String(part ?? ''))
    )
  );
}

interface ItemGroup {
  /** The newest record, which keeps its stored identity and represents the row. */
  item: MissionItem;
  /** Older open records with the same key, newest first. */
  duplicates: MissionItem[];
}

/**
 * Display grouping: open records that are the same item collapse to one row
 * that carries the others as `duplicates`. Every record keeps its own stored
 * identity; nothing is closed or merged here.
 */
function groupOpenItems(
  items: MissionItem[],
  kind: MissionItem['kind'],
  limit: number
): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  for (const item of items) {
    if (item.kind !== kind) continue;
    if (!normalizeText(item.text)) continue;
    const key = groupKey(item);
    const existing = groups.get(key);
    if (existing) existing.duplicates.push(item);
    else groups.set(key, { item, duplicates: [] });
  }
  return [...groups.values()].slice(0, limit);
}

function duplicateRefs(
  group: ItemGroup
): { duplicates: MissionSummaryDuplicateDto[] } | Record<string, never> {
  if (group.duplicates.length === 0) return {};
  return {
    duplicates: group.duplicates.map(duplicate => ({
      id: duplicate.id,
      deliveryId: duplicate.deliveryId,
      objectiveId: duplicate.objectiveId,
      deliveredAt: duplicate.reportedAt
    }))
  };
}

function actionDto(item: MissionItem): MissionSummaryActionDto {
  return {
    ...item.detail,
    id: item.id,
    action: item.text,
    actionId: String(item.detail.actionId),
    category: item.detail.category as MissionSummaryActionDto['category'],
    source: item.detail.source as MissionSummaryActionDto['source'],
    deliveryId: item.deliveryId,
    objectiveId: item.objectiveId,
    deliveredAt: item.reportedAt
  };
}

function buildEvidence(runs: MissionSummaryRuns, items: MissionItem[]): MissionSummaryEvidenceDto {
  const actions = items
    .filter(item => item.kind === 'human_action')
    .map(actionDto)
    .sort((a, b) => Number(b.blocking === true) - Number(a.blocking === true));
  const sources: MissionSummarySourceDto[] = runs.latestByObjective.map(source => ({
    objectiveId: source.objectiveId,
    deliveryId: source.id,
    deliveredAt: source.deliveredAt
  }));
  return {
    actions: actions.slice(0, MISSION_SUMMARY_EVIDENCE_LIMIT),
    sources: sources.slice(0, MISSION_SUMMARY_EVIDENCE_LIMIT),
    totals: {
      actions: actions.length,
      sources: sources.length,
      currentRunDeliveries: runs.currentRun.length
    },
    truncated: {
      actions: actions.length > MISSION_SUMMARY_EVIDENCE_LIMIT,
      sources: sources.length > MISSION_SUMMARY_EVIDENCE_LIMIT
    }
  };
}

function projectSummary(
  row: MissionSummaryRow,
  items: MissionItem[],
  closed: MissionItem[]
): MissionSummaryDto {
  const risks: MissionSummaryRiskDto[] = groupOpenItems(
    items,
    'risk',
    MISSION_SUMMARY_LIMITS.risks
  ).map(group => ({
    id: group.item.id,
    deliveryId: group.item.deliveryId,
    objectiveId: group.item.objectiveId,
    deliveredAt: group.item.reportedAt,
    text: group.item.text,
    ...duplicateRefs(group)
  }));
  const suggestions: MissionSummarySuggestionDto[] = groupOpenItems(
    items,
    'suggestion',
    MISSION_SUMMARY_LIMITS.suggestions
  ).map(group => ({
    id: group.item.id,
    deliveryId: group.item.deliveryId,
    objectiveId: group.item.objectiveId,
    deliveredAt: group.item.reportedAt,
    actionId: group.item.itemRef,
    title: group.item.text,
    state: 'open',
    change: String(group.item.detail.change ?? ''),
    location: String(group.item.detail.location ?? ''),
    doneWhen: String(group.item.detail.doneWhen ?? ''),
    resolution: null,
    ...duplicateRefs(group)
  }));
  const generatedBy = row.generated_by as MissionSummaryDto['generatedBy'];
  return {
    missionId: row.mission_id,
    revision: Number(row.revision),
    contentRevision: Number(row.content_revision),
    status: row.status as MissionSummaryStatus,
    headline: row.headline,
    summary: row.summary_markdown,
    risks,
    suggestions,
    author: {
      kind: generatedBy,
      objectiveId: row.narrative_objective_id,
      deliveryId: row.narrative_delivery_id
    },
    closedItems: closed.map(item => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      objectiveId: item.objectiveId,
      status: item.status as 'done' | 'dismissed',
      reason: item.statusReason,
      resolvedBy: item.resolvedBy ? toResolverDto(item.resolvedBy, item.missionId) : null,
      resolvedAt: item.resolvedAt,
      outcome: item.outcome,
      outcomeRef: item.outcomeRef
    })),
    sourceDeliveryId: row.source_delivery_id,
    generatedBy,
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

/** Live cross-mission decisions only; the source delivery must still be visible. */
async function itemsWatermark(scope: MissionScope): Promise<string | null> {
  const row = await requireDatabaseClient().get<{ resolved_at: string }>(
    `SELECT mi.resolved_at FROM mission_items mi
     JOIN deliveries d ON d.id = mi.delivery_id AND d.deleted_at IS NULL
     WHERE mi.mission_id = ? AND mi.workspace_id = ?
       AND mi.status IN ('done', 'dismissed') AND mi.resolved_by_kind = 'agent'
       AND mi.resolved_by_mission_id <> mi.mission_id
     ORDER BY mi.resolved_at DESC LIMIT 1`,
    [scope.missionId, scope.workspaceId]
  );
  return row?.resolved_at ?? null;
}

/** `GET /api/missions/:id/summary`. Mission read authorization. */
export async function getMissionSummary(missionRef: string): Promise<MissionSummaryResponse> {
  const scope = await resolveMissionScope(missionRef);
  if (!scope.eligible) {
    return {
      eligible: false,
      summary: null,
      evidence: null,
      watermark: null,
      narrative: null,
      narrativeWatermark: null,
      itemsWatermark: null,
      itemsTruncated: false,
      seenAt: null
    };
  }
  const db = requireDatabaseClient();
  const [runs, openQuestionAt, summaryRow, seenAt, open, closed, narrative, itemStamp] =
    await Promise.all([
      readMissionSummaryRuns(db, scope.missionId, { workspaceId: scope.workspaceId }),
      latestOpenQuestionAt(scope),
      db.get(
        `SELECT mission_id, revision, content_revision, narrative_delivery_id, narrative_objective_id,
              status, headline, summary_markdown, source_delivery_id, generated_by, generated_at, model
         FROM mission_summaries
        WHERE mission_id = ? AND workspace_id = ?`,
        [scope.missionId, scope.workspaceId]
      ) as Promise<MissionSummaryRow | undefined>,
      loadSeenAt(scope),
      readMissionSummaryOpenItems(db, scope.missionId, scope.workspaceId),
      listMissionItems(db, {
        missionId: scope.missionId,
        workspaceId: scope.workspaceId,
        statuses: ['done', 'dismissed'],
        order: 'resolved',
        limit: 100
      }),
      readMissionNarrative(db, scope.missionId),
      itemsWatermark(scope)
    ]);
  return {
    eligible: true,
    summary: summaryRow ? projectSummary(summaryRow, open, closed.items) : null,
    evidence: buildEvidence(runs, open),
    // Every current-run delivery the response draws on is no newer than the
    // newest source, which is always the first (uncapped) source row.
    watermark: latestTimestamp(runs.latestByObjective[0]?.deliveredAt, openQuestionAt),
    narrative,
    // Last narrative text or basis change, acknowledged with the other groups
    // only once every group of this response was rendered.
    narrativeWatermark: narrative.changedAt,
    itemsWatermark: itemStamp,
    itemsTruncated: closed.truncated,
    seenAt
  };
}

/**
 * Upper bound a seen watermark may take: the newest evidence that could have
 * been displayed. Uses every live delivery, every question or choice request
 * of the mission, whatever its current status, and the retained last
 * narrative change (kept on the summary row even if its source is deleted), plus
 * live cross-mission agent closes, so a request answered or a
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
  const narrative = (await db.get(
    `SELECT narrative_changed_at FROM mission_summaries WHERE mission_id = ? AND workspace_id = ?`,
    [scope.missionId, scope.workspaceId]
  )) as { narrative_changed_at: string | null } | undefined;
  return latestTimestamp(
    delivery?.delivered_at,
    request?.created_at,
    narrative?.narrative_changed_at ?? null,
    await itemsWatermark(scope)
  );
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
