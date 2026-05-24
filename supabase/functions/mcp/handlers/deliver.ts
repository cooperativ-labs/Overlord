/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { scheduleGenerateFeedPost } from '../helpers/invoke-generate-feed-post.ts';
import { getPublicMcpUrl } from '../helpers/public-url.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';
import { upsertObjectiveCheckpoint } from './_checkpoints.ts';
import { resolvePreferredStatusNameByType } from './_status-resolution.ts';

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
    if (normalized.includes('antigravity') || normalized === 'agy') {
      return `agy --conversation ${nativeSessionId}`;
    }
    if (normalized.includes('opencode')) {
      return `opencode --continue --session ${nativeSessionId}`;
    }
  }

  if (normalized.includes('cursor')) {
    return `OVERLORD_URL=$OVERLORD_URL OVERLORD_ACCESS_TOKEN=$OVERLORD_ACCESS_TOKEN OVERLORD_ORGANIZATION_ID=$OVERLORD_ORGANIZATION_ID TICKET_ID=${ticketId} ovld resume cursor`;
  }
  if (normalized.includes('antigravity') || normalized === 'agy') {
    return `OVERLORD_URL=$OVERLORD_URL OVERLORD_ACCESS_TOKEN=$OVERLORD_ACCESS_TOKEN OVERLORD_ORGANIZATION_ID=$OVERLORD_ORGANIZATION_ID TICKET_ID=${ticketId} ovld restart antigravity`;
  }
  if (normalized.includes('opencode')) {
    return `OVERLORD_URL=$OVERLORD_URL OVERLORD_ACCESS_TOKEN=$OVERLORD_ACCESS_TOKEN OVERLORD_ORGANIZATION_ID=$OVERLORD_ORGANIZATION_ID TICKET_ID=${ticketId} ovld resume opencode`;
  }
  if (normalized.includes('codex')) {
    return `OVERLORD_URL=$OVERLORD_URL OVERLORD_ACCESS_TOKEN=$OVERLORD_ACCESS_TOKEN OVERLORD_ORGANIZATION_ID=$OVERLORD_ORGANIZATION_ID TICKET_ID=${ticketId} ovld resume codex`;
  }
  return `OVERLORD_URL=$OVERLORD_URL OVERLORD_ACCESS_TOKEN=$OVERLORD_ACCESS_TOKEN OVERLORD_ORGANIZATION_ID=$OVERLORD_ORGANIZATION_ID TICKET_ID=${ticketId} ovld resume claude`;
}

export async function handleDeliver(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    artifacts = [],
    changeRationales = [],
    checkpoint,
    snapshot
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
      objective_id: resolved.session.objective_id,
      summary,
      ticket_id: ticketId,
      created_by: ctx.userId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to write delivery event.');

  let checkpointId: string | null = null;
  const hasCheckpoint = Boolean(snapshot?.gitCommitId || checkpoint);
  if (hasCheckpoint) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('project_id')
      .eq('id', ticketId)
      .eq('organization_id', ctx.organizationId)
      .single();

    if (!(ticket as { project_id: string | null } | null)?.project_id)
      return toolErr('Cannot persist a checkpoint for a ticket without a project.');

    const result = await upsertObjectiveCheckpoint({
      supabase,
      organizationId: ctx.organizationId,
      projectId: (ticket as { project_id: string }).project_id,
      ticketId,
      sessionId: resolved.session.id,
      eventId: event.id,
      userId: ctx.userId,
      snapshot,
      checkpoint: checkpoint
        ? { ...checkpoint, kind: checkpoint.kind ?? 'delivery' }
        : { kind: 'delivery' },
      fallbackSummary: summary
    });
    if (result.error) return toolErr(result.error);
    checkpointId = result.checkpointId;
  }

  if (Array.isArray(changeRationales) && changeRationales.length > 0) {
    const rationaleResult = await insertChangeRationales(supabase, {
      changeRationales,
      checkpointId,
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

  const reviewStatusName = await resolvePreferredStatusNameByType(
    supabase,
    ctx.organizationId,
    'review'
  );

  if (artifactsToPersist.length) {
    await supabase.from('artifacts').insert(
      artifactsToPersist.map((a: any) => ({
        artifact_type: a.type,
        content: a.content ?? null,
        event_id: event.id,
        label: a.label,
        metadata: a.metadata ?? {},
        objective_id: resolved.session.objective_id,
        ticket_id: ticketId,
        uri: a.uri ?? null,
        created_by: ctx.userId
      }))
    );
  }

  // Place delivered ticket at the top of the review column
  const { data: headTickets } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', ctx.organizationId)
    .eq('status', reviewStatusName)
    .neq('id', ticketId)
    .order('board_position', { ascending: true })
    .limit(1);
  const topBoardPosition =
    ((headTickets as { board_position: number }[] | null)?.[0]?.board_position ?? 0) - 1;
  const completedAt = new Date().toISOString();

  await Promise.all([
    supabase
      .from('tickets')
      .update({
        status: reviewStatusName,
        board_position: topBoardPosition
      })
      .eq('id', ticketId),
    supabase
      .from('agent_sessions')
      .update({ detached_at: new Date().toISOString(), session_state: 'completed' })
      .eq('id', resolved.session.id),
    // Mark only this session's objective complete — never sweep siblings that
    // may have raced into 'executing' via auto-advance during deliver.
    supabase
      .from('objectives')
      .update({ state: 'complete', completed_at: completedAt })
      .eq('id', resolved.session.objective_id)
      .eq('ticket_id', ticketId)
      .in('state', ['executing', 'pending_delivery', 'submitted', 'draft'])
  ]);

  await supabase.from('ticket_events').insert({
    event_type: 'status_change',
    phase: 'review',
    summary: 'Ticket delivered and moved to review.',
    objective_id: resolved.session.objective_id,
    ticket_id: ticketId,
    created_by: ctx.userId
  });

  scheduleGenerateFeedPost({
    supabase,
    ticketId,
    objectiveId: resolved.session.objective_id,
    organizationId: ctx.organizationId,
    logPrefix: '[mcp:deliver]'
  });

  return toolOk({ artifacts: artifactsToPersist.length, ok: true, status: reviewStatusName });
}
