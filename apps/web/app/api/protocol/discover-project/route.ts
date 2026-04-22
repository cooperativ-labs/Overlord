import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
import { discoverProjectSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, discoverProjectSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    const { workingDirectory } = parsed.data;

    const project = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory,
      userId
    );

    if (!project) {
      return NextResponse.json(
        {
          error: 'No project found matching this working directory.',
          hint:
            'Set the "Local working directory" field in your project settings ' +
            'to the absolute path of this repository.'
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
