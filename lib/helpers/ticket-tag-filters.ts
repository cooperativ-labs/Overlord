import type { EffectiveTicketTag } from '@/types/tags';

import { parseTicketListFilters, type TicketListFilters } from './ticket-list-filters';

export const USER_LIST_FILTERS_KEY = 'overlord:user-ticket-list-filters';

export type TicketTagFilterOption = {
  id: string;
  label: string;
  color: string | null;
};

export function areFilterIdsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function buildTagFilterOptions(
  tagsByTicketId: Record<string, EffectiveTicketTag[] | undefined> | undefined
): TicketTagFilterOption[] {
  if (!tagsByTicketId) return [];

  const byId = new Map<string, TicketTagFilterOption>();
  for (const tags of Object.values(tagsByTicketId)) {
    for (const tag of tags ?? []) {
      if (!byId.has(tag.id)) {
        byId.set(tag.id, {
          id: tag.id,
          label: tag.label,
          color: tag.color
        });
      }
    }
  }

  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function readStoredListFilters(): TicketListFilters | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(USER_LIST_FILTERS_KEY);
    if (!stored) return null;
    return parseTicketListFilters(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function writeStoredListFilters(filters: TicketListFilters): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(USER_LIST_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // ignore localStorage errors
  }
}
