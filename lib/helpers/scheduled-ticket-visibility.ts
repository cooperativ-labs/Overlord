export const DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS = 2;
export const MAX_SCHEDULED_TICKET_VISIBILITY_DAYS = 30;
export const SCHEDULED_TICKET_VISIBILITY_PREFERENCE_KEY = 'scheduled_ticket_visibility_days';

export const SCHEDULED_TICKET_VISIBILITY_DAY_OPTIONS = [0, 1, 2, 3, 7, 14] as const;

export function normalizeScheduledTicketVisibilityDays(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS;
  }

  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, 0), MAX_SCHEDULED_TICKET_VISIBILITY_DAYS);
}

export function parseScheduledTicketVisibilityDaysPreference(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS;
  }

  const preferences = raw as Record<string, unknown>;
  return normalizeScheduledTicketVisibilityDays(
    preferences[SCHEDULED_TICKET_VISIBILITY_PREFERENCE_KEY]
  );
}

export function getScheduledTicketVisibilityWindow(
  days: number,
  now = new Date()
): { startIso: string; endIso: string } | null {
  const normalizedDays = normalizeScheduledTicketVisibilityDays(days);
  if (normalizedDays <= 0) {
    return null;
  }

  return {
    startIso: now.toISOString(),
    endIso: new Date(now.getTime() + normalizedDays * 24 * 60 * 60 * 1000).toISOString()
  };
}

export function mergeRowsById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  const merged = new Map<string, T>();

  for (const row of primary) {
    merged.set(row.id, row);
  }

  for (const row of secondary) {
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }

  return [...merged.values()];
}
