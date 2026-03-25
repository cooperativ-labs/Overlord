import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
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
  workingDirectory?: string;
  delegate?: string;
  parentSessionKey?: string;
  parentTicketId?: string;
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
    workingDirectory,
    delegate,
    parentSessionKey,
    parentTicketId,
    agentIdentifier,
    connectionMethod,
    metadata,
    organizationId,
    userId
  } = params;

  // Resolve project — use provided projectId, then try workingDirectory, then fall back to first in org
  let resolvedProjectId: string | undefined = projectId;

  if (!resolvedProjectId && workingDirectory) {
    const matched = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory
    );
    resolvedProjectId = matched?.id;
  }

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
      delegate: delegate || null,
      execution_target: executionTarget,
      organization_id: organizationId,
      priority,
      project_id: resolvedProjectId,
      status: 'draft',
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

  // Record the spawn event on the new ticket's session
  const { error: eventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: {
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      created_via: 'protocol.spawn',
      ...(delegate ? { delegate } : {})
    },
    phase: 'execute',
    session_id: session.id,
    summary: `Ticket spawned by ${agentIdentifier}${delegate ? ` (${delegate})` : ''} via ${connectionMethod}.`,
    ticket_id: ticket.id
  });

  if (eventError) {
    return {
      error: 'Ticket and session created but failed to record event.',
      status: 500
    } as const;
  }

  // If spawned from within an existing session, record an event on the parent
  // session so the parent's feed post can list tickets created by the agent.
  if (parentSessionKey && parentTicketId) {
    const { data: parentSession } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('session_key', parentSessionKey)
      .eq('ticket_id', parentTicketId)
      .maybeSingle();

    if (parentSession) {
      await supabase.from('ticket_events').insert({
        event_type: 'update',
        payload: {
          created_via: 'protocol.spawn',
          spawned_ticket_id: ticket.id,
          spawned_ticket_title: nextTitle,
          spawned_ticket_sequence: ticket.ticket_sequence,
          delegate: delegate || null
        },
        phase: 'execute',
        session_id: parentSession.id,
        summary: `Spawned ticket #${ticket.ticket_sequence}: ${nextTitle}`,
        ticket_id: parentTicketId
      });
    }
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
