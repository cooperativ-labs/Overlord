import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { ensureProjectExecutionTarget } from '@/lib/overlord/execution-targets';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { addProjectResourceSchema } from '@/lib/overlord/validation';
import {
  assertCanManagePrimary,
  clearTargetPrimary,
  shouldAutoPrimary
} from '@/lib/resource-directories/primary-resource';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, addProjectResourceSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const {
      projectId,
      directoryPath,
      label,
      isPrimary,
      deviceFingerprint,
      deviceHostname,
      devicePlatform,
      devicePort
    } = parsed.data;

    // Verify the project belongs to the organization
    const { data: project } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const executionTargetId = await upsertDeviceFromProtocol(supabase, {
      organizationId,
      userId,
      deviceFingerprint,
      hostname: deviceHostname ?? null,
      port: devicePort ?? null,
      platform: devicePlatform ?? null
    });

    if (!executionTargetId) {
      return NextResponse.json({ error: 'Failed to register execution target.' }, { status: 500 });
    }

    await ensureProjectExecutionTarget(supabase, {
      projectId,
      organizationId,
      userId,
      executionTargetId
    });

    try {
      await assertCanManagePrimary(supabase, { userId, projectId, executionTargetId });
    } catch (authError) {
      return NextResponse.json(
        { error: authError instanceof Error ? authError.message : 'Not authorized.' },
        { status: 403 }
      );
    }

    const shouldSetPrimary =
      isPrimary ??
      (await shouldAutoPrimary(supabase, {
        projectId,
        executionTargetId
      }));

    // Clear existing primary for this project on this execution target.
    if (shouldSetPrimary) {
      await clearTargetPrimary(supabase, projectId, executionTargetId);
    }

    const { data: inserted, error } = await (supabase as any)
      .from('project_resource_directories')
      .insert({
        user_id: userId,
        project_id: projectId,
        execution_target_id: executionTargetId,
        directory_path: directoryPath,
        label: label?.trim() || null,
        is_primary: shouldSetPrimary
      })
      .select('id, directory_path, label, is_primary, execution_target_id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This directory is already registered for this project on this device.' },
          { status: 409 }
        );
      }
      return internalErrorResponse(error);
    }

    return NextResponse.json({
      resource: {
        id: inserted.id,
        directoryPath: inserted.directory_path,
        label: inserted.label,
        isPrimary: inserted.is_primary,
        deviceId: inserted.execution_target_id,
        executionTargetId: inserted.execution_target_id
      },
      project: {
        id: project.id,
        name: project.name
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
