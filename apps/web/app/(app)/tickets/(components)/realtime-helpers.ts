import type { Ticket } from './KanbanCard';

export type RealtimeBoardTicketRow = {
  id: string;
  ticket_id: string | null;
  ticket_sequence: number;
  title: string | null;
  due_datetime: string | null;
  for_human: boolean;
  status: string;
  priority: string;
  delegate: string | null;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string | null;
  everhour_task_id: string | null;
  schedule_id: number | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

const WAITING_SOUND_PATH = '/sounds/notification-question.mp3';
const REVIEW_SOUND_PATH = '/sounds/notification-complete.mp3';
const ALERT_SOUND_PATH = '/sounds/notification-complete.mp3';

export function initAudioRefs() {
  const waitingAudio = new Audio(WAITING_SOUND_PATH);
  waitingAudio.preload = 'auto';

  const reviewAudio = new Audio(REVIEW_SOUND_PATH);
  reviewAudio.preload = 'auto';

  const alertAudio = new Audio(ALERT_SOUND_PATH);
  alertAudio.preload = 'auto';

  return { waitingAudio, reviewAudio, alertAudio };
}

export function playSound(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

export function sendDesktopNotification(title: string, body: string): void {
  if (window.electronAPI?.app?.notify) {
    void window.electronAPI.app.notify(title, body);
    return;
  }
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/images/favicon.png' });
  } else if (Notification.permission === 'default') {
    void Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, { body, icon: '/images/favicon.png' });
      }
    });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getObjectivePayloadTicketId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.ticket_id === 'string' ? value.ticket_id : null;
}

export function getObjectivePayloadId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.id === 'string' ? value.id : null;
}

export function getSessionPayloadObjectiveId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.objective_id === 'string' ? value.objective_id : null;
}

export function getSingleRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

export function mapRealtimeBoardTicketRow(row: RealtimeBoardTicketRow): Ticket {
  const project = getSingleRelation(row.project);
  const organization = getSingleRelation(row.organization);

  return {
    id: row.id,
    ticket_id: row.ticket_id,
    ticket_sequence: row.ticket_sequence,
    title: row.title,
    objective: null,
    organization_id: row.organization_id,
    project_id: row.project_id,
    project_name: project?.name ?? null,
    project_color: project?.color ?? null,
    project_everhour_project_id: project?.everhour_project_id ?? null,
    everhour_task_id: row.everhour_task_id,
    agent_session_state: null,
    running_agent: null,
    latest_objective_agent: null,
    has_executing_objective: false,
    status: row.status,
    priority: row.priority,
    for_human: row.for_human,
    assigned_agent: null,
    board_position: row.board_position,
    organization_name: organization?.name ?? null,
    waiting_for_response_at: null,
    has_unopened_waiting_response: false,
    is_read: row.is_read,
    objectives_executed_count: 0,
    has_draft_objective_with_text: false,
    updated_at: row.updated_at,
    delegate: row.delegate,
    schedule_id: row.schedule_id,
    due_datetime: row.due_datetime
  };
}

export function toWaitingByTicket(tickets: Ticket[]): Record<string, string> {
  return tickets.reduce<Record<string, string>>((acc, ticket) => {
    if (ticket.waiting_for_response_at) {
      acc[ticket.id] = ticket.waiting_for_response_at;
    }
    return acc;
  }, {});
}

export function mergeWaitingByTicket(
  current: Record<string, string>,
  incoming: Ticket[]
): Record<string, string> {
  if (incoming.length === 0) return current;

  const next = { ...current };
  for (const ticket of incoming) {
    if (ticket.waiting_for_response_at) {
      next[ticket.id] = ticket.waiting_for_response_at;
    } else {
      delete next[ticket.id];
    }
  }

  return next;
}

export function getTopBoardPositionForStatus(
  tickets: Ticket[],
  status: string,
  excludeTicketId?: string
): number {
  let minBoardPosition = Number.POSITIVE_INFINITY;

  for (const ticket of tickets) {
    if (ticket.status !== status || ticket.id === excludeTicketId) continue;
    minBoardPosition = Math.min(minBoardPosition, ticket.board_position);
  }

  return Number.isFinite(minBoardPosition) ? minBoardPosition - 1 : 0;
}

export function isTicketCreatedDetail(
  value: unknown
): value is { ticketId: string; organizationId: number; projectId: string | null } {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as Record<string, unknown>;
  return (
    typeof detail.ticketId === 'string' &&
    typeof detail.organizationId === 'number' &&
    (typeof detail.projectId === 'string' || detail.projectId === null)
  );
}
