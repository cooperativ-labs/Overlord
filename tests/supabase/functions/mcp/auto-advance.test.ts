import { scheduleAutoAdvanceAfterDeliver } from '../../../../supabase/functions/mcp/handlers/_auto-advance.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 1;
const TICKET_ID = 'ticket-1';
const OBJECTIVE_ID = 'objective-1';

function selectSingle<T>(data: T) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data, error: null })),
    single: jest.fn(async () => ({ data, error: null }))
  };
  return chain;
}

describe('MCP scheduleAutoAdvanceAfterDeliver', () => {
  it('queues auto-advanced objectives through the launching execution-request lifecycle', async () => {
    let objectiveUpdate: Record<string, unknown> | null = null;
    let insertedRequest: Record<string, unknown> | null = null;
    let insertedEvent: Record<string, unknown> | null = null;
    let objectiveCall = 0;
    let executionRequestCall = 0;

    const objectiveSelect = selectSingle({
      id: OBJECTIVE_ID,
      objective: 'Run the next step',
      auto_advance: true,
      approval_reason: null,
      assigned_agent: { agent: 'codex', model: 'gpt-5', thinking: 'high' }
    });
    const objectiveUpdateChain = {
      update: jest.fn((payload: Record<string, unknown>) => {
        objectiveUpdate = payload;
        return objectiveUpdateChain;
      }),
      eq: jest.fn(() => objectiveUpdateChain)
    };
    const insertChain = {
      insert: jest.fn((payload: Record<string, unknown>) => {
        insertedRequest = payload;
        return insertChain;
      }),
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({ data: { id: 'req-1' }, error: null }))
    };
    const eventChain = {
      insert: jest.fn(async (payload: Record<string, unknown>) => {
        insertedEvent = payload;
        return { error: null };
      })
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'objectives') {
          objectiveCall += 1;
          return objectiveCall === 1 ? objectiveSelect : objectiveUpdateChain;
        }
        if (table === 'tickets') {
          return selectSingle({ project_id: 'project-1', for_human: false });
        }
        if (table === 'execution_requests') {
          executionRequestCall += 1;
          if (executionRequestCall === 1) return selectSingle(null);
          return insertChain;
        }
        if (table === 'ticket_events') return eventChain;
        throw new Error(`unexpected table: ${table}`);
      })
    };

    const result = await scheduleAutoAdvanceAfterDeliver({
      supabase: supabase as never,
      ticketId: TICKET_ID,
      userId: USER_ID,
      organizationId: ORG_ID
    });

    expect(result).toEqual({ advanced: true });
    expect(objectiveUpdate).toEqual(
      expect.objectContaining({
        state: 'launching',
        auto_advanced_at: expect.any(String)
      })
    );
    expect(insertedRequest).toEqual(
      expect.objectContaining({
        objective_id: OBJECTIVE_ID,
        requested_from: 'auto_advance',
        status: 'queued',
        idempotency_key: `auto_advance:${OBJECTIVE_ID}`
      })
    );
    expect(insertedEvent).toEqual(
      expect.objectContaining({
        event_type: 'execution_requested',
        payload: expect.objectContaining({
          execution_request_id: 'req-1',
          requested_from: 'auto_advance'
        })
      })
    );
  });

  it('does not report advanced when a stale request became failed during reuse', async () => {
    const activeRequest = {
      id: 'req-stale',
      organization_id: ORG_ID,
      ticket_id: TICKET_ID,
      objective_id: OBJECTIVE_ID,
      status: 'launching'
    };
    const latestTerminal = { ...activeRequest, status: 'failed' };
    const ticketEventsCapture = {
      insert: jest.fn(async () => ({ error: null }))
    };
    let executionRequestCall = 0;
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'objectives') {
          return selectSingle({
            id: OBJECTIVE_ID,
            objective: 'Run the next step',
            auto_advance: true,
            approval_reason: null,
            assigned_agent: { agent: 'codex', model: null, thinking: null }
          });
        }
        if (table === 'tickets') {
          return selectSingle({ project_id: 'project-1', for_human: false });
        }
        if (table === 'execution_requests') {
          executionRequestCall += 1;
          if (executionRequestCall === 1) {
            return selectSingle(activeRequest);
          }
          if (executionRequestCall === 2) {
            const resetChain = {
              update: jest.fn(() => resetChain),
              eq: jest.fn(() => resetChain),
              in: jest.fn(() => resetChain),
              select: jest.fn(() => resetChain),
              maybeSingle: jest.fn(async () => ({ data: null, error: null }))
            };
            return resetChain;
          }
          return selectSingle(latestTerminal);
        }
        if (table === 'ticket_events') return ticketEventsCapture;
        throw new Error(`unexpected table: ${table}`);
      })
    };

    const result = await scheduleAutoAdvanceAfterDeliver({
      supabase: supabase as never,
      ticketId: TICKET_ID,
      userId: USER_ID,
      organizationId: ORG_ID
    });

    expect(result).toEqual({ advanced: false });
    expect(ticketEventsCapture.insert).not.toHaveBeenCalled();
  });

  it('reverts launching objectives when an insert race cannot resolve an active request', async () => {
    let objectiveUpdate: Record<string, unknown> | null = null;
    let objectiveRevert: Record<string, unknown> | null = null;
    let objectiveFromCall = 0;
    let executionRequestCall = 0;

    const objectiveSelect = selectSingle({
      id: OBJECTIVE_ID,
      objective: 'Run the next step',
      auto_advance: true,
      approval_reason: null,
      assigned_agent: { agent: 'codex', model: null, thinking: null }
    });
    const objectiveUpdateChain = {
      update: jest.fn((payload: Record<string, unknown>) => {
        if (objectiveUpdate === null) objectiveUpdate = payload;
        else objectiveRevert = payload;
        return objectiveUpdateChain;
      }),
      eq: jest.fn(() => objectiveUpdateChain)
    };
    const insertChain = {
      insert: jest.fn(() => insertChain),
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => ({
        data: null,
        error: { code: '23505', message: 'duplicate active objective request' }
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'objectives') {
          objectiveFromCall += 1;
          return objectiveFromCall === 1 ? objectiveSelect : objectiveUpdateChain;
        }
        if (table === 'tickets') {
          return selectSingle({ project_id: 'project-1', for_human: false });
        }
        if (table === 'execution_requests') {
          executionRequestCall += 1;
          if (executionRequestCall === 1 || executionRequestCall === 3) {
            return selectSingle(null);
          }
          return insertChain;
        }
        if (table === 'ticket_events') {
          return { insert: jest.fn(async () => ({ error: null })) };
        }
        throw new Error(`unexpected table: ${table}`);
      })
    };

    const result = await scheduleAutoAdvanceAfterDeliver({
      supabase: supabase as never,
      ticketId: TICKET_ID,
      userId: USER_ID,
      organizationId: ORG_ID
    });

    expect(result).toEqual({ advanced: false });
    expect(objectiveUpdate).toEqual(
      expect.objectContaining({
        state: 'launching',
        auto_advanced_at: expect.any(String)
      })
    );
    expect(objectiveRevert).toEqual({
      state: 'draft',
      auto_advanced_at: null
    });
  });

  it.each([
    {
      label: 'a non-duplicate insert error',
      insertResult: {
        data: null,
        error: { code: '42501', message: 'permission denied for table execution_requests' }
      }
    },
    {
      label: 'an insert that returns no id',
      insertResult: { data: null, error: null }
    }
  ])('reverts launching objectives when $label', async ({ insertResult }) => {
    let objectiveUpdate: Record<string, unknown> | null = null;
    let objectiveRevert: Record<string, unknown> | null = null;
    let objectiveFromCall = 0;
    let executionRequestCall = 0;

    const objectiveSelect = selectSingle({
      id: OBJECTIVE_ID,
      objective: 'Run the next step',
      auto_advance: true,
      approval_reason: null,
      assigned_agent: { agent: 'codex', model: null, thinking: null }
    });
    const objectiveUpdateChain = {
      update: jest.fn((payload: Record<string, unknown>) => {
        if (objectiveUpdate === null) objectiveUpdate = payload;
        else objectiveRevert = payload;
        return objectiveUpdateChain;
      }),
      eq: jest.fn(() => objectiveUpdateChain)
    };
    const insertChain = {
      insert: jest.fn(() => insertChain),
      select: jest.fn(() => insertChain),
      single: jest.fn(async () => insertResult)
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'objectives') {
          objectiveFromCall += 1;
          return objectiveFromCall === 1 ? objectiveSelect : objectiveUpdateChain;
        }
        if (table === 'tickets') {
          return selectSingle({ project_id: 'project-1', for_human: false });
        }
        if (table === 'execution_requests') {
          executionRequestCall += 1;
          if (executionRequestCall === 1) return selectSingle(null);
          return insertChain;
        }
        if (table === 'ticket_events') {
          return { insert: jest.fn(async () => ({ error: null })) };
        }
        throw new Error(`unexpected table: ${table}`);
      })
    };

    const result = await scheduleAutoAdvanceAfterDeliver({
      supabase: supabase as never,
      ticketId: TICKET_ID,
      userId: USER_ID,
      organizationId: ORG_ID
    });

    expect(result).toEqual({ advanced: false });
    expect(objectiveUpdate).toEqual(
      expect.objectContaining({
        state: 'launching',
        auto_advanced_at: expect.any(String)
      })
    );
    expect(objectiveRevert).toEqual({
      state: 'draft',
      auto_advanced_at: null
    });
  });
});
