import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  buildAgentNotificationSummary,
  extractAgentNotifications
} from '@/lib/overlord/agent-notifications';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { updateSchema } from '@/lib/overlord/validation';
import {
  resolvePreferredStatusNameByType,
  resolveStatusNameForPhase,
  resolveStatusTypeForName
} from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      changeRationales,
      eventType,
      externalSessionId,
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

    // Detect when an agent continues working on a ticket that was already delivered.
    // This typically happens when a user sends a follow-up to a still-running agent.
    // Auto-transition the ticket back to execute and reactivate the session.
    const { data: currentTicket } = await supabase
      .from('tickets')
      .select('status')
      .eq('id', ticketId)
      .single();

    const currentStatusType = currentTicket
      ? await resolveStatusTypeForName(supabase, organizationId, currentTicket.status)
      : null;
    const isResumeAfterDelivery =
      currentStatusType === 'review' || currentStatusType === 'complete';

    if (isResumeAfterDelivery) {
      const executeStatusName = await resolvePreferredStatusNameByType(
        supabase,
        organizationId,
        'execute'
      );
      await Promise.all([
        supabase.from('tickets').update({ status: executeStatusName }).eq('id', ticketId),
        supabase
          .from('agent_sessions')
          .update({ session_state: 'active', detached_at: null })
          .eq('id', resolved.session.id),
        supabase.from('ticket_events').insert({
          event_type: 'ticket_reopened',
          phase: 'execute',
          session_id: resolved.session.id,
          summary: 'Ticket resumed — agent continued working after delivery.',
          ticket_id: ticketId
        }),
        // Reactivate only the most recently completed objective back to executing.
        // PostgREST ignores .order()/.limit() on UPDATE, so we first fetch the ID
        // of the latest complete objective and then update by primary key.
        supabase
          .from('objectives')
          .select('id')
          .eq('ticket_id', ticketId)
          .eq('state', 'complete')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
          .then(({ data: latestObjective }) => {
            if (latestObjective?.id) {
              return supabase
                .from('objectives')
                .update({ state: 'executing' })
                .eq('id', latestObjective.id);
            }
          })
      ]);
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
      const rationaleResult = await insertFileChanges({
        changeRationales,
        eventId: event.id,
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

    if (externalUrl !== undefined || externalSessionId !== undefined) {
      const sessionUpdate: Record<string, string | null> = {};
      if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
      if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

      const { error: sessionUpdateError } = await supabase
        .from('agent_sessions')
        .update(sessionUpdate)
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
      const targetStatusName = await resolveStatusNameForPhase(supabase, organizationId, phase);
      const ticketUpdate: Record<string, unknown> = { status: targetStatusName };

      // If moving to a review-type status, place the ticket at the top of that column
      // and mark it unread so the review indicator appears for the user.
      const statusType = await resolveStatusTypeForName(supabase, organizationId, targetStatusName);

      if (statusType === 'review') {
        const { data: headTickets } = await supabase
          .from('tickets')
          .select('board_position')
          .eq('organization_id', organizationId)
          .eq('status', targetStatusName)
          .neq('id', ticketId)
          .order('board_position', { ascending: true })
          .limit(1);
        ticketUpdate.board_position = (headTickets?.[0]?.board_position ?? 0) - 1;
        ticketUpdate.is_read = false;

        // Generate feed post for review transitions (fire-and-forget)
        const reviewSessionId = resolved.session.id;
        after(async () => {
          try {
            await supabase.functions.invoke('generate-feed-post', {
              body: { ticketId, sessionId: reviewSessionId, organizationId }
            });
          } catch (feedErr) {
            console.error('[protocol:update] feed post generation error:', feedErr);
            Sentry.captureException(feedErr, { extra: { ticketId, sessionId: reviewSessionId } });
          }
        });
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
