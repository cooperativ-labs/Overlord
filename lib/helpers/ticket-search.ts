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

export async function searchTicketsByTitle(
  supabase: SupabaseClient<Database>,
  {
    includeCompleted = true,
    organizationId,
    limit = 8,
    query,
    statuses,
    select = 'id,title,ticket_sequence,project_id,organization_id,status,project:projects(name)'
  }: {
    includeCompleted?: boolean;
    organizationId?: number;
    limit?: number;
    query: string;
    statuses?: string[];
    select?: string;
  }
) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 20);
  const { sanitized, textSearchQuery } = normalizeTicketSearchQuery(query);

  let baseQuery = supabase
    .from('tickets')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  if (organizationId) {
    baseQuery = baseQuery.eq('organization_id', organizationId);
  }
  if (statuses?.length) {
    baseQuery = baseQuery.in('status', statuses);
  } else if (!includeCompleted) {
    baseQuery = baseQuery.neq('status', 'complete');
  }

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
    .ilike('title', `%${escapedPattern}%`)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  if (organizationId) {
    fallbackQuery = fallbackQuery.eq('organization_id', organizationId);
  }
  if (statuses?.length) {
    fallbackQuery = fallbackQuery.in('status', statuses);
  } else if (!includeCompleted) {
    fallbackQuery = fallbackQuery.neq('status', 'complete');
  }

  const fallbackResult = await fallbackQuery;
  return {
    data: fallbackResult.data,
    error: fallbackResult.error
  };
}
