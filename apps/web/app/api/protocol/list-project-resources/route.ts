import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { listProjectResourcesSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listProjectResourcesSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { userId, organizationId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { projectId, deviceFingerprint } = parsed.data;

    let deviceId: string | null = null;
    if (deviceFingerprint) {
      const { data: device } = await supabase
        .from('devices')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('device_fingerprint', deviceFingerprint)
        .maybeSingle();
      deviceId = (device as { id: string } | null)?.id ?? null;
    }

    let query = supabase
      .from('project_resource_directories')
      .select('id, directory_path, label, is_primary, device_id, devices(label, hostname)')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (deviceId) {
      query = query.eq('device_id', deviceId);
    }

    const { data, error } = await query;
    if (error) return internalErrorResponse(error);

    const resources = (data ?? []).map(
      (row: {
        id: string;
        directory_path: string;
        label: string | null;
        is_primary: boolean;
        device_id: string | null;
        devices:
          | { label: string | null; hostname: string | null }
          | { label: string | null; hostname: string | null }[]
          | null;
      }) => {
        const deviceRel = row.devices;
        const device = Array.isArray(deviceRel) ? deviceRel[0] : deviceRel;
        const deviceLabel = device?.label ?? null;
        const deviceHostname = device?.hostname ?? null;
        return {
          id: row.id,
          directoryPath: row.directory_path,
          label: row.label,
          isPrimary: row.is_primary,
          deviceId: row.device_id,
          deviceLabel,
          deviceHostname
        };
      }
    );

    return NextResponse.json({ resources });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
