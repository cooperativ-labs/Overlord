import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runRecordWorkProtocol } from '@/lib/overlord/protocol-record-work';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { recordWorkSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, recordWorkSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient() as SupabaseClient<Database>;
    const {
      title,
      objectives,
      summary,
      acceptanceCriteria,
      availableTools,
      priority,
      projectId,
      personal,
      workingDirectory,
      artifacts,
      changeRationales,
      delegate,
      agentIdentifier,
      connectionMethod,
      metadata,
      deviceFingerprint,
      deviceHostname,
      devicePlatform
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    let effectiveOrganizationId = organizationId;
    let effectiveProjectId = projectId;

    if (
      !personal &&
      !effectiveProjectId &&
      workingDirectory &&
      userId &&
      !request.headers.get('x-organization-id')
    ) {
      const { data: memberships, error: membershipError } = await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', userId)
        .order('organization_id', { ascending: true });

      if (membershipError) return internalErrorResponse(membershipError);

      for (const membership of memberships ?? []) {
        const matched = await resolveProjectByWorkingDirectory(
          supabase,
          membership.organization_id,
          workingDirectory,
          userId,
          null
        );
        if (matched) {
          effectiveOrganizationId = matched.organization_id;
          effectiveProjectId = matched.id;
          break;
        }
      }
    }

    let deviceId: string | null = null;
    if (userId && deviceFingerprint) {
      deviceId = await upsertDeviceFromProtocol(supabase, {
        organizationId: effectiveOrganizationId,
        userId,
        deviceFingerprint,
        hostname: deviceHostname ?? null,
        platform: devicePlatform ?? null
      });
    }

    const result = await runRecordWorkProtocol(supabase, {
      title,
      objectives,
      summary,
      acceptanceCriteria,
      availableTools,
      priority,
      projectId: effectiveProjectId,
      personal,
      workingDirectory,
      artifacts,
      changeRationales,
      delegate,
      agentIdentifier,
      modelIdentifier: typeof metadata?.model === 'string' ? metadata.model : null,
      connectionMethod,
      metadata: metadata as Record<string, never>,
      organizationId: effectiveOrganizationId,
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
