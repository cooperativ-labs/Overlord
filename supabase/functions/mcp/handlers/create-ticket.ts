// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleCreateTicket(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    title = '',
    objective,
    acceptanceCriteria = '',
    availableTools = '',
    executionTarget = 'human',
    priority = 'medium'
  } = args;
  const { organizationId, userId } = ctx;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  const { data: sourceTicket, error: sourceErr } = await supabase
    .from('tickets')
    .select('id, organization_id, project_id')
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .single();

  if (sourceErr || !sourceTicket) return toolErr('Source ticket not found.');

  const nextTitle = title.trim() || objective.slice(0, 120);

  const { data: created, error: createErr } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: acceptanceCriteria || null,
      available_tools: availableTools,
      created_by: userId,
      execution_target: executionTarget,
      objective,
      organization_id: sourceTicket.organization_id,
      priority,
      project_id: sourceTicket.project_id,
      status: 'draft',
      title: nextTitle
    })
    .select('id, organization_id, project_id, execution_target')
    .single();

  if (createErr || !created) return toolErr(createErr?.message ?? 'Failed to create ticket.');

  const sourceRef = ticketId.slice(-8);
  const createdRef = created.id.slice(-8);

  await Promise.all([
    supabase.from('ticket_events').insert({
      event_type: 'system',
      payload: { created_from_ticket_id: ticketId },
      session_id: resolved.session.id,
      summary: `Follow-up ticket created from ${sourceRef}.`,
      ticket_id: created.id
    }),
    supabase.from('ticket_events').insert({
      event_type: 'update',
      payload: { created_ticket_id: created.id, entry_type: 'follow_up_ticket' },
      session_id: resolved.session.id,
      summary: `Created follow-up ticket ${createdRef} (${created.execution_target}).`,
      ticket_id: ticketId
    })
  ]);

  return toolOk({
    ok: true,
    ticket: {
      executionTarget: created.execution_target,
      id: created.id,
      organizationId: created.organization_id,
      projectId: created.project_id,
      reference: createdRef
    }
  });
}
