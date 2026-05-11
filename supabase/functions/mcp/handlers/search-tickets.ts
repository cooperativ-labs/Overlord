/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

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

function normalizeTicketSearchQuery(value: string) {
  const sanitized = sanitizeQuery(value);
  return {
    sanitized,
    textSearchQuery: sanitized ? buildWebSearchQuery(sanitized) : ''
  };
}

function applySharedFilters(q: any, opts: any) {
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

export async function handleSearchTickets(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const query = typeof args?.query === 'string' ? args.query : '';
  const includeCompleted = Boolean(args?.includeCompleted);
  const rawLimit = typeof args?.limit === 'number' ? args.limit : 8;
  const normalizedLimit = Math.min(Math.max(Math.floor(rawLimit), 1), 50);
  const statuses = Array.isArray(args?.statuses)
    ? args.statuses.filter((s: unknown) => typeof s === 'string')
    : undefined;
  const projectId = typeof args?.projectId === 'string' ? args.projectId : undefined;
  const createdBy = typeof args?.createdBy === 'string' ? args.createdBy : undefined;
  const updatedAfter = typeof args?.updatedAfter === 'string' ? args.updatedAfter : undefined;
  const updatedBefore = typeof args?.updatedBefore === 'string' ? args.updatedBefore : undefined;

  const select =
    'id,title,ticket_id,ticket_sequence,project_id,organization_id,status,project:projects(name)';
  const { sanitized, textSearchQuery } = normalizeTicketSearchQuery(query);

  let baseQuery = supabase
    .from('tickets')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  baseQuery = applySharedFilters(baseQuery, {
    organizationId: ctx.organizationId,
    includeCompleted,
    statuses,
    projectId,
    createdBy,
    updatedAfter,
    updatedBefore
  });

  if (!sanitized || !textSearchQuery) {
    const { data, error } = await baseQuery;
    if (error) return toolErr(error.message);
    return toolOk({ tickets: data ?? [], count: (data ?? []).length });
  }

  const { data, error } = await baseQuery.textSearch('search_vector', textSearchQuery, {
    config: 'english',
    type: 'websearch'
  });

  if (error) {
    return toolErr(error.message);
  }

  if ((data?.length ?? 0) > 0) {
    return toolOk({ tickets: data ?? [], count: data!.length });
  }

  const escapedPattern = escapeLikePattern(sanitized);
  let fallbackQuery = supabase
    .from('tickets')
    .select(select)
    .or(`title.ilike.%${escapedPattern}%,ticket_id.ilike.%${escapedPattern}%`)
    .order('updated_at', { ascending: false })
    .limit(normalizedLimit);

  fallbackQuery = applySharedFilters(fallbackQuery, {
    organizationId: ctx.organizationId,
    includeCompleted,
    statuses,
    projectId,
    createdBy,
    updatedAfter,
    updatedBefore
  });

  const fallbackResult = await fallbackQuery;
  if (fallbackResult.error) {
    return toolErr(fallbackResult.error.message);
  }

  return toolOk({
    tickets: fallbackResult.data ?? [],
    count: (fallbackResult.data ?? []).length
  });
}
