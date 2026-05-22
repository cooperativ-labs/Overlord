import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveTicketIdFromObjective } from '@/lib/overlord/protocol-attachments';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { attachmentListSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, attachmentListSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { sessionKey, ticketId: rawTicketId, objectiveId } = parsed.data;
    const { organizationId } = parsed.tokenContext;

    let ticketId: string | null = null;
    if (rawTicketId) {
      ticketId = await resolveTicketId(rawTicketId, organizationId);
    } else if (objectiveId) {
      ticketId = await resolveTicketIdFromObjective(objectiveId, organizationId);
    }
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error ?? 'Session not found.' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    let query = supabase
      .from('objective_attachments')
      .select('id, label, content_type, file_size, objective_id, storage_path, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false });

    if (objectiveId) {
      query = query.eq('objective_id', objectiveId);
    }

    const { data: attachments, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: error.message ?? 'Failed to list attachments.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      attachments: attachments ?? []
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
