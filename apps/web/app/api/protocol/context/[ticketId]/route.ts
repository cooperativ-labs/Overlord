// UI-private — not exposed via CLI/MCP by design. GET returns the rendered
// ticket prompt and POST returns prebuilt agent launch commands. Both are
// consumed by the Overlord desktop/web launcher rather than autonomous agents.
import { NextResponse } from 'next/server';

import { internalErrorResponse } from '@/app/api/protocol/_lib';
import { getAllAgentConfigsByUserIdAction } from '@/lib/actions/agent-config';
import { fetchProfileCustomInstructions } from '@/lib/actions/profile-settings';
import { resolveProjectUserSshSettings } from '@/lib/actions/project-types';
import {
  getProjectUserLocalSettingsByProjectId,
  getProjectUserSshSettingsByProjectId
} from '@/lib/actions/projects';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import type { InstructionMode } from '@/lib/overlord/agent-capabilities';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { resolveAgentToken } from '@/lib/overlord/protocol-auth';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };
const TICKET_ID_REGEX = /^(\d+):\d+$/;

function organizationIdFromTicketId(ticketId: string): number | null {
  const match = ticketId.trim().match(TICKET_ID_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { ticketId: rawTicketId } = await params;
    const authResult = await resolveAgentToken(request, organizationIdFromTicketId(rawTicketId));
    if (authResult.error) return authResult.error;

    const { organizationId } = authResult.context;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }
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

    const projectIds = ticket.project_id ? [ticket.project_id] : [];
    const [sshByProject, localByProject] = await Promise.all([
      getProjectUserSshSettingsByProjectId(supabase, authResult.context.userId, projectIds),
      getProjectUserLocalSettingsByProjectId(supabase, authResult.context.userId, projectIds)
    ]);
    const projectUser = ticket.project_id ? sshByProject.get(ticket.project_id) : undefined;
    const sshSettings = resolveProjectUserSshSettings(projectUser);
    const projectUserLocal = ticket.project_id ? localByProject.get(ticket.project_id) : undefined;
    const localWorkingDirectory = projectUserLocal?.local_working_directory ?? null;
    // Prefer the currently executing objective; fall back to submitted.
    // Draft objectives are not exposed on modern schemas, but we keep them as
    // a last resort for older databases that still reject the submitted state.
    const { data: executingObjective } = await supabase
      .from('objectives')
      .select('objective')
      .eq('ticket_id', ticketId)
      .eq('state', 'executing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentObjective =
      executingObjective ??
      (
        await supabase
          .from('objectives')
          .select('objective')
          .eq('ticket_id', ticketId)
          .eq('state', 'submitted')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data ??
      (
        await supabase
          .from('objectives')
          .select('objective')
          .eq('ticket_id', ticketId)
          .eq('state', 'draft')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data;

    const { searchParams } = new URL(request.url);
    const context = (searchParams.get('context') ?? undefined) as PromptContext | undefined;
    const launchMode =
      searchParams.get('mode') === 'ask'
        ? ('ask' as PromptLaunchMode)
        : ('run' as PromptLaunchMode);
    const agent = (searchParams.get('agent') ?? undefined) as
      | 'claude'
      | 'codex'
      | 'cursor'
      | 'gemini'
      | 'opencode'
      | undefined;
    const instructionMode = (searchParams.get('instructionMode') ?? 'legacy') as InstructionMode;
    const requestedWorkspace = searchParams.get('workspace')?.trim().toLowerCase();
    const workingDirectory =
      requestedWorkspace === 'ssh'
        ? (sshSettings?.remoteWorkingDirectory ?? localWorkingDirectory)
        : localWorkingDirectory;
    const requestOrigin = new URL(request.url).origin;
    const platformUrl = getPlatformUrl(requestOrigin);

    if (
      !currentObjective ||
      !currentObjective.objective ||
      currentObjective.objective.trim() === ''
    ) {
      return NextResponse.json({ error: 'No objective found for this ticket.' }, { status: 404 });
    }

    // Use the configured MCP URL when available.
    let mcpUrl: string | undefined;
    try {
      mcpUrl = getOverlordMcpUrl();
    } catch {
      // MCP URL not configured — skip MCP section
    }

    let customInstructions: string | null = null;
    try {
      customInstructions = await fetchProfileCustomInstructions(
        supabase,
        authResult.context.userId
      );
    } catch (error) {
      console.error('Failed to load custom instructions for context prompt:', error);
    }

    let agentConfigs: Record<string, AgentConfig> = {};
    try {
      agentConfigs = await getAllAgentConfigsByUserIdAction(authResult.context.userId, supabase);
    } catch (error) {
      console.error('Failed to load agent configs for context prompt:', error);
    }

    const markdown = buildTicketPromptMarkdown({
      ticket: {
        id: ticket.ticket_id || ticket.id,
        title: ticket.title,
        objective: currentObjective?.objective,
        acceptance_criteria: ticket.acceptance_criteria,
        available_tools: ticket.available_tools,
        constraints: ticket.constraints,
        output_format: ticket.output_format,
        execution_target: ticket.execution_target,
        project_id: ticket.project_id,
        status: ticket.status,
        priority: ticket.priority
      },
      platformUrl,
      context,
      options: {
        mcpUrl,
        customInstructions,
        workingDirectory,
        launchMode,
        agentConfigs,
        agent,
        instructionMode
      }
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8'
    };
    if (workingDirectory) {
      headers['X-Working-Directory'] = workingDirectory;
    }
    const humanTicketId = ticket.ticket_id || ticket.id;
    headers['X-Ticket-Id'] = humanTicketId;

    return new NextResponse(markdown, { headers });
  } catch (error) {
    return internalErrorResponse(error);
  }
}

// Convenience: also expose the launch commands so the UI can fetch them
export async function POST(request: Request, { params }: RouteContext) {
  const { ticketId: rawTicketId } = await params;
  const authResult = await resolveAgentToken(request, organizationIdFromTicketId(rawTicketId));
  if (authResult.error) return authResult.error;

  const { organizationId } = authResult.context;
  const ticketId = await resolveTicketId(rawTicketId, organizationId);
  if (!ticketId) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  // Verify ticket belongs to this org
  const supabase = createServiceRoleClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('id, ticket_id')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
  }

  const requestOrigin = new URL(request.url).origin;
  const platformUrl = getPlatformUrl(requestOrigin);
  const { claudeCode, codex, cursor, gemini, opencode, contextUrl } = buildLaunchCommands({
    platformUrl,
    ticketId: ticket.ticket_id || ticketId,
    organizationId
  });

  // Include the configured MCP URL for agent setup snippets.
  let mcpUrl: string | undefined;
  try {
    mcpUrl = getOverlordMcpUrl();
  } catch {
    // MCP URL not configured
  }

  return NextResponse.json({
    claudeCode,
    codex,
    cursor,
    gemini,
    opencode,
    contextUrl,
    ...(mcpUrl ? { mcpUrl } : {})
  });
}
