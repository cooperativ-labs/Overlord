import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { normalizeRunnerTerminalProfile } from '@/lib/helpers/runner-terminal-settings';
import { createExecutionRequest } from '@/lib/overlord/execution-requests';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { requestExecutionSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, requestExecutionSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const ticketId = await resolveTicketId(parsed.data.ticketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const result = await createExecutionRequest(supabase, {
      ticketId,
      objectiveId: parsed.data.objectiveId ?? null,
      userId,
      organizationId,
      requestedFrom: parsed.data.requestedFrom,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      agentIdentifier: parsed.data.agentIdentifier ?? null,
      modelIdentifier: parsed.data.modelIdentifier ?? null,
      thinkingLevel: parsed.data.thinkingLevel ?? null,
      launchMode: parsed.data.launchMode,
      flags: parsed.data.flags,
      workingDirectory: parsed.data.workingDirectory ?? null,
      sshCommand: parsed.data.sshCommand ?? null,
      remoteWorkingDirectory: parsed.data.remoteWorkingDirectory ?? null,
      serverMultiplexer: parsed.data.serverMultiplexer ?? null,
      tmuxCommand: parsed.data.tmuxCommand ?? null,
      runnerTerminalProfile: parsed.data.runnerTerminalProfile
        ? normalizeRunnerTerminalProfile(parsed.data.runnerTerminalProfile)
        : null,
      targetKind: parsed.data.targetKind,
      targetExecutionTargetId: parsed.data.targetDeviceId ?? null,
      targetResourceId: parsed.data.targetResourceId ?? null
    });

    return NextResponse.json({
      request: result.request,
      ticket: {
        id: result.ticket.id,
        ticketId: result.ticket.ticket_id,
        projectId: result.ticket.project_id
      },
      objective: {
        id: result.objective.id,
        state: result.objective.state
      }
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return internalErrorResponse(error);
  }
}
