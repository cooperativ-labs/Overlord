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
import { organizationIdFromTicketId } from '@/lib/overlord/human-ticket-id';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { loadFeedDiscussAppendMarkdown } from '@/lib/overlord/load-feed-discuss-append';
import {
  resolveAgentToken,
  resolveProtocolOrganizationHintForTicketId
} from '@/lib/overlord/protocol-auth';
import { resolveProtocolObjectiveText } from '@/lib/overlord/protocol-context-objective';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { ticketId: rawTicketId } = await params;
    const organizationHint = await resolveProtocolOrganizationHintForTicketId({
      ticketId: rawTicketId
    });
    const authResult = await resolveAgentToken(
      request,
      organizationHint ?? organizationIdFromTicketId(rawTicketId)
    );
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
    const { searchParams } = new URL(request.url);
    const feedPostId = searchParams.get('feedPostId')?.trim() || null;
    const rawInitialQuestion = searchParams.get('initialQuestion') ?? '';
    const initialQuestion =
      rawInitialQuestion.length > 6000
        ? `${rawInitialQuestion.slice(0, 6000)}\n\n_(truncated)_`
        : rawInitialQuestion;
    const context = (searchParams.get('context') ?? undefined) as PromptContext | undefined;
    const launchMode =
      searchParams.get('mode') === 'ask'
        ? ('ask' as PromptLaunchMode)
        : ('run' as PromptLaunchMode);
    const agent = (searchParams.get('agent') ?? undefined) as
      | 'claude'
      | 'codex'
      | 'cursor'
      | 'antigravity'
      | 'opencode'
      | 'pi'
      | undefined;
    const instructionMode = (searchParams.get('instructionMode') ?? 'legacy') as InstructionMode;
    const requestedWorkspace = searchParams.get('workspace')?.trim().toLowerCase();
    const requestOrigin = new URL(request.url).origin;
    const platformUrl = getPlatformUrl(requestOrigin);
    const objectiveResolution = await resolveProtocolObjectiveText({
      supabase,
      ticketId,
      organizationId,
      feedPostId
    });

    if (!objectiveResolution.ok) {
      return NextResponse.json({ error: objectiveResolution.error }, { status: 404 });
    }

    // Managed JJ/git-worktree workspaces are prepared on the **client** (Electron / `ovld`)
    // where `local_working_directory` exists. The API only returns configured paths.

    const resolvedWorkingDirectory =
      requestedWorkspace === 'ssh'
        ? (sshSettings?.remoteWorkingDirectory ?? localWorkingDirectory)
        : localWorkingDirectory;

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

    let feedDiscussTaskMarkdown: string | undefined;
    if (feedPostId && objectiveResolution.feedPostId) {
      const append = await loadFeedDiscussAppendMarkdown({
        supabase,
        ticketId,
        feedPostId: objectiveResolution.feedPostId,
        initialQuestion,
        ticketIntent: {
          humanTicketId: ticket.ticket_id || ticket.id,
          ticketTitle: ticket.title,
          sliceObjectiveText: objectiveResolution.objectiveText,
          acceptanceCriteria: ticket.acceptance_criteria,
          constraints: ticket.constraints,
          executionTarget: ticket.execution_target
        }
      });
      if (!append.ok) {
        return NextResponse.json({ error: append.error }, { status: 404 });
      }
      feedDiscussTaskMarkdown = append.markdown;
    }

    const markdown = buildTicketPromptMarkdown({
      ticket: {
        id: ticket.ticket_id || ticket.id,
        title: ticket.title,
        objective: objectiveResolution.objectiveText,
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
        workingDirectory: resolvedWorkingDirectory,
        launchMode,
        agentConfigs,
        agent,
        instructionMode,
        feedDiscussTaskMarkdown
      }
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8'
    };
    if (resolvedWorkingDirectory) {
      headers['X-Working-Directory'] = resolvedWorkingDirectory;
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
  const organizationHint = await resolveProtocolOrganizationHintForTicketId({
    ticketId: rawTicketId
  });
  const authResult = await resolveAgentToken(
    request,
    organizationHint ?? organizationIdFromTicketId(rawTicketId)
  );
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
  const { claudeCode, codex, cursor, antigravity, opencode, pi, contextUrl } = buildLaunchCommands({
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
    antigravity,
    opencode,
    pi,
    contextUrl,
    ...(mcpUrl ? { mcpUrl } : {})
  });
}
