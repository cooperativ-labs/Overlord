import { createExecutionRequest } from '@/lib/overlord/execution-requests';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_UUID = 'cccccccc-0000-4000-8000-000000000099';
const OBJECTIVE_ID = 'dddddddd-0000-4000-8000-000000000099';
const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

type TableHandlers = Record<string, () => unknown>;

function buildSupabase(handlers: TableHandlers) {
  return {
    from: jest.fn((table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`unexpected table: ${table}`);
      return handler();
    })
  };
}

function ticketQuery(ticketOverrides: Partial<{ execution_target: string | null }> = {}) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({
      data: {
        id: TICKET_UUID,
        ticket_id: '1:999',
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        execution_target: 'agent',
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
          assigned_agent: null,
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
    select: jest.fn(() => {
      const chain = {
        eq: jest.fn(() => chain),
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

describe('createExecutionRequest', () => {
  beforeEach(() => {
    jest.spyOn(crypto, 'randomUUID').mockReturnValue(
      'eeeeeeee-0000-4000-8000-000000000099' as `${string}-${string}-${string}-${string}-${string}`
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('promotes a draft objective to submitted before inserting the request', async () => {
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

    expect(objectiveUpdate).toEqual({ state: 'submitted' });
    expect(result.objective.state).toBe('submitted');
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
        state: 'submitted',
        auto_advanced_at: expect.any(String)
      })
    );
  });

  it('prefers objective assignment over caller defaults for agent/model/thinking', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () =>
        objectiveQuery({
          assigned_agent: { agent: 'claude', model: 'opus', thinking: 'high' }
        }),
      execution_requests: () =>
        executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run',
      agentIdentifier: 'codex',
      modelIdentifier: 'gpt-5',
      thinkingLevel: 'low'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        agent_identifier: 'claude',
        model_identifier: 'opus',
        thinking_level: 'high'
      })
    );
  });

  it('uses explicit API agent/model/thinking when the objective has no assignment', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery(),
      execution_requests: () =>
        executionRequestInsert({ captureInsert: row => (inserted = row) }),
      ticket_events: () => ticketEventsInsert()
    });

    await createExecutionRequest(supabase as never, {
      ticketId: TICKET_UUID,
      objectiveId: OBJECTIVE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
      requestedFrom: 'manual_run',
      agentIdentifier: 'codex',
      modelIdentifier: 'gpt-5',
      thinkingLevel: 'low'
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        agent_identifier: 'codex',
        model_identifier: 'gpt-5',
        thinking_level: 'low'
      })
    );
  });

  it('derives auto_advance idempotency key when none is provided', async () => {
    let inserted: unknown;
    const supabase = buildSupabase({
      tickets: () => ticketQuery(),
      objectives: () => objectiveQuery(),
      execution_requests: () =>
        executionRequestInsert({ captureInsert: row => (inserted = row) }),
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
      execution_requests: () =>
        executionRequestInsert({ captureInsert: row => (inserted = row) }),
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

  it('rejects non-agent tickets', async () => {
    const supabase = buildSupabase({
      tickets: () => ticketQuery({ execution_target: 'human' })
    });

    await expect(
      createExecutionRequest(supabase as never, {
        ticketId: TICKET_UUID,
        userId: USER_ID,
        organizationId: ORG_ID,
        requestedFrom: 'manual_run'
      })
    ).rejects.toThrow('Ticket is not configured for agent execution.');
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
      objectives: () => objectiveQuery(),
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
          agent_identifier: 'claude',
          model_identifier: null,
          thinking_level: null,
          target_kind: 'ssh'
        })
      })
    );
  });
});
