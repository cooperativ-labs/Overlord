import type { DeliveryReportPayloadV1, HumanActionV1 } from '@overlord/contract';
import { createHash } from 'node:crypto';

/**
 * Shared, storage-level half of `mission_items` (coo:1260, ADR 0060): the
 * closed vocabularies, the stable `item_ref` of each item, the derivation of a
 * delivery's items from its report, and the SQL that inserts rows and applies
 * the supersede rules.
 *
 * Two callers execute it: the core item service (`packages/core/service/
 * mission-items.ts`), which wraps every write with an `entity_changes` row, and
 * the migration runtime step (`mission-items-migration-runtime.ts`), which
 * backfills every live delivery. Keeping the derivation and the statements here
 * means the backfill and the live write path cannot produce different rows.
 *
 * Supersede rules (the stored form of the summary's current-run rule):
 * - A delivery replaces its objective's earlier deliveries for human actions:
 *   an `open` human action becomes `superseded` once a newer live delivery of
 *   the same objective exists (newer by `delivered_at`, then by id).
 * - Reopening an objective supersedes every `open` item reported before its
 *   `reopened_at`.
 * Risks and suggestions of earlier deliveries otherwise stay open. Only `open`
 * rows are ever superseded, so a person's or agent's decision is never lost.
 */

export const MISSION_ITEM_KINDS = ['risk', 'human_action', 'suggestion'] as const;
export type MissionItemKind = (typeof MISSION_ITEM_KINDS)[number];

export const MISSION_ITEM_STATUSES = ['open', 'done', 'dismissed', 'superseded'] as const;
export type MissionItemStatus = (typeof MISSION_ITEM_STATUSES)[number];

/** Statuses a person or an agent may close an item with. */
export const MISSION_ITEM_CLOSED_STATUSES = ['done', 'dismissed'] as const;
export type MissionItemClosedStatus = (typeof MISSION_ITEM_CLOSED_STATUSES)[number];

export const MISSION_ITEM_RESOLVER_KINDS = ['person', 'agent'] as const;
export type MissionItemResolverKind = (typeof MISSION_ITEM_RESOLVER_KINDS)[number];

export const MISSION_ITEM_OUTCOMES = ['mission_created', 'objective_added'] as const;
export type MissionItemOutcome = (typeof MISSION_ITEM_OUTCOMES)[number];

export const MISSION_ITEM_STATUS_REASON_MAX_LENGTH = 280;

/** One item derived from a delivery report, before it has a row id. */
export interface DerivedMissionItem {
  kind: MissionItemKind;
  itemRef: string;
  position: number;
  text: string;
  detail: Record<string, unknown>;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 16);
}

/** Lower-cased, whitespace-collapsed text: the identity of a risk. */
export function normaliseMissionItemText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The stable `item_ref` of an item inside its delivery.
 *
 * - suggestion: `DeferredWorkV1.id`, which is already a content digest and is
 *   never rewritten.
 * - risk: `risk-<digest of the normalised text>`.
 * - human action: `human_action-<digest>` of its provenance (`source`, the
 *   delivery-local id, `sourceRef`) and, for an agent action, the agent's own
 *   wording from `agentReport`. The composer may rephrase an action but keeps
 *   that provenance, so the reference survives recomposition.
 */
export function missionItemRef(
  item:
    | { kind: 'suggestion'; id: string }
    | { kind: 'risk'; text: string }
    | { kind: 'human_action'; action: HumanActionV1; agentText: string | null }
): string {
  switch (item.kind) {
    case 'suggestion':
      return item.id;
    case 'risk':
      return `risk-${digest(normaliseMissionItemText(item.text))}`;
    case 'human_action':
      return `human_action-${digest([
        item.action.source,
        item.action.id,
        item.action.sourceRef ?? null,
        item.agentText === null ? null : normaliseMissionItemText(item.agentText)
      ])}`;
  }
}

function humanActionDetail(action: HumanActionV1): Record<string, unknown> {
  const detail: Record<string, unknown> = { actionId: action.id, category: action.category };
  if (action.reason !== undefined) detail.reason = action.reason;
  if (action.blocking !== undefined) detail.blocking = action.blocking;
  if (action.command !== undefined) detail.command = action.command;
  if (action.verify !== undefined) detail.verify = action.verify;
  if (action.link !== undefined) detail.link = action.link;
  detail.source = action.source;
  if (action.sourceRef !== undefined) detail.sourceRef = action.sourceRef;
  return detail;
}

/**
 * The items a delivery reports, from its current presentation: the lists every
 * read surface shows. Order is presentation order per kind. A risk whose
 * normalised text repeats one earlier in the same delivery is skipped, as the
 * read surfaces already show it once.
 */
export function deriveMissionItems(report: DeliveryReportPayloadV1): DerivedMissionItem[] {
  const items: DerivedMissionItem[] = [];
  const agentText = new Map(
    report.agentReport.humanActions.map(action => [action.id, action.action] as const)
  );

  report.presentation.humanActions.forEach((action, position) => {
    items.push({
      kind: 'human_action',
      itemRef: missionItemRef({
        kind: 'human_action',
        action,
        agentText: action.source === 'agent' ? (agentText.get(action.id) ?? null) : null
      }),
      position,
      text: action.action,
      detail: humanActionDetail(action)
    });
  });

  const riskRefs = new Set<string>();
  report.presentation.knownRisks.forEach((risk, position) => {
    if (!risk.trim()) return;
    const itemRef = missionItemRef({ kind: 'risk', text: risk });
    if (riskRefs.has(itemRef)) return;
    riskRefs.add(itemRef);
    items.push({ kind: 'risk', itemRef, position, text: risk.trim(), detail: {} });
  });

  report.presentation.deferredWork.forEach((item, position) => {
    items.push({
      kind: 'suggestion',
      itemRef: missionItemRef({ kind: 'suggestion', id: item.id }),
      position,
      text: item.title,
      detail: { change: item.change, location: item.location, doneWhen: item.doneWhen }
    });
  });

  // A repeated human-action id would break the unique key; keep the first.
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.kind}:${item.itemRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The delivery a set of item rows belongs to. */
export interface MissionItemDeliveryScope {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  deliveredAt: string;
}

const MISSION_ITEM_INSERT_COLUMNS = `id, workspace_id, project_id, mission_id, objective_id, delivery_id,
    kind, item_ref, position, text, detail_json, status,
    reported_at, created_at, updated_at, revision`;
const MISSION_ITEM_INSERT_VALUES = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 1)`;

/** Bind parameters per row of {@link INSERT_MISSION_ITEM_SQL}. */
export const MISSION_ITEM_INSERT_PARAM_COUNT = 14;

/**
 * Inserts derived items as `open` rows, `rowCount` rows per statement. A row
 * that already exists for the same `(delivery_id, kind, item_ref)` is left
 * unchanged, which makes the backfill and a repeated delivery write idempotent.
 */
export function insertMissionItemsSql(rowCount: number): string {
  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error('insertMissionItemsSql needs at least one row');
  }
  return `INSERT INTO mission_items (
    ${MISSION_ITEM_INSERT_COLUMNS}
  ) VALUES ${Array.from({ length: rowCount }, () => MISSION_ITEM_INSERT_VALUES).join(',\n    ')}
  ON CONFLICT (delivery_id, kind, item_ref) DO NOTHING`;
}

/** {@link insertMissionItemsSql} for one row. */
export const INSERT_MISSION_ITEM_SQL = insertMissionItemsSql(1);

export function insertMissionItemParams({
  id,
  delivery,
  item,
  now
}: {
  id: string;
  delivery: MissionItemDeliveryScope;
  item: DerivedMissionItem;
  now: string;
}): unknown[] {
  return [
    id,
    delivery.workspaceId,
    delivery.projectId,
    delivery.missionId,
    delivery.objectiveId,
    delivery.id,
    item.kind,
    item.itemRef,
    item.position,
    item.text,
    JSON.stringify(item.detail),
    delivery.deliveredAt,
    now,
    now
  ];
}

/**
 * Predicate over `mission_items` for open human actions whose objective has a
 * newer live delivery. It compares the item's own delivery row, not the copied
 * `reported_at`, and breaks ties on `delivered_at` by delivery id, matching the
 * newest-first order of the summary readers.
 */
export const REPLACED_HUMAN_ACTION_PREDICATE_SQL = `mission_items.status = 'open'
  AND mission_items.kind = 'human_action'
  AND EXISTS (
    SELECT 1
      FROM deliveries own
      JOIN deliveries newer ON newer.objective_id = own.objective_id
     WHERE own.id = mission_items.delivery_id
       AND newer.deleted_at IS NULL
       AND newer.id <> own.id
       AND (newer.delivered_at > own.delivered_at
            OR (newer.delivered_at = own.delivered_at AND newer.id > own.id))
  )`;

/**
 * Predicate over `mission_items` for open items whose delivery was made before
 * its objective's `reopened_at`: the complement of the summary readers'
 * current-run rule (`delivered_at >= reopened_at`).
 */
export const REOPENED_ITEM_PREDICATE_SQL = `mission_items.status = 'open'
  AND EXISTS (
    SELECT 1
      FROM deliveries own
      JOIN objectives reopened ON reopened.id = own.objective_id
     WHERE own.id = mission_items.delivery_id
       AND reopened.reopened_at IS NOT NULL
       AND own.delivered_at < reopened.reopened_at
  )`;

/** Both supersede rules as one predicate. */
export const SUPERSEDED_ITEM_PREDICATE_SQL = `((${REPLACED_HUMAN_ACTION_PREDICATE_SQL})
  OR (${REOPENED_ITEM_PREDICATE_SQL}))`;

/**
 * Marks matching rows superseded. `predicate` is one of the predicates above,
 * optionally narrowed with a trusted `AND mission_items.<column> = ?` clause.
 */
export function supersedeMissionItemsSql(predicate: string): string {
  return `UPDATE mission_items
     SET status = 'superseded', updated_at = ?, revision = revision + 1
   WHERE ${predicate}`;
}

/**
 * Copies every `human_action_resolutions` row onto the open suggestion row it
 * names (same delivery, `item_ref` = `action_id`). Used once, by the backfill;
 * a row with no matching suggestion is skipped.
 */
export const COPY_HUMAN_ACTION_RESOLUTIONS_SQL = `UPDATE mission_items
   SET status = r.status,
       resolved_by_kind = 'person',
       resolved_by_workspace_user_id = r.resolved_by_workspace_user_id,
       outcome = CASE WHEN r.status = 'done' THEN r.outcome ELSE NULL END,
       outcome_ref = CASE WHEN r.status = 'done' AND r.outcome IS NOT NULL
                          THEN r.outcome_ref ELSE NULL END,
       resolved_at = r.resolved_at,
       updated_at = ?,
       revision = mission_items.revision + 1
  FROM human_action_resolutions r
 WHERE mission_items.delivery_id = r.delivery_id
   AND mission_items.kind = 'suggestion'
   AND mission_items.item_ref = r.action_id
   AND mission_items.status = 'open'
   AND r.status IN ('done', 'dismissed')`;
