import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { ensureTicketStoragePath, resolveArtifactAccess } from '@/lib/overlord/protocol-artifacts';
import { artifactGetDownloadUrlSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, artifactGetDownloadUrlSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      artifactId,
      expiresIn,
      sessionKey,
      storagePath: inputStoragePath,
      ticketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    const access = await resolveArtifactAccess({
      organizationId,
      requireWrite: false,
      sessionKey,
      ticketId,
      userId
    });

    if (access.error || !access.ticket) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();

    let storagePath = inputStoragePath ?? null;
    if (!storagePath && artifactId) {
      const { data: artifact, error: artifactError } = await supabase
        .from('artifacts')
        .select('storage_path')
        .eq('id', artifactId)
        .eq('ticket_id', ticketId)
        .single();

      if (artifactError || !artifact?.storage_path) {
        return NextResponse.json(
          { error: 'Artifact not found or has no storage path.' },
          { status: 404 }
        );
      }
      storagePath = artifact.storage_path;
    }

    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath is required.' }, { status: 400 });
    }

    if (!ensureTicketStoragePath(storagePath, access.ticket)) {
      return NextResponse.json(
        { error: 'storagePath does not match ticket path.' },
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
