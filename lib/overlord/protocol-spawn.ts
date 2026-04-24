import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import {
  generateAndSetObjectiveTitle,
  markSubmittedObjectiveExecuting,
  upsertDraftObjective
} from '@/lib/objectives';
import { resolveProtocolTicketCreatorUserId } from '@/lib/overlord/protocol-ticket-creator';
import { resolveTicketDelegate } from '@/lib/overlord/protocol-ticket-delegate';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
import { connectionMethods } from '@/lib/overlord/types';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
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
  personal?: boolean;
  workingDirectory?: string;
  delegate?: string;
  parentSessionKey?: string;
  parentTicketId?: string;
  agentIdentifier: string;
  modelIdentifier?: string | null;
  connectionMethod: ConnectionMethod;
  metadata: Json;
  organizationId: number;
  userId?: string;
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
    personal = false,
    workingDirectory,
    delegate,
    parentSessionKey,
    parentTicketId,
    agentIdentifier,
    modelIdentifier,
    connectionMethod,
    metadata,
    organizationId,
    userId
  } = params;

  // Resolve project — use provided projectId, then try workingDirectory, then fall back to first in org
  let resolvedProjectId: string | undefined = projectId;

  if (!personal && !resolvedProjectId && workingDirectory) {
    const matched = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory,
      userId ?? null
    );
    resolvedProjectId = matched?.id;
  }

  if (!personal && !resolvedProjectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('organization_id', organizationId)
      .order('id', { ascending: true })
      .limit(1)
      .single();
    resolvedProjectId = project?.id;
  }

  if (!personal && !resolvedProjectId) {
    return { error: 'No project found for this organization.', status: 400 } as const;
  }

  const nextTitle = title.trim() || deriveTitleFromObjective(objective);
  const ticketDelegate = resolveTicketDelegate(delegate, modelIdentifier ?? null, agentIdentifier);
  const createdBy = await resolveProtocolTicketCreatorUserId(supabase, {
    userId
  });
  const executeStatusName = await resolvePreferredStatusNameByType(
    supabase,
    organizationId,
    'execute'
  );

  // Create the ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: acceptanceCriteria || null,
      available_tools: availableTools,
      created_by: createdBy,
      delegate: ticketDelegate,
      execution_target: executionTarget,
      organization_id: organizationId,
      priority,
      project_id: personal ? null : (resolvedProjectId ?? null),
      status: executeStatusName,
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

  // Create the objective and immediately mark it as executing for the spawned session.
  await upsertDraftObjective(supabase, ticket.id, objective, createdBy);

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

  const objectiveExecution = await markSubmittedObjectiveExecuting(
    supabase,
    ticket.id,
    {
      agentIdentifier,
      metadata,
      ticketAssignedAgent: null
    },
    createdBy
  );

  if (objectiveExecution.didExecute && objectiveExecution.executedObjectiveId) {
    generateAndSetObjectiveTitle(
      supabase,
      objectiveExecution.executedObjectiveId,
      objectiveExecution.executedObjective!,
      createdBy
    ).catch(err => console.error('[spawn] objective title generation failed:', err));
  }

  // Record the spawn event on the new ticket's session
  const { error: eventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: {
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      created_via: 'protocol.spawn',
      ...(ticketDelegate ? { delegate: ticketDelegate } : {})
    },
    phase: 'execute',
    session_id: session.id,
    summary: `Ticket spawned by ${agentIdentifier}${ticketDelegate ? ` (${ticketDelegate})` : ''} via ${connectionMethod}.`,
    ticket_id: ticket.id,
    created_by: createdBy
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
          delegate: ticketDelegate
        },
        phase: 'execute',
        session_id: parentSession.id,
        summary: `Spawned ticket #${ticket.ticket_sequence}: ${nextTitle}`,
        ticket_id: parentTicketId,
        created_by: createdBy
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
        personal: ticket.project_id === null,
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
