import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getPlatformUrl } from '@/lib/env';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { resolveAgentToken } from '@/lib/overlord/protocol-auth';
import { buildTicketPromptMarkdown } from '@/lib/overlord/ticket-prompt';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const authResult = await resolveAgentToken(request);
    if (authResult.error) return authResult.error;

    const { organizationId, tokenValue } = authResult.context;
    const { ticketId } = await params;
    const supabase = createServiceRoleClient();

    const { data: ticket, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single();

    if (error || !ticket) {
      return NextResponse.json(
        { error: error?.message ?? 'Ticket not found.' },
        { status: error?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    const { data: project } = await supabase
      .from('projects')
      .select('local_working_directory')
      .eq('id', ticket.project_id)
      .maybeSingle();
    const workingDirectory = project?.local_working_directory ?? null;

    const platformUrl = getPlatformUrl();
    const markdown = buildTicketPromptMarkdown(ticket, platformUrl);

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8'
    };
    if (workingDirectory) {
      headers['X-Working-Directory'] = workingDirectory;
    }

    return new NextResponse(markdown, { headers });
  } catch (error) {
    return internalErrorResponse(error);
  }
}

// Convenience: also expose the launch commands so the UI can fetch them
export async function POST(request: Request, { params }: RouteContext) {
  const authResult = await resolveAgentToken(request);
  if (authResult.error) return authResult.error;

  const { organizationId, tokenValue } = authResult.context;
  const { ticketId } = await params;

  // Verify ticket belongs to this org
  const supabase = createServiceRoleClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('id')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const platformUrl = getPlatformUrl();
  const { claudeCode, codex, contextUrl } = buildLaunchCommands({
    platformUrl,
    ticketId,
    token: tokenValue
  });

  return NextResponse.json({
    claudeCode,
    codex,
    contextUrl
  });
}
