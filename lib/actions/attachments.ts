'use server';

import { revalidatePath } from 'next/cache';

import { buildTicketPath } from '@/lib/helpers/ticket-path';
import {
  buildObjectiveAttachmentStoragePath,
  ensureObjectiveAttachmentStoragePath
} from '@/lib/overlord/protocol-attachments';
import { createClientForRequest } from '@/supabase/utils/server';

// ---------------------------------------------------------------------------
// Objective attachments
// ---------------------------------------------------------------------------

export type ObjectiveAttachment = {
  id: string;
  objectiveId: string;
  label: string;
  storagePath: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
};

export type ObjectiveAttachmentUploadDraft = {
  contentType: string;
  fileSize: number;
  label: string;
  storagePath: string;
  token: string;
};

async function getTicketAndObjectiveForAttachment(
  ticketId: string,
  objectiveId: string,
  supabase: Awaited<ReturnType<typeof createClientForRequest>>
) {
  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id, ticket_id, ticket:tickets(id, project_id, organization_id)')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .single();

  const ticket = Array.isArray(objective?.ticket) ? objective?.ticket[0] : objective?.ticket;

  if (objectiveError || !objective || !ticket) {
    throw new Error('Objective not found.');
  }

  return {
    objective: { id: objective.id, ticket_id: objective.ticket_id },
    ticket
  };
}

export async function prepareObjectiveAttachmentUploadAction(
  ticketId: string,
  objectiveId: string,
  input: {
    fileName: string;
    fileSize: number;
    contentType: string;
  }
): Promise<ObjectiveAttachmentUploadDraft> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error('File name is required.');
  }

  if (!Number.isFinite(input.fileSize) || input.fileSize < 0) {
    throw new Error('File size is required.');
  }

  const supabase = await createClientForRequest();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { ticket } = await getTicketAndObjectiveForAttachment(ticketId, objectiveId, supabase);
  const storagePath = buildObjectiveAttachmentStoragePath(ticket, objectiveId, fileName);

  const { data: upload, error: uploadError } = await supabase.storage
    .from('artifacts')
    .createSignedUploadUrl(storagePath);

  if (uploadError || !upload?.token) {
    throw new Error(uploadError?.message ?? 'Failed to prepare file upload.');
  }

  return {
    contentType: input.contentType,
    fileSize: input.fileSize,
    label: fileName,
    storagePath,
    token: upload.token
  };
}

export async function finalizeObjectiveAttachmentUploadAction(
  ticketId: string,
  objectiveId: string,
  draft: Omit<ObjectiveAttachmentUploadDraft, 'token'>
): Promise<ObjectiveAttachment> {
  const supabase = await createClientForRequest();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { ticket } = await getTicketAndObjectiveForAttachment(ticketId, objectiveId, supabase);

  if (!ensureObjectiveAttachmentStoragePath(draft.storagePath, ticket, objectiveId)) {
    throw new Error('Upload path does not match the ticket objective.');
  }

  const fileName = draft.storagePath.split('/').pop() ?? draft.label;
  const objectPrefix = draft.storagePath.split('/').slice(0, -1).join('/');
  const { data: listedObjects, error: listError } = await supabase.storage
    .from('artifacts')
    .list(objectPrefix, { limit: 100, search: fileName });

  if (listError || !(listedObjects ?? []).some(object => object.name === fileName)) {
    throw new Error(listError?.message ?? 'Uploaded file was not found.');
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from('objective_attachments')
    .insert({
      content_type: draft.contentType,
      created_by: user.id,
      file_size: draft.fileSize,
      label: draft.label,
      metadata: {
        size: draft.fileSize,
        type: draft.contentType,
        fileName: draft.label
      },
      objective_id: objectiveId,
      storage_path: draft.storagePath,
      ticket_id: ticketId
    })
    .select('id, objective_id, label, storage_path, content_type, file_size, created_at')
    .single();

  if (attachmentError || !attachment) {
    throw new Error(attachmentError?.message ?? 'Failed to create attachment record.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    summary: `Objective attachment uploaded: ${draft.label}`,
    ticket_id: ticketId,
    created_by: user.id,
    payload: { attachmentId: attachment.id, objectiveId }
  });

  revalidatePath(
    buildTicketPath({
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    })
  );

  return {
    id: attachment.id,
    objectiveId: attachment.objective_id,
    label: attachment.label,
    storagePath: attachment.storage_path,
    contentType: attachment.content_type,
    fileSize: Number(attachment.file_size),
    createdAt: attachment.created_at
  };
}

export async function listObjectiveAttachmentsAction(
  ticketId: string
): Promise<ObjectiveAttachment[]> {
  const supabase = await createClientForRequest();

  const { data: attachments, error } = await supabase
    .from('objective_attachments')
    .select('id, objective_id, label, storage_path, content_type, file_size, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message ?? 'Failed to list objective attachments.');
  }

  return (attachments ?? []).map(attachment => ({
    id: attachment.id,
    objectiveId: attachment.objective_id,
    label: attachment.label,
    storagePath: attachment.storage_path,
    contentType: attachment.content_type,
    fileSize: Number(attachment.file_size),
    createdAt: attachment.created_at
  }));
}

export async function deleteObjectiveAttachmentAction(
  ticketId: string,
  objectiveId: string,
  attachmentId: string
): Promise<void> {
  const supabase = await createClientForRequest();

  const { data: attachment, error: findError } = await supabase
    .from('objective_attachments')
    .select('id, storage_path, ticket_id, objective_id')
    .eq('id', attachmentId)
    .eq('ticket_id', ticketId)
    .eq('objective_id', objectiveId)
    .single();

  if (findError || !attachment) {
    throw new Error('Attachment not found.');
  }

  await supabase.storage.from('artifacts').remove([attachment.storage_path]);

  const { error: deleteError } = await supabase
    .from('objective_attachments')
    .delete()
    .eq('id', attachmentId);

  if (deleteError) {
    throw new Error(deleteError.message ?? 'Failed to delete attachment.');
  }

  const { data: ticket } = await supabase
    .from('tickets')
    .select('organization_id, project_id')
    .eq('id', ticketId)
    .single();

  if (ticket) {
    revalidatePath(
      buildTicketPath({
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        ticketId
      })
    );
  }
}

export async function getObjectiveAttachmentSignedUrlAction(storagePath: string): Promise<string> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase.storage
    .from('artifacts')
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    throw new Error('Failed to generate download URL.');
  }

  return data.signedUrl;
}
