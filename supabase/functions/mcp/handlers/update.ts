// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales, resolveTicketProjectContext } from './_change-rationales.ts';

export async function handleUpdate(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    phase,
    externalSessionId,
    externalUrl,
    payload = {},
    changeRationales = []
  } = args;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
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

  if (Array.isArray(changeRationales) && changeRationales.length > 0) {
    const ticketContext = await resolveTicketProjectContext(supabase, ticketId);
    if (!ticketContext) return toolErr('Failed to resolve ticket project context.');

    const rationaleResult = await insertChangeRationales(supabase, {
      changeRationales,
      eventId: event.id,
      organizationId: ticketContext.organization_id,
      projectId: ticketContext.project_id,
      sessionId: resolved.session.id,
      ticketId
    });
    if (rationaleResult.error) return toolErr(rationaleResult.error);
  }

  if (externalUrl !== undefined || externalSessionId !== undefined) {
    const sessionUpdate: Record<string, string | null> = {};
    if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
    if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

    const { error: sessionErr } = await supabase
      .from('agent_sessions')
      .update(sessionUpdate)
      .eq('id', resolved.session.id);
    if (sessionErr) return toolErr(sessionErr.message);
  }

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
