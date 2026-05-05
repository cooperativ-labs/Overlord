// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { ensureObjectiveAttachmentStoragePath, resolveAttachmentAccess } from './_attachments.ts';

export async function handleAttachmentGetDownloadUrl(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    objectiveId: inputObjectiveId,
    attachmentId,
    storagePath: inputStoragePath,
    expiresIn = 3600
  } = args;

  if (!sessionKey || !ticketId) {
    return toolErr('sessionKey and ticketId are required.');
  }

  let storagePath = inputStoragePath ? String(inputStoragePath) : null;
  let objectiveId = inputObjectiveId ? String(inputObjectiveId) : null;
  if (!storagePath && attachmentId) {
    const { data: attachment, error: attachmentError } = await supabase
      .from('objective_attachments')
      .select('storage_path, objective_id')
      .eq('id', attachmentId)
      .single();

    if (attachmentError || !attachment?.storage_path) {
      return toolErr('Attachment not found or has no storage path.');
    }
    storagePath = attachment.storage_path;
    objectiveId = attachment.objective_id;
  }

  if (!storagePath) return toolErr('attachmentId or storagePath is required.');
  if (!objectiveId) return toolErr('objectiveId is required when using storagePath.');

  const access = await resolveAttachmentAccess(
    supabase,
    { sessionKey, ticketId, objectiveId, requireWrite: false },
    ctx
  );
  if (access.error || !access.ticket) return toolErr(access.error ?? 'Access denied.');

  if (!ensureObjectiveAttachmentStoragePath(storagePath, access.ticket, objectiveId)) {
    return toolErr('storagePath does not match ticket/objective path.');
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
