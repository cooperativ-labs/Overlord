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

function normalizeTicketSearchQuery(value: string) {
  const rawTrimmed = value.trim().slice(0, 120);
  const sanitized = sanitizeQuery(value);
  return {
    sanitized,
    exactTicketId: /^[0-9]+:[0-9]+$/.test(rawTrimmed) ? rawTrimmed : null
  };
}

type RankedTicketSearchRow = {
  id: string;
  title: string | null;
  ticket_id: string | null;
  ticket_sequence: number | null;
  project_id: string | null;
  organization_id: number | null;
  status: string | null;
  project_name: string | null;
};

function mapRankedTicketRow(row: RankedTicketSearchRow) {
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

  const { sanitized, exactTicketId } = normalizeTicketSearchQuery(query);

  const { data, error } = await supabase.rpc('search_tickets', {
    p_query: sanitized,
    p_exact_ticket_id: exactTicketId,
    p_organization_id: ctx.organizationId,
    p_limit: normalizedLimit,
    p_include_completed: includeCompleted,
    p_statuses: statuses?.length ? statuses : undefined,
    p_project_id: projectId,
    p_created_by: createdBy,
    p_updated_after: updatedAfter,
    p_updated_before: updatedBefore
  });

  if (error) {
    return toolErr(error.message);
  }

  const tickets = ((data ?? []) as RankedTicketSearchRow[]).map(mapRankedTicketRow);
  return toolOk({
    tickets,
    count: tickets.length
  });
}
