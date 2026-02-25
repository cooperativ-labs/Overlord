// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

export async function handleAttach(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { ticketId, agentIdentifier, connectionMethod = 'mcp', metadata = {} } = args;
  const { organizationId } = ctx;

  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketErr || !ticket) return toolErr('Ticket not found or access denied.');

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

  await supabase.from('tickets').update({ status: 'execute' }).eq('id', ticketId);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: { agent_identifier: agentIdentifier, connection_method: connectionMethod },
    phase: previousStatus,
    session_id: session.id,
    summary: `${agentIdentifier} attached via ${connectionMethod}.`,
    ticket_id: ticketId
  });

  if (isResumeAfterDelivery) {
    await supabase.from('ticket_events').insert({
      event_type: 'user_follow_up',
      phase: 'execute',
      session_id: session.id,
      summary: 'User followed up — ticket resumed from delivered state.',
      ticket_id: ticketId
    });
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
