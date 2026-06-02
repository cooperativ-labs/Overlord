jest.mock('@/app/api/protocol/_lib', () => ({
  parseProtocolBody: jest.fn(),
  internalErrorResponse: jest.fn(
    () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })
  )
}));
jest.mock('@/supabase/utils/service-role');
jest.mock('@/lib/overlord/upsert-device');
jest.mock('@/lib/overlord/notifications/orchestrator', () => ({
  emitWorkflowNotification: jest.fn(async () => ({ sent: true }))
}));
// Keep the real module (the route relies on isObjectiveLaunchableForExecution,
// failActiveExecutionRequestsForObjective, etc.) but stub the stale-launch CAS
// so the every-5-minutes fix can be asserted without a live DB round-trip.
jest.mock('@/lib/overlord/execution-requests', () => {
  const actual = jest.requireActual('@/lib/overlord/execution-requests');
  return { __esModule: true, ...actual, failStaleExecutionRequest: jest.fn() };
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const EXECUTION_TARGET_ID = 'target-aaa';
const REQUEST_ID = 'req-aaa';
const OBJECTIVE_ID = 'obj-aaa';
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
  targetResourceRow = null as {
    directory_path: string;
    execution_target_id: string;
    project_id?: string;
  } | null,
  targetAgentFlags = undefined as Record<string, unknown> | null | undefined,
  targetAgentFlagsError = null as { message: string } | null,
  objectiveStates = { [OBJECTIVE_ID]: 'draft' } as Record<string, string>,
  memberOrgIds = [ORG_ID] as number[],
  targetOrgIds = [ORG_ID] as number[]
} = {}) {
  // Supports both bare `await insert({...})` (missing-primary / target-config
  // paths) and the chained `insert({...}).select('id').maybeSingle()` used by
  // the stalled-launch notification.
  const ticketEventsInsert = jest.fn(() => ({
    error: null,
    select: jest.fn(() => ({
      maybeSingle: jest.fn(async () => ({ data: { id: 'evt-1' }, error: null }))
    }))
  }));
  const staleFailUpdate = {
    update: jest.fn(() => staleFailUpdate),
    eq: jest.fn(() => staleFailUpdate),
    in: jest.fn(() => staleFailUpdate),
    select: jest.fn(async () => ({ data: [{ id: REQUEST_ID }], error: null }))
  };

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

  const objectivesQuery = {
    select: jest.fn(() => objectivesQuery),
    in: jest.fn(async (_column: string, ids: string[]) => ({
      data: ids.map(id => ({ id, state: objectiveStates[id] ?? 'draft' })),
      error: null
    }))
  };

  let executionRequestsCalls = 0;

  return {
    from: jest.fn((table: string) => {
      if (table === 'execution_requests') {
        executionRequestsCalls += 1;
        if (executionRequestsCalls === 1) return queueQuery;
        if (executionRequestsCalls === 2 && objectiveStates[OBJECTIVE_ID] === 'complete') {
          return staleFailUpdate;
        }
        return claimUpdate;
      }
      if (table === 'objectives') {
        return objectivesQuery;
      }
      if (table === 'project_resource_directories') {
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          order: jest.fn(() => chain),
          limit: jest.fn(() => chain),
          maybeSingle: jest.fn(async () => {
            if (targetResourceRow) return { data: targetResourceRow, error: null };
            return { data: resourceDirectory, error: null };
          })
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
          })),
          // notifyStalledLaunch reads the ticket reference/title via maybeSingle.
          maybeSingle: jest.fn(async () => ({
            data: { ticket_id: '1:100', title: 'Test ticket' },
            error: null
          }))
        };
        return chain;
      }
      if (table === 'user_execution_targets') {
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(() => chain),
          maybeSingle: jest.fn(async () => ({
            data:
              targetAgentFlagsError || targetAgentFlags === undefined
                ? null
                : { agent_flags: targetAgentFlags },
            error: targetAgentFlagsError
          }))
        };
        return chain;
      }
      if (table === 'ticket_events') {
        return { insert: ticketEventsInsert };
      }
      if (table === 'members') {
        // Org-agnostic claim: orgs the user is a member of.
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(async () => ({
            data: memberOrgIds.map(id => ({ organization_id: id })),
            error: null
          }))
        };
        return chain;
      }
      if (table === 'organization_execution_targets') {
        // Orgs the claiming target is shared with.
        const chain = {
          select: jest.fn(() => chain),
          eq: jest.fn(async () => ({
            data: targetOrgIds.map(id => ({ organization_id: id })),
            error: null
          }))
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
    queueQuery,
    claimUpdate,
    staleFailUpdate,
    objectivesQuery,
    ticketEventsInsert
  };
}

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: REQUEST_ID,
    objective_id: OBJECTIVE_ID,
    organization_id: ORG_ID,
    ticket_id: 'ticket-uuid',
    project_id: PROJECT_ID,
    status: 'queued',
    attempt_count: 0,
    target_execution_target_id: null,
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
    upsertDeviceFromProtocol.mockResolvedValue(EXECUTION_TARGET_ID);
    // Default: the stale-launch CAS "wins" and returns the failed row.
    const { failStaleExecutionRequest } = jest.requireMock('@/lib/overlord/execution-requests');
    failStaleExecutionRequest.mockResolvedValue(
      baseCandidate({ status: 'failed', lease_expires_at: null })
    );
  });

  it('returns null request when no candidates are claimable', async () => {
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          target_execution_target_id: 'other-target',
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

  it('falls back to the execution target primary project resource directory', async () => {
    const claimed = baseCandidate({ status: 'claimed', launch_params: {} });
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: {} })],
      claimResult: claimed,
      resourceDirectory: { directory_path: '/from-target-resource' }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.workingDirectory).toBe('/from-target-resource');
  });

  it('overrides launch_params flags/preCommand with the claiming target config', async () => {
    const launchParams = {
      workingDirectory: '/repo',
      flags: ['--from-request'],
      preCommand: 'global-pre'
    };
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: launchParams })],
      claimResult: baseCandidate({ status: 'claimed', launch_params: launchParams }),
      targetAgentFlags: { claude: { flags: ['--from-target'], preCommand: 'target-pre' } }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.flags).toEqual(['--from-target']);
    expect(body.launch.preCommand).toBe('target-pre');
  });

  it('falls back to launch_params flags when the target has no config for the agent', async () => {
    const launchParams = {
      workingDirectory: '/repo',
      flags: ['--from-request'],
      preCommand: 'global-pre'
    };
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: launchParams })],
      claimResult: baseCandidate({ status: 'claimed', launch_params: launchParams }),
      targetAgentFlags: { codex: { flags: ['--other'] } }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.flags).toEqual(['--from-request']);
    expect(body.launch.preCommand).toBe('global-pre');
  });

  it('does not fall back to launch_params when the target explicitly clears the agent config', async () => {
    const launchParams = {
      workingDirectory: '/repo',
      flags: ['--from-request'],
      preCommand: 'global-pre'
    };
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: launchParams })],
      claimResult: baseCandidate({ status: 'claimed', launch_params: launchParams }),
      targetAgentFlags: { claude: { flags: [] } }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    const body = await response.json();
    expect(body.launch.flags).toEqual([]);
    expect(body.launch.preCommand).toBeNull();
  });

  it('fails closed (no claim, no fallback flags) when target-config lookup errors', async () => {
    const launchParams = {
      workingDirectory: '/repo',
      flags: ['--from-request'],
      preCommand: 'global-pre'
    };
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: launchParams })],
      claimResult: baseCandidate({ status: 'claimed', launch_params: launchParams }),
      targetAgentFlagsError: { message: 'connection reset' }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    // Candidate skipped: no fallback launch payload returned, and the request is
    // never claimed (left queued for retry) so a transient config error cannot
    // strand the request.
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(supabase.claimUpdate.update).not.toHaveBeenCalled();
  });

  it('fails and notifies an expired claimed request instead of re-claiming it', async () => {
    const expiredLease = new Date(Date.now() - 60_000).toISOString();
    const candidate = baseCandidate({
      status: 'claimed',
      attempt_count: 1,
      lease_expires_at: expiredLease,
      launch_params: { workingDirectory: '/repo' }
    });
    const supabase = buildClaimSupabase({ candidates: [candidate] });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);
    const { failStaleExecutionRequest } = jest.requireMock('@/lib/overlord/execution-requests');
    const { emitWorkflowNotification } = jest.requireMock(
      '@/lib/overlord/notifications/orchestrator'
    );

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    // No relaunch happened: the stalled row is failed + cleared from the queue.
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(failStaleExecutionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ id: REQUEST_ID }) })
    );
    expect(supabase.claimUpdate.update).not.toHaveBeenCalled();
    // The user is notified (in-app alert event + push) so they can retry.
    expect(supabase.ticketEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'alert',
        payload: expect.objectContaining({ entry_type: 'execution_stalled', retryable: true })
      })
    );
    expect(emitWorkflowNotification).toHaveBeenCalled();
  });

  it('fails and notifies a stale launching request after the lease expires', async () => {
    const expiredLease = new Date(Date.now() - 60_000).toISOString();
    const candidate = baseCandidate({
      status: 'launching',
      attempt_count: 2,
      lease_expires_at: expiredLease,
      launch_params: { workingDirectory: '/repo' }
    });
    const supabase = buildClaimSupabase({ candidates: [candidate] });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);
    const { failStaleExecutionRequest } = jest.requireMock('@/lib/overlord/execution-requests');

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(failStaleExecutionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ status: 'launching' }) })
    );
    expect(supabase.claimUpdate.update).not.toHaveBeenCalled();
  });

  it('does not notify twice when another poll already failed the stale request', async () => {
    const expiredLease = new Date(Date.now() - 60_000).toISOString();
    const candidate = baseCandidate({
      status: 'claimed',
      lease_expires_at: expiredLease,
      launch_params: { workingDirectory: '/repo' }
    });
    const supabase = buildClaimSupabase({ candidates: [candidate] });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);
    const { failStaleExecutionRequest } = jest.requireMock('@/lib/overlord/execution-requests');
    // Lost the compare-and-swap race: the row already moved on.
    failStaleExecutionRequest.mockResolvedValueOnce(null);
    const { emitWorkflowNotification } = jest.requireMock(
      '@/lib/overlord/notifications/orchestrator'
    );

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(emitWorkflowNotification).not.toHaveBeenCalled();
    expect(supabase.ticketEventsInsert).not.toHaveBeenCalled();
  });

  it('does not reclaim a launching request before lease expiry', async () => {
    const futureLease = new Date(Date.now() + 60_000).toISOString();
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          status: 'launching',
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

  it('fails active requests when the objective is no longer launchable', async () => {
    const supabase = buildClaimSupabase({
      candidates: [
        baseCandidate({
          status: 'launching',
          lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
          launch_params: { workingDirectory: '/repo' }
        })
      ],
      objectiveStates: { [OBJECTIVE_ID]: 'complete' }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(supabase.staleFailUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        last_error: expect.stringContaining('no longer launchable')
      })
    );
    expect(supabase.claimUpdate.update).not.toHaveBeenCalled();
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

  it('returns null without claiming when no member org shares the claiming target', async () => {
    const supabase = buildClaimSupabase({
      candidates: [baseCandidate({ launch_params: { workingDirectory: '/repo' } })],
      // User is a member of org 1, but the target is only shared with org 2.
      memberOrgIds: [ORG_ID],
      targetOrgIds: [2]
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    // No candidate query was even run.
    expect(supabase.queueQuery.limit).not.toHaveBeenCalled();
  });

  const MISSING_PRIMARY_ERROR =
    'No primary resource directory is set for this project on this execution target.';

  it('rejects a target_resource_id whose project does not match the request (Finding #3 defense)', async () => {
    const supabase = buildClaimSupabase({
      // Resource lives on the claiming target but belongs to a different project,
      // so resolveWorkingDirectory must not return its path; the request then
      // hits the missing-primary backstop instead of launching a foreign repo.
      candidates: [baseCandidate({ launch_params: {}, target_resource_id: 'resource-foreign' })],
      targetResourceRow: {
        directory_path: '/foreign/repo',
        execution_target_id: EXECUTION_TARGET_ID,
        project_id: 'some-other-project'
      }
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(supabase.ticketEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ missing_primary: true }) })
    );
  });

  it('records a missing-primary backstop event and skips a project request with no primary', async () => {
    const supabase = buildClaimSupabase({
      // Project request, no explicit workingDirectory and no resolvable primary.
      candidates: [baseCandidate({ launch_params: {}, last_error: null })],
      resourceDirectory: null
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(supabase.ticketEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ missing_primary: true }) })
    );
    // Finding #5: the condition is stamped on the request so a re-poll does not
    // re-emit. The only execution_requests.update on this path is that stamp —
    // no claim happened.
    expect(supabase.claimUpdate.update).toHaveBeenCalledWith({ last_error: MISSING_PRIMARY_ERROR });
  });

  it('does not re-emit the missing-primary event when already flagged (Finding #5)', async () => {
    const supabase = buildClaimSupabase({
      // Same condition, but the request already carries the missing-primary error
      // from a prior poll, so the event must not be inserted again.
      candidates: [baseCandidate({ launch_params: {}, last_error: MISSING_PRIMARY_ERROR })],
      resourceDirectory: null
    });
    const { createServiceRoleClient } = jest.requireMock('@/supabase/utils/service-role');
    createServiceRoleClient.mockReturnValue(supabase);

    const response = await POST(new Request('http://localhost', { method: 'POST' }));
    await expect(response.json()).resolves.toEqual({ request: null });
    expect(supabase.ticketEventsInsert).not.toHaveBeenCalled();
    expect(supabase.claimUpdate.update).not.toHaveBeenCalled();
  });
});
