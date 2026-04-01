import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ticketStatuses } from '@/lib/overlord/types';
import {
  resolvePreferredStatusNameByType,
  resolveStatusNameForPhase,
  resolveStatusTypeForName
} from '@/lib/ticket-statuses';
import { createClient } from '@/supabase/utils/server';

const createConversationEntrySchema = z
  .object({
    entryType: z.enum(['answer', 'follow_up']).default('follow_up'),
    message: z.string().min(1).max(20_000),
    parentEventId: z.string().uuid().optional(),
    phase: z.enum(ticketStatuses).optional()
  })
  .superRefine((value, ctx) => {
    if (value.entryType === 'follow_up' && value.parentEventId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parentEventId can only be set for answers.',
        path: ['parentEventId']
      });
    }
  });

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { ticketId } = await params;
    const parsedBody = createConversationEntrySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? 'Invalid payload.' },
        { status: 400 }
      );
    }

    const { entryType, message, parentEventId, phase } = parsedBody.data;
    const supabase = await createClient();

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id,status,organization_id')
      .eq('id', ticketId)
      .single();
    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: ticketError?.message ?? 'Ticket not found.' },
        { status: ticketError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    if (parentEventId) {
      const { data: parentEvent, error: parentEventError } = await supabase
        .from('ticket_events')
        .select('id,event_type,ticket_id')
        .eq('id', parentEventId)
        .eq('ticket_id', ticketId)
        .single();

      if (parentEventError || !parentEvent) {
        return NextResponse.json(
          { error: parentEventError?.message ?? 'Referenced question not found.' },
          { status: 404 }
        );
      }
      if (parentEvent.event_type !== 'question') {
        return NextResponse.json({ error: 'Parent event must be a question.' }, { status: 400 });
      }
    }

    const { data: latestSession } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('ticket_id', ticketId)
      .order('attached_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = {
      entry_type: entryType,
      parent_event_id: parentEventId ?? null,
      source: 'user',
      message_verbatim: message
    };
    const eventType = entryType === 'follow_up' ? 'user_follow_up' : 'answer';

    const { data: event, error: insertError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: eventType,
        is_blocking: false,
        payload,
        phase: phase ?? null,
        session_id: latestSession?.id ?? null,
        summary: message,
        ticket_id: ticketId
      })
      .select('*')
      .single();

    if (insertError || !event) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to persist conversation entry.' },
        { status: 500 }
      );
    }

    const currentStatusType = await resolveStatusTypeForName(
      supabase,
      ticket.organization_id,
      ticket.status
    );
    const shouldMoveToExecute =
      entryType === 'answer' &&
      parentEventId &&
      !phase &&
      (currentStatusType === 'review' || ticket.status === 'blocked');

    if (phase || shouldMoveToExecute) {
      const nextStatusName = phase
        ? await resolveStatusNameForPhase(supabase, ticket.organization_id, phase)
        : await resolvePreferredStatusNameByType(supabase, ticket.organization_id, 'execute');
      const { error: statusError } = await supabase
        .from('tickets')
        .update({ status: nextStatusName })
        .eq('id', ticketId);
      if (statusError) {
        return NextResponse.json({ error: statusError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ event, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
