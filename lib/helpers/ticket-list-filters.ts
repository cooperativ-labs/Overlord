export type TicketListFilters = {
  selected_statuses: string[];
  /** Empty means all projects (no filter). */
  filter_project_ids: string[];
  /** Empty means all tags (no filter). */
  filter_tag_ids: string[];
};

type TicketListFiltersInput = {
  selected_statuses?: unknown;
  filter_project_ids?: unknown;
  filter_tag_ids?: unknown;
  /** Legacy single-project filter; migrated into `filter_project_ids` when parsing. */
  filter_project_id?: unknown;
};

function normalizeFilterProjectIds(value: TicketListFiltersInput | null | undefined): string[] {
  const fromArray = normalizeStringList(value?.filter_project_ids);
  if (fromArray.length > 0) return fromArray;
  if (typeof value?.filter_project_id === 'string' && value.filter_project_id.trim().length > 0) {
    return [value.filter_project_id.trim()];
  }
  return [];
}

export function createDefaultTicketListFilters(): TicketListFilters {
  return {
    selected_statuses: [],
    filter_project_ids: [],
    filter_tag_ids: []
  };
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function normalizeTicketListFilters(
  value?: TicketListFiltersInput | null
): TicketListFilters {
  return {
    selected_statuses: normalizeStringList(value?.selected_statuses),
    filter_project_ids: normalizeFilterProjectIds(value ?? undefined),
    filter_tag_ids: normalizeStringList(value?.filter_tag_ids)
  };
}

export function parseTicketListFilters(raw: unknown): TicketListFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultTicketListFilters();
  }

  const obj = raw as Record<string, unknown>;
  return normalizeTicketListFilters({
    selected_statuses: obj.selected_statuses,
    filter_project_ids: obj.filter_project_ids,
    filter_tag_ids: obj.filter_tag_ids,
    filter_project_id: obj.filter_project_id
  });
}

/** Statuses selected by default before a user customises their list filter. */
export const DEFAULT_SELECTED_STATUSES = ['draft', 'execute', 'review'] as const;

/** Order-sensitive equality for two string lists. */
export function areStringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Order-insensitive equality for two project-filter id lists. */
export function areProjectFilterIdsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Builds the ordered list of status filter options: the default statuses first
 * (in canonical order), then any remaining available statuses, deduplicated.
 */
export function buildStatusFilterOptions(availableStatuses: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const status of DEFAULT_SELECTED_STATUSES) {
    if (seen.has(status)) continue;
    seen.add(status);
    next.push(status);
  }

  for (const status of availableStatuses) {
    if (seen.has(status)) continue;
    seen.add(status);
    next.push(status);
  }

  return next;
}

/**
 * Drops selected statuses that are no longer available. Returns the current
 * selection unchanged when there is nothing to sanitise, and falls back to the
 * full available set if filtering would leave nothing selected.
 */
export function sanitizeSelectedStatuses(current: string[], availableStatuses: string[]): string[] {
  if (availableStatuses.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return current;
  }

  const availableSet = new Set(availableStatuses);
  const next = current.filter(status => availableSet.has(status));
  return next.length > 0 ? next : availableStatuses;
}
