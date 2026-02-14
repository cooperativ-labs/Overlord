'use server';

import { revalidatePath } from 'next/cache';

import { createTicketSchema } from '@/lib/orchestrator/validation';
import { createClient } from '@/supabase/utils/server';

export async function createTicketAction(formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    objective: formData.get('objective'),
    context: formData.get('context'),
    constraints: formData.get('constraints'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    outputFormat: formData.get('outputFormat'),
    assignedAgent: formData.get('assignedAgent'),
    priority: formData.get('priority')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: parsed.data.acceptanceCriteria,
      assigned_agent: parsed.data.assignedAgent || null,
      available_tools: parsed.data.availableTools,
      constraints: parsed.data.constraints,
      context: parsed.data.context,
      objective: parsed.data.objective,
      output_format: parsed.data.outputFormat,
      priority: parsed.data.priority,
      status: 'draft',
      title: parsed.data.title
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket created by PM.',
    ticket_id: data.id
  });

  revalidatePath('/tickets');
  return { id: data.id };
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    objective: formData.get('objective'),
    context: formData.get('context'),
    constraints: formData.get('constraints'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    outputFormat: formData.get('outputFormat'),
    assignedAgent: formData.get('assignedAgent'),
    priority: formData.get('priority')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('tickets')
    .update({
      acceptance_criteria: parsed.data.acceptanceCriteria,
      assigned_agent: parsed.data.assignedAgent || null,
      available_tools: parsed.data.availableTools,
      constraints: parsed.data.constraints,
      context: parsed.data.context,
      objective: parsed.data.objective,
      output_format: parsed.data.outputFormat,
      priority: parsed.data.priority,
      title: parsed.data.title
    })
    .eq('id', ticketId);

  if (error) {
    throw new Error(error.message ?? 'Failed to update ticket.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket updated by PM.',
    ticket_id: ticketId
  });

  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
}

export async function updateTicketStatusAction(ticketId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ status }).eq('id', ticketId);
  if (error) {
    throw new Error(error.message);
  }

  await supabase.from('ticket_events').insert({
    event_type: 'status_change',
    phase: status,
    summary: `Status changed to ${status}.`,
    ticket_id: ticketId
  });

  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
}

export async function reorderTicketsAction(
  orderedIds: string[],
  statusChange?: { ticketId: string; newStatus: string }
) {
  const supabase = await createClient();

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
    const { error } = await supabase
      .from('tickets')
      .update({ status: statusChange.newStatus })
      .eq('id', statusChange.ticketId);
    if (error) {
      throw new Error(error.message);
    }

    await supabase.from('ticket_events').insert({
      event_type: 'status_change',
      phase: statusChange.newStatus,
      summary: `Status changed to ${statusChange.newStatus}.`,
      ticket_id: statusChange.ticketId
    });
  }

  revalidatePath('/tickets');
}
