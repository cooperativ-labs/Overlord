export type TicketListFilters = {
  selected_statuses: string[];
  /** Empty means all projects (no filter). */
  filter_project_ids: string[];
};

type TicketListFiltersInput = {
  selected_statuses?: unknown;
  filter_project_ids?: unknown;
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
    filter_project_ids: []
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
    filter_project_ids: normalizeFilterProjectIds(value ?? undefined)
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
    filter_project_id: obj.filter_project_id
  });
}
