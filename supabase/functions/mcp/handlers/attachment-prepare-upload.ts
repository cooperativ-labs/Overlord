// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import {
  buildAttachmentSignedUploadUrl,
  buildObjectiveAttachmentStoragePath,
  resolveAttachmentAccess
} from './_attachments.ts';

export async function handleAttachmentPrepareUpload(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    objectiveId,
    fileName,
    label,
    contentType = 'application/octet-stream',
    fileSize,
    metadata = {}
  } = args;

  if (!sessionKey || !ticketId || !objectiveId || !fileName) {
    return toolErr('sessionKey, ticketId, objectiveId, and fileName are required.');
  }

  const access = await resolveAttachmentAccess(
    supabase,
    { sessionKey, ticketId, objectiveId, requireWrite: true },
    ctx
  );
  if (access.error || !access.ticket) return toolErr(access.error ?? 'Access denied.');

  const storagePath = buildObjectiveAttachmentStoragePath(
    access.ticket,
    String(objectiveId),
    String(fileName)
  );
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
      url: buildAttachmentSignedUploadUrl(storagePath, data.token)
    },
    draft: {
      contentType,
      fileSize: fileSize ?? null,
      label: (String(label ?? fileName).trim() || String(fileName)).slice(0, 160),
      metadata,
      objectiveId,
      storagePath,
      ticketId
    }
  });
}
