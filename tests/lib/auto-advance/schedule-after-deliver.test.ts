import {
  resolveNextQueuedObjectiveAfterDeliver,
  scheduleQueuedObjectiveAfterDeliver
} from '@/lib/auto-advance/schedule-after-deliver';
import { createExecutionRequest } from '@/lib/overlord/execution-requests';
import { sendPushNotification } from '@/lib/overlord/push-notifications';

jest.mock('@/lib/overlord/execution-requests', () => ({
  createExecutionRequest: jest.fn()
}));

jest.mock('@/lib/overlord/push-notifications', () => ({
  sendPushNotification: jest.fn()
}));

const mockCreateExecutionRequest = jest.mocked(createExecutionRequest);
const mockSendPushNotification = jest.mocked(sendPushNotification);

describe('resolveNextQueuedObjectiveAfterDeliver', () => {
  it('looks up the current draft by explicit queue position before creation time', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn((column: string, options: { ascending: boolean }) => {
        orderCalls.push({ column, ascending: options.ascending });
        return query;
      }),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: 'draft-1',
          objective: 'Implement the current draft',
          auto_advance: true,
          approval_reason: null,
          assigned_agent: null
        },
        error: null
      }))
    };
    const supabase = { from: jest.fn(() => query) };

    await expect(
      resolveNextQueuedObjectiveAfterDeliver(supabase as never, 'ticket-1')
    ).resolves.toMatchObject({ id: 'draft-1' });

    expect(orderCalls).toEqual([
      { column: 'position', ascending: true },
      { column: 'created_at', ascending: true }
    ]);
  });

  it('stops when no draft objective exists instead of promoting a future objective', async () => {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      update: jest.fn(() => query)
    };
    const supabase = { from: jest.fn(() => query) };

    await expect(
      resolveNextQueuedObjectiveAfterDeliver(supabase as never, 'ticket-1')
    ).resolves.toBeNull();

    expect(query.update).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleQueuedObjectiveAfterDeliver', () => {
  const baseInput = {
    supabase: { from: jest.fn() } as never,
    ticketId: 'ticket-1',
    userId: 'user-1',
    organizationId: 1,
    ticketReference: '1:99'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecutionRequest.mockResolvedValue({} as never);
    mockSendPushNotification.mockResolvedValue(undefined);
  });

  function mockDraftObjective(
    overrides: Partial<{
      id: string;
      objective: string | null;
      auto_advance: boolean | null;
      approval_reason: string | null;
    }> = {}
  ) {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: 'obj-1',
          objective: 'Next step',
          auto_advance: true,
          approval_reason: null,
          assigned_agent: null,
          ...overrides
        },
        error: null
      }))
    };
    return { from: jest.fn(() => query) };
  }

  it('creates an auto_advance execution request when the next draft has auto_advance enabled', async () => {
    const supabase = mockDraftObjective({ id: 'obj-42', auto_advance: true });

    await expect(
      scheduleQueuedObjectiveAfterDeliver({ ...baseInput, supabase })
    ).resolves.toEqual({ advanced: true });

    expect(mockCreateExecutionRequest).toHaveBeenCalledWith(supabase, {
      ticketId: 'ticket-1',
      objectiveId: 'obj-42',
      userId: 'user-1',
      organizationId: 1,
      requestedFrom: 'auto_advance',
      idempotencyKey: 'auto_advance:obj-42'
    });
    expect(mockSendPushNotification).not.toHaveBeenCalled();
  });

  it('returns advanced false when no draft objective exists', async () => {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const supabase = { from: jest.fn(() => query) };

    await expect(
      scheduleQueuedObjectiveAfterDeliver({ ...baseInput, supabase: supabase as never })
    ).resolves.toEqual({ advanced: false });

    expect(mockCreateExecutionRequest).not.toHaveBeenCalled();
  });

  it('does not enqueue when the draft objective text is blank', async () => {
    const supabase = mockDraftObjective({ objective: '   ' });

    await expect(
      scheduleQueuedObjectiveAfterDeliver({ ...baseInput, supabase })
    ).resolves.toEqual({ advanced: false });

    expect(mockCreateExecutionRequest).not.toHaveBeenCalled();
  });

  it('marks the ticket unread and emits awaiting_approval when auto_advance is false', async () => {
    const ticketUpdate = {
      update: jest.fn(() => ticketUpdate),
      eq: jest.fn(async () => ({ error: null }))
    };
    const eventsInsert = { insert: jest.fn(async () => ({ error: null })) };
    const draftQuery = {
      select: jest.fn(() => draftQuery),
      eq: jest.fn(() => draftQuery),
      order: jest.fn(() => draftQuery),
      limit: jest.fn(() => draftQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: 'obj-gated',
          objective: 'Needs approval',
          auto_advance: false,
          approval_reason: 'Please review the plan first.',
          assigned_agent: null
        },
        error: null
      }))
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'objectives') return draftQuery;
        if (table === 'tickets') return ticketUpdate;
        if (table === 'ticket_events') return eventsInsert;
        throw new Error(`unexpected table ${table}`);
      })
    };

    await expect(
      scheduleQueuedObjectiveAfterDeliver({ ...baseInput, supabase: supabase as never })
    ).resolves.toEqual({ advanced: true });

    expect(mockCreateExecutionRequest).not.toHaveBeenCalled();
    expect(ticketUpdate.update).toHaveBeenCalledWith({
      has_unopened_waiting_response: true,
      is_read: false
    });
    expect(eventsInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'awaiting_approval',
        summary: 'Please review the plan first.',
        objective_id: 'obj-gated'
      })
    );
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        body: 'Please review the plan first.'
      })
    );
  });
});
