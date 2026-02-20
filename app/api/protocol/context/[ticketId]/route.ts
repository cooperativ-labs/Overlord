import { NextResponse } from 'next/server';

import { getAgentApiToken, getPlatformUrl } from '@/lib/env';
import { buildLaunchCommands } from '@/lib/orchestrator/launch-commands';
import { ensureAgentToken } from '@/lib/orchestrator/protocol-auth';
import { buildTicketPromptMarkdown } from '@/lib/orchestrator/ticket-prompt';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const authError = ensureAgentToken(request);
  if (authError) return authError;

  const { ticketId } = await params;
  const supabase = createServiceRoleClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, title, objective, acceptance_criteria, available_tools, execution_target, project_id, status, priority'
    )
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return NextResponse.json(
      { error: error?.message ?? 'Ticket not found.' },
      { status: error?.code === 'PGRST116' ? 404 : 500 }
    );
  }

  const platformUrl = getPlatformUrl();
  const markdown = buildTicketPromptMarkdown(ticket, platformUrl);

  return new NextResponse(markdown, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// Convenience: also expose the launch commands so the UI can fetch them
export async function POST(request: Request, { params }: RouteContext) {
  const authError = ensureAgentToken(request);
  if (authError) return authError;

  const { ticketId } = await params;
  const platformUrl = getPlatformUrl();
  const token = getAgentApiToken();
  const { claudeCode, codex, contextUrl } = buildLaunchCommands({
    platformUrl,
    ticketId,
    token
  });

  return NextResponse.json({
    claudeCode,
    codex,
    contextUrl
  });
}
