'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { PROJECT_BASE_SELECT, PROJECT_SSH_PREFERENCE_SELECT } from '@/lib/actions/project-selects';
import {
  buildLegacySshCommand,
  resolveProjectUserSshSettings,
  type CreateProjectResult,
  type ProjectSshAuthMethod,
  type ProjectUserSshSettingsRow,
  type SidebarProject,
  type UpdateProjectSshConfigInput
} from '@/lib/actions/project-types';
import { normalizeHexColor } from '@/lib/helpers/color';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

type ServerSupabase = SupabaseClient<Database>;

function trimString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimOrNull(value: string | null | undefined): string | null {
  return trimString(value);
}

function revalidateProjectPaths(projectId: string) {
  const projectPath = buildProjectPath({ projectId });
  revalidatePath('/u');
  revalidatePath('/projects');
  revalidatePath(projectPath);
  revalidatePath(projectPath, 'layout');
}

export async function getProjectUserSshSettingsByProjectId(
  supabase: ServerSupabase,
  userId: string | null | undefined,
  projectIds: string[]
): Promise<Map<string, ProjectUserSshSettingsRow>> {
  if (!userId || projectIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('project_user')
    .select(PROJECT_SSH_PREFERENCE_SELECT)
    .eq('user_id', userId)
    .in('project_id', projectIds);

  if (error || !data) {
    return new Map();
  }

  return new Map(data.map(row => [row.project_id, row]));
}

export async function getProjectsForCurrentUser(): Promise<SidebarProject[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_BASE_SELECT)
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  const sshSettingsByProjectId = await getProjectUserSshSettingsByProjectId(
    supabase,
    user?.id,
    data.map(project => project.id)
  );

  return data.map(project => ({
    ...resolveProjectUserSshSettings(sshSettingsByProjectId.get(project.id)),
    id: project.id,
    name: project.name,
    color: project.color,
    organizationId: project.organization_id,
    localWorkingDirectory: project.local_working_directory,
    remoteHelperInstalledAt: project.remote_helper_installed_at,
    remoteHelperVersion: project.remote_helper_version
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

const defaultProjectStatuses = [
  { name: 'draft', status_type: 'draft', position: 0 },
  { name: 'execute', status_type: 'execute', position: 1 },
  { name: 'review', status_type: 'review', position: 2 },
  { name: 'complete', status_type: 'complete', position: 3 }
] as const;

async function ensureDefaultStatusesForOrganization(input: {
  organizationId: number;
  supabase: Awaited<ReturnType<typeof createClient>>;
}): Promise<void> {
  const { error } = await input.supabase.from('ticket_statuses').upsert(
    defaultProjectStatuses.map(status => ({
      organization_id: input.organizationId,
      name: status.name,
      status_type: status.status_type,
      position: status.position,
      is_default: true
    })),
    {
      onConflict: 'organization_id,name',
      ignoreDuplicates: true
    }
  );

  if (error) {
    throw new Error(error.message ?? 'Failed to initialize default project statuses.');
  }
}

export async function deleteProjectAction(input: { projectId: string }): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('projects').delete().eq('id', input.projectId);

  if (error) {
    throw new Error(error.message ?? 'Failed to delete project.');
  }

  revalidatePath('/projects');
  revalidatePath('/u');
}

export async function updateProjectSshConfigAction(
  input: UpdateProjectSshConfigInput
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to update project SSH configuration.');
  }

  const authMethod: ProjectSshAuthMethod | null =
    input.sshAuthMethod && ['agent', 'key', 'tailscale'].includes(input.sshAuthMethod)
      ? input.sshAuthMethod
      : null;

  const payload = {
    user_id: user.id,
    project_id: input.projectId,
    remote_working_directory: trimOrNull(input.remoteWorkingDirectory),
    ssh_host: trimOrNull(input.sshHost),
    ssh_port: input.sshPort ?? null,
    ssh_user: trimOrNull(input.sshUser),
    ssh_auth_method: authMethod,
    ssh_private_key_path: trimOrNull(input.sshPrivateKeyPath),
    ssh_command: buildLegacySshCommand(input),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('project_user')
    .upsert(payload, { onConflict: 'user_id,project_id' })
    .select('project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update project SSH configuration.');
  }

  revalidateProjectPaths(input.projectId);
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
  await ensureDefaultStatusesForOrganization({
    organizationId: input.organizationId,
    supabase
  });
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
