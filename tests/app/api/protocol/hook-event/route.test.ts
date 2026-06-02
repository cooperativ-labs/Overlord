jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn()
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/protocol-db');

const ORG_ID = 1;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SESSION_KEY = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const SESSION_ID = 'session-1';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/hook-event/route'));
});

function buildSupabase() {
  const sessionUpdate = {
    update: jest.fn(() => sessionUpdate),
    eq: jest.fn(async () => ({ error: null }))
  };
  const ticketEventInsert = {
    insert: jest.fn(async () => ({ error: null }))
  };

  return {
    from: jest.fn((table: string) => {
      if (table === 'agent_sessions') return sessionUpdate;
      if (table === 'ticket_events') return ticketEventInsert;
      throw new Error(`unexpected table ${table}`);
    }),
    sessionUpdate,
    ticketEventInsert
  };
}

describe('POST /api/protocol/hook-event', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
    parseProtocolBody.mockResolvedValue({
      ok: true,
      data: {
        hookType: 'UserPromptSubmit',
        ticketId: '1:1333',
        prompt: 'Please keep going.',
        turnIndex: 1,
        sessionKey: SESSION_KEY,
        externalSessionId: 'claude-session-123'
      },
      tokenContext: { organizationId: ORG_ID, userId: USER_ID }
    });

    const { resolveTicketId, resolveSession } = jest.requireMock('@/lib/overlord/protocol-db');
    resolveTicketId.mockResolvedValue(TICKET_UUID);
    resolveSession.mockResolvedValue({ session: { id: SESSION_ID } });
  });

  it('persists externalSessionId onto the active session before recording the follow-up', async () => {
    const supabase = buildSupabase();
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(supabase.sessionUpdate.update).toHaveBeenCalledWith({
      external_session_id: 'claude-session-123'
    });
    expect(supabase.sessionUpdate.eq).toHaveBeenCalledWith('id', SESSION_ID);
    expect(supabase.ticketEventInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'user_follow_up',
        summary: 'Please keep going.',
        ticket_id: TICKET_UUID,
        created_by: USER_ID,
        payload: expect.objectContaining({
          hook_type: 'UserPromptSubmit',
          turn_index: 1
        })
      })
    );
  });

  it('persists externalSessionId even when the initial launch prompt event is skipped', async () => {
    const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
    parseProtocolBody.mockResolvedValue({
      ok: true,
      data: {
        hookType: 'UserPromptSubmit',
        ticketId: '1:1333',
        prompt: 'Initial launch prompt',
        turnIndex: 0,
        sessionKey: SESSION_KEY,
        externalSessionId: 'claude-session-123'
      },
      tokenContext: { organizationId: ORG_ID, userId: USER_ID }
    });

    const supabase = buildSupabase();
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(supabase.sessionUpdate.update).toHaveBeenCalledWith({
      external_session_id: 'claude-session-123'
    });
    expect(supabase.ticketEventInsert.insert).not.toHaveBeenCalled();
  });
});
