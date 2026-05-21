import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { failExecutionLaunchSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, failExecutionLaunchSchema);
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

    const failedAt = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('execution_requests')
      .update({
        status: 'failed',
        failed_at: failedAt,
        lease_expires_at: null,
        last_error: parsed.data.error
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

    await supabase.from('ticket_events').insert({
      event_type: 'execution_launch_failed',
      phase: 'execute',
      summary: `Runner failed to launch objective: ${parsed.data.error}`.slice(0, 2000),
      ticket_id: updated.ticket_id,
      objective_id: updated.objective_id,
      created_by: userId,
      payload: {
        execution_request_id: updated.id,
        device_id: device.id
      }
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
