import { addDays, startOfDay, subDays } from 'date-fns';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';

import type { ThemeColors } from '@/lib/colors';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

export type SortMode = 'updated' | 'created' | 'priority';
export type StatusFilter = string[];
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

export type TicketWithProject = TicketListItem & {
  created_at: string;
  project_id: string | null;
  board_position: number;
  has_unread?: boolean;
};

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

function normalizeStatusName(status: string): string {
  return status.trim().toLowerCase();
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

function sortStatusDefinitions(
  statusDefinitions: TicketStatusDefinition[]
): TicketStatusDefinition[] {
  return [...statusDefinitions].sort((left, right) => {
    const orgDiff = left.organization_id - right.organization_id;
    if (orgDiff !== 0) return orgDiff;
    const positionDiff = left.position - right.position;
    if (positionDiff !== 0) return positionDiff;
    return left.name.localeCompare(right.name);
  });
}

export function matchesStatusFilter(
  ticket: Pick<TicketWithProject, 'organization_id' | 'status'>,
  filter: StatusFilter
): boolean {
  if (filter.length === 0) return true;
  return filter.includes(normalizeStatusName(ticket.status));
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

  const filterSet = new Set(statusFilter.map(normalizeStatusName));
  const sortedDefinitions = sortStatusDefinitions(statusDefinitions);

  if (filterSet.size === 0) {
    for (const status of sortedDefinitions) {
      if (!groups.has(status.name)) groups.set(status.name, []);
    }
  } else {
    const existingNormalizedStatuses = new Set(
      [...groups.keys()].map(statusName => normalizeStatusName(statusName))
    );

    for (const status of sortedDefinitions) {
      const normalizedStatus = normalizeStatusName(status.name);
      if (filterSet.has(normalizedStatus) && !existingNormalizedStatuses.has(normalizedStatus)) {
        groups.set(status.name, []);
        existingNormalizedStatuses.add(normalizedStatus);
      }
    }

    for (const statusName of statusFilter) {
      const normalizedStatus = normalizeStatusName(statusName);
      if (existingNormalizedStatuses.has(normalizedStatus)) continue;
      groups.set(statusName, []);
      existingNormalizedStatuses.add(normalizedStatus);
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

  const statusOrder = new Map<string, number>();
  sortedDefinitions.forEach((definition, index) => {
    if (!statusOrder.has(definition.name)) statusOrder.set(definition.name, index);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const orderDiff =
        (statusOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (statusOrder.get(b) ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return a.localeCompare(b);
    })
    .map(([status, list]) => ({ status, tickets: list }));
}

export function buildStatusFilterOptions(
  statusDefinitions: TicketStatusDefinition[],
  tickets: Pick<TicketWithProject, 'status'>[]
): string[] {
  const options: string[] = [];
  const seen = new Set<string>();

  for (const status of sortStatusDefinitions(statusDefinitions)) {
    const normalized = normalizeStatusName(status.name);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    options.push(normalized);
  }

  for (const ticket of tickets) {
    const normalized = normalizeStatusName(ticket.status);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    options.push(normalized);
  }

  return options;
}
