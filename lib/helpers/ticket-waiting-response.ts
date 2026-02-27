const OPENED_WAITING_KEY = 'overlord.ticket.lastOpenedAt.waiting';
const OPENED_REVIEW_KEY = 'overlord.ticket.lastOpenedAt.review';

export type TicketOpenedTimestamps = Record<string, number>;
export type TicketRaisedWhileOpenMap = Record<string, boolean>;

type TicketIndicatorState = {
  openedAt?: number;
  pendingReopenClear: boolean;
};

type TicketIndicatorStateMap = Record<string, TicketIndicatorState>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTicketIndicatorState(value: unknown): TicketIndicatorState | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Backward compatibility for older map format: { [ticketId]: number }
    return { openedAt: value, pendingReopenClear: false };
  }

  if (!isRecord(value)) {
    return null;
  }

  const openedAtRaw = value.openedAt;
  const openedAt =
    typeof openedAtRaw === 'number' && Number.isFinite(openedAtRaw) && openedAtRaw > 0
      ? openedAtRaw
      : undefined;

  const pendingReopenClearRaw = value.pendingReopenClear;

  return {
    openedAt,
    pendingReopenClear: typeof pendingReopenClearRaw === 'boolean' ? pendingReopenClearRaw : false
  };
}

function parseTicketIndicatorStateMap(value: unknown): TicketIndicatorStateMap {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: TicketIndicatorStateMap = {};
  for (const [ticketId, state] of Object.entries(value)) {
    const parsedState = parseTicketIndicatorState(state);
    if (parsedState) {
      parsed[ticketId] = parsedState;
    }
  }

  return parsed;
}

function readIndicatorStateMap(key: string): TicketIndicatorStateMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    return parseTicketIndicatorStateMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeIndicatorStateMap(
  key: string,
  map: TicketIndicatorStateMap
): TicketIndicatorStateMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // Ignore storage write errors (e.g. private mode with denied storage).
  }

  return map;
}

function toOpenedTimestampMap(stateMap: TicketIndicatorStateMap): TicketOpenedTimestamps {
  return Object.entries(stateMap).reduce<TicketOpenedTimestamps>((acc, [ticketId, state]) => {
    if (
      typeof state.openedAt === 'number' &&
      Number.isFinite(state.openedAt) &&
      state.openedAt > 0
    ) {
      acc[ticketId] = state.openedAt;
    }
    return acc;
  }, {});
}

function toRaisedWhileOpenMap(stateMap: TicketIndicatorStateMap): TicketRaisedWhileOpenMap {
  return Object.entries(stateMap).reduce<TicketRaisedWhileOpenMap>((acc, [ticketId, state]) => {
    if (state.pendingReopenClear) {
      acc[ticketId] = true;
    }
    return acc;
  }, {});
}

function getIndicatorStorageKey(kind: 'waiting' | 'review'): string {
  return kind === 'waiting' ? OPENED_WAITING_KEY : OPENED_REVIEW_KEY;
}

function markTicketIndicatorOpened(
  kind: 'waiting' | 'review',
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  if (!ticketId.trim()) {
    return toOpenedTimestampMap(readIndicatorStateMap(getIndicatorStorageKey(kind)));
  }

  const key = getIndicatorStorageKey(kind);
  const existing = readIndicatorStateMap(key);
  const next: TicketIndicatorStateMap = {
    ...existing,
    [ticketId]: {
      openedAt,
      pendingReopenClear: false
    }
  };

  return toOpenedTimestampMap(writeIndicatorStateMap(key, next));
}

function markTicketIndicatorRaised(
  kind: 'waiting' | 'review',
  ticketId: string,
  isTicketOpen: boolean
): TicketOpenedTimestamps {
  if (!ticketId.trim()) {
    return toOpenedTimestampMap(readIndicatorStateMap(getIndicatorStorageKey(kind)));
  }

  const key = getIndicatorStorageKey(kind);
  const existing = readIndicatorStateMap(key);
  const previous = existing[ticketId];
  const next: TicketIndicatorStateMap = {
    ...existing,
    [ticketId]: {
      openedAt: previous?.openedAt,
      pendingReopenClear: isTicketOpen
    }
  };

  return toOpenedTimestampMap(writeIndicatorStateMap(key, next));
}

export function getOpenedWaitingTimestamps(): TicketOpenedTimestamps {
  return toOpenedTimestampMap(readIndicatorStateMap(OPENED_WAITING_KEY));
}

export function getOpenedReviewTimestamps(): TicketOpenedTimestamps {
  return toOpenedTimestampMap(readIndicatorStateMap(OPENED_REVIEW_KEY));
}

export function getWaitingRaisedWhileOpenMap(): TicketRaisedWhileOpenMap {
  return toRaisedWhileOpenMap(readIndicatorStateMap(OPENED_WAITING_KEY));
}

export function getReviewRaisedWhileOpenMap(): TicketRaisedWhileOpenMap {
  return toRaisedWhileOpenMap(readIndicatorStateMap(OPENED_REVIEW_KEY));
}

export function markTicketWaitingOpened(
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  return markTicketIndicatorOpened('waiting', ticketId, openedAt);
}

export function markTicketReviewOpened(
  ticketId: string,
  openedAt: number = Date.now()
): TicketOpenedTimestamps {
  return markTicketIndicatorOpened('review', ticketId, openedAt);
}

export function markTicketWaitingRaised(
  ticketId: string,
  isTicketOpen: boolean
): TicketOpenedTimestamps {
  return markTicketIndicatorRaised('waiting', ticketId, isTicketOpen);
}

export function markTicketReviewRaised(
  ticketId: string,
  isTicketOpen: boolean
): TicketOpenedTimestamps {
  return markTicketIndicatorRaised('review', ticketId, isTicketOpen);
}

export function hasUnopenedTimestamp(
  timestamp: string | null | undefined,
  opened: number | undefined
): boolean {
  if (!timestamp) {
    return false;
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (Number.isNaN(parsedTimestamp)) {
    return false;
  }

  return opened === undefined || parsedTimestamp > opened;
}
