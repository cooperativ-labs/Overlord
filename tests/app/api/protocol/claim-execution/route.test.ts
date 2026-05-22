jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/upsert-device');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const DEVICE_ID = 'device-aaa';
const REQUEST_ID = 'req-aaa';
const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/protocol/claim-execution/route'));
});

type Candidate = Record<string, unknown>;

function mockParseBody(data: Record<string, unknown> = {}) {
  const { parseProtocolBody } = jest.requireMock('@/app/api/protocol/_lib');
  parseProtocolBody.mockResolvedValue({
    ok: true,
    data: {
      deviceFingerprint: 'fp-test',
      leaseSeconds: 300,
      ...data
    },
    tokenContext: { userId: USER_ID, organizationId: ORG_ID }
  });
}

function buildClaimSupabase({
  candidates = [],
  claimResult = null,
  resourceDirectory = null as { directory_path: string } | null,
  deviceResource = null as { directory_path: string } | null,
  projectUser = null as { local_working_directory: string } | null,
  targetResourceRow = null as {
    directory_path: string;
    user_id: string;
    device_id: string;
  } | null
} = {}) {
  const claimUpdate = {
    update: jest.fn(() => claimUpdate),
    eq: jest.fn(() => claimUpdate),
    select: jest.fn(() => claimUpdate),
    lt: jest.fn(() => claimUpdate),
    maybeSingle: jest.fn(async () => ({ data: claimResult, error: null }))
  };

  const queueQuery = {
    select: jest.fn(() => queueQuery),
    eq: jest.fn(() => queueQuery),
    in: jest.fn(() => queueQuery),
    order: jest.fn(() => queueQuery),
    limit: jest.fn(async () => ({ data: candidates, error: null }))
  };

  let executionRequestsCalls = 0;

  return {
    from: jest.fn((table: string) => {
      if (table === 'execution_requests') {
        executionRequestsCalls += 1;
        return executionRequestsCalls === 1 ? queueQuery : claimUpdate;
      }
      if (table === 'project_resource_directories') {
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          order: jest.fn(() => chain),
          limit: jest.fn(() => chain),
          maybeSingle: jest.fn(async () => {
            if (targetResourceRow) return { data: targetResourceRow, error: null };
            if (deviceResource) return { data: deviceResource, error: null };
            return { data: resourceDirectory, error: null };
          })
        };
        return chain;
      }
      if (table === 'project_user') {
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          maybeSingle: jest.fn(async () => ({ data: projectUser, error: null }))
        };
        return chain;
      }
      if (table === 'tickets') {
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          single: jest.fn(async () => ({
            data: { id: 'ticket-uuid', ticket_id: '1:100', project_id: PROJECT_ID },
            error: null
          }))
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
    queueQuery,
    claimUpdate
  };
}

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: REQUEST_ID,
    organization_id: ORG_ID,
    ticket_id: 'ticket-uuid',
    project_id: PROJECT_ID,
    status: 'queued',
    attempt_count: 0,
    target_device_id: null,
    target_kind: 'any',
    target_resource_id: null,
    launch_params: {},
    agent_identifier: 'claude',
    model_identifier: null,
    thinking_level: null,
    launch_mode: 'run',
    lease_expires_at: null,
    ...overrides
  };
}

describe('POST /api/protocol/claim-execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseBody();
    const { upsertDeviceFromProtocol } = jest.requireMock('@/lib/overlord/upsert-device');
    upsertDeviceFromProtocol.mockResolvedValue(DEVICE_ID);
  });

  it('returns null request when no candidates are claimable', async () => {
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          target_device_id: 'other-device',
          launch_params: { workingDirectory: '/repo' }
        })
      ]
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ request: null });
  });

  it('skips ssh-targeted requests without sshCommand', async () => {
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          target_kind: 'ssh',
          launch_params: { workingDirectory: '/repo' }
        })
      ]
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
  });

  it('prefers explicit workingDirectory from launch params', async () => {
    const claimed = baseCandidate({
      status: 'claimed',
      launch_params: { workingDirectory: '/explicit' }
    });
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: { workingDirectory: '/explicit' } })],
      claimResult: claimed
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.workingDirectory).toBe('/explicit');
    expect(supabase.claimUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_count: 1 })
    );
  });

  it('falls back to project_user.local_working_directory', async () => {
    const claimed = baseCandidate({ status: 'claimed', launch_params: {} });
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: {} })],
      claimResult: claimed,
      projectUser: { local_working_directory: '/from-project-user' }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.workingDirectory).toBe('/from-project-user');
  });

  it('reclaims an expired claimed request and increments attempt_count', async () => {
    const expiredLease = new Date(Date.now() - 60_000).toISOString();
    const claimed = baseCandidate({
      status: 'claimed',
      attempt_count: 2,
      lease_expires_at: expiredLease,
      launch_params: { workingDirectory: '/repo' }
    });
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          status: 'claimed',
          attempt_count: 1,
          lease_expires_at: expiredLease,
          launch_params: { workingDirectory: '/repo' }
        })
      ],
      claimResult: claimed
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(supabase.claimUpdate.lt).toHaveBeenCalled();
    expect(supabase.claimUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_count: 2 })
    );
  });

  it('does not reclaim a claimed request before lease expiry', async () => {
    const futureLease = new Date(Date.now() + 60_000).toISOString();
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          status: 'claimed',
          lease_expires_at: futureLease,
          launch_params: { workingDirectory: '/repo' }
        })
      ],
      claimResult: null
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
  });
});
