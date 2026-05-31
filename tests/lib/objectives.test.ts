import {
  computePromotedObjectivePositions,
  computeReorderedObjectivePositions,
  markSubmittedObjectiveExecuting,
  promoteNextFutureDraft
} from '@/lib/objectives';
import { NO_ASSIGNED_AGENT_ERROR } from '@/lib/overlord/resolve-execution-agent';

const TICKET_ID = 'ticket-1';
const OBJECTIVE_ID = 'objective-1';

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

describe('markSubmittedObjectiveExecuting', () => {
  it('stores agent_identifier from the objective assignment, not the attach payload', async () => {
    let objectiveUpdate: Record<string, unknown> | undefined;
    const submittedQuery = {
      select: jest.fn(() => submittedQuery),
      eq: jest.fn(() => submittedQuery),
      order: jest.fn(() => submittedQuery),
      limit: jest.fn(() => submittedQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: OBJECTIVE_ID,
          objective: 'Ship it',
          state: 'submitted',
          assigned_agent: { agent: 'codex', model: 'gpt-5.4', thinking: null }
        },
        error: null
      }))
    };
    const updateQuery = {
      update: jest.fn((update: Record<string, unknown>) => {
        objectiveUpdate = update;
        return updateQuery;
      }),
      eq: jest.fn(() => updateQuery)
    };
    const futureSelectQuery = {
      select: jest.fn(() => futureSelectQuery),
      eq: jest.fn(() => futureSelectQuery),
      order: jest.fn(() => futureSelectQuery),
      limit: jest.fn(() => futureSelectQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const draftProbeQuery = {
      select: jest.fn(() => draftProbeQuery),
      eq: jest.fn(() => draftProbeQuery),
      limit: jest.fn(() => draftProbeQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const insertQuery = { insert: jest.fn(async () => ({ error: null })) };

    const supabase = {
      from: jest
        .fn()
        .mockReturnValueOnce(submittedQuery)
        .mockReturnValueOnce(updateQuery)
        .mockReturnValueOnce(futureSelectQuery)
        .mockReturnValueOnce(draftProbeQuery)
        .mockReturnValueOnce(insertQuery)
    };

    const result = await markSubmittedObjectiveExecuting(
      supabase as never,
      TICKET_ID,
      {
        agentIdentifier: 'claude-code',
        metadata: { model: 'ignored-model' }
      },
      'user-1'
    );

    expect(result.didExecute).toBe(true);
    expect(objectiveUpdate).toEqual(
      expect.objectContaining({
        state: 'executing',
        agent_identifier: 'codex',
        model_identifier: 'gpt-5.4'
      })
    );
  });

  it('rejects execution when the launchable objective has no assigned agent', async () => {
    const submittedQuery = {
      select: jest.fn(() => submittedQuery),
      eq: jest.fn(() => submittedQuery),
      order: jest.fn(() => submittedQuery),
      limit: jest.fn(() => submittedQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: OBJECTIVE_ID,
          objective: 'Ship it',
          state: 'submitted',
          assigned_agent: null
        },
        error: null
      }))
    };
    const draftQuery = {
      select: jest.fn(() => draftQuery),
      eq: jest.fn(() => draftQuery),
      order: jest.fn(() => draftQuery),
      limit: jest.fn(() => draftQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };
    const executingQuery = {
      select: jest.fn(() => executingQuery),
      eq: jest.fn(() => executingQuery),
      in: jest.fn(() => executingQuery),
      order: jest.fn(() => executingQuery),
      limit: jest.fn(() => executingQuery),
      maybeSingle: jest.fn(async () => ({ data: null, error: null }))
    };

    const supabase = {
      from: jest
        .fn()
        .mockReturnValueOnce(submittedQuery)
        .mockReturnValueOnce(draftQuery)
        .mockReturnValueOnce(executingQuery)
    };

    await expect(
      markSubmittedObjectiveExecuting(
        supabase as never,
        TICKET_ID,
        { agentIdentifier: 'claude-code' },
        'user-1'
      )
    ).rejects.toThrow(NO_ASSIGNED_AGENT_ERROR);
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
