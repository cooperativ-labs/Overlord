import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getAgentApiToken, getPlatformUrl } from '@/lib/env';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { ensureAgentToken } from '@/lib/overlord/protocol-auth';
import { buildTicketPromptMarkdown } from '@/lib/overlord/ticket-prompt';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const authError = ensureAgentToken(request);
    if (authError) return authError;

    const { ticketId } = await params;
    const supabase = createServiceRoleClient();

    const { data: ticket, error } = await supabase
      .from('tickets')
      // Use '*' to stay compatible with local DBs that may be behind on migrations.
      // Strict column selection here can 500 when newer columns are missing.
      .select('*')
      .eq('id', ticketId)
      .single();

    if (error || !ticket) {
      return NextResponse.json(
        { error: error?.message ?? 'Ticket not found.' },
        { status: error?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    // Look up the project's local working directory if the ticket has a project
    let workingDirectory: string | null = null;
    if (ticket.project_id) {
      const { data: project } = await supabase
        .from('projects')
        .select('local_working_directory')
        .eq('id', ticket.project_id)
        .maybeSingle();
      workingDirectory = project?.local_working_directory ?? null;
    }

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
