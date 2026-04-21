import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { deriveTitleFromObjective, getTicketIdentifier } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import { resolveAgentToken } from '@/lib/overlord/protocol-auth';
import { resolveProtocolTicketCreatorUserId } from '@/lib/overlord/protocol-ticket-creator';
import { resolveProjectByWorkingDirectory } from '@/lib/overlord/resolve-project';
import { createStandaloneTicketSchema } from '@/lib/overlord/validation';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const authResult = await resolveAgentToken(request);
  if (authResult.error) return authResult.error;

  const { organizationId, tokenId, tokenValue, userId } = authResult.context;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = createStandaloneTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.' },
      { status: 400 }
    );
  }

  try {
    const {
      acceptanceCriteria,
      availableTools,
      delegate,
      executionTarget,
      objective,
      priority,
      projectId,
      workingDirectory,
      title
    } = parsed.data;

    const supabase = createServiceRoleClient();
    const createdBy = await resolveProtocolTicketCreatorUserId(supabase, {
      userId,
      tokenId,
      tokenValue
    });

    // Resolve project_id — use provided projectId, then try workingDirectory,
    // then fall back to first project in org.
    // Ticket organization_id follows the selected project so the CLI can treat
    // the project choice as the source of truth.
    let resolvedProjectId: string | null = projectId ?? null;
    let resolvedOrganizationId: number | null = null;

    if (resolvedProjectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id,organization_id')
        .eq('id', resolvedProjectId)
        .single();

      resolvedProjectId = project?.id ?? null;
      resolvedOrganizationId = project?.organization_id ?? null;
    }

    if (!resolvedProjectId && workingDirectory) {
      const matched = await resolveProjectByWorkingDirectory(
        supabase,
        organizationId,
        workingDirectory
      );
      if (matched) {
        resolvedProjectId = matched.id;
        resolvedOrganizationId = matched.organization_id;
      }
    }

    if (!resolvedProjectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id,organization_id')
        .eq('organization_id', organizationId)
        .order('id', { ascending: true })
        .limit(1)
        .single();
      resolvedProjectId = project?.id ?? null;
      resolvedOrganizationId = project?.organization_id ?? null;
    }

    if (!resolvedProjectId || !resolvedOrganizationId) {
      return NextResponse.json(
        { error: 'No project found for this organization.' },
        { status: 400 }
      );
    }

    if (resolvedOrganizationId !== organizationId) {
      return NextResponse.json(
        { error: 'Selected project is not available to this token.' },
        { status: 403 }
      );
    }

    const nextTitle = title.trim() || deriveTitleFromObjective(objective);
    const draftStatusName = await resolvePreferredStatusNameByType(
      supabase,
      resolvedOrganizationId,
      'draft'
    );

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .insert({
        acceptance_criteria: acceptanceCriteria || null,
        available_tools: availableTools,
        created_by: createdBy,
        delegate: delegate || null,
        execution_target: executionTarget,
        organization_id: resolvedOrganizationId,
        priority,
        project_id: resolvedProjectId,
        status: draftStatusName,
        title: nextTitle
      })
      .select('id, organization_id, project_id, execution_target, status')
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: ticketError?.message ?? 'Failed to create ticket.' },
        { status: 500 }
      );
    }

    await upsertDraftObjective(supabase, ticket.id, objective);

    return NextResponse.json({
      ok: true,
      ticket: {
        executionTarget: ticket.execution_target,
        id: ticket.id,
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        reference: getTicketIdentifier(ticket.id),
        status: ticket.status,
        title: nextTitle
      }
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
