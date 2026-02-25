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
