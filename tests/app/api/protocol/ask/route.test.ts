jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return {
    ...actual,
    after: jest.fn((callback: () => Promise<void> | void) => {
      void callback();
    })
  };
});

jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/protocol-db');
jest.mock('@/lib/overlord/notifications/orchestrator', () => ({
  emitWorkflowNotification: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('@/lib/ticket-statuses', () => ({
  resolveStatusNameForPhase: jest.fn()
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const OBJECTIVE_ID = 'obj-1';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/ask/route'));
});

function mockParseBody() {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      ticketId: '1:1200',
      question: 'Need an answer',
      phase: 'review',
      payload: { foo: 'bar' },
      sessionKey: 'session-1'
    },
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

function buildSupabase() {
  const ticketLookup = {
    select: jest.fn(() => ticketLookup),
    eq: jest.fn(() => ticketLookup),
    maybeSingle: jest.fn(async () => ({
      data: { id: TICKET_UUID, ticket_id: '1:1200', title: 'Ticket title' },
      error: null
    }))
  };

  const questionInsert = {
    insert: jest.fn(() => questionInsert),
    select: jest.fn(() => questionInsert),
    single: jest.fn(async () => ({ data: { id: 'event-1' }, error: null }))
  };

  const ticketUpdate = {
    update: jest.fn(() => ticketUpdate),
    eq: jest.fn(async () => ({ error: null }))
  };

  return {
    from: jest.fn((table: string) => {
      if (table === 'tickets') {
        return ticketLookup.select.mock.calls.length === 0 ? ticketLookup : ticketUpdate;
      }
      if (table === 'ticket_events') {
        return questionInsert;
      }
      throw new Error(`unexpected table ${table}`);
    }),
    ticketUpdate,
    questionInsert
  };
}

describe('POST /api/protocol/ask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseBody();

    const { resolveTicketId, resolveSession } = jest.requireMock('@/lib/overlord/protocol-db');
    const { resolveStatusNameForPhase } = jest.requireMock('@/lib/ticket-statuses');
    resolveTicketId.mockResolvedValue(TICKET_UUID);
    resolveSession.mockResolvedValue({ session: { objective_id: OBJECTIVE_ID } });
    resolveStatusNameForPhase.mockResolvedValue('In Review');
  });

  it('records the question and updates unread review status without reordering the board', async () => {
    const supabase = buildSupabase();
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'review' });
    expect(supabase.questionInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'question',
        phase: 'review',
        objective_id: OBJECTIVE_ID,
        summary: 'Need an answer',
        ticket_id: TICKET_UUID,
        created_by: USER_ID
      })
    );
    expect(supabase.ticketUpdate.update).toHaveBeenCalledWith({
      status: 'In Review',
      is_read: false
    });
    expect(supabase.questionInsert.insert).toHaveBeenCalledTimes(1);
  });
});
