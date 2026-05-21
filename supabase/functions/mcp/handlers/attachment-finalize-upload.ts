// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { ensureObjectiveAttachmentStoragePath, resolveAttachmentAccess } from './_attachments.ts';

export async function handleAttachmentFinalizeUpload(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId,
    objectiveId,
    storagePath,
    label,
    contentType = 'application/octet-stream',
    fileSize,
    metadata = {}
  } = args;

  if (!sessionKey || !ticketId || !objectiveId || !storagePath || !label) {
    return toolErr('sessionKey, ticketId, objectiveId, storagePath, and label are required.');
  }

  const access = await resolveAttachmentAccess(
    supabase,
    { sessionKey, ticketId, objectiveId, requireWrite: true },
    ctx
  );
  if (access.error || !access.ticket || !access.session) {
    return toolErr(access.error ?? 'Access denied.');
  }

  if (
    !ensureObjectiveAttachmentStoragePath(String(storagePath), access.ticket, String(objectiveId))
  ) {
    return toolErr('storagePath does not match ticket/objective path.');
  }

  const fileName = String(storagePath).split('/').pop() ?? String(label);
  const objectPrefix = String(storagePath).split('/').slice(0, -1).join('/');
  const { data: listedObjects, error: listError } = await supabase.storage
    .from('artifacts')
    .list(objectPrefix, { limit: 100, search: fileName });

  if (listError || !(listedObjects ?? []).some(object => object.name === fileName)) {
    return toolErr(listError?.message ?? 'Uploaded object not found. Upload before finalize.');
  }

  const attachmentMetadata = {
    ...(metadata ?? {}),
    fileName,
    size: fileSize ?? null,
    type: contentType
  };

  const { data: attachment, error: attachmentError } = await supabase
    .from('objective_attachments')
    .insert({
      content_type: contentType,
      created_by: ctx.userId,
      file_size: fileSize ?? 0,
      label,
      metadata: attachmentMetadata,
      objective_id: objectiveId,
      storage_path: storagePath,
      ticket_id: access.ticket.id
    })
    .select(
      'id, ticket_id, objective_id, label, storage_path, content_type, file_size, created_at, metadata'
    )
    .single();

  if (attachmentError || !attachment) {
    return toolErr(attachmentError?.message ?? 'Failed to create attachment record.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    payload: {
      attachment_id: attachment.id,
      objective_id: objectiveId,
      storage_path: storagePath
    },
    phase: 'execute',
    objective_id: objectiveId,
    summary: `Objective attachment uploaded: ${label}`,
    ticket_id: access.ticket.id,
    created_by: ctx.userId
  });

  return toolOk({ attachment, ok: true });
}
