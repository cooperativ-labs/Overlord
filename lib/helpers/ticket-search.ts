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

function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, match => `\\${match}`);
}

export function normalizeTicketSearchQuery(value: string) {
  const sanitized = sanitizeQuery(value);
  return {
    sanitized,
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
  select?: string;
};

function applySharedFilters<T extends { eq: any; in: any; neq: any; gte: any; lte: any }>(
  q: T,
  opts: SearchTicketsOptions
): T {
  let next = q;
  if (opts.organizationId) next = next.eq('organization_id', opts.organizationId);
  if (opts.statuses?.length) {
    next = next.in('status', opts.statuses);
  } else if (!opts.includeCompleted) {
    next = next.neq('status', 'complete');
  }
  if (opts.projectId) next = next.eq('project_id', opts.projectId);
  if (opts.createdBy) next = next.eq('created_by', opts.createdBy);
  if (opts.updatedAfter) next = next.gte('updated_at', opts.updatedAfter);
  if (opts.updatedBefore) next = next.lte('updated_at', opts.updatedBefore);
  return next;
}

export async function searchTickets(
  supabase: SupabaseClient<Database>,
  options: SearchTicketsOptions
) {
  const {
    limit = 8,
    query = '',
    select = 'id,title,ticket_id,ticket_sequence,project_id,organization_id,status,project:projects(name)'
  } = options;

  const normalizedLimit = Math.min(Math.max(limit, 1), 50);
  const { sanitized, textSearchQuery } = normalizeTicketSearchQuery(query);

  let baseQuery = supabase
    .from('tickets')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  baseQuery = applySharedFilters(baseQuery, options);

  if (!sanitized || !textSearchQuery) {
    const { data, error } = await baseQuery;
    return { data, error };
  }

  const { data, error } = await baseQuery.textSearch('search_vector', textSearchQuery, {
    config: 'english',
    type: 'websearch'
  });

  if (error) {
    return { data: null, error };
  }

  if ((data?.length ?? 0) > 0) {
    return { data, error: null };
  }

  const escapedPattern = escapeLikePattern(sanitized);
  let fallbackQuery = supabase
    .from('tickets')
    .select(select)
    .or(`title.ilike.%${escapedPattern}%,ticket_id.ilike.%${escapedPattern}%`)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  fallbackQuery = applySharedFilters(fallbackQuery, options);

  const fallbackResult = await fallbackQuery;
  return {
    data: fallbackResult.data,
    error: fallbackResult.error
  };
}
