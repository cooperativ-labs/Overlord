// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertOrderedObjectives, normalizeObjectivesInput } from './_objectives.ts';
import { resolvePreferredStatusNameByType } from './_status-resolution.ts';
import { resolveTicketCreatorUserId } from './_ticket-creator.ts';

function resolveTicketDelegate(
  delegate: string | null | undefined,
  modelIdentifier: string | null | undefined,
  agentIdentifier: string | null | undefined
) {
  const explicitDelegate = delegate?.trim();
  if (explicitDelegate) return explicitDelegate;

  const sessionModel = modelIdentifier?.trim();
  if (sessionModel) return sessionModel;

  const sessionAgent = agentIdentifier?.trim();
  return sessionAgent || null;
}

export async function handleCreateTicket(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    title = '',
    objectives: rawObjectives,
    acceptanceCriteria = '',
    availableTools = '',
    executionTarget = 'human',
    priority = 'medium',
    delegate = null
  } = args;
  let objectives;
  try {
    objectives = normalizeObjectivesInput({ objectives: rawObjectives });
  } catch (error) {
    return toolErr(error instanceof Error ? error.message : String(error));
  }
  const { organizationId } = ctx;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;
  const ticketDelegate = resolveTicketDelegate(
    delegate,
    typeof resolved.session.metadata?.model === 'string' ? resolved.session.metadata.model : null,
    resolved.session.agent_identifier
  );

  const { data: sourceTicket, error: sourceErr } = await supabase
    .from('tickets')
    .select('id, ticket_id, organization_id, project_id')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (sourceErr || !sourceTicket) return toolErr('Source ticket not found.');

  const nextTitle = title.trim() || objectives[0].objective.slice(0, 120);
  const createdBy = await resolveTicketCreatorUserId(supabase, ctx);
  const draftStatusName = await resolvePreferredStatusNameByType(
    supabase,
    sourceTicket.organization_id,
    'draft'
  );

  const { data: created, error: createErr } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: acceptanceCriteria || null,
      available_tools: availableTools,
      created_by: createdBy,
      delegate: ticketDelegate,
      execution_target: executionTarget,
      organization_id: sourceTicket.organization_id,
      priority,
      project_id: sourceTicket.project_id,
      status: draftStatusName,
      title: nextTitle
    })
    .select('id, ticket_id, organization_id, project_id, execution_target')
    .single();

  if (createErr || !created) return toolErr(createErr?.message ?? 'Failed to create ticket.');

  const insertedObjectives = await insertOrderedObjectives(supabase, created.id, objectives, {
    createdBy,
    firstState: 'draft'
  });

  const sourceRef = sourceTicket.ticket_id ?? sourceTicket.id.slice(-8);
  const createdRef = created.ticket_id ?? created.id.slice(-8);

  await Promise.all([
    supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: { created_from_ticket_id: ticketId, delegate: ticketDelegate },
      session_id: resolved.session.id,
      summary: `Follow-up ticket created from ${sourceRef}.`,
      ticket_id: created.id,
      created_by: createdBy
    }),
    supabase.from('ticket_events').insert({
      event_type: 'update',
      payload: {
        created_ticket_id: created.id,
        delegate: ticketDelegate,
        entry_type: 'follow_up_ticket'
      },
      session_id: resolved.session.id,
      summary: `Created follow-up ticket ${createdRef} (${created.execution_target}).`,
      ticket_id: ticketId,
      created_by: createdBy
    })
  ]);

  return toolOk({
    ok: true,
    objectives: insertedObjectives,
    ticket: {
      executionTarget: created.execution_target,
      id: created.id,
      organizationId: created.organization_id,
      projectId: created.project_id,
      reference: createdRef
    }
  });
}
