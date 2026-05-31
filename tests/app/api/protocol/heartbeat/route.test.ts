jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/protocol-db');

const ORG_ID = 1;
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SESSION_ID = 'cccccccc-0000-4000-8000-000000000001';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/heartbeat/route'));
});

describe('POST /api/protocol/heartbeat', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
    parseProtocolBody.mockResolvedValue({
      ok: true,
      data: {
        ticketId: '1:1286',
        sessionKey: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
        phase: 'execute',
        percent: 40,
        note: 'Running tests'
      },
      tokenContext: { organizationId: ORG_ID, userId: 'user-1' }
    });

    const { resolveTicketId, resolveSession } = jest.requireMock('@/lib/overlord/protocol-db');
    resolveTicketId.mockResolvedValue(TICKET_UUID);
    resolveSession.mockResolvedValue({
      session: {
        id: SESSION_ID,
        metadata: { existing: true }
      }
    });
  });

  it('updates session heartbeat telemetry without creating ticket events', async () => {
    const sessionUpdate = {
      update: jest.fn(() => sessionUpdate),
      eq: jest.fn(async () => ({ error: null }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'agent_sessions') return sessionUpdate;
        throw new Error(`unexpected table ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        telemetry: { phase: 'execute', percent: 40, note: 'Running tests' }
      })
    );
    expect(sessionUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        heartbeat_at: expect.any(String),
        metadata: expect.objectContaining({
          existing: true,
          overlordHeartbeat: expect.objectContaining({
            at: expect.any(String),
            phase: 'execute',
            percent: 40,
            note: 'Running tests'
          })
        })
      })
    );
  });
});
