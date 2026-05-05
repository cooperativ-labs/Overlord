import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  ensureObjectiveAttachmentStoragePath,
  resolveAttachmentAccess
} from '@/lib/overlord/protocol-attachments';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { attachmentFinalizeUploadSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, attachmentFinalizeUploadSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      contentType,
      fileSize,
      label,
      metadata,
      objectiveId,
      sessionKey,
      storagePath,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const access = await resolveAttachmentAccess({
      organizationId,
      objectiveId,
      requireWrite: true,
      sessionKey,
      ticketId,
      userId
    });

    if (access.error || !access.ticket || !access.session) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    if (!ensureObjectiveAttachmentStoragePath(storagePath, access.ticket, objectiveId)) {
      return NextResponse.json(
        { error: 'storagePath does not match ticket/objective path.' },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();
    const fileName = storagePath.split('/').pop() ?? label;
    const objectPrefix = storagePath.split('/').slice(0, -1).join('/');
    const { data: listedObjects, error: listError } = await supabase.storage
      .from('artifacts')
      .list(objectPrefix, { limit: 100, search: fileName });

    if (listError || !(listedObjects ?? []).some(object => object.name === fileName)) {
      return NextResponse.json(
        { error: listError?.message ?? 'Uploaded object not found. Upload before finalize.' },
        { status: 400 }
      );
    }

    const attachmentMetadata = {
      ...metadata,
      fileName,
      size: fileSize ?? null,
      type: contentType
    };

    const { data: attachment, error: attachmentError } = await supabase
      .from('objective_attachments')
      .insert({
        content_type: contentType,
        created_by: userId,
        file_size: fileSize ?? 0,
        label,
        metadata: attachmentMetadata,
        objective_id: objectiveId,
        session_id: access.session.id,
        storage_path: storagePath,
        ticket_id: ticketId
      })
      .select(
        'id, ticket_id, objective_id, label, storage_path, content_type, file_size, created_at, metadata'
      )
      .single();

    if (attachmentError || !attachment) {
      return NextResponse.json(
        { error: attachmentError?.message ?? 'Failed to create attachment record.' },
        { status: 500 }
      );
    }

    await supabase.from('ticket_events').insert({
      event_type: 'artifact',
      payload: {
        attachment_id: attachment.id,
        objective_id: objectiveId,
        storage_path: storagePath
      },
      phase: 'execute',
      session_id: access.session.id,
      summary: `Objective attachment uploaded: ${label}`,
      ticket_id: ticketId,
      created_by: userId
    });

    return NextResponse.json({
      attachment,
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
