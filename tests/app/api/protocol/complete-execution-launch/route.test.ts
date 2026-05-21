jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(() =>
    new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const DEVICE_ID = 'device-complete';
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

  it('returns 404 when the device is not registered', async () => {
    mockParseBody();
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'devices') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  eq: jest.fn(() => ({
                    maybeSingle: jest.fn(async () => ({ data: null, error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(404);
  });

  it('marks the request launched only for the claiming device', async () => {
    mockParseBody();
    let updatePayload: unknown;
    const executionUpdate = {
      update: jest.fn((payload: unknown) => {
        updatePayload = payload;
        return executionUpdate;
      }),
      eq: jest.fn(() => executionUpdate),
      select: jest.fn(() => executionUpdate),
      maybeSingle: jest.fn(async () => ({
        data: { id: REQUEST_ID, status: 'launched' },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'devices') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  eq: jest.fn(() => ({
                    maybeSingle: jest.fn(async () => ({ data: { id: DEVICE_ID }, error: null }))
                  }))
                }))
              }))
            }))
          };
        }
        if (table === 'execution_requests') return executionUpdate;
        throw new Error(`unexpected ${table}`);
      })
    };
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(updatePayload).toEqual(
      expect.objectContaining({
        status: 'launched',
        lease_expires_at: null,
        last_error: null
      })
    );
    expect(executionUpdate.eq).toHaveBeenCalledWith('claimed_by_device_id', DEVICE_ID);
  });
});
