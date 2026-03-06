// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleUpdate(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId: rawTicketId, summary, phase, payload = {} } = args;
  const resolved = await resolveSession(supabase, sessionKey, rawTicketId, ctx.organizationId);
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  const { data: event, error: eventErr } = await supabase
    .from('ticket_events')
    .insert({
      event_type: 'update',
      payload,
      phase: phase ?? null,
      session_id: resolved.session.id,
      summary,
      ticket_id: ticketId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to create event.');

  // Fan out notifications if provided
  const notifications: any[] = Array.isArray(payload?.notifications) ? payload.notifications : [];
  if (notifications.length > 0) {
    await supabase.from('ticket_events').insert(
      notifications.map((n: any) => ({
        event_type: n.kind === 'question' ? 'question' : 'alert',
        is_blocking: n.kind === 'question' ? (n.isBlocking ?? n.blocking ?? false) : false,
        payload: {
          entry_type: 'agent_notification',
          level: n.level,
          kind: n.kind,
          message: n.message,
          metadata: n.metadata,
          parent_event_id: event.id,
          title: n.title ?? null
        },
        phase: phase ?? null,
        session_id: resolved.session.id,
        summary: n.title ?? n.message ?? 'Agent notification.',
        ticket_id: ticketId
      }))
    );
  }

  if (phase) {
    const ticketUpdate: Record<string, unknown> = { status: phase };

    // If moving to a review-type status, place the ticket at the top of that column
    const { data: statusInfo } = await supabase
      .from('ticket_statuses')
      .select('status_type')
      .eq('organization_id', ctx.organizationId)
      .eq('name', phase)
      .maybeSingle();

    if ((statusInfo as { status_type: string } | null)?.status_type === 'review') {
      const { data: headTickets } = await supabase
        .from('tickets')
        .select('board_position')
        .eq('organization_id', ctx.organizationId)
        .eq('status', phase)
        .neq('id', ticketId)
        .order('board_position', { ascending: true })
        .limit(1);
      ticketUpdate.board_position =
        ((headTickets as { board_position: number }[] | null)?.[0]?.board_position ?? 0) - 1;
    }

    await supabase.from('tickets').update(ticketUpdate).eq('id', ticketId);
  }

  return toolOk({ ok: true });
}
