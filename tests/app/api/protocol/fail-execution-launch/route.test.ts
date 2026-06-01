jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/lib/overlord/execution-targets', () => ({
  findUserExecutionTargetByFingerprint: jest.fn()
}));
jest.mock('@/supabase/utils/service-role');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const EXECUTION_TARGET_ID = 'target-fail';
const REQUEST_ID = 'req-fail';
const TICKET_ID = 'ticket-fail';
const OBJECTIVE_ID = 'objective-fail';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/fail-execution-launch/route'));
});

function mockParseBody() {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      requestId: REQUEST_ID,
      deviceFingerprint: 'fp-fail',
      error: 'spawn ENOENT'
    },
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

describe('POST /api/protocol/fail-execution-launch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records failure and writes execution_launch_failed for the claiming execution target', async () => {
    mockParseBody();
    const { findUserExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findUserExecutionTargetByFingerprint.mockResolvedValue(EXECUTION_TARGET_ID);
    let updatePayload: unknown;
    const eventsInsert = { insert: jest.fn(async () => ({ error: null })) };
    const executionUpdate = {
      update: jest.fn((payload: unknown) => {
        updatePayload = payload;
        return executionUpdate;
      }),
      eq: jest.fn(() => executionUpdate),
      select: jest.fn(() => executionUpdate),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: REQUEST_ID,
          ticket_id: TICKET_ID,
          objective_id: OBJECTIVE_ID
        },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return executionUpdate;
        if (table === 'ticket_events') return eventsInsert;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(updatePayload).toEqual(
      expect.objectContaining({
        status: 'failed',
        last_error: 'spawn ENOENT',
        lease_expires_at: null
      })
    );
    expect(eventsInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'execution_launch_failed',
        ticket_id: TICKET_ID,
        objective_id: OBJECTIVE_ID,
        payload: expect.objectContaining({
          execution_request_id: REQUEST_ID,
          execution_target_id: EXECUTION_TARGET_ID
        })
      })
    );

    // Finding #1 (org-agnostic lifecycle): the request is resolved by id +
    // requested_by + claiming target, never scoped to the token's default org.
    expect(executionUpdate.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
    expect(executionUpdate.eq).toHaveBeenCalledWith('requested_by', USER_ID);
    expect(executionUpdate.eq).toHaveBeenCalledWith(
      'claimed_by_execution_target_id',
      EXECUTION_TARGET_ID
    );
  });

  it('fails a request claimed for a different org than the token default (Finding #1)', async () => {
    // The runner claims org-agnostically, so the token default org (ORG_ID) can
    // differ from the claimed request's org. The fail call must still succeed:
    // it resolves the target by user and the request by id + requested_by +
    // claiming target, with no organization filter.
    mockParseBody();
    const { findUserExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findUserExecutionTargetByFingerprint.mockResolvedValue(EXECUTION_TARGET_ID);
    const eventsInsert = { insert: jest.fn(async () => ({ error: null })) };
    const executionUpdate = {
      update: jest.fn(() => executionUpdate),
      eq: jest.fn(() => executionUpdate),
      select: jest.fn(() => executionUpdate),
      maybeSingle: jest.fn(async () => ({
        // Row belongs to org 99, not the token default ORG_ID (1).
        data: {
          id: REQUEST_ID,
          ticket_id: TICKET_ID,
          objective_id: OBJECTIVE_ID,
          organization_id: 99
        },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return executionUpdate;
        if (table === 'ticket_events') return eventsInsert;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(executionUpdate.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
  });
});
