'use server';

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
import { fetchProfileCustomInstructions } from '@/lib/actions/profile-settings';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import { normalizeHexColor } from '@/lib/helpers/color';
import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import { createTicketSchema } from '@/lib/overlord/validation';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

function revalidateTicketBoards() {
  revalidatePath('/u');
  revalidatePath('/projects');
}

function revalidateTicketDetails(
  items: Iterable<{ organizationId: number; projectId: string; ticketId: string }>
) {
  for (const { organizationId, projectId, ticketId } of items) {
    revalidatePath(`/u/${ticketId}`);
    revalidatePath(buildTicketPath({ organizationId, projectId, ticketId }));
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Verify the current user has access to a ticket by checking it exists
 * within the user's organization scope. RLS on the tickets table already
 * enforces org membership, so if the query returns nothing, the user
 * either doesn't have access or the ticket doesn't exist.
 */
async function assertTicketAccess(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ organization_id: number; project_id: string }> {
  const { data, error } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (error || !data) {
    throw new Error('Ticket not found or access denied.');
  }

  return data;
}

type PromptTicketSource = {
  ticket: {
    id: string;
    organization_id: number;
    title: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    execution_target: Database['public']['Enums']['ticket_execution_target'] | null;
    project_id: string;
    status: string | null;
    priority: Database['public']['Enums']['ticket_priority'] | null;
  };
  latestObjective: string;
};

async function resolvePromptTicketSource(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ error?: string; source?: PromptTicketSource }> {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, organization_id, title, acceptance_criteria, available_tools, execution_target, project_id, status, priority'
    )
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return { error: error?.message ?? 'Ticket not found.' };
  }

  const { data: draftObjective } = await supabase
    .from('objectives')
    .select('objective')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draftObjective || !draftObjective.objective || draftObjective.objective.trim() === '') {
    return { error: 'No objective found for ticket.' };
  }

  return {
    source: {
      ticket,
      latestObjective: draftObjective.objective
    }
  };
}

async function resolveTicketProjectAndOrganization(
  supabase: ServerSupabase,
  input: {
    organizationId?: number;
    projectId?: string;
  }
): Promise<{ organizationId: number; projectId: string }> {
  const explicitProjectId = input.projectId?.trim() || null;

  if (explicitProjectId) {
    let query = supabase
      .from('projects')
      .select('id,organization_id')
      .eq('id', explicitProjectId)
      .limit(1);
    if (input.organizationId !== undefined) {
      query = query.eq('organization_id', input.organizationId);
    }

    const { data: explicitProject, error: explicitProjectError } = await query.maybeSingle();
    if (explicitProjectError || !explicitProject) {
      throw new Error('Selected project not found.');
    }

    return { organizationId: explicitProject.organization_id, projectId: explicitProject.id };
  }

  const cookieStore = await cookies();
  const defaultProjectId = cookieStore.get(DEFAULT_PROJECT_COOKIE)?.value?.trim() || null;
  if (defaultProjectId) {
    let query = supabase.from('projects').select('id,organization_id').eq('id', defaultProjectId);
    if (input.organizationId !== undefined) {
      query = query.eq('organization_id', input.organizationId);
    }

    const { data: cookieProject, error: cookieProjectError } = await query.maybeSingle();
    if (!cookieProjectError && cookieProject) {
      return { organizationId: cookieProject.organization_id, projectId: cookieProject.id };
    }
  }

  let fallbackQuery = supabase
    .from('projects')
    .select('id,organization_id')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1);
  if (input.organizationId !== undefined) {
    fallbackQuery = fallbackQuery.eq('organization_id', input.organizationId);
  }

  const { data: fallbackProject, error: fallbackError } = await fallbackQuery.maybeSingle();
  if (fallbackError || !fallbackProject) {
    throw new Error('No projects available. Create a project first.');
  }

  return { organizationId: fallbackProject.organization_id, projectId: fallbackProject.id };
}

async function assignTicketToColumnStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  status: string,
  organizationId: number
) {
  const { data: headTicket, error: headTicketError } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .neq('id', ticketId)
    .order('board_position', { ascending: true })
    .limit(1);

  if (headTicketError) {
    throw new Error(headTicketError.message);
  }

  const minBoardPosition = headTicket?.[0]?.board_position ?? 0;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ board_position: minBoardPosition - 1 })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function assignTicketToColumnEnd(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  status: string,
  organizationId: number
) {
  const { data: tailTicket, error: tailTicketError } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .neq('id', ticketId)
    .order('board_position', { ascending: false })
    .limit(1);

  if (tailTicketError) {
    throw new Error(tailTicketError.message);
  }

  const maxBoardPosition = tailTicket?.[0]?.board_position ?? 0;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ board_position: maxBoardPosition + 1 })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function createTicketInColumnAction(
  status: string,
  objective: string,
  ticketId: string,
  organizationId?: number,
  projectId?: string,
  position: 'top' | 'bottom' = 'top'
) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });
  const trimmedObjective = objective.trim() || null;

  const insertPayload: {
    id: string;
    status: string;
    objective: string | null;
    title: string | null;
    organization_id: number;
    project_id: string;
  } = {
    id: ticketId,
    status,
    objective: trimmedObjective,
    title: trimmedObjective ? deriveTitleFromObjective(trimmedObjective) : null,
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, trimmedObjective);
  if (position === 'bottom') {
    await assignTicketToColumnEnd(supabase, data.id, status, data.organization_id);
  } else {
    await assignTicketToColumnStart(supabase, data.id, status, data.organization_id);
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function createBlankTicketAction(organizationId?: number, projectId?: string) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });

  const insertPayload: {
    status: string;
    organization_id: number;
    project_id: string;
  } = {
    status: 'draft',
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, '');
  await assignTicketToColumnEnd(supabase, data.id, 'draft', data.organization_id);

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function createTicketAction(formData: FormData, organizationId?: number) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('objective') ?? formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    executionTarget: formData.get('executionTarget')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, { organizationId });

  const insertPayload: {
    acceptance_criteria: string | null;
    available_tools: string;
    execution_target: Database['public']['Enums']['ticket_execution_target'];
    objective: string;
    status: string;
    title: string;
    organization_id: number;
    project_id: string;
  } = {
    acceptance_criteria: parsed.data.acceptanceCriteria || null,
    available_tools: parsed.data.availableTools,
    execution_target: parsed.data.executionTarget,
    objective: parsed.data.description,
    status: 'draft',
    title: parsed.data.title || deriveTitleFromObjective(parsed.data.description),
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, parsed.data.description);
  await assignTicketToColumnEnd(supabase, data.id, 'draft', data.organization_id);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket created by PM.',
    ticket_id: data.id
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('objective') ?? formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    executionTarget: formData.get('executionTarget')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .update({
      acceptance_criteria: parsed.data.acceptanceCriteria || null,
      available_tools: parsed.data.availableTools,
      execution_target: parsed.data.executionTarget,
      objective: parsed.data.description,
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

const editableFields = ['title', 'objective', 'available_tools', 'acceptance_criteria'] as const;
type EditableField = (typeof editableFields)[number];

export async function updateTicketFieldAction(
  ticketId: string,
  field: EditableField,
  value: string
): Promise<void> {
  if (!editableFields.includes(field)) {
    throw new Error('Invalid field.');
  }

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const normalizedValue = value.trim();
  const ticketUpdatePayload =
    field === 'objective'
      ? { objective: normalizedValue || null }
      : field === 'available_tools'
        ? { available_tools: normalizedValue }
        : { [field]: normalizedValue || null };
  const { data, error } = await supabase
    .from('tickets')
    .update(ticketUpdatePayload)
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket.');
  }

  if (field === 'objective') {
    await upsertDraftObjective(supabase, ticketId, normalizedValue);
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

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ status: trimmedStatus })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket status.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'status_change',
    phase: status,
    summary: `Status changed to ${status}.`,
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

export async function updateTicketPriorityAction(
  ticketId: string,
  priority: Database['public']['Enums']['ticket_priority']
): Promise<void> {
  const supabase = await createClient();
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

export async function updateTicketExecutionTargetAction(
  ticketId: string,
  executionTarget: Database['public']['Enums']['ticket_execution_target']
) {
  if (executionTarget !== 'agent' && executionTarget !== 'human') {
    throw new Error('Invalid execution target.');
  }

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ execution_target: executionTarget })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket execution target.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `Execution target updated to ${executionTarget}.`,
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

export async function setTicketProjectAction(ticketId: string, projectId: string): Promise<void> {
  const supabase = await createClient();
  const nextProjectId = projectId.trim();
  if (!nextProjectId) {
    throw new Error('Project is required.');
  }

  // assertTicketAccess verifies RLS access; reuse the result as existingTicket
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
    summary: 'Project updated.',
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

export async function markObjectiveExecutedAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClient();
  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id,is_executed,objective,ticket_id')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .single();

  if (objectiveError || !objective) {
    throw new Error(objectiveError?.message ?? 'Objective not found.');
  }

  if (objective.is_executed) {
    return;
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({ is_executed: true })
    .eq('id', objectiveId);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const { data: existingDraft, error: existingDraftError } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .limit(1)
    .maybeSingle();
  if (existingDraftError) {
    throw new Error(existingDraftError.message);
  }

  if (!existingDraft) {
    const { error: insertDraftError } = await supabase.from('objectives').insert({
      ticket_id: ticketId,
      objective: '',
      is_executed: false
    });
    if (insertDraftError) {
      throw new Error(insertDraftError.message);
    }
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
    summary: 'Objective marked executed.',
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

export async function markObjectiveUnexecutedAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClient();

  // 1. Get all objectives for this ticket to check conditions
  const { data: objectives, error: objectivesError } = await supabase
    .from('objectives')
    .select('id,is_executed,objective')
    .eq('ticket_id', ticketId);

  if (objectivesError || !objectives) {
    throw new Error(objectivesError?.message ?? 'Objectives not found.');
  }

  const targetObjective = objectives.find(o => o.id === objectiveId);
  if (!targetObjective) {
    throw new Error('Target objective not found.');
  }

  if (!targetObjective.is_executed) {
    return;
  }

  // 2. Check if all OTHER objectives are either executed or empty
  const otherObjectives = objectives.filter(o => o.id !== objectiveId);
  const hasActiveNonEmptyObjective = otherObjectives.some(
    o => !o.is_executed && o.objective.trim().length > 0
  );

  if (hasActiveNonEmptyObjective) {
    throw new Error('Cannot unexecute objective while another objective is active.');
  }

  // 3. Mark any empty unexecuted objectives as executed to keep things clean
  const emptyUnexecutedIds = otherObjectives
    .filter(o => !o.is_executed && o.objective.trim().length === 0)
    .map(o => o.id);

  if (emptyUnexecutedIds.length > 0) {
    const { error: updateError } = await supabase
      .from('objectives')
      .update({ is_executed: true })
      .in('id', emptyUnexecutedIds);
    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  // 4. Mark the target objective as unexecuted
  const { error: unexecuteError } = await supabase
    .from('objectives')
    .update({ is_executed: false })
    .eq('id', objectiveId);

  if (unexecuteError) {
    throw new Error(unexecuteError.message);
  }

  // 5. Log the event and revalidate
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
    summary: 'Objective marked unexecuted.',
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

export async function createProjectAction(input: {
  organizationId: number;
  name: string;
  color: string;
}) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const color = normalizeHexColor(input.color);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      name: trimmedName,
      color
    })
    .select('id,name,color,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  revalidateTicketBoards();
  return { id: data.id, name: data.name, color: data.color, everhour_project_id: null };
}

export async function reorderTicketsAction(
  orderedIds: string[],
  statusChange?: { ticketId: string; newStatus: string }
) {
  const supabase = await createClient();
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

  // Update positions for all tickets in the list in parallel
  const updateResults = await Promise.all(
    orderedIds.map((id, i) => supabase.from('tickets').update({ board_position: i }).eq('id', id))
  );
  for (const { error } of updateResults) {
    if (error) {
      throw new Error(error.message);
    }
  }

  // If a ticket also changed columns, update its status
  if (statusChange) {
    const { data, error } = await supabase
      .from('tickets')
      .update({ status: statusChange.newStatus })
      .eq('id', statusChange.ticketId)
      .select('organization_id,project_id')
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update ticket status.');
    }
    organizationIds.add(data.organization_id);

    await supabase.from('ticket_events').insert({
      event_type: 'status_change',
      phase: statusChange.newStatus,
      summary: `Status changed to ${statusChange.newStatus}.`,
      ticket_id: statusChange.ticketId
    });

    revalidatePath(
      buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
    );
    revalidateTicketDetails([
      {
        organizationId: data.organization_id,
        projectId: data.project_id,
        ticketId: statusChange.ticketId
      }
    ]);
  }

  revalidateTicketBoards();
}

export async function markTicketReadAction(ticketId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: true }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketsReadAction(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: true }).in('id', ticketIds);
  if (error) throw new Error(`Failed to mark tickets as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketUnreadAction(ticketId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: false }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as unread: ${error.message}`);
  revalidateTicketBoards();
}

export async function markSessionDisconnectedAction(sessionId: string): Promise<void> {
  const supabase = await createClient();

  // Verify the session exists and the user has access (RLS on agent_sessions)
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
): Promise<{ organizationId: number; projectId: string }> {
  const supabase = await createClient();
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
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  return { organizationId: data.organization_id, projectId: data.project_id };
}

/** Returns the full LLM prompt for a ticket (for copy-to-clipboard). RLS applies. */
export async function getTicketPromptForCopy(
  ticketId: string,
  launchMode: PromptLaunchMode = 'run',
  context?: PromptContext
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { error, source } = await resolvePromptTicketSource(supabase, ticketId);
  if (error || !source) {
    return { error: error ?? 'Unable to load ticket prompt source.' };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const platformUrl = getPlatformUrl();
  const customInstructions = user ? await fetchProfileCustomInstructions(supabase, user.id) : null;

  let agentConfigs: Record<string, AgentConfig> = {};
  if (user) {
    try {
      agentConfigs = await getAllAgentConfigsAction();
    } catch (error) {
      console.error('Failed to load agent configs for prompt:', error);
      Sentry.captureException(error);
    }
  }

  let mcpUrl: string | undefined;
  try {
    mcpUrl = getOverlordMcpUrl();
  } catch {
    mcpUrl = undefined;
  }

  const prompt = buildTicketPromptMarkdown({
    ticket: {
      ...source.ticket,
      title: source.ticket.title?.trim(),
      objective: source.latestObjective
    },
    platformUrl,
    context,
    options: {
      mcpUrl,
      customInstructions,
      launchMode,
      agentConfigs
    }
  });
  return { prompt };
}

export async function getTicketDiscussionPromptForCopy(
  ticketId: string
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { error, source } = await resolvePromptTicketSource(supabase, ticketId);
  if (error || !source) {
    return { error: error ?? 'Unable to load ticket prompt source.' };
  }

  const ticketReference = `#${source.ticket.id.slice(0, 8)}`;
  const title = source.ticket.title?.trim() || '(Untitled)';
  const executionTarget = source.ticket.execution_target === 'human' ? 'Human' : 'Agent';
  const section = (heading: string, value: string | null) =>
    value?.trim() ? `## ${heading}\n${value.trim()}\n` : '';

  const prompt = `You are helping me discuss an Overlord ticket before implementation. First, consider the following:

Your job is to act as a collaborative exploration partner:
- Start by reading the ticket details carefully.
- Then say exactly: "I understand the ticket. What would you like to discuss?"
- Keep the conversation focused on open-ended exploration: scope, risks, tradeoffs, edge cases, and options.
- Do not implement or change any code unless I explicitly ask you to implement.
- Do not publish user_follow_up activity events for normal discussion turns.
- Only save notes when I explicitly ask. Save them as ticket artifacts, and as Markdown files only when I request Markdown.

## Ticket
- Reference: ${ticketReference}
- ID: ${source.ticket.id}
- Title: ${title}
- Status: ${source.ticket.status ?? 'unknown'}
- Priority: ${source.ticket.priority ?? 'unset'}
- Execution Target: ${executionTarget}
- Project ID: ${source.ticket.project_id}

${section('Objective', source.latestObjective)}${section('Acceptance Criteria', source.ticket.acceptance_criteria)}${section('Available Tools / Constraints', source.ticket.available_tools)}
`;

  return { prompt };
}

const TICKET_BOARD_SELECT =
  'id,title,objective,execution_target,status,priority,assigned_agent,recent_agent,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,organization:organizations(name),project:projects(name,color,everhour_project_id)';

type RawBoardTicket = {
  id: string;
  title: string | null;
  objective: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  assigned_agent: string | null;
  recent_agent: string | null;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string;
  everhour_task_id: string | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

function mapBoardTicket(raw: RawBoardTicket) {
  const p = Array.isArray(raw.project) ? raw.project[0] : raw.project;
  const org = Array.isArray(raw.organization) ? raw.organization[0] : raw.organization;
  return {
    id: raw.id,
    title: raw.title,
    objective: raw.objective,
    execution_target: raw.execution_target,
    status: raw.status,
    priority: raw.priority,
    assigned_agent: raw.assigned_agent,
    recent_agent: raw.recent_agent,
    is_read: raw.is_read,
    updated_at: raw.updated_at,
    board_position: raw.board_position,
    organization_id: raw.organization_id,
    project_id: raw.project_id,
    everhour_task_id: raw.everhour_task_id,
    organization_name: org?.name ?? null,
    project_name: p?.name ?? null,
    project_color: p?.color ?? null,
    project_everhour_project_id: p?.everhour_project_id ?? null,
    agent_session_state: null,
    running_agent: null,
    waiting_for_response_at: null,
    has_unopened_waiting_response: false,
    objectives_executed_count: 0
  };
}

export async function loadMoreTicketsAction({
  status,
  organizationId,
  projectId,
  beforeDate
}: {
  status: string;
  organizationId?: number;
  projectId?: string;
  beforeDate: string;
}): Promise<{ tickets: ReturnType<typeof mapBoardTicket>[] }> {
  const supabase = await createClient();

  let query = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .lt('updated_at', beforeDate)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (organizationId !== undefined) {
    query = query.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return { tickets: ((data ?? []) as RawBoardTicket[]).map(mapBoardTicket) };
}
