import { addDays, startOfDay, subDays } from 'date-fns';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';

import type { ThemeColors } from '@/lib/colors';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

export type SortMode = 'updated' | 'created' | 'priority';
export type StatusFilter = 'all' | 'open' | 'draft' | 'next-up' | 'execute' | 'review' | 'complete';
export type ViewMode = 'list' | 'calendar';

export function getStatusColors(colors: ThemeColors): Record<string, string> {
  return {
    draft: colors.mutedForeground,
    'next-up': colors.primary,
    execute: colors.success,
    review: '#f59e0b',
    complete: colors.success,
    blocked: colors.destructive,
    cancelled: colors.mutedForeground,
    icebox: colors.mutedForeground
  };
}

export const statusLabel: Record<string, string> = {
  draft: 'Draft',
  'next-up': 'Next up',
  execute: 'Execute',
  review: 'Review',
  complete: 'Complete',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  icebox: 'Icebox'
};

export const sortLabels: Record<SortMode, string> = {
  updated: 'Last updated',
  created: 'Recently created',
  priority: 'Priority'
};

export const statusFilterLabels: Record<StatusFilter, string> = {
  all: 'All statuses',
  open: 'Open',
  draft: 'Draft',
  'next-up': 'Next up',
  execute: 'Executing',
  review: 'In review',
  complete: 'Complete'
};

export type TicketWithProject = TicketListItem & {
  created_at: string;
  project_id: string | null;
  board_position: number;
  has_unread?: boolean;
};

export const STATUS_DISPLAY_ORDER = [
  'draft',
  'next-up',
  'execute',
  'review',
  'complete',
  'blocked',
  'cancelled',
  'icebox'
];

export type SectionItem =
  | { kind: 'header'; status: string; count: number; collapsed: boolean }
  | { kind: 'ticket'; ticket: TicketWithProject };

export const ALL_PROJECTS_LABEL = 'My Tickets';
export const CALENDAR_PAST_DAYS = 5;
export const CALENDAR_FUTURE_DAYS = 24;
export const CALENDAR_PAGE_SIZE = 21;

export const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

export function buildCalendarDays(from: Date, pastDays: number, futureDays: number): Date[] {
  const start = subDays(startOfDay(from), pastDays);
  return Array.from({ length: pastDays + futureDays + 1 }, (_, index) => addDays(start, index));
}

export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
}

export function formatAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;
  return agent.agent;
}

/** Same semantics as web `getDisplayTitle` — mobile list does not load objective text. */
export function getTicketDisplayTitle(ticket: { title?: string | null }): string {
  if (ticket.title?.trim()) return ticket.title.trim();
  return 'Untitled';
}

export function buildOrderedSections(
  tickets: TicketWithProject[],
  statusFilter: StatusFilter
): Array<{ status: string; tickets: TicketWithProject[] }> {
  const groups = new Map<string, TicketWithProject[]>();
  for (const ticket of tickets) {
    const list = groups.get(ticket.status) ?? [];
    list.push(ticket);
    groups.set(ticket.status, list);
  }

  if (statusFilter === 'all' || statusFilter === 'open') {
    const allowed =
      statusFilter === 'open'
        ? STATUS_DISPLAY_ORDER.filter(s => !['complete', 'cancelled', 'icebox'].includes(s))
        : STATUS_DISPLAY_ORDER;
    for (const status of allowed) {
      if (!groups.has(status)) groups.set(status, []);
    }
  } else if (!groups.has(statusFilter)) {
    groups.set(statusFilter, []);
  }

  for (const [statusName, list] of groups) {
    list.sort((a, b) => {
      const diff = a.board_position - b.board_position;
      if (diff !== 0) return diff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    groups.set(statusName, list);
  }

  const orderIndex = (status: string): number => {
    const idx = STATUS_DISPLAY_ORDER.indexOf(status);
    return idx === -1 ? STATUS_DISPLAY_ORDER.length + 1 : idx;
  };

  return [...groups.entries()]
    .sort(([a], [b]) => orderIndex(a) - orderIndex(b) || a.localeCompare(b))
    .map(([status, list]) => ({ status, tickets: list }));
}
