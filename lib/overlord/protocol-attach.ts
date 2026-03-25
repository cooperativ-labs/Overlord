import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { markDraftObjectiveExecuted } from '@/lib/objectives';
import { buildPromptContext } from '@/lib/overlord/prompt-context';
import { connectionMethods } from '@/lib/overlord/types';
import type { Database, Json } from '@/types/database.types';

type AttachClient = SupabaseClient<Database>;
type ConnectionMethod = (typeof connectionMethods)[number];

/**
 * Explicit ticket columns returned to agents — excludes internal fields like search_vector.
 * IMPORTANT: Keep this in sync with supabase/functions/mcp/handlers/attach.ts.
 */
export const TICKET_AGENT_FIELDS =
  'id,title,status,priority,assigned_agent,recent_agent,board_position,organization_id,project_id,execution_target,context,constraints,available_tools,acceptance_criteria,output_format,created_at,updated_at,ticket_sequence,everhour_task_id,created_by';

export type AttachParams = {
  ticketId: string;
  agentIdentifier: string;
  connectionMethod: ConnectionMethod;
  externalSessionId?: string | null;
  metadata: Json;
  organizationId: number;
  userId: string;
};

/**
 * Core attach protocol logic shared between the REST API route and MCP handler.
 * Returns a result object on success or an error string on failure.
 *
 * The MCP edge function (supabase/functions/mcp/handlers/attach.ts) reimplements
 * this logic because it runs in Deno and cannot import from lib/. Any changes here
 * MUST be mirrored there.
 */
export async function runAttachProtocol(supabase: AttachClient, params: AttachParams) {
  const {
    ticketId,
    agentIdentifier,
    connectionMethod,
    externalSessionId,
    metadata,
    organizationId,
    userId
  } = params;
  const sessionKey = randomUUID();

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select(TICKET_AGENT_FIELDS)
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketError || !ticket) {
    const is404 = ticketError?.code === 'PGRST116';

    if (ticketError && !is404) {
      console.error('[attach] ticket select error:', ticketError.message, ticketError.code);
    }

    return {
      error: 'Ticket not found.',
      status: is404 ? 404 : 500
    } as const;
  }

  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      external_session_id: externalSessionId?.trim() || null,
      metadata,
      session_key: sessionKey,
      ticket_id: ticketId
    })
    .select('*')
    .single();

  if (sessionError || !session) {
    return { error: 'Failed to create session.', status: 500 } as const;
  }

  const objectiveExecution = await markDraftObjectiveExecuted(supabase, ticketId);

  const previousStatus = ticket.status;
  const isResumeAfterDelivery = previousStatus === 'review' || previousStatus === 'complete';

  const { error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({ status: 'execute' })
    .eq('id', ticketId);

  if (ticketUpdateError) {
    return { error: 'Failed to update ticket status.', status: 500 } as const;
  }

  const { error: attachEventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: { agent_identifier: agentIdentifier, connection_method: connectionMethod },
    phase: previousStatus,
    session_id: session.id,
    summary: `${agentIdentifier} attached via ${connectionMethod}.`,
    ticket_id: ticketId
  });

  if (attachEventError) {
    return { error: 'Failed to record attach event.', status: 500 } as const;
  }

  if (isResumeAfterDelivery) {
    const { error: reopenEventError } = await supabase.from('ticket_events').insert({
      event_type: 'ticket_reopened',
      phase: 'execute',
      session_id: session.id,
      summary: 'Ticket reopened — resumed from delivered state.',
      ticket_id: ticketId
    });

    if (reopenEventError) {
      return { error: 'Failed to record reopen event.', status: 500 } as const;
    }
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
    supabase.from('profiles').select('custom_agent_instructions').eq('id', userId).maybeSingle()
  ]);

  const { promptContext, promptContextSections } = buildPromptContext({
    ticket: {
      ...ticket,
      objective: objectiveExecution.executedObjective ?? undefined
    },
    recentEvents: recentEvents ?? [],
    history: history ?? [],
    artifacts: artifacts ?? [],
    sharedState: sharedState ?? [],
    customInstructions: profile?.custom_agent_instructions ?? null,
    workingDirectory: project?.local_working_directory ?? null
  });

  return {
    error: null,
    data: {
      history: history ?? [],
      artifacts: artifacts ?? [],
      session: {
        id: session.id,
        sessionKey: session.session_key,
        state: session.session_state
      },
      sharedState: sharedState ?? [],
      promptContext,
      promptContextSections,
      ticket: {
        ...ticket,
        objective: objectiveExecution.executedObjective ?? undefined
      }
    }
  } as const;
}
