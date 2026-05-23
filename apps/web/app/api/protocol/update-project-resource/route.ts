import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
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

    const executionTargetId = await findExecutionTargetByFingerprint(supabase, {
      organizationId,
      userId,
      deviceFingerprint
    });

    if (!executionTargetId) {
      return NextResponse.json(
        {
          error: 'Execution target not found. Call get-device first to register this target.',
          hint: 'You can only update resources on a target you can access.'
        },
        { status: 403 }
      );
    }

    const { data: existing } = await (supabase as any)
      .from('project_resource_directories')
      .select('id, project_id, execution_target_id')
      .eq('id', resourceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Resource not found.' }, { status: 404 });
    }

    if (existing.execution_target_id !== executionTargetId) {
      return NextResponse.json(
        { error: 'You can only update resources that belong to your current execution target.' },
        { status: 403 }
      );
    }

    // If setting as primary, clear the other primary for this project/target first.
    if (isPrimary) {
      await (supabase as any)
        .from('project_resource_directories')
        .update({ is_primary: false })
        .eq('project_id', existing.project_id)
        .eq('execution_target_id', executionTargetId)
        .neq('id', resourceId);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (directoryPath !== undefined) updates.directory_path = directoryPath;
    if (label !== undefined) updates.label = label?.trim() || null;
    if (isPrimary !== undefined) updates.is_primary = isPrimary;

    const { data: updated, error } = await (supabase as any)
      .from('project_resource_directories')
      .update(updates)
      .eq('id', resourceId)
      .select('id, directory_path, label, is_primary, execution_target_id')
      .single();

    if (error) return internalErrorResponse(error);

    return NextResponse.json({
      resource: {
        id: updated.id,
        directoryPath: updated.directory_path,
        label: updated.label,
        isPrimary: updated.is_primary,
        deviceId: updated.execution_target_id,
        executionTargetId: updated.execution_target_id
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
