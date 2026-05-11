import { after, NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import {
  resolveAgentToken,
  resolveProtocolOrganizationHintForTicketId
} from '@/lib/overlord/protocol-auth';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { sendPushNotification } from '@/lib/overlord/push-notifications';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

/**
 * POST /api/protocol/permission-request?ticketId=<uuid>
 *
 * Called by the Claude Code PermissionRequest hook when an agent requests permission
 * to use a tool. Creates a blocking question ticket_event so the Overlord UI
 * (KanbanBoard) can notify the user via toast, sound, and status dot.
 *
 * The endpoint returns quickly so Claude can continue showing its permission prompt.
 * The hook should exit 0 after calling this — Claude will handle the permission dialog
 * as normal; Overlord only adds an additional UI notification.
 *
 * Expected body (Claude hook JSON piped from stdin):
 *   { tool_name?: string, tool_input?: object, session_id?: string, ... }
 *
 * Auth: Bearer <OAuth access token>.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTicketId = searchParams.get('ticketId');
  const organizationHint =
    rawTicketId && rawTicketId.trim().length > 0
      ? await resolveProtocolOrganizationHintForTicketId({ ticketId: rawTicketId.trim() })
      : null;
  const authResult = await resolveAgentToken(request, organizationHint);
  if (authResult.error) return authResult.error;

  const { organizationId, userId } = authResult.context;

  try {
    if (!rawTicketId) {
      return NextResponse.json({ error: 'ticketId query parameter is required.' }, { status: 400 });
    }
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    let hookPayload: Record<string, unknown> = {};
    try {
      hookPayload = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body may be empty or non-JSON when stdin wasn't captured — treat as empty
    }

    const supabase = createServiceRoleClient();

    // Verify the ticket belongs to this org
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id,ticket_id')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    // Find the latest agent session for this ticket (no sessionKey needed here)
    const { data: session } = await supabase
      .from('agent_sessions')
      .select('id')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const toolName = typeof hookPayload.tool_name === 'string' ? hookPayload.tool_name.trim() : '';
    const summary = toolName
      ? `Agent requesting permission to use ${toolName}`
      : 'Agent requesting permission for a tool action';

    await supabase.from('ticket_events').insert({
      event_type: 'question',
      is_blocking: true,
      payload: hookPayload,
      phase: null,
      session_id: session?.id ?? null,
      summary,
      ticket_id: ticketId,
      created_by: userId
    });

    after(async () => {
      await sendPushNotification(supabase, {
        title: `Agent Question (${getTicketIdentifier(ticket ?? ticketId)})`,
        body: summary,
        organizationId,
        data: { ticketId, eventType: 'question' }
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
