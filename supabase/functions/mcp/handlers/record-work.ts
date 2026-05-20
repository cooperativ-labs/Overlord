/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import path from 'node:path';

import { type TokenContext } from '../auth.ts';
import { scheduleGenerateFeedPost } from '../helpers/invoke-generate-feed-post.ts';
import { toolErr, toolOk } from '../rpc.ts';

import { insertChangeRationales } from './_change-rationales.ts';
import { upsertDeviceFromProtocol } from './_device-upsert.ts';
import { insertOrderedObjectives, normalizeObjectivesInput } from './_objectives.ts';
import { resolvePreferredStatusNameByType } from './_status-resolution.ts';
import { resolveTicketCreatorUserId } from './_ticket-creator.ts';

type ProjectUserJoinRow = {
  local_working_directory: string | null;
  projects: { id: string; name: string; organization_id: number } | null;
};

type ResourceDirectoryRow = {
  directory_path: string;
  device_id: string | null;
  projects: { id: string; name: string; organization_id: number } | null;
};

function normalizeDirPath(dir: string): string {
  let normalized = dir.trim();
  if (normalized.startsWith('~')) {
    const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '';
    normalized = home + normalized.slice(1);
  }
  normalized = path.resolve(normalized);
  if (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.replace(/[/\\]+$/, '');
  }
  return normalized.toLowerCase();
}

function pickBestPathMatch<T>(
  rows: T[],
  normalizedCwd: string,
  getPath: (row: T) => string | null | undefined
): T | null {
  const exact = rows.find(row => {
    const p = getPath(row);
    return p ? normalizeDirPath(p) === normalizedCwd : false;
  });
  if (exact) return exact;
  let best: { row: T; length: number } | null = null;
  for (const row of rows) {
    const p = getPath(row);
    if (!p) continue;
    const normalizedDir = normalizeDirPath(p);
    if (normalizedCwd.startsWith(normalizedDir + '/')) {
      if (!best || normalizedDir.length > best.length) {
        best = { row, length: normalizedDir.length };
      }
    }
  }
  return best?.row ?? null;
}

async function resolveProjectByWorkingDirectory(
  supabase: SupabaseClient,
  organizationId: number,
  workingDirectory: string,
  userId: string | null,
  deviceId: string | null
) {
  const normalizedCwd = normalizeDirPath(workingDirectory);

  if (userId) {
    if (deviceId) {
      const { data } = await supabase
        .from('project_resource_directories')
        .select('directory_path, device_id, projects!inner(id, name, organization_id)')
        .eq('user_id', userId)
        .eq('device_id', deviceId)
        .eq('projects.organization_id', organizationId);
      const rows = (data ?? []) as unknown as ResourceDirectoryRow[];
      const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
      if (match?.projects) return match.projects;
    }

    const { data } = await supabase
      .from('project_resource_directories')
      .select('directory_path, device_id, projects!inner(id, name, organization_id)')
      .eq('user_id', userId)
      .eq('projects.organization_id', organizationId);
    const rows = (data ?? []) as unknown as ResourceDirectoryRow[];
    const match = pickBestPathMatch(rows, normalizedCwd, r => r.directory_path);
    if (match?.projects) return match.projects;
  }

  let query = supabase
    .from('project_user')
    .select('local_working_directory, projects!inner(id, name, organization_id)')
    .eq('projects.organization_id', organizationId)
    .not('local_working_directory', 'is', null);
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as ProjectUserJoinRow[];
  const match = pickBestPathMatch(rows, normalizedCwd, r => r.local_working_directory);
  if (match?.projects) return match.projects;
  return null;
}

function resolveTicketDelegate(
  delegate: string | null | undefined,
  modelIdentifier: string | null | undefined,
  agentIdentifier: string | null | undefined
) {
  return delegate?.trim() || modelIdentifier?.trim() || agentIdentifier?.trim() || null;
}

export async function handleRecordWork(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    title = '',
    objectives: rawObjectives,
    summary,
    artifacts = [],
    changeRationales = [],
    acceptanceCriteria = '',
    availableTools = '',
    priority = 'medium',
    projectId: explicitProjectId,
    personal = false,
    workingDirectory,
    delegate = null,
    agentIdentifier = 'unknown',
    metadata = {},
    deviceFingerprint = null,
    deviceHostname = null,
    devicePlatform = null
  } = args;

  let objectives;
  try {
    objectives = normalizeObjectivesInput({ objectives: rawObjectives });
  } catch (error) {
    return toolErr(error instanceof Error ? error.message : String(error));
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    return toolErr('summary is required.');
  }

  const { organizationId } = ctx;

  let deviceId: string | null = null;
  if (ctx.userId && typeof deviceFingerprint === 'string' && deviceFingerprint.trim()) {
    deviceId = await upsertDeviceFromProtocol(supabase, {
      organizationId,
      userId: ctx.userId,
      deviceFingerprint: deviceFingerprint.trim(),
      hostname: typeof deviceHostname === 'string' ? deviceHostname : null,
      platform: typeof devicePlatform === 'string' ? devicePlatform : null
    });
  }

  // Project resolution
  let resolvedProjectId: string | undefined = explicitProjectId;
  if (
    !personal &&
    !resolvedProjectId &&
    typeof workingDirectory === 'string' &&
    workingDirectory.trim()
  ) {
    const matched = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory,
      ctx.userId ?? null,
      deviceId
    );
    resolvedProjectId = matched?.id;
  }
  if (!personal && !resolvedProjectId) {
    return toolErr(
      'Could not resolve project. Pass projectId explicitly, set workingDirectory, or pass personal: true.'
    );
  }

  const nextTitle =
    (typeof title === 'string' ? title : '').trim() || objectives[0].objective.slice(0, 120);
  const createdBy = await resolveTicketCreatorUserId(supabase, ctx);
  const modelIdentifier =
    metadata && typeof metadata === 'object' && typeof metadata.model === 'string'
      ? metadata.model
      : null;
  const ticketDelegate = resolveTicketDelegate(delegate, modelIdentifier, agentIdentifier);
  const reviewStatusName = await resolvePreferredStatusNameByType(
    supabase,
    organizationId,
    'review'
  );

  // Top of review column
  const { data: headTickets } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', reviewStatusName)
    .order('board_position', { ascending: true })
    .limit(1);
  const topBoardPosition = (headTickets?.[0]?.board_position ?? 0) - 1;

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: acceptanceCriteria || null,
      available_tools: availableTools,
      board_position: topBoardPosition,
      created_by: createdBy,
      delegate: ticketDelegate,
      execution_target: 'agent',
      is_read: false,
      organization_id: organizationId,
      priority,
      project_id: personal ? null : (resolvedProjectId ?? null),
      status: reviewStatusName,
      title: nextTitle
    })
    .select('id,ticket_id,organization_id,project_id,execution_target,status,ticket_sequence')
    .single();
  if (ticketError || !ticket) return toolErr(ticketError?.message ?? 'Failed to create ticket.');

  const completedAt = new Date().toISOString();
  const { data: objectiveRow, error: objectiveError } = await supabase
    .from('objectives')
    .insert({
      agent_identifier: agentIdentifier,
      completed_at: completedAt,
      created_by: createdBy,
      model_identifier: modelIdentifier,
      objective: objectives[0].objective,
      state: 'complete',
      ticket_id: ticket.id
    })
    .select('id')
    .single();
  if (objectiveError || !objectiveRow) {
    return toolErr(objectiveError?.message ?? 'Ticket created but failed to create objective.');
  }

  const queuedObjectives =
    objectives.length > 1
      ? await insertOrderedObjectives(supabase, ticket.id, objectives.slice(1), {
          createdBy,
          firstState: 'future',
          followingState: 'future'
        })
      : [];

  const sessionKey = crypto.randomUUID();
  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: 'mcp',
      detached_at: completedAt,
      metadata,
      session_key: sessionKey,
      session_state: 'completed',
      ticket_id: ticket.id
    })
    .select('id,session_key,session_state')
    .single();
  if (sessionError || !session) return toolErr('Failed to create session record.');

  const { data: event, error: eventError } = await supabase
    .from('ticket_events')
    .insert({
      created_by: createdBy,
      event_type: 'deliver',
      payload: { created_via: 'mcp.record_work' },
      phase: 'deliver',
      session_id: session.id,
      summary,
      ticket_id: ticket.id
    })
    .select('id')
    .single();
  if (eventError || !event) {
    return toolErr(eventError?.message ?? 'Failed to record deliver event.');
  }

  if (Array.isArray(changeRationales) && changeRationales.length > 0) {
    const withObjective = changeRationales.map((r: any) => ({
      ...r,
      objective_id: r?.objective_id ?? objectiveRow.id
    }));
    const result = await insertChangeRationales(supabase, {
      changeRationales: withObjective,
      eventId: event.id,
      sessionId: session.id,
      ticketId: ticket.id
    });
    if (result.error) console.error('[mcp:record-work] change rationale error:', result.error);
  }

  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const artifactRows = artifacts.map((artifact: any) => ({
      artifact_type: artifact.type,
      content: artifact.content ?? null,
      created_by: createdBy,
      event_id: event.id,
      label: artifact.label,
      metadata: artifact.metadata ?? {},
      session_id: session.id,
      ticket_id: ticket.id,
      uri: artifact.uri ?? null
    }));
    const { error: artifactError } = await supabase.from('artifacts').insert(artifactRows);
    if (artifactError) console.error('[mcp:record-work] artifact error:', artifactError.message);
  }

  await supabase.from('ticket_events').insert({
    created_by: createdBy,
    event_type: 'status_change',
    phase: 'review',
    session_id: session.id,
    summary: 'Work recorded from chat and moved to review.',
    ticket_id: ticket.id
  });

  scheduleGenerateFeedPost({
    supabase,
    ticketId: ticket.id,
    sessionId: session.id,
    organizationId,
    logPrefix: '[mcp:record-work]'
  });

  return toolOk({
    ok: true,
    ticket: {
      id: ticket.id,
      ticketId: ticket.ticket_id,
      title: nextTitle,
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      personal: ticket.project_id === null,
      status: ticket.status,
      executionTarget: ticket.execution_target
    },
    objective: { id: objectiveRow.id, state: 'complete' },
    objectives: [{ id: objectiveRow.id, state: 'complete' }, ...queuedObjectives],
    session: { id: session.id, sessionKey: session.session_key, state: session.session_state },
    artifactCount: Array.isArray(artifacts) ? artifacts.length : 0,
    changeRationaleCount: Array.isArray(changeRationales) ? changeRationales.length : 0
  });
}
