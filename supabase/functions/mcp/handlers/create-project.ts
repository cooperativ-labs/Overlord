/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { upsertDeviceFromProtocol } from './_device-upsert.ts';
import {
  canManageProjectResource,
  clearTargetPrimary,
  shouldAutoPrimary
} from './_resource-authority.ts';

const DEFAULT_PROJECT_COLOR = '#fecdd3';
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;

const DEFAULT_PROJECT_STATUSES = [
  { name: 'draft', status_type: 'draft', position: 0 },
  { name: 'execute', status_type: 'execute', position: 1 },
  { name: 'review', status_type: 'review', position: 2 },
  { name: 'complete', status_type: 'complete', position: 3 }
] as const;

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

async function ensureDefaultProjectStatuses(
  supabase: SupabaseClient,
  organizationId: number
): Promise<string | null> {
  const { error } = await supabase.from('ticket_statuses').upsert(
    DEFAULT_PROJECT_STATUSES.map(status => ({
      organization_id: organizationId,
      name: status.name,
      status_type: status.status_type,
      position: status.position,
      is_default: true
    })),
    { onConflict: 'organization_id,name', ignoreDuplicates: true }
  );
  return error ? error.message : null;
}

export async function handleCreateProject(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  if (!ctx.userId) return toolErr('Authentication required.');

  const name = typeof args?.name === 'string' ? args.name.trim() : '';
  if (!name) return toolErr('name is required.');

  const color =
    typeof args?.color === 'string' && args.color.trim()
      ? normalizeHexColor(args.color)
      : DEFAULT_PROJECT_COLOR;
  if (!color) return toolErr('color must be a valid hex value like #d4d4d8.');

  const statusError = await ensureDefaultProjectStatuses(supabase, ctx.organizationId);
  if (statusError) return toolErr(`Failed to initialize project statuses: ${statusError}`);

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ organization_id: ctx.organizationId, name, color })
    .select('id, name, organization_id')
    .single();

  if (projectError || !project) {
    return toolErr(`Failed to create project: ${projectError?.message ?? 'unknown error'}`);
  }

  // One-step directory registration when a directory + device are supplied.
  const directoryPath = typeof args?.directoryPath === 'string' ? args.directoryPath.trim() : '';
  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';

  let resource: unknown = null;
  if (directoryPath && deviceFingerprint) {
    const label = typeof args?.label === 'string' ? args.label.trim() || null : null;
    const explicitPrimary = typeof args?.isPrimary === 'boolean' ? args.isPrimary : undefined;
    const deviceHostname =
      typeof args?.deviceHostname === 'string' ? args.deviceHostname.trim() : null;
    const devicePlatform =
      typeof args?.devicePlatform === 'string' ? args.devicePlatform.trim() : null;
    const devicePort =
      typeof args?.devicePort === 'number' && Number.isFinite(args.devicePort)
        ? args.devicePort
        : null;

    const executionTargetId = await upsertDeviceFromProtocol(supabase, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      deviceFingerprint,
      hostname: deviceHostname,
      port: devicePort,
      platform: devicePlatform
    });

    if (!executionTargetId) {
      return toolOk({
        project: {
          id: (project as any).id,
          name: (project as any).name,
          organizationId: (project as any).organization_id
        },
        resource: null,
        warning: 'Project created, but failed to register execution target for the directory.'
      });
    }

    await supabase.from('project_execution_targets').upsert(
      {
        project_id: (project as any).id,
        execution_target_id: executionTargetId,
        organization_id: ctx.organizationId,
        added_by: ctx.userId
      },
      { onConflict: 'project_id,execution_target_id' }
    );

    const canManage = await canManageProjectResource(supabase, {
      userId: ctx.userId,
      projectId: (project as any).id,
      executionTargetId
    });
    if (!canManage) {
      return toolOk({
        project: {
          id: (project as any).id,
          name: (project as any).name,
          organizationId: (project as any).organization_id
        },
        resource: null,
        warning:
          'Project created, but you do not have permission to register resource directories on this target.'
      });
    }

    const isPrimary =
      explicitPrimary ??
      (await shouldAutoPrimary(supabase, { projectId: (project as any).id, executionTargetId }));

    if (isPrimary) {
      await clearTargetPrimary(supabase, (project as any).id, executionTargetId);
    }

    const { data: inserted, error: resourceError } = await supabase
      .from('project_resource_directories')
      .insert({
        user_id: ctx.userId,
        project_id: (project as any).id,
        execution_target_id: executionTargetId,
        directory_path: directoryPath,
        label,
        is_primary: isPrimary
      })
      .select('id, directory_path, label, is_primary, execution_target_id')
      .single();

    if (resourceError) {
      const warning =
        resourceError.code === '23505'
          ? 'Project created; directory was already registered for this project on this device.'
          : `Project created, but directory registration failed: ${resourceError.message}`;
      return toolOk({
        project: {
          id: (project as any).id,
          name: (project as any).name,
          organizationId: (project as any).organization_id
        },
        resource: null,
        warning
      });
    }

    resource = {
      id: (inserted as any).id,
      directoryPath: (inserted as any).directory_path,
      label: (inserted as any).label ?? null,
      isPrimary: (inserted as any).is_primary,
      executionTargetId: (inserted as any).execution_target_id
    };
  }

  return toolOk({
    project: {
      id: (project as any).id,
      name: (project as any).name,
      organizationId: (project as any).organization_id
    },
    resource
  });
}
