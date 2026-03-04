import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { ensureTicketStoragePath, resolveArtifactAccess } from '@/lib/overlord/protocol-artifacts';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { artifactFinalizeUploadSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, artifactFinalizeUploadSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      artifactType,
      contentType,
      fileSize,
      label,
      metadata,
      sessionKey,
      storagePath,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const access = await resolveArtifactAccess({
      organizationId,
      requireWrite: true,
      sessionKey,
      ticketId,
      userId
    });

    if (access.error || !access.ticket || !access.session) {
      return NextResponse.json({ error: access.error ?? 'Access denied.' }, { status: 403 });
    }

    if (!ensureTicketStoragePath(storagePath, access.ticket)) {
      return NextResponse.json(
        { error: 'storagePath does not match ticket path.' },
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

    const artifactMetadata = {
      ...metadata,
      fileName,
      size: fileSize ?? null,
      type: contentType
    };

    const { data: artifact, error: artifactError } = await supabase
      .from('artifacts')
      .insert({
        artifact_type: artifactType,
        label,
        metadata: artifactMetadata,
        session_id: access.session.id,
        storage_path: storagePath,
        ticket_id: ticketId,
        uploaded_by: userId
      })
      .select('id, artifact_type, label, storage_path, ticket_id, created_at, metadata')
      .single();

    if (artifactError || !artifact) {
      return NextResponse.json(
        { error: artifactError?.message ?? 'Failed to create artifact record.' },
        { status: 500 }
      );
    }

    await supabase.from('ticket_events').insert({
      event_type: 'artifact',
      payload: { artifact_id: artifact.id, storage_path: storagePath },
      phase: 'execute',
      session_id: access.session.id,
      summary: `Artifact uploaded: ${label}`,
      ticket_id: ticketId
    });

    return NextResponse.json({
      artifact,
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
