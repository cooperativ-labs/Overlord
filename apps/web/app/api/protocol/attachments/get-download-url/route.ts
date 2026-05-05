import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  ensureObjectiveAttachmentStoragePath,
  resolveAttachmentAccess
} from '@/lib/overlord/protocol-attachments';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { attachmentGetDownloadUrlSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, attachmentGetDownloadUrlSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      attachmentId,
      expiresIn,
      objectiveId: inputObjectiveId,
      sessionKey,
      storagePath: inputStoragePath,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();

    let storagePath = inputStoragePath ?? null;
    let objectiveId = inputObjectiveId ?? null;
    if (!storagePath && attachmentId) {
      const { data: attachment, error: attachmentError } = await supabase
        .from('objective_attachments')
        .select('storage_path, objective_id')
        .eq('id', attachmentId)
        .eq('ticket_id', ticketId)
        .single();

      if (attachmentError || !attachment?.storage_path) {
        return NextResponse.json(
          { error: 'Attachment not found or has no storage path.' },
          { status: 404 }
        );
      }
      storagePath = attachment.storage_path;
      objectiveId = attachment.objective_id;
    }

    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath is required.' }, { status: 400 });
    }
    if (!objectiveId) {
      return NextResponse.json(
        { error: 'objectiveId is required when using storagePath.' },
        { status: 400 }
      );
    }

    const access = await resolveAttachmentAccess({
      organizationId,
      objectiveId,
      requireWrite: false,
      sessionKey,
      ticketId,
      userId
    });

    if (access.error || !access.ticket) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    if (!ensureObjectiveAttachmentStoragePath(storagePath, access.ticket, objectiveId)) {
      return NextResponse.json(
        { error: 'storagePath does not match ticket/objective path.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.storage
      .from('artifacts')
      .createSignedUrl(storagePath, expiresIn);
    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to create signed download URL.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      expiresIn,
      ok: true,
      signedUrl: data.signedUrl,
      storagePath
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
