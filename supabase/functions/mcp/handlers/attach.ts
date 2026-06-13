// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { canReattachExecutingObjective } from '../session.ts';

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
  'id,title,ticket_id,status,priority,board_position,organization_id,project_id,for_human,context,constraints,available_tools,acceptance_criteria,output_format,created_at,updated_at,ticket_sequence,everhour_task_id,created_by';

async function resolvePendingCheckpointObjectiveIds(input: {
  supabase: SupabaseClient;
  projectId: string | null;
  objectives: Array<{ id: string; state: string | null }>;
}): Promise<string[]> {
  const executingObjectiveIds = input.objectives
    .filter(objective => objective.state === 'executing')
    .map(objective => objective.id);
  if (!input.projectId || executingObjectiveIds.length === 0) return [];

  const { data: checkpoints } = await input.supabase
    .from('project_checkpoints')
    .select('objective_id')
    .eq('project_id', input.projectId)
    .in('objective_id', executingObjectiveIds);

  const checkpointedObjectiveIds = new Set(
    ((checkpoints ?? []) as Array<{ objective_id: string }>).map(
      checkpoint => checkpoint.objective_id
    )
  );
  return executingObjectiveIds.filter(objectiveId => !checkpointedObjectiveIds.has(objectiveId));
}

export async function handleAttach(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    ticketId: rawTicketId,
    agentIdentifier,
    modelIdentifier,
    connectionMethod = 'mcp',
    externalSessionId,
    metadata = {}
  } = args;
  const { organizationId } = ctx;

  // Resolve a human-readable ticket_id (e.g. 1:899) to the internal UUID.
  let ticketId: string = rawTicketId;
  if (
    rawTicketId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTicketId)
  ) {
    if (/^\d+:\d+$/.test(rawTicketId)) {
      const { data: found } = await supabase
        .from('tickets')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('ticket_id', rawTicketId)
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

  // Mark the launchable objective as executing. This MUST use the same
  // selection order as REST attach (lib/objectives.ts markSubmittedObjectiveExecuting):
  // prefer `launching` (the new pre-attach state), then legacy `submitted`,
  // then `draft`, each ordered by position then created_at so the oldest
  // queued objective wins. Previously this handler ordered created_at DESC
  // (newest) and ignored `launching`, diverging from REST.
  // Objective must be resolved BEFORE creating the session (session uses objective_id).
  let draftObjective: { id: string; objective: string; assigned_agent: unknown } | null = null;
  for (const state of ['launching', 'submitted', 'draft']) {
    const { data } = await supabase
      .from('objectives')
      .select('id, objective, assigned_agent')
      .eq('ticket_id', ticketId)
      .eq('state', state)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      draftObjective = data;
      break;
    }
  }

  function resolveStoredAgentIdentifier(assignedAgent: unknown): string | null {
    if (!assignedAgent) return null;
    if (typeof assignedAgent === 'string') {
      const trimmed = assignedAgent.trim();
      return trimmed || null;
    }
    if (typeof assignedAgent !== 'object' || Array.isArray(assignedAgent)) return null;
    const agent = (assignedAgent as { agent?: unknown }).agent;
    if (typeof agent !== 'string') return null;
    const trimmed = agent.trim();
    return trimmed || null;
  }

  let executedObjective: string | null = null;
  let executedObjectiveId: string | null = null;
  if (draftObjective && draftObjective.objective.trim().length > 0) {
    const storedAgentIdentifier = resolveStoredAgentIdentifier(draftObjective.assigned_agent);
    if (!storedAgentIdentifier) {
      return toolErr('No agent was assigned to this objective. Select an agent before running.');
    }
    const objectiveAssignedModel =
      draftObjective.assigned_agent &&
      typeof draftObjective.assigned_agent === 'object' &&
      !Array.isArray(draftObjective.assigned_agent) &&
      typeof draftObjective.assigned_agent.model === 'string' &&
      draftObjective.assigned_agent.model.trim().length > 0
        ? draftObjective.assigned_agent.model.trim()
        : null;
    const explicitModel =
      typeof modelIdentifier === 'string' && modelIdentifier.trim().length > 0
        ? modelIdentifier.trim()
        : null;
    const metadataModel =
      explicitModel ??
      (metadata &&
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
          : null);

    executedObjective = draftObjective.objective;
    executedObjectiveId = draftObjective.id;
    await supabase
      .from('objectives')
      .update({
        state: 'executing',
        agent_identifier: storedAgentIdentifier,
        model_identifier: metadataModel ?? objectiveAssignedModel,
        completed_at: null
      })
      .eq('id', draftObjective.id);

    // Create new empty draft objective
    await supabase.from('objectives').insert({
      state: 'draft',
      objective: '',
      ticket_id: ticketId,
      created_by: ctx.userId
    });
  }

  // Re-attach fallback: if no submitted/draft objective is available but the
  // ticket already has an executing or pending-delivery one, reuse it. Keeps attach idempotent so
  // an agent that lost its SESSION_KEY mid-run can recover.
  if (!executedObjectiveId) {
    const { data: executingObjective } = await supabase
      .from('objectives')
      .select('id, objective')
      .eq('ticket_id', ticketId)
      .in('state', ['executing', 'pending_delivery'])
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (executingObjective && executingObjective.objective.trim().length > 0) {
      const canReattach = await canReattachExecutingObjective(supabase, executingObjective.id);
      if (canReattach) {
        executedObjective = executingObjective.objective;
        executedObjectiveId = executingObjective.id;
      }
    }
  }

  if (!executedObjectiveId) return toolErr('No objective available for execution.');

  // Detach any prior active session for this objective so the new session
  // satisfies agent_sessions_one_active_per_objective_idx.
  await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('objective_id', executedObjectiveId)
    .in('session_state', ['attached', 'idle', 'blocked']);

  const { data: executingObjectiveRow } = await supabase
    .from('objectives')
    .select('agent_identifier')
    .eq('id', executedObjectiveId)
    .single();

  const sessionKey = crypto.randomUUID();
  const { data: session, error: sessionErr } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: executingObjectiveRow?.agent_identifier ?? agentIdentifier,
      connection_method: connectionMethod,
      external_session_id:
        typeof externalSessionId === 'string' && externalSessionId.trim().length > 0
          ? externalSessionId.trim()
          : null,
      metadata,
      session_key: sessionKey,
      objective_id: executedObjectiveId
    })
    .select('*')
    .single();

  if (sessionErr || !session) return toolErr('Failed to create session.');

  // Phase 4 (mirror of lib/overlord/protocol-attach.ts): the session now exists,
  // so the launch genuinely succeeded — mark the matching execution request
  // `launched`. Prefer the request id threaded through attach metadata, fall
  // back to the active request for this objective, and treat a missing request
  // (non-runner manual launch) as a no-op so attach still succeeds.
  {
    const metadataRecord =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null;
    const selectionRecord =
      metadataRecord &&
      metadataRecord.selection &&
      typeof metadataRecord.selection === 'object' &&
      !Array.isArray(metadataRecord.selection)
        ? (metadataRecord.selection as Record<string, unknown>)
        : null;
    const rawRequestId =
      (typeof metadataRecord?.executionRequestId === 'string' &&
        metadataRecord.executionRequestId.trim()) ||
      (typeof selectionRecord?.executionRequestId === 'string' &&
        selectionRecord.executionRequestId.trim()) ||
      null;
    const launchedPatch = {
      status: 'launched',
      launched_session_id: session.id,
      launched_at: new Date().toISOString(),
      lease_expires_at: null,
      last_error: null
    };
    let marked = false;
    if (rawRequestId) {
      const { data } = await supabase
        .from('execution_requests')
        .update(launchedPatch)
        .eq('id', rawRequestId)
        .eq('organization_id', organizationId)
        .in('status', ['queued', 'claimed', 'launching'])
        .select('id')
        .maybeSingle();
      marked = Boolean(data);
    }
    if (!marked) {
      await supabase
        .from('execution_requests')
        .update(launchedPatch)
        .eq('organization_id', organizationId)
        .eq('objective_id', executedObjectiveId)
        .in('status', ['queued', 'claimed', 'launching'])
        .select('id')
        .maybeSingle();
    }
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
    objective_id: session.objective_id,
    summary: `${agentIdentifier} attached via ${connectionMethod}.`,
    ticket_id: ticketId,
    created_by: ctx.userId
  });

  if (attachEventError) return toolErr('Failed to record attach event.');

  if (isResumeAfterDelivery) {
    const { error: reopenEventError } = await supabase.from('ticket_events').insert({
      event_type: 'ticket_reopened',
      phase: 'execute',
      objective_id: session.objective_id,
      summary: 'Ticket reopened — resumed from delivered state.',
      ticket_id: ticketId,
      created_by: ctx.userId
    });

    if (reopenEventError) return toolErr('Failed to record reopen event.');
  }

  const [
    { data: history },
    { data: artifacts },
    { data: attachments },
    { data: objectives },
    { data: sharedState },
    { data: recentEvents },
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
      .from('objective_attachments')
      .select('id, label, content_type, file_size, objective_id, storage_path, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('objectives')
      .select('id, objective, state, created_at')
      .eq('ticket_id', ticketId)
      .neq('state', 'draft')
      .order('created_at', { ascending: true })
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
    supabase.from('profiles').select('custom_agent_instructions').eq('id', ctx.userId).maybeSingle()
  ]);

  const pendingCheckpointObjectiveIds = await resolvePendingCheckpointObjectiveIds({
    supabase,
    projectId: (ticket as { project_id: string | null }).project_id,
    objectives: (objectives ?? []) as Array<{ id: string; state: string | null }>
  });

  const resolvedTicket = {
    ...ticket,
    objective: executedObjective ?? null,
    objective_id: executedObjectiveId
  };
  const { promptContext, promptContextSections } = buildPromptContext({
    ticket: resolvedTicket,
    recentEvents: recentEvents ?? [],
    history: history ?? [],
    artifacts: artifacts ?? [],
    attachments: attachments ?? [],
    objectives: objectives ?? [],
    sharedState: sharedState ?? [],
    customInstructions: profile?.custom_agent_instructions ?? null
  });

  return toolOk({
    history: history ?? [],
    artifacts: artifacts ?? [],
    attachments: attachments ?? [],
    objectives: objectives ?? [],
    session: { id: session.id, sessionKey: session.session_key, state: session.session_state },
    sharedState: sharedState ?? [],
    promptContext,
    promptContextSections,
    pendingCheckpointObjectiveIds,
    ticket: resolvedTicket
  });
}
