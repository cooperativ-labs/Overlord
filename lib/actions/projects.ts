'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import {
  PROJECT_BASE_SELECT,
  PROJECT_SSH_PREFERENCE_SELECT,
  PROJECT_USER_LOCAL_SELECT
} from '@/lib/actions/project-selects';
import {
  buildLegacySshCommand,
  type CreateProjectResult,
  type ProjectSshAuthMethod,
  type ProjectUserLocalSettingsRow,
  type ProjectUserSshSettingsRow,
  resolveProjectUserSshSettings,
  resolveVisibleProjectSshSettings,
  type SidebarProject,
  type UpdateProjectSshConfigInput
} from '@/lib/actions/project-types';
import { isAppFeatureEnabled } from '@/lib/app-features';
import {
  getAuthDiagnostics,
  getServerActionRequestDiagnostics,
  idSuffix,
  logElectronServerActionDiagnostic,
  toErrorDiagnostics
} from '@/lib/diagnostics/server-action';
import { normalizeHexColor } from '@/lib/helpers/color';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { createClientForRequest } from '@/supabase/utils/server';
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

  return new Map(
    data
      .filter(
        (row): row is typeof row & { project_id: string } => typeof row.project_id === 'string'
      )
      .map(row => [row.project_id, row])
  );
}

export async function getProjectUserLocalSettingsByProjectId(
  supabase: ServerSupabase,
  userId: string | null | undefined,
  projectIds: string[]
): Promise<Map<string, ProjectUserLocalSettingsRow>> {
  if (!userId || projectIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('project_user')
    .select(PROJECT_USER_LOCAL_SELECT)
    .eq('user_id', userId)
    .in('project_id', projectIds);

  if (error || !data) {
    return new Map();
  }

  return new Map(
    data
      .filter(
        (row): row is typeof row & { project_id: string } => typeof row.project_id === 'string'
      )
      .map(row => [row.project_id, row])
  );
}

export async function getProjectsForCurrentUser(): Promise<SidebarProject[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const sshEnabled = await isAppFeatureEnabled('ssh');

  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_BASE_SELECT)
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  const projectIds = data.map(project => project.id);
  const [sshSettingsByProjectId, localSettingsByProjectId] = await Promise.all([
    getProjectUserSshSettingsByProjectId(supabase, user?.id, projectIds),
    getProjectUserLocalSettingsByProjectId(supabase, user?.id, projectIds)
  ]);

  return data.map(project => {
    const localSettings = localSettingsByProjectId.get(project.id);
    return {
      ...resolveVisibleProjectSshSettings(
        resolveProjectUserSshSettings(sshSettingsByProjectId.get(project.id)),
        { sshEnabled }
      ),
      id: project.id,
      name: project.name,
      color: project.color,
      organizationId: project.organization_id,
      everhourProjectId:
        typeof project.everhour_project_id === 'string' ? project.everhour_project_id : null,
      operationsProfileFingerprint: project.operations_profile_fingerprint ?? null,
      operationsProfileGeneratedAt: project.operations_profile_generated_at ?? null,
      localWorkingDirectory: localSettings?.local_working_directory ?? null,
      remoteHelperInstalledAt: localSettings?.remote_helper_installed_at ?? null,
      remoteHelperVersion: localSettings?.remote_helper_version ?? null
    };
  });
}

export async function updateProjectColorAction(input: {
  projectId: string;
  color: string;
}): Promise<void> {
  const color = normalizeHexColor(input.color);
  const supabase = await createClientForRequest();

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

  const supabase = await createClientForRequest();

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

  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to update the project working directory.');
  }

  const { error } = await supabase.from('project_user').upsert(
    {
      user_id: user.id,
      project_id: input.projectId,
      local_working_directory: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,project_id' }
  );

  if (error) {
    console.error('updateProjectWorkingDirectoryAction', error ?? 'no error message');
    throw new Error(error.message ?? 'Failed to update project working directory.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function disconnectProjectFromEverhourAction(input: {
  projectId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
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
  supabase: Awaited<ReturnType<typeof createClientForRequest>>;
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
  const supabase = await createClientForRequest();
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
  const sshEnabled = await isAppFeatureEnabled('ssh');
  if (!sshEnabled) {
    throw new Error('SSH remote workspaces are currently disabled.');
  }

  const supabase = await createClientForRequest();
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

  const { error } = await supabase.from('project_user').upsert(payload, {
    onConflict: 'user_id,project_id'
  });

  if (error) {
    throw new Error(error?.message ?? 'Failed to update project SSH configuration.');
  }

  revalidateProjectPaths(input.projectId);
}

export async function moveProjectToOrganizationAction(input: {
  projectId: string;
  targetOrganizationId: number;
}): Promise<void> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase
    .from('projects')
    .update({ organization_id: input.targetOrganizationId })
    .eq('id', input.projectId)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to move project.');
  }

  revalidatePath('/projects');
  revalidatePath('/u');
  revalidateProjectPaths(input.projectId);
}

export async function createProject(input: {
  organizationId: number;
  name: string;
  color: string;
}): Promise<CreateProjectResult> {
  const requestDiagnostics = await getServerActionRequestDiagnostics();
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const color = normalizeHexColor(input.color);
  const supabase = await createClientForRequest();

  if (requestDiagnostics.isElectron) {
    const authDiagnostics = await getAuthDiagnostics(supabase);
    logElectronServerActionDiagnostic('createProject', 'attempt', {
      auth: authDiagnostics,
      organizationId: input.organizationId,
      request: requestDiagnostics
    });
  }

  try {
    await ensureDefaultStatusesForOrganization({
      organizationId: input.organizationId,
      supabase
    });
  } catch (error) {
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createProject', 'default_statuses_failed', {
        ...toErrorDiagnostics(error),
        organizationId: input.organizationId,
        request: requestDiagnostics
      });
    }
    throw error;
  }

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
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createProject', 'insert_failed', {
        errorMessage: error?.message ?? 'No project row returned.',
        errorName: error?.name ?? null,
        errorCode: error?.code ?? null,
        organizationId: input.organizationId,
        request: requestDiagnostics
      });
    }
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  if (requestDiagnostics.isElectron) {
    logElectronServerActionDiagnostic('createProject', 'created', {
      organizationId: data.organization_id,
      projectIdSuffix: idSuffix(data.id),
      request: requestDiagnostics
    });
  }

  revalidateProjectPaths(data.id);

  return {
    id: data.id,
    name: data.name,
    color: data.color,
    organizationId: data.organization_id
  };
}
