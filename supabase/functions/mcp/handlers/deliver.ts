/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { getPublicMcpUrl } from '../helpers/public-url.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function buildMcpRestartCommand(
  ticketId: string,
  agentIdentifier: string | null | undefined,
  externalSessionId: string | null | undefined
) {
  const normalized = agentIdentifier?.trim().toLowerCase() ?? '';
  const nativeSessionId = externalSessionId?.trim();

  if (nativeSessionId) {
    if (normalized.includes('claude')) return `claude --resume ${nativeSessionId}`;
    if (normalized.includes('codex')) return `codex resume ${nativeSessionId}`;
    if (normalized.includes('cursor')) return `cursor --resume ${nativeSessionId}`;
    if (normalized.includes('gemini')) return `gemini --resume ${nativeSessionId}`;
    if (normalized.includes('opencode')) {
      return `opencode --continue --session ${nativeSessionId}`;
    }
  }

  if (normalized.includes('cursor')) {
    return `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} ovld resume cursor`;
  }
  if (normalized.includes('gemini')) {
    return `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} ovld resume gemini`;
  }
  if (normalized.includes('opencode')) {
    return `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} ovld resume opencode`;
  }
  if (normalized.includes('codex')) {
    return `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} ovld resume codex`;
  }
  return `OVERLORD_URL=$OVERLORD_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=${ticketId} ovld resume claude`;
}

export async function handleDeliver(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    artifacts = [],
    changeRationales = []
  } = args;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
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

  if (Array.isArray(changeRationales) && changeRationales.length > 0) {
    const rationaleResult = await insertChangeRationales(supabase, {
      changeRationales,
      eventId: event.id,
      sessionId: resolved.session.id,
      ticketId
    });
    if (rationaleResult.error) return toolErr(rationaleResult.error);
  }

  const publicMcpUrl = getPublicMcpUrl({
    NEXT_PUBLIC_SITE_URL: Deno.env.get('NEXT_PUBLIC_SITE_URL'),
    OVERLORD_URL: Deno.env.get('OVERLORD_URL'),
    SUPABASE_URL
  });
  const restartCommand = buildMcpRestartCommand(
    ticketId,
    resolved.session.agent_identifier,
    resolved.session.external_session_id
  );
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
          content: `\`\`\`bash\n${restartCommand}\n\`\`\`\n\nOr use the MCP server at: \`${publicMcpUrl}\``,
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

  // Place delivered ticket at the top of the review column
  const { data: headTickets } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'review')
    .neq('id', ticketId)
    .order('board_position', { ascending: true })
    .limit(1);
  const topBoardPosition =
    ((headTickets as { board_position: number }[] | null)?.[0]?.board_position ?? 0) - 1;

  await Promise.all([
    supabase
      .from('tickets')
      .update({
        recent_agent: resolved.session.agent_identifier,
        status: 'review',
        board_position: topBoardPosition
      })
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
