import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { ACTIVE_REQUEST_STATUSES } from '@/lib/overlord/execution-requests';
import { clearExecutionRequestsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, clearExecutionRequestsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const now = new Date().toISOString();
    let query = supabase
      .from('execution_requests')
      .update({
        status: 'failed',
        failed_at: now,
        claimed_by_execution_target_id: null,
        claimed_at: null,
        lease_expires_at: null,
        last_error: parsed.data.clearAll
          ? 'Execution request cleared from runner queue.'
          : 'Execution request cleared for objective.'
      })
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .in('status', ACTIVE_REQUEST_STATUSES as unknown as string[]);

    if (parsed.data.projectId) {
      query = query.eq('project_id', parsed.data.projectId);
    }
    if (parsed.data.objectiveId) {
      query = query.eq('objective_id', parsed.data.objectiveId);
    }

    const { data: requests, error } = await query.select('*');
    if (error) return internalErrorResponse(error);

    return NextResponse.json({
      clearedCount: requests?.length ?? 0,
      requests: requests ?? []
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
