/**
 * Shared helpers used across Board, List, and Calendar views.
 * Centralised here to prevent drift between views.
 */

import type {
  BoardBootstrap,
  BoardScope,
  BoardStatus,
  BoardTicket
} from '@/lib/client-data/tickets/board-types';

import type { Ticket } from './KanbanCard';

/**
 * Capitalises and joins a hyphenated status slug.
 * e.g. "in-progress" -> "In Progress"
 */
export function formatStatusLabel(status: string): string {
  return status
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Extracts the last path segment from the current pathname,
 * which by convention is the ticket ID when a ticket panel is open.
 */
export function getPathTicketId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

export function buildBoardScope(input: {
  organizationId?: number;
  projectId?: string;
}): BoardScope {
  return input.projectId
    ? { kind: 'project', projectId: input.projectId, organizationId: input.organizationId }
    : { kind: 'user', organizationId: input.organizationId };
}

export function toBoardTicket(ticket: Ticket): BoardTicket {
  return {
    id: ticket.id,
    title: ticket.title,
    objective: ticket.objective,
    organization_id: ticket.organization_id,
    project_id: ticket.project_id,
    project_name: ticket.project_name,
    project_color: ticket.project_color,
    project_everhour_project_id: ticket.project_everhour_project_id,
    everhour_task_id: ticket.everhour_task_id,
    agent_session_state: ticket.agent_session_state,
    running_agent: ticket.running_agent,
    latest_objective_agent: ticket.latest_objective_agent,
    status: ticket.status,
    priority: ticket.priority,
    execution_target: ticket.execution_target,
    assigned_agent: ticket.assigned_agent,
    board_position: ticket.board_position,
    organization_name: ticket.organization_name,
    waiting_for_response_at: ticket.waiting_for_response_at,
    has_unopened_waiting_response: ticket.has_unopened_waiting_response,
    is_read: ticket.is_read,
    objectives_executed_count: ticket.objectives_executed_count,
    updated_at: ticket.updated_at,
    delegate: ticket.delegate,
    schedule_id: ticket.schedule_id,
    due_datetime: ticket.due_datetime
  };
}

export function toViewTicket(ticket: BoardTicket): Ticket {
  return ticket as Ticket;
}

export function buildBoardBootstrap(input: {
  scope: BoardScope;
  tickets: Ticket[];
  statuses: Array<{ name: string; position: number; status_type?: string }>;
}): BoardBootstrap {
  return {
    scope: input.scope,
    tickets: input.tickets.map(toBoardTicket),
    statuses: input.statuses.map(toBoardStatus)
  };
}

export function toBoardStatus(status: {
  name: string;
  position: number;
  status_type?: string;
}): BoardStatus {
  return {
    name: status.name,
    position: status.position,
    status_type: status.status_type
  };
}
