'use server';

import { createClient } from '@/supabase/utils/server';

export type RunningAgentSession = {
  id: string;
  ticketId: string;
  ticketTitle: string | null;
  projectId: string;
  organizationId: number;
  agentIdentifier: string;
  attachedAt: string;
};

export async function getRunningAgentSessionCountAction(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('agent_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('session_state', 'attached')
    .is('detached_at', null);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function getRunningAgentSessionsAction(): Promise<RunningAgentSession[]> {
  const supabase = await createClient();
  const { data: sessions, error: sessionsError } = await supabase
    .from('agent_sessions')
    .select('id,ticket_id,agent_identifier,attached_at')
    .eq('session_state', 'attached')
    .is('detached_at', null)
    .order('attached_at', { ascending: false });

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const ticketIds = [...new Set((sessions ?? []).map(session => session.ticket_id))];
  if (ticketIds.length === 0) {
    return [];
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('id,title,project_id,organization_id')
    .in('id', ticketIds);

  if (ticketsError) {
    throw new Error(ticketsError.message);
  }

  const ticketById = new Map((tickets ?? []).map(ticket => [ticket.id, ticket]));

  return (sessions ?? [])
    .map(session => {
      const ticket = ticketById.get(session.ticket_id);
      if (!ticket) return null;

      return {
        id: session.id,
        ticketId: session.ticket_id,
        ticketTitle: ticket.title,
        projectId: ticket.project_id,
        organizationId: ticket.organization_id,
        agentIdentifier: session.agent_identifier,
        attachedAt: session.attached_at
      };
    })
    .filter((session): session is RunningAgentSession => session !== null);
}

export async function stopRunningAgentSessionAction(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('session_state', 'attached');

  if (error) {
    throw new Error(error.message);
  }
}
