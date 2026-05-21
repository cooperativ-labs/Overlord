import {
  computePromotedObjectivePositions,
  computeReorderedObjectivePositions,
  promoteNextFutureDraft
} from '@/lib/objectives';

describe('computePromotedObjectivePositions', () => {
  it('moves the promoted future objective into the current draft slot and shifts the intervening queue down', () => {
    expect(
      computePromotedObjectivePositions(
        [
          { id: 'draft-a', state: 'draft', position: 3, created_at: '2026-05-20T10:00:00.000Z' },
          { id: 'future-c', state: 'future', position: 4, created_at: '2026-05-20T10:01:00.000Z' },
          { id: 'future-b', state: 'future', position: 5, created_at: '2026-05-20T10:02:00.000Z' },
          {
            id: 'complete-z',
            state: 'complete',
            position: 0,
            created_at: '2026-05-20T09:00:00.000Z'
          }
        ],
        'future-b'
      )
    ).toEqual({
      'complete-z': 0,
      'future-b': 3,
      'draft-a': 4,
      'future-c': 5
    });
  });
});

describe('computeReorderedObjectivePositions', () => {
  it('reuses the existing future slots when reordering future objectives', () => {
    expect(
      computeReorderedObjectivePositions(
        [
          { id: 'future-a', state: 'future', position: 4, created_at: '2026-05-20T10:00:00.000Z' },
          { id: 'future-b', state: 'future', position: 6, created_at: '2026-05-20T10:01:00.000Z' },
          { id: 'future-c', state: 'future', position: 9, created_at: '2026-05-20T10:02:00.000Z' }
        ],
        ['future-c', 'future-a', 'future-b']
      )
    ).toEqual({
      'future-c': 4,
      'future-a': 6,
      'future-b': 9
    });
  });
});

describe('promoteNextFutureDraft', () => {
  it('promotes the next future objective by queue position without created_at ordering', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const selectQuery = {
      select: jest.fn(() => selectQuery),
      eq: jest.fn(() => selectQuery),
      order: jest.fn((column: string, options: { ascending: boolean }) => {
        orderCalls.push({ column, ascending: options.ascending });
        return selectQuery;
      }),
      limit: jest.fn(() => selectQuery),
      maybeSingle: jest.fn(async () => ({ data: { id: 'future-1' }, error: null }))
    };
    const updateQuery = {
      update: jest.fn(() => updateQuery),
      eq: jest.fn(() => updateQuery)
    };
    const supabase = {
      from: jest.fn().mockReturnValueOnce(selectQuery).mockReturnValueOnce(updateQuery)
    };

    await expect(promoteNextFutureDraft(supabase as never, 'ticket-1')).resolves.toBe(true);

    expect(orderCalls).toEqual([{ column: 'position', ascending: true }]);
    expect(updateQuery.update).toHaveBeenCalledWith({ state: 'draft', completed_at: null });
    expect(updateQuery.eq).toHaveBeenCalledWith('id', 'future-1');
  });
});
