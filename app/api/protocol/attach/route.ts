import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { runAttachProtocol } from '@/lib/overlord/protocol-attach';
import { attachSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const requestStart = Date.now();
  const contentLength = request.headers.get('content-length') ?? 'unknown';

  const parsed = await parseProtocolBody(request, attachSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { ticketId, agentIdentifier, connectionMethod, metadata } = parsed.data;
    const { organizationId } = parsed.tokenContext;

    const result = await runAttachProtocol(supabase, {
      ticketId,
      agentIdentifier,
      connectionMethod,
      metadata: metadata as Record<string, never>,
      organizationId
    });

    const durationMs = Date.now() - requestStart;

    if (result.error) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          endpoint: '/api/protocol/attach',
          method: 'POST',
          ticketId,
          contentLength,
          status: result.status,
          durationMs
        })
      );
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        endpoint: '/api/protocol/attach',
        method: 'POST',
        ticketId,
        contentLength,
        status: 200,
        durationMs
      })
    );
    return NextResponse.json(result.data);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
