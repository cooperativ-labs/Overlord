jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/protocol-db');
jest.mock('@/lib/overlord/protocol-connect', () => ({
  runConnectProtocol: jest.fn()
}));

const ORG_ID = 1;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/connect/route'));
});

describe('POST /api/protocol/connect', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
    parseProtocolBody.mockResolvedValue({
      ok: true,
      data: {
        ticketId: '1:1333',
        agentIdentifier: 'codex',
        connectionMethod: 'cli',
        externalSessionId: 'codex-thread-123',
        metadata: { cwd: '/tmp/repo' }
      },
      tokenContext: { organizationId: ORG_ID, userId: USER_ID }
    });

    const { resolveTicketId } = jest.requireMock('@/lib/overlord/protocol-db');
    resolveTicketId.mockResolvedValue(TICKET_UUID);
  });

  it('forwards externalSessionId into the shared connect protocol', async () => {
    const supabase = {};
    const { runConnectProtocol } = jest.requireMock('@/lib/overlord/protocol-connect');
    runConnectProtocol.mockResolvedValue({
      error: null,
      data: {
        session: { id: 'session-1', sessionKey: 'session-key-1', state: 'attached' },
        ticketId: TICKET_UUID
      }
    });

    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(runConnectProtocol).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        ticketId: TICKET_UUID,
        agentIdentifier: 'codex',
        connectionMethod: 'cli',
        externalSessionId: 'codex-thread-123',
        organizationId: ORG_ID,
        userId: USER_ID
      })
    );
  });
});
