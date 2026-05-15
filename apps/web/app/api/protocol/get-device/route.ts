import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { getDeviceSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, getDeviceSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { deviceFingerprint, deviceHostname, devicePlatform } = parsed.data;

    const deviceId = await upsertDeviceFromProtocol(supabase, {
      organizationId,
      userId,
      deviceFingerprint,
      hostname: deviceHostname ?? null,
      platform: devicePlatform ?? null
    });

    if (!deviceId) {
      return NextResponse.json({ error: 'Failed to register device.' }, { status: 500 });
    }

    const { data: device, error } = await supabase
      .from('devices')
      .select('id, label, hostname, platform, last_seen_at, created_at')
      .eq('id', deviceId)
      .single();

    if (error || !device) {
      return NextResponse.json({ error: 'Device not found.' }, { status: 404 });
    }

    return NextResponse.json({
      device: {
        id: device.id,
        label: device.label,
        hostname: device.hostname,
        platform: device.platform,
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
