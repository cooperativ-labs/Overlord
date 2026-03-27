// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { buildPromptContext } from './_prompt-context.ts';
import {
  resolvePreferredStatusNameByType,
  resolveStatusTypeForName
} from './_status-resolution.ts';

/**
 * Explicit ticket columns returned to agents — excludes internal fields like search_vector.
 * IMPORTANT: Keep this in sync with lib/overlord/protocol-attach.ts (TICKET_AGENT_FIELDS).
 */
const TICKET_AGENT_FIELDS =
  'id,title,status,priority,assigned_agent,board_position,organization_id,project_id,execution_target,context,constraints,available_tools,acceptance_criteria,output_format,created_at,updated_at,ticket_sequence,everhour_task_id,created_by';

export async function handleAttach(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    ticketId: rawTicketId,
    agentIdentifier,
    connectionMethod = 'mcp',
    externalSessionId,
    metadata = {}
  } = args;
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
      external_session_id:
        typeof externalSessionId === 'string' && externalSessionId.trim().length > 0
          ? externalSessionId.trim()
          : null,
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
    const ticketAssignedAgent =
      ticket.assigned_agent &&
      typeof ticket.assigned_agent === 'object' &&
      !Array.isArray(ticket.assigned_agent) &&
      typeof ticket.assigned_agent.model === 'string' &&
      ticket.assigned_agent.model.trim().length > 0
        ? ticket.assigned_agent.model.trim()
        : null;
    const metadataModel =
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      typeof metadata.model === 'string' &&
      metadata.model.trim().length > 0
        ? metadata.model.trim()
        : metadata &&
            typeof metadata === 'object' &&
            !Array.isArray(metadata) &&
            metadata.selection &&
            typeof metadata.selection === 'object' &&
            !Array.isArray(metadata.selection) &&
            typeof metadata.selection.model === 'string' &&
            metadata.selection.model.trim().length > 0
          ? metadata.selection.model.trim()
          : null;

    executedObjective = draftObjective.objective;
    await supabase
      .from('objectives')
      .update({
        is_executed: true,
        state: 'executing',
        agent_identifier: agentIdentifier ?? null,
        model_identifier: metadataModel ?? ticketAssignedAgent
      })
      .eq('id', draftObjective.id);

    // Create new empty draft objective
    await supabase.from('objectives').insert({
      is_executed: false,
      state: 'draft',
      objective: '',
      ticket_id: ticketId
    });
  }

  const previousStatus = ticket.status;
  const previousStatusType = await resolveStatusTypeForName(
    supabase,
    organizationId,
    previousStatus
  );
  const isResumeAfterDelivery =
    previousStatusType === 'review' || previousStatusType === 'complete';
  const executeStatusName = await resolvePreferredStatusNameByType(
    supabase,
    organizationId,
    'execute'
  );

  const { error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({ status: executeStatusName })
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

  const [
    { data: history },
    { data: artifacts },
    { data: sharedState },
    { data: recentEvents },
    { data: project },
    { data: profile }
  ] = await Promise.all([
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
      .limit(50),
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .neq('event_type', 'system')
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('projects')
      .select('local_working_directory')
      .eq('id', ticket.project_id)
      .maybeSingle(),
    supabase.from('profiles').select('custom_agent_instructions').eq('id', ctx.userId).maybeSingle()
  ]);

  const resolvedTicket = { ...ticket, objective: executedObjective ?? ticket.objective };
  const { promptContext, promptContextSections } = buildPromptContext({
    ticket: resolvedTicket,
    recentEvents: recentEvents ?? [],
    history: history ?? [],
    artifacts: artifacts ?? [],
    sharedState: sharedState ?? [],
    customInstructions: profile?.custom_agent_instructions ?? null,
    workingDirectory: project?.local_working_directory ?? null
  });

  return toolOk({
    history: history ?? [],
    artifacts: artifacts ?? [],
    session: { id: session.id, sessionKey: session.session_key, state: session.session_state },
    sharedState: sharedState ?? [],
    promptContext,
    promptContextSections,
    ticket: resolvedTicket
  });
}
