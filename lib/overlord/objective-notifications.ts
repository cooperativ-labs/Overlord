import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type NotificationPayload = Database['public']['Tables']['ticket_events']['Row']['payload'];

export type ObjectiveNotificationSound = 'waiting' | 'review' | 'alert';

export type ObjectiveNotificationIntent = {
  body: string;
  kind: 'waiting_on_human' | 'ready_for_review' | 'agent_alert';
  markUnread: boolean;
  markWaiting: boolean;
  sound: ObjectiveNotificationSound;
  title: string;
};

export function isNotificationPayloadRecord(
  value: NotificationPayload | unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getNotificationPayloadMessage(
  payload: NotificationPayload | unknown
): string | null {
  if (!isNotificationPayloadRecord(payload)) return null;
  const message = payload.message;
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null;
}

export function isAgentNotificationEvent(event: TicketEvent): boolean {
  if (event.event_type !== 'alert' && event.event_type !== 'question') return false;
  return (
    isNotificationPayloadRecord(event.payload) && event.payload.entry_type === 'agent_notification'
  );
}

export function isWaitingOnHumanEvent(event: TicketEvent): boolean {
  if (event.event_type === 'awaiting_approval') return true;
  return event.event_type === 'question' && event.is_blocking === true;
}

export function getObjectiveNotificationBody(event: TicketEvent, fallback: string): string {
  const summary = event.summary?.trim();
  if (summary) return summary;

  const message = getNotificationPayloadMessage(event.payload);
  if (message) return message;

  return fallback;
}

function formatTitle(
  prefix: string,
  ticketTitle?: string | null,
  ticketReference?: string | null
): string {
  const trimmedTitle = ticketTitle?.trim();
  if (trimmedTitle) {
    return `${prefix}: ${trimmedTitle}`;
  }
  if (ticketReference?.trim()) {
    return `${prefix} (${ticketReference.trim()})`;
  }
  return prefix;
}

export function resolveObjectiveNotificationIntent(
  event: TicketEvent,
  context: {
    ticketReference?: string | null;
    ticketTitle?: string | null;
  }
): ObjectiveNotificationIntent | null {
  if (isWaitingOnHumanEvent(event)) {
    const isApprovalGate = event.event_type === 'awaiting_approval';
    return {
      kind: 'waiting_on_human',
      title: formatTitle(
        isApprovalGate ? 'Approval needed' : 'Agent waiting',
        context.ticketTitle,
        context.ticketReference
      ),
      body: getObjectiveNotificationBody(
        event,
        isApprovalGate
          ? 'A queued objective is waiting for your approval.'
          : 'The agent is waiting for your input.'
      ),
      sound: 'waiting',
      markUnread: true,
      markWaiting: true
    };
  }

  if (event.event_type === 'status_change' && event.phase === 'review') {
    return {
      kind: 'ready_for_review',
      title: formatTitle('Ready for review', context.ticketTitle, context.ticketReference),
      body: getObjectiveNotificationBody(event, 'The agent delivered this objective for review.'),
      sound: 'review',
      markUnread: true,
      markWaiting: false
    };
  }

  if (event.event_type === 'alert' || isAgentNotificationEvent(event)) {
    return {
      kind: 'agent_alert',
      title: formatTitle('Agent alert', context.ticketTitle, context.ticketReference),
      body: getObjectiveNotificationBody(event, 'New agent event received.'),
      sound: 'alert',
      markUnread: false,
      markWaiting: false
    };
  }

  return null;
}
