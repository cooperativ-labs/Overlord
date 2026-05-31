// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleHeartbeat(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId, phase, percent, note, externalSessionId, externalUrl } = args;

  const resolved = await resolveSession(
    supabase,
    sessionKey,
    ticketId,
    ctx.organizationId,
    externalSessionId ?? ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');

  const heartbeatAt = new Date().toISOString();
  const existingMetadata =
    resolved.session.metadata &&
    typeof resolved.session.metadata === 'object' &&
    !Array.isArray(resolved.session.metadata)
      ? resolved.session.metadata
      : {};

  const sessionUpdate: Record<string, unknown> = {
    heartbeat_at: heartbeatAt,
    metadata: {
      ...existingMetadata,
      overlordHeartbeat: {
        at: heartbeatAt,
        ...(typeof phase === 'string' && phase.trim().length > 0 ? { phase } : {}),
        ...(typeof percent === 'number' ? { percent } : {}),
        ...(typeof note === 'string' && note.trim().length > 0 ? { note } : {})
      }
    }
  };

  if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
  if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

  const { error } = await supabase
    .from('agent_sessions')
    .update(sessionUpdate)
    .eq('id', resolved.session.id);
  if (error) return toolErr(error.message);

  return toolOk({
    ok: true,
    heartbeatAt,
    telemetry: {
      ...(typeof phase === 'string' && phase.trim().length > 0 ? { phase } : {}),
      ...(typeof percent === 'number' ? { percent } : {}),
      ...(typeof note === 'string' && note.trim().length > 0 ? { note } : {})
    }
  });
}
