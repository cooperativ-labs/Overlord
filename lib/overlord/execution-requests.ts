import type { SupabaseClient } from '@supabase/supabase-js';

import { isLaunchAgentTypeValue, type LaunchAgentType } from '@/lib/helpers/agent-types';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import type { Database, Json } from '@/types/database.types';

type ExecutionClient = SupabaseClient<Database>;

type RequestExecutionInput = {
  ticketId: string;
  objectiveId?: string | null;
  userId: string;
  organizationId: number;
  requestedFrom: string;
  idempotencyKey?: string | null;
  agentIdentifier?: string | null;
  modelIdentifier?: string | null;
  thinkingLevel?: string | null;
  launchMode?: 'run' | 'ask';
  flags?: string[];
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  serverMultiplexer?: 'none' | 'tmux' | null;
  tmuxCommand?: string | null;
  targetKind?: 'any' | 'local' | 'ssh';
  targetDeviceId?: string | null;
  targetResourceId?: string | null;
};

type TicketRow = {
  id: string;
  ticket_id: string;
  organization_id: number;
  project_id: string | null;
  execution_target: string | null;
};

type ObjectiveRow = {
  id: string;
  ticket_id: string;
  state: string;
  objective: string | null;
  assigned_agent: Json | null;
};

type ExecutionRequestRow = Database['public']['Tables']['execution_requests']['Row'];

export type ExecutionRequestResponse = {
  request: ExecutionRequestRow;
  ticket: TicketRow;
  objective: ObjectiveRow;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeAgent(value: string | null | undefined): LaunchAgentType {
  const normalized = normalizeOptionalText(value);
  return normalized && isLaunchAgentTypeValue(normalized) ? normalized : 'claude';
}

function buildLaunchParams(input: RequestExecutionInput): Json {
  return {
    flags: input.flags ?? [],
    workingDirectory: normalizeOptionalText(input.workingDirectory),
    sshCommand: normalizeOptionalText(input.sshCommand),
    remoteWorkingDirectory: normalizeOptionalText(input.remoteWorkingDirectory),
    serverMultiplexer: input.serverMultiplexer ?? null,
    tmuxCommand: normalizeOptionalText(input.tmuxCommand)
  };
}

async function resolveObjectiveForExecution(
  supabase: ExecutionClient,
  ticketId: string,
  objectiveId?: string | null
): Promise<ObjectiveRow> {
  let query = supabase
    .from('objectives')
    .select('id,ticket_id,state,objective,assigned_agent')
    .eq('ticket_id', ticketId);

  if (objectiveId) {
    query = query.eq('id', objectiveId);
  } else {
    query = query
      .in('state', ['draft', 'submitted'])
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No launchable objective found.');

  const objectiveText = data.objective?.trim() ?? '';
  if (!objectiveText) throw new Error('Objective is empty.');
  if (data.state !== 'draft' && data.state !== 'submitted') {
    throw new Error(`Objective is not launchable from state "${data.state}".`);
  }

  return data as ObjectiveRow;
}

export async function createExecutionRequest(
  supabase: ExecutionClient,
  input: RequestExecutionInput
): Promise<ExecutionRequestResponse> {
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,ticket_id,organization_id,project_id,execution_target')
    .eq('id', input.ticketId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (ticketError) throw new Error(ticketError.message);
  if (!ticket) throw new Error('Ticket not found.');
  if (ticket.execution_target !== 'agent') {
    throw new Error('Ticket is not configured for agent execution.');
  }

  const objective = await resolveObjectiveForExecution(supabase, ticket.id, input.objectiveId);
  const assigned = parseObjectiveAssignedAgent(objective.assigned_agent);
  const agent = normalizeAgent(assigned?.agent ?? input.agentIdentifier ?? null);
  const model = assigned?.model ?? normalizeOptionalText(input.modelIdentifier) ?? null;
  const thinking = assigned?.thinking ?? normalizeOptionalText(input.thinkingLevel) ?? null;
  const requestedFrom = input.requestedFrom.trim();
  const idempotencyKey =
    normalizeOptionalText(input.idempotencyKey) ??
    (requestedFrom === 'auto_advance'
      ? `auto_advance:${objective.id}`
      : `${requestedFrom}:${objective.id}:${crypto.randomUUID()}`);

  if (objective.state === 'draft') {
    const update: Database['public']['Tables']['objectives']['Update'] = {
      state: 'submitted'
    };
    if (requestedFrom === 'auto_advance') {
      update.auto_advanced_at = new Date().toISOString();
    }
    const { error } = await supabase.from('objectives').update(update).eq('id', objective.id);
    if (error) throw new Error(error.message);
    objective.state = 'submitted';
  }

  const insert = {
    organization_id: ticket.organization_id,
    ticket_id: ticket.id,
    objective_id: objective.id,
    project_id: ticket.project_id,
    requested_by: input.userId,
    requested_from: requestedFrom,
    agent_identifier: agent,
    model_identifier: model,
    thinking_level: thinking,
    launch_mode: input.launchMode ?? 'run',
    launch_params: buildLaunchParams(input),
    target_device_id: input.targetDeviceId ?? null,
    target_resource_id: input.targetResourceId ?? null,
    target_kind: input.targetKind ?? 'any',
    status: 'queued',
    idempotency_key: idempotencyKey
  } satisfies Database['public']['Tables']['execution_requests']['Insert'];

  const { data: inserted, error: insertError } = await supabase
    .from('execution_requests')
    .insert(insert)
    .select('*')
    .single();

  let request = inserted;
  if (insertError) {
    if (insertError.code !== '23505') throw new Error(insertError.message);

    const { data: existing, error: existingError } = await supabase
      .from('execution_requests')
      .select('*')
      .eq('organization_id', ticket.organization_id)
      .eq('idempotency_key', idempotencyKey)
      .single();
    if (existingError || !existing) {
      throw new Error(existingError?.message ?? 'Execution request already exists.');
    }
    request = existing;
  }
  if (!request) {
    throw new Error('Failed to create execution request.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'execution_requested',
    phase: 'execute',
    summary:
      requestedFrom === 'auto_advance'
        ? 'Queued the next objective for runner execution.'
        : 'Queued objective execution for a runner.',
    ticket_id: ticket.id,
    objective_id: objective.id,
    created_by: input.userId,
    payload: {
      execution_request_id: request.id,
      requested_from: requestedFrom,
      agent_identifier: agent,
      model_identifier: model,
      thinking_level: thinking,
      target_kind: input.targetKind ?? 'any'
    }
  });

  return { request, ticket: ticket as TicketRow, objective };
}
