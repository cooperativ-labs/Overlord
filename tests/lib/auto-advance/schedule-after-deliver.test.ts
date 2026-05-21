import {
  resolveNextQueuedObjectiveAfterDeliver,
  selectQueuedObjectiveSource
} from '@/lib/auto-advance/schedule-after-deliver';

describe('selectQueuedObjectiveSource', () => {
  it('prefers a non-empty draft over a future objective', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: 'Implement API',
        futureObjective: 'Write docs'
      })
    ).toBe('draft');
  });

  it('falls back to future when draft is empty', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: '   ',
        futureObjective: 'Write docs'
      })
    ).toBe('future');
  });

  it('returns null when neither queue row has content', () => {
    expect(
      selectQueuedObjectiveSource({
        draftObjective: '',
        futureObjective: null
      })
    ).toBeNull();
  });
});

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
});
