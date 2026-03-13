// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

/**
 * Explicit ticket columns returned to agents — excludes internal fields like search_vector.
 * IMPORTANT: Keep this in sync with lib/overlord/protocol-attach.ts (TICKET_AGENT_FIELDS).
 */
const TICKET_AGENT_FIELDS =
  'id,title,objective,status,priority,assigned_agent,recent_agent,board_position,organization_id,project_id,execution_target,context,constraints,available_tools,acceptance_criteria,output_format,created_at,updated_at,ticket_sequence,everhour_task_id,created_by';

export async function handleAttach(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { ticketId: rawTicketId, agentIdentifier, connectionMethod = 'mcp', metadata = {} } = args;
  const { organizationId } = ctx;

  // Resolve short ID (8-char hex) to full UUID if needed.
  let ticketId: string = rawTicketId;
  if (
    rawTicketId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTicketId)
  ) {
    if (/^[0-9a-f]{8}$/i.test(rawTicketId)) {
      const { data: found } = await supabase
        .from('tickets')
        .select('id')
        .eq('organization_id', organizationId)
        .ilike('id', `%${rawTicketId}`)
        .limit(2);
      if (!found || found.length !== 1) return toolErr('Ticket not found or access denied.');
      ticketId = found[0].id;
    } else {
      return toolErr('Invalid ticket ID format.');
    }
  }

  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select(TICKET_AGENT_FIELDS)
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketErr || !ticket) {
    if (ticketErr) {
      console.error('[attach] ticket select error:', ticketErr.message, ticketErr.code);
    }
    return toolErr('Ticket not found or access denied.');
  }

  const sessionKey = crypto.randomUUID();
  const { data: session, error: sessionErr } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      metadata,
      session_key: sessionKey,
      ticket_id: ticketId
    })
    .select('*')
    .single();

  if (sessionErr || !session) return toolErr('Failed to create session.');

  // Mark draft objective as executed
  const { data: draftObjective } = await supabase
    .from('objectives')
    .select('id, objective')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let executedObjective: string | null = null;
  if (draftObjective) {
    executedObjective = draftObjective.objective;
    await supabase.from('objectives').update({ is_executed: true }).eq('id', draftObjective.id);
  }

  const previousStatus = ticket.status;
  const isResumeAfterDelivery = previousStatus === 'review' || previousStatus === 'complete';

  const { error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({ status: 'execute' })
    .eq('id', ticketId);

  if (ticketUpdateError) return toolErr('Failed to update ticket status.');

  const { error: attachEventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: { agent_identifier: agentIdentifier, connection_method: connectionMethod },
    phase: previousStatus,
    session_id: session.id,
    summary: `${agentIdentifier} attached via ${connectionMethod}.`,
    ticket_id: ticketId
  });

  if (attachEventError) return toolErr('Failed to record attach event.');

  if (isResumeAfterDelivery) {
    const { error: reopenEventError } = await supabase.from('ticket_events').insert({
      event_type: 'ticket_reopened',
      phase: 'execute',
      session_id: session.id,
      summary: 'Ticket reopened — resumed from delivered state.',
      ticket_id: ticketId
    });

    if (reopenEventError) return toolErr('Failed to record reopen event.');
  }

  const [{ data: history }, { data: artifacts }, { data: sharedState }] = await Promise.all([
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('event_type', 'deliver')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('artifacts')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('shared_state')
      .select('*')
      .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  return toolOk({
    history: history ?? [],
    artifacts: artifacts ?? [],
    session: { id: session.id, sessionKey: session.session_key, state: session.session_state },
    sharedState: sharedState ?? [],
    ticket: { ...ticket, objective: executedObjective ?? ticket.objective }
  });
}
