// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import {
  buildSignedUploadUrl,
  buildTicketStoragePath,
  resolveArtifactAccess
} from './_artifacts.ts';

export async function handleArtifactPrepareUpload(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    fileName,
    label,
    artifactType = 'document',
    contentType = 'application/octet-stream',
    fileSize,
    metadata = {}
  } = args;

  if (!sessionKey || !ticketId || !fileName) {
    return toolErr('sessionKey, ticketId, and fileName are required.');
  }

  const access = await resolveArtifactAccess(
    supabase,
    { sessionKey, ticketId, requireWrite: true },
    ctx
  );
  if (access.error || !access.ticket) return toolErr(access.error ?? 'Access denied.');

  const storagePath = buildTicketStoragePath(access.ticket, String(fileName));
  const { data, error } = await supabase.storage
    .from('artifacts')
    .createSignedUploadUrl(storagePath);

  if (error || !data?.token) {
    return toolErr(error?.message ?? 'Failed to create signed upload URL.');
  }

  return toolOk({
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
      label: (String(label ?? fileName).trim() || String(fileName)).slice(0, 160),
      metadata,
      storagePath,
      ticketId
    }
  });
}
