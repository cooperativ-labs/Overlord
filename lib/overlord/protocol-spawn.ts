import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import { connectionMethods } from '@/lib/overlord/types';
import type { Database, Json } from '@/types/database.types';

type SpawnClient = SupabaseClient<Database>;
type ConnectionMethod = (typeof connectionMethods)[number];

export type SpawnParams = {
  title: string;
  objective: string;
  acceptanceCriteria: string;
  availableTools: string;
  executionTarget: 'agent' | 'human';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId?: string;
  agentIdentifier: string;
  connectionMethod: ConnectionMethod;
  metadata: Json;
  organizationId: number;
  userId: string;
};

/**
 * Create a new ticket and immediately connect to it.
 *
 * Combines ticket creation with session establishment in a single operation.
 * Use this when an agent is mid-conversation and realizes the work should
 * be tracked as a ticket.
 */
export async function runSpawnProtocol(supabase: SpawnClient, params: SpawnParams) {
  const {
    title,
    objective,
    acceptanceCriteria,
    availableTools,
    executionTarget,
    priority,
    projectId,
    agentIdentifier,
    connectionMethod,
    metadata,
    organizationId,
    userId
  } = params;

  // Resolve project — use provided or fall back to first in org
  let resolvedProjectId: string | undefined = projectId;
  if (!resolvedProjectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('organization_id', organizationId)
      .order('id', { ascending: true })
      .limit(1)
      .single();
    resolvedProjectId = project?.id;
  }

  if (!resolvedProjectId) {
    return { error: 'No project found for this organization.', status: 400 } as const;
  }

  const nextTitle = title.trim() || deriveTitleFromObjective(objective);

  // Create the ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: acceptanceCriteria || null,
      available_tools: availableTools,
      created_by: userId,
      execution_target: executionTarget,
      objective,
      organization_id: organizationId,
      priority,
      project_id: resolvedProjectId,
      status: 'execute',
      title: nextTitle
    })
    .select('id,organization_id,project_id,execution_target,status,ticket_sequence')
    .single();

  if (ticketError || !ticket) {
    return {
      error: ticketError?.message ?? 'Failed to create ticket.',
      status: 500
    } as const;
  }

  // Create the draft objective (and mark it executed since we're starting work)
  await upsertDraftObjective(supabase, ticket.id, objective);

  // Create agent session
  const sessionKey = randomUUID();
  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      metadata,
      session_key: sessionKey,
      ticket_id: ticket.id
    })
    .select('id,session_key,session_state')
    .single();

  if (sessionError || !session) {
    return { error: 'Ticket created but failed to create session.', status: 500 } as const;
  }

  // Record the spawn event
  const { error: eventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: {
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      created_via: 'protocol.spawn'
    },
    phase: 'execute',
    session_id: session.id,
    summary: `Ticket spawned by ${agentIdentifier} via ${connectionMethod}.`,
    ticket_id: ticket.id
  });

  if (eventError) {
    return {
      error: 'Ticket and session created but failed to record event.',
      status: 500
    } as const;
  }

  return {
    error: null,
    data: {
      ticket: {
        id: ticket.id,
        title: nextTitle,
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        executionTarget: ticket.execution_target,
        status: ticket.status,
        ticketSequence: ticket.ticket_sequence
      },
      session: {
        id: session.id,
        sessionKey: session.session_key,
        state: session.session_state
      }
    }
  } as const;
}
