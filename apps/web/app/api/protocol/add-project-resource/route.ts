import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { addProjectResourceSchema } from '@/lib/overlord/validation';
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
      devicePlatform
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

    const deviceId = await upsertDeviceFromProtocol(supabase, {
      organizationId,
      userId,
      deviceFingerprint,
      hostname: deviceHostname ?? null,
      platform: devicePlatform ?? null
    });

    if (!deviceId) {
      return NextResponse.json({ error: 'Failed to register device.' }, { status: 500 });
    }

    // Clear existing primary on this device (a device has exactly one primary
    // resource, but may be primary for multiple projects across devices).
    if (isPrimary) {
      await supabase
        .from('project_resource_directories')
        .update({ is_primary: false })
        .eq('user_id', userId)
        .eq('device_id', deviceId);
    }

    const { data: inserted, error } = await supabase
      .from('project_resource_directories')
      .insert({
        user_id: userId,
        project_id: projectId,
        device_id: deviceId,
        directory_path: directoryPath,
        label: label?.trim() || null,
        is_primary: isPrimary ?? false
      })
      .select('id, directory_path, label, is_primary, device_id')
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
        deviceId: inserted.device_id
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
