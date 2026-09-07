import type {
  DeliveryDto,
  FileChangeDto,
  ObjectiveDto,
  TerminalSessionDto
} from '../../shared/contract.ts';

/**
 * Everything one objective produced while it ran, grouped so the mission panel
 * can render it inside that objective's accordion (coo:879). Each list is
 * newest first, so index 0 is always the most recent run's evidence.
 */
export type ObjectiveEvidence = {
  objectiveId: string;
  /** Newest delivery first (`deliveredAt` descending). */
  deliveries: DeliveryDto[];
  /** Newest observation first (`createdAt` descending). */
  fileChanges: FileChangeDto[];
  /** Newest session first (`createdAt` descending). */
  terminalSessions: TerminalSessionDto[];
};

export type MissionEvidencePartition = {
  /** Evidence keyed by the id of a live objective on the mission. */
  byObjectiveId: Map<string, ObjectiveEvidence>;
  /**
   * Evidence whose objective is not on the mission any more — the objective was
   * soft-deleted, or the row predates objective-scoped evidence. Surfaced under
   * the mission-level "Unassigned evidence" fallback instead of dropped.
   */
  unassigned: ObjectiveEvidence;
};

const EMPTY_EVIDENCE: ObjectiveEvidence = Object.freeze({
  objectiveId: '',
  deliveries: [],
  fileChanges: [],
  terminalSessions: []
}) as ObjectiveEvidence;

function newestFirst<T>(items: readonly T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => at(b).localeCompare(at(a)));
}

function emptyEvidence(objectiveId: string): ObjectiveEvidence {
  return { objectiveId, deliveries: [], fileChanges: [], terminalSessions: [] };
}

/**
 * Partition a mission's deliveries, file changes, and terminal sessions by the
 * objective that produced them.
 *
 * Every evidence DTO already carries `objectiveId`, so no per-objective fetch is
 * needed: the mission-level queries are fetched once and split here. Pure and
 * synchronous so the panel can memoise it on the query results.
 */
export function partitionMissionEvidence({
  objectives,
  deliveries = [],
  fileChanges = [],
  terminalSessions = []
}: {
  objectives: readonly Pick<ObjectiveDto, 'id'>[];
  deliveries?: readonly DeliveryDto[];
  fileChanges?: readonly FileChangeDto[];
  terminalSessions?: readonly TerminalSessionDto[];
}): MissionEvidencePartition {
  const byObjectiveId = new Map<string, ObjectiveEvidence>(
    objectives.map(objective => [objective.id, emptyEvidence(objective.id)])
  );
  const unassigned = emptyEvidence('');

  const bucketFor = (objectiveId: string): ObjectiveEvidence =>
    byObjectiveId.get(objectiveId) ?? unassigned;

  for (const delivery of newestFirst(deliveries, item => item.deliveredAt)) {
    bucketFor(delivery.objectiveId).deliveries.push(delivery);
  }
  for (const fileChange of newestFirst(fileChanges, item => item.createdAt)) {
    bucketFor(fileChange.objectiveId).fileChanges.push(fileChange);
  }
  for (const session of newestFirst(terminalSessions, item => item.createdAt)) {
    bucketFor(session.objectiveId).terminalSessions.push(session);
  }

  return { byObjectiveId, unassigned };
}

/** The evidence for one objective, or an empty record when it produced none. */
export function evidenceForObjective(
  partition: MissionEvidencePartition | null | undefined,
  objectiveId: string
): ObjectiveEvidence {
  return partition?.byObjectiveId.get(objectiveId) ?? { ...EMPTY_EVIDENCE, objectiveId };
}

/**
 * Whether the objective has run before: it left at least one delivery, file
 * change, or terminal session. Drives the "Previous runs" strip on a reverted
 * draft and the guard that stops an emptied draft from deleting that history.
 */
export function objectiveHasHistory(evidence: ObjectiveEvidence | null | undefined): boolean {
  if (!evidence) return false;
  return (
    evidence.deliveries.length > 0 ||
    evidence.fileChanges.length > 0 ||
    evidence.terminalSessions.length > 0
  );
}

/** Whether any evidence lost its objective and needs the mission-level fallback. */
export function hasUnassignedEvidence(partition: MissionEvidencePartition): boolean {
  return objectiveHasHistory(partition.unassigned);
}

/**
 * Wall-clock duration of the objective's run as a compact label (`14m`,
 * `2h 05m`, `3d 4h`), or `null` when either end is missing or the range is
 * inverted. `startedAt` is first-wins and `completedAt` last-wins, so on a
 * re-run this spans every run — which is what "elapsed" means for the row.
 */
export function formatObjectiveElapsed({
  startedAt,
  completedAt
}: {
  startedAt: string | null | undefined;
  completedAt: string | null | undefined;
}): string | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const totalMinutes = Math.round((end - start) / 60_000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `${totalHours}h ${String(minutes).padStart(2, '0')}m`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}
