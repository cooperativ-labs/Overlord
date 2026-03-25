'use server';

import { revalidatePath } from 'next/cache';

import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';
import { generateDateFromSchedule } from '@/lib/schedulingEngine';
import { type ScheduleInput, scheduleInputSchema } from '@/lib/schemas/schedule';
import { createClient } from '@/supabase/utils/server';

type ScheduleRow = {
  created_at: string;
  days_of_month: number[] | null;
  days_of_week: unknown;
  id: number;
  name: string | null;
  organization_id: number;
  period_interval: number;
  period_type: string;
  start_date: string | null;
  timezone: string;
  weeks_of_month: number[] | null;
};

function revalidateTicketSchedulingViews(input: {
  organizationId: number;
  projectId: string;
  ticketId: string;
}) {
  revalidatePath('/u');
  revalidatePath('/projects');
  revalidatePath(`/u/${input.ticketId}`);
  revalidatePath(
    buildProjectPath({ organizationId: input.organizationId, projectId: input.projectId })
  );
  revalidatePath(
    buildTicketPath({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ticketId: input.ticketId
    })
  );
}

function toScheduleInsertPayload(organizationId: number, schedule: ScheduleInput) {
  return {
    organization_id: organizationId,
    name: schedule.name?.trim() || null,
    period_type: schedule.periodType,
    period_interval: schedule.periodInterval,
    weeks_of_month: schedule.weeksOfMonth?.length ? schedule.weeksOfMonth : null,
    days_of_month: schedule.daysOfMonth?.length ? schedule.daysOfMonth : null,
    days_of_week: schedule.daysOfWeek?.length ? schedule.daysOfWeek : null,
    timezone: schedule.timezone,
    start_date:
      schedule.startDate instanceof Date
        ? schedule.startDate.toISOString()
        : (schedule.startDate ?? null)
  };
}

function toEngineSchedule(schedule: ScheduleRow) {
  return {
    name: schedule.name,
    periodType: schedule.period_type,
    periodInterval: schedule.period_interval,
    weeksOfMonth: schedule.weeks_of_month,
    daysOfMonth: schedule.days_of_month,
    daysOfWeek: Array.isArray(schedule.days_of_week) ? schedule.days_of_week : undefined,
    timezone: schedule.timezone,
    startDate: schedule.start_date
  };
}

export async function previewScheduledTicketDueDatetimeAction(
  input: ScheduleInput,
  itemDueDatetime?: string | null
) {
  const parsed = scheduleInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid schedule.');
  }

  const dueDatetime = generateDateFromSchedule({
    schedule: parsed.data,
    itemDueDatetime: itemDueDatetime ? new Date(itemDueDatetime) : undefined
  });

  return { dueDatetime: dueDatetime.toISOString() };
}

export async function getTicketScheduleAction(ticketId: string) {
  const supabase = await createClient();

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,organization_id,project_id,due_datetime,schedule_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  if (!ticket.schedule_id) {
    return {
      dueDatetime: ticket.due_datetime,
      schedule: null
    };
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedule')
    .select(
      'created_at,days_of_month,days_of_week,id,name,organization_id,period_interval,period_type,start_date,timezone,weeks_of_month'
    )
    .eq('id', ticket.schedule_id)
    .single();

  if (scheduleError || !schedule) {
    throw new Error(scheduleError?.message ?? 'Schedule not found.');
  }

  return {
    dueDatetime: ticket.due_datetime,
    schedule: {
      id: schedule.id,
      name: schedule.name,
      periodType: schedule.period_type,
      periodInterval: schedule.period_interval,
      weeksOfMonth: schedule.weeks_of_month,
      daysOfMonth: schedule.days_of_month,
      daysOfWeek: schedule.days_of_week,
      timezone: schedule.timezone,
      startDate: schedule.start_date,
      createdAt: schedule.created_at
    }
  };
}

export async function upsertTicketScheduleAction(ticketId: string, input: ScheduleInput) {
  const parsed = scheduleInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid schedule.');
  }

  const supabase = await createClient();
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,organization_id,project_id,due_datetime,schedule_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  const payload = toScheduleInsertPayload(ticket.organization_id, parsed.data);
  let scheduleId = ticket.schedule_id;

  if (scheduleId) {
    const { error: updateScheduleError } = await supabase
      .from('schedule')
      .update(payload)
      .eq('id', scheduleId);

    if (updateScheduleError) {
      throw new Error(updateScheduleError.message);
    }
  } else {
    const { data: schedule, error: insertScheduleError } = await supabase
      .from('schedule')
      .insert(payload)
      .select('id')
      .single();

    if (insertScheduleError || !schedule) {
      throw new Error(insertScheduleError?.message ?? 'Failed to create schedule.');
    }

    scheduleId = schedule.id;
  }

  const nextDueDatetime = generateDateFromSchedule({
    schedule: parsed.data,
    itemDueDatetime: ticket.due_datetime ? new Date(ticket.due_datetime) : undefined
  });

  const { error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({
      due_datetime: nextDueDatetime.toISOString(),
      schedule_id: scheduleId
    })
    .eq('id', ticketId);

  if (ticketUpdateError) {
    throw new Error(ticketUpdateError.message);
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket schedule updated.',
    payload: {
      dueDatetime: nextDueDatetime.toISOString(),
      scheduleId
    },
    ticket_id: ticketId
  });

  revalidateTicketSchedulingViews({
    organizationId: ticket.organization_id,
    projectId: ticket.project_id,
    ticketId
  });

  return {
    dueDatetime: nextDueDatetime.toISOString(),
    scheduleId
  };
}

export async function clearTicketScheduleAction(ticketId: string) {
  const supabase = await createClient();
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,organization_id,project_id,schedule_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  const { error: updateError } = await supabase
    .from('tickets')
    .update({
      due_datetime: null,
      schedule_id: null
    })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (ticket.schedule_id) {
    const { count, error: countError } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', ticket.schedule_id);

    if (countError) {
      throw new Error(countError.message);
    }

    if ((count ?? 0) === 0) {
      const { error: deleteError } = await supabase
        .from('schedule')
        .delete()
        .eq('id', ticket.schedule_id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket schedule cleared.',
    ticket_id: ticketId
  });

  revalidateTicketSchedulingViews({
    organizationId: ticket.organization_id,
    projectId: ticket.project_id,
    ticketId
  });
}

export async function getNextScheduledDueDatetimeForTicketAction(ticketId: string) {
  const supabase = await createClient();
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,due_datetime,schedule_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  if (!ticket.schedule_id) {
    return { dueDatetime: null };
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedule')
    .select(
      'created_at,days_of_month,days_of_week,id,name,organization_id,period_interval,period_type,start_date,timezone,weeks_of_month'
    )
    .eq('id', ticket.schedule_id)
    .single();

  if (scheduleError || !schedule) {
    throw new Error(scheduleError?.message ?? 'Schedule not found.');
  }

  const dueDatetime = generateDateFromSchedule({
    schedule: toEngineSchedule(schedule),
    itemDueDatetime: ticket.due_datetime ? new Date(ticket.due_datetime) : undefined
  });

  return { dueDatetime: dueDatetime.toISOString() };
}
