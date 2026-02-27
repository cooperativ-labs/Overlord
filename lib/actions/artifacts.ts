'use server';

import { revalidatePath } from 'next/cache';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceRoot } from '@/lib/env';
import { resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
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

  // Get ticket and project info
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('project_id, organization_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error('Ticket not found.');
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, local_working_directory')
    .eq('id', ticket.project_id)
    .single();

  if (projectError || !project) {
    throw new Error('Project not found.');
  }

  const workspaceRoot = getWorkspaceRoot();
  const projectWorkingDirectory = project.local_working_directory;
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

export async function uploadTicketDocumentAction(
  ticketId: string,
  formData: FormData
): Promise<TicketDocument> {
  const file = formData.get('file') as File;
  if (!file) {
    throw new Error('No file provided.');
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

  // Build path: <organization_id>/<project_id>/<ticket_id>/<timestamp>-<filename>
  const storagePath = `${ticket.organization_id}/${ticket.project_id}/${ticketId}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('artifacts')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) {
    throw new Error(uploadError.message ?? 'Failed to upload file.');
  }

  const artifactType = file.type.startsWith('image/') ? 'image' : 'document';

  const { data: artifact, error: artifactError } = await supabase
    .from('artifacts')
    .insert({
      ticket_id: ticketId,
      artifact_type: artifactType,
      label: file.name,
      storage_path: storagePath,
      uploaded_by: user.id,
      metadata: {
        size: file.size,
        type: file.type,
        fileName: file.name
      }
    })
    .select()
    .single();

  if (artifactError || !artifact) {
    // Clean up the uploaded file if the record failed
    await supabase.storage.from('artifacts').remove([storagePath]);
    throw new Error('Failed to create artifact record.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'artifact',
    summary: `Document uploaded: ${file.name}`,
    ticket_id: ticketId,
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
    storagePath,
    fileType: file.type,
    fileSize: file.size,
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
    fileType: (a.metadata as Record<string, unknown>)?.type as string ?? '',
    fileSize: (a.metadata as Record<string, unknown>)?.size as number ?? 0,
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

  const { error: deleteError } = await supabase
    .from('artifacts')
    .delete()
    .eq('id', artifactId);

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

export async function getDocumentSignedUrlAction(
  storagePath: string
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from('artifacts')
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    throw new Error('Failed to generate download URL.');
  }

  return data.signedUrl;
}
