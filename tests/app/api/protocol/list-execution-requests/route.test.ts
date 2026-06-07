jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/lib/overlord/execution-targets', () => ({
  findExecutionTargetByFingerprint: jest.fn()
}));
jest.mock('@/supabase/utils/service-role');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const EXECUTION_TARGET_ID = 'target-list';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/list-execution-requests/route'));
});

function mockParseBody(data: Record<string, unknown> = {}) {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data,
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

describe('POST /api/protocol/list-execution-requests', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists all active requests for the caller when no device filter is provided', async () => {
    mockParseBody();
    const requestsQuery = {
      select: jest.fn(() => requestsQuery),
      eq: jest.fn(() => requestsQuery),
      in: jest.fn(() => requestsQuery),
      order: jest.fn(async () => ({
        data: [
          {
            id: 'req-1',
            organization_id: ORG_ID,
            ticket_id: 'ticket-1',
            objective_id: 'objective-1',
            project_id: null,
            status: 'queued',
            agent_identifier: 'codex',
            target_execution_target_id: null,
            claimed_by_execution_target_id: null,
            lease_expires_at: null,
            last_error: null,
            created_at: '2026-06-01T12:00:00.000Z'
          }
        ],
        error: null
      }))
    };
    const ticketsQuery = {
      select: jest.fn(() => ticketsQuery),
      in: jest.fn(async () => ({
        data: [{ id: 'ticket-1', ticket_id: '1:100', title: 'Ticket title' }],
        error: null
      }))
    };
    const objectivesQuery = {
      select: jest.fn(() => objectivesQuery),
      in: jest.fn(async () => ({
        data: [{ id: 'objective-1', title: 'Objective title', objective: 'Objective body' }],
        error: null
      }))
    };
    const organizationExecutionTargetsQuery = {
      select: jest.fn(() => organizationExecutionTargetsQuery),
      eq: jest.fn(() => organizationExecutionTargetsQuery),
      in: jest.fn(async () => ({
        data: [],
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return requestsQuery;
        if (table === 'tickets') return ticketsQuery;
        if (table === 'objectives') return objectivesQuery;
        if (table === 'organization_execution_targets') return organizationExecutionTargetsQuery;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toEqual([
      expect.objectContaining({
        id: 'req-1',
        ticket_reference: '1:100',
        objective_title: 'Objective title'
      })
    ]);
  });

  it('filters queued requests to the requested execution target when deviceFingerprint is provided', async () => {
    mockParseBody({ deviceFingerprint: 'fp-list' });
    const { findExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findExecutionTargetByFingerprint.mockResolvedValue(EXECUTION_TARGET_ID);

    const requestsQuery = {
      select: jest.fn(() => requestsQuery),
      eq: jest.fn(() => requestsQuery),
      in: jest.fn(() => requestsQuery),
      order: jest.fn(async () => ({
        data: [
          {
            id: 'req-visible',
            organization_id: ORG_ID,
            ticket_id: 'ticket-1',
            objective_id: 'objective-1',
            project_id: null,
            status: 'queued',
            agent_identifier: 'codex',
            target_execution_target_id: EXECUTION_TARGET_ID,
            claimed_by_execution_target_id: null,
            lease_expires_at: null,
            last_error: null,
            created_at: '2026-06-01T12:00:00.000Z'
          },
          {
            id: 'req-hidden',
            organization_id: ORG_ID,
            ticket_id: 'ticket-2',
            objective_id: 'objective-2',
            project_id: null,
            status: 'queued',
            agent_identifier: 'codex',
            target_execution_target_id: 'other-target',
            claimed_by_execution_target_id: null,
            lease_expires_at: null,
            last_error: null,
            created_at: '2026-06-01T12:01:00.000Z'
          }
        ],
        error: null
      }))
    };
    const ticketsQuery = {
      select: jest.fn(() => ticketsQuery),
      in: jest.fn(async () => ({
        data: [{ id: 'ticket-1', ticket_id: '1:100', title: 'Ticket title' }],
        error: null
      }))
    };
    const objectivesQuery = {
      select: jest.fn(() => objectivesQuery),
      in: jest.fn(async () => ({
        data: [{ id: 'objective-1', title: 'Objective title', objective: 'Objective body' }],
        error: null
      }))
    };
    const organizationExecutionTargetsQuery = {
      select: jest.fn(() => organizationExecutionTargetsQuery),
      eq: jest.fn(() => organizationExecutionTargetsQuery),
      in: jest.fn(async () => ({
        data: [{ execution_target_id: EXECUTION_TARGET_ID, label: 'My laptop' }],
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return requestsQuery;
        if (table === 'tickets') return ticketsQuery;
        if (table === 'objectives') return objectivesQuery;
        if (table === 'organization_execution_targets') return organizationExecutionTargetsQuery;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].id).toBe('req-visible');
  });
});
