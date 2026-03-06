import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];
type TicketPriority = Database['public']['Enums']['ticket_priority'];
type TicketExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

export type Option<T extends string = string> = {
  value: T;
  label: string;
};

export const ticketStatusTypeOptions: Option<TicketStatusType>[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'execute', label: 'Execute' },
  { value: 'review', label: 'Review' },
  { value: 'complete', label: 'Complete' }
];

export const ticketPriorityOptions: Option<TicketPriority>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
];

export const ticketExecutionTargetOptions: Option<TicketExecutionTarget>[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'human', label: 'Human' }
];

export function getOptionLabel<T extends string>(
  options: Option<T>[],
  value: T
): string {
  return options.find(o => o.value === value)?.label ?? value;
}

export function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
