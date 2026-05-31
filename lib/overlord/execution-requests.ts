import type { SupabaseClient } from '@supabase/supabase-js';

import type { RunnerTerminalProfile } from '@/lib/helpers/runner-terminal-settings';
import { requireExecutionAgentFromAssignment } from '@/lib/overlord/resolve-execution-agent';
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
  preCommand?: string | null;
  /** Fully-resolved custom-agent launch command; when set, agentIdentifier is a custom slug. */
  customCommand?: string | null;
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  serverMultiplexer?: 'none' | 'tmux' | null;
  tmuxCommand?: string | null;
  runnerTerminalProfile?: RunnerTerminalProfile | null;
  targetKind?: 'any' | 'local' | 'ssh';
  targetExecutionTargetId?: string | null;
  targetResourceId?: string | null;
};

type TicketRow = {
  id: string;
  ticket_id: string;
  organization_id: number;
  project_id: string | null;
  for_human: boolean | null;
};

type ObjectiveRow = {
  id: string;
  ticket_id: string;
  state: string;
  objective: string | null;
  assigned_agent: Json | null;
};

type ExecutionRequestRow = Database['public']['Tables']['execution_requests']['Row'];

/**
 * Statuses that represent an in-flight execution request for an objective. A
 * partial unique index on `execution_requests(objective_id) WHERE status IN
 * (...these...)` guarantees at most one active request per objective; this list
 * must stay in sync with that index (see the Phase 3 migration).
 */
export const ACTIVE_REQUEST_STATUSES = ['queued', 'claimed', 'launching'] as const;

export type ExecutionRequestResponse = {
  request: ExecutionRequestRow;
  ticket: TicketRow;
  objective: ObjectiveRow;
  /** True when an existing active request was reused/re-queued instead of inserting a new one. */
  reused: boolean;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildLaunchParams(input: RequestExecutionInput): Json {
  return {
    flags: input.flags ?? [],
    preCommand: normalizeOptionalText(input.preCommand),
    customCommand: normalizeOptionalText(input.customCommand),
    workingDirectory: normalizeOptionalText(input.workingDirectory),
    sshCommand: normalizeOptionalText(input.sshCommand),
    remoteWorkingDirectory: normalizeOptionalText(input.remoteWorkingDirectory),
    serverMultiplexer: input.serverMultiplexer ?? null,
    tmuxCommand: normalizeOptionalText(input.tmuxCommand),
    runnerTerminalProfile: input.runnerTerminalProfile ?? null
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
      .in('state', ['draft', 'submitted', 'launching'])
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No launchable objective found.');

  const objectiveText = data.objective?.trim() ?? '';
  if (!objectiveText) throw new Error('Objective is empty.');
  // `launching` is launchable too: re-resolving an already-queued objective
  // (e.g. a relaunch click) must not be rejected.
  if (data.state !== 'draft' && data.state !== 'submitted' && data.state !== 'launching') {
    throw new Error(`Objective is not launchable from state "${data.state}".`);
  }

  return data as ObjectiveRow;
}

/**
 * Find the single in-flight (`queued`/`claimed`/`launching`) execution request
 * for an objective, if any. The Phase 3 partial unique index guarantees at most
 * one, but we order newest-first defensively.
 */
async function findActiveRequestForObjective(
  supabase: ExecutionClient,
  organizationId: number,
  objectiveId: string
): Promise<ExecutionRequestRow | null> {
  const { data, error } = await supabase
    .from('execution_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('objective_id', objectiveId)
    .in('status', ACTIVE_REQUEST_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutionRequestRow | null) ?? null;
}

async function findExecutionRequestById(
  supabase: ExecutionClient,
  organizationId: number,
  requestId: string
): Promise<ExecutionRequestRow | null> {
  const { data, error } = await supabase
    .from('execution_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutionRequestRow | null) ?? null;
}

/**
 * Reuse an already-active execution request instead of inserting a duplicate
 * (Phase 3 / Decision 2). A stale `claimed`/`launching` row is reset to
 * `queued` so a runner can re-claim it (covers the case where the runner
 * claimed the job but the terminal never opened), and a fresh
 * `execution_requested` event is emitted so Desktop's runner listener wakes up
 * and (re)launches the queued work.
 */
async function reuseActiveRequest(
  supabase: ExecutionClient,
  existing: ExecutionRequestRow,
  ticket: TicketRow,
  objective: ObjectiveRow,
  requestedFrom: string,
  userId: string
): Promise<ExecutionRequestResponse> {
  let request = existing;
  if (existing.status !== 'queued') {
    const { data: reset, error: resetError } = await supabase
      .from('execution_requests')
      .update({
        status: 'queued',
        claimed_by_execution_target_id: null,
        claimed_at: null,
        lease_expires_at: null,
        last_error: null
      })
      .eq('id', existing.id)
      .eq('organization_id', ticket.organization_id)
      .eq('objective_id', objective.id)
      .eq('status', existing.status)
      .in('status', ['claimed', 'launching'])
      .select('*')
      .maybeSingle();
    if (resetError) throw new Error(resetError.message);
    if (reset) {
      request = reset as ExecutionRequestRow;
    } else {
      // The row changed after the active pre-check. Do not convert a terminal
      // request back to queued or emit a wake-up event; return the latest row as
      // an idempotent no-op so the caller can surface the current status.
      const latest = await findExecutionRequestById(supabase, ticket.organization_id, existing.id);
      if (!latest) {
        throw new Error('Execution request disappeared before it could be re-queued.');
      }
      return { request: latest, ticket, objective, reused: true };
    }
  }

  await supabase.from('ticket_events').insert({
    event_type: 'execution_requested',
    phase: 'execute',
    summary: 'Re-queued the existing objective execution for a runner.',
    ticket_id: ticket.id,
    objective_id: objective.id,
    created_by: userId,
    payload: {
      execution_request_id: request.id,
      requested_from: requestedFrom,
      reused_execution_request: true
    }
  });

  return { request, ticket, objective, reused: true };
}

export async function createExecutionRequest(
  supabase: ExecutionClient,
  input: RequestExecutionInput
): Promise<ExecutionRequestResponse> {
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,ticket_id,organization_id,project_id,for_human')
    .eq('id', input.ticketId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (ticketError) throw new Error(ticketError.message);
  if (!ticket) throw new Error('Ticket not found.');
  if (ticket.for_human) {
    throw new Error(
      'Ticket is marked for human execution. Switch it back to agent in the ticket settings to enable agent runs.'
    );
  }

  const objective = await resolveObjectiveForExecution(supabase, ticket.id, input.objectiveId);

  // Phase 3 dedup: if there is already an in-flight request for this objective,
  // reuse/re-queue it instead of creating a duplicate. This is what makes a
  // repeated Run click relaunch the already-queued work rather than spawning a
  // second agent.
  const requestedFrom = input.requestedFrom.trim();
  const activeExisting = await findActiveRequestForObjective(
    supabase,
    ticket.organization_id,
    objective.id
  );
  if (activeExisting) {
    return reuseActiveRequest(
      supabase,
      activeExisting,
      ticket as TicketRow,
      objective,
      requestedFrom,
      input.userId
    );
  }

  const assigned = requireExecutionAgentFromAssignment(objective.assigned_agent);
  const customCommand = normalizeOptionalText(input.customCommand);
  if (assigned.customAgentId && !customCommand) {
    throw new Error(
      'Assigned custom agent is missing a launch command. Re-select the agent and try again.'
    );
  }
  const agent = assigned.agentIdentifier;
  const model = assigned.modelIdentifier;
  const thinking = assigned.thinkingLevel;
  const idempotencyKey =
    normalizeOptionalText(input.idempotencyKey) ??
    (requestedFrom === 'auto_advance'
      ? `auto_advance:${objective.id}`
      : `${requestedFrom}:${objective.id}:${crypto.randomUUID()}`);

  // New launch requests move draft -> launching (Phase 2). The legacy
  // `submitted` state is left for the discuss/submit path; readers treat
  // `launching` identically to `submitted` for now.
  if (objective.state === 'draft') {
    const update: Database['public']['Tables']['objectives']['Update'] = {
      state: 'launching'
    };
    if (requestedFrom === 'auto_advance') {
      update.auto_advanced_at = new Date().toISOString();
    }
    const { error } = await supabase.from('objectives').update(update).eq('id', objective.id);
    if (error) throw new Error(error.message);
    objective.state = 'launching';
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
    target_execution_target_id: input.targetExecutionTargetId ?? null,
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

  const request = inserted;
  if (insertError) {
    if (insertError.code !== '23505') throw new Error(insertError.message);

    // A 23505 here is a lost insert race. It can be either the active-objective
    // partial index (another tab/click queued first) or the legacy
    // (org, idempotency_key) constraint. Prefer resolving by the active
    // objective row — the same outcome as the pre-check path — and fall back to
    // the idempotency key only when no active row exists.
    const raceActive = await findActiveRequestForObjective(
      supabase,
      ticket.organization_id,
      objective.id
    );
    if (raceActive) {
      return reuseActiveRequest(
        supabase,
        raceActive,
        ticket as TicketRow,
        objective,
        requestedFrom,
        input.userId
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from('execution_requests')
      .select('*')
      .eq('organization_id', ticket.organization_id)
      .eq('idempotency_key', idempotencyKey)
      .single();
    if (existingError || !existing) {
      throw new Error(existingError?.message ?? 'Execution request already exists.');
    }
    return {
      request: existing as ExecutionRequestRow,
      ticket: ticket as TicketRow,
      objective,
      reused: true
    };
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

  return { request, ticket: ticket as TicketRow, objective, reused: false };
}
