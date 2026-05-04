import { addDays, startOfDay, subDays } from 'date-fns';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';

import type { ThemeColors } from '@/lib/colors';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

export type SortMode = 'updated' | 'created' | 'priority';
export type StatusFilter = 'all' | 'open' | 'draft' | 'next-up' | 'execute' | 'review' | 'complete';
export type ViewMode = 'list' | 'calendar';
export type TicketStatusType =
  | 'draft'
  | 'next-up'
  | 'execute'
  | 'review'
  | 'complete'
  | 'blocked'
  | 'cancelled'
  | 'icebox';
export type TicketStatusDefinition = {
  organization_id: number;
  name: string;
  position: number;
  status_type: TicketStatusType;
};

export function getStatusColors(colors: ThemeColors): Record<TicketStatusType, string> {
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
] as const satisfies readonly TicketStatusType[];

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

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const normalized = value.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    if (!r || !g || !b) return null;
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16)
    };
  }

  if (hex.length === 6) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }

  return null;
}

export function getTicketCheckboxColors(projectColor: string | null | undefined) {
  if (!projectColor) {
    return {
      borderColor: undefined,
      backgroundColor: undefined,
      completedBackgroundColor: undefined,
      checkColor: undefined
    };
  }

  const rgb = parseHexColor(projectColor);
  if (!rgb) {
    return {
      borderColor: projectColor,
      backgroundColor: `${projectColor}22`,
      completedBackgroundColor: projectColor,
      checkColor: '#ffffff'
    };
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  const foreground = luminance > 0.6 ? '#111827' : '#ffffff';
  const tintedBackground = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`;

  return {
    borderColor: projectColor,
    backgroundColor: tintedBackground,
    completedBackgroundColor: projectColor,
    checkColor: foreground
  };
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

export function formatStatusName(status: string): string {
  return status
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getStatusDefinition(
  statusDefinitions: TicketStatusDefinition[],
  organizationId: number,
  statusName: string
): TicketStatusDefinition | null {
  return (
    statusDefinitions.find(
      status =>
        status.organization_id === organizationId && status.name.trim().toLowerCase() === statusName
    ) ?? null
  );
}

function getStatusNamesForFilter(
  statusDefinitions: TicketStatusDefinition[],
  filter: Exclude<StatusFilter, 'all' | 'open'>
): Set<string> {
  return new Set(
    statusDefinitions
      .filter(status => status.status_type === filter)
      .map(status => status.name.trim().toLowerCase())
  );
}

export function matchesStatusFilter(
  ticket: Pick<TicketWithProject, 'organization_id' | 'status'>,
  statusDefinitions: TicketStatusDefinition[],
  filter: StatusFilter
): boolean {
  if (filter === 'all') return true;

  const definition = getStatusDefinition(
    statusDefinitions,
    ticket.organization_id,
    ticket.status.trim().toLowerCase()
  );

  if (filter === 'open') {
    return !definition || !['complete', 'cancelled', 'icebox'].includes(definition.status_type);
  }

  if (definition) {
    return definition.status_type === filter;
  }

  return getStatusNamesForFilter(statusDefinitions, filter).has(ticket.status.trim().toLowerCase());
}

export function resolvePreferredStatusNameByType(
  statusDefinitions: TicketStatusDefinition[],
  organizationId: number,
  statusType: TicketStatusType
): string | null {
  const matches = statusDefinitions
    .filter(
      status => status.organization_id === organizationId && status.status_type === statusType
    )
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));

  if (matches.length === 0) return null;

  if (statusType === 'draft') {
    return (
      matches.find(status => status.name === 'draft')?.name ??
      matches.find(status => status.name !== 'icebox' && status.name !== 'blocked')?.name ??
      matches[0]?.name ??
      null
    );
  }

  if (statusType === 'complete') {
    return (
      matches.find(status => status.name === 'complete')?.name ??
      matches.find(status => status.name !== 'cancelled')?.name ??
      matches[0]?.name ??
      null
    );
  }

  return matches[0]?.name ?? null;
}

export function buildOrderedSections(
  tickets: TicketWithProject[],
  statusFilter: StatusFilter,
  statusDefinitions: TicketStatusDefinition[]
): Array<{ status: string; tickets: TicketWithProject[] }> {
  const groups = new Map<string, TicketWithProject[]>();
  for (const ticket of tickets) {
    const list = groups.get(ticket.status) ?? [];
    list.push(ticket);
    groups.set(ticket.status, list);
  }

  if (statusFilter === 'all' || statusFilter === 'open') {
    for (const statusType of STATUS_DISPLAY_ORDER) {
      if (statusFilter === 'open' && ['complete', 'cancelled', 'icebox'].includes(statusType)) {
        continue;
      }
      const matchingDefinitions = statusDefinitions.filter(
        status => status.status_type === statusType
      );
      for (const status of matchingDefinitions) {
        if (!groups.has(status.name)) groups.set(status.name, []);
      }
    }
  } else if (!groups.has(statusFilter)) {
    for (const status of statusDefinitions.filter(
      definition => definition.status_type === statusFilter
    )) {
      if (!groups.has(status.name)) groups.set(status.name, []);
    }
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
    const firstTicketOrgId = listFirstOrganizationId(groups.get(status));
    if (firstTicketOrgId !== null) {
      const definition = getStatusDefinition(statusDefinitions, firstTicketOrgId, status);
      if (definition) {
        const idx = STATUS_DISPLAY_ORDER.indexOf(definition.status_type);
        return idx === -1 ? STATUS_DISPLAY_ORDER.length + 1 : idx;
      }
    }

    const matchingDefinitions = statusDefinitions
      .filter(definition => definition.name === status)
      .sort((left, right) => left.position - right.position);
    const fallbackType = matchingDefinitions[0]?.status_type;
    const idx = fallbackType ? STATUS_DISPLAY_ORDER.indexOf(fallbackType) : -1;
    return idx === -1 ? STATUS_DISPLAY_ORDER.length + 1 : idx;
  };

  const positionForStatus = (status: string): number => {
    const definition = statusDefinitions
      .filter(definition => definition.name === status)
      .sort((left, right) => left.position - right.position)[0];
    return definition?.position ?? Number.MAX_SAFE_INTEGER;
  };

  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        orderIndex(a) - orderIndex(b) ||
        positionForStatus(a) - positionForStatus(b) ||
        a.localeCompare(b)
    )
    .map(([status, list]) => ({ status, tickets: list }));
}

function listFirstOrganizationId(tickets: TicketWithProject[] | undefined): number | null {
  return tickets?.[0]?.organization_id ?? null;
}
