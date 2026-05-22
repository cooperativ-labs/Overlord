jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/protocol-db');
jest.mock('@/lib/overlord/execution-requests');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/request-execution/route'));
});

function mockParseBody(
  overrides: Partial<{
    ok: boolean;
    userId: string | null;
    ticketId: string;
  }> = {}
) {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  if (overrides.ok === false) {
    parseProtocolBody.mockResolvedValue({
      ok: false,
      errorResponse: new Response(JSON.stringify({ error: 'bad' }), { status: 400 })
    });
    return;
  }

  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      ticketId: overrides.ticketId ?? '1:1',
      requestedFrom: 'manual_run',
      flags: [],
      launchMode: 'run',
      targetKind: 'any'
    },
    tokenContext: {
      userId: overrides.userId === undefined ? USER_ID : overrides.userId,
      organizationId: ORG_ID
    }
  });
}

describe('POST /api/protocol/request-execution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when user context is missing', async () => {
    mockParseBody({ userId: null });
    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns 404 when the ticket cannot be resolved', async () => {
    mockParseBody();
    const { resolveTicketId } = jest.requireMock('@/lib/overlord/protocol-db');
    resolveTicketId.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Ticket not found.' });
  });

  it('creates an execution request when the ticket resolves', async () => {
    mockParseBody();
    const { resolveTicketId } = jest.requireMock('@/lib/overlord/protocol-db');
    const { createExecutionRequest } = jest.requireMock('@/lib/overlord/execution-requests');
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');

    resolveTicketId.mockResolvedValue(TICKET_UUID);
    createServiceRoleClient.mockReturnValue({ from: jest.fn() });
    createExecutionRequest.mockResolvedValue({
      request: { id: 'req-1', status: 'queued' },
      ticket: { id: TICKET_UUID, ticket_id: '1:1', project_id: null },
      objective: { id: 'obj-1', state: 'submitted' }
    });

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.request.id).toBe('req-1');
    expect(createExecutionRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: TICKET_UUID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run'
      })
    );
  });
});
