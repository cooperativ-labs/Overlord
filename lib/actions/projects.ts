'use server';

import { revalidatePath } from 'next/cache';

import { normalizeHexColor } from '@/lib/helpers/color';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { createClient } from '@/supabase/utils/server';

export type ProjectSshAuthMethod = 'agent' | 'key' | 'tailscale';

export type SidebarProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
  localWorkingDirectory: string | null;
  /** @deprecated — retained for one release so legacy callers keep compiling. */
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
  sshAuthMethod: ProjectSshAuthMethod | null;
  sshPrivateKeyPath: string | null;
  remoteHelperInstalledAt: string | null;
  remoteHelperVersion: string | null;
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
    .select(
      'id,name,color,organization_id,local_working_directory,ssh_command,remote_working_directory,ssh_host,ssh_port,ssh_user,ssh_auth_method,ssh_private_key_path,remote_helper_installed_at,remote_helper_version'
    )
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
    localWorkingDirectory: project.local_working_directory,
    sshCommand: project.ssh_command,
    remoteWorkingDirectory: project.remote_working_directory,
    sshHost: project.ssh_host,
    sshPort: project.ssh_port,
    sshUser: project.ssh_user,
    sshAuthMethod: project.ssh_auth_method as ProjectSshAuthMethod | null,
    sshPrivateKeyPath: project.ssh_private_key_path,
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

export type CreateProjectResult = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

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

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type UpdateProjectSshConfigInput = {
  projectId: string;
  remoteWorkingDirectory: string | null;
  sshHost: string | null;
  sshPort: number | null;
  sshUser: string | null;
  sshAuthMethod: ProjectSshAuthMethod | null;
  sshPrivateKeyPath: string | null;
};

function deriveLegacySshCommand(input: UpdateProjectSshConfigInput): string | null {
  const user = trimOrNull(input.sshUser);
  const host = trimOrNull(input.sshHost);
  if (!user || !host) return null;
  const port = input.sshPort && input.sshPort !== 22 ? ` -p ${input.sshPort}` : '';
  return `ssh${port} ${user}@${host}`;
}

export async function updateProjectSshConfigAction(
  input: UpdateProjectSshConfigInput
): Promise<void> {
  const supabase = await createClient();
  const authMethod: ProjectSshAuthMethod | null =
    input.sshAuthMethod && ['agent', 'key', 'tailscale'].includes(input.sshAuthMethod)
      ? input.sshAuthMethod
      : null;

  const payload = {
    remote_working_directory: trimOrNull(input.remoteWorkingDirectory),
    ssh_host: trimOrNull(input.sshHost),
    ssh_port: input.sshPort ?? null,
    ssh_user: trimOrNull(input.sshUser),
    ssh_auth_method: authMethod,
    ssh_private_key_path: trimOrNull(input.sshPrivateKeyPath),
    // Keep legacy ssh_command in sync so unmigrated callers still work this
    // release. Phase 5 drops the column.
    ssh_command: deriveLegacySshCommand(input)
  };

  const { data, error } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', input.projectId)
    .select('organization_id')
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
