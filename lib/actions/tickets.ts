'use server';

import { revalidatePath } from 'next/cache';

import { getPlatformUrl } from '@/lib/env';
import { buildTicketPromptMarkdown } from '@/lib/orchestrator/ticket-prompt';
import { createTicketSchema } from '@/lib/orchestrator/validation';
import { createClient } from '@/supabase/utils/server';

function deriveTitleFromDescription(description: string): string {
  const trimmed = description.trim();
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

function revalidateTicketDetails(items: Iterable<{ organizationId: number; ticketId: string }>) {
  for (const { organizationId, ticketId } of items) {
    revalidatePath(`/${organizationId}/${ticketId}`);
  }
}

export async function createTicketInColumnAction(
  status: string,
  objective: string,
  organizationId?: number
) {
  const supabase = await createClient();
  const trimmedObjective = objective.trim() || null;

  const insertPayload: {
    status: string;
    objective: string | null;
    title: string | null;
    organization_id?: number;
  } = {
    status,
    objective: trimmedObjective,
    title: trimmedObjective ? deriveTitleFromDescription(trimmedObjective) : null
  };

  if (organizationId !== undefined) {
    insertPayload.organization_id = organizationId;
  }

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId: data.id }]);
  return { id: data.id, organizationId: data.organization_id };
}

export async function createBlankTicketAction(organizationId?: number) {
  const supabase = await createClient();

  const insertPayload: {
    status: string;
    organization_id?: number;
  } = { status: 'draft' };

  if (organizationId !== undefined) {
    insertPayload.organization_id = organizationId;
  }

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId: data.id }]);
  return { id: data.id, organizationId: data.organization_id };
}

export async function createTicketAction(formData: FormData, organizationId?: number) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();

  const insertPayload: {
    acceptance_criteria: string | null;
    available_tools: string;
    objective: string;
    status: string;
    title: string;
    organization_id?: number;
  } = {
    acceptance_criteria: parsed.data.acceptanceCriteria || null,
    available_tools: parsed.data.availableTools,
    objective: parsed.data.description,
    status: 'draft',
    title: parsed.data.title || deriveTitleFromDescription(parsed.data.description)
  };

  if (organizationId !== undefined) {
    insertPayload.organization_id = organizationId;
  }

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket created by PM.',
    ticket_id: data.id
  });

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId: data.id }]);
  return { id: data.id, organizationId: data.organization_id };
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria')
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
      objective: parsed.data.description,
      title: parsed.data.title || null
    })
    .eq('id', ticketId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket updated by PM.',
    ticket_id: ticketId
  });

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId }]);
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
  const { data, error } = await supabase
    .from('tickets')
    .update({ [field]: value.trim() || null })
    .eq('id', ticketId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `${field.replace('_', ' ')} updated.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId }]);
}

export async function updateTicketStatusAction(ticketId: string, status: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .update({ status })
    .eq('id', ticketId)
    .select('organization_id')
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
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId }]);
}

export async function setTicketProjectAction(ticketId: string, projectId: string | null) {
  const supabase = await createClient();
  const nextProjectId = projectId?.trim() || null;
  const { data: existingTicket, error: existingTicketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (existingTicketError || !existingTicket) {
    throw new Error(existingTicketError?.message ?? 'Ticket not found.');
  }

  if ((existingTicket.project_id ?? null) === nextProjectId) {
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
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket project.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: nextProjectId ? 'Project updated.' : 'Project cleared.',
    ticket_id: ticketId
  });

  revalidateTicketBoards([data.organization_id]);
  revalidateTicketDetails([{ organizationId: data.organization_id, ticketId }]);
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
      .select('organization_id')
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

    revalidateTicketDetails([
      { organizationId: data.organization_id, ticketId: statusChange.ticketId }
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
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to delete ticket.');
  }

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  return { organizationId: data.organization_id };
}

/** Returns the full LLM prompt for a ticket (for copy-to-clipboard). RLS applies. */
export async function getTicketPromptForCopy(
  ticketId: string
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, title, objective, acceptance_criteria, available_tools, status, priority'
    )
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return { error: error?.message ?? 'Ticket not found.' };
  }

  const platformUrl = getPlatformUrl();
  const prompt = buildTicketPromptMarkdown(ticket, platformUrl);
  return { prompt };
}
