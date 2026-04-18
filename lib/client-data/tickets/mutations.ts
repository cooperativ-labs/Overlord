'use client';

// Phase 3 optimistic mutation hooks.
//
// Each hook wraps an existing server action in lib/actions/tickets.ts and,
// on invocation:
//   1. Snapshots every mounted board-scope cache.
//   2. Applies the matching Phase 1 reducer to every snapshot via
//      queryClient.setQueriesData so the visible cache updates in every view
//      (project board + user board + any other open scope) simultaneously.
//   3. Awaits the server action.
//   4. On failure, restores the snapshots and rethrows so callers can render
//      error state.
//   5. On success, merges any authoritative fields returned by the action.
//
// These hooks do not yet read `data` from any component — Phase 4 swaps the
// existing `useState`-backed KanbanBoard/TicketListView/CalendarView paths
// onto useTicketBoard selectors and wires these hooks into their handlers.
// Shipping them first keeps the migration small: a component-swap PR only
// has to change view code, not mutation wiring.

import {
  type QueryClient,
  useMutation,
  type UseMutationResult,
  useQueryClient
} from '@tanstack/react-query';

import {
  createBlankTicketAction,
  createTicketInColumnAction,
  deleteTicketAction,
  markTicketReadAction,
  markTicketUnreadAction,
  reorderTicketsAction,
  updateTicketAssignedAgentAction,
  updateTicketDueDateAction,
  updateTicketFieldAction,
  updateTicketStatusAction
} from '@/lib/actions/tickets';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { createTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';

import {
  clearPendingMutation,
  type ColumnPlacement,
  deleteTicket as deleteTicketReducer,
  insertOptimisticTicket,
  markTicketRead as markTicketReadReducer,
  moveTicketBetweenStatuses,
  reorderTicketsInColumn,
  updateTicketFields,
  withPendingMutation
} from './board-reducers';
import type { BoardTicket, TicketBoardState } from './board-types';
import {
  applyToAllBoards,
  applyToBoardsContainingTicket,
  restoreBoards,
  snapshotBoards
} from './cache';

export { reconcileServerTicketRow } from './cache';

// ---- shared cache helpers ------------------------------------------------

function newMutationId(): string {
  // Browsers that ship crypto.randomUUID are Chrome 92+ / Safari 15.4+ / FF 95+.
  // Electron targets a modern Chromium, so no polyfill needed here.
  return crypto.randomUUID();
}

// ---- create --------------------------------------------------------------

export type CreateTicketInput = {
  optimisticTicket: BoardTicket;
  status: string;
  objective: string;
  organizationId?: number;
  projectId?: string;
  placement?: ColumnPlacement;
  generateServerTitle?: boolean;
};

export type CreateTicketResult = {
  id: string;
  organizationId: number;
  projectId: string;
};

type CreateTicketContext = {
  mutationId: string;
  snapshot: [readonly unknown[], TicketBoardState][];
  temporaryTicketId: string;
};

export function useCreateTicketMutation(): UseMutationResult<
  CreateTicketResult,
  Error,
  CreateTicketInput,
  CreateTicketContext
> {
  const qc = useQueryClient();
  return useMutation<CreateTicketResult, Error, CreateTicketInput, CreateTicketContext>({
    mutationFn: async input => {
      const placement = input.placement ?? 'top';
      return createTicketInColumnAction(
        input.status,
        input.objective,
        input.optimisticTicket.id,
        input.organizationId,
        input.projectId,
        placement === 'top' ? 'top' : 'bottom',
        input.generateServerTitle ?? true
      );
    },
    onMutate: input => {
      const mutationId = newMutationId();
      const snapshot = snapshotBoards(qc);
      const submittedAt = new Date().toISOString();
      applyToBoardsContainingTicket(qc, input.optimisticTicket, state =>
        insertOptimisticTicket(state, input.optimisticTicket, {
          placement: input.placement ?? 'top',
          mutationId,
          submittedAt
        })
      );
      return { mutationId, snapshot, temporaryTicketId: input.optimisticTicket.id };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    },
    onSuccess: (_result, _input, ctx) => {
      if (!ctx) return;
      applyToAllBoards(qc, state =>
        clearPendingMutation(state, ctx.temporaryTicketId, ctx.mutationId)
      );
    }
  });
}

// ---- create blank --------------------------------------------------------

export function useCreateBlankTicketMutation(): UseMutationResult<
  Awaited<ReturnType<typeof createBlankTicketAction>>,
  Error,
  { organizationId?: number; projectId?: string }
> {
  return useMutation({
    mutationFn: input => createBlankTicketAction(input.organizationId, input.projectId)
  });
}

// ---- delete --------------------------------------------------------------

type DeleteTicketContext = {
  snapshot: [readonly unknown[], TicketBoardState][];
};

export function useDeleteTicketMutation(): UseMutationResult<
  { organizationId: number; projectId: string },
  Error,
  { ticketId: string },
  DeleteTicketContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input => deleteTicketAction(input.ticketId),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      applyToAllBoards(qc, state => deleteTicketReducer(state, input.ticketId));
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- field patch ---------------------------------------------------------

type UpdatableField = 'title' | 'objective' | 'available_tools' | 'acceptance_criteria';

export type UpdateTicketFieldsInput = {
  ticketId: string;
  patch: Partial<Record<UpdatableField, string>>;
};

type UpdateTicketFieldsContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useUpdateTicketFieldsMutation(): UseMutationResult<
  void,
  Error,
  UpdateTicketFieldsInput,
  UpdateTicketFieldsContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async input => {
      const entries = Object.entries(input.patch) as Array<[UpdatableField, string]>;
      for (const [field, value] of entries) {
        await updateTicketFieldAction(input.ticketId, field, value);
      }
    },
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      const patch: Partial<BoardTicket> = {};
      for (const [field, value] of Object.entries(input.patch) as Array<[UpdatableField, string]>) {
        if (field === 'title') patch.title = value;
        if (field === 'objective') patch.objective = value;
      }
      if (Object.keys(patch).length > 0) {
        applyToAllBoards(qc, state => updateTicketFields(state, input.ticketId, patch));
      }
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- status change -------------------------------------------------------

export type UpdateTicketStatusInput = {
  ticketId: string;
  status: string;
  placement?: ColumnPlacement;
};

type UpdateTicketStatusContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useUpdateTicketStatusMutation(): UseMutationResult<
  void,
  Error,
  UpdateTicketStatusInput,
  UpdateTicketStatusContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input => updateTicketStatusAction(input.ticketId, input.status),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      applyToAllBoards(qc, state =>
        moveTicketBetweenStatuses(state, input.ticketId, input.status, input.placement ?? 'top')
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- reorder -------------------------------------------------------------

export type ReorderTicketsInput = {
  status: string;
  orderedIds: string[];
  statusChange?: { ticketId: string; newStatus: string };
};

type ReorderTicketsContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useReorderTicketsMutation(): UseMutationResult<
  void,
  Error,
  ReorderTicketsInput,
  ReorderTicketsContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input => reorderTicketsAction(input.orderedIds, input.statusChange),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      applyToAllBoards(qc, state => {
        let next = state;
        if (input.statusChange) {
          next = moveTicketBetweenStatuses(
            next,
            input.statusChange.ticketId,
            input.statusChange.newStatus
          );
        }
        return reorderTicketsInColumn(next, input.status, input.orderedIds);
      });
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- read state ----------------------------------------------------------

export type MarkTicketReadInput = {
  ticketId: string;
  isRead: boolean;
};

type MarkTicketReadContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useMarkTicketReadMutation(): UseMutationResult<
  void,
  Error,
  MarkTicketReadInput,
  MarkTicketReadContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input =>
      input.isRead ? markTicketReadAction(input.ticketId) : markTicketUnreadAction(input.ticketId),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      applyToAllBoards(qc, state => markTicketReadReducer(state, input.ticketId, input.isRead));
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- assigned agent ------------------------------------------------------

export type UpdateTicketAssignmentInput = {
  ticketId: string;
  selection: AgentModelSelection;
};

type UpdateTicketAssignmentContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useUpdateTicketAssignmentMutation(): UseMutationResult<
  void,
  Error,
  UpdateTicketAssignmentInput,
  UpdateTicketAssignmentContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input => updateTicketAssignedAgentAction(input.ticketId, input.selection),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      const assigned = createTicketAssignedAgent(input.selection);
      applyToAllBoards(qc, state =>
        updateTicketFields(state, input.ticketId, { assigned_agent: assigned })
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- due date (schedule) -------------------------------------------------

export type UpdateTicketDueDateInput = {
  ticketId: string;
  dueDate: string | null;
};

type UpdateTicketDueDateContext = { snapshot: [readonly unknown[], TicketBoardState][] };

export function useUpdateTicketDueDateMutation(): UseMutationResult<
  void,
  Error,
  UpdateTicketDueDateInput,
  UpdateTicketDueDateContext
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: input => updateTicketDueDateAction(input.ticketId, input.dueDate),
    onMutate: input => {
      const snapshot = snapshotBoards(qc);
      applyToAllBoards(qc, state =>
        updateTicketFields(state, input.ticketId, { due_datetime: input.dueDate })
      );
      return { snapshot };
    },
    onError: (_err, _input, ctx) => {
      if (ctx) restoreBoards(qc, ctx.snapshot);
    }
  });
}

// ---- pending markers -----------------------------------------------------

export function markPendingMutation(
  qc: QueryClient,
  entityId: string,
  kind: 'create' | 'delete' | 'update' | 'reorder' | 'status_change' | 'read_state'
): string {
  const mutationId = newMutationId();
  applyToAllBoards(qc, state =>
    withPendingMutation(state, entityId, {
      mutationId,
      kind,
      submittedAt: new Date().toISOString()
    })
  );
  return mutationId;
}
