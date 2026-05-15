import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { updateProjectResourceSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateProjectResourceSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { resourceId, deviceFingerprint, directoryPath, label, isPrimary } = parsed.data;

    // Verify device belongs to this user
    const { data: device } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('device_fingerprint', deviceFingerprint)
      .maybeSingle();

    if (!device) {
      return NextResponse.json(
        {
          error: 'Device not found. Call get-device first to register this device.',
          hint: 'You can only update resources on your own device.'
        },
        { status: 403 }
      );
    }

    // Fetch the resource and verify it belongs to this user and device
    const { data: existing } = await supabase
      .from('project_resource_directories')
      .select('id, project_id, device_id')
      .eq('id', resourceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Resource not found.' }, { status: 404 });
    }

    if (existing.device_id !== device.id) {
      return NextResponse.json(
        { error: 'You can only update resources that belong to your current device.' },
        { status: 403 }
      );
    }

    // If setting as primary, clear others first
    if (isPrimary) {
      await supabase
        .from('project_resource_directories')
        .update({ is_primary: false })
        .eq('user_id', userId)
        .eq('project_id', existing.project_id);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (directoryPath !== undefined) updates.directory_path = directoryPath;
    if (label !== undefined) updates.label = label?.trim() || null;
    if (isPrimary !== undefined) updates.is_primary = isPrimary;

    const { data: updated, error } = await supabase
      .from('project_resource_directories')
      .update(updates)
      .eq('id', resourceId)
      .select('id, directory_path, label, is_primary, device_id')
      .single();

    if (error) return internalErrorResponse(error);

    return NextResponse.json({
      resource: {
        id: updated.id,
        directoryPath: updated.directory_path,
        label: updated.label,
        isPrimary: updated.is_primary,
        deviceId: updated.device_id
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
