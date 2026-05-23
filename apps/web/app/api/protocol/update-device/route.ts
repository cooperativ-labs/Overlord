import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
import { updateDeviceSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateDeviceSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { deviceFingerprint, label } = parsed.data;

    const executionTargetId = await findExecutionTargetByFingerprint(supabase, {
      organizationId,
      userId,
      deviceFingerprint
    });

    if (!executionTargetId) {
      return NextResponse.json(
        {
          error: 'Execution target not found. Call get-device first to register this target.',
          hint: 'Run `ovld protocol get-device` to register and identify your execution target.'
        },
        { status: 404 }
      );
    }

    const { data: updated, error } = await (supabase as any)
      .from('organization_execution_targets')
      .update({ label, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('execution_target_id', executionTargetId)
      .select('execution_target_id, label, execution_targets(host, platform)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: `The label "${label}" is already in use by another device in this organization.`
          },
          { status: 409 }
        );
      }
      if (error.code === '23514') {
        return NextResponse.json(
          {
            error:
              'Invalid device label: use lowercase kebab-case only (letters, numbers, hyphens; 1–64 characters).'
          },
          { status: 400 }
        );
      }
      return internalErrorResponse(error);
    }

    const target = Array.isArray(updated.execution_targets)
      ? updated.execution_targets[0]
      : updated.execution_targets;

    return NextResponse.json({
      device: {
        id: updated.execution_target_id,
        executionTargetId: updated.execution_target_id,
        label: updated.label,
        hostname: target?.host ?? null,
        platform: target?.platform ?? null
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
