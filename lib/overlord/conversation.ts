import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

export type ConversationEntryType = 'question' | 'answer' | 'follow_up' | 'event';

type EventPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getEventPayload(event: TicketEvent): EventPayload {
  return isRecord(event.payload) ? event.payload : {};
}

export function getEventParentId(event: TicketEvent): string | null {
  const payload = getEventPayload(event);
  const parent = payload.parent_event_id;
  return typeof parent === 'string' && parent.length > 0 ? parent : null;
}

export function getConversationEntryType(event: TicketEvent): ConversationEntryType {
  const payload = getEventPayload(event);
  const entryType = payload.entry_type;
  if (entryType === 'answer') return 'answer';
  if (entryType === 'follow_up') return 'follow_up';

  if (event.event_type === 'question') return 'question';
  if (event.event_type === 'answer') return 'answer';
  return 'event';
}

export function isBlockingQuestion(event: TicketEvent): boolean {
  return event.event_type === 'question' && event.is_blocking;
}

export function findOpenBlockingQuestions(events: TicketEvent[]): TicketEvent[] {
  const answeredParentIds = new Set(
    events
      .filter(event => getConversationEntryType(event) === 'answer')
      .map(getEventParentId)
      .filter((value): value is string => value !== null)
  );

  return events
    .filter(isBlockingQuestion)
    .filter(event => !answeredParentIds.has(event.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
