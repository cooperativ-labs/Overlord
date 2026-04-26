/**
 * Shared helpers used across Board, List, and Calendar views.
 * Centralised here to prevent drift between views.
 */

import type { SidebarProject } from '@/lib/actions/project-types';
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
    has_executing_objective: ticket.has_executing_objective,
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

export type OptimisticTicketProject = {
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  project_everhour_project_id: string | null;
  organization_id: number | null;
};

/**
 * Resolves the project metadata to display on an optimistic ticket created
 * inline (no project chooser). Prefers an explicit URL projectId, then the
 * user's default project, then a sibling ticket. Without this, optimistic
 * tickets on /u inherited the first sibling's project info while the server
 * actually saved them under the user's default project.
 */
export function resolveOptimisticTicketProject(input: {
  projectId?: string;
  defaultProject?: SidebarProject | null;
  referenceTicket?: Pick<
    BoardTicket,
    'project_id' | 'project_name' | 'project_color' | 'project_everhour_project_id' | 'organization_id'
  > | null;
}): OptimisticTicketProject {
  const { projectId, defaultProject, referenceTicket } = input;

  if (projectId) {
    const matchesReference = referenceTicket?.project_id === projectId;
    return {
      project_id: projectId,
      project_name: matchesReference ? (referenceTicket?.project_name ?? null) : null,
      project_color: matchesReference ? (referenceTicket?.project_color ?? null) : null,
      project_everhour_project_id: matchesReference
        ? (referenceTicket?.project_everhour_project_id ?? null)
        : null,
      organization_id: referenceTicket?.organization_id ?? null
    };
  }

  if (defaultProject) {
    return {
      project_id: defaultProject.id,
      project_name: defaultProject.name,
      project_color: defaultProject.color,
      project_everhour_project_id: defaultProject.everhourProjectId ?? null,
      organization_id: defaultProject.organizationId
    };
  }

  return {
    project_id: null,
    project_name: 'Personal',
    project_color: null,
    project_everhour_project_id: null,
    organization_id: referenceTicket?.organization_id ?? null
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
