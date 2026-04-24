'use server';

import { revalidatePath } from 'next/cache';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceRoot } from '@/lib/env';
import { resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { buildTicketStoragePath, ensureTicketStoragePath } from '@/lib/overlord/protocol-artifacts';
import { createClient } from '@/supabase/utils/server';

export async function uploadImageArtifactAction(
  ticketId: string,
  organizationId: number,
  formData: FormData
) {
  const file = formData.get('file') as File;
  if (!file) {
    throw new Error('No file provided.');
  }

  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Get ticket and project info
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('project_id, organization_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error('Ticket not found.');
  }

  const project = ticket.project_id
    ? ((await supabase.from('projects').select('id, name').eq('id', ticket.project_id).single())
        .data ?? null)
    : null;

  let projectUserWorkingDirectory: string | null = null;
  if (user?.id && project?.id) {
    const { data: projectUser } = await supabase
      .from('project_user')
      .select('local_working_directory')
      .eq('user_id', user.id)
      .eq('project_id', project.id)
      .maybeSingle();
    projectUserWorkingDirectory = projectUser?.local_working_directory ?? null;
  }

  const workspaceRoot = getWorkspaceRoot(projectUserWorkingDirectory);
  const projectWorkingDirectory = projectUserWorkingDirectory;
  const resolvedProjectDirectory = resolveLinkedDirectory(projectWorkingDirectory);
  const resolvedWorkspaceDirectory = resolveLinkedDirectory(workspaceRoot);

  const workingDirectory = resolvedProjectDirectory || resolvedWorkspaceDirectory;

  if (!workingDirectory) {
    throw new Error('No working directory found to save the artifact.');
  }

  const artifactsDir = path.join(workingDirectory, '.overlord', 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const fileName = `${Date.now()}-${file.name}`;
  const filePath = path.join(artifactsDir, fileName);
  const relativePath = path.relative(workingDirectory, filePath);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // Create artifact record
  const { data: artifact, error: artifactError } = await supabase
    .from('artifacts')
    .insert({
      ticket_id: ticketId,
      artifact_type: 'image',
      label: file.name,
      uri: relativePath,
      created_by: user?.id ?? null,
      metadata: {
        size: file.size,
        type: file.type,
        fileName: file.name
      }
    })
    .select()
    .single();

  if (artifactError || !artifact) {
    throw new Error('Failed to create artifact record.');
  }

  // Record a system event
  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    summary: `Image artifact added: ${file.name}`,
    ticket_id: ticketId,
    created_by: user?.id ?? null,
    payload: { artifactId: artifact.id }
  });

  revalidatePath(
    buildTicketPath({
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    })
  );

  return {
    id: artifact.id,
    label: artifact.label,
    uri: artifact.uri,
    relativePath
  };
}

// ---------------------------------------------------------------------------
// Supabase Storage-backed document uploads
// ---------------------------------------------------------------------------

export type TicketDocument = {
  id: string;
  label: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
};

export type TicketDocumentUploadDraft = {
  contentType: string;
  fileSize: number;
  label: string;
  storagePath: string;
  token: string;
};

export async function prepareTicketDocumentUploadAction(
  ticketId: string,
  input: {
    fileName: string;
    fileSize: number;
    contentType: string;
  }
): Promise<TicketDocumentUploadDraft> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new Error('File name is required.');
  }

  if (!Number.isFinite(input.fileSize) || input.fileSize < 0) {
    throw new Error('File size is required.');
  }

  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('project_id, organization_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error('Ticket not found.');
  }

  const storagePath = buildTicketStoragePath({ ...ticket, id: ticketId }, fileName);

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

export async function finalizeTicketDocumentUploadAction(
  ticketId: string,
  draft: Omit<TicketDocumentUploadDraft, 'token'>
): Promise<TicketDocument> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, project_id, organization_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error('Ticket not found.');
  }

  if (!ensureTicketStoragePath(draft.storagePath, ticket)) {
    throw new Error('Upload path does not match the ticket.');
  }

  const fileName = draft.storagePath.split('/').pop() ?? draft.label;
  const objectPrefix = draft.storagePath.split('/').slice(0, -1).join('/');
  const { data: listedObjects, error: listError } = await supabase.storage
    .from('artifacts')
    .list(objectPrefix, { limit: 100, search: fileName });

  if (listError || !(listedObjects ?? []).some(object => object.name === fileName)) {
    throw new Error(listError?.message ?? 'Uploaded file was not found.');
  }

  const artifactType = draft.contentType.startsWith('image/') ? 'image' : 'document';

  const { data: artifact, error: artifactError } = await supabase
    .from('artifacts')
    .insert({
      ticket_id: ticketId,
      artifact_type: artifactType,
      label: draft.label,
      storage_path: draft.storagePath,
      created_by: user.id,
      metadata: {
        size: draft.fileSize,
        type: draft.contentType,
        fileName: draft.label
      }
    })
    .select()
    .single();

  if (artifactError || !artifact) {
    throw new Error('Failed to create artifact record.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    summary: `Document uploaded: ${draft.label}`,
    ticket_id: ticketId,
    created_by: user.id,
    payload: { artifactId: artifact.id }
  });

  revalidatePath(
    buildTicketPath({
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    })
  );

  return {
    id: artifact.id,
    label: artifact.label,
    storagePath: draft.storagePath,
    fileType: draft.contentType,
    fileSize: draft.fileSize,
    createdAt: artifact.created_at
  };
}

export async function listTicketDocumentsAction(ticketId: string): Promise<TicketDocument[]> {
  const supabase = await createClient();

  const { data: artifacts, error } = await supabase
    .from('artifacts')
    .select('id, label, storage_path, metadata, created_at')
    .eq('ticket_id', ticketId)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message ?? 'Failed to list documents.');
  }

  return (artifacts ?? []).map(a => ({
    id: a.id,
    label: a.label,
    storagePath: a.storage_path!,
    fileType: ((a.metadata as Record<string, unknown>)?.type as string) ?? '',
    fileSize: ((a.metadata as Record<string, unknown>)?.size as number) ?? 0,
    createdAt: a.created_at
  }));
}

export async function deleteTicketDocumentAction(
  ticketId: string,
  artifactId: string
): Promise<void> {
  const supabase = await createClient();

  const { data: artifact, error: findError } = await supabase
    .from('artifacts')
    .select('id, storage_path, label, ticket_id')
    .eq('id', artifactId)
    .eq('ticket_id', ticketId)
    .not('storage_path', 'is', null)
    .single();

  if (findError || !artifact) {
    throw new Error('Document not found.');
  }

  if (artifact.storage_path) {
    await supabase.storage.from('artifacts').remove([artifact.storage_path]);
  }

  const { error: deleteError } = await supabase.from('artifacts').delete().eq('id', artifactId);

  if (deleteError) {
    throw new Error(deleteError.message ?? 'Failed to delete document.');
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

export async function getDocumentSignedUrlAction(storagePath: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from('artifacts')
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    throw new Error('Failed to generate download URL.');
  }

  return data.signedUrl;
}
