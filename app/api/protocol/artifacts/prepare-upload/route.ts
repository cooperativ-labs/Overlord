import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  buildSignedUploadUrl,
  buildTicketStoragePath,
  resolveArtifactAccess
} from '@/lib/overlord/protocol-artifacts';
import { artifactPrepareUploadSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, artifactPrepareUploadSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { artifactType, contentType, fileName, fileSize, label, metadata, sessionKey, ticketId } =
      parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    const access = await resolveArtifactAccess({
      organizationId,
      requireWrite: true,
      sessionKey,
      ticketId,
      userId
    });

    if (access.error || !access.ticket) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    const storagePath = buildTicketStoragePath(access.ticket, fileName);
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
        url: buildSignedUploadUrl(storagePath, data.token)
      },
      draft: {
        artifactType,
        contentType,
        fileSize: fileSize ?? null,
        label: (label?.trim() || fileName).slice(0, 160),
        metadata,
        storagePath,
        ticketId
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
