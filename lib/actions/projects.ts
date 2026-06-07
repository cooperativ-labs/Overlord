'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { PROJECT_BASE_SELECT } from '@/lib/actions/project-selects';
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
import { projectNameConflictError } from '@/lib/helpers/project-name';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import {
  ensureProjectExecutionTarget,
  upsertSshExecutionTarget
} from '@/lib/overlord/execution-targets';
import {
  assertCanManagePrimary,
  clearTargetPrimary,
  getPrimaryProjectResourceDirectoriesByProjectId
} from '@/lib/resource-directories/primary-resource';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
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

  const { data: projectTargets, error } = await (supabase as any)
    .from('project_execution_targets')
    .select('project_id, execution_target_id, execution_targets(host, port, transport)')
    .in('project_id', projectIds);

  if (error || !projectTargets || projectTargets.length === 0) {
    return new Map();
  }

  const targetIds = [
    ...new Set(
      projectTargets
        .map((row: { execution_target_id?: string | null }) => row.execution_target_id)
        .filter((id: string | null | undefined): id is string => Boolean(id))
    )
  ];
  if (targetIds.length === 0) return new Map();

  const [{ data: credentials }, { data: resources }] = await Promise.all([
    (supabase as any)
      .from('execution_target_ssh_credentials')
      .select('execution_target_id, username, auth_method, private_key_path')
      .eq('user_id', userId)
      .in('execution_target_id', targetIds),
    (supabase as any)
      .from('project_resource_directories')
      .select('project_id, execution_target_id, directory_path, is_primary, created_at')
      .in('project_id', projectIds)
      .in('execution_target_id', targetIds)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
  ]);

  const credentialByTarget = new Map<
    string,
    { username: string; auth_method: string | null; private_key_path: string | null }
  >();
  for (const credential of credentials ?? []) {
    if (!credentialByTarget.has(credential.execution_target_id)) {
      credentialByTarget.set(credential.execution_target_id, credential);
    }
  }

  const resourceByProjectTarget = new Map<string, string>();
  for (const resource of resources ?? []) {
    const key = `${resource.project_id}:${resource.execution_target_id}`;
    if (!resourceByProjectTarget.has(key)) {
      resourceByProjectTarget.set(key, resource.directory_path);
    }
  }

  const result = new Map<string, ProjectUserSshSettingsRow>();
  for (const projectTarget of projectTargets as Array<{
    project_id: string;
    execution_target_id: string;
    execution_targets:
      | { host: string | null; port: number | null; transport: string | null }
      | { host: string | null; port: number | null; transport: string | null }[]
      | null;
  }>) {
    if (result.has(projectTarget.project_id)) continue;

    const target = Array.isArray(projectTarget.execution_targets)
      ? projectTarget.execution_targets[0]
      : projectTarget.execution_targets;
    if (!target || target.transport !== 'ssh') continue;

    const credential = credentialByTarget.get(projectTarget.execution_target_id);
    if (!credential) continue;

    const sshHost = trimString(target.host);
    const sshUser = trimString(credential.username);
    const sshPort = target.port ?? null;
    if (!sshHost || !sshUser) continue;

    result.set(projectTarget.project_id, {
      project_id: projectTarget.project_id,
      ssh_command: buildLegacySshCommand({
        projectId: projectTarget.project_id,
        sshHost,
        sshPort,
        sshUser,
        sshAuthMethod: credential.auth_method as ProjectSshAuthMethod | null,
        sshPrivateKeyPath: credential.private_key_path,
        remoteWorkingDirectory: null
      }),
      remote_working_directory:
        resourceByProjectTarget.get(
          `${projectTarget.project_id}:${projectTarget.execution_target_id}`
        ) ?? null,
      ssh_host: sshHost,
      ssh_port: sshPort,
      ssh_user: sshUser,
      ssh_auth_method: credential.auth_method,
      ssh_private_key_path: credential.private_key_path
    });
  }

  return result;
}

export async function getProjectUserLocalSettingsByProjectId(
  supabase: ServerSupabase,
  userId: string | null | undefined,
  projectIds: string[]
): Promise<Map<string, ProjectUserLocalSettingsRow>> {
  const resources = await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
    userId,
    projectIds
  });

  return new Map(
    [...resources.values()].map(resource => [
      resource.projectId,
      {
        project_id: resource.projectId,
        local_working_directory: resource.directoryPath
      }
    ])
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
    .is('archived_at', null)
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
      archivedAt: project.archived_at ?? null,
      localWorkingDirectory: localSettings?.local_working_directory ?? null
    };
  });
}

export type ArchivedProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
  archivedAt: string;
};

export async function getArchivedProjectsForCurrentUser(): Promise<ArchivedProject[]> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase
    .from('projects')
    .select('id,name,color,organization_id,archived_at')
    .not('archived_at', 'is', null)
    .order('name', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map(project => ({
    id: project.id,
    name: project.name,
    color: project.color,
    organizationId: project.organization_id,
    archivedAt: project.archived_at!
  }));
}

export type ModalProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  organization_id: number;
  local_working_directory: string | null;
  ssh_command: string | null;
  remote_working_directory: string | null;
};

export async function getProjectsForModalAction(): Promise<ModalProjectOption[]> {
  const projects = await getProjectsForCurrentUser();
  return projects.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    everhour_project_id: p.everhourProjectId ?? null,
    organization_id: p.organizationId,
    local_working_directory: p.localWorkingDirectory,
    ssh_command: p.sshCommand,
    remote_working_directory: p.remoteWorkingDirectory
  }));
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
    throw projectNameConflictError(error, 'Failed to update project name.');
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

export async function updateProjectEverhourProjectNameAction(input: {
  projectId: string;
  everhourProjectName: string | null;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const trimmed = trimOrNull(input.everhourProjectName);
  const { data, error } = await supabase
    .from('projects')
    .update({ everhour_project_name: trimmed })
    .eq('id', input.projectId)
    .select('organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update Everhour project name.');
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
  // Default statuses are seeded at organization creation by the
  // seed_default_ticket_statuses_for_organization SECURITY DEFINER function, so
  // for any existing organization they are already present. Check first and
  // skip the insert when they exist: the ticket_statuses INSERT RLS policy
  // requires the ADMIN role, but project creation only requires AGENT+, so an
  // invited non-admin member would otherwise hit an RLS violation here.
  const { data: existing, error: selectError } = await input.supabase
    .from('ticket_statuses')
    .select('name')
    .eq('organization_id', input.organizationId)
    .limit(1);

  if (selectError) {
    throw new Error(selectError.message ?? 'Failed to read project statuses.');
  }

  if (existing && existing.length > 0) {
    return;
  }

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

export async function archiveProjectAction(input: { projectId: string }): Promise<void> {
  const supabase = await createClientForRequest();
  const serviceSupabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', input.projectId)
    .is('archived_at', null)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to archive project.');
  }

  await (serviceSupabase as any)
    .from('project_resource_directories')
    .delete()
    .eq('project_id', input.projectId);

  await (serviceSupabase as any)
    .from('project_execution_targets')
    .delete()
    .eq('project_id', input.projectId);

  await (serviceSupabase as any)
    .from('profiles')
    .update({ default_project_id: null })
    .eq('default_project_id', input.projectId);

  revalidatePath('/projects');
  revalidatePath('/u');
  revalidateProjectPaths(input.projectId);
}

export async function unarchiveProjectAction(input: { projectId: string }): Promise<void> {
  const supabase = await createClientForRequest();

  const { data, error } = await supabase
    .from('projects')
    .update({ archived_at: null })
    .eq('id', input.projectId)
    .not('archived_at', 'is', null)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to unarchive project.');
  }

  revalidatePath('/projects');
  revalidatePath('/u');
  revalidateProjectPaths(input.projectId);
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

  const remoteDir = trimOrNull(input.remoteWorkingDirectory);
  const sshHost = trimOrNull(input.sshHost);
  const sshUser = trimOrNull(input.sshUser);

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', input.projectId)
    .maybeSingle();
  if (projectError || !project) {
    throw new Error('Project not found.');
  }

  const serviceSupabase = createServiceRoleClient();
  if (!sshHost || !sshUser) {
    await clearProjectSshTargets(serviceSupabase, {
      userId: user.id,
      projectId: input.projectId
    });
    revalidateProjectPaths(input.projectId);
    return;
  }

  const executionTargetId = await upsertSshExecutionTarget(serviceSupabase, {
    organizationId: project.organization_id,
    userId: user.id,
    host: sshHost,
    port: input.sshPort ?? null,
    username: sshUser,
    authMethod,
    privateKeyPath: trimOrNull(input.sshPrivateKeyPath),
    // Organization-owned targets have no single owner; personal targets are
    // owned by the registrant (the default in upsertSshExecutionTarget).
    ownerUserId: input.organizationOwned ? null : user.id
  });

  if (!executionTargetId) {
    throw new Error('Failed to register SSH execution target.');
  }

  await ensureProjectExecutionTarget(serviceSupabase, {
    projectId: input.projectId,
    organizationId: project.organization_id,
    userId: user.id,
    executionTargetId
  });

  if (remoteDir) {
    await syncSshRemoteResource(serviceSupabase, {
      userId: user.id,
      projectId: input.projectId,
      executionTargetId,
      directoryPath: remoteDir
    });
  }

  revalidateProjectPaths(input.projectId);
}

/**
 * Register (or refresh) a placeholder device + primary resource entry for an
 * SSH remote working directory. Idempotent — re-saving the SSH form updates
 * the same rows. The placeholder device gets replaced with the real device
 * once the remote `ovld` registers itself (handled separately).
 */
async function syncSshRemoteResource(
  supabase: ServerSupabase,
  input: {
    userId: string;
    projectId: string;
    executionTargetId: string;
    directoryPath: string;
  }
): Promise<void> {
  await assertCanManagePrimary(supabase, {
    userId: input.userId,
    projectId: input.projectId,
    executionTargetId: input.executionTargetId
  });

  await clearTargetPrimary(supabase, input.projectId, input.executionTargetId);

  await (supabase as any).from('project_resource_directories').upsert(
    {
      user_id: input.userId,
      project_id: input.projectId,
      execution_target_id: input.executionTargetId,
      directory_path: input.directoryPath,
      is_primary: true
    },
    { onConflict: 'project_id,execution_target_id,directory_path' }
  );
}

async function clearProjectSshTargets(
  supabase: ServerSupabase,
  input: {
    userId: string;
    projectId: string;
  }
): Promise<void> {
  const { data: projectTargets } = await (supabase as any)
    .from('project_execution_targets')
    .select('execution_target_id, execution_targets!inner(transport)')
    .eq('project_id', input.projectId);

  const sshTargetIds = (projectTargets ?? [])
    .map(
      (row: {
        execution_target_id?: string | null;
        execution_targets?: { transport?: string | null } | { transport?: string | null }[] | null;
      }) => {
        const target = Array.isArray(row.execution_targets)
          ? row.execution_targets[0]
          : row.execution_targets;
        return target?.transport === 'ssh' ? row.execution_target_id : null;
      }
    )
    .filter((id: string | null | undefined): id is string => Boolean(id));

  if (sshTargetIds.length === 0) return;

  await (supabase as any)
    .from('project_resource_directories')
    .delete()
    .eq('project_id', input.projectId)
    .in('execution_target_id', sshTargetIds);

  await (supabase as any)
    .from('project_execution_targets')
    .delete()
    .eq('project_id', input.projectId)
    .in('execution_target_id', sshTargetIds);

  const { data: remainingLinks } = await (supabase as any)
    .from('project_execution_targets')
    .select('execution_target_id')
    .in('execution_target_id', sshTargetIds);

  const stillReferenced = new Set(
    (remainingLinks ?? [])
      .map((row: { execution_target_id?: string | null }) => row.execution_target_id)
      .filter((id: string | null | undefined): id is string => Boolean(id))
  );
  const orphanedTargetIds = sshTargetIds.filter(
    (targetId: string) => !stillReferenced.has(targetId)
  );
  if (orphanedTargetIds.length === 0) return;

  await (supabase as any)
    .from('execution_target_ssh_credentials')
    .delete()
    .eq('user_id', input.userId)
    .in('execution_target_id', orphanedTargetIds);
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
    throw projectNameConflictError(error, 'Failed to create project.');
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
