'use server';

import { revalidatePath } from 'next/cache';

import { normalizeHexColor } from '@/lib/helpers/color';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { createClient } from '@/supabase/utils/server';

export type SidebarProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
  localWorkingDirectory: string | null;
};

function revalidateProjectPaths(projectId: string) {
  const projectPath = buildProjectPath({ projectId });
  revalidatePath('/u');
  revalidatePath('/projects');
  revalidatePath(projectPath);
  revalidatePath(projectPath, 'layout');
}

export async function getProjectsForCurrentUser(): Promise<SidebarProject[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id,name,color,organization_id,local_working_directory')
    .order('name', { ascending: true });

  if (error || !data) {
    // If the user has no access to projects, return an empty list rather than throwing.
    return [];
  }

  return data.map(project => ({
    id: project.id,
    name: project.name,
    color: project.color,
    organizationId: project.organization_id,
    localWorkingDirectory: project.local_working_directory
  }));
}

export async function updateProjectColorAction(input: {
  projectId: string;
  color: string;
}): Promise<void> {
  const color = normalizeHexColor(input.color);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .update({ color })
    .eq('id', input.projectId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update project color.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function updateProjectNameAction(input: {
  projectId: string;
  name: string;
}): Promise<void> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .update({ name: trimmedName })
    .eq('id', input.projectId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update project name.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function updateProjectWorkingDirectoryAction(input: {
  projectId: string;
  workingDirectory: string | null;
}): Promise<void> {
  const normalized =
    typeof input.workingDirectory === 'string' && input.workingDirectory.trim().length > 0
      ? input.workingDirectory.trim()
      : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .update({ local_working_directory: normalized })
    .eq('id', input.projectId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update project working directory.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function disconnectProjectFromEverhourAction(input: {
  projectId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .update({ everhour_project_id: null })
    .eq('id', input.projectId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to disconnect project from Everhour.');
  }

  revalidateProjectPaths(input.projectId);
}

export type CreateProjectResult = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

export async function deleteProjectAction(input: { projectId: string }): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('projects').delete().eq('id', input.projectId);

  if (error) {
    throw new Error(error.message ?? 'Failed to delete project.');
  }

  revalidatePath('/projects');
  revalidatePath('/u');
}

export async function createProject(input: {
  organizationId: number;
  name: string;
  color: string;
}): Promise<CreateProjectResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const color = normalizeHexColor(input.color);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      name: trimmedName,
      color
    })
    .select('id,name,color,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  revalidateProjectPaths(data.id);

  return {
    id: data.id,
    name: data.name,
    color: data.color,
    organizationId: data.organization_id
  };
}
