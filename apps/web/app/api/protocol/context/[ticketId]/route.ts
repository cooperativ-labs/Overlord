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
import {
  resolveAgentToken,
  resolveProtocolOrganizationHintForTicketId
} from '@/lib/overlord/protocol-auth';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { createSnapshotBackend } from '@/lib/snapshot';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

type RouteContext = { params: Promise<{ ticketId: string }> };

function parseTicketIdParts(
  ticketId: string
): { organizationId: number; ticketSequence: number } | null {
  const [organizationPart, ticketSequencePart, ...rest] = ticketId.trim().split(':');
  if (rest.length > 0) return null;

  const organizationId = Number.parseInt(organizationPart ?? '', 10);
  const ticketSequence = Number.parseInt(ticketSequencePart ?? '', 10);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return null;
  if (!Number.isInteger(ticketSequence) || ticketSequence <= 0) return null;

  return { organizationId, ticketSequence };
}

function organizationIdFromTicketId(ticketId: string): number | null {
  return parseTicketIdParts(ticketId)?.organizationId ?? null;
}

function ticketSequenceFromTicketId(ticketId: string): number | null {
  return parseTicketIdParts(ticketId)?.ticketSequence ?? null;
}

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
    const sessionId = searchParams.get('sessionId')?.trim() || null;
    const requestedWorkspace = searchParams.get('workspace')?.trim().toLowerCase();
    const requestOrigin = new URL(request.url).origin;
    const platformUrl = getPlatformUrl(requestOrigin);
    const ticketSequence = ticketSequenceFromTicketId(ticket.ticket_id || ticket.id);
    const shouldUseManagedSnapshot =
      context === 'electron' &&
      requestedWorkspace !== 'ssh' &&
      Boolean(sessionId) &&
      Boolean(ticket.project_id) &&
      Boolean(localWorkingDirectory) &&
      ticketSequence !== null;
    let snapshotWorkspacePath: string | null = null;
    let snapshotWorkspaceName: string | null = null;
    let snapshotShadowRepoPath: string | null = null;
    let snapshotBackendName: string | null = null;

    if (
      !currentObjective ||
      !currentObjective.objective ||
      currentObjective.objective.trim() === ''
    ) {
      return NextResponse.json({ error: 'No objective found for this ticket.' }, { status: 404 });
    }

    if (shouldUseManagedSnapshot && ticket.project_id && localWorkingDirectory && sessionId) {
      try {
        const snapshotBackend = await createSnapshotBackend({
          projectId: ticket.project_id,
          sourceDirectory: localWorkingDirectory,
          prefer: 'jj'
        });
        const projectSnapshot = await snapshotBackend.prepareProject({
          projectId: ticket.project_id,
          sourceDirectory: localWorkingDirectory,
          gitRemoteUrl: null
        });
        const workspace = await snapshotBackend.createWorkspace({
          baseGitCommitId: null,
          baseJjCommitId: null,
          projectId: ticket.project_id,
          sessionId,
          sourceBinding: projectSnapshot,
          ticketId: ticket.ticket_id || ticket.id,
          ticketSequence: ticketSequence ?? 0
        });
        snapshotWorkspacePath = workspace.workspacePath;
        snapshotWorkspaceName = workspace.workspaceName;
        snapshotShadowRepoPath = workspace.shadowRepoPath;
        snapshotBackendName = workspace.backend;
      } catch (error) {
        console.warn('[protocol/context] snapshot workspace preparation failed:', error);
      }
    }

    const resolvedWorkingDirectory =
      snapshotWorkspacePath ??
      (requestedWorkspace === 'ssh'
        ? (sshSettings?.remoteWorkingDirectory ?? localWorkingDirectory)
        : localWorkingDirectory);

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
        workingDirectory: resolvedWorkingDirectory,
        launchMode,
        agentConfigs,
        agent,
        instructionMode
      }
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8'
    };
    if (resolvedWorkingDirectory) {
      headers['X-Working-Directory'] = resolvedWorkingDirectory;
    }
    if (snapshotWorkspacePath) {
      headers['X-Overlord-Snapshot-Workspace'] = snapshotWorkspacePath;
    }
    if (snapshotBackendName) {
      headers['X-Overlord-Snapshot-Backend'] = snapshotBackendName;
    }
    if (snapshotWorkspacePath && ticket.project_id && localWorkingDirectory && sessionId) {
      headers['X-Overlord-Snapshot-Context'] = JSON.stringify({
        backend: snapshotBackendName ?? 'jj',
        baseGitCommitId: null,
        baseJjCommitId: null,
        projectId: ticket.project_id,
        shadowRepoPath: snapshotShadowRepoPath ?? localWorkingDirectory,
        workspaceName: snapshotWorkspaceName ?? sessionId,
        workspacePath: snapshotWorkspacePath
      });
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
