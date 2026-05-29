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
jest.mock('@/lib/auto-advance/schedule-after-deliver', () => ({
  scheduleQueuedObjectiveAfterDeliver: jest.fn().mockResolvedValue({ advanced: false })
}));
jest.mock('@/lib/overlord/protocol-db');
jest.mock('@/lib/ticket-statuses', () => ({
  resolvePreferredStatusNameByType: jest.fn()
}));
jest.mock('@/lib/overlord/checkpoints', () => ({
  upsertObjectiveCheckpoint: jest.fn()
}));
jest.mock('@/lib/overlord/file-changes', () => ({
  insertFileChanges: jest.fn()
}));
jest.mock('@/lib/overlord/notifications/orchestrator', () => ({
  emitWorkflowNotification: jest.fn().mockResolvedValue(undefined)
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const OBJECTIVE_ID = 'obj-1';
const SESSION_ID = 'session-1';
const DELIVERY_SUMMARY = 'Implemented the fix and added regression coverage.';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/deliver/route'));
});

function mockParseBody() {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      artifacts: [],
      changeRationales: [],
      checkpoint: null,
      sessionKey: SESSION_ID,
      snapshot: null,
      summary: DELIVERY_SUMMARY,
      ticketId: '1:1200'
    },
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

function buildSupabase() {
  const ticketLookup = {
    select: jest.fn(() => ticketLookup),
    eq: jest.fn(() => ticketLookup),
    maybeSingle: jest.fn(async () => ({
      data: {
        id: TICKET_UUID,
        ticket_id: '1:1200',
        project_id: 'project-1',
        title: 'Ticket title'
      },
      error: null
    })),
    neq: jest.fn(() => ticketLookup),
    order: jest.fn(() => ticketLookup),
    limit: jest.fn(async () => ({
      data: [{ board_position: 7 }],
      error: null
    }))
  };

  const objectiveUpdate = {
    update: jest.fn(() => objectiveUpdate),
    eq: jest.fn(() => objectiveUpdate),
    in: jest.fn(async () => ({ error: null }))
  };

  const sessionUpdate = {
    update: jest.fn(() => sessionUpdate),
    eq: jest.fn(async () => ({ error: null }))
  };

  const ticketUpdate = {
    update: jest.fn(() => ticketUpdate),
    eq: jest.fn(async () => ({ error: null }))
  };

  const artifactInsert = {
    insert: jest.fn(async () => ({ error: null }))
  };

  const insertedEvents: Array<Record<string, unknown>> = [];
  const ticketEventsInsertChain = {
    select: jest.fn(() => ticketEventsInsertChain),
    single: jest
      .fn()
      .mockImplementation(async () => ({ data: { id: `event-${insertedEvents.length}` }, error: null }))
  };
  const ticketEvents = {
    insert: jest.fn((payload: Record<string, unknown>) => {
      insertedEvents.push(payload);
      return ticketEventsInsertChain;
    })
  };

  let ticketFromCount = 0;

  return {
    from: jest.fn((table: string) => {
      if (table === 'tickets') {
        ticketFromCount += 1;
        if (ticketFromCount === 1) return ticketLookup;
        if (ticketFromCount === 2) return ticketLookup;
        return ticketUpdate;
      }
      if (table === 'ticket_events') return ticketEvents;
      if (table === 'objectives') return objectiveUpdate;
      if (table === 'agent_sessions') return sessionUpdate;
      if (table === 'artifacts') return artifactInsert;
      throw new Error(`unexpected table ${table}`);
    }),
    functions: {
      invoke: jest.fn(async () => ({ error: null }))
    },
    insertedEvents,
    ticketEvents
  };
}

describe('POST /api/protocol/deliver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseBody();

    const { resolveTicketId, resolveSession } = jest.requireMock('@/lib/overlord/protocol-db');
    const { resolvePreferredStatusNameByType } = jest.requireMock('@/lib/ticket-statuses');
    resolveTicketId.mockResolvedValue(TICKET_UUID);
    resolveSession.mockResolvedValue({
      session: { id: SESSION_ID, objective_id: OBJECTIVE_ID }
    });
    resolvePreferredStatusNameByType.mockResolvedValue('Review');
  });

  it('keeps the detailed summary on deliver and uses a generic review status-change summary', async () => {
    const supabase = buildSupabase();
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      artifacts: 0,
      ok: true,
      status: 'Review'
    });
    expect(supabase.ticketEvents.insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event_type: 'deliver',
        phase: 'deliver',
        objective_id: OBJECTIVE_ID,
        summary: DELIVERY_SUMMARY,
        ticket_id: TICKET_UUID,
        created_by: USER_ID
      })
    );
    expect(supabase.ticketEvents.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event_type: 'status_change',
        phase: 'review',
        objective_id: OBJECTIVE_ID,
        summary: 'Ticket delivered and moved to review.',
        ticket_id: TICKET_UUID,
        created_by: USER_ID
      })
    );
  });
});
