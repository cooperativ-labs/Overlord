/** @jest-environment jsdom */

import {
  getOpenedWaitingTimestamps,
  getReviewRaisedWhileOpenMap,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketReviewOpened,
  markTicketReviewRaised,
  markTicketWaitingOpened,
  markTicketWaitingRaised
} from '@/lib/helpers/ticket-waiting-response';

describe('ticket waiting/review indicator state', () => {
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

  it('tracks raised-while-open and clears it on reopen for review highlights', () => {
    const ticketId = 'ticket-2';

    markTicketReviewOpened(ticketId, 1_000);
    markTicketReviewRaised(ticketId, true);

    expect(getReviewRaisedWhileOpenMap()[ticketId]).toBe(true);

    // Reopen ticket: open marker update should clear deferred state.
    markTicketReviewOpened(ticketId, 4_000);

    expect(getReviewRaisedWhileOpenMap()[ticketId]).toBeUndefined();
  });

  it('reads legacy number-only storage values', () => {
    const key = 'overlord.ticket.lastOpenedAt.waiting';
    window.localStorage.setItem(key, JSON.stringify({ legacyTicket: 1_234 }));

    expect(getOpenedWaitingTimestamps().legacyTicket).toBe(1_234);
  });
});
