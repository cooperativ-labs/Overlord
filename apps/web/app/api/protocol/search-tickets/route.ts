import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { searchTickets } from '@/lib/helpers/ticket-search';
import { resolveProjectIdOrName } from '@/lib/overlord/resolve-project';
import { searchTicketsSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, searchTicketsSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId } = parsed.tokenContext;

    let resolvedProjectId = parsed.data.projectId;
    if (resolvedProjectId) {
      const project = await resolveProjectIdOrName(supabase, organizationId, resolvedProjectId);
      if (!project) {
        return NextResponse.json(
          { error: `Project not found: ${resolvedProjectId}` },
          { status: 404 }
        );
      }
      resolvedProjectId = project.id;
    }

    const { data, error } = await searchTickets(supabase, {
      includeCompleted: parsed.data.includeCompleted,
      limit: parsed.data.limit,
      organizationId,
      query: parsed.data.query,
      statuses: parsed.data.statuses,
      projectId: resolvedProjectId,
      createdBy: parsed.data.createdBy,
      updatedAfter: parsed.data.updatedAfter,
      updatedBefore: parsed.data.updatedBefore
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      tickets: data ?? [],
      count: data?.length ?? 0
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
