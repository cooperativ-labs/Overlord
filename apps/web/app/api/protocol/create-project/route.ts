import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  createProjectRecord,
  registerProjectResourceDirectory
} from '@/lib/overlord/project-provisioning';
import { createProjectSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, createProjectSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const {
      name,
      color,
      directoryPath,
      label,
      isPrimary,
      deviceFingerprint,
      deviceHostname,
      devicePlatform,
      devicePort
    } = parsed.data;

    const supabase = createServiceRoleClient();

    let project;
    try {
      project = await createProjectRecord({
        supabase,
        organizationId,
        name,
        color
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to create project.' },
        { status: 400 }
      );
    }

    // One-step directory registration: when a directory is supplied, link it to
    // the freshly created project as a (default-primary) resource for this device.
    let resource = null;
    if (directoryPath && deviceFingerprint) {
      try {
        const registered = await registerProjectResourceDirectory({
          supabase,
          organizationId,
          projectId: project.id,
          userId,
          directoryPath,
          deviceFingerprint,
          isPrimary: isPrimary ?? true,
          label: label ?? null,
          deviceHostname: deviceHostname ?? null,
          devicePlatform: devicePlatform ?? null,
          devicePort: devicePort ?? null
        });
        resource = {
          id: registered.id,
          directoryPath,
          isPrimary: registered.isPrimary,
          executionTargetId: registered.executionTargetId,
          alreadyRegistered: registered.alreadyRegistered
        };
      } catch (error) {
        // The project exists; surface the resource failure without losing it.
        return NextResponse.json(
          {
            project: {
              id: project.id,
              name: project.name,
              organizationId: project.organization_id
            },
            resource: null,
            error:
              error instanceof Error
                ? `Project created, but directory registration failed: ${error.message}`
                : 'Project created, but directory registration failed.'
          },
          { status: 207 }
        );
      }
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        organizationId: project.organization_id
      },
      resource
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
