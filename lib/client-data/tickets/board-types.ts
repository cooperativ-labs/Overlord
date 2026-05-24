// Pure types for the shared client-side ticket board cache.
// Intentionally framework-free: no React, Supabase, Next.js, or TanStack Query
// imports. This module is consumed by reducers and selectors and may be reused
// by the desktop, web, or mobile shells.

export type BoardScope =
  | { kind: 'user'; organizationId?: number }
  | { kind: 'project'; projectId: string; organizationId?: number };

export type BoardDataset = 'board' | 'list' | 'calendar';

export type BoardTicket = {
  id: string;
  ticket_id?: string | null;
  ticket_sequence?: number | null;
  title: string | null;
  objective: string | null;
  organization_id: number;
  project_id: string | null;
  project_name?: string | null;
  project_color?: string | null;
  project_everhour_project_id?: string | null;
  everhour_task_id?: string | null;
  agent_session_state?: string | null;
  running_agent?: string | null;
  latest_objective_agent?: string | null;
  has_executing_objective?: boolean;
  status: string;
  priority: string;
  execution_target: string;
  assigned_agent: unknown | null;
  board_position: number;
  organization_name?: string | null;
  waiting_for_response_at?: string | null;
  has_unopened_waiting_response?: boolean;
  is_read?: boolean;
  objectives_executed_count?: number;
  has_draft_objective_with_text?: boolean;
  updated_at?: string;
  delegate?: string | null;
  schedule_id?: number | null;
  due_datetime?: string | null;
};

export type BoardStatus = {
  name: string;
  position: number;
  status_type?: string;
};

export type ColumnPageInfo = {
  cutoff: string | null;
  hasMore: boolean;
};

export type PendingMutation = {
  mutationId: string;
  kind: 'create' | 'delete' | 'update' | 'reorder' | 'status_change' | 'read_state';
  submittedAt: string;
  // Field-level snapshot of values overwritten by an optimistic mutation, used
  // for rollback. Stored as a partial of BoardTicket for type ergonomics, but
  // reducers treat it opaquely.
  rollback?: Partial<BoardTicket>;
};

export type WaitingMeta = {
  // ISO timestamp of the most recent blocking question event for this ticket.
  raisedAt: string;
};

export type TicketBoardState = {
  scope: BoardScope;
  ticketsById: Record<string, BoardTicket>;
  // Deliberately *not* maintaining ticketIdsByColumn here. The set of columns
  // is owned by ticket_statuses and visibility is a UI concern; column slices
  // are derived in selectors via groupTicketsByColumn(). Keeping a single
  // ticketsById map removes a class of consistency bugs around dual writes.
  columnPageInfoByStatus: Record<string, ColumnPageInfo>;
  ticketStatusesByName: Record<string, BoardStatus>;
  waitingByTicketId: Record<string, WaitingMeta>;
  pendingMutationsByEntityId: Record<string, PendingMutation[]>;
};

export type BoardBootstrap = {
  scope: BoardScope;
  tickets: BoardTicket[];
  statuses: BoardStatus[];
  columnPageInfo?: Record<string, ColumnPageInfo>;
};

export type TicketRowSource = 'bootstrap' | 'server-mutation' | 'server-poll' | 'realtime';
