import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  buildAgentNotificationSummary,
  extractAgentNotifications
} from '@/lib/overlord/agent-notifications';
import { resolveSession } from '@/lib/overlord/protocol-db';
import { updateSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { payload, phase, sessionKey, summary, ticketId } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { data: event, error: eventError } = await supabase
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
    if (eventError || !event) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
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
      const { error: ticketError } = await supabase
        .from('tickets')
        .update({ status: phase })
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
