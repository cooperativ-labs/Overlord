'use server';

import { revalidatePath } from 'next/cache';

import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { createObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { upsertDraftObjective } from '@/lib/objectives';
import { submitDraftObjective } from '@/lib/objectives';
import { createExecutionRequest } from '@/lib/overlord/execution-requests';
import { createTicketSchema } from '@/lib/overlord/validation';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import {
  assertTicketAccess,
  revalidateTicketBoards,
  revalidateTicketDetails,
  updateTicketStatusAndSchedule
} from './internals';

const editableFields = ['title', 'objective', 'available_tools', 'acceptance_criteria'] as const;
type EditableField = (typeof editableFields)[number];

export async function submitTicketObjectiveAction(
  ticketId: string,
  draftObjectiveId?: string | null
): Promise<void> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);
  const submission = await submitDraftObjective(supabase, ticketId, draftObjectiveId ?? undefined);

  if (submission.error) {
    throw new Error(submission.error);
  }

  if (!submission.didSubmit) {
    return;
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();
  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Objective submitted.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function requestTicketObjectiveExecutionAction(input: {
  ticketId: string;
  objectiveId?: string | null;
  agentIdentifier?: string | null;
  modelIdentifier?: string | null;
  thinkingLevel?: string | null;
  flags?: string[];
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  serverMultiplexer?: 'none' | 'tmux' | null;
  tmuxCommand?: string | null;
  targetExecutionTargetId?: string | null;
}): Promise<{ requestId: string; status: string } | { error: string }> {
  try {
    const supabase = await createClientForRequest();
    const ticket = await assertTicketAccess(supabase, input.ticketId);
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return { error: 'Authentication required.' };

    const result = await createExecutionRequest(supabase, {
      ticketId: input.ticketId,
      objectiveId: input.objectiveId ?? null,
      userId: user.id,
      organizationId: ticket.organization_id,
      requestedFrom: 'manual_run',
      agentIdentifier: input.agentIdentifier ?? null,
      modelIdentifier: input.modelIdentifier ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      launchMode: 'run',
      flags: input.flags ?? [],
      workingDirectory: input.workingDirectory ?? null,
      sshCommand: input.sshCommand ?? null,
      remoteWorkingDirectory: input.remoteWorkingDirectory ?? null,
      serverMultiplexer: input.serverMultiplexer ?? null,
      tmuxCommand: input.tmuxCommand ?? null,
      targetKind: input.sshCommand?.trim() ? 'ssh' : 'any',
      targetExecutionTargetId: input.targetExecutionTargetId ?? null
    });

    revalidateTicketBoards();
    revalidatePath(
      buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
    );
    revalidateTicketDetails([
      {
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        ticketId: input.ticketId
      }
    ]);

    return { requestId: result.request.id, status: result.request.status };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Failed to queue execution. Check your connection and try again.'
    };
  }
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('objective') ?? formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    forHuman: formData.get('forHuman') === 'true'
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('tickets')
    .update({
      acceptance_criteria: parsed.data.acceptanceCriteria || null,
      available_tools: parsed.data.availableTools,
      for_human: parsed.data.forHuman,
      title: parsed.data.title || null
    })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket.');
  }

  await upsertDraftObjective(supabase, ticketId, parsed.data.description);
  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket updated by PM.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketFieldAction(
  ticketId: string,
  field: EditableField,
  value: string
): Promise<void> {
  if (!editableFields.includes(field)) {
    throw new Error('Invalid field.');
  }

  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const normalizedValue = value.trim();

  let data: { organization_id: number; project_id: string | null };

  if (field === 'objective') {
    await upsertDraftObjective(supabase, ticketId, normalizedValue);
    const result = await supabase
      .from('tickets')
      .select('organization_id,project_id')
      .eq('id', ticketId)
      .single();

    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? 'Failed to get ticket details.');
    }
    data = result.data;
  } else {
    const ticketUpdatePayload =
      field === 'available_tools'
        ? { available_tools: normalizedValue }
        : { [field]: normalizedValue || null };
    const result = await supabase
      .from('tickets')
      .update(ticketUpdatePayload)
      .eq('id', ticketId)
      .select('organization_id,project_id')
      .single();

    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? 'Failed to update ticket.');
    }
    data = result.data;
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `${field.replace('_', ' ')} updated.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketStatusAction(ticketId: string, status: string): Promise<void> {
  const trimmedStatus = status.trim();
  if (!trimmedStatus) {
    throw new Error('Status is required.');
  }

  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);
  const affectedTickets = await updateTicketStatusAndSchedule(supabase, ticketId, trimmedStatus);

  revalidateTicketBoards();
  for (const affectedTicket of affectedTickets) {
    revalidatePath(
      buildProjectPath({
        organizationId: affectedTicket.organizationId,
        projectId: affectedTicket.projectId
      })
    );
  }
  revalidateTicketDetails(affectedTickets);
}

export async function updateTicketPriorityAction(
  ticketId: string,
  priority: Database['public']['Enums']['ticket_priority']
): Promise<void> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ priority })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket priority.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'priority_change',
    phase: priority,
    summary: `Priority changed to ${priority}.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketForHumanAction(ticketId: string, forHuman: boolean) {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ for_human: forHuman })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket assignment.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `Ticket assignment updated to ${forHuman ? 'human' : 'agent'}.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function setTicketProjectAction(
  ticketId: string,
  projectId: string | null
): Promise<void> {
  const supabase = await createClientForRequest();
  const nextProjectId = typeof projectId === 'string' ? projectId.trim() || null : null;

  const existingTicket = await assertTicketAccess(supabase, ticketId);

  if (existingTicket.project_id === nextProjectId) {
    return;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({
      everhour_task_id: null,
      project_id: nextProjectId
    })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket project.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: nextProjectId ? 'Project updated.' : 'Moved to personal inbox.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function reorderTicketsAction(
  orderedIds: string[],
  statusChange?: { ticketId: string; newStatus: string }
) {
  const supabase = await createClientForRequest();
  const organizationIds = new Set<number>();

  if (orderedIds.length > 0) {
    const { data: affectedTickets, error: affectedTicketsError } = await supabase
      .from('tickets')
      .select('id,organization_id')
      .in('id', orderedIds);

    if (affectedTicketsError) {
      throw new Error(affectedTicketsError.message);
    }

    for (const ticket of affectedTickets ?? []) {
      organizationIds.add(ticket.organization_id);
    }
  }

  const updateResults = await Promise.all(
    orderedIds.map((id, i) => supabase.from('tickets').update({ board_position: i }).eq('id', id))
  );
  for (const { error } of updateResults) {
    if (error) {
      throw new Error(error.message);
    }
  }

  if (statusChange) {
    const affectedTickets = await updateTicketStatusAndSchedule(
      supabase,
      statusChange.ticketId,
      statusChange.newStatus
    );

    for (const affectedTicket of affectedTickets) {
      organizationIds.add(affectedTicket.organizationId);
      revalidatePath(
        buildProjectPath({
          organizationId: affectedTicket.organizationId,
          projectId: affectedTicket.projectId
        })
      );
    }

    revalidateTicketDetails(affectedTickets);
  }

  revalidateTicketBoards();
}

export async function markTicketReadAction(ticketId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const { error } = await supabase.from('tickets').update({ is_read: true }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketsReadAction(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const supabase = await createClientForRequest();
  const { error } = await supabase.from('tickets').update({ is_read: true }).in('id', ticketIds);
  if (error) throw new Error(`Failed to mark tickets as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketUnreadAction(ticketId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const { error } = await supabase.from('tickets').update({ is_read: false }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as unread: ${error.message}`);
  revalidateTicketBoards();
}

export async function markSessionDisconnectedAction(sessionId: string): Promise<void> {
  const supabase = await createClientForRequest();

  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .select('id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error('Session not found or access denied.');
  }

  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteTicketAction(
  ticketId: string
): Promise<{ organizationId: number; projectId: string | null }> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .delete()
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to delete ticket.');
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id }),
    'layout'
  );
  return { organizationId: data.organization_id, projectId: data.project_id };
}

export async function updateTicketDueDateAction(
  ticketId: string,
  dueDate: string | null
): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);

  const { error } = await supabase
    .from('tickets')
    .update({ due_datetime: dueDate })
    .eq('id', ticketId);

  if (error) throw new Error(error.message);

  revalidateTicketBoards();
  revalidateTicketDetails([
    {
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    }
  ]);
}

export async function updateTicketAssignedAgentAction(
  ticketId: string,
  selection: AgentModelSelection,
  objectiveId?: string | null
): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);
  let targetObjectiveId = objectiveId ?? null;

  if (targetObjectiveId) {
    const { data: objective, error: objectiveError } = await supabase
      .from('objectives')
      .select('id')
      .eq('id', targetObjectiveId)
      .eq('ticket_id', ticketId)
      .single();

    if (objectiveError || !objective) {
      throw new Error(objectiveError?.message ?? 'Objective not found.');
    }
  } else {
    const { data: draftObjective, error: draftError } = await supabase
      .from('objectives')
      .select('id')
      .eq('ticket_id', ticketId)
      .eq('state', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) throw new Error(draftError.message);

    targetObjectiveId = draftObjective?.id ?? null;

    if (!targetObjectiveId) {
      const { data: createdObjective, error: createError } = await supabase
        .from('objectives')
        .insert({
          ticket_id: ticketId,
          objective: '',
          state: 'draft'
        })
        .select('id')
        .single();

      if (createError || !createdObjective) {
        throw new Error(createError?.message ?? 'Failed to create draft objective.');
      }

      targetObjectiveId = createdObjective.id;
    }
  }

  const { error } = await supabase
    .from('objectives')
    .update({ assigned_agent: createObjectiveAssignedAgent(selection) })
    .eq('id', targetObjectiveId)
    .eq('ticket_id', ticketId);

  if (error) throw new Error(error.message);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Assigned agent updated.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidateTicketDetails([
    {
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    }
  ]);
}
