/**
 * The mission draft queue (coo:1274, contract ADR 0056).
 *
 * A mission's unstarted objectives — `draft` and `submitted` — form one ordered
 * queue. These helpers are the only sanctioned ways to move queued positions:
 * reordering the complete queued set, and moving a reopened objective to the
 * queue head. Both recycle the position *slots* the queued rows already hold, so
 * a `launching`, active or complete objective positioned between queued rows is
 * never moved, and mission position uniqueness holds.
 *
 * Callers serialize every write that can change a mission's queued set or its
 * positions (insert, delete, reorder, reopen) through
 * {@link lockMissionObjectiveQueue}. Lifecycle transitions out of the queue
 * (launch, complete) do not take the lock; reorder therefore writes positions
 * with state-checked updates and rolls back when a row left the queue mid-flight.
 */
import type { DatabaseClient } from '@overlord/database';

export const QUEUED_OBJECTIVE_STATES = ['draft', 'submitted'] as const;

export function isQueuedObjectiveState(state: string): boolean {
  return (QUEUED_OBJECTIVE_STATES as readonly string[]).includes(state);
}

/** Canonical selector order: `position`, then `created_at`, then `id`. */
export const OBJECTIVE_QUEUE_ORDER_SQL = 'position ASC, created_at ASC, id ASC';

export type QueueOrderRow = {
  id: string;
  position: number;
  state: string;
  created_at?: string | null;
};

export type ObjectiveQueueErrorCode =
  | 'not_array'
  | 'duplicate_ids'
  | 'unknown_objective'
  | 'not_queued'
  | 'incomplete_set';

export class ObjectiveQueueError extends Error {
  constructor(
    readonly code: ObjectiveQueueErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ObjectiveQueueError';
  }
}

/**
 * Serializes queue-shaping writes for one mission. On Postgres this takes a row
 * lock on the mission inside the caller's transaction (READ COMMITTED alone does
 * not stop a concurrent insert from racing a reorder). SQLite write transactions
 * are already serialized per handle by the client's mutex, so no extra lock is
 * needed there; callers still read the queued set inside their transaction.
 */
export async function lockMissionObjectiveQueue(
  db: DatabaseClient,
  missionId: string
): Promise<void> {
  if (db.dialect !== 'postgres') return;
  await db.get(`SELECT id FROM missions WHERE id = ? FOR UPDATE`, [missionId]);
}

function sortQueueRows<T extends QueueOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Plans a complete-set reorder. `orderedIds` must name every live queued
 * objective exactly once. Returns the new position per changed objective (empty
 * when the order is unchanged). Throws {@link ObjectiveQueueError}.
 */
export function planQueuedObjectiveReorder(
  rows: readonly QueueOrderRow[],
  orderedIds: unknown
): Map<string, number> {
  if (!Array.isArray(orderedIds) || orderedIds.some(id => typeof id !== 'string')) {
    throw new ObjectiveQueueError('not_array', 'orderedObjectiveIds must be an array of ids');
  }
  const ids = orderedIds as string[];
  if (new Set(ids).size !== ids.length) {
    throw new ObjectiveQueueError('duplicate_ids', 'orderedObjectiveIds contains duplicates');
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      throw new ObjectiveQueueError('unknown_objective', `Objective ${id} not found on mission`);
    }
    if (!isQueuedObjectiveState(row.state)) {
      throw new ObjectiveQueueError('not_queued', `Objective ${id} is not a queued objective`);
    }
  }
  const queued = sortQueueRows(rows.filter(row => isQueuedObjectiveState(row.state)));
  if (queued.length !== ids.length) {
    throw new ObjectiveQueueError(
      'incomplete_set',
      'orderedObjectiveIds must list every draft and submitted objective of the mission exactly once'
    );
  }
  const slots = queued.map(row => row.position);
  const plan = new Map<string, number>();
  ids.forEach((id, index) => {
    const slot = slots[index]!;
    if (byId.get(id)!.position !== slot) plan.set(id, slot);
  });
  return plan;
}

/**
 * Plans moving a reopened objective to the queue head. The movable set is the
 * reopened row plus every live queued row; their existing slots are sorted and
 * the reopened row takes the first, the queued rows the rest in their existing
 * relative order. When the reopened row already sits before the queue (or no
 * queue exists) nothing moves. Every other row keeps its position.
 */
export function planReopenToQueueHead(
  rows: readonly QueueOrderRow[],
  reopenedId: string
): Map<string, number> {
  const reopened = rows.find(row => row.id === reopenedId);
  if (!reopened) return new Map();
  const queued = sortQueueRows(
    rows.filter(row => row.id !== reopenedId && isQueuedObjectiveState(row.state))
  );
  if (queued.length === 0 || reopened.position < queued[0]!.position) return new Map();
  const slots = [reopened.position, ...queued.map(row => row.position)].sort((a, b) => a - b);
  const plan = new Map<string, number>();
  [reopened, ...queued].forEach((row, index) => {
    const slot = slots[index]!;
    if (row.position !== slot) plan.set(row.id, slot);
  });
  return plan;
}
