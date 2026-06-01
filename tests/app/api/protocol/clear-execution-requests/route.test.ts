jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/clear-execution-requests/route'));
});

function mockParseBody(data: Record<string, unknown>) {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data,
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

describe('POST /api/protocol/clear-execution-requests', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears one objective queue entry by marking it failed', async () => {
    mockParseBody({ objectiveId: 'objective-1', clearAll: false });
    let updatePayload: Record<string, unknown> | undefined;
    const updateQuery = {
      update: jest.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return updateQuery;
      }),
      eq: jest.fn(() => updateQuery),
      in: jest.fn(() => updateQuery),
      select: jest.fn(async () => ({
        data: [{ id: 'req-1', objective_id: 'objective-1', status: 'failed' }],
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return updateQuery;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updatePayload).toEqual(
      expect.objectContaining({
        status: 'failed',
        claimed_by_execution_target_id: null,
        lease_expires_at: null,
        last_error: 'Execution request cleared for objective.'
      })
    );
    expect(body.clearedCount).toBe(1);
    expect(updateQuery.eq).toHaveBeenCalledWith('objective_id', 'objective-1');
  });

  it('clears all active requests when clearAll is true', async () => {
    mockParseBody({ clearAll: true });
    const updateQuery = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery),
      in: jest.fn(() => updateQuery),
      select: jest.fn(async () => ({
        data: [{ id: 'req-1' }, { id: 'req-2' }],
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return updateQuery;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.clearedCount).toBe(2);
    expect(updateQuery.eq).not.toHaveBeenCalledWith('objective_id', expect.anything());
  });
});
