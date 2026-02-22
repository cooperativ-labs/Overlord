type NotificationLevel = 'info' | 'warning' | 'error' | 'success';
type NotificationKind = 'question' | 'event';

type AgentNotification = {
  isBlocking: boolean;
  kind: NotificationKind;
  level: NotificationLevel;
  message: string;
  metadata: Record<string, unknown>;
  title?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceLevel(value: unknown): NotificationLevel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'warning' || normalized === 'error' || normalized === 'success') {
    return normalized;
  }
  return 'info';
}

function coerceKind(value: unknown): NotificationKind {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'question' || normalized === 'ask' || normalized === 'prompt') {
    return 'question';
  }
  return 'event';
}

function normalizeNotification(input: unknown): AgentNotification | null {
  if (typeof input === 'string') {
    const message = asNonEmptyString(input);
    if (!message) return null;
    return {
      isBlocking: false,
      kind: 'event',
      level: 'info',
      message,
      metadata: {}
    };
  }

  if (!isRecord(input)) {
    return null;
  }

  const title = asNonEmptyString(input.title) ?? asNonEmptyString(input.label) ?? undefined;
  const message =
    asNonEmptyString(input.message) ??
    asNonEmptyString(input.summary) ??
    asNonEmptyString(input.text) ??
    asNonEmptyString(input.body) ??
    title;

  if (!message) {
    return null;
  }

  const mergedMetadata = isRecord(input.metadata) ? { ...input.metadata } : {};
  const excludedKeys = new Set([
    'body',
    'blocking',
    'event_type',
    'kind',
    'label',
    'level',
    'message',
    'metadata',
    'notification_type',
    'requires_response',
    'severity',
    'summary',
    'text',
    'title',
    'type'
  ]);
  for (const [key, value] of Object.entries(input)) {
    if (!excludedKeys.has(key)) {
      mergedMetadata[key] = value;
    }
  }

  return {
    isBlocking: Boolean(input.blocking || input.requires_response),
    kind: coerceKind(input.kind ?? input.notification_type ?? input.event_type ?? input.type),
    level: coerceLevel(input.level ?? input.severity ?? input.type),
    message,
    metadata: mergedMetadata,
    title
  };
}

export function extractAgentNotifications(payload: unknown): AgentNotification[] {
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.notification,
    payload.notifications,
    payload.agent_notification,
    payload.agent_notifications
  ];
  const notifications: AgentNotification[] = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      const normalized = normalizeNotification(value);
      if (normalized) notifications.push(normalized);
    }
  }

  return notifications;
}

export function buildAgentNotificationSummary(notification: AgentNotification): string {
  const hasDistinctTitle = notification.title && notification.title !== notification.message;
  const body = hasDistinctTitle
    ? `${notification.title}: ${notification.message}`
    : notification.message;

  if (notification.level === 'info') {
    return body;
  }

  return `${notification.level.toUpperCase()}: ${body}`;
}
