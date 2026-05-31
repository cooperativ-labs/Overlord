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
const EXECUTION_TARGET_ID = 'target-complete';
const REQUEST_ID = 'req-complete';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/complete-execution-launch/route'));
});

function mockParseBody() {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      requestId: REQUEST_ID,
      deviceFingerprint: 'fp-complete'
    },
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

describe('POST /api/protocol/complete-execution-launch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when the execution target is not registered', async () => {
    mockParseBody();
    const { findExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findExecutionTargetByFingerprint.mockResolvedValue(null);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(404);
  });

  it('marks the request launching (not launched) for the claiming execution target', async () => {
    mockParseBody();
    const { findExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findExecutionTargetByFingerprint.mockResolvedValue(EXECUTION_TARGET_ID);
    let updatePayload: Record<string, unknown> | undefined;
    const executionUpdate = {
      update: jest.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return executionUpdate;
      }),
      eq: jest.fn(() => executionUpdate),
      select: jest.fn(() => executionUpdate),
      maybeSingle: jest.fn(async () => ({
        data: { id: REQUEST_ID, status: 'launching' },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'execution_requests') return executionUpdate;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    // Phase 4: spawn marks `launching`; attach is what marks `launched`. The
    // claim lease is intentionally NOT cleared here so a stale launching row
    // can be reclaimed for relaunch.
    expect(updatePayload).toEqual(
      expect.objectContaining({
        status: 'launching',
        last_error: null
      })
    );
    expect(updatePayload).not.toHaveProperty('lease_expires_at');
    expect(executionUpdate.eq).toHaveBeenCalledWith(
      'claimed_by_execution_target_id',
      EXECUTION_TARGET_ID
    );
    expect(executionUpdate.eq).toHaveBeenCalledWith('status', 'claimed');
  });

  it('is idempotent when attach has already marked the request launched', async () => {
    mockParseBody();
    const { findExecutionTargetByFingerprint } = jest.requireMock(
      '@/lib/overlord/execution-targets'
    );
    findExecutionTargetByFingerprint.mockResolvedValue(EXECUTION_TARGET_ID);

    const staleCompleteUpdate = {
      update: jest.fn(() => staleCompleteUpdate),
      eq: jest.fn(() => staleCompleteUpdate),
      select: jest.fn(() => staleCompleteUpdate),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const existingLookup = {
      select: jest.fn(() => existingLookup),
      eq: jest.fn(() => existingLookup),
      in: jest.fn(() => existingLookup),
      maybeSingle: jest.fn(async () => ({
        data: { id: REQUEST_ID, status: 'launched', lease_expires_at: null },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn().mockReturnValueOnce(staleCompleteUpdate).mockReturnValueOnce(existingLookup)
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request.status).toBe('launched');
    expect(existingLookup.in).toHaveBeenCalledWith('status', ['launching', 'launched']);
  });
});
