import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { markSubmittedObjectiveExecuting } from '@/lib/objectives';
import { connectionMethods } from '@/lib/overlord/types';
import { resolvePreferredStatusNameByType, resolveStatusTypeForName } from '@/lib/ticket-statuses';
import type { Database, Json } from '@/types/database.types';

type ConnectClient = SupabaseClient<Database>;
type ConnectionMethod = (typeof connectionMethods)[number];

export type ConnectParams = {
  ticketId: string;
  agentIdentifier: string;
  connectionMethod: ConnectionMethod;
  metadata: Json;
  organizationId: number;
  userId?: string | null;
};

/**
 * Lightweight attach: creates an agent session and moves the ticket to execute,
 * but does NOT return ticket details, history, artifacts, or shared state.
 *
 * Use this when the agent has already started working and just needs to begin
 * sending events to a ticket without ingesting its context.
 */
export async function runConnectProtocol(supabase: ConnectClient, params: ConnectParams) {
  const { ticketId, agentIdentifier, connectionMethod, metadata, organizationId, userId } = params;
  const sessionKey = randomUUID();

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,status')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketError || !ticket) {
    return {
      error: 'Ticket not found.',
      status: ticketError?.code === 'PGRST116' ? 404 : 500
    } as const;
  }

  const objectiveExecution = await markSubmittedObjectiveExecuting(
    supabase,
    ticketId,
    {
      agentIdentifier,
      metadata
    },
    userId
  );

  if (!objectiveExecution.executedObjectiveId) {
    return { error: 'No objective available for execution.', status: 400 } as const;
  }

  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      metadata,
      session_key: sessionKey,
      objective_id: objectiveExecution.executedObjectiveId
    })
    .select('id,session_key,session_state')
    .single();

  if (sessionError || !session) {
    return { error: 'Failed to create session.', status: 500 } as const;
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

  if (ticketUpdateError) {
    return { error: 'Failed to update ticket status.', status: 500 } as const;
  }

  const { error: eventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: { agent_identifier: agentIdentifier, connection_method: connectionMethod },
    phase: previousStatus,
    objective_id: objectiveExecution.executedObjectiveId,
    summary: `${agentIdentifier} connected via ${connectionMethod}.`,
    ticket_id: ticketId,
    created_by: userId ?? null
  });

  if (eventError) {
    return { error: 'Failed to record connect event.', status: 500 } as const;
  }

  if (isResumeAfterDelivery) {
    await supabase.from('ticket_events').insert({
      event_type: 'ticket_reopened',
      phase: 'execute',
      objective_id: objectiveExecution.executedObjectiveId,
      summary: 'Ticket reopened — resumed from delivered state.',
      ticket_id: ticketId,
      created_by: userId ?? null
    });
  }

  return {
    error: null,
    data: {
      session: {
        id: session.id,
        sessionKey: session.session_key,
        state: session.session_state
      },
      ticketId
    }
  } as const;
}
