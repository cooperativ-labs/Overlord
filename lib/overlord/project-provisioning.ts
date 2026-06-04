import os from 'node:os';

import { normalizeHexColor } from '@/lib/helpers/color';
import { ensureProjectExecutionTarget } from '@/lib/overlord/execution-targets';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import {
  assertCanManagePrimary,
  clearTargetPrimary,
  shouldAutoPrimary
} from '@/lib/resource-directories/primary-resource';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** Default project color used when a caller does not supply one. */
export const DEFAULT_PROJECT_COLOR = '#fecdd3';

const defaultProjectStatuses = [
  { name: 'draft', status_type: 'draft', position: 0 },
  { name: 'execute', status_type: 'execute', position: 1 },
  { name: 'review', status_type: 'review', position: 2 },
  { name: 'complete', status_type: 'complete', position: 3 }
] as const;

/**
 * Seed the standard draft/execute/review/complete statuses for an organization.
 * Idempotent — existing rows are skipped via the `(organization_id, name)`
 * conflict target, so this is safe to call before every project insert.
 */
export async function ensureDefaultProjectStatuses(input: {
  organizationId: number;
  supabase: ServiceClient;
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

export type ProvisionedProject = {
  id: string;
  name: string;
  organization_id: number;
};

/**
 * Create a project in an organization after ensuring the org has its default
 * statuses. When `reuseExistingByName` is set, a same-named project in the org
 * is returned instead of inserting a duplicate (used by the re-runnable
 * `ovld onboard` flow).
 */
export async function createProjectRecord(input: {
  supabase: ServiceClient;
  organizationId: number;
  name: string;
  color?: string;
  reuseExistingByName?: boolean;
}): Promise<ProvisionedProject> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const color = normalizeHexColor(input.color?.trim() || DEFAULT_PROJECT_COLOR);

  await ensureDefaultProjectStatuses({
    organizationId: input.organizationId,
    supabase: input.supabase
  });

  if (input.reuseExistingByName) {
    const { data: existing } = await input.supabase
      .from('projects')
      .select('id,name,organization_id')
      .eq('organization_id', input.organizationId)
      .eq('name', trimmedName)
      .limit(1)
      .maybeSingle();

    if (existing) return existing as ProvisionedProject;
  }

  const { data, error } = await input.supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      name: trimmedName,
      color
    })
    .select('id,name,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  return data as ProvisionedProject;
}

export type RegisteredProjectResource = {
  id: string | null;
  isPrimary: boolean;
  executionTargetId: string;
  alreadyRegistered: boolean;
};

/**
 * Register a directory as a resource for a project on the caller's device,
 * promoting it to primary when the project/device has no primary yet (or when
 * `isPrimary` is forced). Mirrors `POST /api/protocol/add-project-resource`
 * so a project can be created and linked to a working directory in one step.
 */
export async function registerProjectResourceDirectory(input: {
  supabase: ServiceClient;
  organizationId: number;
  projectId: string;
  userId: string;
  directoryPath: string;
  deviceFingerprint: string;
  isPrimary?: boolean;
  label?: string | null;
  deviceHostname?: string | null;
  devicePlatform?: string | null;
  devicePort?: number | null;
}): Promise<RegisteredProjectResource> {
  const { supabase } = input;
  const executionTargetId = await upsertDeviceFromProtocol(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    deviceFingerprint: input.deviceFingerprint,
    hostname: input.deviceHostname ?? os.hostname(),
    port: input.devicePort ?? null,
    platform: input.devicePlatform ?? null
  });

  if (!executionTargetId) {
    throw new Error('Failed to register execution target.');
  }

  await ensureProjectExecutionTarget(supabase, {
    projectId: input.projectId,
    organizationId: input.organizationId,
    userId: input.userId,
    executionTargetId
  });

  await assertCanManagePrimary(supabase, {
    userId: input.userId,
    projectId: input.projectId,
    executionTargetId
  });

  const shouldSetPrimary =
    input.isPrimary ??
    (await shouldAutoPrimary(supabase, {
      projectId: input.projectId,
      executionTargetId
    }));

  if (shouldSetPrimary) {
    await clearTargetPrimary(supabase, input.projectId, executionTargetId);
  }

  const { data, error } = await (supabase as any)
    .from('project_resource_directories')
    .insert({
      user_id: input.userId,
      project_id: input.projectId,
      execution_target_id: executionTargetId,
      directory_path: input.directoryPath,
      label: input.label?.trim() || null,
      is_primary: shouldSetPrimary
    })
    .select('id, is_primary, execution_target_id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await (supabase as any)
        .from('project_resource_directories')
        .select('id, is_primary, execution_target_id')
        .eq('project_id', input.projectId)
        .eq('execution_target_id', executionTargetId)
        .eq('directory_path', input.directoryPath)
        .maybeSingle();
      return {
        id: existing?.id ?? null,
        isPrimary: Boolean(existing?.is_primary),
        executionTargetId,
        alreadyRegistered: true
      };
    }
    throw new Error(error.message ?? 'Failed to register project directory.');
  }

  return {
    id: data.id as string,
    isPrimary: Boolean(data.is_primary),
    executionTargetId: data.execution_target_id as string,
    alreadyRegistered: false
  };
}
