import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { resolveProjectUserSshSettings } from '@/lib/actions/project-types';
import {
  getProjectUserLocalSettingsByProjectId,
  getProjectUserSshSettingsByProjectId
} from '@/lib/actions/projects';
import { generateAndSetObjectiveTitle, markSubmittedObjectiveExecuting } from '@/lib/objectives';
import { buildPromptContext } from '@/lib/overlord/prompt-context';
import { connectionMethods } from '@/lib/overlord/types';
import { resolvePreferredStatusNameByType, resolveStatusTypeForName } from '@/lib/ticket-statuses';
import type { Database, Json } from '@/types/database.types';

type AttachClient = SupabaseClient<Database>;
type ConnectionMethod = (typeof connectionMethods)[number];
type ObjectiveForCheckpoint = {
  id: string;
  state: string | null;
};

function normalizeDirectoryForComparison(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let normalized = trimmed;
  if (normalized.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    normalized = home + normalized.slice(1);
  }

  normalized = path.resolve(normalized);
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized.toLowerCase();
}

function isMetadataRecord(value: Json): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveSessionWorkingDirectory(input: {
  localWorkingDirectory: string | null | undefined;
  remoteWorkingDirectory: string | null | undefined;
  metadata: Json;
}): string | null {
  const localWorkingDirectory = input.localWorkingDirectory?.trim() || null;
  const remoteWorkingDirectory = input.remoteWorkingDirectory?.trim() || null;

  if (!remoteWorkingDirectory) {
    return localWorkingDirectory;
  }

  const cwdValue =
    isMetadataRecord(input.metadata) && typeof input.metadata.cwd === 'string'
      ? input.metadata.cwd
      : null;

  const normalizedCwd = normalizeDirectoryForComparison(cwdValue);
  const normalizedRemote = normalizeDirectoryForComparison(remoteWorkingDirectory);
  if (
    normalizedCwd &&
    normalizedRemote &&
    (normalizedCwd === normalizedRemote || normalizedCwd.startsWith(`${normalizedRemote}/`))
  ) {
    return remoteWorkingDirectory;
  }

  return localWorkingDirectory ?? remoteWorkingDirectory;
}

async function resolvePendingCheckpointObjectiveIds(input: {
  supabase: AttachClient;
  projectId: string | null;
  objectives: ObjectiveForCheckpoint[];
}): Promise<string[]> {
  const executingObjectiveIds = input.objectives
    .filter(objective => objective.state === 'executing')
    .map(objective => objective.id);
  if (!input.projectId || executingObjectiveIds.length === 0) return [];

  const { data: checkpoints } = await input.supabase
    .from('project_checkpoints')
    .select('objective_id')
    .eq('project_id', input.projectId)
    .in('objective_id', executingObjectiveIds);

  const checkpointedObjectiveIds = new Set(
    (checkpoints ?? []).map(checkpoint => checkpoint.objective_id)
  );
  return executingObjectiveIds.filter(objectiveId => !checkpointedObjectiveIds.has(objectiveId));
}

/**
 * Explicit ticket columns returned to agents — excludes internal fields like search_vector.
 * IMPORTANT: Keep this in sync with supabase/functions/mcp/handlers/attach.ts.
 */
export const TICKET_AGENT_FIELDS =
  'id,title,ticket_id,status,priority,board_position,organization_id,project_id,for_human,context,constraints,available_tools,acceptance_criteria,output_format,created_at,updated_at,ticket_sequence,everhour_task_id,created_by';

export type AttachParams = {
  ticketId: string;
  agentIdentifier: string;
  connectionMethod: ConnectionMethod;
  externalSessionId?: string | null;
  metadata: Json;
  organizationId: number;
  userId: string;
};

/**
 * Core attach protocol logic shared between the REST API route and MCP handler.
 * Returns a result object on success or an error string on failure.
 *
 * The MCP edge function (supabase/functions/mcp/handlers/attach.ts) reimplements
 * this logic because it runs in Deno and cannot import from lib/. Any changes here
 * MUST be mirrored there.
 */
export async function runAttachProtocol(supabase: AttachClient, params: AttachParams) {
  const {
    ticketId,
    agentIdentifier,
    connectionMethod,
    externalSessionId,
    metadata,
    organizationId,
    userId
  } = params;
  const sessionKey = randomUUID();

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select(TICKET_AGENT_FIELDS)
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (ticketError || !ticket) {
    const is404 = ticketError?.code === 'PGRST116';

    if (ticketError && !is404) {
      console.error('[attach] ticket select error:', ticketError.message, ticketError.code);
    }

    return {
      error: 'Ticket not found.',
      status: is404 ? 404 : 500
    } as const;
  }

  const objectiveExecution = await markSubmittedObjectiveExecuting(
    supabase,
    ticketId,
    {
      agentIdentifier,
      metadata
    },
    userId
  );

  if (!objectiveExecution.executedObjectiveId) {
    return { error: 'No objective available for execution.', status: 400 } as const;
  }

  // Detach any prior active session for this objective so the new session
  // satisfies agent_sessions_one_active_per_objective_idx and the next
  // re-attach cleanly replaces the old row.
  await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('objective_id', objectiveExecution.executedObjectiveId)
    .in('session_state', ['attached', 'idle', 'blocked']);

  const { data: executingObjective } = await supabase
    .from('objectives')
    .select('agent_identifier')
    .eq('id', objectiveExecution.executedObjectiveId)
    .single();

  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: executingObjective?.agent_identifier ?? agentIdentifier,
      connection_method: connectionMethod,
      external_session_id: externalSessionId?.trim() || null,
      metadata,
      session_key: sessionKey,
      objective_id: objectiveExecution.executedObjectiveId
    })
    .select('*')
    .single();

  if (sessionError || !session) {
    return { error: 'Failed to create session.', status: 500 } as const;
  }

  // Fire-and-forget: generate objective title immediately without blocking attach
  if (objectiveExecution.didExecute && objectiveExecution.executedObjectiveId) {
    generateAndSetObjectiveTitle(
      supabase,
      objectiveExecution.executedObjectiveId,
      objectiveExecution.executedObjective!,
      userId
    ).catch(err => console.error('[attach] objective title generation failed:', err));
  }

  const previousStatus = ticket.status;
  const previousStatusType = await resolveStatusTypeForName(
    supabase,
    organizationId,
    previousStatus
  );
  const isResumeAfterDelivery =
    previousStatusType === 'review' || previousStatusType === 'complete';
  const executeStatusName = await resolvePreferredStatusNameByType(
    supabase,
    organizationId,
    'execute'
  );

  const { error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({ status: executeStatusName })
    .eq('id', ticketId);

  if (ticketUpdateError) {
    return { error: 'Failed to update ticket status.', status: 500 } as const;
  }

  const { error: attachEventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: { agent_identifier: agentIdentifier, connection_method: connectionMethod },
    phase: previousStatus,
    objective_id: objectiveExecution.executedObjectiveId,
    summary: `${agentIdentifier} attached via ${connectionMethod}.`,
    ticket_id: ticketId,
    created_by: userId
  });

  if (attachEventError) {
    return { error: 'Failed to record attach event.', status: 500 } as const;
  }

  if (isResumeAfterDelivery) {
    const { error: reopenEventError } = await supabase.from('ticket_events').insert({
      event_type: 'ticket_reopened',
      phase: 'execute',
      objective_id: objectiveExecution.executedObjectiveId,
      summary: 'Ticket reopened — resumed from delivered state.',
      ticket_id: ticketId,
      created_by: userId
    });

    if (reopenEventError) {
      return { error: 'Failed to record reopen event.', status: 500 } as const;
    }
  }

  const [
    { data: history },
    { data: artifacts },
    { data: attachments },
    { data: objectives },
    { data: sharedState },
    { data: recentEvents },
    { data: project },
    sshPreferencesByProjectId,
    localSettingsByProjectId,
    { data: profile }
  ] = await Promise.all([
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('event_type', 'deliver')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('artifacts')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('objective_attachments')
      .select('id, label, content_type, file_size, objective_id, storage_path, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('objectives')
      .select('id, objective, state, created_at, auto_advance, position')
      .eq('ticket_id', ticketId)
      .neq('state', 'draft')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('shared_state')
      .select('*')
      .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .neq('event_type', 'system')
      .order('created_at', { ascending: false })
      .limit(12),
    ticket.project_id
      ? supabase.from('projects').select('id').eq('id', ticket.project_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getProjectUserSshSettingsByProjectId(
      supabase,
      userId,
      ticket.project_id ? [ticket.project_id] : []
    ),
    getProjectUserLocalSettingsByProjectId(
      supabase,
      userId,
      ticket.project_id ? [ticket.project_id] : []
    ),
    supabase.from('profiles').select('custom_agent_instructions').eq('id', userId).maybeSingle()
  ]);
  const sshSettings = project
    ? resolveProjectUserSshSettings(sshPreferencesByProjectId.get(project.id))
    : null;
  const localSettings = project ? localSettingsByProjectId.get(project.id) : null;
  const pendingCheckpointObjectiveIds = await resolvePendingCheckpointObjectiveIds({
    supabase,
    projectId: ticket.project_id,
    objectives: objectives ?? []
  });

  const { promptContext, promptContextSections } = buildPromptContext({
    ticket: {
      ...ticket,
      objective: objectiveExecution.executedObjective ?? undefined,
      objective_id: objectiveExecution.executedObjectiveId ?? null
    },
    recentEvents: recentEvents ?? [],
    history: history ?? [],
    artifacts: artifacts ?? [],
    attachments: attachments ?? [],
    objectives: objectives ?? [],
    sharedState: sharedState ?? [],
    customInstructions: profile?.custom_agent_instructions ?? null,
    workingDirectory: resolveSessionWorkingDirectory({
      localWorkingDirectory: localSettings?.local_working_directory ?? null,
      remoteWorkingDirectory: sshSettings?.remoteWorkingDirectory,
      metadata
    })
  });

  return {
    error: null,
    data: {
      history: history ?? [],
      artifacts: artifacts ?? [],
      attachments: attachments ?? [],
      objectives: objectives ?? [],
      session: {
        id: session.id,
        sessionKey: session.session_key,
        state: session.session_state
      },
      sharedState: sharedState ?? [],
      promptContext,
      promptContextSections,
      pendingCheckpointObjectiveIds,
      ticket: {
        ...ticket,
        objective: objectiveExecution.executedObjective ?? undefined,
        objective_id: objectiveExecution.executedObjectiveId ?? null
      }
    }
  } as const;
}
