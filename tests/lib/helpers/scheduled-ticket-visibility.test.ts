import {
  DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS,
  getScheduledTicketVisibilityWindow,
  mergeRowsById,
  normalizeScheduledTicketVisibilityDays,
  parseScheduledTicketVisibilityDaysPreference
} from '@/lib/helpers/scheduled-ticket-visibility';

describe('scheduled ticket visibility helpers', () => {
  it('normalizes invalid values to the default', () => {
    expect(normalizeScheduledTicketVisibilityDays(undefined)).toBe(
      DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS
    );
    expect(normalizeScheduledTicketVisibilityDays('')).toBe(
      DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS
    );
    expect(normalizeScheduledTicketVisibilityDays('nope')).toBe(
      DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS
    );
  });

  it('rounds and clamps valid values', () => {
    expect(normalizeScheduledTicketVisibilityDays('3')).toBe(3);
    expect(normalizeScheduledTicketVisibilityDays(1.6)).toBe(2);
    expect(normalizeScheduledTicketVisibilityDays(-5)).toBe(0);
    expect(normalizeScheduledTicketVisibilityDays(100)).toBe(30);
  });

  it('parses the days preference from a preferences object', () => {
    expect(
      parseScheduledTicketVisibilityDaysPreference({
        scheduled_ticket_visibility_days: '7'
      })
    ).toBe(7);
    expect(parseScheduledTicketVisibilityDaysPreference(null)).toBe(
      DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS
    );
  });

  it('returns no window when the setting is zero days', () => {
    expect(getScheduledTicketVisibilityWindow(0, new Date('2026-05-07T12:00:00.000Z'))).toBeNull();
  });

  it('builds a forward-looking due date window', () => {
    expect(getScheduledTicketVisibilityWindow(2, new Date('2026-05-07T12:00:00.000Z'))).toEqual({
      startIso: '2026-05-07T12:00:00.000Z',
      endIso: '2026-05-09T12:00:00.000Z'
    });
  });

  it('merges rows by id without duplicating scheduled rows already in the base set', () => {
    expect(
      mergeRowsById(
        [
          { id: 'a', title: 'Recent ticket' },
          { id: 'b', title: 'Already included scheduled ticket' }
        ],
        [
          { id: 'b', title: 'Duplicate scheduled ticket' },
          { id: 'c', title: 'Extra scheduled ticket' }
        ]
      )
    ).toEqual([
      { id: 'a', title: 'Recent ticket' },
      { id: 'b', title: 'Already included scheduled ticket' },
      { id: 'c', title: 'Extra scheduled ticket' }
    ]);
  });
});
