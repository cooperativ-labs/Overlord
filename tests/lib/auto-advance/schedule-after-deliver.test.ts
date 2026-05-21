import { resolveNextQueuedObjectiveAfterDeliver } from '@/lib/auto-advance/schedule-after-deliver';

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
