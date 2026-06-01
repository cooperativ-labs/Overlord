import { ticketStatusTypeOptions } from '@/lib/options';
import type { Database } from '@/types/database.types';

export type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

export const statusTypeOptions = ticketStatusTypeOptions;
export const exclusiveStatusTypes: TicketStatusType[] = ['execute', 'review'];
export const preferredStatusTypeOrder: TicketStatusType[] = [
  'execute',
  'review',
  'draft',
  'complete'
];

export type StatusRow = {
  name: string;
  position: number;
  statusType: TicketStatusType;
  isDefault: boolean;
};

export function isExclusiveStatusType(statusType: TicketStatusType): boolean {
  return exclusiveStatusTypes.includes(statusType);
}

export function isLockedStatusType(
  statusType: TicketStatusType,
  statusTypeUsage: Partial<Record<TicketStatusType, string>>
): boolean {
  return isExclusiveStatusType(statusType) && Boolean(statusTypeUsage[statusType]);
}

export function getDefaultStatusType(statuses: StatusRow[]): TicketStatusType {
  const usedExclusiveTypes = new Set(
    statuses
      .filter(status => isExclusiveStatusType(status.statusType))
      .map(status => status.statusType)
  );

  for (const statusType of preferredStatusTypeOrder) {
    if (!isExclusiveStatusType(statusType) || !usedExclusiveTypes.has(statusType)) {
      return statusType;
    }
  }

  return 'draft';
}
