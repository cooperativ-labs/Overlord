import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
import { completeExecutionLaunchSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, completeExecutionLaunchSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const executionTargetId = await findExecutionTargetByFingerprint(supabase, {
      organizationId,
      userId,
      deviceFingerprint: parsed.data.deviceFingerprint
    });
    if (!executionTargetId) {
      return NextResponse.json({ error: 'Execution target not found.' }, { status: 404 });
    }

    // Phase 4: a successful child spawn means the launch process STARTED, not
    // that an agent attached. Mark the request `launching` (not `launched`) —
    // attach is the source of truth for `launched`. The claim lease is left in
    // place so a `launching` row whose agent never attaches becomes reclaimable
    // for relaunch after the lease expires.
    const { data: updated, error } = await supabase
      .from('execution_requests')
      .update({
        status: 'launching',
        launched_session_id: parsed.data.launchedSessionId ?? null,
        last_error: null
      })
      .eq('id', parsed.data.requestId)
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .eq('claimed_by_execution_target_id', executionTargetId)
      .eq('status', 'claimed')
      .select('*')
      .maybeSingle();

    if (error) return internalErrorResponse(error);
    if (updated) {
      return NextResponse.json({ request: updated });
    }

    const { data: existing, error: existingError } = await supabase
      .from('execution_requests')
      .select('*')
      .eq('id', parsed.data.requestId)
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .eq('claimed_by_execution_target_id', executionTargetId)
      .in('status', ['launching', 'launched'])
      .maybeSingle();

    if (existingError) return internalErrorResponse(existingError);
    if (existing) {
      return NextResponse.json({ request: existing });
    }

    return NextResponse.json({ error: 'Execution request not found.' }, { status: 404 });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
