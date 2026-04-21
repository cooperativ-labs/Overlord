import {
  deriveProjectIdFromPath,
  deriveTicketIdFromPath,
  isUserTicketsPath,
  shouldShowNavTimerTimeEntriesContext
} from '@/components/features/everhour/EverhourNavTimer';

describe('Everhour nav timer context helpers', () => {
  it('derives ticket id from project ticket routes', () => {
    expect(deriveTicketIdFromPath('/projects/proj-1/ticket-42')).toBe('ticket-42');
  });

  it('does not treat current changes routes as ticket routes', () => {
    expect(deriveTicketIdFromPath('/projects/proj-1/current-changes')).toBeNull();
  });

  it('derives ticket id from user ticket routes', () => {
    expect(deriveTicketIdFromPath('/u/ticket-88')).toBe('ticket-88');
  });

  it('derives project id from project routes', () => {
    expect(deriveProjectIdFromPath('/projects/proj-1')).toBe('proj-1');
    expect(deriveProjectIdFromPath('/projects/proj-1/ticket-42')).toBe('proj-1');
    expect(deriveProjectIdFromPath('/u')).toBeNull();
  });

  it('detects user tickets routes', () => {
    expect(isUserTicketsPath('/u')).toBe(true);
    expect(isUserTicketsPath('/u/ticket-88')).toBe(true);
    expect(isUserTicketsPath('/projects/proj-1')).toBe(false);
  });

  it('shows entries when either ticket id or task id exists', () => {
    expect(
      shouldShowNavTimerTimeEntriesContext({
        everhourTaskId: null,
        ticketId: 'ticket-1'
      })
    ).toBe(true);
    expect(
      shouldShowNavTimerTimeEntriesContext({
        everhourTaskId: 'task-1',
        ticketId: null
      })
    ).toBe(true);
    expect(
      shouldShowNavTimerTimeEntriesContext({
        everhourTaskId: null,
        ticketId: null
      })
    ).toBe(false);
  });
});
