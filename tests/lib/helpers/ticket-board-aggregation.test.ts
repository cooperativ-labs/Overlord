import {
  aggregateObjectivesByTicket,
  indexLatestSessionByTicket,
  indexLatestWaitingByTicket,
  resolveRunningAgent
} from '@/lib/helpers/ticket-board-aggregation';

describe('aggregateObjectivesByTicket', () => {
  it('returns an empty map for no rows', () => {
    expect(aggregateObjectivesByTicket([]).size).toBe(0);
  });

  it('uses the newest objective for the latest agent and counts completed objectives', () => {
    // Rows are ordered newest-first, matching the queries that feed this helper.
    const aggregates = aggregateObjectivesByTicket([
      {
        ticket_id: 't1',
        state: 'draft',
        objective: '',
        agent_identifier: null,
        assigned_agent: null
      },
      {
        ticket_id: 't1',
        state: 'complete',
        objective: 'do a thing',
        agent_identifier: 'claude',
        assigned_agent: { agent: 'claude' }
      },
      {
        ticket_id: 't1',
        state: 'complete',
        objective: 'older thing',
        agent_identifier: 'codex',
        assigned_agent: { agent: 'codex' }
      }
    ]);

    const aggregate = aggregates.get('t1');
    expect(aggregate?.latestObjectiveAgent).toBeNull();
    // Empty drafts inherit assignment; the newest non-null assigned_agent wins.
    expect(aggregate?.latestAssignedAgent).toEqual({ agent: 'claude' });
    expect(aggregate?.executedObjectivesCount).toBe(2);
    expect(aggregate?.hasExecutingObjective).toBe(false);
    expect(aggregate?.hasDraftObjectiveWithText).toBe(false);
  });

  it('tracks executing objectives and drafts with text', () => {
    const aggregates = aggregateObjectivesByTicket([
      {
        ticket_id: 't1',
        state: 'draft',
        objective: 'next step',
        agent_identifier: null,
        assigned_agent: null
      },
      {
        ticket_id: 't1',
        state: 'executing',
        objective: 'current step',
        agent_identifier: 'claude',
        assigned_agent: null
      },
      {
        ticket_id: 't2',
        state: 'executing',
        objective: 'no agent recorded',
        agent_identifier: null,
        assigned_agent: null
      }
    ]);

    const t1 = aggregates.get('t1');
    expect(t1?.hasExecutingObjective).toBe(true);
    expect(t1?.executingObjectiveAgent).toBe('claude');
    expect(t1?.hasDraftObjectiveWithText).toBe(true);

    // Executing without an agent identifier still flags the ticket as executing.
    const t2 = aggregates.get('t2');
    expect(t2?.hasExecutingObjective).toBe(true);
    expect(t2?.executingObjectiveAgent).toBeNull();
  });
});

describe('indexLatestSessionByTicket', () => {
  it('keeps only the newest session per ticket and unwraps relation arrays', () => {
    const byTicket = indexLatestSessionByTicket([
      { session_state: 'attached', agent_identifier: 'claude', objective: { ticket_id: 't1' } },
      { session_state: 'completed', agent_identifier: 'codex', objective: [{ ticket_id: 't1' }] },
      { session_state: 'idle', agent_identifier: 'cursor', objective: [{ ticket_id: 't2' }] },
      { session_state: 'attached', agent_identifier: 'pi', objective: null }
    ]);

    expect(byTicket.get('t1')?.session_state).toBe('attached');
    expect(byTicket.get('t2')?.agent_identifier).toBe('cursor');
    expect(byTicket.size).toBe(2);
  });
});

describe('indexLatestWaitingByTicket', () => {
  it('keeps the newest timestamp per ticket', () => {
    const byTicket = indexLatestWaitingByTicket([
      { ticket_id: 't1', created_at: '2026-06-09T10:00:00Z' },
      { ticket_id: 't1', created_at: '2026-06-08T10:00:00Z' },
      { ticket_id: 't2', created_at: '2026-06-07T10:00:00Z' }
    ]);

    expect(byTicket.get('t1')).toBe('2026-06-09T10:00:00Z');
    expect(byTicket.get('t2')).toBe('2026-06-07T10:00:00Z');
  });
});

describe('resolveRunningAgent', () => {
  it('prefers the executing objective agent', () => {
    expect(
      resolveRunningAgent(
        { executingObjectiveAgent: 'claude' },
        { session_state: 'attached', agent_identifier: 'codex' }
      )
    ).toBe('claude');
  });

  it('falls back to an attached session agent', () => {
    expect(
      resolveRunningAgent(
        { executingObjectiveAgent: null },
        { session_state: 'attached', agent_identifier: 'codex' }
      )
    ).toBe('codex');
  });

  it('returns null when the session is not attached', () => {
    expect(
      resolveRunningAgent(undefined, { session_state: 'idle', agent_identifier: 'codex' })
    ).toBeNull();
    expect(resolveRunningAgent(undefined, undefined)).toBeNull();
  });
});
