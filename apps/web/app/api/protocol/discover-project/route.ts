import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  resolveProjectByWorkingDirectory,
  resolveProjectIdOrName
} from '@/lib/overlord/resolve-project';
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
      const project = await resolveProjectIdOrName(supabase, organizationId, projectId);

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

    let project = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory!,
      userId,
      deviceId
    );

    if (!project && !request.headers.get('x-organization-id') && userId) {
      const { data: memberships, error: membershipError } = await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', userId)
        .order('organization_id', { ascending: true });

      if (membershipError) return internalErrorResponse(membershipError);

      for (const membership of memberships ?? []) {
        if (membership.organization_id === organizationId) continue;
        const matched = await resolveProjectByWorkingDirectory(
          supabase,
          membership.organization_id,
          workingDirectory!,
          userId,
          null
        );
        if (matched) {
          project = matched;
          break;
        }
      }
    }

    if (!project) {
      return NextResponse.json(
        {
          error: 'No project found matching this working directory.',
          hint:
            'Add this directory in project settings under "Resource directories", ' +
            'or run `ovld add-cwd` from the project checkout.'
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
