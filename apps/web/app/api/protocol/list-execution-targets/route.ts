import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { listExecutionTargetsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listExecutionTargetsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { data: userTargets, error } = await supabase
      .from('user_execution_targets')
      .select(
        'execution_target_id, execution_targets!inner(id, host, platform, transport, is_placeholder, last_seen_at)'
      )
      .eq('user_id', userId)
      .eq('access_status', 'active');

    if (error) return internalErrorResponse(error);

    const targetIds = (userTargets ?? []).map(ut => ut.execution_target_id).filter(Boolean);

    const { data: orgTargets } =
      targetIds.length === 0
        ? { data: [] }
        : await supabase
            .from('organization_execution_targets')
            .select('execution_target_id,label')
            .eq('organization_id', organizationId)
            .in('execution_target_id', targetIds);

    const labelByTargetId = new Map(
      (orgTargets ?? []).map(ot => [ot.execution_target_id, ot.label])
    );

    const targets = (userTargets ?? []).map(ut => {
      const et = Array.isArray(ut.execution_targets)
        ? ut.execution_targets[0]
        : ut.execution_targets;
      return {
        id: ut.execution_target_id,
        label: labelByTargetId.get(ut.execution_target_id) ?? null,
        host: et?.host ?? null,
        platform: et?.platform ?? null,
        transport: et?.transport ?? null,
        is_placeholder: et?.is_placeholder ?? null,
        last_seen_at: et?.last_seen_at ?? null
      };
    });

    return NextResponse.json({ targets });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
