/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

export async function handleDeliver(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId: rawTicketId, summary, artifacts = [] } = args;
  const resolved = await resolveSession(supabase, sessionKey, rawTicketId, ctx.organizationId);
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  const { data: event, error: eventErr } = await supabase
    .from('ticket_events')
    .insert({
      event_type: 'deliver',
      phase: 'deliver',
      session_id: resolved.session.id,
      summary,
      ticket_id: ticketId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to write delivery event.');

  const mcpFunctionsUrl = `${SUPABASE_URL}/functions/v1/mcp`;
  const restartCommand = `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} npx overlord resume claude`;
  const hasRestartArtifact = artifacts.some(
    (a: any) => a.label?.trim().toLowerCase() === 'restart session command'
  );
  const artifactsToPersist = hasRestartArtifact
    ? artifacts
    : [
        ...artifacts,
        {
          type: 'note',
          label: 'Restart session command',
          content: `\`\`\`bash\n${restartCommand}\n\`\`\`\n\nOr use the MCP server at: \`${mcpFunctionsUrl}\``,
          metadata: { generated_by: 'mcp_deliver', restart_session_command: true }
        }
      ];

  if (artifactsToPersist.length) {
    await supabase.from('artifacts').insert(
      artifactsToPersist.map((a: any) => ({
        artifact_type: a.type,
        content: a.content ?? null,
        event_id: event.id,
        label: a.label,
        metadata: a.metadata ?? {},
        session_id: resolved.session.id,
        ticket_id: ticketId,
        uri: a.uri ?? null
      }))
    );
  }

  await Promise.all([
    supabase
      .from('tickets')
      .update({ recent_agent: resolved.session.agent_identifier, status: 'review' })
      .eq('id', ticketId),
    supabase
      .from('agent_sessions')
      .update({ detached_at: new Date().toISOString(), session_state: 'completed' })
      .eq('id', resolved.session.id)
  ]);

  await supabase.from('ticket_events').insert({
    event_type: 'status_change',
    phase: 'review',
    summary: 'Ticket delivered and moved to review.',
    session_id: resolved.session.id,
    ticket_id: ticketId
  });

  return toolOk({ artifacts: artifactsToPersist.length, ok: true, status: 'review' });
}
