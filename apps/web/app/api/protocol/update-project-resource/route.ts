import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { updateProjectResourceSchema } from '@/lib/overlord/validation';
import {
  assertCanManagePrimary,
  clearTargetPrimary
} from '@/lib/resource-directories/primary-resource';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateProjectResourceSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { resourceId, directoryPath, label, isPrimary } = parsed.data;

    const { data: existing } = await (supabase as any)
      .from('project_resource_directories')
      .select('id, project_id, execution_target_id')
      .eq('id', resourceId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Resource not found.' }, { status: 404 });
    }

    // Authorization is target-ownership-based, not "your own row": on a shared
    // target the primary is shared, so anyone who can manage the (project,
    // target) may update its directories.
    try {
      await assertCanManagePrimary(supabase, {
        userId,
        projectId: existing.project_id,
        executionTargetId: existing.execution_target_id
      });
    } catch (authError) {
      return NextResponse.json(
        { error: authError instanceof Error ? authError.message : 'Not authorized.' },
        { status: 403 }
      );
    }

    // If setting as primary, clear the other primary for this (project, target) first.
    if (isPrimary) {
      await clearTargetPrimary(supabase, existing.project_id, existing.execution_target_id);
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
