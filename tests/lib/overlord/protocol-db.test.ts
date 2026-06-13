import { resolveSession } from '@/lib/overlord/protocol-db';

const SESSION_KEY = '11111111-2222-4333-8444-555555555555';
const TICKET_ID = 'ticket-uuid';
const ORG_ID = 1;

jest.mock('@/supabase/utils/service-role', () => ({
  createServiceRoleClient: jest.fn()
}));

describe('resolveSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects disconnected sessions so agents must attach again', async () => {
    const heartbeatUpdate = {
      update: jest.fn(() => heartbeatUpdate),
      eq: jest.fn(async () => ({ error: null }))
    };
    const sessionQuery = {
      select: jest.fn(() => sessionQuery),
      eq: jest.fn(() => sessionQuery),
      single: jest.fn(async () => ({
        data: {
          id: 'session-1',
          session_key: SESSION_KEY,
          session_state: 'disconnected',
          objective: { ticket_id: TICKET_ID, ticket: { organization_id: ORG_ID } }
        },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn(table => (table === 'agent_sessions' ? sessionQuery : heartbeatUpdate))
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const result = await resolveSession(SESSION_KEY, TICKET_ID, ORG_ID);

    expect(result.session).toBeNull();
    expect(result.error).toContain('attach again');
    expect(heartbeatUpdate.update).not.toHaveBeenCalled();
  });

  it('allows completed sessions when follow-up work explicitly reactivates them', async () => {
    const sessionBuilder: Record<string, jest.Mock> = {};
    for (const method of ['select', 'eq', 'single', 'update']) {
      sessionBuilder[method] = jest.fn(() => sessionBuilder);
    }
    sessionBuilder.single.mockResolvedValue({
      data: {
        id: 'session-1',
        session_key: SESSION_KEY,
        session_state: 'completed',
        objective: { ticket_id: TICKET_ID, ticket: { organization_id: ORG_ID } }
      },
      error: null
    });
    sessionBuilder.eq.mockImplementation((column: string) => {
      if (column === 'id') {
        return Promise.resolve({ error: null });
      }
      return sessionBuilder;
    });
    const supabase = {
      from: jest.fn(() => sessionBuilder)
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const result = await resolveSession(SESSION_KEY, TICKET_ID, ORG_ID, {
      allowCompletedReactivation: true
    });

    expect(result.error).toBeNull();
    expect(result.session?.session_state).toBe('completed');
    expect(sessionBuilder.update).toHaveBeenCalled();
  });
});
