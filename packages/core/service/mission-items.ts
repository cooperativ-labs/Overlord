import type { ChangeOperation, DeliveryReportPayloadV1 } from '@overlord/contract';
import {
  type DatabaseClient,
  type DerivedMissionItem,
  deriveMissionItems,
  INSERT_MISSION_ITEM_SQL,
  insertMissionItemParams,
  MISSION_ITEM_CLOSED_STATUSES,
  MISSION_ITEM_KINDS,
  MISSION_ITEM_OUTCOMES,
  MISSION_ITEM_STATUS_REASON_MAX_LENGTH,
  MISSION_ITEM_STATUSES,
  type MissionItemClosedStatus,
  type MissionItemDeliveryScope,
  type MissionItemKind,
  type MissionItemOutcome,
  type MissionItemStatus,
  SUPERSEDED_ITEM_PREDICATE_SQL
} from '@overlord/database';

import { type EntityChangeFields, insertEntityChange } from './change-feed.js';
import { ServiceError } from './errors.js';
import { newId, nowIso, sqlPlaceholders } from './util.js';

/**
 * The item service for `mission_items` (coo:1260, ADR 0060): the one owner of
 * item lifecycle. Risks, human actions and suggestions a delivery reports are
 * rows here with a status; a person's decision and an agent's decision are
 * written to the same row.
 *
 * Every write runs in the caller's transaction (or its own) and appends one
 * `entity_changes` row per changed item with `entity_type = 'mission_item'`,
 * so panels and delivery cards refresh. Row derivation, the insert statement
 * and the supersede predicates come from `@overlord/database`, which the
 * migration backfill executes too.
 *
 * Lifecycle:
 * - write: {@link insertDeliveryMissionItems} at delivery;
 *   {@link reconcileDeliveryMissionItems} when the composed or fallback
 *   presentation is saved;
 * - supersede: {@link applyMissionItemSupersedeRules} after a delivery or an
 *   objective reopen;
 * - close and restore: {@link closeMissionItem}, {@link restoreMissionItem};
 * - read: {@link listMissionItems}, the single definition of "open".
 */

export type MissionItemChangeAttribution = Pick<
  EntityChangeFields,
  'actorWorkspaceUserId' | 'actorTokenId' | 'source'
>;

export type MissionItemResolver =
  | { kind: 'person'; workspaceUserId: string | null }
  | { kind: 'agent'; objectiveId: string | null; deliveryId: string | null };

export interface MissionItem {
  id: string;
  workspaceId: string;
  projectId: string;
  missionId: string;
  objectiveId: string;
  deliveryId: string;
  kind: MissionItemKind;
  itemRef: string;
  position: number;
  text: string;
  detail: Record<string, unknown>;
  status: MissionItemStatus;
  statusReason: string | null;
  resolvedBy: MissionItemResolver | null;
  outcome: MissionItemOutcome | null;
  outcomeRef: string | null;
  resolvedAt: string | null;
  reportedAt: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

interface MissionItemRow {
  id: string;
  workspace_id: string;
  project_id: string;
  mission_id: string;
  objective_id: string;
  delivery_id: string;
  kind: string;
  item_ref: string;
  position: number | string;
  text: string;
  detail_json: unknown;
  status: string;
  status_reason: string | null;
  resolved_by_kind: string | null;
  resolved_by_workspace_user_id: string | null;
  resolved_by_objective_id: string | null;
  resolved_by_delivery_id: string | null;
  outcome: string | null;
  outcome_ref: string | null;
  resolved_at: string | null;
  reported_at: string;
  created_at: string;
  updated_at: string;
  revision: number | string;
}

const ITEM_COLUMNS = `mission_items.id, mission_items.workspace_id, mission_items.project_id,
  mission_items.mission_id, mission_items.objective_id, mission_items.delivery_id,
  mission_items.kind, mission_items.item_ref, mission_items.position, mission_items.text,
  mission_items.detail_json, mission_items.status, mission_items.status_reason,
  mission_items.resolved_by_kind, mission_items.resolved_by_workspace_user_id,
  mission_items.resolved_by_objective_id, mission_items.resolved_by_delivery_id,
  mission_items.outcome, mission_items.outcome_ref, mission_items.resolved_at,
  mission_items.reported_at, mission_items.created_at, mission_items.updated_at,
  mission_items.revision`;

function parseDetail(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toResolver(row: MissionItemRow): MissionItemResolver | null {
  if (row.resolved_by_kind === 'person') {
    return { kind: 'person', workspaceUserId: row.resolved_by_workspace_user_id };
  }
  if (row.resolved_by_kind === 'agent') {
    return {
      kind: 'agent',
      objectiveId: row.resolved_by_objective_id,
      deliveryId: row.resolved_by_delivery_id
    };
  }
  return null;
}

function toMissionItem(row: MissionItemRow): MissionItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    missionId: row.mission_id,
    objectiveId: row.objective_id,
    deliveryId: row.delivery_id,
    kind: row.kind as MissionItemKind,
    itemRef: row.item_ref,
    position: Number(row.position),
    text: row.text,
    detail: parseDetail(row.detail_json),
    status: row.status as MissionItemStatus,
    statusReason: row.status_reason,
    resolvedBy: toResolver(row),
    outcome: (row.outcome as MissionItemOutcome | null) ?? null,
    outcomeRef: row.outcome_ref,
    resolvedAt: row.resolved_at,
    reportedAt: row.reported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision)
  };
}

async function recordItemChange(
  db: DatabaseClient,
  item: Pick<MissionItem, 'id' | 'workspaceId' | 'projectId' | 'missionId' | 'objectiveId'>,
  operation: ChangeOperation,
  entityRevision: number | null,
  changedFields: string[],
  attribution: MissionItemChangeAttribution
): Promise<void> {
  await insertEntityChange(db, {
    entityType: 'mission_item',
    entityId: item.id,
    operation,
    entityRevision,
    projectId: item.projectId,
    missionId: item.missionId,
    objectiveId: item.objectiveId,
    workspaceId: item.workspaceId,
    changedFields,
    ...attribution
  });
}

async function readItemsByIds(db: DatabaseClient, ids: string[]): Promise<MissionItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.all<MissionItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM mission_items WHERE mission_items.id IN (${sqlPlaceholders(ids.length)})`,
    ids
  );
  return rows.map(toMissionItem);
}

/** One item by id, or null. Authorization is the caller's. */
export async function getMissionItem(db: DatabaseClient, id: string): Promise<MissionItem | null> {
  const [item] = await readItemsByIds(db, [id]);
  return item ?? null;
}

async function insertDerivedItem(
  db: DatabaseClient,
  delivery: MissionItemDeliveryScope,
  item: DerivedMissionItem,
  attribution: MissionItemChangeAttribution,
  now: string
): Promise<string | null> {
  const id = newId();
  const result = await db.run(
    INSERT_MISSION_ITEM_SQL,
    insertMissionItemParams({ id, delivery, item, now })
  );
  if (result.changes === 0) return null;
  await recordItemChange(
    db,
    {
      id,
      workspaceId: delivery.workspaceId,
      projectId: delivery.projectId,
      missionId: delivery.missionId,
      objectiveId: delivery.objectiveId
    },
    'insert',
    1,
    ['status', 'text'],
    attribution
  );
  return id;
}

/**
 * Applies both supersede rules to the open items of one objective: open human
 * actions of its earlier deliveries once a newer live delivery exists, and every
 * open item reported before its `reopened_at`. Call it after a delivery is
 * inserted and after an objective is reopened. Returns the ids it superseded.
 */
export async function applyMissionItemSupersedeRules(
  db: DatabaseClient,
  {
    objectiveId,
    attribution,
    now = nowIso()
  }: { objectiveId: string; attribution: MissionItemChangeAttribution; now?: string }
): Promise<string[]> {
  return db.transaction(async tx => {
    const candidates = await tx.all<{ id: string }>(
      `SELECT mission_items.id FROM mission_items
        WHERE mission_items.objective_id = ? AND ${SUPERSEDED_ITEM_PREDICATE_SQL}`,
      [objectiveId]
    );
    const superseded: string[] = [];
    for (const { id } of candidates) {
      const updated = await tx.run(
        `UPDATE mission_items
            SET status = 'superseded', updated_at = ?, revision = revision + 1
          WHERE id = ? AND status = 'open'`,
        [now, id]
      );
      if (updated.changes === 0) continue;
      superseded.push(id);
    }
    for (const item of await readItemsByIds(tx, superseded)) {
      await recordItemChange(tx, item, 'update', item.revision, ['status'], attribution);
    }
    return superseded;
  });
}

/**
 * Inserts the items of a new delivery as `open` rows and supersedes the
 * objective's earlier open human actions. Idempotent: an item already stored
 * for the delivery is left unchanged.
 */
export async function insertDeliveryMissionItems(
  db: DatabaseClient,
  {
    delivery,
    report,
    attribution,
    now = nowIso()
  }: {
    delivery: MissionItemDeliveryScope;
    report: DeliveryReportPayloadV1;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<{ inserted: string[]; superseded: string[] }> {
  return db.transaction(async tx => {
    const inserted: string[] = [];
    for (const item of deriveMissionItems(report)) {
      const id = await insertDerivedItem(tx, delivery, item, attribution, now);
      if (id) inserted.push(id);
    }
    const superseded = await applyMissionItemSupersedeRules(tx, {
      objectiveId: delivery.objectiveId,
      attribution,
      now
    });
    return { inserted, superseded };
  });
}

function sameDetail(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const canonical = (value: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(value)
        .sort()
        .map(key => [key, value[key]])
    );
  return canonical(left) === canonical(right);
}

/**
 * Reconciles a delivery's rows with a later presentation (the composed or
 * fallback one). Rows are matched on `(kind, item_ref)`: a matched row takes the
 * new text, position and detail whatever its status; a new item is inserted
 * `open` (for example a `deterministic_rule` action); an `open` row the
 * presentation no longer lists is deleted. A row someone closed, or one that
 * was superseded, is never deleted. The supersede rules then run for the
 * objective, so an item added to a delivery that is no longer current is
 * superseded at once.
 */
export async function reconcileDeliveryMissionItems(
  db: DatabaseClient,
  {
    delivery,
    report,
    attribution,
    now = nowIso()
  }: {
    delivery: MissionItemDeliveryScope;
    report: DeliveryReportPayloadV1;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<{ inserted: string[]; updated: string[]; deleted: string[]; superseded: string[] }> {
  return db.transaction(async tx => {
    const existing = (
      await tx.all<MissionItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM mission_items WHERE mission_items.delivery_id = ?`,
        [delivery.id]
      )
    ).map(toMissionItem);
    const byKey = new Map(existing.map(item => [`${item.kind}:${item.itemRef}`, item]));
    const derived = deriveMissionItems(report);
    const derivedKeys = new Set(derived.map(item => `${item.kind}:${item.itemRef}`));

    const deleted: string[] = [];
    for (const item of existing) {
      if (item.status !== 'open' || derivedKeys.has(`${item.kind}:${item.itemRef}`)) continue;
      const removed = await tx.run(`DELETE FROM mission_items WHERE id = ? AND status = 'open'`, [
        item.id
      ]);
      if (removed.changes === 0) continue;
      deleted.push(item.id);
      await recordItemChange(tx, item, 'delete', null, ['status'], attribution);
    }

    const inserted: string[] = [];
    const updated: string[] = [];
    for (const item of derived) {
      const current = byKey.get(`${item.kind}:${item.itemRef}`);
      if (!current) {
        const id = await insertDerivedItem(tx, delivery, item, attribution, now);
        if (id) inserted.push(id);
        continue;
      }
      const changedFields = [
        ...(current.text === item.text ? [] : ['text']),
        ...(current.position === item.position ? [] : ['position']),
        ...(sameDetail(current.detail, item.detail) ? [] : ['detail_json'])
      ];
      if (changedFields.length === 0) continue;
      await tx.run(
        `UPDATE mission_items
            SET text = ?, position = ?, detail_json = ?, updated_at = ?, revision = revision + 1
          WHERE id = ?`,
        [item.text, item.position, JSON.stringify(item.detail), now, current.id]
      );
      updated.push(current.id);
      await recordItemChange(
        tx,
        current,
        'update',
        current.revision + 1,
        changedFields,
        attribution
      );
    }

    const superseded = await applyMissionItemSupersedeRules(tx, {
      objectiveId: delivery.objectiveId,
      attribution,
      now
    });
    return { inserted, updated, deleted, superseded };
  });
}

export type MissionItemWriteProblem =
  /** No item with this id. */
  | 'not_found'
  /** The item belongs to a mission other than the one the caller is scoped to. */
  | 'other_mission'
  /** The item is not in a status this caller may change it from. */
  | 'not_open'
  /** Superseded items can be neither closed nor restored. */
  | 'superseded';

export type MissionItemWriteResult =
  | { ok: true; item: MissionItem; changed: boolean }
  | { ok: false; problem: MissionItemWriteProblem; item: MissionItem | null };

function invalidInput(message: string): ServiceError {
  return new ServiceError(message, 'invalid_input', 400);
}

function normaliseReason(reason: string | null | undefined, required: boolean): string | null {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed) {
    if (required) throw invalidInput('A reason is required to close an item.');
    return null;
  }
  if (trimmed.length > MISSION_ITEM_STATUS_REASON_MAX_LENGTH) {
    throw invalidInput(
      `A reason must be at most ${MISSION_ITEM_STATUS_REASON_MAX_LENGTH} characters.`
    );
  }
  return trimmed;
}

async function scopedItem(
  db: DatabaseClient,
  itemId: string,
  missionId: string | undefined
): Promise<MissionItemWriteResult | MissionItem> {
  const item = await getMissionItem(db, itemId);
  if (!item) return { ok: false, problem: 'not_found', item: null };
  if (missionId !== undefined && item.missionId !== missionId) {
    return { ok: false, problem: 'other_mission', item };
  }
  return item;
}

/**
 * Closes an item as `done` or `dismissed`.
 *
 * - An agent closes only `open` items, always with a reason, and records the
 *   delivering objective and delivery. A superseded item is refused.
 * - A person may close an item in any status, as the delivery card has always
 *   allowed: re-deciding a closed item, or deciding a suggestion of a delivery
 *   made before its objective reopened (a superseded row). The reason is
 *   optional. A suggestion promoted into a mission or objective is closed
 *   `done` with an `outcome`.
 *
 * `missionId`, when given, limits the write to that mission's items. A refused
 * write changes nothing and reports why; invalid input throws `invalid_input`.
 */
export async function closeMissionItem(
  db: DatabaseClient,
  {
    itemId,
    missionId,
    status,
    reason,
    resolver,
    outcome = null,
    outcomeRef = null,
    attribution,
    now = nowIso()
  }: {
    itemId: string;
    missionId?: string;
    status: MissionItemClosedStatus;
    reason?: string | null;
    resolver: MissionItemResolver;
    outcome?: MissionItemOutcome | null;
    outcomeRef?: string | null;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<MissionItemWriteResult> {
  if (!(MISSION_ITEM_CLOSED_STATUSES as readonly string[]).includes(status)) {
    throw invalidInput("status must be 'done' or 'dismissed'");
  }
  const statusReason = normaliseReason(reason, resolver.kind === 'agent');
  if (outcome !== null) {
    if (!(MISSION_ITEM_OUTCOMES as readonly string[]).includes(outcome)) {
      throw invalidInput("outcome must be 'mission_created' or 'objective_added'");
    }
    if (status !== 'done') throw invalidInput("outcome requires status 'done'");
  }
  if (outcomeRef !== null && (outcome === null || !outcomeRef.trim())) {
    throw invalidInput('outcomeRef requires an outcome and a non-empty display id');
  }

  return db.transaction(async tx => {
    const scoped = await scopedItem(tx, itemId, missionId);
    if ('ok' in scoped) return scoped;
    const from: readonly MissionItemStatus[] =
      resolver.kind === 'agent' ? ['open'] : MISSION_ITEM_STATUSES;
    if (!from.includes(scoped.status)) {
      return {
        ok: false,
        problem: scoped.status === 'superseded' ? 'superseded' : 'not_open',
        item: scoped
      };
    }

    const updated = await tx.run(
      `UPDATE mission_items
          SET status = ?, status_reason = ?, resolved_by_kind = ?,
              resolved_by_workspace_user_id = ?, resolved_by_objective_id = ?,
              resolved_by_delivery_id = ?, outcome = ?, outcome_ref = ?, resolved_at = ?,
              updated_at = ?, revision = revision + 1
        WHERE id = ? AND status IN (${sqlPlaceholders(from.length)})`,
      [
        status,
        statusReason,
        resolver.kind,
        resolver.kind === 'person' ? resolver.workspaceUserId : null,
        resolver.kind === 'agent' ? resolver.objectiveId : null,
        resolver.kind === 'agent' ? resolver.deliveryId : null,
        outcome,
        outcome === null ? null : (outcomeRef?.trim() ?? null),
        now,
        now,
        itemId,
        ...from
      ]
    );
    if (updated.changes === 0) return { ok: false, problem: 'not_open', item: scoped };
    const item = (await getMissionItem(tx, itemId))!;
    await recordItemChange(
      tx,
      item,
      'update',
      item.revision,
      ['status', 'status_reason', 'resolved_by', 'outcome'],
      attribution
    );
    return { ok: true, item, changed: true };
  });
}

/**
 * Restores a closed item to `open` and clears who closed it, why and how, then
 * re-applies the supersede rules to its objective: an item of a delivery that
 * is no longer current returns to `superseded`, not to the open lists. An item
 * that is already open is returned unchanged; a superseded item cannot be
 * restored.
 */
export async function restoreMissionItem(
  db: DatabaseClient,
  {
    itemId,
    missionId,
    attribution,
    now = nowIso()
  }: {
    itemId: string;
    missionId?: string;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<MissionItemWriteResult> {
  return db.transaction(async tx => {
    const scoped = await scopedItem(tx, itemId, missionId);
    if ('ok' in scoped) return scoped;
    if (scoped.status === 'open') return { ok: true, item: scoped, changed: false };
    if (scoped.status === 'superseded') return { ok: false, problem: 'superseded', item: scoped };

    const updated = await tx.run(
      `UPDATE mission_items
          SET status = 'open', status_reason = NULL, resolved_by_kind = NULL,
              resolved_by_workspace_user_id = NULL, resolved_by_objective_id = NULL,
              resolved_by_delivery_id = NULL, outcome = NULL, outcome_ref = NULL,
              resolved_at = NULL, updated_at = ?, revision = revision + 1
        WHERE id = ? AND status IN ('done', 'dismissed')`,
      [now, itemId]
    );
    if (updated.changes === 0) return { ok: false, problem: 'not_open', item: scoped };
    const restored = (await getMissionItem(tx, itemId))!;
    await recordItemChange(
      tx,
      restored,
      'update',
      restored.revision,
      ['status', 'status_reason', 'resolved_by', 'outcome'],
      attribution
    );
    await applyMissionItemSupersedeRules(tx, {
      objectiveId: restored.objectiveId,
      attribution,
      now
    });
    const item = (await getMissionItem(tx, itemId))!;
    return { ok: true, item, changed: true };
  });
}

/**
 * Repoints the denormalized `project_id` of every item of a mission after the
 * mission moved to another project, with one `mission_item` change per item.
 */
export async function repointMissionItemsProject(
  db: DatabaseClient,
  {
    missionId,
    workspaceId,
    projectId,
    attribution,
    now = nowIso()
  }: {
    missionId: string;
    workspaceId: string;
    projectId: string;
    attribution: MissionItemChangeAttribution;
    now?: string;
  }
): Promise<number> {
  return db.transaction(async tx => {
    const ids = (
      await tx.all<{ id: string }>(
        `SELECT id FROM mission_items
          WHERE mission_id = ? AND workspace_id = ? AND project_id <> ?`,
        [missionId, workspaceId, projectId]
      )
    ).map(row => row.id);
    if (ids.length === 0) return 0;
    await tx.run(
      `UPDATE mission_items
          SET project_id = ?, updated_at = ?, revision = revision + 1
        WHERE mission_id = ? AND workspace_id = ? AND project_id <> ?`,
      [projectId, now, missionId, workspaceId, projectId]
    );
    for (const item of await readItemsByIds(tx, ids)) {
      await recordItemChange(tx, item, 'update', item.revision, ['project_id'], attribution);
    }
    return ids.length;
  });
}

/**
 * The items of the given deliveries in the given kinds, every status, keyed by
 * delivery then report order. The delivery card's read: it shows each item of a
 * delivery with its decision, whether or not the item is still open.
 */
export async function listDeliveryMissionItems(
  db: DatabaseClient,
  {
    deliveryIds,
    kinds = MISSION_ITEM_KINDS
  }: { deliveryIds: readonly string[]; kinds?: readonly MissionItemKind[] }
): Promise<MissionItem[]> {
  const ids = [...new Set(deliveryIds)];
  if (ids.length === 0 || kinds.length === 0) return [];
  const rows = await db.all<MissionItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM mission_items
      WHERE mission_items.delivery_id IN (${sqlPlaceholders(ids.length)})
        AND mission_items.kind IN (${sqlPlaceholders(kinds.length)})
      ORDER BY mission_items.delivery_id ASC, mission_items.kind ASC, mission_items.position ASC`,
    [...ids, ...kinds]
  );
  return rows.map(toMissionItem);
}

export const MISSION_ITEMS_DEFAULT_LIMIT = 200;
export const MISSION_ITEMS_MAX_LIMIT = 1_000;

export type ListMissionItemsScope =
  | { missionId: string; projectId?: never }
  | { projectId: string; missionId?: never };

/**
 * The single read of items: the items of one mission or one project, in the
 * given kinds and statuses (default: every kind, `open` only), newest delivery
 * first and then in report order. Items of a deleted delivery are never
 * returned. `workspaceId` additionally scopes the read to one workspace;
 * authorization is the caller's. `truncated` reports whether more rows matched
 * than `limit`.
 */
export async function listMissionItems(
  db: DatabaseClient,
  scope: ListMissionItemsScope & {
    workspaceId?: string;
    kinds?: readonly MissionItemKind[];
    statuses?: readonly MissionItemStatus[];
    limit?: number;
    order?: 'reported' | 'resolved' | 'blocking';
    offset?: number;
  }
): Promise<{ items: MissionItem[]; truncated: boolean; total: number }> {
  const kinds = scope.kinds ?? MISSION_ITEM_KINDS;
  const statuses = scope.statuses ?? ['open'];
  if (kinds.length === 0 || statuses.length === 0) return { items: [], truncated: false, total: 0 };
  for (const kind of kinds) {
    if (!(MISSION_ITEM_KINDS as readonly string[]).includes(kind)) {
      throw invalidInput(`Unknown mission item kind '${kind}'`);
    }
  }
  for (const status of statuses) {
    if (!(MISSION_ITEM_STATUSES as readonly string[]).includes(status)) {
      throw invalidInput(`Unknown mission item status '${status}'`);
    }
  }
  const limit = Math.min(
    Math.max(1, Math.floor(scope.limit ?? MISSION_ITEMS_DEFAULT_LIMIT)),
    MISSION_ITEMS_MAX_LIMIT
  );

  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.missionId !== undefined) {
    where.push('mission_items.mission_id = ?');
    params.push(scope.missionId);
  } else {
    where.push('mission_items.project_id = ?');
    params.push(scope.projectId);
  }
  where.push(`mission_items.status IN (${sqlPlaceholders(statuses.length)})`);
  params.push(...statuses);
  where.push(`mission_items.kind IN (${sqlPlaceholders(kinds.length)})`);
  params.push(...kinds);
  if (scope.workspaceId !== undefined) {
    where.push('mission_items.workspace_id = ?');
    params.push(scope.workspaceId);
  }

  const count = await db.get<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM mission_items
       JOIN deliveries d ON d.id = mission_items.delivery_id AND d.deleted_at IS NULL
      WHERE ${where.join(' AND ')}`,
    params
  );
  const rows = await db.all<MissionItemRow>(
    `SELECT ${ITEM_COLUMNS}
       FROM mission_items
       JOIN deliveries d ON d.id = mission_items.delivery_id AND d.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY ${scope.order === 'blocking' ? `CASE WHEN mission_items.kind = 'human_action' AND ${db.dialect === 'postgres' ? "(mission_items.detail_json::jsonb ->> 'blocking') = 'true'" : "json_extract(mission_items.detail_json, '$.blocking') = 1"} THEN 0 ELSE 1 END,` : ''}
               ${scope.order === 'resolved' ? 'mission_items.resolved_at DESC, mission_items.id DESC,' : ''}
               d.delivered_at DESC, mission_items.delivery_id DESC,
               mission_items.kind ASC, mission_items.position ASC, mission_items.id ASC
      LIMIT ? OFFSET ?`,
    [...params, limit + 1, Math.max(0, Math.floor(scope.offset ?? 0))]
  );
  return {
    items: rows.slice(0, limit).map(toMissionItem),
    total: Number(count?.total ?? 0),
    truncated: rows.length > limit
  };
}
