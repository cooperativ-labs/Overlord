/** @jest-environment jsdom */

import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketWaitingOpened,
  markTicketWaitingRaised,
  markTicketWaitingUnread
} from '@/lib/helpers/ticket-waiting-response';

describe('ticket waiting indicator state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clears a waiting highlight on next open when raised while closed', () => {
    const ticketId = 'ticket-1';

    markTicketWaitingOpened(ticketId, 1_000);
    markTicketWaitingRaised(ticketId, false);

    const raisedAt = new Date(2_000).toISOString();
    expect(hasUnopenedTimestamp(raisedAt, getOpenedWaitingTimestamps()[ticketId])).toBe(true);

    markTicketWaitingOpened(ticketId, 3_000);

    expect(getWaitingRaisedWhileOpenMap()[ticketId]).toBeUndefined();
    expect(hasUnopenedTimestamp(raisedAt, getOpenedWaitingTimestamps()[ticketId])).toBe(false);
  });

  it('can restore waiting highlights via unread helper', () => {
    const waitingTicketId = 'ticket-waiting-unread';

    // Waiting: raised while closed, then cleared on open.
    markTicketWaitingOpened(waitingTicketId, 1_000);
    markTicketWaitingRaised(waitingTicketId, false);
    const waitingRaisedAt = new Date(2_000).toISOString();
    expect(
      hasUnopenedTimestamp(waitingRaisedAt, getOpenedWaitingTimestamps()[waitingTicketId])
    ).toBe(true);
    markTicketWaitingOpened(waitingTicketId, 3_000);
    expect(
      hasUnopenedTimestamp(waitingRaisedAt, getOpenedWaitingTimestamps()[waitingTicketId])
    ).toBe(false);

    // Mark as unread: highlight should be treated as unseen again.
    markTicketWaitingUnread(waitingTicketId);

    expect(
      hasUnopenedTimestamp(waitingRaisedAt, getOpenedWaitingTimestamps()[waitingTicketId])
    ).toBe(true);
  });

  it('reads legacy number-only storage values', () => {
    const key = 'overlord.ticket.lastOpenedAt.waiting';
    window.localStorage.setItem(key, JSON.stringify({ legacyTicket: 1_234 }));

    expect(getOpenedWaitingTimestamps().legacyTicket).toBe(1_234);
  });

  it('resets opened timestamps when marking ticket unread', () => {
    const ticketId = 'ticket-unread';

    markTicketWaitingOpened(ticketId, 1_000);

    expect(getOpenedWaitingTimestamps()[ticketId]).toBe(1_000);

    markTicketWaitingUnread(ticketId);

    expect(getOpenedWaitingTimestamps()[ticketId]).toBeUndefined();
  });
});
