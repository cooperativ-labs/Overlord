import {
  deriveTicketIdFromPath,
  shouldShowNavTimerTimeEntriesContext
} from '@/components/features/everhour/EverhourNavTimer';

describe('Everhour nav timer context helpers', () => {
  it('derives ticket id from project ticket routes', () => {
    expect(deriveTicketIdFromPath('/projects/proj-1/ticket-42')).toBe('ticket-42');
  });

  it('derives ticket id from user ticket routes', () => {
    expect(deriveTicketIdFromPath('/u/ticket-88')).toBe('ticket-88');
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
