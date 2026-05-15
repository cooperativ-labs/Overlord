import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
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

    const { data: existing } = await supabase
      .from('devices')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('device_fingerprint', deviceFingerprint)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        {
          error: 'Device not found. Call get-device first to register this device.',
          hint: 'Run `ovld protocol get-device` to register and identify your device.'
        },
        { status: 404 }
      );
    }

    const { data: updated, error } = await supabase
      .from('devices')
      .update({ label, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, label, hostname, platform')
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

    return NextResponse.json({
      device: {
        id: updated.id,
        label: updated.label,
        hostname: updated.hostname,
        platform: updated.platform
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
