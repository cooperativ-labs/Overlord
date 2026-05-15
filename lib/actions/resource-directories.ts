'use server';

import { revalidatePath } from 'next/cache';

import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export type ProjectResourceDirectory = {
  id: string;
  projectId: string;
  userId: string;
  deviceId: string | null;
  deviceLabel: string | null;
  directoryPath: string;
  label: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

type Row = Database['public']['Tables']['project_resource_directories']['Row'] & {
  devices?: { label: string | null } | { label: string | null }[] | null;
};

function rowToDto(row: Row): ProjectResourceDirectory {
  const deviceRel = row.devices;
  const device = Array.isArray(deviceRel) ? deviceRel[0] : deviceRel;
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    deviceId: row.device_id,
    deviceLabel: device?.label ?? null,
    directoryPath: row.directory_path,
    label: row.label,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function revalidateProjectPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/');
}

/** List resource directories for the current user on a given project. */
export async function getProjectResourceDirectoriesAction(
  projectId: string
): Promise<ProjectResourceDirectory[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('project_resource_directories')
    .select('*, devices(label)')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getProjectResourceDirectoriesAction', error);
    return [];
  }
  return (data ?? []).map(row => rowToDto(row as Row));
}

export async function addProjectResourceDirectoryAction(input: {
  projectId: string;
  directoryPath: string;
  label?: string | null;
  deviceId?: string | null;
  isPrimary?: boolean;
}): Promise<void> {
  const directoryPath = input.directoryPath.trim();
  if (!directoryPath) {
    throw new Error('Directory path is required.');
  }

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to add a resource directory.');
  }

  if (input.isPrimary) {
    await supabase
      .from('project_resource_directories')
      .update({ is_primary: false })
      .eq('user_id', user.id)
      .eq('project_id', input.projectId);
  }

  const { error } = await supabase.from('project_resource_directories').insert({
    user_id: user.id,
    project_id: input.projectId,
    device_id: input.deviceId ?? null,
    directory_path: directoryPath,
    label: input.label?.trim() || null,
    is_primary: input.isPrimary ?? false
  });

  if (error) {
    console.error('addProjectResourceDirectoryAction', error);
    throw new Error(error.message ?? 'Failed to add resource directory.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function removeProjectResourceDirectoryAction(input: {
  directoryId: string;
  projectId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to remove a resource directory.');
  }

  const { error } = await supabase
    .from('project_resource_directories')
    .delete()
    .eq('id', input.directoryId)
    .eq('user_id', user.id);

  if (error) {
    console.error('removeProjectResourceDirectoryAction', error);
    throw new Error(error.message ?? 'Failed to remove resource directory.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function setResourceDirectoryPrimaryAction(input: {
  directoryId: string;
  projectId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a resource directory.');
  }

  await supabase
    .from('project_resource_directories')
    .update({ is_primary: false })
    .eq('user_id', user.id)
    .eq('project_id', input.projectId);

  const { error } = await supabase
    .from('project_resource_directories')
    .update({ is_primary: true })
    .eq('id', input.directoryId)
    .eq('user_id', user.id);

  if (error) {
    console.error('setResourceDirectoryPrimaryAction', error);
    throw new Error(error.message ?? 'Failed to set primary directory.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function updateResourceDirectoryLabelAction(input: {
  directoryId: string;
  projectId: string;
  label: string | null;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to update a resource directory.');
  }

  const trimmed = input.label?.trim();
  const { error } = await supabase
    .from('project_resource_directories')
    .update({ label: trimmed && trimmed.length > 0 ? trimmed : null })
    .eq('id', input.directoryId)
    .eq('user_id', user.id);

  if (error) {
    console.error('updateResourceDirectoryLabelAction', error);
    throw new Error(error.message ?? 'Failed to update resource directory label.');
  }

  revalidateProjectPaths(input.projectId);
}
