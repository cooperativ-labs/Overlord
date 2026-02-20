'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';

export type SidebarProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

export async function getProjectsForCurrentUser(): Promise<SidebarProject[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id,name,color,organization_id')
    .order('name', { ascending: true });

  if (error || !data) {
    // If the user has no access to projects, return an empty list rather than throwing.
    return [];
  }

  return data.map(project => ({
    id: project.id,
    name: project.name,
    color: project.color,
    organizationId: project.organization_id
  }));
}

const hexColorPattern = /^#([0-9a-fA-F]{6})$/;

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (!hexColorPattern.test(trimmed)) {
    throw new Error('Color must be a valid hex value like #d4d4d8.');
  }
  return trimmed.toLowerCase();
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

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  revalidatePath(`/${data.organization_id}/projects/${input.projectId}`);
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

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  revalidatePath(`/${data.organization_id}/projects/${input.projectId}`);
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

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  revalidatePath(`/${data.organization_id}/projects/${input.projectId}`);
}

export type CreateProjectResult = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

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

  revalidatePath('/u');
  revalidatePath(`/${data.organization_id}`);
  revalidatePath(`/${data.organization_id}/projects/${data.id}`);

  return {
    id: data.id,
    name: data.name,
    color: data.color,
    organizationId: data.organization_id
  };
}
