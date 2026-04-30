import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runSpawnProtocol } from '@/lib/overlord/protocol-spawn';
import { spawnSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, spawnSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const {
      title,
      objective,
      acceptanceCriteria,
      availableTools,
      executionTarget,
      priority,
      projectId,
      personal,
      workingDirectory,
      delegate,
      parentSessionKey,
      parentTicketId,
      agentIdentifier,
      connectionMethod,
      metadata
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    const result = await runSpawnProtocol(supabase, {
      title,
      objective,
      acceptanceCriteria,
      availableTools,
      executionTarget,
      priority,
      projectId,
      personal,
      workingDirectory,
      delegate,
      parentSessionKey,
      parentTicketId,
      agentIdentifier,
      modelIdentifier: typeof metadata?.model === 'string' ? metadata.model : null,
      connectionMethod,
      metadata: metadata as Record<string, never>,
      organizationId,
      userId
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
