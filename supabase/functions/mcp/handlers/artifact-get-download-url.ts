// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { ensureTicketStoragePath, resolveArtifactAccess } from './_artifacts.ts';

export async function handleArtifactGetDownloadUrl(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    artifactId,
    storagePath: inputStoragePath,
    expiresIn = 3600
  } = args;

  if (!sessionKey || !ticketId) {
    return toolErr('sessionKey and ticketId are required.');
  }

  const access = await resolveArtifactAccess(
    supabase,
    { sessionKey, ticketId, requireWrite: false },
    ctx
  );
  if (access.error || !access.ticket) return toolErr(access.error ?? 'Access denied.');

  let storagePath = inputStoragePath ? String(inputStoragePath) : null;
  if (!storagePath && artifactId) {
    const { data: artifact, error: artifactError } = await supabase
      .from('artifacts')
      .select('storage_path')
      .eq('id', artifactId)
      .eq('ticket_id', ticketId)
      .single();

    if (artifactError || !artifact?.storage_path) {
      return toolErr('Artifact not found or has no storage path.');
    }
    storagePath = artifact.storage_path;
  }

  if (!storagePath) {
    return toolErr('artifactId or storagePath is required.');
  }

  if (!ensureTicketStoragePath(storagePath, access.ticket)) {
    return toolErr('storagePath does not match ticket path.');
  }

  const seconds = Number.isFinite(Number(expiresIn))
    ? Math.max(60, Math.min(86400, Number(expiresIn)))
    : 3600;

  const { data, error } = await supabase.storage
    .from('artifacts')
    .createSignedUrl(storagePath, seconds);
  if (error || !data?.signedUrl) {
    return toolErr(error?.message ?? 'Failed to create signed download URL.');
  }

  return toolOk({
    expiresIn: seconds,
    ok: true,
    signedUrl: data.signedUrl,
    storagePath
  });
}
