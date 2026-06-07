import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { insertOrderedObjectives, type OrderedObjectiveInput } from '@/lib/objectives';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { resolveProtocolTicketCreatorUserId } from '@/lib/overlord/protocol-ticket-creator';
import { resolveTicketDelegate } from '@/lib/overlord/protocol-ticket-delegate';
import { resolveAssignedMember } from '@/lib/overlord/resolve-assigned-member';
import {
  resolveProjectByWorkingDirectory,
  resolveProjectIdOrName
} from '@/lib/overlord/resolve-project';
import { connectionMethods } from '@/lib/overlord/types';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import type { Database, Json } from '@/types/database.types';

type RecordClient = SupabaseClient<Database>;
type ConnectionMethod = (typeof connectionMethods)[number];

type ArtifactInput = {
  type: 'next_steps' | 'test_results' | 'migration' | 'decision' | 'note' | 'url';
  label: string;
  uri?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

type ChangeRationaleInput = {
  attribution_source?: string;
  change_kind?: string;
  confidence?: string;
  file_path: string;
  hunks?: unknown;
  impact: string;
  label: string;
  objective_id?: string;
  summary: string;
  why: string;
};

export type RecordWorkParams = {
  title: string;
  objectives: OrderedObjectiveInput[];
  summary: string;
  acceptanceCriteria: string;
  availableTools: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId?: string;
  personal?: boolean;
  workingDirectory?: string;
  artifacts: ArtifactInput[];
  changeRationales: ChangeRationaleInput[];
  delegate?: string;
  assignedTo?: string;
  agentIdentifier: string;
  modelIdentifier?: string | null;
  connectionMethod: ConnectionMethod;
  metadata: Json;
  organizationId: number;
  userId?: string;
  deviceId?: string | null;
};

/**
 * Record completed-from-chat work as a single atomic operation:
 *   1. Resolve project (cwd → projectId → personal fallback).
 *   2. Create ticket in `review` status.
 *   3. Create objective directly in `complete` state.
 *   4. Create a session marked completed (so artifacts/file_changes have a session_id).
 *   5. Insert deliver event + artifacts + file_changes.
 *   6. Trigger feed-post generation.
 *
 * Unlike `spawn`/`prompt`, no agent session is left open — the work is already done.
 */
export async function runRecordWorkProtocol(supabase: RecordClient, params: RecordWorkParams) {
  const {
    title,
    objectives,
    summary,
    acceptanceCriteria,
    availableTools,
    priority,
    projectId,
    personal = false,
    workingDirectory,
    artifacts,
    changeRationales,
    delegate,
    assignedTo,
    agentIdentifier,
    modelIdentifier,
    connectionMethod,
    metadata,
    organizationId,
    userId,
    deviceId
  } = params;

  // Project resolution: explicit projectId/name wins; else try workingDirectory; else require `personal`.
  let resolvedProjectId: string | undefined;
  let resolutionAttempted = false;

  if (!personal && projectId) {
    const matched = await resolveProjectIdOrName(supabase, organizationId, projectId);
    resolvedProjectId = matched?.id;
    if (!resolvedProjectId) {
      return { error: `Project not found: ${projectId}`, status: 404 } as const;
    }
  }

  if (!personal && !resolvedProjectId && workingDirectory) {
    resolutionAttempted = true;
    const matched = await resolveProjectByWorkingDirectory(
      supabase,
      organizationId,
      workingDirectory,
      userId ?? null,
      deviceId ?? null
    );
    resolvedProjectId = matched?.id;
  }

  if (!personal && !resolvedProjectId) {
    return {
      error: resolutionAttempted
        ? `No project matched working directory "${workingDirectory}". Pass --project-id explicitly or use --personal to create a private ticket.`
        : 'Project could not be resolved. Provide --project-id, --working-directory, or --personal.',
      status: 400
    } as const;
  }

  const assigneeResult = await resolveAssignedMember(supabase, organizationId, assignedTo);
  if (!assigneeResult.ok) {
    return { error: assigneeResult.error, status: 400 } as const;
  }

  const nextTitle = title.trim() || deriveTitleFromObjective(objectives[0].objective);
  const ticketDelegate = resolveTicketDelegate(delegate, modelIdentifier ?? null, agentIdentifier);
  const createdBy = await resolveProtocolTicketCreatorUserId(supabase, { userId });
  const reviewStatusName = await resolvePreferredStatusNameByType(
    supabase,
    organizationId,
    'review'
  );

  // Place at top of review column (negative board_position above existing review items).
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
      assigned_member: assigneeResult.memberId ?? undefined,
      available_tools: availableTools,
      board_position: topBoardPosition,
      created_by: createdBy,
      delegate: ticketDelegate,
      for_human: false,
      is_read: false,
      organization_id: organizationId,
      priority,
      project_id: personal ? null : (resolvedProjectId ?? null),
      status: reviewStatusName,
      title: nextTitle
    })
    .select('id,ticket_id,organization_id,project_id,for_human,status,ticket_sequence')
    .single();

  if (ticketError || !ticket) {
    return { error: ticketError?.message ?? 'Failed to create ticket.', status: 500 } as const;
  }

  // Insert the objective directly in `complete` state.
  const completedAt = new Date().toISOString();
  const { data: objectiveRow, error: objectiveError } = await supabase
    .from('objectives')
    .insert({
      agent_identifier: agentIdentifier,
      completed_at: completedAt,
      created_by: createdBy,
      model_identifier: modelIdentifier ?? null,
      objective: objectives[0].objective,
      state: 'complete',
      ticket_id: ticket.id
    })
    .select('id')
    .single();

  if (objectiveError || !objectiveRow) {
    return {
      error: objectiveError?.message ?? 'Ticket created but failed to create completed objective.',
      status: 500
    } as const;
  }

  const queuedObjectives =
    objectives.length > 1
      ? await insertOrderedObjectives(supabase, ticket.id, objectives.slice(1), {
          createdBy,
          firstState: 'future',
          followingState: 'future'
        })
      : [];

  // Create a completed agent session so file_changes/checkpoints have a session_id.
  const sessionKey = randomUUID();
  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .insert({
      agent_identifier: agentIdentifier,
      connection_method: connectionMethod,
      detached_at: completedAt,
      metadata,
      session_key: sessionKey,
      session_state: 'completed',
      objective_id: objectiveRow.id
    })
    .select('id,session_key,session_state')
    .single();

  if (sessionError || !session) {
    return {
      error: 'Ticket created but failed to create session record.',
      status: 500
    } as const;
  }

  const { data: event, error: eventError } = await supabase
    .from('ticket_events')
    .insert({
      created_by: createdBy,
      event_type: 'deliver',
      payload: { created_via: 'protocol.record-work' },
      phase: 'deliver',
      objective_id: objectiveRow.id,
      summary,
      ticket_id: ticket.id
    })
    .select('id')
    .single();

  if (eventError || !event) {
    return {
      error:
        eventError?.message ?? 'Ticket and session created but failed to record deliver event.',
      status: 500
    } as const;
  }

  if (changeRationales.length > 0) {
    const rationaleResult = await insertFileChanges({
      changeRationales: changeRationales.map(rationale => ({
        ...rationale,
        hunks: (rationale.hunks ?? []) as Json,
        objective_id: rationale.objective_id ?? objectiveRow.id
      })),
      eventId: event.id,
      sessionId: session.id,
      supabase,
      ticketId: ticket.id
    });
    if (rationaleResult.error) {
      console.error('[protocol:record-work] change rationale insert error:', rationaleResult.error);
    }
  }

  if (artifacts.length > 0) {
    const artifactRows = artifacts.map(artifact => ({
      artifact_type: artifact.type,
      content: artifact.content ?? null,
      created_by: createdBy,
      event_id: event.id,
      label: artifact.label,
      metadata: (artifact.metadata ?? {}) as Json,
      objective_id: objectiveRow.id,
      ticket_id: ticket.id,
      uri: artifact.uri ?? null
    }));
    const { error: artifactError } = await supabase.from('artifacts').insert(artifactRows);
    if (artifactError) {
      console.error('[protocol:record-work] artifact insert error:', artifactError.message);
    }
  }

  // Emit a status_change event so kanban listeners react the same way they do for deliver.
  await supabase.from('ticket_events').insert({
    created_by: createdBy,
    event_type: 'status_change',
    phase: 'review',
    objective_id: objectiveRow.id,
    summary: 'Work recorded from chat and moved to review.',
    ticket_id: ticket.id
  });

  // Trigger feed-post generation (fire-and-forget — non-fatal).
  try {
    const { error: feedError } = await supabase.functions.invoke('generate-feed-post', {
      body: { ticketId: ticket.id, objectiveId: objectiveRow.id, organizationId }
    });
    if (feedError) {
      console.error('[protocol:record-work] feed post generation failed:', feedError.message);
    }
  } catch (feedErr) {
    console.error('[protocol:record-work] feed post generation error:', feedErr);
  }

  return {
    error: null,
    data: {
      ticket: {
        id: ticket.id,
        title: nextTitle,
        organizationId: ticket.organization_id,
        projectId: ticket.project_id,
        personal: ticket.project_id === null,
        forHuman: ticket.for_human,
        status: ticket.status,
        ticketId: ticket.ticket_id,
        ticketSequence: ticket.ticket_sequence
      },
      objective: { id: objectiveRow.id, state: 'complete' as const },
      objectives: [{ id: objectiveRow.id, state: 'complete' as const }, ...queuedObjectives],
      session: { id: session.id, sessionKey: session.session_key, state: session.session_state },
      event: { id: event.id },
      artifactCount: artifacts.length,
      changeRationaleCount: changeRationales.length
    }
  } as const;
}
