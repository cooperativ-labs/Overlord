const OPENED_WAITING_KEY = 'overlord.ticket.lastOpenedAt.waiting';
const OPENED_REVIEW_KEY = 'overlord.ticket.lastOpenedAt.review';

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

function readTimestampMap(key: string): TicketOpenedTimestamps {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    return parseOpenedTimestampMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeTimestampMap(
  key: string,
  ticketId: string,
  openedAt: number
): TicketOpenedTimestamps {
  if (typeof window === 'undefined' || !ticketId.trim()) {
    return {};
  }

  const existing = readTimestampMap(key);
  const next = { ...existing, [ticketId]: openedAt };

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore storage write errors (e.g. private mode with denied storage).
  }

  return next;
}

export function getOpenedWaitingTimestamps(): TicketOpenedTimestamps {
  return readTimestampMap(OPENED_WAITING_KEY);
}

export function getOpenedReviewTimestamps(): TicketOpenedTimestamps {
  return readTimestampMap(OPENED_REVIEW_KEY);
}

export function markTicketWaitingOpened(
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  return writeTimestampMap(OPENED_WAITING_KEY, ticketId, openedAt);
}

export function markTicketReviewOpened(
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  return writeTimestampMap(OPENED_REVIEW_KEY, ticketId, openedAt);
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
