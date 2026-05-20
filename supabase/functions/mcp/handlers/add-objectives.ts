// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import {
  insertOrderedObjectives,
  normalizeObjectivesInput,
  resolveTicketId
} from './_objectives.ts';
import { resolveTicketCreatorUserId } from './_ticket-creator.ts';

export async function handleAddObjectives(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const rawTicketId = typeof args.ticketId === 'string' ? args.ticketId.trim() : '';
  if (!rawTicketId) return toolErr('ticketId is required.');

  let objectives;
  try {
    objectives = normalizeObjectivesInput({ objectives: args.objectives });
  } catch (error) {
    return toolErr(error instanceof Error ? error.message : String(error));
  }

  const ticketId = await resolveTicketId(supabase, rawTicketId, ctx.organizationId);
  if (!ticketId) return toolErr('Ticket not found or access denied.');

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,ticket_id,organization_id,project_id')
    .eq('id', ticketId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (ticketError || !ticket) return toolErr('Ticket not found or access denied.');

  const createdBy = await resolveTicketCreatorUserId(supabase, ctx);
  const insertedObjectives = await insertOrderedObjectives(supabase, ticket.id, objectives, {
    createdBy,
    firstStateWhenNoActive: 'draft',
    firstStateWhenActive: 'future',
    followingState: 'future'
  });
  const reference = ticket.ticket_id ?? ticket.id.slice(-8);

  const { error: eventError } = await supabase.from('ticket_events').insert({
    created_by: createdBy,
    event_type: 'update',
    payload: {
      appended_objective_count: insertedObjectives.length,
      created_via: 'mcp.add_objectives',
      objective_ids: insertedObjectives.map((objective: any) => objective.id)
    },
    summary: `Added ${insertedObjectives.length} objective${insertedObjectives.length === 1 ? '' : 's'} to ${reference}.`,
    ticket_id: ticket.id
  });
  if (eventError) return toolErr(eventError.message);

  return toolOk({
    ok: true,
    objectives: insertedObjectives,
    ticket: {
      id: ticket.id,
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      reference
    }
  });
}
