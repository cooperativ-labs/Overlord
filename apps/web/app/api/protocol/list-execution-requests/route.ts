import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { ACTIVE_REQUEST_STATUSES } from '@/lib/overlord/execution-requests';
import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
import { listExecutionRequestsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type QueueRow = {
  id: string;
  organization_id: number;
  ticket_id: string;
  objective_id: string;
  project_id: string | null;
  status: string;
  agent_identifier: string;
  target_execution_target_id: string | null;
  claimed_by_execution_target_id: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
};

function visibleToExecutionTarget(request: QueueRow, executionTargetId: string | null) {
  if (!executionTargetId) return true;
  if (request.status === 'queued') {
    return (
      request.target_execution_target_id === null ||
      request.target_execution_target_id === executionTargetId
    );
  }
  return request.claimed_by_execution_target_id === executionTargetId;
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listExecutionRequestsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    let executionTargetId: string | null = null;
    if (parsed.data.deviceFingerprint) {
      executionTargetId = await findExecutionTargetByFingerprint(supabase, {
        organizationId,
        userId,
        deviceFingerprint: parsed.data.deviceFingerprint
      });
      if (!executionTargetId) {
        return NextResponse.json({ error: 'Execution target not found.' }, { status: 404 });
      }
    }

    let query = supabase
      .from('execution_requests')
      .select(
        'id,organization_id,ticket_id,objective_id,project_id,status,agent_identifier,target_execution_target_id,claimed_by_execution_target_id,lease_expires_at,last_error,created_at'
      )
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .in('status', ACTIVE_REQUEST_STATUSES as unknown as string[])
      .order('created_at', { ascending: true });

    if (parsed.data.projectId) {
      query = query.eq('project_id', parsed.data.projectId);
    }

    const { data: requests, error } = await query;
    if (error) return internalErrorResponse(error);

    const filtered = ((requests ?? []) as QueueRow[]).filter(request =>
      visibleToExecutionTarget(request, executionTargetId)
    );

    const ticketIds = [...new Set(filtered.map(request => request.ticket_id))];
    const objectiveIds = [...new Set(filtered.map(request => request.objective_id))];

    const [{ data: tickets }, { data: objectives }] = await Promise.all([
      ticketIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase.from('tickets').select('id,ticket_id,title').in('id', ticketIds),
      objectiveIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase.from('objectives').select('id,objective,title').in('id', objectiveIds)
    ]);

    const ticketsById = new Map((tickets ?? []).map(ticket => [ticket.id, ticket]));
    const objectivesById = new Map((objectives ?? []).map(objective => [objective.id, objective]));

    return NextResponse.json({
      requests: filtered.map(request => ({
        ...request,
        ticket_reference: ticketsById.get(request.ticket_id)?.ticket_id ?? null,
        ticket_title: ticketsById.get(request.ticket_id)?.title ?? null,
        objective_title:
          objectivesById.get(request.objective_id)?.title ??
          objectivesById.get(request.objective_id)?.objective ??
          null
      }))
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
