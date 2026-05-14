import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runRecordWorkProtocol } from '@/lib/overlord/protocol-record-work';
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
      objective,
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
      metadata
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    const result = await runRecordWorkProtocol(supabase, {
      title,
      objective,
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
