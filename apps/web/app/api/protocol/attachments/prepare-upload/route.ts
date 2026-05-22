import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  buildAttachmentSignedUploadUrl,
  buildObjectiveAttachmentStoragePath,
  resolveAttachmentAccess
} from '@/lib/overlord/protocol-attachments';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { attachmentPrepareUploadSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, attachmentPrepareUploadSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      contentType,
      fileName,
      fileSize,
      label,
      metadata,
      objectiveId,
      sessionKey,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = rawTicketId ? await resolveTicketId(rawTicketId, organizationId) : undefined;
    if (rawTicketId && !ticketId) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const access = await resolveAttachmentAccess({
      organizationId,
      objectiveId,
      requireWrite: true,
      sessionKey,
      ticketId: ticketId ?? undefined,
      userId
    });

    if (access.error || !access.ticket) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    const storagePath = buildObjectiveAttachmentStoragePath(access.ticket, objectiveId, fileName);
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.storage
      .from('artifacts')
      .createSignedUploadUrl(storagePath);
    if (error || !data?.token) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to create signed upload URL.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      upload: {
        method: 'PUT',
        token: data.token,
        url: buildAttachmentSignedUploadUrl(storagePath, data.token)
      },
      draft: {
        contentType,
        fileSize: fileSize ?? null,
        label: (label?.trim() || fileName).slice(0, 160),
        metadata,
        objectiveId,
        storagePath,
        ticketId: access.ticket.id
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
