const OPENED_TICKETS_STORAGE_KEY = 'overlord.ticket.lastOpenedAt';

export type TicketOpenedTimestamps = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOpenedTimestampMap(value: unknown): TicketOpenedTimestamps {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: TicketOpenedTimestamps = {};
  for (const [ticketId, timestamp] of Object.entries(value)) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      parsed[ticketId] = timestamp;
    }
  }

  return parsed;
}

export function getOpenedTicketTimestamps(): TicketOpenedTimestamps {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(OPENED_TICKETS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return parseOpenedTimestampMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function markTicketOpened(
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  if (typeof window === 'undefined' || !ticketId.trim()) {
    return {};
  }

  const existing = getOpenedTicketTimestamps();
  const next = { ...existing, [ticketId]: openedAt };

  try {
    window.localStorage.setItem(OPENED_TICKETS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write errors (for example in private mode with denied storage).
  }

  return next;
}

export function hasUnopenedWaitingResponse(
  waitingForResponseAt: string | null | undefined,
  openedAt: number | undefined
): boolean {
  return hasUnopenedTimestamp(waitingForResponseAt, openedAt);
}

export function hasUnopenedTimestamp(
  timestamp: string | null | undefined,
  openedAt: number | undefined
): boolean {
  if (!timestamp) {
    return false;
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (Number.isNaN(parsedTimestamp)) {
    return false;
  }

  return openedAt === undefined || parsedTimestamp > openedAt;
}
