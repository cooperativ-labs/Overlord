import type { ComponentType } from 'react';

export type SortKey = 'updated_at' | 'status' | 'priority';

export const SORT_LABELS: Record<SortKey, string> = {
  updated_at: 'Last updated',
  status: 'Status',
  priority: 'Priority'
};

export type TicketListStatus = {
  name: string;
  position: number;
  status_type?: string;
};

export type TicketListStatusStyle = {
  text: string;
  bg: string;
  rule: string;
  /** Left border color for the ticket list rail (Tailwind border-* color). */
  rail: string;
  icon: ComponentType<{ className?: string }>;
};

export type TicketListProjectOption = {
  id: string;
  name: string;
  color: string | null;
};
