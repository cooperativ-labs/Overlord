import { normalizeBoardBootstrap } from '@/lib/client-data/tickets/board-normalize';
import {
  applyStatusListChange,
  clearPendingMutation,
  clearWaitingQuestion,
  deleteTicket,
  insertOptimisticTicket,
  markTicketRead,
  mergeRealtimeTicketRow,
  mergeServerTicketRow,
  mergeWaitingQuestion,
  moveTicketBetweenStatuses,
  reconcileRemovedTicket,
  reorderTicketsInColumn,
  updateTicketFields,
  withPendingMutation
} from '@/lib/client-data/tickets/board-reducers';
import {
  selectColumnGroups,
  selectColumnTickets,
  selectIsWaiting,
  selectPendingMutations,
  selectStatusesSorted
} from '@/lib/client-data/tickets/board-selectors';
import type { BoardScope, BoardTicket } from '@/lib/client-data/tickets/board-types';

const scope: BoardScope = { kind: 'user', organizationId: 1 };

function makeTicket(overrides: Partial<BoardTicket> = {}): BoardTicket {
  return {
    id: overrides.id ?? 'ticket-' + Math.random().toString(36).slice(2, 8),
    title: 'A ticket',
    objective: null,
    organization_id: 1,
    project_id: 'project-1',
    status: 'next-up',
    priority: 'medium',
    execution_target: 'agent',
    assigned_agent: null,
    board_position: 0,
    is_read: true,
    waiting_for_response_at: null,
    updated_at: '2026-04-17T00:00:00.000Z',
    ...overrides
  };
}

const statuses = [
  { name: 'next-up', position: 0 },
  { name: 'execute', position: 1 },
  { name: 'review', position: 2, status_type: 'review' },
  { name: 'complete', position: 3, status_type: 'complete' }
];

function freshState(tickets: BoardTicket[] = []) {
  return normalizeBoardBootstrap({ scope, tickets, statuses });
}

describe('normalizeBoardBootstrap', () => {
  it('indexes tickets by id and seeds waiting metadata', () => {
    const state = freshState([
      makeTicket({ id: 't1' }),
      makeTicket({ id: 't2', waiting_for_response_at: '2026-04-17T01:00:00.000Z' })
    ]);

    expect(Object.keys(state.ticketsById)).toEqual(['t1', 't2']);
    expect(state.waitingByTicketId).toEqual({
      t2: { raisedAt: '2026-04-17T01:00:00.000Z' }
    });
    expect(selectStatusesSorted(state).map(s => s.name)).toEqual([
      'next-up',
      'execute',
      'review',
      'complete'
    ]);
  });
});

describe('insertOptimisticTicket', () => {
  it('places the new ticket above the highest-positioned ticket when placement is top', () => {
    const state = freshState([
      makeTicket({ id: 'a', status: 'next-up', board_position: 5 }),
      makeTicket({ id: 'b', status: 'next-up', board_position: 7 })
    ]);

    const next = insertOptimisticTicket(state, makeTicket({ id: 'c', status: 'next-up' }), {
      placement: 'top'
    });

    expect(next.ticketsById.c.board_position).toBe(4);
    expect(selectColumnTickets(next, 'next-up').map(t => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('places the new ticket below the lowest-positioned ticket when placement is bottom', () => {
    const state = freshState([
      makeTicket({ id: 'a', status: 'execute', board_position: 5 }),
      makeTicket({ id: 'b', status: 'execute', board_position: 7 })
    ]);

    const next = insertOptimisticTicket(state, makeTicket({ id: 'c', status: 'execute' }), {
      placement: 'bottom'
    });

    expect(next.ticketsById.c.board_position).toBe(8);
    expect(selectColumnTickets(next, 'execute').map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('records a pending create mutation when a mutationId is supplied', () => {
    const state = freshState();
    const next = insertOptimisticTicket(state, makeTicket({ id: 'c' }), {
      mutationId: 'm1',
      submittedAt: '2026-04-17T02:00:00.000Z'
    });

    expect(selectPendingMutations(next, 'c')).toEqual([
      { mutationId: 'm1', kind: 'create', submittedAt: '2026-04-17T02:00:00.000Z' }
    ]);
  });
});

describe('moveTicketBetweenStatuses', () => {
  it('moves the ticket to the target column with placement-aware position', () => {
    const state = freshState([
      makeTicket({ id: 'a', status: 'next-up', board_position: 0 }),
      makeTicket({ id: 'b', status: 'execute', board_position: 0 }),
      makeTicket({ id: 'c', status: 'execute', board_position: 1 })
    ]);

    const next = moveTicketBetweenStatuses(state, 'a', 'execute', 'top');

    expect(next.ticketsById.a.status).toBe('execute');
    expect(next.ticketsById.a.board_position).toBe(-1);
    expect(selectColumnTickets(next, 'execute').map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(selectColumnTickets(next, 'next-up')).toEqual([]);
  });

  it('is a no-op when the ticket is already in the target status', () => {
    const state = freshState([makeTicket({ id: 'a', status: 'review' })]);
    const next = moveTicketBetweenStatuses(state, 'a', 'review');
    expect(next).toBe(state);
  });
});

describe('reorderTicketsInColumn', () => {
  it('rewrites board_position to match the supplied order', () => {
    const state = freshState([
      makeTicket({ id: 'a', status: 'execute', board_position: 0 }),
      makeTicket({ id: 'b', status: 'execute', board_position: 1 }),
      makeTicket({ id: 'c', status: 'execute', board_position: 2 })
    ]);

    const next = reorderTicketsInColumn(state, 'execute', ['c', 'a', 'b']);

    expect(selectColumnTickets(next, 'execute').map(t => t.id)).toEqual(['c', 'a', 'b']);
    expect(next.ticketsById.c.board_position).toBe(0);
    expect(next.ticketsById.a.board_position).toBe(1);
    expect(next.ticketsById.b.board_position).toBe(2);
  });
});

describe('deleteTicket', () => {
  it('removes the ticket and all per-ticket secondary maps', () => {
    let state = freshState([
      makeTicket({ id: 'a', waiting_for_response_at: '2026-04-17T01:00:00.000Z' })
    ]);
    state = withPendingMutation(state, 'a', {
      mutationId: 'm1',
      kind: 'update',
      submittedAt: '2026-04-17T01:00:00.000Z'
    });

    const next = deleteTicket(state, 'a');

    expect(next.ticketsById).toEqual({});
    expect(next.waitingByTicketId).toEqual({});
    expect(next.pendingMutationsByEntityId).toEqual({});
  });
});

describe('mergeServerTicketRow', () => {
  it('inserts an unknown ticket', () => {
    const state = freshState();
    const next = mergeServerTicketRow(state, makeTicket({ id: 'new' }), 'server-mutation');
    expect(next.ticketsById.new).toBeDefined();
  });

  it('ignores stale realtime rows when the existing row is newer', () => {
    const state = freshState([
      makeTicket({ id: 'a', updated_at: '2026-04-17T05:00:00.000Z', title: 'newer' })
    ]);
    const next = mergeRealtimeTicketRow(state, {
      id: 'a',
      updated_at: '2026-04-17T03:00:00.000Z',
      title: 'older'
    });
    expect(next.ticketsById.a.title).toBe('newer');
  });

  it('applies a server mutation row even if updated_at is older (authoritative)', () => {
    const state = freshState([
      makeTicket({ id: 'a', updated_at: '2026-04-17T05:00:00.000Z', title: 'newer' })
    ]);
    const next = mergeServerTicketRow(
      state,
      makeTicket({ id: 'a', updated_at: '2026-04-17T03:00:00.000Z', title: 'authoritative' }),
      'server-mutation'
    );
    expect(next.ticketsById.a.title).toBe('authoritative');
  });
});

describe('reconcileRemovedTicket', () => {
  it('removes an optimistic ticket when the server reports it deleted', () => {
    const state = insertOptimisticTicket(freshState(), makeTicket({ id: 'opt' }), {
      mutationId: 'm1'
    });
    const next = reconcileRemovedTicket(state, 'opt');
    expect(next.ticketsById.opt).toBeUndefined();
    expect(next.pendingMutationsByEntityId.opt).toBeUndefined();
  });
});

describe('waiting questions', () => {
  it('records a new blocking question and ignores older ones', () => {
    const state = freshState([makeTicket({ id: 'a' })]);
    let next = mergeWaitingQuestion(state, {
      ticket_id: 'a',
      created_at: '2026-04-17T05:00:00.000Z'
    });
    expect(selectIsWaiting(next, 'a')).toBe(true);

    const stale = mergeWaitingQuestion(next, {
      ticket_id: 'a',
      created_at: '2026-04-17T01:00:00.000Z'
    });
    expect(stale).toBe(next);

    next = clearWaitingQuestion(next, 'a');
    expect(selectIsWaiting(next, 'a')).toBe(false);
  });

  it('skips non-blocking question events', () => {
    const state = freshState([makeTicket({ id: 'a' })]);
    const next = mergeWaitingQuestion(state, {
      ticket_id: 'a',
      created_at: '2026-04-17T05:00:00.000Z',
      is_blocking: false
    });
    expect(selectIsWaiting(next, 'a')).toBe(false);
  });
});


describe('updateTicketFields and markTicketRead', () => {
  it('field updates are no-ops for unknown tickets', () => {
    const state = freshState();
    const next = updateTicketFields(state, 'missing', { title: 'x' });
    expect(next).toBe(state);
  });

  it('markTicketRead toggles is_read and is a no-op when unchanged', () => {
    const state = freshState([makeTicket({ id: 'a', is_read: false })]);
    const next = markTicketRead(state, 'a', true);
    expect(next.ticketsById.a.is_read).toBe(true);
    expect(markTicketRead(next, 'a', true)).toBe(next);
  });
});

describe('pending mutations', () => {
  it('appends and clears mutations by id', () => {
    let state = freshState([makeTicket({ id: 'a' })]);
    state = withPendingMutation(state, 'a', {
      mutationId: 'm1',
      kind: 'update',
      submittedAt: '2026-04-17T01:00:00.000Z'
    });
    state = withPendingMutation(state, 'a', {
      mutationId: 'm2',
      kind: 'reorder',
      submittedAt: '2026-04-17T01:00:01.000Z'
    });
    expect(selectPendingMutations(state, 'a')).toHaveLength(2);

    state = clearPendingMutation(state, 'a', 'm1');
    expect(selectPendingMutations(state, 'a').map(m => m.mutationId)).toEqual(['m2']);

    state = clearPendingMutation(state, 'a', 'm2');
    expect(state.pendingMutationsByEntityId.a).toBeUndefined();
  });
});

describe('selectColumnGroups', () => {
  it('sorts complete columns by updated_at desc and other columns by board_position', () => {
    const state = freshState([
      makeTicket({ id: 'a', status: 'next-up', board_position: 2 }),
      makeTicket({ id: 'b', status: 'next-up', board_position: 0 }),
      makeTicket({
        id: 'c',
        status: 'complete',
        board_position: 0,
        updated_at: '2026-04-17T01:00:00.000Z'
      }),
      makeTicket({
        id: 'd',
        status: 'complete',
        board_position: 1,
        updated_at: '2026-04-17T05:00:00.000Z'
      })
    ]);

    const { groups } = selectColumnGroups(state);
    expect(groups.get('next-up')!.map(t => t.id)).toEqual(['b', 'a']);
    expect(groups.get('complete')!.map(t => t.id)).toEqual(['d', 'c']);
  });

  it('places tickets whose status is unknown into uncategorized', () => {
    const state = freshState([makeTicket({ id: 'a', status: 'mystery', board_position: 0 })]);
    const { uncategorized, groups } = selectColumnGroups(state);
    expect(uncategorized.map(t => t.id)).toEqual(['a']);
    expect(groups.has('next-up')).toBe(true);
  });
});

describe('applyStatusListChange', () => {
  it('replaces the status definitions used by selectors', () => {
    let state = freshState([makeTicket({ id: 'a', status: 'next-up' })]);
    state = applyStatusListChange(state, [
      { name: 'todo', position: 0 },
      { name: 'doing', position: 1 }
    ]);
    expect(selectStatusesSorted(state).map(s => s.name)).toEqual(['todo', 'doing']);
  });
});
