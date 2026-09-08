/**
 * The declarative source of truth for every user-facing mission notification.
 *
 * Descriptors contain only trusted, code-owned presentation and policy metadata.
 * In particular, `verb` is deliberately fixed here rather than constructed from
 * mission, objective, or agent-provided text.
 */
export const NOTIFICATION_TYPES = [
  'mission_awaiting_review',
  'agent_question',
  'mission_complete',
  'mission_failed',
  'agent_started',
  'returned_to_execute'
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_MODES = ['alert', 'silent', 'off'] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

/** Delivery mechanisms a notification type may use as the system evolves. */
export const NOTIFICATION_TRANSPORTS = ['apns', 'realtime', 'in_app'] as const;
export type NotificationTransport = (typeof NOTIFICATION_TRANSPORTS)[number];

export type NotificationDescriptor = {
  id: NotificationType;
  label: string;
  detail: string;
  /** Trusted presentation fragment; never derive this from user-controlled text. */
  verb: string;
  defaultMode: NotificationMode;
  transports: readonly NotificationTransport[];
  icon: string;
  dotClassName: string | null;
  soundUrl: string | null;
  seenTracked: boolean;
};

export const NOTIFICATION_CATALOG = {
  agent_question: {
    id: 'agent_question',
    label: 'Agent questions',
    detail: 'An agent is blocked and asked a question.',
    verb: 'needs your input',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'questionmark.bubble.fill',
    dotClassName: 'bg-orange-500',
    soundUrl: null,
    seenTracked: true
  },
  mission_awaiting_review: {
    id: 'mission_awaiting_review',
    label: 'Ready for review',
    detail: 'A mission is ready for your review.',
    verb: 'is ready for review',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'checkmark.circle.fill',
    dotClassName: null,
    soundUrl: null,
    seenTracked: false
  },
  mission_failed: {
    id: 'mission_failed',
    label: 'Launch failed',
    detail: 'An agent run could not be launched.',
    verb: 'failed',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'exclamationmark.triangle.fill',
    dotClassName: null,
    soundUrl: null,
    seenTracked: false
  },
  mission_complete: {
    id: 'mission_complete',
    label: 'Mission complete',
    detail: 'A mission has been completed.',
    verb: 'finished',
    defaultMode: 'alert',
    transports: ['apns', 'realtime', 'in_app'],
    icon: 'checkmark.seal.fill',
    dotClassName: null,
    soundUrl: null,
    seenTracked: false
  },
  agent_started: {
    id: 'agent_started',
    label: 'Agent started',
    detail: 'An agent started work on an objective.',
    verb: 'started working',
    defaultMode: 'silent',
    transports: ['realtime', 'in_app'],
    icon: 'play.circle.fill',
    dotClassName: null,
    soundUrl: null,
    seenTracked: false
  },
  returned_to_execute: {
    id: 'returned_to_execute',
    label: 'Returned to execute',
    detail: 'A mission was returned to the execute stage.',
    verb: 'returned to execute',
    defaultMode: 'alert',
    transports: ['realtime', 'in_app'],
    icon: 'arrow.uturn.backward.circle.fill',
    dotClassName: 'bg-blue-500',
    soundUrl: null,
    seenTracked: true
  }
} as const satisfies Record<NotificationType, NotificationDescriptor>;

export type NotificationTypeForTransport<Transport extends NotificationTransport> = {
  [Type in NotificationType]: Transport extends (typeof NOTIFICATION_CATALOG)[Type]['transports'][number]
    ? Type
    : never;
}[NotificationType];

/** Returns catalog ids eligible for one transport while preserving their literal type. */
export function notificationTypesForTransport<Transport extends NotificationTransport>(
  transport: Transport
): NotificationTypeForTransport<Transport>[] {
  return NOTIFICATION_TYPES.filter(type =>
    (NOTIFICATION_CATALOG[type].transports as readonly NotificationTransport[]).includes(transport)
  ) as NotificationTypeForTransport<Transport>[];
}
