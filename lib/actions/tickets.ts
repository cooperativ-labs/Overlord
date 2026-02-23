'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { getPlatformUrl } from '@/lib/env';
import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';
import { upsertDraftObjective } from '@/lib/objectives';
import { buildTicketPromptMarkdown } from '@/lib/overlord/ticket-prompt';
import { createTicketSchema } from '@/lib/overlord/validation';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

function deriveTitleFromObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 60) + '…';
}

const hexColorPattern = /^#([0-9a-fA-F]{6})$/;

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (!hexColorPattern.test(trimmed)) {
    throw new Error('Color must be a valid hex value like #d4d4d8.');
  }
  return trimmed.toLowerCase();
}

function revalidateTicketBoards(organizationIds: Iterable<number>) {
  revalidatePath('/u');
  for (const organizationId of organizationIds) {
    revalidatePath(`/${organizationId}`);
  }
}

function revalidateTicketDetails(
  items: Iterable<{ organizationId: number; projectId: string; ticketId: string }>
) {
  for (const { organizationId, projectId, ticketId } of items) {
    revalidatePath(buildTicketPath({ organizationId, projectId, ticketId }));
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

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

  const maxBoardPosition = tailTicket?.[0]?.board_position ?? -1;
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
  organizationId?: number,
  projectId?: string
) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });
  const trimmedObjective = objective.trim() || null;

  const insertPayload: {
    status: string;
    objective: string | null;
    title: string | null;
    organization_id: number;
    project_id: string;
  } = {
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
  await assignTicketToColumnEnd(supabase, data.id, status, data.organization_id);

  revalidateTicketBoards([data.organization_id]);
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

  revalidateTicketBoards([data.organization_id]);
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

  revalidateTicketBoards([data.organization_id]);
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

  revalidateTicketBoards([data.organization_id]);
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
) {
  if (!editableFields.includes(field)) {
    throw new Error('Invalid field.');
  }

  const supabase = await createClient();
  const normalizedValue = value.trim();
  const ticketUpdatePayload =
    field === 'objective'
      ? { objective: normalizedValue || null }
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

  revalidateTicketBoards([data.organization_id]);
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketStatusAction(ticketId: string, status: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .update({ status })
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

  revalidateTicketBoards([data.organization_id]);
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

  revalidateTicketBoards([data.organization_id]);
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function setTicketProjectAction(ticketId: string, projectId: string) {
  const supabase = await createClient();
  const nextProjectId = projectId.trim();
  if (!nextProjectId) {
    throw new Error('Project is required.');
  }

  const { data: existingTicket, error: existingTicketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (existingTicketError || !existingTicket) {
    throw new Error(existingTicketError?.message ?? 'Ticket not found.');
  }

  if (existingTicket.project_id === nextProjectId) {
    return;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({
      everhour_project_id: null,
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

  revalidateTicketBoards([data.organization_id]);
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function markObjectiveExecutedAction(ticketId: string, objectiveId: string) {
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

  revalidateTicketBoards([ticket.organization_id]);
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

  revalidateTicketBoards([data.organization_id]);
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

  // Update positions for all tickets in the list
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('tickets')
      .update({ board_position: i })
      .eq('id', orderedIds[i]);
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

  revalidateTicketBoards(organizationIds);
}

export async function deleteTicketAction(ticketId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .delete()
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to delete ticket.');
  }

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  return { organizationId: data.organization_id, projectId: data.project_id };
}

/** Returns the full LLM prompt for a ticket (for copy-to-clipboard). RLS applies. */
export async function getTicketPromptForCopy(
  ticketId: string
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, title, objective, acceptance_criteria, available_tools, execution_target, project_id, status, priority'
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

  const platformUrl = getPlatformUrl();
  const prompt = buildTicketPromptMarkdown(
    {
      ...ticket,
      objective: draftObjective?.objective ?? ticket.objective
    },
    platformUrl
  );
  return { prompt };
}
