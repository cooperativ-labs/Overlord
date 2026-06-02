import {
  createExecutionRequest,
  failActiveExecutionRequestsForObjective,
  failStaleExecutionRequest,
  isObjectiveLaunchableForExecution
} from '@/lib/overlord/execution-requests';
import { NO_ASSIGNED_AGENT_ERROR } from '@/lib/overlord/resolve-execution-agent';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'cccccccc-0000-4000-8000-000000000099';
const OBJECTIVE_ID = 'dddddddd-0000-4000-8000-000000000099';
const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

type TableHandlers = Record<string, () => unknown>;

function projectsQuery(name = 'Test Project') {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: { name }, error: null }))
  };
  return chain;
}

// G4 primary check: project_resource_directories.select('id')...eq('is_primary', true).limit(1)
function primaryResourceQuery(hasPrimary: boolean) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    limit: jest.fn(async () => ({ data: hasPrimary ? [{ id: 'dir-1' }] : [], error: null }))
  };
  return chain;
}

function orgExecutionTargetsQuery(label = 'my-target') {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: { label }, error: null }))
  };
  return chain;
}

function buildSupabase(handlers: TableHandlers) {
  // Default to "a primary exists" so the G4 guard passes unless a test overrides.
  const withDefaults: TableHandlers = {
    projects: () => projectsQuery(),
    project_resource_directories: () => primaryResourceQuery(true),
    organization_execution_targets: () => orgExecutionTargetsQuery(),
    ...handlers
  };
  return {
    from: jest.fn((table: string) => {
      const handler = withDefaults[table];
      if (!handler) throw new Error(`unexpected table: ${table}`);
      return handler();
    })
  };
}

function ticketQuery(ticketOverrides: Partial<{ for_human: boolean | null }> = {}) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({
      data: {
        id: TICKET_UUID,
        ticket_id: '1:999',
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        for_human: false,
        ...ticketOverrides
      },
      error: null
    }))
  };
  return chain;
}

function objectiveQuery(
  objective: Partial<{
    id: string;
    state: string;
    objective: string | null;
    assigned_agent: unknown;
  }> = {},
  options: { error?: string; missing?: boolean } = {}
) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => {
      if (options.error) return { data: null, error: { message: options.error } };
      if (options.missing) return { data: null, error: null };
      return {
        data: {
          id: OBJECTIVE_ID,
          ticket_id: TICKET_UUID,
          state: 'draft',
          objective: 'Ship the feature',
          assigned_agent: { agent: 'codex', model: null, thinking: null },
          ...objective
        },
        error: null
      };
    }),
    update: jest.fn(() => ({
      eq: jest.fn(async () => ({ error: null }))
    }))
  };
  return chain;
}

function executionRequestInsert(options: {
  duplicate?: boolean;
  existingId?: string;
  captureInsert?: (row: unknown) => void;
  /** Pre-check / race lookup result for the active-objective query (Phase 3). */
  activeRequest?: Record<string, unknown> | null;
  captureResetUpdate?: (update: unknown) => void;
}) {
  const insertedRow = {
    id: 'req-1',
    organization_id: ORG_ID,
    ticket_id: TICKET_UUID,
    objective_id: OBJECTIVE_ID,
    idempotency_key: 'auto_advance:dddddddd-0000-4000-8000-000000000099',
    status: 'queued',
    agent_identifier: 'claude',
    model_identifier: null,
    thinking_level: null,
    target_kind: 'any'
  };
  const activeRequest = options.activeRequest ?? null;

  return {
    insert: jest.fn((row: unknown) => {
      options.captureInsert?.(row);
      return {
        select: jest.fn(() => ({
          single: jest.fn(async () => {
            if (options.duplicate) {
              return { data: null, error: { code: '23505', message: 'duplicate' } };
            }
            return { data: insertedRow, error: null };
          })
        }))
      };
    }),
    // Phase 3 stale-row reset (reuseActiveRequest): update(...).eq().select().single()
    update: jest.fn((update: unknown) => {
      options.captureResetUpdate?.(update);
      const chain = {
        eq: jest.fn(() => chain),
        in: jest.fn(() => chain),
        select: jest.fn(() => chain),
        maybeSingle: jest.fn(async () => ({
          data: activeRequest ? { ...activeRequest, status: 'queued' } : insertedRow,
          error: null
        })),
        single: jest.fn(async () => ({
          data: activeRequest ? { ...activeRequest, status: 'queued' } : insertedRow,
          error: null
        }))
      };
      return chain;
    }),
    select: jest.fn(() => {
      const chain = {
        eq: jest.fn(() => chain),
        in: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        // Active-objective pre-check / race lookup.
        maybeSingle: jest.fn(async () => ({ data: activeRequest, error: null })),
        // Legacy idempotency_key fallback.
        single: jest.fn(async () => ({
          data: { ...insertedRow, id: options.existingId ?? 'req-existing' },
          error: null
        }))
      };
      return chain;
    })
  };
}

function ticketEventsInsert() {
  return { insert: jest.fn(async () => ({ error: null })) };
}

describe('isObjectiveLaunchableForExecution', () => {
  it('allows draft, submitted, and launching', () => {
    expect(isObjectiveLaunchableForExecution('draft')).toBe(true);
    expect(isObjectiveLaunchableForExecution('submitted')).toBe(true);
    expect(isObjectiveLaunchableForExecution('launching')).toBe(true);
  });

  it('rejects terminal or in-flight execution states', () => {
    expect(isObjectiveLaunchableForExecution('complete')).toBe(false);
    expect(isObjectiveLaunchableForExecution('executing')).toBe(false);
    expect(isObjectiveLaunchableForExecution('future')).toBe(false);
  });
});

describe('failActiveExecutionRequestsForObjective', () => {
  it('marks active requests failed and clears the lease', async () => {
    const captureUpdate = jest.fn();
    const chain = {
      update: jest.fn((patch: unknown) => {
        captureUpdate(patch);
        return chain;
      }),
      eq: jest.fn(() => chain),
      in: jest.fn(() => chain),
      select: jest.fn(async () => ({ data: [{ id: 'req-1' }], error: null }))
    };
    const supabase = buildSupabase({
      execution_requests: () => chain
    });

    const result = await failActiveExecutionRequestsForObjective({
      supabase: supabase as never,
      organizationId: ORG_ID,
      objectiveId: OBJECTIVE_ID,
      requestedBy: USER_ID
    });

    expect(result.failedCount).toBe(1);
    expect(captureUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        lease_expires_at: null,
        last_error: expect.stringContaining('no longer launchable')
      })
    );
    expect(chain.in).toHaveBeenCalledWith('status', ['queued', 'claimed', 'launching']);
  });
});

describe('failStaleExecutionRequest', () => {
  const REQUEST_ID = 'eeeeeeee-0000-4000-8000-000000000099';

  function buildChain(returned: Record<string, unknown> | null) {
    const calls = { lt: 0 };
    const chain = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      lt: jest.fn(() => {
        calls.lt += 1;
        return chain;
      }),
      select: jest.fn(() => chain),
      maybeSingle: jest.fn(async () => ({ data: returned, error: null }))
    };
    return { chain, calls };
  }

  const nowMs = Date.parse('2026-06-02T00:05:00.000Z');

  it('fails a stale row guarded on status + expired lease and returns it', async () => {
    const { chain, calls } = buildChain({ id: REQUEST_ID, status: 'failed' });
    let captured: unknown;
    chain.update.mockImplementation((patch: unknown) => {
      captured = patch;
      return chain;
    });
    const supabase = buildSupabase({ execution_requests: () => chain });

    const result = await failStaleExecutionRequest({
      supabase: supabase as never,
      request: {
        id: REQUEST_ID,
        organization_id: ORG_ID,
        status: 'launching',
        lease_expires_at: '2026-06-02T00:00:00.000Z'
      } as never,
      nowMs
    });

    expect(result).toEqual({ id: REQUEST_ID, status: 'failed' });
    expect(captured).toEqual(
      expect.objectContaining({
        status: 'failed',
        lease_expires_at: null,
        claimed_by_execution_target_id: null
      })
    );
    // Guarded on status and on an expired lease so concurrent polls cannot both win.
    expect(chain.eq).toHaveBeenCalledWith('status', 'launching');
    expect(calls.lt).toBe(1);
  });

  it('returns null when it loses the compare-and-swap race', async () => {
    const { chain } = buildChain(null);
    const supabase = buildSupabase({ execution_requests: () => chain });

    const result = await failStaleExecutionRequest({
      supabase: supabase as never,
      request: {
        id: REQUEST_ID,
        organization_id: ORG_ID,
        status: 'claimed',
        lease_expires_at: '2026-06-02T00:00:00.000Z'
      } as never,
      nowMs
    });

    expect(result).toBeNull();
  });

  it('omits the lease guard when the stale row has no lease recorded', async () => {
    const { chain, calls } = buildChain({ id: REQUEST_ID, status: 'failed' });
    const supabase = buildSupabase({ execution_requests: () => chain });

    await failStaleExecutionRequest({
      supabase: supabase as never,
      request: {
        id: REQUEST_ID,
        organization_id: ORG_ID,
        status: 'claimed',
        lease_expires_at: null
      } as never,
      nowMs
    });

    expect(calls.lt).toBe(0);
  });
});

describe('createExecutionRequest', () => {
  beforeEach(() => {
    jest
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(
        'eeeeeeee-0000-4000-8000-000000000099' as `${string}-${string}-${string}-${string}-${string}`
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues execution for a custom assigned agent when a custom command is provided', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () =>
        objectiveQuery({
          assigned_agent: { agent: 'my-harness', model: 'local-llm', thinking: null }
        }),
      execution_requests: () => executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run',
      customCommand: 'my-harness --run'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        agent_identifier: 'my-harness',
        model_identifier: 'local-llm',
        thinking_level: null
      })
    );
  });

  it('promotes a draft objective to launching before inserting the request', async () => {
    const objectiveChain = objectiveQuery();
    let objectiveUpdate: unknown;
    objectiveChain.update = jest.fn((update: unknown) => {
      objectiveUpdate = update;
      return { eq: jest.fn(async () => ({ error: null })) };
    });

    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveChain,
      execution_requests: () => executionRequestInsert({}),
      ticket_events: () => ticketEventsInsert()
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    expect(objectiveUpdate).toEqual({ state: 'launching' });
    expect(result.objective.state).toBe('launching');
  });

  it('sets auto_advanced_at when requestedFrom is auto_advance', async () => {
    const objectiveChain = objectiveQuery();
    let objectiveUpdate: unknown;
    objectiveChain.update = jest.fn((update: unknown) => {
      objectiveUpdate = update;
      return { eq: jest.fn(async () => ({ error: null })) };
    });

    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveChain,
      execution_requests: () => executionRequestInsert({}),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'auto_advance'
    });

    expect(objectiveUpdate).toEqual(
      expect.objectContaining({
        state: 'launching',
        auto_advanced_at: expect.any(String)
      })
    );
  });

  it('uses only the objective assignment for agent/model/thinking', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () =>
        objectiveQuery({
          assigned_agent: { agent: 'codex', model: 'gpt-5.4', thinking: 'high' }
        }),
      execution_requests: () => executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run',
      agentIdentifier: 'claude',
      modelIdentifier: 'opus',
      thinkingLevel: 'low'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        agent_identifier: 'codex',
        model_identifier: 'gpt-5.4',
        thinking_level: 'high'
      })
    );
  });

  it('rejects execution when the objective has no assigned agent', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ assigned_agent: null }),
      execution_requests: () => executionRequestInsert({})
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run',
        agentIdentifier: 'codex',
        modelIdentifier: 'gpt-5',
        thinkingLevel: 'low'
      })
    ).rejects.toThrow(NO_ASSIGNED_AGENT_ERROR);
  });

  it('rejects auto-advance when the next objective has no assigned agent', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ assigned_agent: null }),
      execution_requests: () => executionRequestInsert({})
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'auto_advance'
      })
    ).rejects.toThrow(NO_ASSIGNED_AGENT_ERROR);
  });

  it('derives auto_advance idempotency key when none is provided', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery(),
      execution_requests: () => executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'auto_advance'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        idempotency_key: `auto_advance:${OBJECTIVE_ID}`
      })
    );
  });

  it('generates a manual idempotency key when none is provided', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery(),
      execution_requests: () => executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        idempotency_key: `manual_run:${OBJECTIVE_ID}:eeeeeeee-0000-4000-8000-000000000099`
      })
    );
  });

  it('returns the existing row when idempotency collides', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'submitted' }),
      execution_requests: () =>
        executionRequestInsert({ duplicate: true, existingId: 'req-existing' }),
      ticket_events: () => ticketEventsInsert()
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'auto_advance',
      idempotencyKey: `auto_advance:${OBJECTIVE_ID}`
    });

    expect(result.request.id).toBe('req-existing');
  });

  it('reuses the active request and emits a wake-up event on a duplicate manual run', async () => {
    const active = {
      id: 'req-active',
      organization_id: ORG_ID,
      ticket_id: TICKET_UUID,
      objective_id: OBJECTIVE_ID,
      status: 'queued'
    };
    const ticketEventsCapture = {
      insert: jest.fn(async () => ({ error: null }))
    };
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'launching' }),
      execution_requests: () => executionRequestInsert({ activeRequest: active }),
      ticket_events: () => ticketEventsCapture
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    expect(result.reused).toBe(true);
    expect(result.request.id).toBe('req-active');
    expect(ticketEventsCapture.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'execution_requested',
        payload: expect.objectContaining({ reused_execution_request: true })
      })
    );
  });

  it('resets a stale launching request to queued before re-queueing', async () => {
    let resetUpdate: Record<string, unknown> | undefined;
    const active = {
      id: 'req-stale',
      organization_id: ORG_ID,
      ticket_id: TICKET_UUID,
      objective_id: OBJECTIVE_ID,
      status: 'launching'
    };
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'launching' }),
      execution_requests: () =>
        executionRequestInsert({
          activeRequest: active,
          captureResetUpdate: u => (resetUpdate = u as Record<string, unknown>)
        }),
      ticket_events: () => ticketEventsInsert()
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    expect(result.reused).toBe(true);
    expect(resetUpdate).toEqual(
      expect.objectContaining({
        status: 'queued',
        claimed_at: null,
        lease_expires_at: null
      })
    );
  });

  it('does not re-queue an active request that became terminal during reuse', async () => {
    const active = {
      id: 'req-raced',
      organization_id: ORG_ID,
      ticket_id: TICKET_UUID,
      objective_id: OBJECTIVE_ID,
      status: 'launching'
    };
    const latestTerminal = {
      ...active,
      status: 'launched',
      lease_expires_at: null
    };
    const ticketEventsCapture = {
      insert: jest.fn(async () => ({ error: null }))
    };
    let executionRequestCall = 0;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'launching' }),
      execution_requests: () => {
        executionRequestCall += 1;
        if (executionRequestCall === 1) {
          const activeLookup = {
            select: jest.fn(() => activeLookup),
            eq: jest.fn(() => activeLookup),
            in: jest.fn(() => activeLookup),
            order: jest.fn(() => activeLookup),
            limit: jest.fn(() => activeLookup),
            maybeSingle: jest.fn(async () => ({ data: active, error: null }))
          };
          return activeLookup;
        }
        if (executionRequestCall === 2) {
          const reset = {
            update: jest.fn(() => reset),
            eq: jest.fn(() => reset),
            in: jest.fn(() => reset),
            select: jest.fn(() => reset),
            maybeSingle: jest.fn(async () => ({ data: null, error: null }))
          };
          return reset;
        }
        const latestLookup = {
          select: jest.fn(() => latestLookup),
          eq: jest.fn(() => latestLookup),
          maybeSingle: jest.fn(async () => ({ data: latestTerminal, error: null }))
        };
        return latestLookup;
      },
      ticket_events: () => ticketEventsCapture
    });

    const result = await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run'
    });

    expect(result.reused).toBe(true);
    expect(result.request.status).toBe('launched');
    expect(ticketEventsCapture.insert).not.toHaveBeenCalled();
  });

  it('rejects non-agent tickets', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery({ for_human: true })
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run'
      })
    ).rejects.toThrow(
      'Ticket is marked for human execution. Switch it back to agent in the ticket settings to enable agent runs.'
    );
  });

  it('rejects objectives that are not launchable', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery({ state: 'complete' })
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run'
      })
    ).rejects.toThrow('Objective is not launchable');
  });

  it('writes execution_requested with resolved agent/model/thinking and target_kind', async () => {
    const events = ticketEventsInsert();
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () =>
        objectiveQuery({
          assigned_agent: { agent: 'codex', model: 'gpt-5.4', thinking: null }
        }),
      execution_requests: () => executionRequestInsert({}),
      ticket_events: () => events
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'auto_advance',
      targetKind: 'ssh'
    });

    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'execution_requested',
        payload: expect.objectContaining({
          requested_from: 'auto_advance',
          agent_identifier: 'codex',
          model_identifier: 'gpt-5.4',
          thinking_level: null,
          target_kind: 'ssh'
        })
      })
    );
  });

  describe('G4 — no primary directory throws at request time', () => {
    it('throws naming project + target for a specific-target run with no primary', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        projects: () => projectsQuery('Overlord'),
        project_resource_directories: () => primaryResourceQuery(false),
        organization_execution_targets: () => orgExecutionTargetsQuery('my-laptop')
      });

      await expect(
        createExecutionRequest(supabase as never, {
          ticketId: TICKET_UUID,
          objectiveId: OBJECTIVE_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          requestedFrom: 'manual_run',
          targetExecutionTargetId: 'target-xyz'
        })
      ).rejects.toThrow('No primary directory is set for "Overlord" on "my-laptop"');
      // Nothing was queued.
      expect(captureInsert).not.toHaveBeenCalled();
    });

    it('throws for a target-agnostic run when the project has no primary anywhere', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        projects: () => projectsQuery('Overlord'),
        project_resource_directories: () => primaryResourceQuery(false)
      });

      await expect(
        createExecutionRequest(supabase as never, {
          ticketId: TICKET_UUID,
          objectiveId: OBJECTIVE_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          requestedFrom: 'manual_run',
          targetKind: 'any'
        })
      ).rejects.toThrow('No primary directory is set for "Overlord" on any execution target');
      expect(captureInsert).not.toHaveBeenCalled();
    });

    it('does not check the primary when an explicit resource is supplied', async () => {
      const captureInsert = jest.fn();
      // Resource validation query: select('project_id, execution_target_id').eq('id').maybeSingle()
      const resourceLookup = {
        select: jest.fn(() => resourceLookup),
        eq: jest.fn(() => resourceLookup),
        maybeSingle: jest.fn(async () => ({
          data: { project_id: PROJECT_ID, execution_target_id: 'target-xyz' },
          error: null
        }))
      };
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        project_resource_directories: () => resourceLookup
      });

      await createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run',
        targetResourceId: 'resource-1',
        targetExecutionTargetId: 'target-xyz'
      });

      expect(captureInsert).toHaveBeenCalled();
    });

    it('does not check the primary when an explicit working directory is supplied', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        // Would throw if consulted, but the explicit dir short-circuits the check.
        project_resource_directories: () => primaryResourceQuery(false)
      });

      await createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        objectiveId: OBJECTIVE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run',
        workingDirectory: '/explicit/dir'
      });

      expect(captureInsert).toHaveBeenCalled();
    });
  });

  describe('Finding #3 — explicit targetResourceId is validated before it is trusted', () => {
    function resourceLookup(resource: { project_id: string; execution_target_id: string } | null) {
      const chain = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        maybeSingle: jest.fn(async () => ({ data: resource, error: null }))
      };
      return chain;
    }

    it('rejects a resource from a different project', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        project_resource_directories: () =>
          resourceLookup({ project_id: 'other-project', execution_target_id: 'target-xyz' })
      });

      await expect(
        createExecutionRequest(supabase as never, {
          ticketId: TICKET_UUID,
          objectiveId: OBJECTIVE_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          requestedFrom: 'manual_run',
          targetResourceId: 'resource-foreign'
        })
      ).rejects.toThrow("does not belong to this ticket's project");
      expect(captureInsert).not.toHaveBeenCalled();
    });

    it('rejects a resource that lives on a different target than requested', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        project_resource_directories: () =>
          resourceLookup({ project_id: PROJECT_ID, execution_target_id: 'target-A' })
      });

      await expect(
        createExecutionRequest(supabase as never, {
          ticketId: TICKET_UUID,
          objectiveId: OBJECTIVE_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          requestedFrom: 'manual_run',
          targetResourceId: 'resource-1',
          targetExecutionTargetId: 'target-B'
        })
      ).rejects.toThrow('is not on the requested execution target');
      expect(captureInsert).not.toHaveBeenCalled();
    });

    it('rejects a resource id that does not exist', async () => {
      const captureInsert = jest.fn();
      const supabase = buildSupabase({
        tickets: () => ticketQuery(),
        objectives: () => objectiveQuery(),
        execution_requests: () => executionRequestInsert({ captureInsert }),
        ticket_events: () => ticketEventsInsert(),
        project_resource_directories: () => resourceLookup(null)
      });

      await expect(
        createExecutionRequest(supabase as never, {
          ticketId: TICKET_UUID,
          objectiveId: OBJECTIVE_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          requestedFrom: 'manual_run',
          targetResourceId: 'resource-missing'
        })
      ).rejects.toThrow('Selected resource directory was not found.');
      expect(captureInsert).not.toHaveBeenCalled();
    });
  });
});
