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

/**
 * One run of an objective: everything it produced between being set to draft
 * and (if it got that far) completing. Lists are newest first, like
 * {@link ObjectiveEvidence}.
 */
export type ObjectiveRun = {
  /** 1-based, oldest run first — the number the "Run 1 of 2" label prints. */
  number: number;
  /** How many runs the objective has, so a label can say "of N". */
  total: number;
  /** Whether this is the objective's most recent run. */
  latest: boolean;
  deliveries: DeliveryDto[];
  fileChanges: FileChangeDto[];
  terminalSessions: TerminalSessionDto[];
};

function parseTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function runHasEvidence(
  run: Pick<ObjectiveRun, 'deliveries' | 'fileChanges' | 'terminalSessions'>
) {
  return run.deliveries.length > 0 || run.fileChanges.length > 0 || run.terminalSessions.length > 0;
}

function emptyRun(): Pick<ObjectiveRun, 'deliveries' | 'fileChanges' | 'terminalSessions'> {
  return { deliveries: [], fileChanges: [], terminalSessions: [] };
}

/**
 * Split an objective's evidence into runs, newest first.
 *
 * The boundary is `objective.reopenedAt` (contract v133): the backend stamps
 * it when an objective that already executed is set back to draft, and it is
 * last-wins, so it always marks where the latest run begins. Rows stamped at
 * or after it are the latest run; rows before it are the earlier run. Because
 * the column keeps only the most recent reopen, an objective reopened more
 * than once shows every earlier run merged into one — an accepted limit of
 * the minimal boundary (plan §2.3 item 4 / open question 4). A follow-up
 * re-attach after delivery is not a reopen, so its deliveries stay in the
 * same run.
 *
 * When `reopenedAt` is null the objective predates the column (or was never
 * reopened), and the old inference applies as the fallback only: each delivery
 * opens a run, and a session or file change belongs to the run of the first
 * delivery stamped at or after it. Rows newer than the last delivery belong to
 * the latest run. With one or zero deliveries there is a single run.
 *
 * Runs that produced nothing are dropped, except that the latest run is kept
 * when `keepEmptyLatest` is set — a completed objective whose latest run left
 * no evidence still needs its empty states to render. A reverted draft passes
 * `false`, because its latest run has not happened yet.
 */
export function groupEvidenceByRun(
  evidence: ObjectiveEvidence,
  objective: Pick<ObjectiveDto, 'reopenedAt'>,
  { keepEmptyLatest = true }: { keepEmptyLatest?: boolean } = {}
): ObjectiveRun[] {
  const buckets: Array<ReturnType<typeof emptyRun>> = [];

  if (objective.reopenedAt) {
    const boundary = parseTime(objective.reopenedAt);
    const latest = emptyRun();
    const earlier = emptyRun();
    for (const delivery of evidence.deliveries) {
      (parseTime(delivery.deliveredAt) >= boundary ? latest : earlier).deliveries.push(delivery);
    }
    for (const fileChange of evidence.fileChanges) {
      (parseTime(fileChange.createdAt) >= boundary ? latest : earlier).fileChanges.push(fileChange);
    }
    for (const session of evidence.terminalSessions) {
      (parseTime(session.createdAt) >= boundary ? latest : earlier).terminalSessions.push(session);
    }
    buckets.push(latest, earlier);
  } else {
    // Fallback: infer boundaries from delivery order. `deliveries` is newest
    // first; bucket i belongs to deliveries[i].
    const deliveries = evidence.deliveries;
    if (deliveries.length <= 1) {
      buckets.push({
        deliveries: [...deliveries],
        fileChanges: [...evidence.fileChanges],
        terminalSessions: [...evidence.terminalSessions]
      });
    } else {
      const deliveredAt = deliveries.map(delivery => parseTime(delivery.deliveredAt));
      const bucketFor = (time: number): number => {
        // Oldest delivery first; the first one delivered at or after the row
        // is the run the row belongs to. Nothing qualifies → latest run.
        for (let index = deliveries.length - 1; index >= 0; index -= 1) {
          if (deliveredAt[index]! >= time) return index;
        }
        return 0;
      };
      for (const delivery of deliveries) {
        const run = emptyRun();
        run.deliveries.push(delivery);
        buckets.push(run);
      }
      for (const fileChange of evidence.fileChanges) {
        buckets[bucketFor(parseTime(fileChange.createdAt))]!.fileChanges.push(fileChange);
      }
      for (const session of evidence.terminalSessions) {
        buckets[bucketFor(parseTime(session.createdAt))]!.terminalSessions.push(session);
      }
    }
  }

  const kept = buckets.filter(
    (bucket, index) => runHasEvidence(bucket) || (index === 0 && keepEmptyLatest)
  );
  if (kept.length === 0 && keepEmptyLatest) kept.push(emptyRun());
  const total = kept.length;
  return kept.map((bucket, index) => ({
    number: total - index,
    total,
    latest: index === 0,
    ...bucket
  }));
}

/** The "Run 1 of 2" label for a run, or `null` for an objective that ran once. */
export function objectiveRunLabel(run: Pick<ObjectiveRun, 'number' | 'total'>): string | null {
  return run.total > 1 ? `Run ${run.number} of ${run.total}` : null;
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
 * Copy for a mission-level evidence fetch that returned a bounded page instead
 * of the full history. Null when `total` is not greater than `returned` — that
 * page is complete. The notice is mission-scoped because
 * {@link partitionMissionEvidence} splits one fetch across objectives, so a
 * truncated page under-reports several objectives at once.
 */
export function truncatedEvidenceNotice({
  returned,
  total,
  noun
}: {
  returned: number;
  total: number;
  noun: string;
}): string | null {
  if (total <= returned) return null;
  return `Showing newest ${returned} of ${total} ${noun} for this mission`;
}

export type ObjectiveEvidenceTruncation = {
  deliveries: string | null;
  fileChanges: string | null;
};

export const NO_EVIDENCE_TRUNCATION: ObjectiveEvidenceTruncation = {
  deliveries: null,
  fileChanges: null
};

/** Build the accordion notices from the mission-level delivery and file-change pages. */
export function evidenceTruncationFromPages({
  deliveries,
  fileChanges
}: {
  deliveries?: { items: readonly unknown[]; total: number } | null;
  fileChanges?: { items: readonly unknown[]; total: number } | null;
}): ObjectiveEvidenceTruncation {
  return {
    deliveries: truncatedEvidenceNotice({
      returned: deliveries?.items.length ?? 0,
      total: deliveries?.total ?? 0,
      noun: 'deliveries'
    }),
    fileChanges: truncatedEvidenceNotice({
      returned: fileChanges?.items.length ?? 0,
      total: fileChanges?.total ?? 0,
      noun: 'file changes'
    })
  };
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
