/** @jest-environment jsdom */

import {
  getOpenedReviewTimestamps,
  getOpenedWaitingTimestamps,
  getReviewRaisedWhileOpenMap,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  markTicketReviewOpened,
  markTicketReviewRaised,
  markTicketReviewUnread,
  markTicketWaitingOpened,
  markTicketWaitingRaised,
  markTicketWaitingUnread
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

  it('can restore highlights via unread helpers', () => {
    const waitingTicketId = 'ticket-waiting-unread';
    const reviewTicketId = 'ticket-review-unread';

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

    // Review: raised while open, then cleared on reopen.
    markTicketReviewOpened(reviewTicketId, 1_000);
    markTicketReviewRaised(reviewTicketId, true);
    const reviewRaisedAt = new Date(2_000).toISOString();
    expect(hasUnopenedTimestamp(reviewRaisedAt, getOpenedReviewTimestamps()[reviewTicketId])).toBe(
      true
    );
    markTicketReviewOpened(reviewTicketId, 4_000);
    expect(getReviewRaisedWhileOpenMap()[reviewTicketId]).toBeUndefined();
    expect(hasUnopenedTimestamp(reviewRaisedAt, getOpenedReviewTimestamps()[reviewTicketId])).toBe(
      false
    );

    // Mark both as unread: highlights should be treated as unseen again.
    markTicketWaitingUnread(waitingTicketId);
    markTicketReviewUnread(reviewTicketId);

    expect(
      hasUnopenedTimestamp(waitingRaisedAt, getOpenedWaitingTimestamps()[waitingTicketId])
    ).toBe(true);
    expect(hasUnopenedTimestamp(reviewRaisedAt, getOpenedReviewTimestamps()[reviewTicketId])).toBe(
      true
    );
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

  it('resets opened timestamps when marking tickets unread', () => {
    const ticketId = 'ticket-unread';

    markTicketWaitingOpened(ticketId, 1_000);
    markTicketReviewOpened(ticketId, 2_000);

    expect(getOpenedWaitingTimestamps()[ticketId]).toBe(1_000);
    expect(getOpenedReviewTimestamps()[ticketId]).toBe(2_000);

    markTicketWaitingUnread(ticketId);
    markTicketReviewUnread(ticketId);

    expect(getOpenedWaitingTimestamps()[ticketId]).toBeUndefined();
    expect(getOpenedReviewTimestamps()[ticketId]).toBeUndefined();
  });
});
