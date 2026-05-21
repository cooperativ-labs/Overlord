import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
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

    const { data: device } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('device_fingerprint', parsed.data.deviceFingerprint)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: 'Device not found.' }, { status: 404 });

    const { data: updated, error } = await supabase
      .from('execution_requests')
      .update({
        status: 'launched',
        launched_at: new Date().toISOString(),
        launched_session_id: parsed.data.launchedSessionId ?? null,
        lease_expires_at: null,
        last_error: null
      })
      .eq('id', parsed.data.requestId)
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .eq('claimed_by_device_id', device.id)
      .select('*')
      .maybeSingle();

    if (error) return internalErrorResponse(error);
    if (!updated) {
      return NextResponse.json({ error: 'Execution request not found.' }, { status: 404 });
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
