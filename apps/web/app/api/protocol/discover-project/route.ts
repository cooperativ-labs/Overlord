import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { discoverProjectSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, discoverProjectSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    const { projectId, workingDirectory, deviceFingerprint, deviceHostname, devicePlatform } =
      parsed.data;

    if (projectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id, name, organization_id')
        .eq('id', projectId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (!project) {
        return NextResponse.json(
          { error: 'Project not found or does not belong to this organization.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        project: {
          id: project.id,
          name: project.name,
          organizationId: project.organization_id
        }
      });
    }

    let deviceId: string | null = null;
    if (userId && deviceFingerprint) {
      deviceId = await upsertDeviceFromProtocol(supabase, {
        organizationId,
        userId,
        deviceFingerprint,
        hostname: deviceHostname ?? null,
        platform: devicePlatform ?? null
      });
    }

    const project = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory!,
      userId,
      deviceId
    );

    if (!project) {
      return NextResponse.json(
        {
          error: 'No project found matching this working directory.',
          hint:
            'Add this directory in project settings under "Resource directories", ' +
            'or set the legacy "Local working directory" field.'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        organizationId: project.organization_id
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
