import {
  getEventDisplayLabel,
  getEventDisplaySummary,
  isUserFollowUpEvent
} from '@/lib/overlord/conversation';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

function makeEvent(overrides: Partial<TicketEvent> = {}): TicketEvent {
  return {
    created_at: new Date(0).toISOString(),
    created_by: null,
    event_type: 'update',
    id: 'event-1',
    is_blocking: false,
    objective_id: null,
    payload: {},
    phase: 'execute',
    session_id: null,
    summary: null,
    ticket_id: 'ticket-1',
    ...overrides
  };
}

describe('conversation event display helpers', () => {
  it('strips the verbatim prefix from follow-up summaries', () => {
    const event = makeEvent({
      event_type: 'user_follow_up',
      summary: 'User message (verbatim): keep the existing config'
    });

    expect(isUserFollowUpEvent(event)).toBe(true);
    expect(getEventDisplayLabel(event)).toBe('user_follow_up');
    expect(getEventDisplaySummary(event)).toBe('keep the existing config');
  });

  it('treats follow-up payload entries as user follow-up events', () => {
    const event = makeEvent({
      payload: { entry_type: 'follow_up' },
      summary: 'User message (verbatim): preserve merged settings'
    });

    expect(isUserFollowUpEvent(event)).toBe(true);
    expect(getEventDisplayLabel(event)).toBe('user_follow_up');
    expect(getEventDisplaySummary(event)).toBe('preserve merged settings');
  });

  it('leaves non follow-up summaries unchanged', () => {
    const event = makeEvent({
      event_type: 'update',
      summary: 'User message (verbatim): this should stay intact'
    });

    expect(isUserFollowUpEvent(event)).toBe(false);
    expect(getEventDisplayLabel(event)).toBe('update');
    expect(getEventDisplaySummary(event)).toBe('User message (verbatim): this should stay intact');
  });
});
