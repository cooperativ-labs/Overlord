import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

function sanitizeQuery(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildWebSearchQuery(value: string): string {
  const terms = value
    .split(/\s+/)
    .filter(Boolean)
    .map(term => (term.endsWith('*') ? term : `${term}*`));
  return terms.join(' ');
}

export function normalizeTicketSearchQuery(value: string) {
  const rawTrimmed = value.trim().slice(0, 120);
  const sanitized = sanitizeQuery(value);
  return {
    sanitized,
    rawTrimmed,
    exactTicketId: /^[0-9]+:[0-9]+$/.test(rawTrimmed) ? rawTrimmed : null,
    textSearchQuery: sanitized ? buildWebSearchQuery(sanitized) : ''
  };
}

type SearchTicketsOptions = {
  includeCompleted?: boolean;
  organizationId?: number;
  limit?: number;
  query?: string;
  statuses?: string[];
  projectId?: string;
  createdBy?: string;
  updatedAfter?: string;
  updatedBefore?: string;
};

type RankedTicketSearchRow = {
  id: string;
  title: string | null;
  ticket_id: string | null;
  ticket_sequence: number | null;
  project_id: string | null;
  organization_id: number | null;
  status: string | null;
  project_name: string | null;
  search_rank: number | null;
};

export type TicketSearchResult = {
  id: string;
  title: string | null;
  ticket_id: string | null;
  ticket_sequence: number | null;
  project_id: string | null;
  organization_id: number | null;
  status: string | null;
  project: {
    name: string | null;
  } | null;
};

function mapRankedTicketRow(row: RankedTicketSearchRow): TicketSearchResult {
  return {
    id: row.id,
    title: row.title,
    ticket_id: row.ticket_id,
    ticket_sequence: row.ticket_sequence,
    project_id: row.project_id,
    organization_id: row.organization_id,
    status: row.status,
    project: row.project_name !== null ? { name: row.project_name } : null
  };
}

export async function searchTickets(
  supabase: SupabaseClient<Database>,
  options: SearchTicketsOptions
) {
  const { limit = 8, query = '' } = options;
  const normalizedLimit = Math.min(Math.max(limit, 1), 50);
  const { sanitized, exactTicketId } = normalizeTicketSearchQuery(query);

  const { data, error } = await supabase.rpc('search_tickets', {
    p_query: sanitized,
    p_exact_ticket_id: exactTicketId,
    p_organization_id: options.organizationId ?? undefined,
    p_limit: normalizedLimit,
    p_include_completed: options.includeCompleted ?? false,
    p_statuses: options.statuses?.length ? options.statuses : undefined,
    p_project_id: options.projectId ?? undefined,
    p_created_by: options.createdBy ?? undefined,
    p_updated_after: options.updatedAfter ?? undefined,
    p_updated_before: options.updatedBefore ?? undefined
  });

  if (error) {
    return { data: null, error };
  }

  return {
    data: ((data ?? []) as RankedTicketSearchRow[]).map(mapRankedTicketRow),
    error: null
  };
}
