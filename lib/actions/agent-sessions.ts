'use server';

import { createClientForRequest } from '@/supabase/utils/server';

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
  const supabase = await createClientForRequest();
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
  const supabase = await createClientForRequest();
  const { data: sessions, error: sessionsError } = await supabase
    .from('agent_sessions')
    .select(
      'id, agent_identifier, attached_at, objective:objectives!inner(ticket_id, ticket:tickets!inner(id, title, project_id, organization_id))'
    )
    .eq('session_state', 'attached')
    .is('detached_at', null)
    .order('attached_at', { ascending: false });

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  return (sessions ?? [])
    .map(session => {
      const objective = session.objective as unknown as {
        ticket_id: string;
        ticket: { id: string; title: string | null; project_id: string; organization_id: number };
      };
      if (!objective?.ticket) return null;

      return {
        id: session.id,
        ticketId: objective.ticket_id,
        ticketTitle: objective.ticket.title,
        projectId: objective.ticket.project_id,
        organizationId: objective.ticket.organization_id,
        agentIdentifier: session.agent_identifier,
        attachedAt: session.attached_at
      };
    })
    .filter((session): session is RunningAgentSession => session !== null);
}

export async function stopRunningAgentSessionAction(sessionId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('session_state', 'attached');

  if (error) {
    throw new Error(error.message);
  }
}
