jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const DEVICE_ID = 'device-fail';
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

  it('records failure and writes execution_launch_failed for the claiming device', async () => {
    mockParseBody();
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
          device_id: DEVICE_ID
        })
      })
    );
  });
});
