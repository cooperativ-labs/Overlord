// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { ensureTicketStoragePath, resolveArtifactAccess } from './_artifacts.ts';

export async function handleArtifactFinalizeUpload(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    storagePath,
    label,
    artifactType = 'document',
    contentType = 'application/octet-stream',
    fileSize,
    metadata = {}
  } = args;

  if (!sessionKey || !ticketId || !storagePath || !label) {
    return toolErr('sessionKey, ticketId, storagePath, and label are required.');
  }

  const access = await resolveArtifactAccess(
    supabase,
    { sessionKey, ticketId, requireWrite: true },
    ctx
  );
  if (access.error || !access.ticket || !access.session) {
    return toolErr(access.error ?? 'Access denied.');
  }

  if (!ensureTicketStoragePath(String(storagePath), access.ticket)) {
    return toolErr('storagePath does not match ticket path.');
  }

  const fileName = String(storagePath).split('/').pop() ?? String(label);
  const objectPrefix = String(storagePath).split('/').slice(0, -1).join('/');
  const { data: listedObjects, error: listError } = await supabase.storage
    .from('artifacts')
    .list(objectPrefix, { limit: 100, search: fileName });

  if (listError || !(listedObjects ?? []).some(object => object.name === fileName)) {
    return toolErr(listError?.message ?? 'Uploaded object not found. Upload before finalize.');
  }

  const artifactMetadata = {
    ...(metadata ?? {}),
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
      uploaded_by: ctx.userId
    })
    .select('id, artifact_type, label, storage_path, ticket_id, created_at, metadata')
    .single();

  if (artifactError || !artifact) {
    return toolErr(artifactError?.message ?? 'Failed to create artifact record.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    payload: { artifact_id: artifact.id, storage_path: storagePath },
    phase: 'execute',
    session_id: access.session.id,
    summary: `Artifact uploaded: ${label}`,
    ticket_id: ticketId
  });

  return toolOk({ artifact, ok: true });
}
