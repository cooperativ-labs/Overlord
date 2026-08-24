import type {
  ActivityFeedItemDto,
  ActivityFeedItemKind,
  ActivityFeedMissionItemDto,
  ActivityFeedQuestionItemDto,
  ObjectiveState
} from '../../../shared/contract.ts';

/** The kinds the feed renders, in the order their chips appear. */
export const FEED_KINDS: ActivityFeedItemKind[] = ['mission_run', 'blocking_question'];

export const FEED_KIND_LABELS: Record<ActivityFeedItemKind, string> = {
  mission_run: 'Running',
  blocking_question: 'Questions'
};

export function isMissionItem(item: ActivityFeedItemDto): item is ActivityFeedMissionItemDto {
  return item.kind === 'mission_run';
}

export function isQuestionItem(item: ActivityFeedItemDto): item is ActivityFeedQuestionItemDto {
  return item.kind === 'blocking_question';
}

/** Objective states that are live work, and so carry the executing shimmer. */
const IN_FLIGHT_OBJECTIVE_STATES: ReadonlySet<ObjectiveState> = new Set([
  'executing',
  'pending_delivery'
]);

export function isInFlightObjectiveState(state: ObjectiveState): boolean {
  return IN_FLIGHT_OBJECTIVE_STATES.has(state);
}

export interface FeedFilters {
  /** Kinds the operator has switched on. An empty set means "show nothing". */
  kinds: Set<string>;
  /** `null` means every project. */
  projectId: string | null;
}

/**
 * Filtering is a pure list operation so the chip behavior can be tested without
 * mounting the feed. Items whose `kind` the client does not know are dropped
 * rather than rendered blank — `ActivityFeedItemKind` is an open vocabulary.
 */
export function filterFeedItems(
  items: ActivityFeedItemDto[],
  filters: FeedFilters
): ActivityFeedItemDto[] {
  return items.filter(item => {
    if (!FEED_KINDS.includes(item.kind as ActivityFeedItemKind)) return false;
    if (!filters.kinds.has(item.kind)) return false;
    if (filters.projectId && item.projectId !== filters.projectId) return false;
    return true;
  });
}

export interface FeedProjectOption {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  count: number;
}

/** Projects actually represented in the feed, most active first, for the project chip. */
export function feedProjectOptions(items: ActivityFeedItemDto[]): FeedProjectOption[] {
  const byId = new Map<string, FeedProjectOption>();
  for (const item of items) {
    const existing = byId.get(item.projectId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byId.set(item.projectId, {
      projectId: item.projectId,
      projectName: item.projectName,
      projectColor: item.projectColor,
      count: 1
    });
  }
  return [...byId.values()].sort(
    (a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName)
  );
}

/**
 * Compact "how long ago" label. Rendered against the server's `generatedAt` rather
 * than the browser clock so a skewed client does not report negative elapsed time.
 */
export function relativeTime(iso: string | null, nowIso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(then) || Number.isNaN(now)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Elapsed duration for a still-running objective, e.g. `12m` or `2h 05m`. */
export function elapsedLabel(startedAt: string | null, nowIso: string): string {
  if (!startedAt) return '';
  const started = new Date(startedAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(started) || Number.isNaN(now)) return '';
  const totalMinutes = Math.max(0, Math.floor((now - started) / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Whether the feed truncated a source. The DTO reports pre-truncation counts, so
 * the UI can say what it is not showing instead of implying the list is complete.
 */
export function truncationNote(
  counts: Record<string, number>,
  items: ActivityFeedItemDto[]
): string | null {
  const shown = new Map<string, number>();
  for (const item of items) shown.set(item.kind, (shown.get(item.kind) ?? 0) + 1);
  const hidden = FEED_KINDS.map(kind => (counts[kind] ?? 0) - (shown.get(kind) ?? 0)).reduce(
    (total, value) => total + Math.max(0, value),
    0
  );
  return hidden > 0 ? `${hidden} older item${hidden === 1 ? '' : 's'} not shown` : null;
}
