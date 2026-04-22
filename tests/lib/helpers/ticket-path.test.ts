import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';

describe('ticket-path helpers', () => {
  it('routes project tickets to project detail pages', () => {
    expect(buildTicketPath({ projectId: 'proj-123', ticketId: 'ticket-456' })).toBe(
      '/projects/proj-123/ticket-456'
    );
    expect(buildProjectPath({ projectId: 'proj-123' })).toBe('/projects/proj-123');
  });

  it('routes personal tickets to the user inbox', () => {
    expect(buildTicketPath({ projectId: null, ticketId: 'ticket-456' })).toBe('/u/ticket-456');
    expect(buildProjectPath({ projectId: null })).toBe('/u');
  });
});
