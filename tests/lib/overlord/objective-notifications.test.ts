import {
  isWaitingOnHumanEvent,
  resolveObjectiveNotificationIntent
} from '@/lib/overlord/objective-notifications';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

function makeEvent(overrides: Partial<TicketEvent>): TicketEvent {
  return {
    id: 'event-id',
    ticket_id: 'ticket-id',
    event_type: 'update',
    phase: null,
    summary: null,
    payload: {},
    is_blocking: false,
    created_at: '2026-05-23T12:00:00.000Z',
    created_by: null,
    objective_id: 'objective-id',
    ...overrides
  };
}

describe('objective notification intents', () => {
  it('treats blocking question events as waiting-on-human notifications', () => {
    const event = makeEvent({
      event_type: 'question',
      is_blocking: true,
      summary: 'Need approval to continue.'
    });

    expect(isWaitingOnHumanEvent(event)).toBe(true);
    expect(
      resolveObjectiveNotificationIntent(event, {
        ticketTitle: 'Fix notification drift'
      })
    ).toEqual({
      body: 'Need approval to continue.',
      kind: 'waiting_on_human',
      markUnread: true,
      markWaiting: true,
      sound: 'waiting',
      title: 'Agent waiting: Fix notification drift'
    });
  });

  it('treats awaiting_approval events as waiting-on-human notifications', () => {
    const event = makeEvent({
      event_type: 'awaiting_approval',
      is_blocking: true,
      summary: 'Queued objective is waiting for your approval.'
    });

    expect(isWaitingOnHumanEvent(event)).toBe(true);
    expect(
      resolveObjectiveNotificationIntent(event, {
        ticketReference: '1:1197'
      })
    ).toEqual({
      body: 'Queued objective is waiting for your approval.',
      kind: 'waiting_on_human',
      markUnread: true,
      markWaiting: true,
      sound: 'waiting',
      title: 'Approval needed (1:1197)'
    });
  });

  it('treats review status_change events as ready-for-review notifications', () => {
    const event = makeEvent({
      event_type: 'status_change',
      phase: 'review',
      summary: 'Objective moved to review.'
    });

    expect(
      resolveObjectiveNotificationIntent(event, {
        ticketTitle: 'Fix notification drift'
      })
    ).toEqual({
      body: 'Objective moved to review.',
      kind: 'ready_for_review',
      markUnread: true,
      markWaiting: false,
      sound: 'review',
      title: 'Ready for review: Fix notification drift'
    });
  });

  it('treats alert events as agent alerts', () => {
    const event = makeEvent({
      event_type: 'alert',
      summary: 'Runner launch failed.'
    });

    expect(
      resolveObjectiveNotificationIntent(event, {
        ticketTitle: 'Fix notification drift'
      })
    ).toEqual({
      body: 'Runner launch failed.',
      kind: 'agent_alert',
      markUnread: false,
      markWaiting: false,
      sound: 'alert',
      title: 'Agent alert: Fix notification drift'
    });
  });

  it('ignores deliver events because review notifications come from status_change', () => {
    const event = makeEvent({
      event_type: 'deliver',
      phase: 'deliver',
      summary: 'Delivered.'
    });

    expect(resolveObjectiveNotificationIntent(event, { ticketReference: '1:1197' })).toBeNull();
  });
});
