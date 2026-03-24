export type TicketListFilters = {
  selected_statuses: string[];
  filter_project_id: string | null;
};

type TicketListFiltersInput = {
  selected_statuses?: unknown;
  filter_project_id?: unknown;
};

export function createDefaultTicketListFilters(): TicketListFilters {
  return {
    selected_statuses: [],
    filter_project_id: null
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
    filter_project_id:
      typeof value?.filter_project_id === 'string' && value.filter_project_id.trim().length > 0
        ? value.filter_project_id.trim()
        : null
  };
}

export function parseTicketListFilters(raw: unknown): TicketListFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultTicketListFilters();
  }

  const obj = raw as Record<string, unknown>;
  return normalizeTicketListFilters({
    selected_statuses: obj.selected_statuses,
    filter_project_id: obj.filter_project_id
  });
}
