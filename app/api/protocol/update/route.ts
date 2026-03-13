import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  buildAgentNotificationSummary,
  extractAgentNotifications
} from '@/lib/overlord/agent-notifications';
import {
  insertChangeRationales,
  resolveTicketProjectContext
} from '@/lib/overlord/change-rationales';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { updateSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      changeRationales,
      eventType,
      externalUrl,
      payload,
      phase,
      sessionKey,
      summary,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const typedSupabase = supabase as SupabaseClient<Database>;
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { data: event, error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: eventType ?? 'update',
        payload,
        phase: phase ?? null,
        session_id: resolved.session.id,
        summary,
        ticket_id: ticketId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to create event.' },
        { status: 500 }
      );
    }

    if (Array.isArray(changeRationales) && changeRationales.length > 0) {
      const ticketContext = await resolveTicketProjectContext(typedSupabase, ticketId);
      if (!ticketContext) {
        return NextResponse.json(
          { error: 'Failed to resolve ticket project context.' },
          { status: 500 }
        );
      }

      const rationaleResult = await insertChangeRationales({
        changeRationales,
        eventId: event.id,
        organizationId: ticketContext.organization_id,
        projectId: ticketContext.project_id,
        sessionId: resolved.session.id,
        supabase: typedSupabase,
        ticketId
      });

      if (rationaleResult.error) {
        console.error('[protocol:update] change rationale insert error:', rationaleResult.error);
        Sentry.captureException(new Error(rationaleResult.error), {
          extra: { ticketId, sessionId: resolved.session.id, eventId: event.id }
        });
        // Non-fatal: continue with update even if rationale insertion fails
      }
    }

    if (externalUrl !== undefined) {
      const { error: sessionUpdateError } = await supabase
        .from('agent_sessions')
        .update({ external_url: externalUrl })
        .eq('id', resolved.session.id);
      if (sessionUpdateError) {
        return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
      }
    }

    const notifications = extractAgentNotifications(payload);
    if (notifications.length > 0) {
      const { error: notificationsError } = await supabase.from('ticket_events').insert(
        notifications.map(notification => ({
          event_type: notification.kind === 'question' ? 'question' : 'alert',
          is_blocking: notification.kind === 'question' ? notification.isBlocking : false,
          payload: {
            entry_type: 'agent_notification',
            level: notification.level,
            kind: notification.kind,
            message: notification.message,
            metadata: notification.metadata,
            parent_event_id: event.id,
            title: notification.title ?? null
          },
          phase: phase ?? null,
          session_id: resolved.session.id,
          summary: buildAgentNotificationSummary(notification),
          ticket_id: ticketId
        }))
      );

      if (notificationsError) {
        return NextResponse.json({ error: notificationsError.message }, { status: 500 });
      }
    }

    if (phase) {
      const ticketUpdate: Record<string, unknown> = { status: phase };

      // If moving to a review-type status, place the ticket at the top of that column
      // and mark it unread so the review indicator appears for the user.
      const { data: statusInfo } = await supabase
        .from('ticket_statuses')
        .select('status_type')
        .eq('organization_id', organizationId)
        .eq('name', phase)
        .maybeSingle();

      if (statusInfo?.status_type === 'review') {
        const { data: headTickets } = await supabase
          .from('tickets')
          .select('board_position')
          .eq('organization_id', organizationId)
          .eq('status', phase)
          .neq('id', ticketId)
          .order('board_position', { ascending: true })
          .limit(1);
        ticketUpdate.board_position = (headTickets?.[0]?.board_position ?? 0) - 1;
        ticketUpdate.is_read = false;
      }

      const { error: ticketError } = await supabase
        .from('tickets')
        .update(ticketUpdate)
        .eq('id', ticketId);
      if (ticketError) {
        return NextResponse.json({ error: ticketError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
