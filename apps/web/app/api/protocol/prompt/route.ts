import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runSpawnProtocol } from '@/lib/overlord/protocol-spawn';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { spawnSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, spawnSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const {
      title,
      objectives,
      acceptanceCriteria,
      availableTools,
      forHuman,
      priority,
      projectId,
      personal,
      workingDirectory,
      delegate,
      assignedTo,
      parentSessionKey,
      parentTicketId,
      agentIdentifier,
      connectionMethod,
      metadata,
      deviceFingerprint,
      deviceHostname,
      devicePlatform
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

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

    const result = await runSpawnProtocol(supabase, {
      title,
      objectives,
      acceptanceCriteria,
      availableTools,
      forHuman,
      priority,
      projectId,
      personal,
      workingDirectory,
      delegate,
      assignedTo,
      parentSessionKey,
      parentTicketId,
      agentIdentifier,
      modelIdentifier: typeof metadata?.model === 'string' ? metadata.model : null,
      connectionMethod,
      metadata: metadata as Record<string, never>,
      organizationId,
      userId,
      deviceId
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
